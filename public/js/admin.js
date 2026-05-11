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
const accountMessageForm = document.querySelector("#account-message-form");
const accountRecipient = document.querySelector("#account-recipient");
const accountMessage = document.querySelector("#account-message");
const accountMessageStatus = document.querySelector("#account-message-status");
const accountCharacterCount = document.querySelector("#account-character-count");

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

function setAccountMessageStatus(text, type) {
  accountMessageStatus.textContent = text;
  accountMessageStatus.dataset.type = type;
}

function countCharacters(value) {
  return Array.from(value).length;
}

function updateAccountCounter() {
  const count = countCharacters(accountMessage.value);
  accountCharacterCount.textContent = String(count);
  accountCharacterCount.parentElement.dataset.warning = count > 450 ? "true" : "false";
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

function setRecipients(recipients) {
  const visibleRecipients = recipients.filter((recipient) => {
    return !currentUser || recipient.username !== currentUser.username || recipients.length === 1;
  });

  if (!visibleRecipients.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No other inboxes available";
    accountRecipient.replaceChildren(option);
    accountMessageForm.querySelector("button").disabled = true;
    setAccountMessageStatus("No other inboxes are available yet.", "error");
    return;
  }

  const options = visibleRecipients.map((recipient) => {
    const option = document.createElement("option");
    option.value = recipient.username;
    option.textContent = recipient.displayName || recipient.username;
    return option;
  });

  accountRecipient.replaceChildren(...options);
  accountMessageForm.querySelector("button").disabled = false;
  setAccountMessageStatus("", "neutral");
}

async function loadRecipients() {
  try {
    const response = await fetch("/api/recipients", {
      cache: "no-store"
    });

    if (response.status === 401) {
      showLoginPanel();
      return;
    }

    const result = await response.json();

    if (!response.ok) {
      setAccountMessageStatus(result.error || "Could not load inboxes.", "error");
      return;
    }

    setRecipients(result.recipients || []);
  } catch {
    setAccountMessageStatus("Could not load inboxes.", "error");
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
    await loadRecipients();
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
    await loadRecipients();
    await loadMessages();
  } catch {
    setLoginMessage("Network error. Please try again.", "error");
  } finally {
    button.disabled = false;
  }
});

refreshButton.addEventListener("click", () => loadMessages());

accountMessage.addEventListener("input", updateAccountCounter);
updateAccountCounter();

accountMessageForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const recipientUsername = accountRecipient.value;
  const message = accountMessage.value.trim();
  const button = accountMessageForm.querySelector("button");

  if (!recipientUsername) {
    setAccountMessageStatus("Choose who should receive it.", "error");
    return;
  }

  if (!message) {
    setAccountMessageStatus("Write a message first.", "error");
    return;
  }

  if (countCharacters(message) > 500) {
    setAccountMessageStatus("Please keep it to 500 characters.", "error");
    return;
  }

  button.disabled = true;
  setAccountMessageStatus("Sending...", "neutral");

  try {
    const response = await fetch("/api/message", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        recipientUsername,
        message
      })
    });

    const result = await response.json();

    if (!response.ok) {
      setAccountMessageStatus(result.error || "Could not send message.", "error");
      return;
    }

    accountMessage.value = "";
    updateAccountCounter();
    setAccountMessageStatus(result.message || "Sent.", "success");
    lastMessageSignature = "";
    await loadMessages({ silent: true });
  } catch {
    setAccountMessageStatus("Network error. Please try again.", "error");
  } finally {
    button.disabled = false;
  }
});

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
