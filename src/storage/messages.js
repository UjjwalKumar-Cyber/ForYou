const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const dataDir = path.resolve(process.cwd(), process.env.DATA_DIR || "data");
const messagesFile = path.join(dataDir, "messages.json");

let writeQueue = Promise.resolve();

async function initStore() {
  await fs.mkdir(dataDir, { recursive: true });

  try {
    await fs.access(messagesFile);
  } catch {
    await fs.writeFile(messagesFile, "[]\n", "utf8");
  }
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
  const messages = await readMessages();
  return messages.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function addMessage(text) {
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
