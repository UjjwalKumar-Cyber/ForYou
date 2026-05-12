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

function parseSeedUsers() {
  const users = builtInUsers.map((user) => ({
    ...user,
    seedType: "built-in"
  }));
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (adminPassword) {
    users.push({
      username: normalizeUsername(process.env.ADMIN_USERNAME || "admin"),
      displayName: String(process.env.ADMIN_DISPLAY_NAME || process.env.ADMIN_USERNAME || "Admin").trim(),
      password: adminPassword,
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
        seedType: "configured"
      });
    }
  }

  return users.filter((user) => user.username && (user.password || user.passwordHash));
}

function normalizeImage(message) {
  const image = message.image || {};
  const data = image.data || message.imageData || message.image_data || null;

  if (!data) {
    return null;
  }

  const size = Number(image.size || message.imageSize || message.image_size || 0);

  return {
    data,
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

  if (!data) {
    return null;
  }

  const size = Number(
    attachment.size ||
      message.attachmentSize ||
      message.attachment_size ||
      message.imageSize ||
      message.image_size ||
      0
  );

  return {
    data,
    mime:
      attachment.mime ||
      message.attachmentMime ||
      message.attachment_mime ||
      message.imageMime ||
      message.image_mime ||
      "application/octet-stream",
    name:
      attachment.name ||
      message.attachmentName ||
      message.attachment_name ||
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
    passwordHash: user.passwordHash || user.password_hash || "",
    bio: user.bio || "",
    email: user.email || "",
    emailVerified: Boolean(user.emailVerified || user.email_verified),
    profileImageData: user.profileImageData || user.profile_image_data || "",
    profileImageMime: user.profileImageMime || user.profile_image_mime || "",
    profileImageName: user.profileImageName || user.profile_image_name || "",
    anonymousMode: Boolean(user.anonymousMode || user.anonymous_mode),
    theme: user.theme || "vintage-dark",
    wallpaper: user.wallpaper || "paper",
    fontStyle: user.fontStyle || user.font_style || "serif",
    themeColor: user.themeColor || user.theme_color || "rose",
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
    messages: Array.isArray(rawStore.messages) ? rawStore.messages.map(normalizeMessage) : []
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
    ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS profile_image_data TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS profile_image_mime TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS profile_image_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS anonymous_mode BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'vintage-dark',
    ADD COLUMN IF NOT EXISTS wallpaper TEXT NOT NULL DEFAULT 'paper',
    ADD COLUMN IF NOT EXISTS font_style TEXT NOT NULL DEFAULT 'serif',
    ADD COLUMN IF NOT EXISTS theme_color TEXT NOT NULL DEFAULT 'rose',
    ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ
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
    ADD COLUMN IF NOT EXISTS sender_name TEXT NOT NULL DEFAULT 'Anonymous'
  `);

  await pool.query(`
    ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS recipient_username TEXT NOT NULL DEFAULT 'admin'
  `);

  await pool.query(`
    ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS image_data TEXT,
    ADD COLUMN IF NOT EXISTS image_mime TEXT,
    ADD COLUMN IF NOT EXISTS image_name TEXT,
    ADD COLUMN IF NOT EXISTS image_size INTEGER
  `);

  await pool.query(`
    ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS sender_username TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'text',
    ADD COLUMN IF NOT EXISTS attachment_data TEXT,
    ADD COLUMN IF NOT EXISTS attachment_mime TEXT,
    ADD COLUMN IF NOT EXISTS attachment_name TEXT,
    ADD COLUMN IF NOT EXISTS attachment_size INTEGER,
    ADD COLUMN IF NOT EXISTS reply_to_id UUID,
    ADD COLUMN IF NOT EXISTS reactions TEXT NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS starred_by TEXT NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ
  `);

  await seedUsers();
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
          ? "DO UPDATE SET display_name = EXCLUDED.display_name, password_hash = EXCLUDED.password_hash"
          : `
              DO UPDATE SET display_name = EXCLUDED.display_name, password_hash = EXCLUDED.password_hash
              WHERE inbox_users.password_changed_at IS NULL
            `;

      await pool.query(
        `
          INSERT INTO inbox_users (username, display_name, password_hash)
          VALUES ($1, $2, $3)
          ON CONFLICT (username)
          ${conflictAction}
        `,
        [user.username, user.displayName, passwordHash]
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
        passwordHash: user.passwordHash || hashPassword(user.password),
        createdAt: new Date().toISOString()
      };

      if (
        existingUser &&
        (user.seedType === "admin" || (!existingUser.passwordChangedAt && user.seedType !== "admin"))
      ) {
        existingUser.displayName = nextUser.displayName;
        existingUser.passwordHash = nextUser.passwordHash;
      } else if (!existingUser) {
        store.users.push(nextUser);
      }
    }

    await writeJsonStore(store);
  });
}

async function listUsers() {
  await initStore();

  if (usePostgres) {
    const result = await pool.query(`
      SELECT
        username,
        display_name AS "displayName",
        bio,
        email,
        email_verified AS "emailVerified",
        profile_image_data AS "profileImageData",
        profile_image_mime AS "profileImageMime",
        profile_image_name AS "profileImageName",
        anonymous_mode AS "anonymousMode",
        theme,
        wallpaper,
        font_style AS "fontStyle",
        theme_color AS "themeColor"
      FROM inbox_users
      ORDER BY display_name ASC, username ASC
    `);

    return result.rows.map(normalizeUser);
  }

  const store = await readJsonStore();

  return store.users
    .map(normalizeUser)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

async function findUser(username) {
  const normalizedUsername = normalizeUsername(username);

  if (!normalizedUsername) {
    return null;
  }

  await initStore();

  if (usePostgres) {
    const result = await pool.query(
      `
        SELECT
          username,
          display_name AS "displayName",
          password_hash AS "passwordHash",
          bio,
          email,
          email_verified AS "emailVerified",
          profile_image_data AS "profileImageData",
          profile_image_mime AS "profileImageMime",
          profile_image_name AS "profileImageName",
          anonymous_mode AS "anonymousMode",
          theme,
          wallpaper,
          font_style AS "fontStyle",
          theme_color AS "themeColor"
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

  return normalizeUser(user);
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
    email: user.email,
    emailVerified: user.emailVerified,
    profileImageData: user.profileImageData,
    profileImageMime: user.profileImageMime,
    profileImageName: user.profileImageName,
    anonymousMode: user.anonymousMode,
    theme: user.theme,
    wallpaper: user.wallpaper,
    fontStyle: user.fontStyle,
    themeColor: user.themeColor
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
          password_hash AS "passwordHash",
          bio,
          email,
          email_verified AS "emailVerified",
          profile_image_data AS "profileImageData",
          profile_image_mime AS "profileImageMime",
          profile_image_name AS "profileImageName",
          anonymous_mode AS "anonymousMode",
          theme,
          wallpaper,
          font_style AS "fontStyle",
          theme_color AS "themeColor"
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

  const image = avatar || { data: "", mime: "", name: "" };

  if (usePostgres) {
    await initStore();
    const result = await pool.query(
      `
        UPDATE inbox_users
        SET profile_image_data = $1, profile_image_mime = $2, profile_image_name = $3
        WHERE username = $4
        RETURNING
          username,
          display_name AS "displayName",
          password_hash AS "passwordHash",
          bio,
          email,
          email_verified AS "emailVerified",
          profile_image_data AS "profileImageData",
          profile_image_mime AS "profileImageMime",
          profile_image_name AS "profileImageName",
          anonymous_mode AS "anonymousMode",
          theme,
          wallpaper,
          font_style AS "fontStyle",
          theme_color AS "themeColor"
      `,
      [image.data || "", image.mime || "", image.name || "", normalizedUsername]
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
    user.profileImageMime = image.mime || "";
    user.profileImageName = image.name || "";
    await writeJsonStore(store);
    return normalizeUser(user);
  });
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
          AND COALESCE(starred_by, '[]') = '[]'
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
  await cleanupExpiredMessages();

  if (usePostgres) {
    await initStore();
    const values = [owner, peer];
    let searchSql = "";

    if (String(query || "").trim()) {
      values.push(`%${String(query).trim().toLowerCase()}%`);
      searchSql = ` AND LOWER(COALESCE(text, '') || ' ' || COALESCE(sender_name, '') || ' ' || COALESCE(attachment_name, '')) LIKE $3`;
    }

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
          attachment_mime AS "attachmentMime",
          attachment_name AS "attachmentName",
          attachment_size AS "attachmentSize",
          reply_to_id AS "replyToId",
          reactions,
          starred_by AS "starredBy",
          expires_at AS "expiresAt",
          read_at AS "readAt",
          image_data AS "imageData",
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
        ORDER BY created_at ASC
      `,
      values
    );

    return result.rows.map(normalizeMessage);
  }

  const store = await readJsonStore();
  const messages = store.messages.filter(
    (message) =>
      (message.senderUsername === owner && message.recipientUsername === peer) ||
      (message.senderUsername === peer && message.recipientUsername === owner)
  );

  return filterMessagesBySearch(messages, query).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

async function listLetterMessages(username, query = "") {
  const owner = normalizeUsername(username);
  await cleanupExpiredMessages();

  if (usePostgres) {
    await initStore();
    const values = [owner];
    let searchSql = "";

    if (String(query || "").trim()) {
      values.push(`%${String(query).trim().toLowerCase()}%`);
      searchSql = ` AND LOWER(COALESCE(text, '') || ' ' || COALESCE(sender_name, '') || ' ' || COALESCE(attachment_name, '')) LIKE $2`;
    }

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
          attachment_mime AS "attachmentMime",
          attachment_name AS "attachmentName",
          attachment_size AS "attachmentSize",
          reply_to_id AS "replyToId",
          reactions,
          starred_by AS "starredBy",
          expires_at AS "expiresAt",
          read_at AS "readAt",
          image_data AS "imageData",
          image_mime AS "imageMime",
          image_name AS "imageName",
          image_size AS "imageSize",
          created_at AS "createdAt"
        FROM messages
        WHERE recipient_username = $1 AND COALESCE(sender_username, '') = ''
        ${searchSql}
        ORDER BY created_at ASC
      `,
      values
    );

    return result.rows.map(normalizeMessage);
  }

  const store = await readJsonStore();
  const messages = store.messages.filter(
    (message) => message.recipientUsername === owner && !message.senderUsername
  );

  return filterMessagesBySearch(messages, query).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

async function listChatSummaries(username) {
  const owner = normalizeUsername(username);
  await cleanupExpiredMessages();

  const allMessages = usePostgres
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
          `,
          [owner]
        )
      ).rows.map(normalizeMessage)
    : (await readJsonStore()).messages
        .filter((message) => message.senderUsername === owner || message.recipientUsername === owner)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

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

  return Array.from(summaries.values());
}

async function listMessagesForUser(username) {
  const recipientUsername = normalizeUsername(username);

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
          attachment_mime AS "attachmentMime",
          attachment_name AS "attachmentName",
          attachment_size AS "attachmentSize",
          reply_to_id AS "replyToId",
          reactions,
          starred_by AS "starredBy",
          expires_at AS "expiresAt",
          read_at AS "readAt",
          image_data AS "imageData",
          image_mime AS "imageMime",
          image_name AS "imageName",
          image_size AS "imageSize",
          created_at AS "createdAt"
        FROM messages
        WHERE recipient_username = $1
        ORDER BY created_at DESC
      `,
      [recipientUsername]
    );

    return result.rows.map(normalizeMessage);
  }

  const store = await readJsonStore();
  await cleanupExpiredMessages();

  return store.messages
    .filter((message) => message.recipientUsername === recipientUsername)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
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
          attachment_mime,
          attachment_name,
          attachment_size,
          reply_to_id,
          reactions,
          starred_by,
          expires_at,
          read_at,
          image_data,
          image_mime,
          image_name,
          image_size,
          created_at
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20
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
        message.attachment ? message.attachment.mime : null,
        message.attachment ? message.attachment.name : null,
        message.attachment ? message.attachment.size : null,
        message.replyToId,
        JSON.stringify(message.reactions),
        JSON.stringify(message.starredBy),
        message.expiresAt,
        message.readAt,
        message.image ? message.image.data : null,
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

async function listStarredMessages(username) {
  const owner = normalizeUsername(username);
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
          `,
          [owner]
        )
      ).rows.map(normalizeMessage)
    : (await readJsonStore()).messages.filter(
        (message) => message.senderUsername === owner || message.recipientUsername === owner
      );

  return messages.filter((message) => (message.starredBy || []).includes(owner));
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

module.exports = {
  addMessage,
  authenticateUser,
  cleanupExpiredMessages,
  deleteMessage,
  findUser,
  findAccessibleMessage,
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
};
