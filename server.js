require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs/promises");
const http = require("http");
const os = require("os");
const path = require("path");
const compression = require("compression");
const express = require("express");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const helmet = require("helmet");
const multer = require("multer");
const sanitizeHtml = require("sanitize-html");
const sharp = require("sharp");
const { v2: cloudinary } = require("cloudinary");
const { Server } = require("socket.io");

const {
  addMessage,
  authenticateUser,
  cleanupExpiredNotifications,
  countActiveNotifications,
  cleanupAnalyticsLogs,
  cleanupExpiredMessages,
  cleanupStorageLogs,
  createBackupExport,
  createNotificationAlert,
  deleteMessage,
  deleteNotificationAlert,
  detectSuspiciousLogin,
  endUserSession,
  findNotificationAlert,
  findUser,
  findAccessibleMessage,
  getStorageSummary,
  getUltimateAdminMonitoring,
  getUserAvatar,
  heartbeatUserSession,
  initStore,
  isRestrictedSearchTerm,
  listNotificationHistory,
  listBackupHistory,
  listUserLoginHistory,
  listChatSummaries,
  listConversationMessages,
  listLetterMessages,
  listMessagesForUser,
  listNotificationsForUser,
  listStarredMessages,
  listUsers,
  logAdminAction,
  markConversationRead,
  markNotificationsRead,
  markStaleUsersOffline,
  normalizeUsername,
  recordBackupMetadata,
  recordLoginAttempt,
  startUserSession,
  subscribeNotificationAlerts,
  toggleMessageReaction,
  toggleMessageStar,
  updateUserSecurityStatus,
  updateUserAvatar,
  updateUserPassword,
  updateUserProfile,
  updateUserSearchVisibility,
  userHasConversation,
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
const SECRET_PAGE_ENABLED = process.env.ENABLE_SECRET_PAGE === "true";
const SERVICE_DISCONTINUED = process.env.SERVICE_DISCONTINUED === "true";
const isProduction = process.env.NODE_ENV === "production";
const ACTIVE_WINDOW_MS = 1000 * 60 * 2;
const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const USER_LIST_CACHE_MS = 5000;
const USER_LIST_LIMIT = 200;
const MESSAGE_PAGE_LIMIT = 50;
const CHAT_LIST_LIMIT = 50;
const ADMIN_ROOM = "ultimate-admins";
const APP_CACHE_VERSION = "20260516-backup5";
const WATCH_ROOM_TTL_MS = 1000 * 60 * 60 * 12;
const CLOUDINARY_ENABLED = Boolean(
  process.env.CLOUDINARY_URL ||
    (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET)
);
const BACKUP_DIR = process.env.BACKUP_DIR || (isProduction
  ? path.join(os.tmpdir(), "FORYOU_BACKUP")
  : "/Users/ujjwalkumar/Downloads/FORYOU_BACKUP");
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

if (CLOUDINARY_ENABLED && !process.env.CLOUDINARY_URL) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
}

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

const MESSAGE_PAGE_PASSWORD = SECRET_PAGE_ENABLED && !SERVICE_DISCONTINUED
  ? requiredSecret("MESSAGE_PAGE_PASSWORD", "open-the-secret-note")
  : "";
const ADMIN_PASSWORD = SERVICE_DISCONTINUED
  ? process.env.ADMIN_PASSWORD || ""
  : requiredSecret("ADMIN_PASSWORD", "admin-love-notes");
const SESSION_SECRET = SERVICE_DISCONTINUED
  ? process.env.SESSION_SECRET || "discontinued-service-session-secret"
  : requiredSecret("SESSION_SECRET", "local-development-session-secret-change-me");

process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;

const activeUsers = new Map();
const watchRooms = new Map();
let userListCache = {
  expiresAt: 0,
  users: null
};
let presenceUpdateTimer = null;
let adminMonitoringTimer = null;
const locationCache = new Map();

const cspDirectives = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  connectSrc: ["'self'"],
  fontSrc: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  imgSrc: ["'self'", "data:", "https:"],
  mediaSrc: ["'self'", "data:", "blob:", "https:"],
  objectSrc: ["'none'"],
  scriptSrc: ["'self'", "https://www.youtube.com", "https://s.ytimg.com"],
  styleSrc: ["'self'"],
  frameSrc: ["'self'", "https://www.youtube.com", "https://www.youtube-nocookie.com", "https://www.instagram.com"]
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

if (SERVICE_DISCONTINUED) {
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

  app.get(["/watch-together", "/watch/:room"], (req, res) => {
    res.set("Cache-Control", "no-store, private");
    res.sendFile(path.join(__dirname, "views", "watch-together.html"));
  });

  app.get("/robots.txt", (req, res) => {
    res.type("text/plain").send("User-agent: *\nDisallow: /\n");
  });

  app.use((req, res) => {
    res.set("Cache-Control", "no-store, private");

    if (req.method === "GET" || req.method === "HEAD") {
      return res.status(410).sendFile(path.join(__dirname, "views", "discontinued.html"));
    }

    return res.status(410).json({
      error: "ForyoU service has been discontinued."
    });
  });
}

const PgSession = !SERVICE_DISCONTINUED && process.env.DATABASE_URL
  ? require("connect-pg-simple")(session)
  : null;

const sessionStore = PgSession
  ? new PgSession({
      conString: process.env.DATABASE_URL,
      createTableIfMissing: true,
      tableName: "session",
      ttl: 365 * 24 * 60 * 60
    })
  : undefined;

const sessionMiddleware = SERVICE_DISCONTINUED
  ? null
  : session({
      name: "private_love_note.sid",
      store: sessionStore,
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

if (sessionMiddleware) {
  app.use(sessionMiddleware);
  io.engine.use(sessionMiddleware);

  app.use((req, res, next) => {
    markUserActive(req.session.accountUser);
    next();
  });
}

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

const analyticsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 90,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: sessionKey,
  message: {
    error: "Too many activity updates. Please wait a moment."
  }
});

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: sessionKey,
  message: {
    error: "Too many searches. Please wait a moment."
  }
});

const backupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 6,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: sessionKey,
  message: {
    error: "Too many backup requests. Please wait before trying again."
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
  if (SECRET_PAGE_ENABLED && req.session.secretUnlocked === true) {
    return next();
  }

  noStore(res);
  return res.status(404).json({ error: "The private note page is not available." });
}

async function endRestrictedSession(req, username) {
  activeUsers.delete(username);
  await endUserSession(username, req.sessionID);
  invalidateUserCache();
  schedulePresenceUpdate();
  scheduleAdminMonitoringUpdate();
  req.session.destroy(() => {});
}

async function requireAccount(req, res, next) {
  const username = normalizeUsername(req.session.accountUser && req.session.accountUser.username);

  if (!username) {
    noStore(res);
    return res.status(401).json({ error: "Please log in to your inbox." });
  }

  try {
    const user = await findUser(username);

    if (!user) {
      await endRestrictedSession(req, username);
      noStore(res);
      return res.status(401).json({ error: "Please log in to your inbox." });
    }

    if (isAccountBlocked(user)) {
      await endRestrictedSession(req, username);
      noStore(res);
      return res.status(403).json({ error: accountBlockedMessage(user) });
    }

    req.session.accountUser = publicAccount(user);
    markUserActive(req.session.accountUser);
    return next();
  } catch (error) {
    return next(error);
  }
}

async function requireUltimateAdmin(req, res, next) {
  return requireAccount(req, res, (error) => {
    if (error) {
      return next(error);
    }

    if (isUltimateAdmin(req.session.accountUser)) {
      return next();
    }

    noStore(res);
    return res.status(403).json({ error: "Ultimate admin access is required." });
  });
}

function requireMessageAccess(req, res, next) {
  if (req.session.accountUser && req.session.accountUser.username) {
    return requireAccount(req, res, next);
  }

  if (SECRET_PAGE_ENABLED && req.session.secretUnlocked === true) {
    return next();
  }

  noStore(res);
  return res.status(401).json({ error: "Please log in to send messages." });
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

function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.ip || req.socket.remoteAddress || "";
}

function isPrivateIp(ip) {
  const value = String(ip || "").replace(/^::ffff:/, "");
  return (
    !value ||
    value === "::1" ||
    value === "127.0.0.1" ||
    value.startsWith("10.") ||
    value.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(value)
  );
}

function parseUserAgent(userAgent = "") {
  const ua = String(userAgent || "");
  const lower = ua.toLowerCase();
  const isTablet = /ipad|tablet|android(?!.*mobile)/i.test(ua);
  const isPhone = /iphone|mobile|android.*mobile/i.test(ua);
  const deviceType = /iphone/i.test(ua)
    ? "iPhone"
    : /android/i.test(ua)
      ? isTablet
        ? "Tablet"
        : "Android"
      : isTablet
        ? "Tablet"
        : isPhone
          ? "Phone"
          : "Desktop";
  const operatingSystem = /android/i.test(ua)
    ? "Android"
    : /iphone|ipad|ipod/i.test(ua)
      ? "iOS"
      : /windows/i.test(ua)
        ? "Windows"
        : /mac os|macintosh/i.test(ua)
          ? "macOS"
          : /linux/i.test(ua)
            ? "Linux"
            : "Unknown";
  const browserMatch =
    ua.match(/Edg\/([\d.]+)/) ||
    ua.match(/Firefox\/([\d.]+)/) ||
    ua.match(/Chrome\/([\d.]+)/) ||
    ua.match(/Version\/([\d.]+).*Safari/);
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Unknown";

  return {
    deviceType,
    operatingSystem,
    browser,
    browserVersion: browserMatch ? browserMatch[1] : "",
    userAgent: ua || lower
  };
}

async function lookupApproximateLocation(ip) {
  const cleanIp = String(ip || "").replace(/^::ffff:/, "");

  if (isPrivateIp(cleanIp)) {
    return {};
  }

  const cached = locationCache.get(cleanIp);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    const response = await fetch(`https://ipapi.co/${encodeURIComponent(cleanIp)}/json/`, {
      signal: controller.signal,
      headers: { "User-Agent": "ForyoU security analytics" }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return {};
    }

    const data = await response.json();
    const value = {
      country: cleanText(data.country_name || data.country || "").slice(0, 80),
      state: cleanText(data.region || data.region_code || "").slice(0, 120),
      city: cleanText(data.city || "").slice(0, 120),
      locationTimezone: cleanText(data.timezone || "").slice(0, 120),
      isp: cleanText(data.org || "").slice(0, 180),
      vpnProxy: typeof data.proxy === "boolean" ? data.proxy : null
    };

    locationCache.set(cleanIp, {
      expiresAt: Date.now() + 6 * 60 * 60 * 1000,
      value
    });
    return value;
  } catch {
    return {};
  }
}

async function buildActivityContext(req, clientActivity = {}) {
  const ipAddress = getClientIp(req);
  const userAgent = req.headers["user-agent"] || "";
  const parsed = parseUserAgent(userAgent);
  const location = await lookupApproximateLocation(ipAddress);

  return {
    ipAddress,
    ...location,
    ...parsed,
    screenWidth: clientActivity.screenWidth,
    screenHeight: clientActivity.screenHeight,
    devicePixelRatio: clientActivity.devicePixelRatio,
    language: cleanText(clientActivity.language).slice(0, 80),
    clientTimezone: cleanText(clientActivity.timezone || clientActivity.clientTimezone).slice(0, 120),
    onlineState:
      clientActivity.onlineState === undefined && clientActivity.isOnline === undefined
        ? null
        : Boolean(clientActivity.onlineState !== undefined ? clientActivity.onlineState : clientActivity.isOnline)
  };
}

function isAccountBlocked(user) {
  if (!user) {
    return false;
  }

  if (user.accountStatus === "blocked") {
    return true;
  }

  if (user.accountStatus === "suspended") {
    const until = user.suspendedUntil ? new Date(user.suspendedUntil).getTime() : 0;
    return !until || until > Date.now();
  }

  return false;
}

function accountBlockedMessage(user) {
  if (user && user.accountStatus === "suspended") {
    return "Your account is temporarily suspended. Please contact admin.";
  }

  return "Your account is blocked. Please contact admin.";
}

function pruneActiveUsers(now = Date.now()) {
  for (const [username, record] of activeUsers.entries()) {
    if (!record || (!record.socketCount && now - record.lastActiveAt > ACTIVE_WINDOW_MS)) {
      activeUsers.delete(username);
    }
  }
}

function isUltimateAdmin(viewer) {
  const viewerUsername = normalizeUsername(viewer && viewer.username);
  const configuredAdminUsername = normalizeUsername(process.env.ADMIN_USERNAME || "admin");

  return Boolean(
    viewer &&
      (viewer.role === "ultimate_admin" ||
        (configuredAdminUsername && viewerUsername === configuredAdminUsername))
  );
}

function isUserActive(username, options = {}) {
  const now = Date.now();
  const normalizedUsername = normalizeUsername(username);
  const includeAnonymous = Boolean(options.includeAnonymous);
  pruneActiveUsers(now);

  if (!normalizedUsername) {
    return false;
  }

  const record = activeUsers.get(normalizedUsername);
  return Boolean(
    record &&
      (includeAnonymous || !record.anonymousMode) &&
      (record.socketCount > 0 || now - record.lastActiveAt <= ACTIVE_WINDOW_MS)
  );
}

function isUserActuallyActive(username, user = {}) {
  return Boolean(isUserActive(username, { includeAnonymous: true }) || user.isOnline || user.is_online);
}

function markUserActive(user) {
  const username = normalizeUsername(user && user.username);

  if (!username) {
    return;
  }

  const existing = activeUsers.get(username) || {};

  activeUsers.set(username, {
    username,
    role: user.role || "user",
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
    username,
    role: user.role || "user",
    anonymousMode: Boolean(user.anonymousMode || user.hideActiveStatus),
    lastActiveAt: Date.now(),
    socketCount: 0
  };
  const nextSocketCount = Math.max(0, Number(existing.socketCount || 0) + delta);

  if (!activeUsers.has(username) && delta < 0) {
    return;
  }

  activeUsers.set(username, {
    username,
    role: user.role || existing.role || "user",
    anonymousMode: Boolean(user.anonymousMode || user.hideActiveStatus),
    lastActiveAt: Date.now(),
    socketCount: nextSocketCount
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
  const storage = await uploadToObjectStorage(optimizedFile, mime, options);

  if (storage && storage.url) {
    return {
      data: "",
      url: storage.url,
      publicId: storage.publicId || "",
      resourceType: storage.resourceType || "",
      storage: "cloudinary",
      mime,
      name: cleanFileName(optimizedFile.originalname),
      size: optimizedFile.size,
      kind: attachmentKindForMime(mime)
    };
  }

  return {
    data: `data:${mime};base64,${optimizedFile.buffer.toString("base64")}`,
    url: "",
    publicId: "",
    resourceType: "",
    storage: "database",
    mime,
    name: cleanFileName(optimizedFile.originalname),
    size: optimizedFile.size,
    kind: attachmentKindForMime(mime)
  };
}

async function uploadToObjectStorage(file, mime, options = {}) {
  if (!CLOUDINARY_ENABLED || !file || !file.buffer || !file.buffer.length) {
    return null;
  }

  try {
    const folder = options.avatar ? "foryou/profile-pictures" : "foryou/message-media";
    const dataUri = `data:${mime};base64,${file.buffer.toString("base64")}`;
    const result = await cloudinary.uploader.upload(dataUri, {
      folder,
      resource_type: "auto",
      use_filename: false,
      unique_filename: true,
      overwrite: false
    });

    return {
      url: result.secure_url || result.url || "",
      publicId: result.public_id || "",
      resourceType: result.resource_type || attachmentKindForMime(mime),
      bytes: result.bytes || file.size || 0
    };
  } catch (error) {
    console.warn("Cloudinary upload skipped; falling back to database storage.", error.message);
    return null;
  }
}

function backupTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + `-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  const units = ["B", "KB", "MB", "GB"];
  let size = Number.isFinite(value) ? value : 0;
  let index = 0;

  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }

  return `${size.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

async function writeBackupJson(filePath, value) {
  const text = JSON.stringify(value, null, 2) + "\n";
  await fs.writeFile(filePath, text, "utf8");
  return Buffer.byteLength(text);
}

async function uploadBackupToCloudinary(filePath, fileName) {
  if (!CLOUDINARY_ENABLED) {
    return null;
  }

  const bytes = await fs.readFile(filePath);
  const dataUri = `data:application/json;base64,${bytes.toString("base64")}`;
  const result = await cloudinary.uploader.upload(dataUri, {
    folder: "foryou/backups",
    resource_type: "raw",
    public_id: fileName.replace(/\.json$/i, ""),
    overwrite: false
  });

  return {
    url: result.secure_url || result.url || "",
    publicId: result.public_id || "",
    bytes: result.bytes || bytes.length
  };
}

async function createAdminBackup(adminUsername) {
  const createdAt = new Date();
  const stamp = backupTimestamp(createdAt);
  const folderName = `foryou-backup-${stamp}`;
  const folderPath = path.join(BACKUP_DIR, folderName);
  const bundleName = `${folderName}.json`;
  const bundlePath = path.join(BACKUP_DIR, bundleName);
  const exportData = await createBackupExport({
    createdBy: adminUsername,
    appVersion: APP_CACHE_VERSION
  });
  const fileSizes = {};

  await fs.mkdir(folderPath, { recursive: true });

  const files = {
    "inbox_users.json": exportData.inboxUsers,
    "messages.json": exportData.messages,
    "notification_alerts.json": exportData.notificationAlerts,
    "login_history.json": exportData.loginHistory,
    "user_activity_sessions.json": exportData.userActivitySessions,
    "admin_action_logs.json": exportData.adminActionLogs,
    "important_audit_logs.json": exportData.importantAuditLogs,
    "restricted_search_terms.json": exportData.restrictedSearchTerms,
    "backup_history.json": exportData.backupHistory,
    "media_manifest.json": exportData.mediaManifest
  };

  for (const [fileName, value] of Object.entries(files)) {
    fileSizes[fileName] = await writeBackupJson(path.join(folderPath, fileName), value);
  }

  const manifest = {
    backupTimestamp: exportData.createdAt,
    createdBy: normalizeUsername(adminUsername),
    appVersion: APP_CACHE_VERSION,
    database: exportData.database,
    mediaStorageMode: CLOUDINARY_ENABLED ? "Cloudinary" : "Database",
    cloudinaryConfigured: CLOUDINARY_ENABLED,
    renderProduction: isProduction,
    rowCounts: exportData.rowCounts,
    fileSizes,
    warning: "Restore is manual/admin-only. This backup intentionally excludes environment secrets."
  };

  fileSizes["manifest.json"] = await writeBackupJson(path.join(folderPath, "manifest.json"), manifest);

  const bundle = {
    manifest,
    tables: files
  };
  const bundleSize = await writeBackupJson(bundlePath, bundle);
  let cloudinaryBackup = null;
  let storageMode = isProduction ? "temporary" : "local";

  if (CLOUDINARY_ENABLED) {
    cloudinaryBackup = await uploadBackupToCloudinary(bundlePath, bundleName);
    storageMode = "cloudinary";
  }

  const record = await recordBackupMetadata({
    id: crypto.randomUUID(),
    createdAt: exportData.createdAt,
    createdBy: adminUsername,
    status: "completed",
    storageMode,
    fileName: bundleName,
    filePath: isProduction && cloudinaryBackup ? "" : bundlePath,
    downloadUrl: cloudinaryBackup ? cloudinaryBackup.url : "",
    cloudinaryPublicId: cloudinaryBackup ? cloudinaryBackup.publicId : "",
    sizeBytes: cloudinaryBackup ? cloudinaryBackup.bytes : bundleSize,
    rowCounts: exportData.rowCounts,
    manifest
  });

  return {
    ok: true,
    backup: record,
    folderPath: isProduction ? "" : folderPath,
    filePath: isProduction && cloudinaryBackup ? "" : bundlePath,
    downloadUrl: cloudinaryBackup ? cloudinaryBackup.url : "",
    size: formatBytes(record.sizeBytes)
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
    user.hasProfileImage ||
      user.profileImageData ||
      user.profileImageUrl ||
      user.profileImageMime ||
      user.profileImageName
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
    isOnline: Boolean(user.isOnline || user.is_online),
    lastSeen: user.lastSeen || user.last_seen || null,
    loginTime: user.loginTime || user.login_time || null,
    logoutTime: user.logoutTime || user.logout_time || null,
    sessionDurationSeconds: Number(user.sessionDurationSeconds || user.session_duration_seconds || 0),
    accountStatus: user.accountStatus || user.account_status || "active",
    suspendedUntil: user.suspendedUntil || user.suspended_until || null,
    blockedReason: user.blockedReason || user.blocked_reason || "",
    searchHidden: Boolean(user.searchHidden || user.search_hidden),
    isActive: !anonymousMode && isUserActive(username)
  };
}


function publicRecipient(user, viewer = null) {
  const account = publicAccount(user);
  const realActive = isUserActuallyActive(account.username, user);

  return {
    username: account.username,
    displayName: account.displayName,
    bio: account.bio,
    profileImageMime: account.profileImageMime,
    profileImageName: account.profileImageName,
    hasProfileImage: account.hasProfileImage,
    profileImageUrl: account.profileImageUrl,
    anonymousMode: account.anonymousMode,
    searchHidden: isUltimateAdmin(viewer) ? account.searchHidden : false,
    isActive: isUltimateAdmin(viewer) ? realActive : false
  };
}

function publicSearchUser(user) {
  const account = publicRecipient(user, null);

  return {
    username: account.username,
    displayName: account.displayName,
    bio: account.bio,
    hasProfileImage: account.hasProfileImage,
    profileImageUrl: account.profileImageUrl
  };
}

function rememberAllowedChat(req, username) {
  const normalizedUsername = normalizeUsername(username);

  if (!normalizedUsername) {
    return;
  }

  const existing = Array.isArray(req.session.allowedChatUsers) ? req.session.allowedChatUsers : [];
  req.session.allowedChatUsers = Array.from(new Set([...existing, normalizedUsername])).slice(-50);
}

function hasAllowedChat(req, username) {
  const normalizedUsername = normalizeUsername(username);
  return (Array.isArray(req.session.allowedChatUsers) ? req.session.allowedChatUsers : []).includes(normalizedUsername);
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
  if (avatar.url) {
    res.set("Cache-Control", "private, max-age=300");
    return res.redirect(302, avatar.url);
  }

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

function watchRoom(roomId) {
  return `watch:${roomId}`;
}

function cleanWatchRoomId(input) {
  const value = String(input || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 48);

  return value.length >= 4 ? value : "";
}

function cleanWatchDisplayName(input) {
  return cleanDisplayName(input).slice(0, 28) || "Someone";
}

function extractWatchSource(input) {
  const raw = String(input || "").trim();

  if (!raw || raw.length > 400) {
    return null;
  }

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch (error) {
    return null;
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  const pathParts = url.pathname.split("/").filter(Boolean);

  if (hostname === "youtu.be") {
    const videoId = pathParts[0] || "";
    if (/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return {
        provider: "youtube",
        videoId,
        originalUrl: `https://youtu.be/${videoId}`
      };
    }
  }

  if (hostname === "youtube.com" || hostname === "m.youtube.com" || hostname === "music.youtube.com") {
    const videoId = url.searchParams.get("v") || (["shorts", "embed"].includes(pathParts[0]) ? pathParts[1] : "");
    if (/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return {
        provider: "youtube",
        videoId,
        originalUrl: `https://www.youtube.com/watch?v=${videoId}`
      };
    }
  }

  if (hostname === "instagram.com") {
    const type = ["reel", "p", "tv"].includes(pathParts[0]) ? pathParts[0] : "";
    const shortcode = pathParts[1] || "";
    if (type && /^[a-zA-Z0-9_-]+$/.test(shortcode)) {
      return {
        provider: "instagram",
        shortcode,
        embedUrl: `https://www.instagram.com/${type}/${shortcode}/embed`,
        originalUrl: `https://www.instagram.com/${type}/${shortcode}/`
      };
    }
  }

  return null;
}

function getWatchRoom(roomId) {
  const now = Date.now();
  const existing = watchRooms.get(roomId);

  if (existing) {
    existing.touchedAt = now;
    return existing;
  }

  const room = {
    roomId,
    source: null,
    currentTime: 0,
    isPlaying: false,
    updatedAt: now,
    updatedBy: "",
    touchedAt: now,
    viewers: new Map()
  };

  watchRooms.set(roomId, room);
  return room;
}

function publicWatchState(room) {
  return {
    roomId: room.roomId,
    source: room.source,
    currentTime: room.currentTime,
    isPlaying: room.isPlaying,
    updatedAt: room.updatedAt,
    updatedBy: room.updatedBy,
    viewers: Array.from(room.viewers.values()).map((viewer) => ({
      id: viewer.id,
      displayName: viewer.displayName
    }))
  };
}

function emitWatchPresence(room) {
  watchNamespace.to(watchRoom(room.roomId)).emit("watch:presence", {
    roomId: room.roomId,
    viewers: publicWatchState(room).viewers
  });
}

function cleanOldWatchRooms() {
  const now = Date.now();

  for (const [roomId, room] of watchRooms.entries()) {
    if (!room.viewers.size && now - room.touchedAt > WATCH_ROOM_TTL_MS) {
      watchRooms.delete(roomId);
    }
  }
}

const watchNamespace = io.of("/watch");

watchNamespace.on("connection", (socket) => {
  socket.on("watch:join", (payload = {}, callback) => {
    const roomId = cleanWatchRoomId(payload.roomId);

    if (!roomId) {
      if (typeof callback === "function") {
        callback({ ok: false, error: "Room link is not valid." });
      }
      return;
    }

    const displayName = cleanWatchDisplayName(payload.displayName);
    const room = getWatchRoom(roomId);

    socket.data.watchRoomId = roomId;
    socket.data.watchDisplayName = displayName;
    socket.join(watchRoom(roomId));

    room.viewers.set(socket.id, {
      id: socket.id,
      displayName,
      joinedAt: new Date().toISOString()
    });
    room.touchedAt = Date.now();

    if (typeof callback === "function") {
      callback({ ok: true, state: publicWatchState(room) });
    }

    emitWatchPresence(room);
  });

  socket.on("watch:load", (payload = {}, callback) => {
    const roomId = socket.data.watchRoomId;
    const room = roomId ? watchRooms.get(roomId) : null;

    if (!room) {
      if (typeof callback === "function") {
        callback({ ok: false, error: "Join a room first." });
      }
      return;
    }

    const source = extractWatchSource(payload.url);
    if (!source) {
      if (typeof callback === "function") {
        callback({ ok: false, error: "Paste a valid YouTube, YouTube Shorts, or Instagram Reel link." });
      }
      return;
    }

    room.source = source;
    room.currentTime = 0;
    room.isPlaying = false;
    room.updatedAt = Date.now();
    room.updatedBy = socket.data.watchDisplayName || "Someone";
    room.touchedAt = Date.now();

    const state = publicWatchState(room);
    watchNamespace.to(watchRoom(room.roomId)).emit("watch:state", { state, reason: "load" });

    if (typeof callback === "function") {
      callback({ ok: true, state });
    }
  });

  socket.on("watch:control", (payload = {}, callback) => {
    const roomId = socket.data.watchRoomId;
    const room = roomId ? watchRooms.get(roomId) : null;
    const action = String(payload.action || "").toLowerCase();

    if (!room || !room.source) {
      if (typeof callback === "function") {
        callback({ ok: false, error: "Load a video first." });
      }
      return;
    }

    if (room.source.provider !== "youtube") {
      if (typeof callback === "function") {
        callback({ ok: false, error: "Instagram Reels can be opened together, but browser sync is only available for YouTube." });
      }
      return;
    }

    if (!["play", "pause", "seek", "sync"].includes(action)) {
      if (typeof callback === "function") {
        callback({ ok: false, error: "Unknown watch action." });
      }
      return;
    }

    const currentTime = Math.max(0, Math.min(Number(payload.currentTime) || 0, 60 * 60 * 12));
    room.currentTime = currentTime;
    room.isPlaying = action === "play" ? true : action === "pause" ? false : Boolean(payload.isPlaying);
    room.updatedAt = Date.now();
    room.updatedBy = socket.data.watchDisplayName || "Someone";
    room.touchedAt = Date.now();

    const state = publicWatchState(room);
    socket.to(watchRoom(room.roomId)).emit("watch:state", { state, reason: action });

    if (typeof callback === "function") {
      callback({ ok: true, state });
    }
  });

  socket.on("watch:reaction", (payload = {}) => {
    const roomId = socket.data.watchRoomId;
    const room = roomId ? watchRooms.get(roomId) : null;
    const reaction = cleanText(payload.reaction).slice(0, 8) || "heart";

    if (!room) {
      return;
    }

    watchNamespace.to(watchRoom(room.roomId)).emit("watch:reaction", {
      reaction,
      displayName: socket.data.watchDisplayName || "Someone",
      createdAt: new Date().toISOString()
    });
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.watchRoomId;
    const room = roomId ? watchRooms.get(roomId) : null;

    if (!room) {
      return;
    }

    room.viewers.delete(socket.id);
    room.touchedAt = Date.now();
    emitWatchPresence(room);
  });
});

setInterval(cleanOldWatchRooms, 1000 * 60 * 30);

async function emitPresenceUpdate() {
  try {
    const users = await getCachedUsers();
    const publicUsers = users.map((user) => publicRecipient(user));
    io.emit("presence:update", { users: publicUsers });

    for (const [username, record] of activeUsers.entries()) {
      if (record.socketCount > 0 && isUltimateAdmin(record)) {
        io.to(userRoom(username)).emit("presence:update", {
          users: users.map((user) => publicRecipient(user, record))
        });
      }
    }
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

async function emitAdminMonitoringDirty() {
  io.to(ADMIN_ROOM).emit("admin:monitoring-dirty", {
    generatedAt: new Date().toISOString()
  });
}

function scheduleAdminMonitoringUpdate() {
  if (adminMonitoringTimer) {
    return;
  }

  adminMonitoringTimer = setTimeout(() => {
    adminMonitoringTimer = null;
    emitAdminMonitoringDirty().catch((error) => {
      console.error("Could not notify admin monitoring clients.", error);
    });
  }, 400);
}

function publicNotification(notification) {
  return {
    id: String(notification.id || ""),
    title: notification.title || "ForyoU notice",
    message: notification.message || "",
    type: notification.type || "info",
    createdAt: notification.createdAt || notification.created_at || new Date().toISOString(),
    expiresAt: notification.expiresAt || notification.expires_at || null,
    sentBy: notification.sentBy || notification.sent_by || ""
  };
}

function isNotificationDeliverable(notification) {
  if (!notification || notification.seen) {
    return false;
  }

  if (!notification.expiresAt) {
    return true;
  }

  return new Date(notification.expiresAt).getTime() > Date.now();
}

function emitNotificationAlert(notification) {
  if (!isNotificationDeliverable(notification)) {
    return;
  }

  io.to(userRoom(notification.recipientUsername)).emit("notification:alert", {
    notification: publicNotification(notification)
  });
  io.to(ADMIN_ROOM).emit("admin:monitoring-dirty", {
    generatedAt: new Date().toISOString()
  });
}

async function deliverPendingNotifications(username) {
  try {
    const notifications = await listNotificationsForUser(username, { limit: 20 });

    if (!notifications.length) {
      return;
    }

    io.to(userRoom(username)).emit("notification:batch", {
      notifications: notifications.map(publicNotification)
    });
  } catch (error) {
    console.error("Could not deliver pending notifications.", error);
  }
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

io.use(async (socket, next) => {
  const accountUser = socket.request.session && socket.request.session.accountUser;

  if (!accountUser || !accountUser.username) {
    return next(new Error("unauthorized"));
  }

  try {
    const user = await findUser(accountUser.username);

    if (!user || isAccountBlocked(user)) {
      return next(new Error("unauthorized"));
    }

    socket.request.session.accountUser = publicAccount(user);
    socket.accountUser = publicAccount(user);
    return next();
  } catch (error) {
    return next(error);
  }
});

io.on("connection", (socket) => {
  const account = socket.accountUser;
  socket.join(userRoom(account.username));

  if (isUltimateAdmin(account)) {
    socket.join(ADMIN_ROOM);
  }

  updateSocketPresence(account, 1);
  schedulePresenceUpdate();
  scheduleAdminMonitoringUpdate();
  deliverPendingNotifications(account.username);

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
    scheduleAdminMonitoringUpdate();
  });
});

app.get("/robots.txt", (req, res) => {
  res.type("text/plain").send("User-agent: *\nDisallow: /\n");
});

app.get("/", (req, res) => {
  noStore(res);
  res.redirect(302, "/admin");
});

app.get(SECRET_PATH, (req, res) => {
  if (!SECRET_PAGE_ENABLED) {
    noStore(res);
    return res.redirect(302, "/admin");
  }

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

app.get(["/watch-together", "/watch/:room"], (req, res) => {
  sendView(res, "watch-together.html");
});

app.post("/api/login", loginLimiter, async (req, res, next) => {
  noStore(res);

  const { password, scope, username } = req.body || {};

  try {
    if (scope === "account" || scope === "admin") {
      const accountUsername = normalizeUsername(username || process.env.ADMIN_USERNAME || "admin");
      const activityContext = await buildActivityContext(req, req.body && req.body.activity);
      const risk = await detectSuspiciousLogin(accountUsername, activityContext);
      const user = await authenticateUser(accountUsername, password);

      if (!user) {
        await recordLoginAttempt({
          username: accountUsername,
          success: false,
          reason: "bad_credentials",
          suspicious: risk.suspicious,
          suspiciousReason: risk.reason,
          sessionId: req.sessionID,
          context: activityContext
        });
        scheduleAdminMonitoringUpdate();
        return res.status(401).json({ error: "Username or password is wrong." });
      }

      if (isAccountBlocked(user)) {
        await recordLoginAttempt({
          username: accountUsername,
          success: false,
          reason: user.accountStatus === "suspended" ? "account_suspended" : "account_blocked",
          suspicious: risk.suspicious,
          suspiciousReason: risk.reason,
          sessionId: req.sessionID,
          context: activityContext
        });
        scheduleAdminMonitoringUpdate();
        return res.status(403).json({ error: accountBlockedMessage(user) });
      }

      const account = publicAccount(user);
      markUserActive(account);
      account.isActive = true;
      req.session.accountUser = account;
      await startUserSession(account.username, req.sessionID, activityContext);
      await recordLoginAttempt({
        username: account.username,
        success: true,
        reason: "",
        suspicious: risk.suspicious,
        suspiciousReason: risk.reason,
        sessionId: req.sessionID,
        context: activityContext
      });
      invalidateUserCache();
      schedulePresenceUpdate();
      scheduleAdminMonitoringUpdate();
      return res.json({
        ok: true,
        user: req.session.accountUser,
        redirectTo: "/admin"
      });
    }

    if (scope === "secret") {
      if (!SECRET_PAGE_ENABLED) {
        return res.status(404).json({ error: "The private note page is not available." });
      }

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

    if (accountUser && !isUltimateAdmin(accountUser)) {
      const existingConversation = await userHasConversation(senderUsername, recipient.username);
      const searchedThisSession = hasAllowedChat(req, recipient.username);
      const restrictedTarget =
        recipient.username === senderUsername ||
        recipient.role === "ultimate_admin" ||
        recipient.searchHidden ||
        isAccountBlocked(recipient);

      if (restrictedTarget && !existingConversation) {
        return res.status(403).json({ error: "NOT ALLOWED" });
      }

      if (!existingConversation && !searchedThisSession) {
        return res.status(403).json({ error: "Enter exact username before starting chat." });
      }
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
    const viewer = req.session.accountUser || null;
    const currentUsername = normalizeUsername(viewer && viewer.username);
    const users = await getCachedUsers();
    let visibleUsers = users;

    if (viewer && !isUltimateAdmin(viewer)) {
      const summaries = await listChatSummaries(currentUsername, { limit: CHAT_LIST_LIMIT });
      const existingPeers = new Set(
        summaries
          .map((summary) => normalizeUsername(summary.peerUsername))
          .filter((username) => username && username !== "__letters__")
      );
      visibleUsers = users.filter((user) => existingPeers.has(user.username));
    }

    const recipients = visibleUsers
      .filter((user) => user.username !== currentUsername)
      .map((user) => publicRecipient(user, viewer));
    return res.json({ recipients });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/users/search", requireAccount, searchLimiter, async (req, res, next) => {
  try {
    noStore(res);
    const viewer = req.session.accountUser;
    const rawUsername = cleanText(String(req.query.username || "")).slice(0, 64);
    const username = normalizeUsername(rawUsername);

    if (!username || rawUsername.trim().toLowerCase() !== username) {
      return res.json({ ok: false, error: "User not found" });
    }

    if (!isUltimateAdmin(viewer) && (await isRestrictedSearchTerm(username))) {
      return res.json({ ok: false, error: "NOT ALLOWED" });
    }

    const user = await findUser(username);

    if (!user) {
      return res.json({ ok: false, error: "User not found" });
    }

    const restricted =
      !isUltimateAdmin(viewer) &&
      (user.username === normalizeUsername(viewer.username) ||
        user.searchHidden ||
        user.role === "ultimate_admin" ||
        isAccountBlocked(user));

    if (restricted) {
      return res.json({ ok: false, error: "NOT ALLOWED" });
    }

    rememberAllowedChat(req, user.username);
    return res.json({
      ok: true,
      user: publicSearchUser(user)
    });
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
      const username = normalizeUsername(req.session.accountUser.username);
      const user = await findUser(username);

      if (!user || isAccountBlocked(user)) {
        await endRestrictedSession(req, username);
        return res.status(user ? 403 : 401).json({
          error: user ? accountBlockedMessage(user) : "Please log in to your inbox.",
          user: null
        });
      }

      req.session.accountUser = publicAccount(user);
      await heartbeatUserSession(req.session.accountUser.username, req.sessionID);
      markUserActive(req.session.accountUser);
    }

    return res.json({
      user: req.session.accountUser ? publicAccount(req.session.accountUser) : null
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/ping", requireAccount, analyticsLimiter, async (req, res, next) => {
  noStore(res);

  try {
    const username = req.session.accountUser.username;
    const user = await findUser(username);

    if (!user) {
      activeUsers.delete(username);
      await endUserSession(username, req.sessionID);
      invalidateUserCache();
      schedulePresenceUpdate();
      scheduleAdminMonitoringUpdate();
      req.session.destroy(() => {});
      return res.status(401).json({ error: "Please log in to your inbox." });
    }

    if (isAccountBlocked(user)) {
      activeUsers.delete(username);
      await endUserSession(username, req.sessionID);
      invalidateUserCache();
      schedulePresenceUpdate();
      scheduleAdminMonitoringUpdate();
      req.session.destroy(() => {});
      return res.status(403).json({ error: accountBlockedMessage(user) });
    }

    const context = await buildActivityContext(req, req.body && req.body.activity);
    await heartbeatUserSession(username, req.sessionID, context);
    req.session.accountUser = publicAccount({ ...user, anonymousMode: req.session.accountUser.anonymousMode });
    markUserActive(req.session.accountUser);
    invalidateUserCache();
    schedulePresenceUpdate();
    scheduleAdminMonitoringUpdate();
    return res.json({ ok: true, user: req.session.accountUser });
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
    scheduleAdminMonitoringUpdate();

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
    scheduleAdminMonitoringUpdate();

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
    scheduleAdminMonitoringUpdate();
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
    scheduleAdminMonitoringUpdate();
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
    await endUserSession(username, req.sessionID);
    invalidateUserCache();
    schedulePresenceUpdate();
    scheduleAdminMonitoringUpdate();
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
      listChatSummaries(req.session.accountUser.username, { limit: CHAT_LIST_LIMIT }),
      getCachedUsers()
    ]);
    const userMap = new Map(
      users.map((user) => [user.username, publicRecipient(user, req.session.accountUser)])
    );
    const conversations = summaries.map((summary) => ({
      ...summary,
      peer:
        summary.peerUsername === "__letters__"
          ? {
              username: "__letters__",
              displayName: "Anonymous letters",
              bio: "Private notes saved in your inbox.",
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

    if (!isUltimateAdmin(req.session.accountUser)) {
      return res.json({ users: [] });
    }

    const current = normalizeUsername(req.session.accountUser.username);
    const users = (await getCachedUsers())
      .filter((user) => user.role !== "ultimate_admin" || isUltimateAdmin(req.session.accountUser))
      .map((user) => publicRecipient(user, req.session.accountUser))
      .filter((user) => user.username !== current && user.isActive);
    return res.json({ users });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/notifications", requireAccount, async (req, res, next) => {
  try {
    noStore(res);
    const notifications = await listNotificationsForUser(req.session.accountUser.username, {
      limit: req.query.limit || 30
    });
    return res.json({ notifications: notifications.map(publicNotification) });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/notifications/read", requireAccount, analyticsLimiter, async (req, res, next) => {
  try {
    noStore(res);
    const rawIds = req.body && (req.body.ids || req.body.id);
    const ids = Array.isArray(rawIds) ? rawIds : rawIds ? [rawIds] : [];
    const result = await markNotificationsRead(req.session.accountUser.username, ids);
    scheduleAdminMonitoringUpdate();
    return res.json({ ok: true, ...result });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/admin/monitoring", requireUltimateAdmin, analyticsLimiter, async (req, res, next) => {
  try {
    noStore(res);
    const monitoring = await getUltimateAdminMonitoring({ limit: req.query.limit || 120 });
    return res.json({
      ...monitoring,
      notice:
        "This dashboard shows transparent security monitoring data for signed-in accounts. Anonymous Mode is still hidden from regular users."
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/admin/storage-summary", requireUltimateAdmin, analyticsLimiter, async (req, res, next) => {
  try {
    noStore(res);
    const [summary, backups] = await Promise.all([
      getStorageSummary(),
      listBackupHistory({ limit: 1 })
    ]);
    return res.json({
      ok: true,
      summary: {
        ...summary,
        mediaStorageMode: CLOUDINARY_ENABLED ? "Cloudinary" : "Database",
        latestBackup: backups[0] || null
      }
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/admin/backups", requireUltimateAdmin, analyticsLimiter, async (req, res, next) => {
  try {
    noStore(res);
    const backups = await listBackupHistory({ limit: req.query.limit || 20 });
    return res.json({ ok: true, backups });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/admin/backup", requireUltimateAdmin, backupLimiter, async (req, res, next) => {
  try {
    noStore(res);
    const result = await createAdminBackup(req.session.accountUser.username);

    await logAdminAction({
      adminUsername: req.session.accountUser.username,
      action: "create_backup",
      details: {
        backupId: result.backup.id,
        storageMode: result.backup.storageMode,
        sizeBytes: result.backup.sizeBytes
      },
      ipAddress: getClientIp(req)
    });

    scheduleAdminMonitoringUpdate();
    return res.status(201).json(result);
  } catch (error) {
    await recordBackupMetadata({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      createdBy: req.session.accountUser && req.session.accountUser.username,
      status: "failed",
      storageMode: CLOUDINARY_ENABLED ? "cloudinary" : "local",
      error: error.message || "Backup failed"
    }).catch(() => {});
    return next(error);
  }
});

app.post("/api/admin/cleanup-logs", requireUltimateAdmin, analyticsLimiter, async (req, res, next) => {
  try {
    noStore(res);

    if (!req.body || req.body.confirm !== true) {
      return res.status(400).json({
        error: "This deletes logs only. Messages, users, memories and media stay safe."
      });
    }

    const result = await cleanupStorageLogs();

    await logAdminAction({
      adminUsername: req.session.accountUser.username,
      action: "cleanup_old_logs",
      details: {
        totalRowsRemoved: result.totalRowsRemoved,
        totalSavedBytes: result.totalSavedBytes
      },
      ipAddress: getClientIp(req)
    });

    scheduleAdminMonitoringUpdate();
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

app.post("/api/admin/cleanup-storage", requireUltimateAdmin, analyticsLimiter, async (req, res, next) => {
  try {
    noStore(res);

    if (!req.body || req.body.confirm !== true) {
      return res.status(400).json({
        error: "This deletes logs only. Messages, users, memories and media stay safe."
      });
    }

    const result = await cleanupStorageLogs();
    scheduleAdminMonitoringUpdate();
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

app.get("/api/admin/notifications", requireUltimateAdmin, analyticsLimiter, async (req, res, next) => {
  try {
    noStore(res);
    const [notifications, activeCount] = await Promise.all([
      listNotificationHistory({ limit: req.query.limit || 80 }),
      countActiveNotifications()
    ]);

    return res.json({
      activeCount,
      notifications: notifications.map((notification) => ({
        ...publicNotification(notification),
        recipientUsername: notification.recipientUsername,
        seen: notification.seen
      }))
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/admin/notifications", requireUltimateAdmin, analyticsLimiter, async (req, res, next) => {
  try {
    noStore(res);

    const allowedTypes = new Set(["info", "warning", "success", "announcement"]);
    const title = cleanText(req.body && req.body.title).slice(0, 120);
    const message = cleanText(req.body && req.body.message).slice(0, 1000);
    const requestedType = String(req.body && req.body.type || "").trim().toLowerCase();
    const type = allowedTypes.has(requestedType)
      ? requestedType
      : "info";
    const broadcast = Boolean(req.body && req.body.broadcast);
    const recipientUsername = normalizeUsername(req.body && req.body.recipientUsername);
    const expiresAtValue = req.body && req.body.expiresAt ? new Date(req.body.expiresAt) : null;
    const expiresAt =
      expiresAtValue && !Number.isNaN(expiresAtValue.getTime()) ? expiresAtValue.toISOString() : null;

    if (!title || !message) {
      return res.status(400).json({ error: "Title and message are required." });
    }

    const recipients = broadcast
      ? (await getCachedUsers()).map((user) => user.username).filter(Boolean)
      : [recipientUsername].filter(Boolean);

    if (!recipients.length) {
      return res.status(400).json({ error: "Choose a recipient or broadcast." });
    }

    const notifications = [];

    for (const recipient of recipients) {
      const notification = await createNotificationAlert({
        recipientUsername: recipient,
        title,
        message,
        type,
        sentBy: req.session.accountUser.username,
        expiresAt
      });

      if (notification) {
        notifications.push(notification);
        emitNotificationAlert(notification);
      }
    }

    await logAdminAction({
      adminUsername: req.session.accountUser.username,
      action: broadcast ? "broadcast_popup" : "send_popup",
      targetUsername: broadcast ? "" : recipients[0],
      details: { title, type, count: notifications.length },
      ipAddress: getClientIp(req)
    });

    scheduleAdminMonitoringUpdate();
    return res.status(201).json({
      ok: true,
      count: notifications.length,
      notifications: notifications.map((notification) => ({
        ...publicNotification(notification),
        recipientUsername: notification.recipientUsername,
        seen: notification.seen
      }))
    });
  } catch (error) {
    return next(error);
  }
});

app.delete("/api/admin/notifications/:id", requireUltimateAdmin, analyticsLimiter, async (req, res, next) => {
  try {
    noStore(res);
    const deleted = await deleteNotificationAlert(req.params.id);

    if (!deleted) {
      return res.status(404).json({ error: "Popup notification not found." });
    }

    await logAdminAction({
      adminUsername: req.session.accountUser.username,
      action: "delete_popup",
      targetUsername: deleted.recipientUsername,
      details: { notificationId: deleted.id, title: deleted.title },
      ipAddress: getClientIp(req)
    });

    scheduleAdminMonitoringUpdate();
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/admin/users/:username/logins", requireUltimateAdmin, analyticsLimiter, async (req, res, next) => {
  try {
    noStore(res);
    const history = await listUserLoginHistory(req.params.username, { limit: req.query.limit || 80 });
    return res.json({ history });
  } catch (error) {
    return next(error);
  }
});

app.patch("/api/admin/users/:username/security", requireUltimateAdmin, analyticsLimiter, async (req, res, next) => {
  try {
    noStore(res);

    const targetUsername = normalizeUsername(req.params.username);
    const accountStatus = String(req.body && req.body.accountStatus || "active").trim();
    const suspendedUntil = req.body && req.body.suspendedUntil ? String(req.body.suspendedUntil) : "";
    const blockedReason = cleanText(req.body && req.body.blockedReason).slice(0, 240);

    if (!["active", "blocked", "suspended"].includes(accountStatus)) {
      return res.status(400).json({ error: "Choose active, blocked, or suspended." });
    }

    if (targetUsername === normalizeUsername(req.session.accountUser.username) && accountStatus !== "active") {
      return res.status(400).json({ error: "You cannot block or suspend your own admin account." });
    }

    const updated = await updateUserSecurityStatus(targetUsername, {
      accountStatus,
      suspendedUntil: accountStatus === "suspended" ? suspendedUntil : "",
      blockedReason,
      isShadowBanned: false
    });

    if (!updated) {
      return res.status(404).json({ error: "Account was not found." });
    }

    await logAdminAction({
      adminUsername: req.session.accountUser.username,
      action: `account_${accountStatus}`,
      targetUsername,
      details: { accountStatus, blockedReason, suspendedUntil: accountStatus === "suspended" ? suspendedUntil : "" },
      ipAddress: getClientIp(req)
    });

    if (accountStatus !== "active") {
      activeUsers.delete(targetUsername);
      await endUserSession(targetUsername, "");
      io.to(userRoom(targetUsername)).emit("account:security", {
        accountStatus,
        message: accountBlockedMessage(updated)
      });
    }

    invalidateUserCache();
    schedulePresenceUpdate();
    scheduleAdminMonitoringUpdate();
    return res.json({ ok: true, user: publicRecipient(updated, req.session.accountUser) });
  } catch (error) {
    return next(error);
  }
});

app.patch("/api/admin/users/:username/search-visibility", requireUltimateAdmin, analyticsLimiter, async (req, res, next) => {
  try {
    noStore(res);
    const targetUsername = normalizeUsername(req.params.username);
    const searchHidden = Boolean(req.body && req.body.searchHidden);

    const updated = await updateUserSearchVisibility(targetUsername, searchHidden);

    if (!updated) {
      return res.status(404).json({ error: "Account was not found." });
    }

    await logAdminAction({
      adminUsername: req.session.accountUser.username,
      action: searchHidden ? "hide_from_search" : "allow_search",
      targetUsername,
      details: { searchHidden },
      ipAddress: getClientIp(req)
    });

    invalidateUserCache();
    scheduleAdminMonitoringUpdate();
    return res.json({ ok: true, user: publicRecipient(updated, req.session.accountUser) });
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

    if (isUltimateAdmin(req.session.accountUser)) {
      await logAdminAction({
        adminUsername: req.session.accountUser.username,
        action: "delete_message",
        details: { messageId: id },
        ipAddress: getClientIp(req)
      });
      scheduleAdminMonitoringUpdate();
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

function startHttpServer() {
  httpServer.listen(PORT, () => {
    console.log(`ForyoU running on http://localhost:${PORT}`);

    if (SERVICE_DISCONTINUED) {
      console.log("Service discontinued mode is active; all routes show the archive notice.");
      return;
    }

    console.log(`Login page: http://localhost:${PORT}/admin`);
    if (SECRET_PAGE_ENABLED) {
      console.log(`Secret page: http://localhost:${PORT}${SECRET_PATH}`);
    } else {
      console.log(`Secret page disabled; ${SECRET_PATH} redirects to /admin`);
    }
  });
}

if (SERVICE_DISCONTINUED) {
  startHttpServer();
} else {
  initStore()
    .then(() => {
    subscribeNotificationAlerts(async ({ id }) => {
      const notification = await findNotificationAlert(id);
      if (notification) {
        emitNotificationAlert(notification);
        scheduleAdminMonitoringUpdate();
      }
    }).catch((error) => {
      console.error("Notification listener failed.", error);
    });

    setInterval(() => {
      cleanupExpiredMessages().catch((error) => {
        console.error("Expired message cleanup failed.", error);
      });
      cleanupAnalyticsLogs().catch((error) => {
        console.error("Analytics cleanup failed.", error);
      });
      cleanupExpiredNotifications().catch((error) => {
        console.error("Notification cleanup failed.", error);
      });
    }, 60 * 60 * 1000);

    setInterval(() => {
      markStaleUsersOffline()
        .then(() => {
          invalidateUserCache();
          schedulePresenceUpdate();
          scheduleAdminMonitoringUpdate();
        })
        .catch((error) => {
          console.error("Stale presence cleanup failed.", error);
        });
    }, 60 * 1000);

    startHttpServer();
    })
    .catch((error) => {
      console.error("Could not initialize message storage.");
      console.error(error);
      process.exit(1);
    });
}
