const loginPanel = document.querySelector("#admin-login-panel");
const loginForm = document.querySelector("#admin-login-form");
const loginMessage = document.querySelector("#admin-login-message");
const messagesPanel = document.querySelector("#messages-panel");
const statusMessage = document.querySelector("#admin-status");
const messageList = document.querySelector("#message-list");
const refreshButton = document.querySelector("#refresh-button");
const logoutButton = document.querySelector("#logout-button");
const inboxUser = document.querySelector("#inbox-user");
const template = document.querySelector("#message-template");

const REFRESH_MS = 5000;
let currentUser = null;
let refreshTimer = null;
let lastMessageSignature = "";

function setLoginMessage(text, type) {
  loginMessage.textContent = text;
  loginMessage.dataset.type = type;
}

function setStatus(text, type) {
  statusMessage.textContent = text;
  statusMessage.dataset.type = type;
}

function showMessagesPanel() {
  loginPanel.classList.add("is-hidden");
  messagesPanel.classList.remove("is-hidden");
}

function showLoginPanel() {
  stopAutoRefresh();
  messagesPanel.classList.add("is-hidden");
  loginPanel.classList.remove("is-hidden");
}

function formatDate(isoDate) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(isoDate));
}

function renderEmptyState() {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = "No messages yet.";
  messageList.replaceChildren(empty);
}

function renderMessages(messages) {
  const signature = JSON.stringify(messages.map((message) => [
    message.id,
    message.senderName,
    message.text,
    message.createdAt
  ]));

  if (signature === lastMessageSignature) {
    return false;
  }

  lastMessageSignature = signature;

  if (!messages.length) {
    renderEmptyState();
    return true;
  }

  const fragment = document.createDocumentFragment();

  for (const message of messages) {
    const node = template.content.firstElementChild.cloneNode(true);
    const sender = node.querySelector(".message-sender");
    const time = node.querySelector(".message-time");
    const text = node.querySelector(".message-text");
    const deleteButton = node.querySelector(".delete-button");

    sender.textContent = message.senderName || "Anonymous";
    time.dateTime = message.createdAt;
    time.textContent = formatDate(message.createdAt);
    text.textContent = message.text;
    deleteButton.dataset.id = message.id;

    fragment.append(node);
  }

  messageList.replaceChildren(fragment);
  return true;
}

function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = window.setInterval(() => {
    if (!document.hidden) {
      loadMessages({ silent: true });
    }
  }, REFRESH_MS);
}

function stopAutoRefresh() {
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

async function loadSession() {
  try {
    const response = await fetch("/api/session", {
      cache: "no-store"
    });
    const result = await response.json();

    currentUser = result.user || null;

    if (!currentUser) {
      showLoginPanel();
      return false;
    }

    inboxUser.textContent = `Signed in as ${currentUser.displayName || currentUser.username}`;
    showMessagesPanel();
    startAutoRefresh();
    return true;
  } catch {
    showLoginPanel();
    return false;
  }
}

async function loadMessages(options = {}) {
  const { silent = false } = options;

  if (!silent) {
    setStatus("Loading messages...", "neutral");
  }

  try {
    const response = await fetch("/api/messages", {
      cache: "no-store"
    });

    if (response.status === 401) {
      currentUser = null;
      showLoginPanel();
      setStatus("", "neutral");
      return;
    }

    const result = await response.json();

    if (!response.ok) {
      setStatus(result.error || "Could not load messages.", "error");
      return;
    }

    showMessagesPanel();
    const changed = renderMessages(result.messages || []);

    if (changed || !silent) {
      setStatus("Messages are live.", "success");
    }
  } catch {
    if (!silent) {
      setStatus("Network error. Please try again.", "error");
    }
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(loginForm);
  const username = String(formData.get("username") || "");
  const password = String(formData.get("password") || "");
  const button = loginForm.querySelector("button");

  if (!username.trim() || !password.trim()) {
    setLoginMessage("Username and password required.", "error");
    return;
  }

  button.disabled = true;
  setLoginMessage("Checking...", "neutral");

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username,
        password,
        scope: "account"
      })
    });

    const result = await response.json();

    if (!response.ok) {
      setLoginMessage(result.error || "Could not open inbox.", "error");
      return;
    }

    currentUser = result.user;
    inboxUser.textContent = `Signed in as ${currentUser.displayName || currentUser.username}`;
    setLoginMessage("Opened.", "success");
    showMessagesPanel();
    startAutoRefresh();
    await loadMessages();
  } catch {
    setLoginMessage("Network error. Please try again.", "error");
  } finally {
    button.disabled = false;
  }
});

refreshButton.addEventListener("click", () => loadMessages());

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;

  try {
    await fetch("/api/logout", {
      method: "POST"
    });
  } finally {
    currentUser = null;
    lastMessageSignature = "";
    loginForm.reset();
    logoutButton.disabled = false;
    showLoginPanel();
  }
});

messageList.addEventListener("click", async (event) => {
  const deleteButton = event.target.closest(".delete-button");

  if (!deleteButton) {
    return;
  }

  const { id } = deleteButton.dataset;
  deleteButton.disabled = true;
  setStatus("Deleting...", "neutral");

  try {
    const response = await fetch(`/api/messages/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });

    const result = await response.json();

    if (!response.ok) {
      setStatus(result.error || "Could not delete message.", "error");
      deleteButton.disabled = false;
      return;
    }

    lastMessageSignature = "";
    await loadMessages();
  } catch {
    setStatus("Network error. Please try again.", "error");
    deleteButton.disabled = false;
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && currentUser) {
    loadMessages({ silent: true });
  }
});

loadSession().then((isLoggedIn) => {
  if (isLoggedIn) {
    loadMessages();
  }
});
