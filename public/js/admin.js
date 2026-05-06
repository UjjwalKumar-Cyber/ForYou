const loginPanel = document.querySelector("#admin-login-panel");
const loginForm = document.querySelector("#admin-login-form");
const loginMessage = document.querySelector("#admin-login-message");
const messagesPanel = document.querySelector("#messages-panel");
const statusMessage = document.querySelector("#admin-status");
const messageList = document.querySelector("#message-list");
const refreshButton = document.querySelector("#refresh-button");
const template = document.querySelector("#message-template");

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
  if (!messages.length) {
    renderEmptyState();
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const message of messages) {
    const node = template.content.firstElementChild.cloneNode(true);
    const time = node.querySelector(".message-time");
    const text = node.querySelector(".message-text");
    const deleteButton = node.querySelector(".delete-button");

    time.dateTime = message.createdAt;
    time.textContent = formatDate(message.createdAt);
    text.textContent = message.text;
    deleteButton.dataset.id = message.id;

    fragment.append(node);
  }

  messageList.replaceChildren(fragment);
}

async function loadMessages() {
  setStatus("Loading messages...", "neutral");

  try {
    const response = await fetch("/api/messages");

    if (response.status === 401) {
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
    renderMessages(result.messages || []);
    setStatus("", "neutral");
  } catch {
    setStatus("Network error. Please try again.", "error");
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(loginForm);
  const password = String(formData.get("password") || "");
  const button = loginForm.querySelector("button");

  if (!password.trim()) {
    setLoginMessage("Admin password required.", "error");
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
        password,
        scope: "admin"
      })
    });

    const result = await response.json();

    if (!response.ok) {
      setLoginMessage(result.error || "Could not open archive.", "error");
      return;
    }

    setLoginMessage("Opened.", "success");
    await loadMessages();
  } catch {
    setLoginMessage("Network error. Please try again.", "error");
  } finally {
    button.disabled = false;
  }
});

refreshButton.addEventListener("click", loadMessages);

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

    await loadMessages();
  } catch {
    setStatus("Network error. Please try again.", "error");
    deleteButton.disabled = false;
  }
});

loadMessages();
