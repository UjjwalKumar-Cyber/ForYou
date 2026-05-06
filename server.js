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
  deleteMessage,
  initStore,
  listMessages
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
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 8,
      sameSite: "strict",
      secure: isProduction
    }
  })
);

const sessionKey = (req) => req.sessionID || "anonymous-session";

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: sessionKey,
  message: {
    error: "Too many attempts. Please wait a bit before trying again."
  }
});

const messageLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: sessionKey,
  message: {
    error: "Please slow down before sending another note."
  }
});

app.use(
  express.static(path.join(__dirname, "public"), {
    etag: true,
    maxAge: isProduction ? "1h" : 0
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

function requireAdmin(req, res, next) {
  if (req.session.adminUnlocked === true) {
    return next();
  }

  noStore(res);
  return res.status(401).json({ error: "Admin password required." });
}

function cleanMessage(input) {
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

app.post("/api/login", loginLimiter, (req, res) => {
  noStore(res);

  const { password, scope } = req.body || {};

  if (scope === "admin") {
    if (!safeCompare(password, ADMIN_PASSWORD)) {
      return res.status(401).json({ error: "The admin password is wrong." });
    }

    req.session.adminUnlocked = true;
    return res.json({ ok: true, redirectTo: "/admin" });
  }

  if (scope === "secret") {
    if (!safeCompare(password, MESSAGE_PAGE_PASSWORD)) {
      return res.status(401).json({ error: "That password is not right yet." });
    }

    req.session.secretUnlocked = true;
    return res.json({ ok: true, redirectTo: SECRET_PATH });
  }

  return res.status(400).json({ error: "Unknown login scope." });
});

app.post("/api/message", requireSecretAccess, messageLimiter, async (req, res, next) => {
  try {
    noStore(res);

    const text = cleanMessage(req.body.message);
    const length = Array.from(text).length;

    if (!text) {
      return res.status(400).json({ error: "Please write a note before sending." });
    }

    if (length > 500) {
      return res.status(400).json({ error: "Please keep the note to 500 characters." });
    }

    await addMessage(text);

    return res.status(201).json({
      ok: true,
      message: "Your anonymous note was sent."
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/messages", requireAdmin, async (req, res, next) => {
  try {
    noStore(res);
    const messages = await listMessages();
    return res.json({ messages });
  } catch (error) {
    return next(error);
  }
});

app.delete("/api/messages/:id", requireAdmin, async (req, res, next) => {
  try {
    noStore(res);

    const { id } = req.params;

    if (!/^[a-f0-9-]{36}$/i.test(id)) {
      return res.status(400).json({ error: "Invalid message id." });
    }

    const deleted = await deleteMessage(id);

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
