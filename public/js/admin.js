const loginPanel = document.querySelector("#admin-login-panel");
const loginForm = document.querySelector("#admin-login-form");
const loginMessage = document.querySelector("#admin-login-message");
const messagesPanel = document.querySelector("#messages-panel");
const statusMessage = document.querySelector("#admin-status");
const messageList = document.querySelector("#message-list");
const refreshButton = document.querySelector("#refresh-button");
const logoutButton = document.querySelector("#logout-button");
const inboxUser = document.querySelector("#inbox-user");
const activeStatus = document.querySelector("#active-status");
const template = document.querySelector("#message-template");
const accountMessageForm = document.querySelector("#account-message-form");
const accountRecipient = document.querySelector("#account-recipient");
const accountMessage = document.querySelector("#account-message");
const accountGalleryImage = document.querySelector("#account-gallery-image");
const accountCameraImage = document.querySelector("#account-camera-image");
const clearAccountImage = document.querySelector("#clear-account-image");
const accountImageName = document.querySelector("#account-image-name");
const accountSendButton = document.querySelector("#account-send-button");
const accountMessageStatus = document.querySelector("#account-message-status");
const accountCharacterCount = document.querySelector("#account-character-count");
const menuButton = document.querySelector("#account-menu-button");
const closeMenuButton = document.querySelector("#account-menu-close");
const accountDrawer = document.querySelector("#account-drawer");
const drawerBackdrop = document.querySelector("#drawer-backdrop");
const accountPresenceDot = document.querySelector("#account-presence-dot");
const hideActiveToggle = document.querySelector("#hide-active-toggle");
const privacyStatus = document.querySelector("#privacy-status");
const accountProfileForm = document.querySelector("#account-profile-form");
const accountUsername = document.querySelector("#account-username");
const profileStatus = document.querySelector("#profile-status");
const saveProfileButton = document.querySelector("#save-profile-button");
const accountPasswordForm = document.querySelector("#account-password-form");
const accountNewPassword = document.querySelector("#account-new-password");
const passwordStatus = document.querySelector("#password-status");
const savePasswordButton = document.querySelector("#save-password-button");
const composeJumpButton = document.querySelector("#compose-jump-button");

const REFRESH_MS = 5000;
const IMAGE_MAX_BYTES = 3 * 1024 * 1024;
const SEEN_LIMIT = 500;
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

function setInlineStatus(element, text, type = "neutral") {
  element.textContent = text;
  element.dataset.type = type;
}

function countCharacters(value) {
  return Array.from(value).length;
}

function updateAccountCounter() {
  const count = countCharacters(accountMessage.value);
  accountCharacterCount.textContent = String(count);
  accountCharacterCount.parentElement.dataset.warning = count > 450 ? "true" : "false";
}

function updateAccountHeader() {
  if (!currentUser) {
    inboxUser.textContent = "Signed in";
    activeStatus.textContent = "";
    return;
  }

  inboxUser.textContent = currentUser.displayName || currentUser.username;
  accountUsername.value = currentUser.displayName || currentUser.username;
  hideActiveToggle.checked = Boolean(currentUser.hideActiveStatus);
  activeStatus.textContent = currentUser.hideActiveStatus
    ? "Hidden from others"
    : currentUser.isActive
      ? "Active now"
      : "Recently active";
  accountPresenceDot.classList.toggle("is-active", !currentUser.hideActiveStatus && currentUser.isActive);
}

function showMessagesPanel() {
  loginPanel.classList.add("is-hidden");
  messagesPanel.classList.remove("is-hidden");
  updateAccountHeader();
}

function showLoginPanel() {
  stopAutoRefresh();
  closeDrawer();
  messagesPanel.classList.add("is-hidden");
  loginPanel.classList.remove("is-hidden");
}

function openDrawer() {
  accountDrawer.classList.remove("is-hidden");
  drawerBackdrop.classList.remove("is-hidden");
  accountDrawer.setAttribute("aria-hidden", "false");
  menuButton.setAttribute("aria-expanded", "true");
}

function closeDrawer() {
  accountDrawer.classList.add("is-hidden");
  drawerBackdrop.classList.add("is-hidden");
  accountDrawer.setAttribute("aria-hidden", "true");
  menuButton.setAttribute("aria-expanded", "false");
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

function seenStorageKey() {
  return `foryou_seen_messages_${currentUser ? currentUser.username : "guest"}`;
}

function readSeenMessageIds() {
  const raw = window.localStorage.getItem(seenStorageKey());

  if (!raw) {
    return {
      firstLoad: true,
      seen: new Set()
    };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      firstLoad: false,
      seen: new Set(Array.isArray(parsed) ? parsed.map(String) : [])
    };
  } catch {
    return {
      firstLoad: true,
      seen: new Set()
    };
  }
}

function saveSeenMessageIds(ids) {
  window.localStorage.setItem(seenStorageKey(), JSON.stringify(Array.from(ids).slice(0, SEEN_LIMIT)));
}

function rememberRenderedMessages(messages, seen) {
  const nextSeen = new Set(messages.map((message) => String(message.id)));

  for (const id of seen) {
    if (nextSeen.size >= SEEN_LIMIT) {
      break;
    }

    nextSeen.add(id);
  }

  saveSeenMessageIds(nextSeen);
}

function messageSignature(messages) {
  return JSON.stringify(messages.map((message) => [
    message.id,
    message.senderName,
    message.text,
    message.createdAt,
    message.image ? message.image.name : "",
    message.image ? message.image.size : 0
  ]));
}

function renderMessages(messages) {
  const signature = messageSignature(messages);

  if (signature === lastMessageSignature) {
    return false;
  }

  lastMessageSignature = signature;

  if (!messages.length) {
    renderEmptyState();
    saveSeenMessageIds(new Set());
    return true;
  }

  const { firstLoad, seen } = readSeenMessageIds();
  const fragment = document.createDocumentFragment();

  for (const message of messages) {
    const node = template.content.firstElementChild.cloneNode(true);
    const sender = node.querySelector(".message-sender");
    const avatar = node.querySelector(".sender-avatar");
    const time = node.querySelector(".message-time");
    const text = node.querySelector(".message-text");
    const media = node.querySelector(".message-media");
    const image = node.querySelector(".message-image");
    const newBadge = node.querySelector(".new-badge");
    const deleteButton = node.querySelector(".delete-button");
    const isNew = !firstLoad && !seen.has(String(message.id));

    sender.textContent = message.senderName || "Anonymous";
    avatar.textContent = (message.senderName || "A").trim().slice(0, 1).toUpperCase();
    time.dateTime = message.createdAt;
    time.textContent = formatDate(message.createdAt);

    if (message.text) {
      text.textContent = message.text;
    } else {
      text.classList.add("is-hidden");
    }

    if (message.image && message.image.data) {
      image.src = message.image.data;
      image.alt = message.image.name || "Attached message photo";
      media.classList.remove("is-hidden");
    }

    if (isNew) {
      node.classList.add("is-new");
      newBadge.classList.remove("is-hidden");
    }

    deleteButton.dataset.id = message.id;
    fragment.append(node);
  }

  messageList.replaceChildren(fragment);
  rememberRenderedMessages(messages, seen);
  return true;
}

function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = window.setInterval(() => {
    if (!document.hidden) {
      loadMessages({ silent: true });
      loadRecipients({ silent: true });
    }
  }, REFRESH_MS);
}

function stopAutoRefresh() {
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function recipientLabel(recipient) {
  const name = recipient.displayName || recipient.username;
  const activeText = recipient.isActive ? "● active" : "○ offline";
  return `${name} ${activeText}`;
}

function setRecipients(recipients) {
  const selectedRecipient = accountRecipient.value;
  const visibleRecipients = recipients.filter((recipient) => {
    if (currentUser && recipient.username === currentUser.username && recipients.length > 1) {
      return false;
    }

    if (currentUser && currentUser.username !== "admin" && recipient.username === "admin") {
      return false;
    }

    return true;
  });

  if (!visibleRecipients.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No other inboxes available";
    accountRecipient.replaceChildren(option);
    accountSendButton.disabled = true;
    setAccountMessageStatus("No other inboxes are available yet.", "error");
    return;
  }

  const options = visibleRecipients.map((recipient) => {
    const option = document.createElement("option");
    option.value = recipient.username;
    option.textContent = recipientLabel(recipient);
    return option;
  });

  accountRecipient.replaceChildren(...options);

  if (visibleRecipients.some((recipient) => recipient.username === selectedRecipient)) {
    accountRecipient.value = selectedRecipient;
  }

  accountSendButton.disabled = false;
  setAccountMessageStatus("", "neutral");
}

async function loadRecipients(options = {}) {
  const { silent = false } = options;

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
      if (!silent) {
        setAccountMessageStatus(result.error || "Could not load inboxes.", "error");
      }
      return;
    }

    setRecipients(result.recipients || []);
  } catch {
    if (!silent) {
      setAccountMessageStatus("Could not load inboxes.", "error");
    }
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

function selectedAccountImageFile() {
  return (accountCameraImage.files && accountCameraImage.files[0])
    || (accountGalleryImage.files && accountGalleryImage.files[0])
    || null;
}

function selectedImageError(file) {

  if (!file) {
    return "";
  }

  if (file.type && !file.type.startsWith("image/")) {
    return "Please choose a photo image file.";
  }

  if (file.size > IMAGE_MAX_BYTES) {
    return "Please choose a photo under 3 MB.";
  }

  return "";
}

function updateAccountImageName() {
  const file = selectedAccountImageFile();

  if (!file) {
    accountImageName.textContent = "Optional photo or camera capture, up to 3 MB.";
    return;
  }

  const error = selectedImageError(file);

  if (error) {
    accountGalleryImage.value = "";
    accountCameraImage.value = "";
    accountImageName.textContent = "Optional photo or camera capture, up to 3 MB.";
    setAccountMessageStatus(error, "error");
    return;
  }

  accountImageName.textContent = file.name;
  setAccountMessageStatus("", "neutral");
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

refreshButton.addEventListener("click", async () => {
  await loadMessages();
  await loadRecipients({ silent: true });
});

menuButton.addEventListener("click", openDrawer);
closeMenuButton.addEventListener("click", closeDrawer);
drawerBackdrop.addEventListener("click", closeDrawer);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeDrawer();
  }
});

accountMessage.addEventListener("input", updateAccountCounter);
accountGalleryImage.addEventListener("change", () => {
  if (accountGalleryImage.files && accountGalleryImage.files[0]) {
    accountCameraImage.value = "";
  }
  updateAccountImageName();
});
accountCameraImage.addEventListener("change", () => {
  if (accountCameraImage.files && accountCameraImage.files[0]) {
    accountGalleryImage.value = "";
  }
  updateAccountImageName();
});
clearAccountImage.addEventListener("click", () => {
  accountGalleryImage.value = "";
  accountCameraImage.value = "";
  updateAccountImageName();
});
composeJumpButton.addEventListener("click", () => {
  accountMessageForm.scrollIntoView({ behavior: "smooth", block: "start" });
  accountMessage.focus();
});
updateAccountCounter();
updateAccountImageName();

accountMessageForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const recipientUsername = accountRecipient.value;
  const message = accountMessage.value.trim();
  const imageFile = selectedAccountImageFile();
  const imageError = selectedImageError(imageFile);

  if (!recipientUsername) {
    setAccountMessageStatus("Choose who should receive it.", "error");
    return;
  }

  if (!message && !imageFile) {
    setAccountMessageStatus("Write a message or attach a photo first.", "error");
    return;
  }

  if (countCharacters(message) > 500) {
    setAccountMessageStatus("Please keep it to 500 characters.", "error");
    return;
  }

  if (imageError) {
    setAccountMessageStatus(imageError, "error");
    return;
  }

  const payload = new FormData();
  payload.append("recipientUsername", recipientUsername);
  payload.append("message", message);

  if (imageFile) {
    payload.append("image", imageFile);
  }

  accountSendButton.disabled = true;
  setAccountMessageStatus("Sending...", "neutral");

  try {
    const response = await fetch("/api/message", {
      method: "POST",
      body: payload
    });

    const result = await response.json();

    if (!response.ok) {
      setAccountMessageStatus(result.error || "Could not send message.", "error");
      return;
    }

    accountMessage.value = "";
    accountGalleryImage.value = "";
    accountCameraImage.value = "";
    updateAccountCounter();
    updateAccountImageName();
    setAccountMessageStatus(result.message || "Sent.", "success");
    lastMessageSignature = "";
    await loadMessages({ silent: true });
    await loadRecipients({ silent: true });
  } catch {
    setAccountMessageStatus("Network error. Please try again.", "error");
  } finally {
    accountSendButton.disabled = false;
  }
});

hideActiveToggle.addEventListener("change", async () => {
  hideActiveToggle.disabled = true;
  setInlineStatus(privacyStatus, "Saving...", "neutral");

  try {
    const response = await fetch("/api/settings/active-status", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        hideActiveStatus: hideActiveToggle.checked
      })
    });
    const result = await response.json();

    if (!response.ok) {
      hideActiveToggle.checked = !hideActiveToggle.checked;
      setInlineStatus(privacyStatus, result.error || "Could not save setting.", "error");
      return;
    }

    currentUser = result.user;
    updateAccountHeader();
    setInlineStatus(privacyStatus, "Saved.", "success");
    await loadRecipients({ silent: true });
  } catch {
    hideActiveToggle.checked = !hideActiveToggle.checked;
    setInlineStatus(privacyStatus, "Network error. Please try again.", "error");
  } finally {
    hideActiveToggle.disabled = false;
  }
});

accountProfileForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const username = accountUsername.value.trim();

  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    setInlineStatus(profileStatus, "Use 3-32 letters, numbers, dot, dash, or underscore.", "error");
    return;
  }

  saveProfileButton.disabled = true;
  setInlineStatus(profileStatus, "Saving...", "neutral");

  try {
    const response = await fetch("/api/account/profile", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username })
    });
    const result = await response.json();

    if (!response.ok) {
      setInlineStatus(profileStatus, result.error || "Could not update username.", "error");
      return;
    }

    currentUser = result.user;
    updateAccountHeader();
    lastMessageSignature = "";
    setInlineStatus(profileStatus, "Username saved.", "success");
    await loadRecipients({ silent: true });
    await loadMessages({ silent: true });
  } catch {
    setInlineStatus(profileStatus, "Network error. Please try again.", "error");
  } finally {
    saveProfileButton.disabled = false;
  }
});

accountPasswordForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const password = accountNewPassword.value;

  if (password.length < 4 || password.length > 128) {
    setInlineStatus(passwordStatus, "Password must be 4-128 characters.", "error");
    return;
  }

  savePasswordButton.disabled = true;
  setInlineStatus(passwordStatus, "Saving...", "neutral");

  try {
    const response = await fetch("/api/account/password", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ password })
    });
    const result = await response.json();

    if (!response.ok) {
      setInlineStatus(passwordStatus, result.error || "Could not update password.", "error");
      return;
    }

    accountNewPassword.value = "";
    setInlineStatus(passwordStatus, result.message || "Password updated.", "success");
  } catch {
    setInlineStatus(passwordStatus, "Network error. Please try again.", "error");
  } finally {
    savePasswordButton.disabled = false;
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
    loadRecipients({ silent: true });
  }
});

loadSession().then((isLoggedIn) => {
  if (isLoggedIn) {
    loadMessages();
  }
});
