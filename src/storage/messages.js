const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const dataDir = path.resolve(process.cwd(), process.env.DATA_DIR || "data");
const messagesFile = path.join(dataDir, "messages.json");
const usePostgres = Boolean(process.env.DATABASE_URL);

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

async function setupStore() {
  if (usePostgres) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY,
        text TEXT NOT NULL CHECK (char_length(text) <= 500),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    return;
  }

  await fs.mkdir(dataDir, { recursive: true });

  try {
    await fs.access(messagesFile);
  } catch {
    await fs.writeFile(messagesFile, "[]\n", "utf8");
  }
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

async function readMessages() {
  await initStore();
  const raw = await fs.readFile(messagesFile, "utf8");

  if (!raw.trim()) {
    return [];
  }

  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error("Message storage must contain a JSON array.");
  }

  return parsed;
}

async function writeMessages(messages) {
  await fs.writeFile(messagesFile, `${JSON.stringify(messages, null, 2)}\n`, "utf8");
}

function queuedWrite(task) {
  const run = writeQueue.then(task, task);
  writeQueue = run.catch(() => {});
  return run;
}

async function listMessages() {
  if (usePostgres) {
    await initStore();
    const result = await pool.query(`
      SELECT id, text, created_at AS "createdAt"
      FROM messages
      ORDER BY created_at DESC
    `);

    return result.rows.map((message) => ({
      id: message.id,
      text: message.text,
      createdAt: new Date(message.createdAt).toISOString()
    }));
  }

  const messages = await readMessages();
  return messages.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function addMessage(text) {
  if (usePostgres) {
    await initStore();
    const message = {
      id: crypto.randomUUID(),
      text,
      createdAt: new Date().toISOString()
    };

    await pool.query(
      "INSERT INTO messages (id, text, created_at) VALUES ($1, $2, $3)",
      [message.id, message.text, message.createdAt]
    );

    return message;
  }

  return queuedWrite(async () => {
    const messages = await readMessages();
    const message = {
      id: crypto.randomUUID(),
      text,
      createdAt: new Date().toISOString()
    };

    messages.push(message);
    await writeMessages(messages);

    return message;
  });
}

async function deleteMessage(id) {
  if (usePostgres) {
    await initStore();
    const result = await pool.query("DELETE FROM messages WHERE id = $1", [id]);
    return result.rowCount > 0;
  }

  return queuedWrite(async () => {
    const messages = await readMessages();
    const nextMessages = messages.filter((message) => message.id !== id);

    if (nextMessages.length === messages.length) {
      return false;
    }

    await writeMessages(nextMessages);
    return true;
  });
}

module.exports = {
  addMessage,
  deleteMessage,
  initStore,
  listMessages
};
