require("dotenv").config();

const crypto = require("crypto");
const path = require("path");
const express = require("express");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const helmet = require("helmet");
const sanitizeHtml = require("sanitize-html");

const {
  addMessage,
  authenticateUser,
  deleteMessage,
  findUser,
  initStore,
  listMessagesForUser,
  listUsers,
  normalizeUsername
} = require("./src/storage/messages");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const SECRET_PATH = "/secret-8392-love-note";
const isProduction = process.env.NODE_ENV === "production";

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

const cspDirectives = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  connectSrc: ["'self'"],
  fontSrc: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  imgSrc: ["'self'", "data:"],
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

app.use(express.json({ limit: "12kb" }));
app.use(express.urlencoded({ extended: false, limit: "12kb" }));

app.use(
  session({
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
  })
);

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
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: sessionKey,
  message: {
    error: "Too many notes were sent from this browser. Please wait a few minutes."
  }
});

app.use(
  express.static(path.join(__dirname, "public"), {
    etag: true,
    maxAge: 0
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

function publicAccount(user) {
  return {
    username: user.username,
    displayName: user.displayName || user.username
  };
}

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

      req.session.accountUser = publicAccount(user);
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

app.post("/api/message", requireMessageAccess, messageLimiter, async (req, res, next) => {
  try {
    noStore(res);

    const accountUser = req.session.accountUser || null;
    const text = cleanMessage(req.body.message);
    const senderName = accountUser
      ? cleanSenderName(accountUser.displayName || accountUser.username)
      : cleanSenderName(req.body.senderName);
    const recipientUsername = normalizeUsername(req.body.recipientUsername);
    const length = Array.from(text).length;

    if (!senderName) {
      return res.status(400).json({ error: "Please add your sender name." });
    }

    if (Array.from(senderName).length > 60) {
      return res.status(400).json({ error: "Please keep the sender name short." });
    }

    if (!text) {
      return res.status(400).json({ error: "Please write a note before sending." });
    }

    if (length > 500) {
      return res.status(400).json({ error: "Please keep the note to 500 characters." });
    }

    const recipient = await findUser(recipientUsername);

    if (!recipient) {
      return res.status(400).json({ error: "Please choose a valid recipient." });
    }

    await addMessage({
      text,
      senderName,
      recipientUsername: recipient.username
    });

    return res.status(201).json({
      ok: true,
      message: "Your message was sent."
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/recipients", requireMessageAccess, async (req, res, next) => {
  try {
    noStore(res);
    const recipients = await listUsers();
    return res.json({ recipients });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/session", (req, res) => {
  noStore(res);
  return res.json({
    user: req.session.accountUser || null
  });
});

app.post("/api/logout", (req, res, next) => {
  req.session.destroy((error) => {
    if (error) {
      return next(error);
    }

    res.clearCookie("private_love_note.sid");
    noStore(res);
    return res.json({ ok: true });
  });
});

app.get("/api/messages", requireAccount, async (req, res, next) => {
  try {
    noStore(res);
    const messages = await listMessagesForUser(req.session.accountUser.username);
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
    app.listen(PORT, () => {
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
