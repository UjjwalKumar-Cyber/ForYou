require("dotenv").config();

const crypto = require("crypto");
const http = require("http");
const path = require("path");
const compression = require("compression");
const express = require("express");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const helmet = require("helmet");
const multer = require("multer");
const sanitizeHtml = require("sanitize-html");
const sharp = require("sharp");
const { Server } = require("socket.io");

const {
  addMessage,
  updateUserOnlineStatus,
  authenticateUser,
  cleanupExpiredMessages,
  deleteMessage,
  findUser,
  findAccessibleMessage,
  getUserAvatar,
  initStore,
  listChatSummaries,
  listConversationMessages,
  listLetterMessages,
  listMessagesForUser,
  listStarredMessages,
  listUsers,
  markConversationRead,
  normalizeUsername,
  toggleMessageReaction,
  toggleMessageStar,
  updateUserAvatar,
  updateUserPassword,
  updateUserProfile,
  updateUserSettings
} = require("./src/storage/messages");

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  serveClient: true,
  perMessageDeflate: {
    threshold: 1024
  }
});

const PORT = Number(process.env.PORT || 3000);
const SECRET_PATH = "/secret-8392-love-note";
const isProduction = process.env.NODE_ENV === "production";
const ACTIVE_WINDOW_MS = 1000 * 60 * 2;
const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const USER_LIST_CACHE_MS = 5000;
const USER_LIST_LIMIT = 200;
const MESSAGE_PAGE_LIMIT = 80;
const allowedImageTypes = new Set([
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp"
]);
const allowedAttachmentTypes = new Set([
  ...allowedImageTypes,
  "audio/aac",
  "audio/m4a",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "application/pdf",
  "text/plain",
  "video/mp4",
  "video/quicktime",
  "video/webm"
]);
const imageMimeByExtension = new Map([
  [".gif", "image/gif"],
  [".heic", "image/heic"],
  [".heif", "image/heif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"]
]);
const attachmentMimeByExtension = new Map([
  ...imageMimeByExtension,
  [".aac", "audio/aac"],
  [".m4a", "audio/mp4"],
  [".mp3", "audio/mpeg"],
  [".ogg", "audio/ogg"],
  [".wav", "audio/wav"],
  [".webm", "video/webm"],
  [".mp4", "video/mp4"],
  [".mov", "video/quicktime"],
  [".pdf", "application/pdf"],
  [".txt", "text/plain"]
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: ATTACHMENT_MAX_BYTES,
    files: 1
  },
  fileFilter: (req, file, callback) => {
    const attachmentMime = getAttachmentMime(file);

    if (!attachmentMime) {
      return callback(new Error("Please attach an image, audio note, video, PDF, or text file."));
    }

    return callback(null, true);
  }
});

function requiredSecret(name, fallback) {
  const value = process.env[name];

  if (value) {
    return value;
  }

  if (isProduction) {
    throw new Error(`${name} must be set in production.`);
  }

  console.warn(`[dev] ${name} is not set. Using a local-only fallback value.`);
  return fallback;
}

const MESSAGE_PAGE_PASSWORD = requiredSecret(
  "MESSAGE_PAGE_PASSWORD",
  "open-the-secret-note"
);
const ADMIN_PASSWORD = requiredSecret("ADMIN_PASSWORD", "admin-love-notes");
const SESSION_SECRET = requiredSecret(
  "SESSION_SECRET",
  "local-development-session-secret-change-me"
);

process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;

const activeUsers = new Map();
let userListCache = {
  expiresAt: 0,
  users: null
};
let presenceUpdateTimer = null;

const cspDirectives = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  connectSrc: ["'self'"],
  fontSrc: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  imgSrc: ["'self'", "data:"],
  mediaSrc: ["'self'", "data:", "blob:"],
  objectSrc: ["'none'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"]
};

if (isProduction) {
  cspDirectives.upgradeInsecureRequests = [];
}

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: cspDirectives
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: {
      policy: "no-referrer"
    }
  })
);

app.use((req, res, next) => {
  res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  next();
});

app.use(
  compression({
    threshold: 1024
  })
);

app.use(express.json({ limit: "12kb" }));
app.use(express.urlencoded({ extended: false, limit: "12kb" }));

const sessionMiddleware = session({
    name: "private_love_note.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    rolling: true,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 365,
      sameSite: "strict",
      secure: isProduction
    }
  });

app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

app.use((req, res, next) => {
  markUserActive(req.session.accountUser);
  next();
});

const sessionKey = (req) => req.sessionID || "anonymous-session";

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: sessionKey,
  message: {
    error: "Too many attempts. Please wait a bit before trying again."
  }
});

const messageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 180,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: sessionKey,
  message: {
    error: "Too many notes were sent from this browser. Please wait a little before trying again."
  }
});

app.use(
  express.static(path.join(__dirname, "public"), {
    etag: true,
    maxAge: isProduction ? "7d" : 0,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith("sw.js")) {
        res.set("Cache-Control", "no-cache");
        return;
      }

      if (isProduction && /\.(?:css|js|svg|webmanifest)$/i.test(filePath)) {
        res.set("Cache-Control", "public, max-age=604800, immutable");
      }
    }
  })
);

function noStore(res) {
  res.set("Cache-Control", "no-store, private");
}

function sendView(res, fileName) {
  noStore(res);
  res.sendFile(path.join(__dirname, "views", fileName));
}

function safeCompare(received, expected) {
  const receivedBuffer = Buffer.from(String(received || ""), "utf8");
  const expectedBuffer = Buffer.from(String(expected || ""), "utf8");

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

function requireSecretAccess(req, res, next) {
  if (req.session.secretUnlocked === true) {
    return next();
  }

  noStore(res);
  return res.status(401).json({ error: "Please unlock the private page first." });
}

function requireAccount(req, res, next) {
  if (req.session.accountUser && req.session.accountUser.username) {
    return next();
  }

  noStore(res);
  return res.status(401).json({ error: "Please log in to your inbox." });
}

function requireMessageAccess(req, res, next) {
  if (req.session.secretUnlocked === true || (req.session.accountUser && req.session.accountUser.username)) {
    return next();
  }

  noStore(res);
  return res.status(401).json({ error: "Please unlock the page or log in first." });
}

function cleanText(input) {
  if (typeof input !== "string") {
    return "";
  }

  const normalized = input.replace(/\r\n/g, "\n").trim();
  const withoutMarkup = sanitizeHtml(normalized, {
    allowedAttributes: {},
    allowedTags: [],
    disallowedTagsMode: "discard",
    parseStyleAttributes: false
  });

  return withoutMarkup
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
}

function cleanMessage(input) {
  return cleanText(input);
}

function cleanSenderName(input) {
  return cleanText(input);
}

function cleanDisplayName(input) {
  return cleanText(input);
}

function isValidAccountUsername(input) {
  return /^[a-zA-Z0-9_.-]{3,32}$/.test(String(input || "").trim());
}

function pruneActiveUsers(now = Date.now()) {
  for (const [username, record] of activeUsers.entries()) {
    if (!record || (!record.socketCount && now - record.lastActiveAt > ACTIVE_WINDOW_MS)) {
      activeUsers.delete(username);
    }
  }
}

function isUserActive(username) {
  const now = Date.now();
  const normalizedUsername = normalizeUsername(username);
  pruneActiveUsers(now);

  if (!normalizedUsername) {
    return false;
  }

  const record = activeUsers.get(normalizedUsername);
  return Boolean(
    record &&
      !record.anonymousMode &&
      (record.socketCount > 0 || now - record.lastActiveAt <= ACTIVE_WINDOW_MS)
  );
}

function markUserActive(user) {
  const username = normalizeUsername(user && user.username);

  if (!username) {
    return;
  }

  const existing = activeUsers.get(username) || {};

  activeUsers.set(username, {
    anonymousMode: Boolean(user.anonymousMode || user.hideActiveStatus),
    lastActiveAt: Date.now(),
    socketCount: Number(existing.socketCount || 0)
  });
}

function updateSocketPresence(user, delta) {
  const username = normalizeUsername(user && user.username);

  if (!username) {
    return;
  }

  const existing = activeUsers.get(username) || {
    anonymousMode: Boolean(user.anonymousMode || user.hideActiveStatus),
    lastActiveAt: Date.now(),
    socketCount: 0
  };

  activeUsers.set(username, {
    anonymousMode: Boolean(user.anonymousMode || user.hideActiveStatus),
    lastActiveAt: Date.now(),
    socketCount: Math.max(0, Number(existing.socketCount || 0) + delta)
  });
}

function cleanFileName(input) {
  const cleaned = cleanText(input)
    .replace(/[^a-zA-Z0-9 ._()-]/g, "")
    .trim();

  return cleaned.slice(0, 80) || "photo";
}

function getImageMime(file) {
  if (allowedImageTypes.has(file.mimetype)) {
    return file.mimetype;
  }

  const extension = path.extname(file.originalname || "").toLowerCase();
  return imageMimeByExtension.get(extension) || "";
}

function getAttachmentMime(file) {
  if (allowedAttachmentTypes.has(file.mimetype)) {
    return file.mimetype;
  }

  const extension = path.extname(file.originalname || "").toLowerCase();
  return attachmentMimeByExtension.get(extension) || "";
}

function attachmentKindForMime(mime) {
  if (mime.startsWith("image/")) {
    return "image";
  }
  if (mime.startsWith("audio/")) {
    return "audio";
  }
  if (mime.startsWith("video/")) {
    return "video";
  }
  return "file";
}

async function optimizeImageFile(file, options = {}) {
  const mime = getImageMime(file);

  if (!mime || mime === "image/gif" || mime === "image/heic" || mime === "image/heif") {
    return file;
  }

  try {
    const maxSize = options.avatar ? 320 : 1600;
    let pipeline = sharp(file.buffer, { animated: false })
      .rotate()
      .resize({
        width: maxSize,
        height: maxSize,
        fit: "inside",
        withoutEnlargement: true
      });
    let outputMime = mime;

    if (mime === "image/jpeg") {
      pipeline = pipeline.jpeg({ quality: options.avatar ? 76 : 82, mozjpeg: true });
    } else if (mime === "image/png") {
      pipeline = pipeline.png({ compressionLevel: 9, effort: 8 });
    } else if (mime === "image/webp") {
      pipeline = pipeline.webp({ quality: options.avatar ? 76 : 82, effort: 4 });
    } else {
      return file;
    }

    const buffer = await pipeline.toBuffer();

    if (!buffer.length || buffer.length >= file.buffer.length) {
      return file;
    }

    return {
      ...file,
      buffer,
      mimetype: outputMime,
      size: buffer.length
    };
  } catch (error) {
    console.warn("Image optimization skipped.", error.message);
    return file;
  }
}

async function buildAttachmentPayload(file, options = {}) {
  if (!file) {
    return null;
  }

  const optimizedFile = getImageMime(file) ? await optimizeImageFile(file, options) : file;
  const mime = getAttachmentMime(optimizedFile) || "application/octet-stream";

  return {
    data: `data:${mime};base64,${optimizedFile.buffer.toString("base64")}`,
    mime,
    name: cleanFileName(optimizedFile.originalname),
    size: optimizedFile.size,
    kind: attachmentKindForMime(mime)
  };
}

function pickUploadedFile(req) {
  if (!req.files) {
    return null;
  }

  return (req.files.attachment && req.files.attachment[0]) || (req.files.image && req.files.image[0]) || null;
}

function handleMessageUpload(req, res, next) {
  upload.fields([
    { name: "attachment", maxCount: 1 },
    { name: "image", maxCount: 1 }
  ])(req, res, (error) => {
    if (!error) {
      return next();
    }

    noStore(res);

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Please keep attachments under 8 MB." });
    }

    return res.status(400).json({
      error: error.message || "The attachment could not be uploaded."
    });
  });
}

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: AVATAR_MAX_BYTES,
    files: 1
  },
  fileFilter: (req, file, callback) => {
    if (!getImageMime(file)) {
      return callback(new Error("Please choose a profile image."));
    }

    return callback(null, true);
  }
});

function handleAvatarUpload(req, res, next) {
  avatarUpload.single("avatar")(req, res, (error) => {
    if (!error) {
      return next();
    }

    noStore(res);

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Please keep the profile photo under 2 MB." });
    }

    return res.status(400).json({ error: error.message || "Profile photo upload failed." });
  });
}

function publicAccount(user) {
  const username = normalizeUsername(user.username);
  const anonymousMode = Boolean(user.anonymousMode || user.hideActiveStatus);
  const hasImage = Boolean(
    user.hasProfileImage || user.profileImageData || user.profileImageMime || user.profileImageName
  );

  return {
    username,
    displayName: user.displayName || user.username,
    role: user.role || "user",
    bio: user.bio || "",
    email: user.email || "",
    emailVerified: Boolean(user.emailVerified),
    profileImageMime: user.profileImageMime || "",
    profileImageName: user.profileImageName || "",
    hasProfileImage: hasImage,
    profileImageUrl: hasImage ? `/api/users/${encodeURIComponent(username)}/avatar` : "",
    anonymousMode,
    theme: user.theme || "vintage-dark",
    wallpaper: user.wallpaper || "paper",
    fontStyle: user.fontStyle || "serif",
    themeColor: user.themeColor || "rose",
    isActive: !anonymousMode && isUserActive(username)
  };
}

function publicRecipient(user) {
  const account = publicAccount(user);

  return {
    username: account.username,
    displayName: account.displayName,
    bio: account.bio,
    profileImageMime: account.profileImageMime,
    profileImageName: account.profileImageName,
    hasProfileImage: account.hasProfileImage,
    profileImageUrl: account.profileImageUrl,
    anonymousMode: account.anonymousMode,
    isActive: account.isActive
  };
}

function invalidateUserCache() {
  userListCache = {
    expiresAt: 0,
    users: null
  };
}

async function getCachedUsers() {
  const now = Date.now();

  if (userListCache.users && userListCache.expiresAt > now) {
    return userListCache.users;
  }

  const users = await listUsers({ limit: USER_LIST_LIMIT });
  userListCache = {
    expiresAt: now + USER_LIST_CACHE_MS,
    users
  };
  return users;
}

function sendDataUrlImage(res, avatar) {
  const match = String(avatar.data || "").match(/^data:([^;]+);base64,(.+)$/);

  if (!match) {
    return res.status(404).json({ error: "Profile image not found." });
  }

  res.set("Cache-Control", "private, max-age=300");
  res.type(avatar.mime || match[1] || "image/jpeg");
  return res.send(Buffer.from(match[2], "base64"));
}

function userRoom(username) {
  return `user:${normalizeUsername(username)}`;
}

async function emitPresenceUpdate() {
  try {
    const users = (await getCachedUsers()).map(publicRecipient);
    io.emit("presence:update", { users });
  } catch (error) {
    console.error("Could not emit presence update.", error);
  }
}

function schedulePresenceUpdate() {
  if (presenceUpdateTimer) {
    return;
  }

  presenceUpdateTimer = setTimeout(() => {
    presenceUpdateTimer = null;
    emitPresenceUpdate();
  }, 250);
}

function emitConversationUpdate(senderUsername, recipientUsername, message) {
  io.to(userRoom(senderUsername)).emit("chat:message", { message });
  io.to(userRoom(recipientUsername)).emit("chat:message", { message });
}

function emitLetterUpdate(recipientUsername, message) {
  io.to(userRoom(recipientUsername)).emit("chat:message", { message, letter: true });
}

function emitMessageMutation(message, eventName) {
  if (message.senderUsername) {
    io.to(userRoom(message.senderUsername)).emit(eventName, { message });
  }
  io.to(userRoom(message.recipientUsername)).emit(eventName, { message });
}

io.use((socket, next) => {
  const accountUser = socket.request.session && socket.request.session.accountUser;

  if (!accountUser || !accountUser.username) {
    return next(new Error("unauthorized"));
  }

  socket.accountUser = publicAccount(accountUser);
  return next();
});

io.on("connection", (socket) => {
  const account = socket.accountUser;
  socket.join(userRoom(account.username));
  updateSocketPresence(account, 1);
  schedulePresenceUpdate();

  socket.on("chat:typing", async ({ recipientUsername, typing }) => {
    try {
      const recipient = normalizeUsername(recipientUsername);

      if (!recipient || account.anonymousMode) {
        return;
      }

      io.to(userRoom(recipient)).emit("chat:typing", {
        from: account.username,
        displayName: account.displayName,
        typing: Boolean(typing)
      });
    } catch (error) {
      console.error("Typing event failed.", error);
    }
  });

  socket.on("disconnect", () => {
    updateSocketPresence(account, -1);
    schedulePresenceUpdate();
  });
});

app.get("/robots.txt", (req, res) => {
  res.type("text/plain").send("User-agent: *\nDisallow: /\n");
});

app.get("/", (req, res) => {
  noStore(res);
  res.redirect(302, SECRET_PATH);
});

app.get(SECRET_PATH, (req, res) => {
  if (req.session.secretUnlocked === true) {
    return sendView(res, "message.html");
  }

  return sendView(res, "password.html");
});

app.get("/admin", (req, res) => {
  sendView(res, "admin.html");
});

app.get("/profile", (req, res) => {
  sendView(res, "profile.html");
});

app.post("/api/login", loginLimiter, async (req, res, next) => {
  noStore(res);

  const { password, scope, username } = req.body || {};

  try {
    if (scope === "account" || scope === "admin") {
      const accountUsername = normalizeUsername(username || process.env.ADMIN_USERNAME || "admin");
      const user = await authenticateUser(accountUsername, password);

      if (!user) {
        return res.status(401).json({ error: "Username or password is wrong." });
      }

      const account = publicAccount(user);
      markUserActive(account);
      account.isActive = true;
      req.session.accountUser = account;
      return res.json({
        ok: true,
        user: req.session.accountUser,
        redirectTo: "/admin"
      });
    }

    if (scope === "secret") {
      if (!safeCompare(password, MESSAGE_PAGE_PASSWORD)) {
        return res.status(401).json({ error: "That password is not right yet." });
      }

      req.session.secretUnlocked = true;
      return res.json({ ok: true, redirectTo: SECRET_PATH });
    }

    return res.status(400).json({ error: "Unknown login scope." });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/message", requireMessageAccess, messageLimiter, handleMessageUpload, async (req, res, next) => {
  try {
    noStore(res);

    const accountUser = req.session.accountUser || null;
    const text = cleanMessage(req.body.message);
    const attachment = await buildAttachmentPayload(pickUploadedFile(req));
    const senderName = accountUser
      ? cleanSenderName(accountUser.displayName || accountUser.username)
      : cleanSenderName(req.body.senderName);
    const senderUsername = accountUser ? normalizeUsername(accountUser.username) : "";
    const recipientUsername = normalizeUsername(req.body.recipientUsername);
    const replyToId = /^[a-f0-9-]{36}$/i.test(String(req.body.replyToId || ""))
      ? String(req.body.replyToId)
      : null;
    const length = Array.from(text).length;

    if (!senderName) {
      return res.status(400).json({ error: "Please add your sender name." });
    }

    if (Array.from(senderName).length > 60) {
      return res.status(400).json({ error: "Please keep the sender name short." });
    }

    if (!text && !attachment) {
      return res.status(400).json({ error: "Write a message or add media before sending." });
    }

    if (length > 500) {
      return res.status(400).json({ error: "Please keep the note to 500 characters." });
    }

    const recipient = await findUser(recipientUsername);

    if (!recipient) {
      return res.status(400).json({ error: "Please choose a valid recipient." });
    }

    if (replyToId) {
      const replyTarget = await findAccessibleMessage(replyToId, accountUser ? accountUser.username : recipient.username);

      if (!replyTarget) {
        return res.status(400).json({ error: "The replied message is no longer available." });
      }
    }

    const message = await addMessage({
      text,
      senderName,
      senderUsername,
      recipientUsername: recipient.username,
      attachment,
      image: attachment && attachment.kind === "image" ? attachment : null,
      kind: attachment ? attachment.kind : "text",
      replyToId
    });

    if (senderUsername) {
      emitConversationUpdate(senderUsername, recipient.username, message);
    } else {
      emitLetterUpdate(recipient.username, message);
    }

    return res.status(201).json({
      ok: true,
      message: "Your message was sent.",
      item: message
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/recipients", requireMessageAccess, async (req, res, next) => {
  try {
    noStore(res);
    const recipients = (await getCachedUsers()).map(publicRecipient);
    return res.json({ recipients });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/users/:username/avatar", requireAccount, async (req, res, next) => {
  try {
    const avatar = await getUserAvatar(req.params.username);

    if (!avatar) {
      noStore(res);
      return res.status(404).json({ error: "Profile image not found." });
    }

    return sendDataUrlImage(res, avatar);
  } catch (error) {
    return next(error);
  }
});

app.get("/api/session", async (req, res, next) => {
  noStore(res);

  try {
    if (req.session.accountUser && req.session.accountUser.username) {
      await updateUserOnlineStatus(
        req.session.accountUser.username,
        true
      );
    }

    return res.json({
      user: req.session.accountUser ? publicAccount(req.session.accountUser) : null
    });
  } catch (error) {
    return next(error);
  }
});

async function saveAnonymousMode(req, res, next) {
  noStore(res);

  const anonymousMode = Boolean(
    req.body && (req.body.anonymousMode !== undefined ? req.body.anonymousMode : req.body.hideActiveStatus)
  );

  try {
    const updated = await updateUserSettings(req.session.accountUser.username, {
      ...req.session.accountUser,
      anonymousMode
    });

    if (!updated) {
      return res.status(404).json({ error: "Account was not found." });
    }

    req.session.accountUser = publicAccount(updated);
    markUserActive(req.session.accountUser);
    invalidateUserCache();
    schedulePresenceUpdate();

    return res.json({
      ok: true,
      user: publicAccount(req.session.accountUser)
    });
  } catch (error) {
    return next(error);
  }
}

app.patch("/api/settings/anonymous-mode", requireAccount, saveAnonymousMode);
app.patch("/api/settings/active-status", requireAccount, saveAnonymousMode);

app.patch("/api/account/profile", requireAccount, async (req, res, next) => {
  noStore(res);

  const rawUsername = String((req.body && req.body.username) || "").trim();
  const displayName = cleanDisplayName(rawUsername);
  const currentUsername = req.session.accountUser.username;

  if (!isValidAccountUsername(rawUsername)) {
    return res.status(400).json({
      error: "Username must be 3-32 characters using letters, numbers, dot, dash, or underscore."
    });
  }

  try {
    const updatedUser = await updateUserProfile(currentUsername, rawUsername, displayName);

    if (!updatedUser) {
      return res.status(409).json({ error: "That username is already taken." });
    }

    const fullUpdatedUser = (await findUser(updatedUser.username)) || updatedUser;
    const oldActiveRecord = activeUsers.get(normalizeUsername(currentUsername));
    activeUsers.delete(normalizeUsername(currentUsername));
    req.session.accountUser = {
      ...publicAccount({
        ...fullUpdatedUser,
        anonymousMode: req.session.accountUser.anonymousMode
      }),
      anonymousMode: Boolean(req.session.accountUser.anonymousMode)
    };

    if (oldActiveRecord) {
      activeUsers.set(req.session.accountUser.username, {
        ...oldActiveRecord,
        anonymousMode: req.session.accountUser.anonymousMode,
        lastActiveAt: Date.now()
      });
    } else {
      markUserActive(req.session.accountUser);
    }

    invalidateUserCache();
    schedulePresenceUpdate();

    return res.json({
      ok: true,
      user: publicAccount(req.session.accountUser)
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/profile", requireAccount, (req, res) => {
  noStore(res);
  return res.json({ user: publicAccount(req.session.accountUser) });
});

app.patch("/api/profile", requireAccount, async (req, res, next) => {
  noStore(res);

  try {
    const updated = await updateUserSettings(req.session.accountUser.username, {
      displayName: cleanDisplayName(req.body.displayName).slice(0, 60),
      bio: cleanText(req.body.bio).slice(0, 240),
      email: cleanText(req.body.email).slice(0, 160),
      anonymousMode: Boolean(req.body.anonymousMode),
      theme: cleanText(req.body.theme).slice(0, 40) || "vintage-dark",
      wallpaper: cleanText(req.body.wallpaper).slice(0, 40) || "paper",
      fontStyle: cleanText(req.body.fontStyle).slice(0, 40) || "serif",
      themeColor: cleanText(req.body.themeColor).slice(0, 40) || "rose"
    });

    if (!updated) {
      return res.status(404).json({ error: "Account was not found." });
    }

    req.session.accountUser = publicAccount(updated);
    markUserActive(req.session.accountUser);
    invalidateUserCache();
    schedulePresenceUpdate();
    return res.json({ ok: true, user: publicAccount(req.session.accountUser) });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/profile/avatar", requireAccount, handleAvatarUpload, async (req, res, next) => {
  noStore(res);

  try {
    const avatar = req.file ? await buildAttachmentPayload(req.file, { avatar: true }) : null;
    const updated = await updateUserAvatar(req.session.accountUser.username, avatar);

    if (!updated) {
      return res.status(404).json({ error: "Account was not found." });
    }

    req.session.accountUser = publicAccount(updated);
    invalidateUserCache();
    schedulePresenceUpdate();
    return res.json({ ok: true, user: publicAccount(req.session.accountUser) });
  } catch (error) {
    return next(error);
  }
});

app.patch("/api/account/password", requireAccount, async (req, res, next) => {
  noStore(res);

  const password = String((req.body && req.body.password) || "");

  if (password.length < 4 || password.length > 128) {
    return res.status(400).json({ error: "Password must be 4-128 characters." });
  }

  try {
    const updated = await updateUserPassword(req.session.accountUser.username, password);

    if (!updated) {
      return res.status(404).json({ error: "Account was not found." });
    }

    return res.json({ ok: true, message: "Password updated." });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/logout", async (req, res, next) => {
  const username = normalizeUsername(req.session.accountUser && req.session.accountUser.username);

  if (username) {
    activeUsers.delete(username);
  
    await pool.query(
      `
        UPDATE inbox_users
        SET is_online = false
        WHERE username = $1
      `,
      [username]
    );
  }
  req.session.destroy((error) => {
    if (error) {
      return next(error);
    }

    res.clearCookie("private_love_note.sid");
    noStore(res);
    return res.json({ ok: true });
  });
});

app.get("/api/chats", requireAccount, async (req, res, next) => {
  try {
    noStore(res);
    const [summaries, users] = await Promise.all([
      listChatSummaries(req.session.accountUser.username, { limit: 80 }),
      getCachedUsers()
    ]);
    const userMap = new Map(users.map((user) => [user.username, publicRecipient(user)]));
    const conversations = summaries.map((summary) => ({
      ...summary,
      peer:
        summary.peerUsername === "__letters__"
          ? {
              username: "__letters__",
              displayName: "Anonymous letters",
              bio: "Notes sent through your private page.",
              profileImageData: "",
              anonymousMode: true,
              isActive: false
            }
          : userMap.get(summary.peerUsername) || {
              username: summary.peerUsername,
              displayName: summary.peerUsername,
              isActive: false
            }
    }));

    return res.json({ conversations });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/chats/:peer/messages", requireAccount, async (req, res, next) => {
  try {
    noStore(res);
    const peer = normalizeUsername(req.params.peer);
    const query = String(req.query.q || "");
    const options = {
      query,
      limit: req.query.limit || MESSAGE_PAGE_LIMIT,
      before: req.query.before || ""
    };
    const messages =
      req.params.peer === "__letters__"
        ? await listLetterMessages(req.session.accountUser.username, options)
        : await listConversationMessages(req.session.accountUser.username, peer, options);

    return res.json({ messages });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/chats/:peer/read", requireAccount, async (req, res, next) => {
  try {
    noStore(res);

    if (req.session.accountUser.anonymousMode) {
      return res.json({ ok: true, hidden: true, ids: [] });
    }

    const includeLetters = req.params.peer === "__letters__";
    const peer = normalizeUsername(req.params.peer);
    const result = await markConversationRead(req.session.accountUser.username, peer, includeLetters);

    if (!includeLetters && result.ids.length) {
      io.to(userRoom(peer)).emit("chat:read", {
        by: req.session.accountUser.username,
        ids: result.ids,
        readAt: result.readAt
      });
    }

    return res.json({ ok: true, ...result });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/messages/starred", requireAccount, async (req, res, next) => {
  try {
    noStore(res);
    const messages = await listStarredMessages(req.session.accountUser.username, { limit: req.query.limit || 120 });
    return res.json({ messages });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/messages/:id/star", requireAccount, async (req, res, next) => {
  try {
    noStore(res);
    const message = await toggleMessageStar(req.params.id, req.session.accountUser.username);

    if (!message) {
      return res.status(404).json({ error: "Message not found." });
    }

    emitMessageMutation(message, "chat:starred");
    return res.json({ ok: true, message });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/messages/:id/reactions", requireAccount, async (req, res, next) => {
  try {
    noStore(res);
    const emoji = cleanText(req.body.emoji).slice(0, 16);

    if (!emoji) {
      return res.status(400).json({ error: "Choose a reaction first." });
    }

    const message = await toggleMessageReaction(req.params.id, req.session.accountUser.username, emoji);

    if (!message) {
      return res.status(404).json({ error: "Message not found." });
    }

    emitMessageMutation(message, "chat:reaction");
    return res.json({ ok: true, message });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/active-friends", requireAccount, async (req, res, next) => {
  try {
    noStore(res);
    const current = normalizeUsername(req.session.accountUser.username);
    const users = (await getCachedUsers())
      .map(publicRecipient)
      .filter((user) => user.username !== current && user.isActive);
    return res.json({ users });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/messages", requireAccount, async (req, res, next) => {
  try {
    noStore(res);
    const messages = await listMessagesForUser(req.session.accountUser.username, { limit: req.query.limit || 150 });
    return res.json({ messages });
  } catch (error) {
    return next(error);
  }
});

app.delete("/api/messages/:id", requireAccount, async (req, res, next) => {
  try {
    noStore(res);

    const { id } = req.params;

    if (!/^[a-f0-9-]{36}$/i.test(id)) {
      return res.status(400).json({ error: "Invalid message id." });
    }

    const deleted = await deleteMessage(id, req.session.accountUser.username);

    if (!deleted) {
      return res.status(404).json({ error: "Message not found." });
    }

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

app.use((req, res) => {
  noStore(res);
  res.status(404).send("Not found");
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  console.error(error);
  noStore(res);
  return res.status(500).json({ error: "Something went wrong." });
});

initStore()
  .then(() => {
    setInterval(() => {
      cleanupExpiredMessages().catch((error) => {
        console.error("Expired message cleanup failed.", error);
      });
    }, 60 * 60 * 1000);

    httpServer.listen(PORT, () => {
      console.log(`Private anonymous messaging site running on http://localhost:${PORT}`);
      console.log(`Secret page: http://localhost:${PORT}${SECRET_PATH}`);
      console.log(`Admin page: http://localhost:${PORT}/admin`);
    });
  })
  .catch((error) => {
    console.error("Could not initialize message storage.");
    console.error(error);
    process.exit(1);
  });
