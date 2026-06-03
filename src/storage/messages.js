const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const { hashPassword, verifyPassword } = require("../security/passwords");

const dataDir = path.resolve(process.cwd(), process.env.DATA_DIR || "data");
const messagesFile = path.join(dataDir, "messages.json");
const usePostgres = Boolean(process.env.DATABASE_URL);
const builtInUsers = [
  {
    username: "kabir",
    displayName: "Kabir",
    passwordHash:
      "scrypt$16384$8$1$8ed6965f9107cd4770020fbf81f8f564$1b25e1724e62e0a60fdf902d5b68b5dcccc3b87fcfedc994f9f06b6bff7e4a90d89547e37b43c47e6ce95cac35c5c5d124b51d88d3f61231d0eef8059450dad6"
  },
  {
    username: "kaish",
    displayName: "Kaish",
    passwordHash:
      "scrypt$16384$8$1$fd06d823fa97f8ca2e2d55dcc79c662c$2df4ac42f565eba4b4ea46892a31ff6c148b56af4080236e90d19e4bc14568bf12ce3556a488f1159741376d0b9b73c388eca129fc9dd3b7d1362b9642703f7b"
  }
];

let writeQueue = Promise.resolve();
let pool;
let initPromise;

if (usePostgres) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 5000),
    maxUses: Number(process.env.PG_POOL_MAX_USES || 7500),
    ssl:
      process.env.PGSSLMODE === "disable" || !process.env.DATABASE_URL.includes("render.com")
        ? false
        : { rejectUnauthorized: false }
  });
}

function normalizeUsername(username) {
  return String(username || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "");
}

function clampLimit(value, fallback = 80, max = 200) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), max);
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

function hasProfileImage(user) {
  return Boolean(
    user.profileImageData ||
      user.profile_image_data ||
      user.profileImageUrl ||
      user.profile_image_url ||
      user.profileImageMime ||
      user.profile_image_mime ||
      user.profileImageName ||
      user.profile_image_name
  );
}

function parseSeedUsers() {
  const users = builtInUsers.map((user) => ({
    ...user,
    role: user.role || "user",
    seedType: "built-in"
  }));
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (adminPassword) {
    users.push({
      username: normalizeUsername(process.env.ADMIN_USERNAME || "admin"),
      displayName: String(process.env.ADMIN_DISPLAY_NAME || process.env.ADMIN_USERNAME || "Admin").trim(),
      password: adminPassword,
      role: "ultimate_admin",
      seedType: "admin"
    });
  }

  const accountUsers = process.env.ACCOUNT_USERS || "";

  for (const item of accountUsers.split(",")) {
    const [rawUsername, ...passwordParts] = item.split(":");
    const username = normalizeUsername(rawUsername);
    const displayName = String(rawUsername || "").trim();
    const password = passwordParts.join(":").trim();

    if (username && password) {
      users.push({
        username,
        displayName: displayName || username,
        password,
        role: "user",
        seedType: "configured"
      });
    }
  }

  return users.filter((user) => user.username && (user.password || user.passwordHash));
}

function normalizeImage(message) {
  const image = message.image || {};
  const data = image.data || message.imageData || message.image_data || null;
  const url = image.url || message.imageUrl || message.image_url || "";
  const publicId = image.publicId || message.imagePublicId || message.image_public_id || "";
  const resourceType = image.resourceType || message.imageResourceType || message.image_resource_type || "";
  const storage = image.storage || message.imageStorage || message.image_storage || (url ? "cloudinary" : "database");

  if (!data && !url) {
    return null;
  }

  const size = Number(image.size || message.imageSize || message.image_size || 0);

  return {
    data,
    url,
    publicId,
    resourceType,
    storage,
    mime: image.mime || message.imageMime || message.image_mime || "image/jpeg",
    name: image.name || message.imageName || message.image_name || "attached image",
    size: Number.isFinite(size) ? size : 0
  };
}

function parseJsonField(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeAttachment(message) {
  const attachment = message.attachment || {};
  const data =
    attachment.data ||
    message.attachmentData ||
    message.attachment_data ||
    message.imageData ||
    message.image_data ||
    null;
  const url = attachment.url || message.attachmentUrl || message.attachment_url || message.mediaUrl || message.media_url || message.imageUrl || message.image_url || "";
  const publicId =
    attachment.publicId ||
    message.attachmentPublicId ||
    message.attachment_public_id ||
    message.mediaPublicId ||
    message.media_public_id ||
    message.imagePublicId ||
    message.image_public_id ||
    "";
  const resourceType =
    attachment.resourceType ||
    message.attachmentResourceType ||
    message.attachment_resource_type ||
    message.mediaType ||
    message.media_type ||
    message.imageResourceType ||
    message.image_resource_type ||
    "";
  const storage =
    attachment.storage ||
    message.attachmentStorage ||
    message.attachment_storage ||
    message.imageStorage ||
    message.image_storage ||
    (url ? "cloudinary" : "database");

  if (!data && !url) {
    return null;
  }

  const size = Number(
    attachment.size ||
      message.attachmentSize ||
      message.attachment_size ||
      message.mediaSize ||
      message.media_size ||
      message.imageSize ||
      message.image_size ||
      0
  );

  return {
    data,
    url,
    publicId,
    resourceType,
    storage,
    mime:
      attachment.mime ||
      message.attachmentMime ||
      message.attachment_mime ||
      message.mediaMime ||
      message.media_mime ||
      message.imageMime ||
      message.image_mime ||
      "application/octet-stream",
    name:
      attachment.name ||
      message.attachmentName ||
      message.attachment_name ||
      message.originalName ||
      message.original_name ||
      message.imageName ||
      message.image_name ||
      "attachment",
    size: Number.isFinite(size) ? size : 0
  };
}

function normalizeMessage(message) {
  const reactions = parseJsonField(message.reactions, {});
  const starredBy = parseJsonField(message.starredBy || message.starred_by, []);
  const attachment = normalizeAttachment(message);

  return {
    id: message.id,
    text: String(message.text || ""),
    senderName: message.senderName || message.sender_name || "Anonymous",
    senderUsername: normalizeUsername(message.senderUsername || message.sender_username || ""),
    recipientUsername: normalizeUsername(
      message.recipientUsername || message.recipient_username || "admin"
    ),
    kind: message.kind || (attachment ? "attachment" : "text"),
    attachment,
    replyToId: message.replyToId || message.reply_to_id || null,
    reactions: reactions && typeof reactions === "object" ? reactions : {},
    starredBy: Array.isArray(starredBy) ? starredBy.map(normalizeUsername).filter(Boolean) : [],
    expiresAt: message.expiresAt || message.expires_at || null,
    readAt: message.readAt || message.read_at || null,
    createdAt: message.createdAt || message.created_at || new Date().toISOString(),
    image: normalizeImage(message)
  };
}

function normalizeUser(user) {
  return {
    username: normalizeUsername(user.username),
    displayName: user.displayName || user.display_name || user.username,
    role: user.role || "user",
    passwordHash: user.passwordHash || user.password_hash || "",
    bio: user.bio || "",
    email: user.email || "",
    emailVerified: Boolean(user.emailVerified || user.email_verified),
    profileImageData: user.profileImageData || user.profile_image_data || "",
    profileImageUrl: user.profileImageUrl || user.profile_image_url || "",
    profileImagePublicId: user.profileImagePublicId || user.profile_image_public_id || "",
    profileImageMime: user.profileImageMime || user.profile_image_mime || "",
    profileImageName: user.profileImageName || user.profile_image_name || "",
    hasProfileImage: Boolean(user.hasProfileImage || user.has_profile_image || hasProfileImage(user)),
    anonymousMode: Boolean(user.anonymousMode || user.anonymous_mode),
    theme: user.theme || "vintage-dark",
    wallpaper: user.wallpaper || "paper",
    fontStyle: user.fontStyle || user.font_style || "serif",
    themeColor: user.themeColor || user.theme_color || "rose",
    isOnline: Boolean(user.isOnline || user.is_online),
    lastSeen: user.lastSeen || user.last_seen || null,
    loginTime: user.loginTime || user.login_time || null,
    logoutTime: user.logoutTime || user.logout_time || null,
    currentSessionId: user.currentSessionId || user.current_session_id || "",
    sessionDurationSeconds: Number(user.sessionDurationSeconds || user.session_duration_seconds || 0),
    accountStatus: user.accountStatus || user.account_status || "active",
    isShadowBanned: Boolean(user.isShadowBanned || user.is_shadow_banned),
    suspendedUntil: user.suspendedUntil || user.suspended_until || null,
    blockedAt: user.blockedAt || user.blocked_at || null,
    blockedReason: user.blockedReason || user.blocked_reason || "",
    searchHidden: Boolean(user.searchHidden || user.search_hidden),
    passwordChangedAt: user.passwordChangedAt || user.password_changed_at || null,
    createdAt: user.createdAt || user.created_at || new Date().toISOString()
  };
}

function normalizeStore(rawStore) {
  if (Array.isArray(rawStore)) {
    return {
      users: [],
      messages: rawStore.map(normalizeMessage)
    };
  }

  return {
    users: Array.isArray(rawStore.users) ? rawStore.users.map(normalizeUser) : [],
    messages: Array.isArray(rawStore.messages) ? rawStore.messages.map(normalizeMessage) : [],
    activitySessions: Array.isArray(rawStore.activitySessions) ? rawStore.activitySessions : [],
    loginHistory: Array.isArray(rawStore.loginHistory) ? rawStore.loginHistory : [],
    adminActionLogs: Array.isArray(rawStore.adminActionLogs) ? rawStore.adminActionLogs : [],
    auditLogs: Array.isArray(rawStore.auditLogs) ? rawStore.auditLogs : [],
    restrictedSearchTerms: Array.isArray(rawStore.restrictedSearchTerms) ? rawStore.restrictedSearchTerms : [],
    backupHistory: Array.isArray(rawStore.backupHistory) ? rawStore.backupHistory.map(normalizeBackupRecord) : [],
    notificationAlerts: Array.isArray(rawStore.notificationAlerts)
      ? rawStore.notificationAlerts.map(normalizeNotification)
      : []
  };
}

function normalizeActivityContext(context = {}) {
  const numberOrNull = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  return {
    ipAddress: String(context.ipAddress || "").slice(0, 80),
    country: String(context.country || "").slice(0, 80),
    state: String(context.state || "").slice(0, 120),
    city: String(context.city || "").slice(0, 120),
    locationTimezone: String(context.locationTimezone || "").slice(0, 120),
    isp: String(context.isp || "").slice(0, 180),
    vpnProxy: context.vpnProxy === null || context.vpnProxy === undefined ? null : Boolean(context.vpnProxy),
    deviceType: String(context.deviceType || "").slice(0, 40),
    operatingSystem: String(context.operatingSystem || "").slice(0, 80),
    browser: String(context.browser || "").slice(0, 80),
    browserVersion: String(context.browserVersion || "").slice(0, 80),
    userAgent: String(context.userAgent || "").slice(0, 600),
    screenWidth: numberOrNull(context.screenWidth),
    screenHeight: numberOrNull(context.screenHeight),
    devicePixelRatio: numberOrNull(context.devicePixelRatio),
    language: String(context.language || "").slice(0, 80),
    clientTimezone: String(context.clientTimezone || "").slice(0, 120),
    onlineState: context.onlineState === null || context.onlineState === undefined ? null : Boolean(context.onlineState)
  };
}

function normalizeLoginRecord(row = {}) {
  return {
    id: row.id,
    username: normalizeUsername(row.username),
    success: Boolean(row.success),
    reason: row.reason || "",
    suspicious: Boolean(row.suspicious),
    suspiciousReason: row.suspiciousReason || row.suspicious_reason || "",
    sessionId: row.sessionId || row.session_id || "",
    ipAddress: row.ipAddress || row.ip_address || "",
    country: row.country || "",
    state: row.state || "",
    city: row.city || "",
    locationTimezone: row.locationTimezone || row.location_timezone || "",
    isp: row.isp || "",
    vpnProxy: row.vpnProxy === undefined ? row.vpn_proxy : row.vpnProxy,
    deviceType: row.deviceType || row.device_type || "",
    operatingSystem: row.operatingSystem || row.operating_system || "",
    browser: row.browser || "",
    browserVersion: row.browserVersion || row.browser_version || "",
    userAgent: row.userAgent || row.user_agent || "",
    createdAt: row.createdAt || row.created_at || new Date().toISOString()
  };
}

function normalizeSessionRecord(row = {}) {
  return {
    id: row.id,
    username: normalizeUsername(row.username),
    sessionId: row.sessionId || row.session_id || "",
    loginTime: row.loginTime || row.login_time || null,
    logoutTime: row.logoutTime || row.logout_time || null,
    lastSeen: row.lastSeen || row.last_seen || null,
    durationSeconds: Number(row.durationSeconds || row.duration_seconds || 0),
    isActive: Boolean(row.isActive || row.is_active),
    ipAddress: row.ipAddress || row.ip_address || "",
    country: row.country || "",
    state: row.state || "",
    city: row.city || "",
    locationTimezone: row.locationTimezone || row.location_timezone || "",
    isp: row.isp || "",
    vpnProxy: row.vpnProxy === undefined ? row.vpn_proxy : row.vpnProxy,
    deviceType: row.deviceType || row.device_type || "",
    operatingSystem: row.operatingSystem || row.operating_system || "",
    browser: row.browser || "",
    browserVersion: row.browserVersion || row.browser_version || "",
    userAgent: row.userAgent || row.user_agent || "",
    screenWidth: Number(row.screenWidth || row.screen_width || 0),
    screenHeight: Number(row.screenHeight || row.screen_height || 0),
    devicePixelRatio: Number(row.devicePixelRatio || row.device_pixel_ratio || 0),
    language: row.language || "",
    clientTimezone: row.clientTimezone || row.client_timezone || "",
    onlineState: row.onlineState === undefined ? row.online_state : row.onlineState,
    createdAt: row.createdAt || row.created_at || new Date().toISOString()
  };
}

function normalizeAdminAction(row = {}) {
  return {
    id: row.id,
    adminUsername: normalizeUsername(row.adminUsername || row.admin_username),
    action: row.action || "",
    targetUsername: normalizeUsername(row.targetUsername || row.target_username),
    details: parseJsonField(row.details, {}),
    ipAddress: row.ipAddress || row.ip_address || "",
    createdAt: row.createdAt || row.created_at || new Date().toISOString()
  };
}

function normalizeNotification(row = {}) {
  const allowedTypes = new Set(["info", "warning", "success", "announcement"]);
  const type = String(row.type || "info").trim().toLowerCase();

  return {
    id: String(row.id || crypto.randomUUID()),
    recipientUsername: normalizeUsername(row.recipientUsername || row.recipient_username),
    title: String(row.title || "ForyoU notice").slice(0, 120),
    message: String(row.message || "").slice(0, 1000),
    type: allowedTypes.has(type) ? type : "info",
    createdAt: row.createdAt || row.created_at || new Date().toISOString(),
    expiresAt: row.expiresAt || row.expires_at || null,
    seen: Boolean(row.seen),
    sentBy: normalizeUsername(row.sentBy || row.sent_by || "")
  };
}

function normalizeBackupRecord(row = {}) {
  return {
    id: String(row.id || crypto.randomUUID()),
    createdAt: row.createdAt || row.created_at || new Date().toISOString(),
    createdBy: normalizeUsername(row.createdBy || row.created_by || ""),
    status: row.status || "completed",
    storageMode: row.storageMode || row.storage_mode || "local",
    fileName: row.fileName || row.file_name || "",
    filePath: row.filePath || row.file_path || "",
    downloadUrl: row.downloadUrl || row.download_url || "",
    cloudinaryPublicId: row.cloudinaryPublicId || row.cloudinary_public_id || "",
    sizeBytes: Number(row.sizeBytes || row.size_bytes || 0),
    rowCounts: parseJsonField(row.rowCounts || row.row_counts, {}),
    manifest: parseJsonField(row.manifest, {}),
    error: row.error || ""
  };
}

async function setupPostgresStore() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inbox_users (
      username TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    ALTER TABLE inbox_users
    ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  `);

  await pool.query(`
    ALTER TABLE inbox_users
    ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS profile_image_data TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS profile_image_url TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS profile_image_public_id TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS profile_image_mime TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS profile_image_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS anonymous_mode BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'vintage-dark',
    ADD COLUMN IF NOT EXISTS wallpaper TEXT NOT NULL DEFAULT 'paper',
    ADD COLUMN IF NOT EXISTS font_style TEXT NOT NULL DEFAULT 'serif',
    ADD COLUMN IF NOT EXISTS theme_color TEXT NOT NULL DEFAULT 'rose',
    ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user',
    ADD COLUMN IF NOT EXISTS is_online BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS login_time TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS logout_time TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS current_session_id TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS session_duration_seconds INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS is_shadow_banned BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS blocked_reason TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS search_hidden BOOLEAN NOT NULL DEFAULT false
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY,
      text TEXT NOT NULL CHECK (char_length(text) <= 500),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS text TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  `);

  await pool.query(`
    ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS sender_name TEXT NOT NULL DEFAULT 'Anonymous'
  `);

  await pool.query(`
    ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS recipient_username TEXT NOT NULL DEFAULT 'admin'
  `);

  await pool.query(`
    ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS image_data TEXT,
    ADD COLUMN IF NOT EXISTS image_url TEXT,
    ADD COLUMN IF NOT EXISTS image_public_id TEXT,
    ADD COLUMN IF NOT EXISTS image_resource_type TEXT,
    ADD COLUMN IF NOT EXISTS image_storage TEXT,
    ADD COLUMN IF NOT EXISTS image_mime TEXT,
    ADD COLUMN IF NOT EXISTS image_name TEXT,
    ADD COLUMN IF NOT EXISTS image_size INTEGER
  `);

  await pool.query(`
    ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS sender_username TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'text',
    ADD COLUMN IF NOT EXISTS attachment_data TEXT,
    ADD COLUMN IF NOT EXISTS attachment_url TEXT,
    ADD COLUMN IF NOT EXISTS attachment_public_id TEXT,
    ADD COLUMN IF NOT EXISTS attachment_resource_type TEXT,
    ADD COLUMN IF NOT EXISTS attachment_storage TEXT,
    ADD COLUMN IF NOT EXISTS media_url TEXT,
    ADD COLUMN IF NOT EXISTS media_public_id TEXT,
    ADD COLUMN IF NOT EXISTS media_type TEXT,
    ADD COLUMN IF NOT EXISTS media_mime TEXT,
    ADD COLUMN IF NOT EXISTS media_size INTEGER,
    ADD COLUMN IF NOT EXISTS original_name TEXT,
    ADD COLUMN IF NOT EXISTS attachment_mime TEXT,
    ADD COLUMN IF NOT EXISTS attachment_name TEXT,
    ADD COLUMN IF NOT EXISTS attachment_size INTEGER,
    ADD COLUMN IF NOT EXISTS reply_to_id UUID,
    ADD COLUMN IF NOT EXISTS reactions TEXT NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS starred_by TEXT NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_activity_sessions (
      id UUID PRIMARY KEY,
      username TEXT NOT NULL,
      session_id TEXT NOT NULL,
      login_time TIMESTAMPTZ NOT NULL DEFAULT now(),
      logout_time TIMESTAMPTZ,
      last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true,
      ip_address TEXT,
      country TEXT,
      state TEXT,
      city TEXT,
      location_timezone TEXT,
      isp TEXT,
      vpn_proxy BOOLEAN,
      device_type TEXT,
      operating_system TEXT,
      browser TEXT,
      browser_version TEXT,
      user_agent TEXT,
      screen_width INTEGER,
      screen_height INTEGER,
      device_pixel_ratio NUMERIC,
      language TEXT,
      client_timezone TEXT,
      online_state BOOLEAN,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    ALTER TABLE user_activity_sessions
    ADD COLUMN IF NOT EXISTS username TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS session_id TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS login_time TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS logout_time TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS duration_seconds INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS ip_address TEXT,
    ADD COLUMN IF NOT EXISTS country TEXT,
    ADD COLUMN IF NOT EXISTS state TEXT,
    ADD COLUMN IF NOT EXISTS city TEXT,
    ADD COLUMN IF NOT EXISTS location_timezone TEXT,
    ADD COLUMN IF NOT EXISTS isp TEXT,
    ADD COLUMN IF NOT EXISTS vpn_proxy BOOLEAN,
    ADD COLUMN IF NOT EXISTS device_type TEXT,
    ADD COLUMN IF NOT EXISTS operating_system TEXT,
    ADD COLUMN IF NOT EXISTS browser TEXT,
    ADD COLUMN IF NOT EXISTS browser_version TEXT,
    ADD COLUMN IF NOT EXISTS user_agent TEXT,
    ADD COLUMN IF NOT EXISTS screen_width INTEGER,
    ADD COLUMN IF NOT EXISTS screen_height INTEGER,
    ADD COLUMN IF NOT EXISTS device_pixel_ratio NUMERIC,
    ADD COLUMN IF NOT EXISTS language TEXT,
    ADD COLUMN IF NOT EXISTS client_timezone TEXT,
    ADD COLUMN IF NOT EXISTS online_state BOOLEAN,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS login_history (
      id UUID PRIMARY KEY,
      username TEXT NOT NULL,
      success BOOLEAN NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      suspicious BOOLEAN NOT NULL DEFAULT false,
      suspicious_reason TEXT NOT NULL DEFAULT '',
      session_id TEXT NOT NULL DEFAULT '',
      ip_address TEXT,
      country TEXT,
      state TEXT,
      city TEXT,
      location_timezone TEXT,
      isp TEXT,
      vpn_proxy BOOLEAN,
      device_type TEXT,
      operating_system TEXT,
      browser TEXT,
      browser_version TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    ALTER TABLE login_history
    ADD COLUMN IF NOT EXISTS username TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS success BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS suspicious BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS suspicious_reason TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS session_id TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS ip_address TEXT,
    ADD COLUMN IF NOT EXISTS country TEXT,
    ADD COLUMN IF NOT EXISTS state TEXT,
    ADD COLUMN IF NOT EXISTS city TEXT,
    ADD COLUMN IF NOT EXISTS location_timezone TEXT,
    ADD COLUMN IF NOT EXISTS isp TEXT,
    ADD COLUMN IF NOT EXISTS vpn_proxy BOOLEAN,
    ADD COLUMN IF NOT EXISTS device_type TEXT,
    ADD COLUMN IF NOT EXISTS operating_system TEXT,
    ADD COLUMN IF NOT EXISTS browser TEXT,
    ADD COLUMN IF NOT EXISTS browser_version TEXT,
    ADD COLUMN IF NOT EXISTS user_agent TEXT,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_action_logs (
      id UUID PRIMARY KEY,
      admin_username TEXT NOT NULL,
      action TEXT NOT NULL,
      target_username TEXT NOT NULL DEFAULT '',
      details TEXT NOT NULL DEFAULT '{}',
      ip_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    ALTER TABLE admin_action_logs
    ADD COLUMN IF NOT EXISTS admin_username TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS target_username TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS details TEXT NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS ip_address TEXT,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      table_name TEXT NOT NULL,
      action TEXT NOT NULL,
      row_id TEXT,
      details TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS table_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS row_id TEXT,
    ADD COLUMN IF NOT EXISTS details TEXT,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_alerts (
      id TEXT PRIMARY KEY DEFAULT md5(random()::text || clock_timestamp()::text),
      recipient_username TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'info',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ,
      seen BOOLEAN NOT NULL DEFAULT false,
      sent_by TEXT NOT NULL DEFAULT ''
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS restricted_search_terms (
      id TEXT PRIMARY KEY DEFAULT md5(random()::text || clock_timestamp()::text),
      term TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by TEXT NOT NULL DEFAULT 'system'
    )
  `);

  await pool.query(`
    ALTER TABLE restricted_search_terms
    ADD COLUMN IF NOT EXISTS term TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system'
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS backup_history (
      id UUID PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'completed',
      storage_mode TEXT NOT NULL DEFAULT 'local',
      file_name TEXT NOT NULL DEFAULT '',
      file_path TEXT NOT NULL DEFAULT '',
      download_url TEXT NOT NULL DEFAULT '',
      cloudinary_public_id TEXT NOT NULL DEFAULT '',
      size_bytes BIGINT NOT NULL DEFAULT 0,
      row_counts TEXT NOT NULL DEFAULT '{}',
      manifest TEXT NOT NULL DEFAULT '{}',
      error TEXT NOT NULL DEFAULT ''
    )
  `);

  await pool.query(`
    ALTER TABLE backup_history
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed',
    ADD COLUMN IF NOT EXISTS storage_mode TEXT NOT NULL DEFAULT 'local',
    ADD COLUMN IF NOT EXISTS file_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS file_path TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS download_url TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS cloudinary_public_id TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS size_bytes BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS row_counts TEXT NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS manifest TEXT NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS error TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE notification_alerts
    ADD COLUMN IF NOT EXISTS recipient_username TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS message TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'info',
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS seen BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS sent_by TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    CREATE OR REPLACE FUNCTION notify_notification_alert_insert()
    RETURNS trigger AS $$
    BEGIN
      PERFORM pg_notify(
        'notification_alerts_inserted',
        json_build_object('id', NEW.id, 'recipient_username', NEW.recipient_username)::text
      );
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);

  await pool.query("DROP TRIGGER IF EXISTS notification_alerts_insert_notify ON notification_alerts");
  await pool.query(`
    CREATE TRIGGER notification_alerts_insert_notify
    AFTER INSERT ON notification_alerts
    FOR EACH ROW
    EXECUTE FUNCTION notify_notification_alert_insert()
  `);

  await pool.query("CREATE INDEX IF NOT EXISTS idx_inbox_users_username ON inbox_users (username)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_inbox_users_display_name ON inbox_users (display_name)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_inbox_users_role ON inbox_users (role)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_inbox_users_is_online ON inbox_users (is_online)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_inbox_users_online_last_seen ON inbox_users (is_online, last_seen DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_inbox_users_last_seen ON inbox_users (last_seen DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_inbox_users_account_status ON inbox_users (account_status)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_inbox_users_search_hidden ON inbox_users (search_hidden)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_messages_sender_username ON messages (sender_username)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_messages_recipient_username ON messages (recipient_username)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages (created_at DESC)");
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_messages_sender_recipient_created_at ON messages (sender_username, recipient_username, created_at DESC)"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_messages_recipient_sender_created_at ON messages (recipient_username, sender_username, created_at DESC)"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_messages_recipient_created_at ON messages (recipient_username, created_at DESC)"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_messages_expiry_unstarred ON messages (expires_at) WHERE expires_at IS NOT NULL AND starred_by = '[]'"
  );
  await pool.query("CREATE INDEX IF NOT EXISTS idx_user_activity_username ON user_activity_sessions (username)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_user_activity_session_id ON user_activity_sessions (session_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_user_activity_last_seen ON user_activity_sessions (last_seen DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_user_activity_active ON user_activity_sessions (is_active)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_login_history_username_created ON login_history (username, created_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_login_history_success_created ON login_history (success, created_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_login_history_suspicious ON login_history (suspicious, created_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_admin_action_logs_created ON admin_action_logs (created_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_audit_logs_table_created ON audit_logs (table_name, created_at DESC)");
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_notification_alerts_recipient_seen_created ON notification_alerts (LOWER(recipient_username), seen, created_at DESC)"
  );
  await pool.query("CREATE INDEX IF NOT EXISTS idx_notification_alerts_created ON notification_alerts (created_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_notification_alerts_expires ON notification_alerts (expires_at)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_restricted_search_terms_term ON restricted_search_terms (term)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_backup_history_created ON backup_history (created_at DESC)");

  await cleanupAnalyticsLogs();
  await seedRestrictedSearchTerms();
  await seedUsers();

  try {
    await pool.query("VACUUM ANALYZE inbox_users");
    await pool.query("VACUUM ANALYZE messages");
    await pool.query("VACUUM ANALYZE user_activity_sessions");
    await pool.query("VACUUM ANALYZE login_history");
    await pool.query("VACUUM ANALYZE admin_action_logs");
    await pool.query("VACUUM ANALYZE notification_alerts");
    await pool.query("VACUUM ANALYZE backup_history");
  } catch (error) {
    console.warn("Postgres VACUUM ANALYZE skipped.", error.message);
  }
}

async function setupJsonStore() {
  await fs.mkdir(dataDir, { recursive: true });

  try {
    await fs.access(messagesFile);
  } catch {
    await fs.writeFile(
      messagesFile,
      JSON.stringify({ users: [], messages: [] }, null, 2) + "\n",
      "utf8"
    );
  }

  const store = await readJsonStore(false);
  await writeJsonStore(store);
  await seedRestrictedSearchTerms();
  await seedUsers();
}

async function setupStore() {
  if (usePostgres) {
    await setupPostgresStore();
    return;
  }

  await setupJsonStore();
}

async function initStore() {
  if (!initPromise) {
    initPromise = setupStore().catch((error) => {
      initPromise = undefined;
      throw error;
    });
  }

  return initPromise;
}

async function readJsonStore(ensureInitialized = true) {
  if (ensureInitialized) {
    await initStore();
  }

  const raw = await fs.readFile(messagesFile, "utf8");
  const parsed = raw.trim() ? JSON.parse(raw) : { users: [], messages: [] };

  return normalizeStore(parsed);
}

async function writeJsonStore(store) {
  await fs.writeFile(messagesFile, JSON.stringify(normalizeStore(store), null, 2) + "\n", "utf8");
}

function queuedWrite(task) {
  const run = writeQueue.then(task, task);
  writeQueue = run.catch(() => {});
  return run;
}

async function seedUsers() {
  let seedUsersList = parseSeedUsers();

  if (!seedUsersList.length) {
    return;
  }

  if (usePostgres) {
    for (const user of seedUsersList) {
      const passwordHash = user.passwordHash || hashPassword(user.password);

      const conflictAction =
        user.seedType === "admin"
          ? "DO UPDATE SET display_name = EXCLUDED.display_name, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role"
          : `
              DO UPDATE SET display_name = EXCLUDED.display_name, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role
              WHERE inbox_users.password_changed_at IS NULL
            `;

      await pool.query(
        `
          INSERT INTO inbox_users (username, display_name, password_hash, role)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (username)
          ${conflictAction}
        `,
        [user.username, user.displayName, passwordHash, user.role || "user"]
      );
    }
    return;
  }

  await queuedWrite(async () => {
    const store = await readJsonStore(false);

    for (const user of seedUsersList) {
      const existingUser = store.users.find((item) => item.username === user.username);
      const nextUser = {
        username: user.username,
        displayName: user.displayName,
        role: user.role || "user",
        passwordHash: user.passwordHash || hashPassword(user.password),
        createdAt: new Date().toISOString()
      };

      if (
        existingUser &&
        (user.seedType === "admin" || (!existingUser.passwordChangedAt && user.seedType !== "admin"))
      ) {
        existingUser.displayName = nextUser.displayName;
        existingUser.role = nextUser.role;
        existingUser.passwordHash = nextUser.passwordHash;
      } else if (!existingUser) {
        store.users.push(nextUser);
      }
    }

    await writeJsonStore(store);
  });
}

async function seedRestrictedSearchTerms() {
  const terms = ["admin", "owner", "ultimate_admin", "support", "system"];

  if (usePostgres) {
    await pool.query(
      `
        INSERT INTO restricted_search_terms (term, created_by)
        SELECT LOWER(term), 'system'
        FROM UNNEST($1::text[]) AS term
        ON CONFLICT (term) DO NOTHING
      `,
      [terms]
    );
    return;
  }

  await queuedWrite(async () => {
    const store = await readJsonStore(false);
    const existing = new Set((store.restrictedSearchTerms || []).map((item) => String(item.term || "").toLowerCase()));
    store.restrictedSearchTerms = store.restrictedSearchTerms || [];

    for (const term of terms) {
      if (!existing.has(term)) {
        store.restrictedSearchTerms.push({
          id: crypto.randomUUID(),
          term,
          createdAt: new Date().toISOString(),
          createdBy: "system"
        });
      }
    }

    await writeJsonStore(store);
  });
}

async function listUsers(options = {}) {
  await initStore();
  const limit = clampLimit(options.limit, 200, 500);

  if (usePostgres) {
    const result = await pool.query(
      `
      SELECT
        username,
        display_name AS "displayName",
        role,
        bio,
        profile_image_url AS "profileImageUrl",
        profile_image_public_id AS "profileImagePublicId",
        profile_image_mime AS "profileImageMime",
        profile_image_name AS "profileImageName",
        (profile_image_mime <> '' OR profile_image_url <> '') AS "hasProfileImage",
        anonymous_mode AS "anonymousMode",
        is_online AS "isOnline",
        last_seen AS "lastSeen",
        login_time AS "loginTime",
        logout_time AS "logoutTime",
        current_session_id AS "currentSessionId",
        session_duration_seconds AS "sessionDurationSeconds",
        account_status AS "accountStatus",
        is_shadow_banned AS "isShadowBanned",
        suspended_until AS "suspendedUntil",
        blocked_at AS "blockedAt",
        blocked_reason AS "blockedReason",
        search_hidden AS "searchHidden",
        created_at AS "createdAt"
      FROM inbox_users
      ORDER BY display_name ASC, username ASC
      LIMIT $1
    `,
      [limit]
    );

    return result.rows.map(normalizeUser);
  }

  const store = await readJsonStore();

  return store.users
    .map(normalizeUser)
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .slice(0, limit);
}

async function findUser(username, options = {}) {
  const normalizedUsername = normalizeUsername(username);
  const includeProfileImageData = Boolean(options.includeProfileImageData);

  if (!normalizedUsername) {
    return null;
  }

  await initStore();

  if (usePostgres) {
    const profileImageDataSelect = includeProfileImageData
      ? `profile_image_data AS "profileImageData",`
      : "";
    const result = await pool.query(
      `
        SELECT
          username,
          display_name AS "displayName",
          role,
          password_hash AS "passwordHash",
          bio,
          email,
          email_verified AS "emailVerified",
          ${profileImageDataSelect}
          profile_image_url AS "profileImageUrl",
        profile_image_public_id AS "profileImagePublicId",
          profile_image_mime AS "profileImageMime",
          profile_image_name AS "profileImageName",
          (profile_image_mime <> '' OR profile_image_url <> '') AS "hasProfileImage",
          anonymous_mode AS "anonymousMode",
          theme,
          wallpaper,
          font_style AS "fontStyle",
          theme_color AS "themeColor",
          is_online AS "isOnline",
          last_seen AS "lastSeen",
          login_time AS "loginTime",
          logout_time AS "logoutTime",
          current_session_id AS "currentSessionId",
          session_duration_seconds AS "sessionDurationSeconds",
          account_status AS "accountStatus",
          is_shadow_banned AS "isShadowBanned",
          suspended_until AS "suspendedUntil",
          blocked_at AS "blockedAt",
          blocked_reason AS "blockedReason",
          search_hidden AS "searchHidden"
        FROM inbox_users
        WHERE username = $1
      `,
      [normalizedUsername]
    );

    return result.rows[0] ? normalizeUser(result.rows[0]) : null;
  }

  const store = await readJsonStore();
  const user = store.users.find((item) => item.username === normalizedUsername);

  if (!user) {
    return null;
  }

  const normalizedUser = normalizeUser(user);

  if (!includeProfileImageData) {
    normalizedUser.profileImageData = "";
  }

  return normalizedUser;
}

async function authenticateUser(username, password) {
  const user = await findUser(username);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return null;
  }

  return {
    username: user.username,
    displayName: user.displayName,
    bio: user.bio,
    role: user.role,
    email: user.email,
    emailVerified: user.emailVerified,
    profileImageUrl: user.profileImageUrl,
    profileImageMime: user.profileImageMime,
    profileImageName: user.profileImageName,
    hasProfileImage: user.hasProfileImage,
    anonymousMode: user.anonymousMode,
    theme: user.theme,
    wallpaper: user.wallpaper,
    fontStyle: user.fontStyle,
    themeColor: user.themeColor,
    isOnline: user.isOnline,
    lastSeen: user.lastSeen,
    loginTime: user.loginTime,
    logoutTime: user.logoutTime,
    currentSessionId: user.currentSessionId,
    sessionDurationSeconds: user.sessionDurationSeconds,
    accountStatus: user.accountStatus,
    isShadowBanned: user.isShadowBanned,
    suspendedUntil: user.suspendedUntil,
    blockedAt: user.blockedAt,
    blockedReason: user.blockedReason,
    searchHidden: user.searchHidden
  };
}

async function updateUserProfile(currentUsername, nextUsername, displayName) {
  const normalizedCurrentUsername = normalizeUsername(currentUsername);
  const normalizedNextUsername = normalizeUsername(nextUsername);
  const nextDisplayName = String(displayName || nextUsername || normalizedNextUsername).trim();

  if (!normalizedCurrentUsername || !normalizedNextUsername || !nextDisplayName) {
    return null;
  }

  if (usePostgres) {
    await initStore();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const existing = await client.query(
        "SELECT username FROM inbox_users WHERE username = $1 AND username <> $2",
        [normalizedNextUsername, normalizedCurrentUsername]
      );

      if (existing.rowCount > 0) {
        await client.query("ROLLBACK");
        return null;
      }

      const result = await client.query(
        `
          UPDATE inbox_users
          SET username = $1, display_name = $2
          WHERE username = $3
          RETURNING username, display_name AS "displayName"
        `,
        [normalizedNextUsername, nextDisplayName, normalizedCurrentUsername]
      );

      if (result.rowCount === 0) {
        await client.query("ROLLBACK");
        return null;
      }

      if (normalizedCurrentUsername !== normalizedNextUsername) {
        await client.query(
          "UPDATE messages SET recipient_username = $1 WHERE recipient_username = $2",
          [normalizedNextUsername, normalizedCurrentUsername]
        );
        await client.query(
          "UPDATE messages SET sender_username = $1 WHERE sender_username = $2",
          [normalizedNextUsername, normalizedCurrentUsername]
        );
      }

      await client.query("COMMIT");
      return result.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return queuedWrite(async () => {
    const store = await readJsonStore();
    const user = store.users.find((item) => item.username === normalizedCurrentUsername);

    if (!user) {
      return null;
    }

    const usernameTaken = store.users.some(
      (item) => item.username === normalizedNextUsername && item.username !== normalizedCurrentUsername
    );

    if (usernameTaken) {
      return null;
    }

    user.username = normalizedNextUsername;
    user.displayName = nextDisplayName;

    for (const message of store.messages) {
      if (message.recipientUsername === normalizedCurrentUsername) {
        message.recipientUsername = normalizedNextUsername;
      }
      if (message.senderUsername === normalizedCurrentUsername) {
        message.senderUsername = normalizedNextUsername;
      }
    }

    await writeJsonStore(store);
    return {
      username: user.username,
      displayName: user.displayName
    };
  });
}

async function updateUserPassword(username, password) {
  const normalizedUsername = normalizeUsername(username);
  const passwordHash = hashPassword(password);

  if (!normalizedUsername) {
    return false;
  }

  if (usePostgres) {
    await initStore();
    const result = await pool.query(
      "UPDATE inbox_users SET password_hash = $1, password_changed_at = now() WHERE username = $2",
      [passwordHash, normalizedUsername]
    );

    return result.rowCount > 0;
  }

  return queuedWrite(async () => {
    const store = await readJsonStore();
    const user = store.users.find((item) => item.username === normalizedUsername);

    if (!user) {
      return false;
    }

    user.passwordHash = passwordHash;
    user.passwordChangedAt = new Date().toISOString();
    await writeJsonStore(store);
    return true;
  });
}

async function updateUserSettings(username, settings = {}) {
  const normalizedUsername = normalizeUsername(username);
  const nextSettings = {
    displayName: String(settings.displayName || "").trim(),
    bio: String(settings.bio || "").trim(),
    email: String(settings.email || "").trim(),
    anonymousMode: Boolean(settings.anonymousMode),
    theme: String(settings.theme || "vintage-dark").trim(),
    wallpaper: String(settings.wallpaper || "paper").trim(),
    fontStyle: String(settings.fontStyle || "serif").trim(),
    themeColor: String(settings.themeColor || "rose").trim()
  };

  if (!normalizedUsername) {
    return null;
  }

  if (usePostgres) {
    await initStore();
    const result = await pool.query(
      `
        UPDATE inbox_users
        SET
          display_name = COALESCE(NULLIF($1, ''), display_name),
          bio = $2,
          email = $3,
          email_verified = CASE WHEN email = $3 THEN email_verified ELSE false END,
          anonymous_mode = $4,
          theme = $5,
          wallpaper = $6,
          font_style = $7,
          theme_color = $8
        WHERE username = $9
        RETURNING
          username,
          display_name AS "displayName",
          role,
          password_hash AS "passwordHash",
          bio,
          email,
          email_verified AS "emailVerified",
          profile_image_url AS "profileImageUrl",
        profile_image_public_id AS "profileImagePublicId",
          profile_image_mime AS "profileImageMime",
          profile_image_name AS "profileImageName",
          (profile_image_mime <> '' OR profile_image_url <> '') AS "hasProfileImage",
          anonymous_mode AS "anonymousMode",
          theme,
          wallpaper,
          font_style AS "fontStyle",
          theme_color AS "themeColor",
          is_online AS "isOnline",
          last_seen AS "lastSeen",
          login_time AS "loginTime",
          logout_time AS "logoutTime",
          current_session_id AS "currentSessionId",
          session_duration_seconds AS "sessionDurationSeconds",
          account_status AS "accountStatus",
          is_shadow_banned AS "isShadowBanned",
          suspended_until AS "suspendedUntil",
          blocked_at AS "blockedAt",
          blocked_reason AS "blockedReason",
          search_hidden AS "searchHidden"
      `,
      [
        nextSettings.displayName,
        nextSettings.bio,
        nextSettings.email,
        nextSettings.anonymousMode,
        nextSettings.theme,
        nextSettings.wallpaper,
        nextSettings.fontStyle,
        nextSettings.themeColor,
        normalizedUsername
      ]
    );

    return result.rows[0] ? normalizeUser(result.rows[0]) : null;
  }

  return queuedWrite(async () => {
    const store = await readJsonStore();
    const user = store.users.find((item) => item.username === normalizedUsername);

    if (!user) {
      return null;
    }

    if (nextSettings.displayName) {
      user.displayName = nextSettings.displayName;
    }
    user.bio = nextSettings.bio;
    user.emailVerified = user.email === nextSettings.email ? Boolean(user.emailVerified) : false;
    user.email = nextSettings.email;
    user.anonymousMode = nextSettings.anonymousMode;
    user.theme = nextSettings.theme;
    user.wallpaper = nextSettings.wallpaper;
    user.fontStyle = nextSettings.fontStyle;
    user.themeColor = nextSettings.themeColor;
    await writeJsonStore(store);
    return normalizeUser(user);
  });
}

async function updateUserAvatar(username, avatar = null) {
  const normalizedUsername = normalizeUsername(username);

  if (!normalizedUsername) {
    return null;
  }

  const image = avatar || { data: "", url: "", publicId: "", mime: "", name: "" };

  if (usePostgres) {
    await initStore();
    const result = await pool.query(
      `
        UPDATE inbox_users
        SET profile_image_data = $1,
            profile_image_url = $2,
            profile_image_public_id = $3,
            profile_image_mime = $4,
            profile_image_name = $5
        WHERE username = $6
        RETURNING
          username,
          display_name AS "displayName",
          role,
          password_hash AS "passwordHash",
          bio,
          email,
          email_verified AS "emailVerified",
          profile_image_url AS "profileImageUrl",
        profile_image_public_id AS "profileImagePublicId",
          profile_image_mime AS "profileImageMime",
          profile_image_name AS "profileImageName",
          (profile_image_mime <> '' OR profile_image_url <> '') AS "hasProfileImage",
          anonymous_mode AS "anonymousMode",
          theme,
          wallpaper,
          font_style AS "fontStyle",
          theme_color AS "themeColor",
          is_online AS "isOnline",
          last_seen AS "lastSeen",
          login_time AS "loginTime",
          logout_time AS "logoutTime",
          current_session_id AS "currentSessionId",
          session_duration_seconds AS "sessionDurationSeconds",
          account_status AS "accountStatus",
          is_shadow_banned AS "isShadowBanned",
          suspended_until AS "suspendedUntil",
          blocked_at AS "blockedAt",
          blocked_reason AS "blockedReason",
          search_hidden AS "searchHidden"
      `,
      [
        image.data || "",
        image.url || "",
        image.publicId || "",
        image.mime || "",
        image.name || "",
        normalizedUsername
      ]
    );

    return result.rows[0] ? normalizeUser(result.rows[0]) : null;
  }

  return queuedWrite(async () => {
    const store = await readJsonStore();
    const user = store.users.find((item) => item.username === normalizedUsername);

    if (!user) {
      return null;
    }

    user.profileImageData = image.data || "";
    user.profileImageUrl = image.url || "";
    user.profileImagePublicId = image.publicId || "";
    user.profileImageMime = image.mime || "";
    user.profileImageName = image.name || "";
    await writeJsonStore(store);
    return normalizeUser(user);
  });
}

async function getUserAvatar(username) {
  const normalizedUsername = normalizeUsername(username);

  if (!normalizedUsername) {
    return null;
  }

  await initStore();

  if (usePostgres) {
    const result = await pool.query(
      `
        SELECT
          profile_image_data AS "profileImageData",
          profile_image_url AS "profileImageUrl",
        profile_image_public_id AS "profileImagePublicId",
          profile_image_mime AS "profileImageMime",
          profile_image_name AS "profileImageName"
        FROM inbox_users
        WHERE username = $1
      `,
      [normalizedUsername]
    );

    const row = result.rows[0];

    if (!row || (!row.profileImageData && !row.profileImageUrl)) {
      return null;
    }

    return {
      data: row.profileImageData,
      url: row.profileImageUrl,
      publicId: row.profileImagePublicId,
      mime: row.profileImageMime || "image/jpeg",
      name: row.profileImageName || "avatar"
    };
  }

  const store = await readJsonStore();
  const rawUser = store.users.find((item) => item.username === normalizedUsername);

  if (!rawUser) {
    return null;
  }

  const user = normalizeUser(rawUser);

  if (!user || (!user.profileImageData && !user.profileImageUrl)) {
    return null;
  }

  return {
    data: user.profileImageData,
    url: user.profileImageUrl,
    mime: user.profileImageMime || "image/jpeg",
    name: user.profileImageName || "avatar"
  };
}

async function cleanupExpiredMessages() {
  const now = Date.now();

  if (usePostgres) {
    await initStore();
    await pool.query(
      `
        DELETE FROM messages
        WHERE expires_at IS NOT NULL
          AND expires_at <= now()
          AND starred_by = '[]'
      `
    );
    return;
  }

  await queuedWrite(async () => {
    const store = await readJsonStore(false);
    const nextMessages = store.messages.filter((message) => {
      if (!message.expiresAt || (message.starredBy && message.starredBy.length)) {
        return true;
      }

      return new Date(message.expiresAt).getTime() > now;
    });

    if (nextMessages.length !== store.messages.length) {
      store.messages = nextMessages;
      await writeJsonStore(store);
    }
  });
}

async function isRestrictedSearchTerm(term) {
  const normalizedTerm = normalizeUsername(term);

  if (!normalizedTerm) {
    return false;
  }

  await initStore();

  if (usePostgres) {
    const result = await pool.query(
      "SELECT 1 FROM restricted_search_terms WHERE term = $1 LIMIT 1",
      [normalizedTerm]
    );
    return result.rowCount > 0;
  }

  const store = await readJsonStore();
  return (store.restrictedSearchTerms || []).some(
    (item) => normalizeUsername(item.term) === normalizedTerm
  );
}

async function userHasConversation(username, peerUsername) {
  const owner = normalizeUsername(username);
  const peer = normalizeUsername(peerUsername);

  if (!owner || !peer) {
    return false;
  }

  await initStore();

  if (usePostgres) {
    const result = await pool.query(
      `
        SELECT 1
        FROM messages
        WHERE (sender_username = $1 AND recipient_username = $2)
           OR (sender_username = $2 AND recipient_username = $1)
        LIMIT 1
      `,
      [owner, peer]
    );
    return result.rowCount > 0;
  }

  const store = await readJsonStore();
  return store.messages.some(
    (message) =>
      (message.senderUsername === owner && message.recipientUsername === peer) ||
      (message.senderUsername === peer && message.recipientUsername === owner)
  );
}

function filterMessagesBySearch(messages, query) {
  const search = String(query || "").trim().toLowerCase();

  if (!search) {
    return messages;
  }

  return messages.filter((message) =>
    [message.text, message.senderName, message.attachment && message.attachment.name]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(search))
  );
}

async function listConversationMessages(username, peerUsername, query = "") {
  const owner = normalizeUsername(username);
  const peer = normalizeUsername(peerUsername);
  const options = typeof query === "object" && query !== null ? query : {};
  const searchQuery = typeof query === "object" && query !== null ? options.query || "" : query;
  const limit = clampLimit(options.limit, 50, 100);
  const before = options.before ? new Date(options.before) : null;
  await cleanupExpiredMessages();

  if (usePostgres) {
    await initStore();
    const values = [owner, peer];
    let searchSql = "";
    let beforeSql = "";

    if (String(searchQuery || "").trim()) {
      values.push(`%${String(searchQuery).trim().toLowerCase()}%`);
      searchSql = ` AND LOWER(COALESCE(text, '') || ' ' || COALESCE(sender_name, '') || ' ' || COALESCE(attachment_name, '')) LIKE $${values.length}`;
    }

    if (before && !Number.isNaN(before.getTime())) {
      values.push(before.toISOString());
      beforeSql = ` AND created_at < $${values.length}`;
    }

    values.push(limit);

    const result = await pool.query(
      `
        SELECT
          id,
          text,
          sender_name AS "senderName",
          sender_username AS "senderUsername",
          recipient_username AS "recipientUsername",
          kind,
          attachment_data AS "attachmentData",
          attachment_url AS "attachmentUrl",
          attachment_public_id AS "attachmentPublicId",
          attachment_resource_type AS "attachmentResourceType",
          attachment_storage AS "attachmentStorage",
          media_url AS "mediaUrl",
          media_public_id AS "mediaPublicId",
          media_type AS "mediaType",
          media_mime AS "mediaMime",
          media_size AS "mediaSize",
          original_name AS "originalName",
          attachment_mime AS "attachmentMime",
          attachment_name AS "attachmentName",
          attachment_size AS "attachmentSize",
          reply_to_id AS "replyToId",
          reactions,
          starred_by AS "starredBy",
          expires_at AS "expiresAt",
          read_at AS "readAt",
          image_data AS "imageData",
          image_url AS "imageUrl",
          image_public_id AS "imagePublicId",
          image_resource_type AS "imageResourceType",
          image_storage AS "imageStorage",
          image_mime AS "imageMime",
          image_name AS "imageName",
          image_size AS "imageSize",
          created_at AS "createdAt"
        FROM messages
        WHERE (
          (sender_username = $1 AND recipient_username = $2)
          OR (sender_username = $2 AND recipient_username = $1)
        )
        ${searchSql}
        ${beforeSql}
        ORDER BY created_at DESC
        LIMIT $${values.length}
      `,
      values
    );

    return result.rows.map(normalizeMessage).reverse();
  }

  const store = await readJsonStore();
  let messages = store.messages.filter((message) => {
    const matchesConversation =
      (message.senderUsername === owner && message.recipientUsername === peer) ||
      (message.senderUsername === peer && message.recipientUsername === owner);
    const matchesBefore = !before || Number.isNaN(before.getTime()) || new Date(message.createdAt) < before;
    return matchesConversation && matchesBefore;
  });

  return filterMessagesBySearch(messages, searchQuery)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit)
    .reverse();
}

async function listLetterMessages(username, query = "") {
  const owner = normalizeUsername(username);
  const options = typeof query === "object" && query !== null ? query : {};
  const searchQuery = typeof query === "object" && query !== null ? options.query || "" : query;
  const limit = clampLimit(options.limit, 50, 100);
  const before = options.before ? new Date(options.before) : null;
  await cleanupExpiredMessages();

  if (usePostgres) {
    await initStore();
    const values = [owner];
    let searchSql = "";
    let beforeSql = "";

    if (String(searchQuery || "").trim()) {
      values.push(`%${String(searchQuery).trim().toLowerCase()}%`);
      searchSql = ` AND LOWER(COALESCE(text, '') || ' ' || COALESCE(sender_name, '') || ' ' || COALESCE(attachment_name, '')) LIKE $${values.length}`;
    }

    if (before && !Number.isNaN(before.getTime())) {
      values.push(before.toISOString());
      beforeSql = ` AND created_at < $${values.length}`;
    }

    values.push(limit);

    const result = await pool.query(
      `
        SELECT
          id,
          text,
          sender_name AS "senderName",
          sender_username AS "senderUsername",
          recipient_username AS "recipientUsername",
          kind,
          attachment_data AS "attachmentData",
          attachment_url AS "attachmentUrl",
          attachment_public_id AS "attachmentPublicId",
          attachment_resource_type AS "attachmentResourceType",
          attachment_storage AS "attachmentStorage",
          media_url AS "mediaUrl",
          media_public_id AS "mediaPublicId",
          media_type AS "mediaType",
          media_mime AS "mediaMime",
          media_size AS "mediaSize",
          original_name AS "originalName",
          attachment_mime AS "attachmentMime",
          attachment_name AS "attachmentName",
          attachment_size AS "attachmentSize",
          reply_to_id AS "replyToId",
          reactions,
          starred_by AS "starredBy",
          expires_at AS "expiresAt",
          read_at AS "readAt",
          image_data AS "imageData",
          image_url AS "imageUrl",
          image_public_id AS "imagePublicId",
          image_resource_type AS "imageResourceType",
          image_storage AS "imageStorage",
          image_mime AS "imageMime",
          image_name AS "imageName",
          image_size AS "imageSize",
          created_at AS "createdAt"
        FROM messages
        WHERE recipient_username = $1 AND COALESCE(sender_username, '') = ''
        ${searchSql}
        ${beforeSql}
        ORDER BY created_at DESC
        LIMIT $${values.length}
      `,
      values
    );

    return result.rows.map(normalizeMessage).reverse();
  }

  const store = await readJsonStore();
  const messages = store.messages.filter((message) => {
    const matchesBefore = !before || Number.isNaN(before.getTime()) || new Date(message.createdAt) < before;
    return message.recipientUsername === owner && !message.senderUsername && matchesBefore;
  });

  return filterMessagesBySearch(messages, searchQuery)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit)
    .reverse();
}

async function listChatSummaries(username, options = {}) {
  const owner = normalizeUsername(username);
  const limit = clampLimit(options.limit, 50, 100);
  await cleanupExpiredMessages();

  const allMessages = usePostgres
    ? (
        await pool.query(
          `
            WITH visible_messages AS (
              SELECT
                id,
                text,
                sender_name,
                sender_username,
                recipient_username,
                kind,
                attachment_mime,
                attachment_name,
                attachment_size,
                reply_to_id,
                reactions,
                starred_by,
                expires_at,
                read_at,
                created_at,
                CASE
                  WHEN COALESCE(sender_username, '') = '' AND recipient_username = $1 THEN '__letters__'
                  WHEN sender_username = $1 THEN recipient_username
                  ELSE sender_username
                END AS peer_username
              FROM messages
              WHERE sender_username = $1 OR recipient_username = $1
            ),
            ranked_messages AS (
              SELECT
                id,
                text,
                sender_name,
                sender_username,
                recipient_username,
                kind,
                attachment_mime,
                attachment_name,
                attachment_size,
                reply_to_id,
                reactions,
                starred_by,
                expires_at,
                read_at,
                created_at,
                peer_username,
                row_number() OVER (PARTITION BY peer_username ORDER BY created_at DESC) AS row_number,
                count(*) FILTER (WHERE recipient_username = $1 AND read_at IS NULL) OVER (PARTITION BY peer_username) AS unread_count
              FROM visible_messages
              WHERE peer_username <> ''
            )
            SELECT
              id,
              text,
              sender_name AS "senderName",
              sender_username AS "senderUsername",
              recipient_username AS "recipientUsername",
              kind,
              attachment_mime AS "attachmentMime",
              attachment_name AS "attachmentName",
              attachment_size AS "attachmentSize",
              reply_to_id AS "replyToId",
              reactions,
              starred_by AS "starredBy",
              expires_at AS "expiresAt",
              read_at AS "readAt",
              created_at AS "createdAt",
              peer_username AS "peerUsername",
              unread_count AS "unreadCount"
            FROM ranked_messages
            WHERE row_number = 1
            ORDER BY created_at DESC
            LIMIT $2
          `,
          [owner, limit]
        )
      ).rows.map((row) => ({
        ...normalizeMessage(row),
        peerUsername: row.peerUsername,
        unreadCount: Number(row.unreadCount || 0)
      }))
    : (await readJsonStore()).messages
        .filter((message) => message.senderUsername === owner || message.recipientUsername === owner)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (usePostgres) {
    return allMessages.map((message) => ({
      peerUsername: message.peerUsername,
      lastMessage: message,
      unreadCount: Number(message.unreadCount || 0)
    }));
  }

  const summaries = new Map();

  for (const message of allMessages) {
    const isLetter = !message.senderUsername && message.recipientUsername === owner;
    const peerUsername = isLetter
      ? "__letters__"
      : message.senderUsername === owner
        ? message.recipientUsername
        : message.senderUsername;

    if (!peerUsername) {
      continue;
    }

    if (!summaries.has(peerUsername)) {
      summaries.set(peerUsername, {
        peerUsername,
        lastMessage: message,
        unreadCount: 0
      });
    }

    if (message.recipientUsername === owner && !message.readAt) {
      summaries.get(peerUsername).unreadCount += 1;
    }
  }

  return Array.from(summaries.values()).slice(0, limit);
}

async function listMessagesForUser(username, options = {}) {
  const recipientUsername = normalizeUsername(username);
  const limit = clampLimit(options.limit, 100, 300);

  if (usePostgres) {
    await initStore();
    await cleanupExpiredMessages();
    const result = await pool.query(
      `
        SELECT
          id,
          text,
          sender_name AS "senderName",
          sender_username AS "senderUsername",
          recipient_username AS "recipientUsername",
          kind,
          attachment_data AS "attachmentData",
          attachment_url AS "attachmentUrl",
          attachment_public_id AS "attachmentPublicId",
          attachment_resource_type AS "attachmentResourceType",
          attachment_storage AS "attachmentStorage",
          media_url AS "mediaUrl",
          media_public_id AS "mediaPublicId",
          media_type AS "mediaType",
          media_mime AS "mediaMime",
          media_size AS "mediaSize",
          original_name AS "originalName",
          attachment_mime AS "attachmentMime",
          attachment_name AS "attachmentName",
          attachment_size AS "attachmentSize",
          reply_to_id AS "replyToId",
          reactions,
          starred_by AS "starredBy",
          expires_at AS "expiresAt",
          read_at AS "readAt",
          image_data AS "imageData",
          image_url AS "imageUrl",
          image_public_id AS "imagePublicId",
          image_resource_type AS "imageResourceType",
          image_storage AS "imageStorage",
          image_mime AS "imageMime",
          image_name AS "imageName",
          image_size AS "imageSize",
          created_at AS "createdAt"
        FROM messages
        WHERE recipient_username = $1
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [recipientUsername, limit]
    );

    return result.rows.map(normalizeMessage);
  }

  const store = await readJsonStore();
  await cleanupExpiredMessages();

  return store.messages
    .filter((message) => message.recipientUsername === recipientUsername)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

async function addMessage({
  text,
  senderName,
  senderUsername = "",
  recipientUsername,
  image = null,
  attachment = null,
  kind = "text",
  replyToId = null,
  expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
}) {
  const message = {
    id: crypto.randomUUID(),
    text: String(text || ""),
    senderName,
    senderUsername: normalizeUsername(senderUsername),
    recipientUsername: normalizeUsername(recipientUsername),
    kind,
    attachment: attachment || image,
    replyToId,
    reactions: {},
    starredBy: [],
    expiresAt,
    readAt: null,
    createdAt: new Date().toISOString(),
    image
  };

  if (usePostgres) {
    await initStore();
    await pool.query(
      `
        INSERT INTO messages (
          id,
          text,
          sender_name,
          sender_username,
          recipient_username,
          kind,
          attachment_data,
          attachment_url,
          attachment_public_id,
          attachment_resource_type,
          attachment_storage,
          media_url,
          media_public_id,
          media_type,
          media_mime,
          media_size,
          original_name,
          attachment_mime,
          attachment_name,
          attachment_size,
          reply_to_id,
          reactions,
          starred_by,
          expires_at,
          read_at,
          image_data,
          image_url,
          image_public_id,
          image_resource_type,
          image_storage,
          image_mime,
          image_name,
          image_size,
          created_at
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20,
          $21, $22, $23, $24, $25,
          $26, $27, $28, $29, $30,
          $31, $32, $33, $34
        )
      `,
      [
        message.id,
        message.text,
        message.senderName,
        message.senderUsername,
        message.recipientUsername,
        message.kind,
        message.attachment ? message.attachment.data : null,
        message.attachment ? message.attachment.url : null,
        message.attachment ? message.attachment.publicId : null,
        message.attachment ? message.attachment.resourceType : null,
        message.attachment ? message.attachment.storage : null,
        message.attachment ? message.attachment.url : null,
        message.attachment ? message.attachment.publicId : null,
        message.attachment ? message.kind : null,
        message.attachment ? message.attachment.mime : null,
        message.attachment ? message.attachment.size : null,
        message.attachment ? message.attachment.name : null,
        message.attachment ? message.attachment.mime : null,
        message.attachment ? message.attachment.name : null,
        message.attachment ? message.attachment.size : null,
        message.replyToId,
        JSON.stringify(message.reactions),
        JSON.stringify(message.starredBy),
        message.expiresAt,
        message.readAt,
        message.image ? message.image.data : null,
        message.image ? message.image.url : null,
        message.image ? message.image.publicId : null,
        message.image ? message.image.resourceType : null,
        message.image ? message.image.storage : null,
        message.image ? message.image.mime : null,
        message.image ? message.image.name : null,
        message.image ? message.image.size : null,
        message.createdAt
      ]
    );

    return message;
  }

  return queuedWrite(async () => {
    const store = await readJsonStore();
    store.messages.push(message);
    await writeJsonStore(store);

    return message;
  });
}

async function findAccessibleMessage(id, username) {
  const owner = normalizeUsername(username);

  if (usePostgres) {
    await initStore();
    const result = await pool.query(
      `
        SELECT
          id,
          text,
          sender_name AS "senderName",
          sender_username AS "senderUsername",
          recipient_username AS "recipientUsername",
          kind,
          attachment_data AS "attachmentData",
          attachment_url AS "attachmentUrl",
          attachment_public_id AS "attachmentPublicId",
          attachment_resource_type AS "attachmentResourceType",
          attachment_storage AS "attachmentStorage",
          media_url AS "mediaUrl",
          media_public_id AS "mediaPublicId",
          media_type AS "mediaType",
          media_mime AS "mediaMime",
          media_size AS "mediaSize",
          original_name AS "originalName",
          attachment_mime AS "attachmentMime",
          attachment_name AS "attachmentName",
          attachment_size AS "attachmentSize",
          reply_to_id AS "replyToId",
          reactions,
          starred_by AS "starredBy",
          expires_at AS "expiresAt",
          read_at AS "readAt",
          created_at AS "createdAt"
        FROM messages
        WHERE id = $1 AND (sender_username = $2 OR recipient_username = $2)
      `,
      [id, owner]
    );

    return result.rows[0] ? normalizeMessage(result.rows[0]) : null;
  }

  const store = await readJsonStore();
  const message = store.messages.find(
    (item) => item.id === id && (item.senderUsername === owner || item.recipientUsername === owner)
  );
  return message ? normalizeMessage(message) : null;
}

async function markConversationRead(username, peerUsername, includeLetters = false) {
  const owner = normalizeUsername(username);
  const peer = normalizeUsername(peerUsername);
  const readAt = new Date().toISOString();

  if (usePostgres) {
    await initStore();
    const result = await pool.query(
      includeLetters
        ? `
            UPDATE messages
            SET read_at = $1
            WHERE recipient_username = $2
              AND COALESCE(sender_username, '') = ''
              AND read_at IS NULL
            RETURNING id
          `
        : `
            UPDATE messages
            SET read_at = $1
            WHERE recipient_username = $2
              AND sender_username = $3
              AND read_at IS NULL
            RETURNING id
          `,
      includeLetters ? [readAt, owner] : [readAt, owner, peer]
    );

    return {
      ids: result.rows.map((row) => row.id),
      readAt
    };
  }

  return queuedWrite(async () => {
    const store = await readJsonStore();
    const ids = [];

    for (const message of store.messages) {
      const match = includeLetters
        ? message.recipientUsername === owner && !message.senderUsername
        : message.recipientUsername === owner && message.senderUsername === peer;

      if (match && !message.readAt) {
        message.readAt = readAt;
        ids.push(message.id);
      }
    }

    await writeJsonStore(store);
    return { ids, readAt };
  });
}

async function toggleMessageReaction(id, username, emoji) {
  const owner = normalizeUsername(username);
  const message = await findAccessibleMessage(id, owner);

  if (!message) {
    return null;
  }

  const reactions = { ...message.reactions };
  const members = new Set(Array.isArray(reactions[emoji]) ? reactions[emoji].map(normalizeUsername) : []);

  if (members.has(owner)) {
    members.delete(owner);
  } else {
    members.add(owner);
  }

  if (members.size) {
    reactions[emoji] = Array.from(members);
  } else {
    delete reactions[emoji];
  }

  if (usePostgres) {
    await pool.query("UPDATE messages SET reactions = $1 WHERE id = $2", [JSON.stringify(reactions), id]);
  } else {
    await queuedWrite(async () => {
      const store = await readJsonStore();
      const target = store.messages.find((item) => item.id === id);
      target.reactions = reactions;
      await writeJsonStore(store);
    });
  }

  return {
    ...message,
    reactions
  };
}

async function toggleMessageStar(id, username) {
  const owner = normalizeUsername(username);
  const message = await findAccessibleMessage(id, owner);

  if (!message) {
    return null;
  }

  const starredBy = new Set(message.starredBy || []);

  if (starredBy.has(owner)) {
    starredBy.delete(owner);
  } else {
    starredBy.add(owner);
  }

  const nextStarredBy = Array.from(starredBy);

  if (usePostgres) {
    await pool.query("UPDATE messages SET starred_by = $1 WHERE id = $2", [
      JSON.stringify(nextStarredBy),
      id
    ]);
  } else {
    await queuedWrite(async () => {
      const store = await readJsonStore();
      const target = store.messages.find((item) => item.id === id);
      target.starredBy = nextStarredBy;
      await writeJsonStore(store);
    });
  }

  return {
    ...message,
    starredBy: nextStarredBy
  };
}

async function listStarredMessages(username, options = {}) {
  const owner = normalizeUsername(username);
  const limit = clampLimit(options.limit, 100, 300);
  await cleanupExpiredMessages();

  const messages = usePostgres
    ? (
        await pool.query(
          `
            SELECT
              id,
              text,
              sender_name AS "senderName",
              sender_username AS "senderUsername",
              recipient_username AS "recipientUsername",
              kind,
              attachment_data AS "attachmentData",
              attachment_url AS "attachmentUrl",
          attachment_public_id AS "attachmentPublicId",
          attachment_resource_type AS "attachmentResourceType",
          attachment_storage AS "attachmentStorage",
              attachment_mime AS "attachmentMime",
              attachment_name AS "attachmentName",
              attachment_size AS "attachmentSize",
              reply_to_id AS "replyToId",
              reactions,
              starred_by AS "starredBy",
              expires_at AS "expiresAt",
              read_at AS "readAt",
              created_at AS "createdAt"
            FROM messages
            WHERE sender_username = $1 OR recipient_username = $1
            ORDER BY created_at DESC
            LIMIT $2
          `,
          [owner, limit * 2]
        )
      ).rows.map(normalizeMessage)
    : (await readJsonStore()).messages.filter(
        (message) => message.senderUsername === owner || message.recipientUsername === owner
      );

  return messages.filter((message) => (message.starredBy || []).includes(owner)).slice(0, limit);
}

async function deleteMessage(id, username) {
  const owner = normalizeUsername(username);

  if (usePostgres) {
    await initStore();
    const result = await pool.query(
      "DELETE FROM messages WHERE id = $1 AND (recipient_username = $2 OR sender_username = $2)",
      [id, owner]
    );
    return result.rowCount > 0;
  }

  return queuedWrite(async () => {
    const store = await readJsonStore();
    const nextMessages = store.messages.filter(
      (message) => !(message.id === id && (message.recipientUsername === owner || message.senderUsername === owner))
    );

    if (nextMessages.length === store.messages.length) {
      return false;
    }

    store.messages = nextMessages;
    await writeJsonStore(store);
    return true;
  });
}

async function cleanupAnalyticsLogs() {
  const retentionDays = Math.max(7, Number(process.env.ANALYTICS_RETENTION_DAYS || 30));

  if (usePostgres) {
    await pool.query(
      `
        DELETE FROM audit_logs
        WHERE table_name IN ('messages', 'media', 'message_media', 'attachments')
          AND UPPER(action) <> 'DELETE'
      `
    );
    await pool.query("DELETE FROM audit_logs WHERE created_at < NOW() - ($1::text || ' days')::interval", [
      retentionDays
    ]);
    await pool.query(
      "DELETE FROM login_history WHERE created_at < NOW() - ($1::text || ' days')::interval",
      [retentionDays]
    );
    await pool.query(
      "DELETE FROM admin_action_logs WHERE created_at < NOW() - ($1::text || ' days')::interval",
      [retentionDays]
    );
    await pool.query(
      "DELETE FROM user_activity_sessions WHERE is_active = false AND created_at < NOW() - ($1::text || ' days')::interval",
      [retentionDays]
    );
    return;
  }

  await queuedWrite(async () => {
    const store = await readJsonStore(false);
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    store.loginHistory = (store.loginHistory || []).filter((item) => new Date(item.createdAt).getTime() >= cutoff);
    store.adminActionLogs = (store.adminActionLogs || []).filter((item) => new Date(item.createdAt).getTime() >= cutoff);
    store.auditLogs = (store.auditLogs || []).filter((item) => new Date(item.createdAt).getTime() >= cutoff);
    store.activitySessions = (store.activitySessions || []).filter(
      (item) => item.isActive || new Date(item.createdAt).getTime() >= cutoff
    );
    await writeJsonStore(store);
  });
}

async function cleanupExpiredNotifications() {
  const now = Date.now();

  await initStore();

  if (usePostgres) {
    await pool.query(
      `
        DELETE FROM notification_alerts
        WHERE (expires_at IS NOT NULL AND expires_at < NOW())
           OR (seen = true AND created_at < NOW() - INTERVAL '30 days')
      `
    );
    return;
  }

  await queuedWrite(async () => {
    const store = await readJsonStore(false);
    const cutoff = now - 30 * 24 * 60 * 60 * 1000;
    store.notificationAlerts = (store.notificationAlerts || []).filter((notification) => {
      const expiresAt = notification.expiresAt ? new Date(notification.expiresAt).getTime() : 0;
      const createdAt = new Date(notification.createdAt || 0).getTime();
      return !(expiresAt && expiresAt < now) && !(notification.seen && createdAt < cutoff);
    });
    await writeJsonStore(store);
  });
}

async function getStorageSummary() {
  await initStore();

  if (usePostgres) {
    const tableNames = [
      "inbox_users",
      "messages",
      "notification_alerts",
      "audit_logs",
      "admin_action_logs",
      "login_history",
      "user_activity_sessions",
      "restricted_search_terms",
      "backup_history"
    ];
    const result = await pool.query(
      `
        SELECT
          table_name,
          COALESCE(pg_total_relation_size(to_regclass(table_name)), 0)::bigint AS bytes,
          CASE
            WHEN to_regclass(table_name) IS NULL THEN 0
            ELSE (
              CASE table_name
                WHEN 'inbox_users' THEN (SELECT COUNT(*) FROM inbox_users)
                WHEN 'messages' THEN (SELECT COUNT(*) FROM messages)
                WHEN 'notification_alerts' THEN (SELECT COUNT(*) FROM notification_alerts)
                WHEN 'audit_logs' THEN (SELECT COUNT(*) FROM audit_logs)
                WHEN 'admin_action_logs' THEN (SELECT COUNT(*) FROM admin_action_logs)
                WHEN 'login_history' THEN (SELECT COUNT(*) FROM login_history)
                WHEN 'user_activity_sessions' THEN (SELECT COUNT(*) FROM user_activity_sessions)
                WHEN 'restricted_search_terms' THEN (SELECT COUNT(*) FROM restricted_search_terms)
                WHEN 'backup_history' THEN (SELECT COUNT(*) FROM backup_history)
                ELSE 0
              END
            )
          END::bigint AS rows
        FROM UNNEST($1::text[]) AS tables(table_name)
      `,
      [tableNames]
    );
    const tables = result.rows.map((row) => ({
      name: row.table_name,
      rows: Number(row.rows || 0),
      bytes: Number(row.bytes || 0)
    }));
    const totalBytes = tables.reduce((sum, table) => sum + table.bytes, 0);

    const mediaResult = await pool.query(
      `
        SELECT
          (
            SELECT COUNT(*) FROM inbox_users WHERE COALESCE(profile_image_data, '') <> ''
          ) + (
            SELECT COUNT(*) FROM messages WHERE COALESCE(attachment_data, '') <> '' OR COALESCE(image_data, '') <> ''
          ) AS db_media_count,
          (
            SELECT COUNT(*) FROM inbox_users WHERE COALESCE(profile_image_url, '') <> ''
          ) + (
            SELECT COUNT(*) FROM messages WHERE COALESCE(attachment_url, '') <> '' OR COALESCE(image_url, '') <> ''
          ) AS url_media_count
      `
    );
    const mediaRow = mediaResult.rows[0] || {};

    return {
      generatedAt: new Date().toISOString(),
      storage: "postgres",
      totalBytes,
      prettyTotal: formatBytes(totalBytes),
      stats: {
        totalUsers: tables.find((table) => table.name === "inbox_users")?.rows || 0,
        totalMessages: tables.find((table) => table.name === "messages")?.rows || 0,
        totalNotifications: tables.find((table) => table.name === "notification_alerts")?.rows || 0,
        auditLogRows: tables.find((table) => table.name === "audit_logs")?.rows || 0,
        dbStoredMediaCount: Number(mediaRow.db_media_count || 0),
        urlMediaCount: Number(mediaRow.url_media_count || 0)
      },
      tables
    };
  }

  const store = await readJsonStore();
  let fileBytes = 0;

  try {
    fileBytes = (await fs.stat(messagesFile)).size;
  } catch {
    fileBytes = Buffer.byteLength(JSON.stringify(store));
  }

  const dbStoredMediaCount =
    store.users.filter((user) => user.profileImageData).length +
    store.messages.filter((message) => (message.attachment && message.attachment.data) || message.imageData || message.image_data).length;
  const urlMediaCount =
    store.users.filter((user) => user.profileImageUrl).length +
    store.messages.filter((message) => (message.attachment && message.attachment.url) || message.imageUrl || message.image_url).length;
  const tables = [
    { name: "inbox_users", rows: store.users.length, bytes: 0 },
    { name: "messages", rows: store.messages.length, bytes: 0 },
    { name: "notification_alerts", rows: (store.notificationAlerts || []).length, bytes: 0 },
    { name: "audit_logs", rows: (store.auditLogs || []).length, bytes: 0 },
    { name: "admin_action_logs", rows: (store.adminActionLogs || []).length, bytes: 0 },
    { name: "login_history", rows: (store.loginHistory || []).length, bytes: 0 },
    { name: "user_activity_sessions", rows: (store.activitySessions || []).length, bytes: 0 },
    { name: "restricted_search_terms", rows: (store.restrictedSearchTerms || []).length, bytes: 0 },
    { name: "backup_history", rows: (store.backupHistory || []).length, bytes: 0 }
  ];

  return {
    generatedAt: new Date().toISOString(),
    storage: "json",
    totalBytes: fileBytes,
    prettyTotal: formatBytes(fileBytes),
    stats: {
      totalUsers: store.users.length,
      totalMessages: store.messages.length,
      totalNotifications: (store.notificationAlerts || []).length,
      auditLogRows: (store.auditLogs || []).length,
      dbStoredMediaCount,
      urlMediaCount
    },
    tables
  };
}

async function cleanupStorageLogs() {
  await initStore();
  const before = await getStorageSummary();
  const rowsRemoved = {
    auditLogs: 0,
    adminActionLogs: 0,
    loginHistory: 0,
    userActivitySessions: 0,
    notificationAlerts: 0
  };

  if (usePostgres) {
    const counts = await pool.query(
      `
        SELECT 'auditLogs' AS key, COUNT(*)::integer AS count FROM audit_logs
        UNION ALL SELECT 'adminActionLogs', COUNT(*)::integer FROM admin_action_logs
        UNION ALL SELECT 'loginHistory', COUNT(*)::integer FROM login_history
        UNION ALL SELECT 'userActivitySessions', COUNT(*)::integer FROM user_activity_sessions
      `
    );

    for (const row of counts.rows) {
      rowsRemoved[row.key] = Number(row.count || 0);
    }

    const notificationDelete = await pool.query(
      `
        DELETE FROM notification_alerts
        WHERE seen = true
           OR (expires_at IS NOT NULL AND expires_at < NOW())
      `
    );
    rowsRemoved.notificationAlerts = notificationDelete.rowCount || 0;

    await pool.query("TRUNCATE audit_logs, admin_action_logs, login_history, user_activity_sessions");
    await pool.query("VACUUM ANALYZE notification_alerts").catch(() => {});
  } else {
    await queuedWrite(async () => {
      const store = await readJsonStore(false);
      const now = Date.now();

      rowsRemoved.auditLogs = (store.auditLogs || []).length;
      rowsRemoved.adminActionLogs = (store.adminActionLogs || []).length;
      rowsRemoved.loginHistory = (store.loginHistory || []).length;
      rowsRemoved.userActivitySessions = (store.activitySessions || []).length;

      const activeNotifications = [];
      for (const notification of store.notificationAlerts || []) {
        const expiresAt = notification.expiresAt ? new Date(notification.expiresAt).getTime() : 0;
        const shouldDelete = notification.seen || (expiresAt && expiresAt < now);

        if (shouldDelete) {
          rowsRemoved.notificationAlerts += 1;
        } else {
          activeNotifications.push(notification);
        }
      }

      store.auditLogs = [];
      store.adminActionLogs = [];
      store.loginHistory = [];
      store.activitySessions = [];
      store.notificationAlerts = activeNotifications;
      await writeJsonStore(store);
    });
  }

  const after = await getStorageSummary();
  const totalRowsRemoved = Object.values(rowsRemoved).reduce((sum, count) => sum + Number(count || 0), 0);
  const totalSavedBytes = Math.max(0, before.totalBytes - after.totalBytes);

  return {
    ok: true,
    confirmation: "This deletes logs only. Messages, users, memories and media stay safe.",
    rowsRemoved,
    totalRowsRemoved,
    storageBefore: before,
    storageAfter: after,
    totalSavedBytes,
    totalSaved: formatBytes(totalSavedBytes)
  };
}

function createMediaManifest(data) {
  const media = [];

  for (const user of data.inboxUsers || []) {
    if (user.profileImageUrl || user.profileImageData || user.profile_image_url || user.profile_image_data) {
      media.push({
        ownerType: "profile",
        ownerId: user.username,
        url: user.profileImageUrl || user.profile_image_url || "",
        publicId: user.profileImagePublicId || user.profile_image_public_id || "",
        mime: user.profileImageMime || user.profile_image_mime || "",
        size: 0,
        originalName: user.profileImageName || user.profile_image_name || "profile image",
        storage: user.profileImageUrl || user.profile_image_url ? "cloudinary" : "database",
        hasEmbeddedData: Boolean(user.profileImageData || user.profile_image_data)
      });
    }
  }

  for (const message of data.messages || []) {
    const attachment = normalizeAttachment(message);

    if (attachment) {
      media.push({
        ownerType: "message",
        ownerId: message.id,
        url: attachment.url || "",
        publicId: attachment.publicId || "",
        resourceType: attachment.resourceType || "",
        mime: attachment.mime || "",
        size: attachment.size || 0,
        originalName: attachment.name || "attachment",
        storage: attachment.storage || (attachment.url ? "cloudinary" : "database"),
        hasEmbeddedData: Boolean(attachment.data)
      });
    }
  }

  return media;
}

async function createBackupExport({ createdBy = "", appVersion = "" } = {}) {
  await initStore();

  if (usePostgres) {
    const [
      usersResult,
      messagesResult,
      notificationsResult,
      loginsResult,
      sessionsResult,
      adminActionsResult,
      auditResult,
      restrictedTermsResult,
      backupHistoryResult
    ] = await Promise.all([
      pool.query(`
        SELECT
          username,
          display_name AS "displayName",
          password_hash AS "passwordHash",
          role,
          bio,
          email,
          email_verified AS "emailVerified",
          profile_image_data AS "profileImageData",
          profile_image_url AS "profileImageUrl",
          profile_image_public_id AS "profileImagePublicId",
          profile_image_mime AS "profileImageMime",
          profile_image_name AS "profileImageName",
          anonymous_mode AS "anonymousMode",
          theme,
          wallpaper,
          font_style AS "fontStyle",
          theme_color AS "themeColor",
          password_changed_at AS "passwordChangedAt",
          is_online AS "isOnline",
          last_seen AS "lastSeen",
          login_time AS "loginTime",
          logout_time AS "logoutTime",
          current_session_id AS "currentSessionId",
          session_duration_seconds AS "sessionDurationSeconds",
          account_status AS "accountStatus",
          is_shadow_banned AS "isShadowBanned",
          suspended_until AS "suspendedUntil",
          blocked_at AS "blockedAt",
          blocked_reason AS "blockedReason",
          search_hidden AS "searchHidden",
          created_at AS "createdAt"
        FROM inbox_users
        ORDER BY username ASC
      `),
      pool.query(`
        SELECT
          id,
          text,
          sender_name AS "senderName",
          sender_username AS "senderUsername",
          recipient_username AS "recipientUsername",
          kind,
          attachment_data AS "attachmentData",
          attachment_url AS "attachmentUrl",
          attachment_public_id AS "attachmentPublicId",
          attachment_resource_type AS "attachmentResourceType",
          attachment_storage AS "attachmentStorage",
          media_url AS "mediaUrl",
          media_public_id AS "mediaPublicId",
          media_type AS "mediaType",
          media_mime AS "mediaMime",
          media_size AS "mediaSize",
          original_name AS "originalName",
          attachment_mime AS "attachmentMime",
          attachment_name AS "attachmentName",
          attachment_size AS "attachmentSize",
          reply_to_id AS "replyToId",
          reactions,
          starred_by AS "starredBy",
          expires_at AS "expiresAt",
          read_at AS "readAt",
          image_data AS "imageData",
          image_url AS "imageUrl",
          image_public_id AS "imagePublicId",
          image_resource_type AS "imageResourceType",
          image_storage AS "imageStorage",
          image_mime AS "imageMime",
          image_name AS "imageName",
          image_size AS "imageSize",
          created_at AS "createdAt"
        FROM messages
        ORDER BY created_at ASC
      `),
      pool.query(`
        SELECT id, recipient_username AS "recipientUsername", title, message, type,
          created_at AS "createdAt", expires_at AS "expiresAt", seen, sent_by AS "sentBy"
        FROM notification_alerts
        ORDER BY created_at ASC
      `),
      pool.query(`
        SELECT id, username, success, reason, suspicious, suspicious_reason AS "suspiciousReason",
          session_id AS "sessionId", ip_address AS "ipAddress", country, state, city,
          location_timezone AS "locationTimezone", isp, vpn_proxy AS "vpnProxy",
          device_type AS "deviceType", operating_system AS "operatingSystem", browser,
          browser_version AS "browserVersion", user_agent AS "userAgent", created_at AS "createdAt"
        FROM login_history
        ORDER BY created_at ASC
      `),
      pool.query(`
        SELECT id, username, session_id AS "sessionId", login_time AS "loginTime",
          logout_time AS "logoutTime", last_seen AS "lastSeen", duration_seconds AS "durationSeconds",
          is_active AS "isActive", ip_address AS "ipAddress", country, state, city,
          location_timezone AS "locationTimezone", isp, vpn_proxy AS "vpnProxy",
          device_type AS "deviceType", operating_system AS "operatingSystem", browser,
          browser_version AS "browserVersion", user_agent AS "userAgent",
          screen_width AS "screenWidth", screen_height AS "screenHeight",
          device_pixel_ratio AS "devicePixelRatio", language, client_timezone AS "clientTimezone",
          online_state AS "onlineState", created_at AS "createdAt"
        FROM user_activity_sessions
        ORDER BY created_at ASC
      `),
      pool.query(`
        SELECT id, admin_username AS "adminUsername", action, target_username AS "targetUsername",
          details, ip_address AS "ipAddress", created_at AS "createdAt"
        FROM admin_action_logs
        ORDER BY created_at ASC
      `),
      pool.query(`
        SELECT id, table_name AS "tableName", action, row_id AS "rowId", details, created_at AS "createdAt"
        FROM audit_logs
        WHERE UPPER(action) = 'DELETE'
           OR table_name NOT IN ('messages', 'media', 'message_media', 'attachments')
        ORDER BY created_at DESC
        LIMIT 1000
      `),
      pool.query(`
        SELECT id, term, created_at AS "createdAt", created_by AS "createdBy"
        FROM restricted_search_terms
        ORDER BY term ASC
      `),
      pool.query(`
        SELECT id, created_at AS "createdAt", created_by AS "createdBy", status,
          storage_mode AS "storageMode", file_name AS "fileName", file_path AS "filePath",
          download_url AS "downloadUrl", cloudinary_public_id AS "cloudinaryPublicId",
          size_bytes AS "sizeBytes", row_counts AS "rowCounts", manifest, error
        FROM backup_history
        ORDER BY created_at DESC
        LIMIT 50
      `)
    ]);

    const data = {
      inboxUsers: usersResult.rows,
      messages: messagesResult.rows.map(normalizeMessage),
      notificationAlerts: notificationsResult.rows.map(normalizeNotification),
      loginHistory: loginsResult.rows.map(normalizeLoginRecord),
      userActivitySessions: sessionsResult.rows.map(normalizeSessionRecord),
      adminActionLogs: adminActionsResult.rows.map(normalizeAdminAction),
      importantAuditLogs: auditResult.rows,
      restrictedSearchTerms: restrictedTermsResult.rows,
      backupHistory: backupHistoryResult.rows.map(normalizeBackupRecord)
    };
    const mediaManifest = createMediaManifest(data);
    const rowCounts = {
      inbox_users: data.inboxUsers.length,
      messages: data.messages.length,
      notification_alerts: data.notificationAlerts.length,
      login_history: data.loginHistory.length,
      user_activity_sessions: data.userActivitySessions.length,
      admin_action_logs: data.adminActionLogs.length,
      important_audit_logs: data.importantAuditLogs.length,
      restricted_search_terms: data.restrictedSearchTerms.length,
      backup_history: data.backupHistory.length,
      media_manifest: mediaManifest.length
    };

    return {
      createdAt: new Date().toISOString(),
      createdBy: normalizeUsername(createdBy),
      database: process.env.DATABASE_URL ? "postgres" : "json",
      appVersion,
      rowCounts,
      mediaManifest,
      ...data
    };
  }

  const store = await readJsonStore();
  const data = {
    inboxUsers: store.users,
    messages: store.messages,
    notificationAlerts: store.notificationAlerts || [],
    loginHistory: store.loginHistory || [],
    userActivitySessions: store.activitySessions || [],
    adminActionLogs: store.adminActionLogs || [],
    importantAuditLogs: (store.auditLogs || [])
      .filter((item) => String(item.action || "").toUpperCase() === "DELETE" || !["messages", "media", "message_media", "attachments"].includes(String(item.tableName || item.table_name || "")))
      .slice(-1000),
    restrictedSearchTerms: store.restrictedSearchTerms || [],
    backupHistory: store.backupHistory || []
  };
  const mediaManifest = createMediaManifest(data);
  const rowCounts = {
    inbox_users: data.inboxUsers.length,
    messages: data.messages.length,
    notification_alerts: data.notificationAlerts.length,
    login_history: data.loginHistory.length,
    user_activity_sessions: data.userActivitySessions.length,
    admin_action_logs: data.adminActionLogs.length,
    important_audit_logs: data.importantAuditLogs.length,
    restricted_search_terms: data.restrictedSearchTerms.length,
    backup_history: data.backupHistory.length,
    media_manifest: mediaManifest.length
  };

  return {
    createdAt: new Date().toISOString(),
    createdBy: normalizeUsername(createdBy),
    database: "json",
    appVersion,
    rowCounts,
    mediaManifest,
    ...data
  };
}

async function recordBackupMetadata(record) {
  const backup = normalizeBackupRecord(record);

  if (usePostgres) {
    await initStore();
    const result = await pool.query(
      `
        INSERT INTO backup_history (
          id, created_at, created_by, status, storage_mode, file_name, file_path,
          download_url, cloudinary_public_id, size_bytes, row_counts, manifest, error
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING
          id,
          created_at AS "createdAt",
          created_by AS "createdBy",
          status,
          storage_mode AS "storageMode",
          file_name AS "fileName",
          file_path AS "filePath",
          download_url AS "downloadUrl",
          cloudinary_public_id AS "cloudinaryPublicId",
          size_bytes AS "sizeBytes",
          row_counts AS "rowCounts",
          manifest,
          error
      `,
      [
        backup.id,
        backup.createdAt,
        backup.createdBy,
        backup.status,
        backup.storageMode,
        backup.fileName,
        backup.filePath,
        backup.downloadUrl,
        backup.cloudinaryPublicId,
        backup.sizeBytes,
        JSON.stringify(backup.rowCounts || {}),
        JSON.stringify(backup.manifest || {}),
        backup.error
      ]
    );
    return normalizeBackupRecord(result.rows[0]);
  }

  return queuedWrite(async () => {
    const store = await readJsonStore(false);
    store.backupHistory = [backup, ...(store.backupHistory || [])].slice(0, 100);
    await writeJsonStore(store);
    return backup;
  });
}

async function listBackupHistory(options = {}) {
  const limit = clampLimit(options.limit, 20, 100);

  if (usePostgres) {
    await initStore();
    const result = await pool.query(
      `
        SELECT
          id,
          created_at AS "createdAt",
          created_by AS "createdBy",
          status,
          storage_mode AS "storageMode",
          file_name AS "fileName",
          file_path AS "filePath",
          download_url AS "downloadUrl",
          cloudinary_public_id AS "cloudinaryPublicId",
          size_bytes AS "sizeBytes",
          row_counts AS "rowCounts",
          manifest,
          error
        FROM backup_history
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [limit]
    );
    return result.rows.map(normalizeBackupRecord);
  }

  const store = await readJsonStore();
  return (store.backupHistory || []).map(normalizeBackupRecord).slice(0, limit);
}

async function markStaleUsersOffline() {
  if (usePostgres) {
    await initStore();
    await pool.query(
      `
        UPDATE inbox_users
        SET is_online = false,
            logout_time = COALESCE(logout_time, last_seen),
            session_duration_seconds = GREATEST(
              session_duration_seconds,
              COALESCE(EXTRACT(EPOCH FROM (last_seen - login_time))::integer, session_duration_seconds)
            )
        WHERE is_online = true
          AND last_seen < NOW() - INTERVAL '2 minutes'
      `
    );
    await pool.query(
      `
        UPDATE user_activity_sessions
        SET is_active = false,
            logout_time = COALESCE(logout_time, last_seen),
            duration_seconds = GREATEST(
              duration_seconds,
              COALESCE(EXTRACT(EPOCH FROM (last_seen - login_time))::integer, duration_seconds)
            )
        WHERE is_active = true
          AND last_seen < NOW() - INTERVAL '2 minutes'
      `
    );
  }
}

async function recordLoginAttempt({ username, success, reason = "", suspicious = false, suspiciousReason = "", sessionId = "", context = {} }) {
  const normalizedUsername = normalizeUsername(username);
  const activity = normalizeActivityContext(context);
  const item = normalizeLoginRecord({
    id: crypto.randomUUID(),
    username: normalizedUsername,
    success,
    reason,
    suspicious,
    suspiciousReason,
    sessionId,
    ...activity,
    createdAt: new Date().toISOString()
  });

  if (usePostgres) {
    await initStore();
    await pool.query(
      `
        INSERT INTO login_history (
          id, username, success, reason, suspicious, suspicious_reason, session_id,
          ip_address, country, state, city, location_timezone, isp, vpn_proxy,
          device_type, operating_system, browser, browser_version, user_agent, created_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13, $14,
          $15, $16, $17, $18, $19, $20
        )
      `,
      [
        item.id,
        item.username,
        item.success,
        item.reason,
        item.suspicious,
        item.suspiciousReason,
        item.sessionId,
        item.ipAddress,
        item.country,
        item.state,
        item.city,
        item.locationTimezone,
        item.isp,
        item.vpnProxy,
        item.deviceType,
        item.operatingSystem,
        item.browser,
        item.browserVersion,
        item.userAgent,
        item.createdAt
      ]
    );
    return item;
  }

  return queuedWrite(async () => {
    const store = await readJsonStore();
    store.loginHistory = [item, ...(store.loginHistory || [])].slice(0, 1000);
    await writeJsonStore(store);
    return item;
  });
}

async function detectSuspiciousLogin(username, context = {}) {
  const normalizedUsername = normalizeUsername(username);
  const activity = normalizeActivityContext(context);
  const reasons = [];

  if (!normalizedUsername) {
    return { suspicious: false, reason: "" };
  }

  if (activity.vpnProxy === true) {
    reasons.push("VPN/proxy network");
  }

  if (usePostgres) {
    await initStore();
    const failed = await pool.query(
      `
        SELECT COUNT(*)::integer AS count
        FROM login_history
        WHERE username = $1
          AND success = false
          AND created_at > NOW() - INTERVAL '15 minutes'
      `,
      [normalizedUsername]
    );
    const lastSuccess = await pool.query(
      `
        SELECT country, device_type, browser
        FROM login_history
        WHERE username = $1 AND success = true
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [normalizedUsername]
    );

    if (Number(failed.rows[0] && failed.rows[0].count) >= 5) {
      reasons.push("Many failed login attempts");
    }

    const previous = lastSuccess.rows[0];
    if (previous) {
      if (activity.country && previous.country && activity.country !== previous.country) {
        reasons.push("New country");
      }
      if (activity.deviceType && previous.device_type && activity.deviceType !== previous.device_type) {
        reasons.push("New device type");
      }
    }
  } else {
    const store = await readJsonStore();
    const cutoff = Date.now() - 15 * 60 * 1000;
    const recentFailures = (store.loginHistory || []).filter(
      (item) =>
        item.username === normalizedUsername &&
        !item.success &&
        new Date(item.createdAt).getTime() >= cutoff
    );
    const previous = (store.loginHistory || []).find(
      (item) => item.username === normalizedUsername && item.success
    );

    if (recentFailures.length >= 5) {
      reasons.push("Many failed login attempts");
    }
    if (previous && activity.country && previous.country && activity.country !== previous.country) {
      reasons.push("New country");
    }
  }

  return {
    suspicious: reasons.length > 0,
    reason: reasons.join(", ")
  };
}

async function startUserSession(username, sessionId, context = {}) {
  const normalizedUsername = normalizeUsername(username);
  const activity = normalizeActivityContext(context);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  if (!normalizedUsername || !sessionId) {
    return null;
  }

  if (usePostgres) {
    await initStore();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        `
          UPDATE user_activity_sessions
          SET is_active = false,
              logout_time = COALESCE(logout_time, NOW()),
              duration_seconds = GREATEST(duration_seconds, COALESCE(EXTRACT(EPOCH FROM (NOW() - login_time))::integer, duration_seconds))
          WHERE username = $1 AND session_id = $2 AND is_active = true
        `,
        [normalizedUsername, sessionId]
      );
      await client.query(
        `
          INSERT INTO user_activity_sessions (
            id, username, session_id, login_time, last_seen, is_active,
            ip_address, country, state, city, location_timezone, isp, vpn_proxy,
            device_type, operating_system, browser, browser_version, user_agent,
            screen_width, screen_height, device_pixel_ratio, language, client_timezone, online_state
          )
          VALUES (
            $1, $2, $3, NOW(), NOW(), true,
            $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15,
            $16, $17, $18, $19, $20, $21
          )
        `,
        [
          id,
          normalizedUsername,
          sessionId,
          activity.ipAddress,
          activity.country,
          activity.state,
          activity.city,
          activity.locationTimezone,
          activity.isp,
          activity.vpnProxy,
          activity.deviceType,
          activity.operatingSystem,
          activity.browser,
          activity.browserVersion,
          activity.userAgent,
          activity.screenWidth,
          activity.screenHeight,
          activity.devicePixelRatio,
          activity.language,
          activity.clientTimezone,
          activity.onlineState
        ]
      );
      await client.query(
        `
          UPDATE inbox_users
          SET is_online = true,
              last_seen = NOW(),
              login_time = NOW(),
              logout_time = NULL,
              current_session_id = $2,
              session_duration_seconds = 0
          WHERE username = $1
        `,
        [normalizedUsername, sessionId]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } else {
    await queuedWrite(async () => {
      const store = await readJsonStore();
      for (const session of store.activitySessions || []) {
        if (session.username === normalizedUsername && session.sessionId === sessionId && session.isActive) {
          session.isActive = false;
          session.logoutTime = now;
          session.durationSeconds = Math.max(0, Math.round((new Date(now) - new Date(session.loginTime)) / 1000));
        }
      }
      store.activitySessions = [
        {
          id,
          username: normalizedUsername,
          sessionId,
          loginTime: now,
          lastSeen: now,
          logoutTime: null,
          durationSeconds: 0,
          isActive: true,
          ...activity
        },
        ...(store.activitySessions || [])
      ].slice(0, 1000);
      const user = store.users.find((item) => item.username === normalizedUsername);
      if (user) {
        user.isOnline = true;
        user.lastSeen = now;
        user.loginTime = now;
        user.logoutTime = null;
        user.currentSessionId = sessionId;
        user.sessionDurationSeconds = 0;
      }
      await writeJsonStore(store);
    });
  }

  return { id, username: normalizedUsername, sessionId, loginTime: now };
}

async function heartbeatUserSession(username, sessionId, context = {}) {
  const normalizedUsername = normalizeUsername(username);
  const activity = normalizeActivityContext(context);
  const now = new Date().toISOString();

  if (!normalizedUsername || !sessionId) {
    return false;
  }

  if (usePostgres) {
    await initStore();
    await pool.query(
      `
        UPDATE user_activity_sessions
        SET last_seen = NOW(),
            duration_seconds = GREATEST(duration_seconds, COALESCE(EXTRACT(EPOCH FROM (NOW() - login_time))::integer, duration_seconds)),
            is_active = true,
            screen_width = COALESCE($3, screen_width),
            screen_height = COALESCE($4, screen_height),
            device_pixel_ratio = COALESCE($5, device_pixel_ratio),
            language = COALESCE(NULLIF($6, ''), language),
            client_timezone = COALESCE(NULLIF($7, ''), client_timezone),
            online_state = COALESCE($8, online_state)
        WHERE username = $1 AND session_id = $2
      `,
      [
        normalizedUsername,
        sessionId,
        activity.screenWidth,
        activity.screenHeight,
        activity.devicePixelRatio,
        activity.language,
        activity.clientTimezone,
        activity.onlineState
      ]
    );
    await pool.query(
      `
        UPDATE inbox_users
        SET is_online = true,
            last_seen = NOW(),
            current_session_id = $2,
            session_duration_seconds = GREATEST(session_duration_seconds, COALESCE(EXTRACT(EPOCH FROM (NOW() - login_time))::integer, session_duration_seconds))
        WHERE username = $1
      `,
      [normalizedUsername, sessionId]
    );
    return true;
  }

  return queuedWrite(async () => {
    const store = await readJsonStore();
    const session = (store.activitySessions || []).find(
      (item) => item.username === normalizedUsername && item.sessionId === sessionId && item.isActive
    );

    if (session) {
      session.lastSeen = now;
      session.durationSeconds = Math.max(0, Math.round((new Date(now) - new Date(session.loginTime)) / 1000));
      Object.assign(session, Object.fromEntries(Object.entries(activity).filter(([, value]) => value !== null && value !== "")));
    }

    const user = store.users.find((item) => item.username === normalizedUsername);
    if (user) {
      user.isOnline = true;
      user.lastSeen = now;
      user.currentSessionId = sessionId;
      if (user.loginTime) {
        user.sessionDurationSeconds = Math.max(0, Math.round((new Date(now) - new Date(user.loginTime)) / 1000));
      }
    }

    await writeJsonStore(store);
    return true;
  });
}

async function endUserSession(username, sessionId) {
  const normalizedUsername = normalizeUsername(username);
  const now = new Date().toISOString();

  if (!normalizedUsername) {
    return false;
  }

  if (usePostgres) {
    await initStore();
    await pool.query(
      `
        UPDATE user_activity_sessions
        SET is_active = false,
            logout_time = NOW(),
            last_seen = NOW(),
            duration_seconds = GREATEST(duration_seconds, COALESCE(EXTRACT(EPOCH FROM (NOW() - login_time))::integer, duration_seconds))
        WHERE username = $1
          AND ($2 = '' OR session_id = $2)
          AND is_active = true
      `,
      [normalizedUsername, sessionId || ""]
    );
    await pool.query(
      `
        UPDATE inbox_users
        SET is_online = false,
            last_seen = NOW(),
            logout_time = NOW(),
            session_duration_seconds = GREATEST(session_duration_seconds, COALESCE(EXTRACT(EPOCH FROM (NOW() - login_time))::integer, session_duration_seconds))
        WHERE username = $1
      `,
      [normalizedUsername]
    );
    return true;
  }

  return queuedWrite(async () => {
    const store = await readJsonStore();
    for (const session of store.activitySessions || []) {
      if (session.username === normalizedUsername && (!sessionId || session.sessionId === sessionId) && session.isActive) {
        session.isActive = false;
        session.logoutTime = now;
        session.lastSeen = now;
        session.durationSeconds = Math.max(0, Math.round((new Date(now) - new Date(session.loginTime)) / 1000));
      }
    }
    const user = store.users.find((item) => item.username === normalizedUsername);
    if (user) {
      user.isOnline = false;
      user.lastSeen = now;
      user.logoutTime = now;
      if (user.loginTime) {
        user.sessionDurationSeconds = Math.max(0, Math.round((new Date(now) - new Date(user.loginTime)) / 1000));
      }
    }
    await writeJsonStore(store);
    return true;
  });
}

async function logAdminAction({ adminUsername, action, targetUsername = "", details = {}, ipAddress = "" }) {
  const item = normalizeAdminAction({
    id: crypto.randomUUID(),
    adminUsername,
    action: String(action || "").slice(0, 120),
    targetUsername,
    details,
    ipAddress,
    createdAt: new Date().toISOString()
  });

  if (!item.adminUsername || !item.action) {
    return null;
  }

  if (usePostgres) {
    await initStore();
    await pool.query(
      `
        INSERT INTO admin_action_logs (id, admin_username, action, target_username, details, ip_address, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        item.id,
        item.adminUsername,
        item.action,
        item.targetUsername,
        JSON.stringify(item.details || {}),
        item.ipAddress,
        item.createdAt
      ]
    );
    return item;
  }

  return queuedWrite(async () => {
    const store = await readJsonStore();
    store.adminActionLogs = [item, ...(store.adminActionLogs || [])].slice(0, 1000);
    await writeJsonStore(store);
    return item;
  });
}

async function updateUserSecurityStatus(username, updates = {}) {
  const normalizedUsername = normalizeUsername(username);
  const allowedStatuses = new Set(["active", "blocked", "suspended"]);
  const accountStatus = allowedStatuses.has(String(updates.accountStatus || "")) ? updates.accountStatus : "active";
  const isShadowBanned = Boolean(updates.isShadowBanned);
  const blockedReason = String(updates.blockedReason || "").slice(0, 240);
  const suspendedUntil = updates.suspendedUntil ? new Date(updates.suspendedUntil) : null;
  const suspendedUntilIso =
    suspendedUntil && !Number.isNaN(suspendedUntil.getTime()) ? suspendedUntil.toISOString() : null;

  if (!normalizedUsername) {
    return null;
  }

  if (usePostgres) {
    await initStore();
    const result = await pool.query(
      `
        UPDATE inbox_users
        SET account_status = $2,
            is_shadow_banned = $3,
            suspended_until = $4,
            blocked_reason = $5,
            blocked_at = CASE WHEN $2 IN ('blocked', 'suspended') THEN COALESCE(blocked_at, NOW()) ELSE NULL END
        WHERE username = $1
        RETURNING
          username,
          display_name AS "displayName",
          role,
          bio,
          profile_image_url AS "profileImageUrl",
        profile_image_public_id AS "profileImagePublicId",
          profile_image_mime AS "profileImageMime",
          profile_image_name AS "profileImageName",
          (profile_image_mime <> '' OR profile_image_url <> '') AS "hasProfileImage",
          anonymous_mode AS "anonymousMode",
          is_online AS "isOnline",
          last_seen AS "lastSeen",
          login_time AS "loginTime",
          logout_time AS "logoutTime",
          current_session_id AS "currentSessionId",
          session_duration_seconds AS "sessionDurationSeconds",
          account_status AS "accountStatus",
          is_shadow_banned AS "isShadowBanned",
          suspended_until AS "suspendedUntil",
          blocked_at AS "blockedAt",
          blocked_reason AS "blockedReason",
          search_hidden AS "searchHidden",
          created_at AS "createdAt"
      `,
      [normalizedUsername, accountStatus, isShadowBanned, suspendedUntilIso, blockedReason]
    );
    return result.rows[0] ? normalizeUser(result.rows[0]) : null;
  }

  return queuedWrite(async () => {
    const store = await readJsonStore();
    const user = store.users.find((item) => item.username === normalizedUsername);
    if (!user) return null;
    user.accountStatus = accountStatus;
    user.isShadowBanned = isShadowBanned;
    user.suspendedUntil = suspendedUntilIso;
    user.blockedReason = blockedReason;
    user.blockedAt = accountStatus === "active" ? null : user.blockedAt || new Date().toISOString();
    await writeJsonStore(store);
    return normalizeUser(user);
  });
}

async function updateUserSearchVisibility(username, searchHidden) {
  const normalizedUsername = normalizeUsername(username);

  if (!normalizedUsername) {
    return null;
  }

  if (usePostgres) {
    await initStore();
    const result = await pool.query(
      `
        UPDATE inbox_users
        SET search_hidden = $2
        WHERE username = $1
        RETURNING
          username,
          display_name AS "displayName",
          role,
          bio,
          profile_image_url AS "profileImageUrl",
        profile_image_public_id AS "profileImagePublicId",
          profile_image_mime AS "profileImageMime",
          profile_image_name AS "profileImageName",
          (profile_image_mime <> '' OR profile_image_url <> '') AS "hasProfileImage",
          anonymous_mode AS "anonymousMode",
          is_online AS "isOnline",
          last_seen AS "lastSeen",
          login_time AS "loginTime",
          logout_time AS "logoutTime",
          current_session_id AS "currentSessionId",
          session_duration_seconds AS "sessionDurationSeconds",
          account_status AS "accountStatus",
          is_shadow_banned AS "isShadowBanned",
          suspended_until AS "suspendedUntil",
          blocked_at AS "blockedAt",
          blocked_reason AS "blockedReason",
          search_hidden AS "searchHidden",
          created_at AS "createdAt"
      `,
      [normalizedUsername, Boolean(searchHidden)]
    );

    return result.rows[0] ? normalizeUser(result.rows[0]) : null;
  }

  return queuedWrite(async () => {
    const store = await readJsonStore();
    const user = store.users.find((item) => item.username === normalizedUsername);

    if (!user) {
      return null;
    }

    user.searchHidden = Boolean(searchHidden);
    await writeJsonStore(store);
    return normalizeUser(user);
  });
}

async function listUserLoginHistory(username, options = {}) {
  const normalizedUsername = normalizeUsername(username);
  const limit = clampLimit(options.limit, 50, 200);

  if (usePostgres) {
    await initStore();
    const result = await pool.query(
      `
        SELECT
          id,
          username,
          success,
          reason,
          suspicious,
          suspicious_reason AS "suspiciousReason",
          session_id AS "sessionId",
          ip_address AS "ipAddress",
          country,
          state,
          city,
          location_timezone AS "locationTimezone",
          isp,
          vpn_proxy AS "vpnProxy",
          device_type AS "deviceType",
          operating_system AS "operatingSystem",
          browser,
          browser_version AS "browserVersion",
          user_agent AS "userAgent",
          created_at AS "createdAt"
        FROM login_history
        WHERE username = $1
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [normalizedUsername, limit]
    );
    return result.rows.map(normalizeLoginRecord);
  }

  const store = await readJsonStore();
  return (store.loginHistory || [])
    .filter((item) => normalizeUsername(item.username) === normalizedUsername)
    .slice(0, limit)
    .map(normalizeLoginRecord);
}

async function listAdminActionLogs(options = {}) {
  const limit = clampLimit(options.limit, 50, 200);

  if (usePostgres) {
    await initStore();
    const result = await pool.query(
      `
        SELECT
          id,
          admin_username AS "adminUsername",
          action,
          target_username AS "targetUsername",
          details,
          ip_address AS "ipAddress",
          created_at AS "createdAt"
        FROM admin_action_logs
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [limit]
    );
    return result.rows.map(normalizeAdminAction);
  }

  const store = await readJsonStore();
  return (store.adminActionLogs || []).slice(0, limit).map(normalizeAdminAction);
}

async function getUltimateAdminMonitoring(options = {}) {
  const limit = clampLimit(options.limit, 80, 200);
  await markStaleUsersOffline();

  if (usePostgres) {
    await initStore();
    const [usersResult, sessionsResult, loginsResult, suspiciousResult, actionsResult] = await Promise.all([
      pool.query(
        `
          SELECT
            username,
            display_name AS "displayName",
            role,
            bio,
            profile_image_url AS "profileImageUrl",
        profile_image_public_id AS "profileImagePublicId",
            profile_image_mime AS "profileImageMime",
            profile_image_name AS "profileImageName",
            (profile_image_mime <> '' OR profile_image_url <> '') AS "hasProfileImage",
            anonymous_mode AS "anonymousMode",
            is_online AS "isOnline",
            last_seen AS "lastSeen",
            login_time AS "loginTime",
            logout_time AS "logoutTime",
            current_session_id AS "currentSessionId",
            session_duration_seconds AS "sessionDurationSeconds",
            account_status AS "accountStatus",
            is_shadow_banned AS "isShadowBanned",
            suspended_until AS "suspendedUntil",
            blocked_at AS "blockedAt",
            blocked_reason AS "blockedReason",
            search_hidden AS "searchHidden",
            created_at AS "createdAt"
          FROM inbox_users
          ORDER BY is_online DESC, last_seen DESC NULLS LAST, display_name ASC
          LIMIT $1
        `,
        [limit]
      ),
      pool.query(
        `
          SELECT DISTINCT ON (username)
            id,
            username,
            session_id AS "sessionId",
            login_time AS "loginTime",
            logout_time AS "logoutTime",
            last_seen AS "lastSeen",
            duration_seconds AS "durationSeconds",
            is_active AS "isActive",
            ip_address AS "ipAddress",
            country,
            state,
            city,
            location_timezone AS "locationTimezone",
            isp,
            vpn_proxy AS "vpnProxy",
            device_type AS "deviceType",
            operating_system AS "operatingSystem",
            browser,
            browser_version AS "browserVersion",
            user_agent AS "userAgent",
            screen_width AS "screenWidth",
            screen_height AS "screenHeight",
            device_pixel_ratio AS "devicePixelRatio",
            language,
            client_timezone AS "clientTimezone",
            online_state AS "onlineState",
            created_at AS "createdAt"
          FROM user_activity_sessions
          ORDER BY username, last_seen DESC
        `
      ),
      pool.query(
        `
          SELECT
            id,
            username,
            success,
            reason,
            suspicious,
            suspicious_reason AS "suspiciousReason",
            session_id AS "sessionId",
            ip_address AS "ipAddress",
            country,
            state,
            city,
            location_timezone AS "locationTimezone",
            isp,
            vpn_proxy AS "vpnProxy",
            device_type AS "deviceType",
            operating_system AS "operatingSystem",
            browser,
            browser_version AS "browserVersion",
            user_agent AS "userAgent",
            created_at AS "createdAt"
          FROM login_history
          ORDER BY created_at DESC
          LIMIT 80
        `
      ),
      pool.query(
        `
          SELECT
            id,
            username,
            success,
            reason,
            suspicious,
            suspicious_reason AS "suspiciousReason",
            session_id AS "sessionId",
            ip_address AS "ipAddress",
            country,
            state,
            city,
            location_timezone AS "locationTimezone",
            isp,
            vpn_proxy AS "vpnProxy",
            device_type AS "deviceType",
            operating_system AS "operatingSystem",
            browser,
            browser_version AS "browserVersion",
            user_agent AS "userAgent",
            created_at AS "createdAt"
          FROM login_history
          WHERE suspicious = true OR success = false
          ORDER BY created_at DESC
          LIMIT 40
        `
      ),
      pool.query(
        `
          SELECT
            id,
            admin_username AS "adminUsername",
            action,
            target_username AS "targetUsername",
            details,
            ip_address AS "ipAddress",
            created_at AS "createdAt"
          FROM admin_action_logs
          ORDER BY created_at DESC
          LIMIT 40
        `
      )
    ]);

    const sessionsByUser = new Map(
      sessionsResult.rows.map((row) => [normalizeUsername(row.username), normalizeSessionRecord(row)])
    );
    const users = usersResult.rows.map((row) => {
      const user = normalizeUser(row);
      return {
        ...user,
        session: sessionsByUser.get(user.username) || null
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      stats: {
        totalUsers: users.length,
        onlineUsers: users.filter((user) => user.isOnline).length,
        anonymousOnlineUsers: users.filter((user) => user.isOnline && user.anonymousMode).length,
        blockedUsers: users.filter((user) => user.accountStatus === "blocked" || user.accountStatus === "suspended").length,
        suspiciousEvents: suspiciousResult.rowCount
      },
      users,
      loginHistory: loginsResult.rows.map(normalizeLoginRecord),
      suspicious: suspiciousResult.rows.map(normalizeLoginRecord),
      adminActions: actionsResult.rows.map(normalizeAdminAction)
    };
  }

  const store = await readJsonStore();
  const sessionsByUser = new Map(
    (store.activitySessions || []).map(normalizeSessionRecord).map((session) => [session.username, session])
  );
  const users = store.users
    .map(normalizeUser)
    .sort((a, b) => Number(b.isOnline) - Number(a.isOnline) || String(b.lastSeen || "").localeCompare(String(a.lastSeen || "")))
    .slice(0, limit)
    .map((user) => ({ ...user, session: sessionsByUser.get(user.username) || null }));
  const loginHistory = (store.loginHistory || []).map(normalizeLoginRecord).slice(0, 80);
  const suspicious = loginHistory.filter((item) => item.suspicious || !item.success).slice(0, 40);

  return {
    generatedAt: new Date().toISOString(),
    stats: {
      totalUsers: users.length,
      onlineUsers: users.filter((user) => user.isOnline).length,
      anonymousOnlineUsers: users.filter((user) => user.isOnline && user.anonymousMode).length,
      blockedUsers: users.filter((user) => user.accountStatus === "blocked" || user.accountStatus === "suspended").length,
      suspiciousEvents: suspicious.length
    },
    users,
    loginHistory,
    suspicious,
    adminActions: (store.adminActionLogs || []).map(normalizeAdminAction).slice(0, 40)
  };
}

async function createNotificationAlert({
  recipientUsername,
  title,
  message,
  type = "info",
  sentBy = "",
  expiresAt = null
}) {
  const notification = normalizeNotification({
    id: crypto.randomUUID(),
    recipientUsername,
    title,
    message,
    type,
    sentBy,
    expiresAt,
    seen: false,
    createdAt: new Date().toISOString()
  });

  if (!notification.recipientUsername || !notification.title || !notification.message) {
    return null;
  }

  if (usePostgres) {
    await initStore();
    const result = await pool.query(
      `
        INSERT INTO notification_alerts (
          id, recipient_username, title, message, type, created_at, expires_at, seen, sent_by
        )
        VALUES ($1, $2, $3, $4, $5, NOW(), $6, false, $7)
        RETURNING
          id,
          recipient_username AS "recipientUsername",
          title,
          message,
          type,
          created_at AS "createdAt",
          expires_at AS "expiresAt",
          seen,
          sent_by AS "sentBy"
      `,
      [
        notification.id,
        notification.recipientUsername,
        notification.title,
        notification.message,
        notification.type,
        notification.expiresAt,
        notification.sentBy
      ]
    );

    return normalizeNotification(result.rows[0]);
  }

  return queuedWrite(async () => {
    const store = await readJsonStore();
    store.notificationAlerts = [notification, ...(store.notificationAlerts || [])].slice(0, 1000);
    await writeJsonStore(store);
    return notification;
  });
}

async function findNotificationAlert(id) {
  const notificationId = String(id || "").trim();

  if (!notificationId) {
    return null;
  }

  if (usePostgres) {
    await initStore();
    const result = await pool.query(
      `
        SELECT
          id,
          recipient_username AS "recipientUsername",
          title,
          message,
          type,
          created_at AS "createdAt",
          expires_at AS "expiresAt",
          seen,
          sent_by AS "sentBy"
        FROM notification_alerts
        WHERE id = $1
        LIMIT 1
      `,
      [notificationId]
    );

    return result.rows[0] ? normalizeNotification(result.rows[0]) : null;
  }

  const store = await readJsonStore();
  const notification = (store.notificationAlerts || []).find((item) => String(item.id) === notificationId);
  return notification ? normalizeNotification(notification) : null;
}

async function listNotificationsForUser(username, options = {}) {
  const recipientUsername = normalizeUsername(username);
  const includeSeen = Boolean(options.includeSeen);
  const limit = clampLimit(options.limit, 30, 80);

  if (!recipientUsername) {
    return [];
  }

  if (usePostgres) {
    await initStore();
    const result = await pool.query(
      `
        SELECT
          id,
          recipient_username AS "recipientUsername",
          title,
          message,
          type,
          created_at AS "createdAt",
          expires_at AS "expiresAt",
          seen,
          sent_by AS "sentBy"
        FROM notification_alerts
        WHERE LOWER(recipient_username) = $1
          AND ($2::boolean = true OR seen = false)
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY created_at DESC
        LIMIT $3
      `,
      [recipientUsername, includeSeen, limit]
    );

    return result.rows.map(normalizeNotification).reverse();
  }

  const now = Date.now();
  const store = await readJsonStore();
  return (store.notificationAlerts || [])
    .map(normalizeNotification)
    .filter((notification) => notification.recipientUsername === recipientUsername)
    .filter((notification) => includeSeen || !notification.seen)
    .filter((notification) => !notification.expiresAt || new Date(notification.expiresAt).getTime() > now)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(0, limit);
}

async function markNotificationsRead(username, ids = []) {
  const recipientUsername = normalizeUsername(username);
  const notificationIds = (Array.isArray(ids) ? ids : [ids]).map((id) => String(id || "").trim()).filter(Boolean);

  if (!recipientUsername) {
    return { count: 0, ids: [] };
  }

  if (usePostgres) {
    await initStore();
    const result = await pool.query(
      notificationIds.length
        ? `
            UPDATE notification_alerts
            SET seen = true
            WHERE LOWER(recipient_username) = $1
              AND id = ANY($2::text[])
            RETURNING id
          `
        : `
            UPDATE notification_alerts
            SET seen = true
            WHERE LOWER(recipient_username) = $1
              AND seen = false
              AND (expires_at IS NULL OR expires_at > NOW())
            RETURNING id
          `,
      notificationIds.length ? [recipientUsername, notificationIds] : [recipientUsername]
    );

    return {
      count: result.rowCount,
      ids: result.rows.map((row) => row.id)
    };
  }

  return queuedWrite(async () => {
    const store = await readJsonStore();
    const seenIds = [];

    for (const notification of store.notificationAlerts || []) {
      const normalized = normalizeNotification(notification);
      const matchesId = !notificationIds.length || notificationIds.includes(normalized.id);
      if (normalized.recipientUsername === recipientUsername && matchesId && !normalized.seen) {
        notification.seen = true;
        seenIds.push(normalized.id);
      }
    }

    await writeJsonStore(store);
    return { count: seenIds.length, ids: seenIds };
  });
}

async function listNotificationHistory(options = {}) {
  const limit = clampLimit(options.limit, 50, 100);

  if (usePostgres) {
    await initStore();
    const result = await pool.query(
      `
        SELECT
          id,
          recipient_username AS "recipientUsername",
          title,
          message,
          type,
          created_at AS "createdAt",
          expires_at AS "expiresAt",
          seen,
          sent_by AS "sentBy"
        FROM notification_alerts
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [limit]
    );

    return result.rows.map(normalizeNotification);
  }

  const store = await readJsonStore();
  return (store.notificationAlerts || [])
    .map(normalizeNotification)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

async function countActiveNotifications() {
  if (usePostgres) {
    await initStore();
    const result = await pool.query(
      `
        SELECT COUNT(*)::integer AS count
        FROM notification_alerts
        WHERE seen = false
          AND (expires_at IS NULL OR expires_at > NOW())
      `
    );
    return Number(result.rows[0] && result.rows[0].count) || 0;
  }

  const now = Date.now();
  const store = await readJsonStore();
  return (store.notificationAlerts || [])
    .map(normalizeNotification)
    .filter((notification) => !notification.seen)
    .filter((notification) => !notification.expiresAt || new Date(notification.expiresAt).getTime() > now)
    .length;
}

async function deleteNotificationAlert(id) {
  const notificationId = String(id || "").trim();

  if (!notificationId) {
    return null;
  }

  if (usePostgres) {
    await initStore();
    const result = await pool.query(
      `
        DELETE FROM notification_alerts
        WHERE id = $1
        RETURNING
          id,
          recipient_username AS "recipientUsername",
          title,
          message,
          type,
          created_at AS "createdAt",
          expires_at AS "expiresAt",
          seen,
          sent_by AS "sentBy"
      `,
      [notificationId]
    );

    return result.rows[0] ? normalizeNotification(result.rows[0]) : null;
  }

  return queuedWrite(async () => {
    const store = await readJsonStore();
    const index = (store.notificationAlerts || []).findIndex((item) => String(item.id) === notificationId);

    if (index === -1) {
      return null;
    }

    const [deleted] = store.notificationAlerts.splice(index, 1);
    await writeJsonStore(store);
    return normalizeNotification(deleted);
  });
}

async function subscribeNotificationAlerts(onNotification) {
  if (!usePostgres) {
    return async () => {};
  }

  await initStore();
  const client = await pool.connect();
  const handleNotification = (message) => {
    if (message.channel !== "notification_alerts_inserted") {
      return;
    }

    let payload = {};
    try {
      payload = JSON.parse(message.payload || "{}");
    } catch {
      payload = {};
    }

    Promise.resolve(onNotification(payload)).catch((error) => {
      console.error("Notification alert delivery failed.", error);
    });
  };

  client.on("notification", handleNotification);
  client.on("error", (error) => {
    console.error("Notification listener database error.", error);
  });
  await client.query("LISTEN notification_alerts_inserted");

  return async () => {
    client.removeListener("notification", handleNotification);
    await client.query("UNLISTEN notification_alerts_inserted").catch(() => {});
    client.release();
  };
}

async function updateUserOnlineStatus(username, isOnline) {
  const normalizedUsername = normalizeUsername(username);

  if (!normalizedUsername || !usePostgres) {
    return false;
  }

  await initStore();

  const result = await pool.query(
    `
      UPDATE inbox_users
      SET
        is_online = $1,
        last_seen = NOW()
      WHERE username = $2
    `,
    [Boolean(isOnline), normalizedUsername]
  );

  return result.rowCount > 0;
}

async function closeStore() {
  if (pool) {
    await pool.end();
  }
}

module.exports = {
  addMessage,
  authenticateUser,
  cleanupExpiredNotifications,
  countActiveNotifications,
  cleanupStorageLogs,
  cleanupExpiredMessages,
  cleanupAnalyticsLogs,
  closeStore,
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
  getUserAvatar,
  getUltimateAdminMonitoring,
  initStore,
  isRestrictedSearchTerm,
  listBackupHistory,
  listNotificationHistory,
  listChatSummaries,
  listConversationMessages,
  listAdminActionLogs,
  listLetterMessages,
  listMessagesForUser,
  listNotificationsForUser,
  listStarredMessages,
  listUserLoginHistory,
  logAdminAction,
  listUsers,
  markConversationRead,
  markNotificationsRead,
  markStaleUsersOffline,
  normalizeUsername,
  heartbeatUserSession,
  recordLoginAttempt,
  recordBackupMetadata,
  startUserSession,
  subscribeNotificationAlerts,
  toggleMessageReaction,
  toggleMessageStar,
  updateUserSecurityStatus,
  updateUserAvatar,
  updateUserPassword,
  updateUserProfile,
  updateUserOnlineStatus,
  updateUserSearchVisibility,
  userHasConversation,
  updateUserSettings
};
