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
      seedType: "configured"
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

function normalizeMessage(message) {
  return {
    id: message.id,
    text: String(message.text || ""),
    senderName: message.senderName || message.sender_name || "Anonymous",
    recipientUsername: normalizeUsername(
      message.recipientUsername || message.recipient_username || "admin"
    ),
    createdAt: message.createdAt || message.created_at || new Date().toISOString(),
    image: normalizeImage(message)
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
    users: Array.isArray(rawStore.users) ? rawStore.users : [],
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

  await seedUsers();
}

async function setupJsonStore() {
  await fs.mkdir(dataDir, { recursive: true });

  try {
    await fs.access(messagesFile);
  } catch {
    await fs.writeFile(messagesFile, JSON.stringify({ users: [], messages: [] }, null, 2) + "\n", "utf8");
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
    const countResult = await pool.query("SELECT count(*)::int AS count FROM inbox_users");
    const hasExistingUsers = Number(countResult.rows[0] && countResult.rows[0].count) > 0;

    if (hasExistingUsers) {
      seedUsersList = seedUsersList.filter((user) => user.seedType !== "built-in");
    }

    for (const user of seedUsersList) {
      await pool.query(
        `
          INSERT INTO inbox_users (username, display_name, password_hash)
          VALUES ($1, $2, $3)
          ON CONFLICT (username)
          DO UPDATE SET display_name = EXCLUDED.display_name, password_hash = EXCLUDED.password_hash
        `,
        [user.username, user.displayName, user.passwordHash || hashPassword(user.password)]
      );
    }
    return;
  }

  await queuedWrite(async () => {
    const store = await readJsonStore(false);
    const hasExistingUsers = store.users.length > 0;

    if (hasExistingUsers) {
      seedUsersList = seedUsersList.filter((user) => user.seedType !== "built-in");
    }

    for (const user of seedUsersList) {
      const existingUser = store.users.find((item) => item.username === user.username);
      const nextUser = {
        username: user.username,
        displayName: user.displayName,
        passwordHash: user.passwordHash || hashPassword(user.password),
        createdAt: new Date().toISOString()
      };

      if (existingUser) {
        existingUser.displayName = nextUser.displayName;
        existingUser.passwordHash = nextUser.passwordHash;
      } else {
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
      SELECT username, display_name AS "displayName"
      FROM inbox_users
      ORDER BY display_name ASC, username ASC
    `);

    return result.rows;
  }

  const store = await readJsonStore();

  return store.users
    .map((user) => ({
      username: user.username,
      displayName: user.displayName || user.username
    }))
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
        SELECT username, display_name AS "displayName", password_hash AS "passwordHash"
        FROM inbox_users
        WHERE username = $1
      `,
      [normalizedUsername]
    );

    return result.rows[0] || null;
  }

  const store = await readJsonStore();
  const user = store.users.find((item) => item.username === normalizedUsername);

  if (!user) {
    return null;
  }

  return {
    username: user.username,
    displayName: user.displayName || user.username,
    passwordHash: user.passwordHash
  };
}

async function authenticateUser(username, password) {
  const user = await findUser(username);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return null;
  }

  return {
    username: user.username,
    displayName: user.displayName
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
      "UPDATE inbox_users SET password_hash = $1 WHERE username = $2",
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
    await writeJsonStore(store);
    return true;
  });
}

async function listMessagesForUser(username) {
  const recipientUsername = normalizeUsername(username);

  if (usePostgres) {
    await initStore();
    const result = await pool.query(
      `
        SELECT
          id,
          text,
          sender_name AS "senderName",
          recipient_username AS "recipientUsername",
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

  return store.messages
    .filter((message) => message.recipientUsername === recipientUsername)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function addMessage({ text, senderName, recipientUsername, image = null }) {
  const message = {
    id: crypto.randomUUID(),
    text: String(text || ""),
    senderName,
    recipientUsername: normalizeUsername(recipientUsername),
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
          recipient_username,
          image_data,
          image_mime,
          image_name,
          image_size,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        message.id,
        message.text,
        message.senderName,
        message.recipientUsername,
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

async function deleteMessage(id, username) {
  const recipientUsername = normalizeUsername(username);

  if (usePostgres) {
    await initStore();
    const result = await pool.query(
      "DELETE FROM messages WHERE id = $1 AND recipient_username = $2",
      [id, recipientUsername]
    );
    return result.rowCount > 0;
  }

  return queuedWrite(async () => {
    const store = await readJsonStore();
    const nextMessages = store.messages.filter(
      (message) => !(message.id === id && message.recipientUsername === recipientUsername)
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
  deleteMessage,
  findUser,
  initStore,
  listMessagesForUser,
  listUsers,
  normalizeUsername,
  updateUserPassword,
  updateUserProfile
};
