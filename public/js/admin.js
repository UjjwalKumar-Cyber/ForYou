const loginPanel = document.querySelector("#admin-login-panel");
const loginForm = document.querySelector("#admin-login-form");
const loginMessage = document.querySelector("#admin-login-message");
const messagesPanel = document.querySelector("#messages-panel");
const statusMessage = document.querySelector("#admin-status");
const chatList = document.querySelector("#chat-list");
const activeFriends = document.querySelector("#active-friends");
const messageList = document.querySelector("#message-list");
const refreshButton = document.querySelector("#refresh-button");
const logoutButton = document.querySelector("#logout-button");
const inboxUser = document.querySelector("#inbox-user");
const activeStatus = document.querySelector("#active-status");
const accountPresenceDot = document.querySelector("#account-presence-dot");
const chatTemplate = document.querySelector("#chat-template");
const messageTemplate = document.querySelector("#message-template");
const accountMessageForm = document.querySelector("#account-message-form");
const accountRecipient = document.querySelector("#account-recipient");
const accountMessage = document.querySelector("#account-message");
const replyToId = document.querySelector("#reply-to-id");
const replyPreview = document.querySelector("#reply-preview");
const replyPreviewText = document.querySelector("#reply-preview-text");
const cancelReplyButton = document.querySelector("#cancel-reply-button");
const accountGalleryImage = document.querySelector("#account-gallery-image");
const accountCameraImage = document.querySelector("#account-camera-image");
const clearAccountImage = document.querySelector("#clear-account-image");
const accountImageName = document.querySelector("#account-image-name");
const accountSendButton = document.querySelector("#account-send-button");
const accountMessageStatus = document.querySelector("#account-message-status");
const accountCharacterCount = document.querySelector("#account-character-count");
const typingStatus = document.querySelector("#typing-status");
const chatSearch = document.querySelector("#chat-search");
const messageSearch = document.querySelector("#message-search");
const starredButton = document.querySelector("#starred-button");
const recordAudioButton = document.querySelector("#record-audio-button");
const menuButton = document.querySelector("#account-menu-button");
const closeMenuButton = document.querySelector("#account-menu-close");
const accountDrawer = document.querySelector("#account-drawer");
const drawerBackdrop = document.querySelector("#drawer-backdrop");
const anonymousModeToggle = document.querySelector("#anonymous-mode-toggle");
const privacyStatus = document.querySelector("#privacy-status");
const letterAlerts = document.querySelector("#letter-alerts");
const peerAvatar = document.querySelector("#peer-avatar");
const peerName = document.querySelector("#peer-name");
const peerStatus = document.querySelector("#peer-status");

const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
const REFRESH_MS = 20000;
const TYPING_IDLE_MS = 1200;

let currentUser = null;
let conversations = [];
let recipients = [];
let activeUsers = [];
let currentPeer = "__letters__";
let currentMessages = [];
let refreshTimer = null;
let socket = null;
let typingTimer = null;
let pendingAudioBlob = null;
let mediaRecorder = null;
let recordingChunks = [];

function setStatus(text, type = "neutral") {
  statusMessage.textContent = text;
  statusMessage.dataset.type = type;
}

function setLoginMessage(text, type = "neutral") {
  loginMessage.textContent = text;
  loginMessage.dataset.type = type;
}

function setComposerStatus(text, type = "neutral") {
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

function updateCounter() {
  const count = countCharacters(accountMessage.value);
  accountCharacterCount.textContent = String(count);
  accountCharacterCount.parentElement.dataset.warning = count > 450 ? "true" : "false";
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

function showMessagesPanel() {
  loginPanel.classList.add("is-hidden");
  messagesPanel.classList.remove("is-hidden");
  updateAccountHeader();
}

function showLoginPanel() {
  stopAutoRefresh();
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  closeDrawer();
  messagesPanel.classList.add("is-hidden");
  loginPanel.classList.remove("is-hidden");
}

function formatDate(isoDate) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(isoDate));
}

function updateAccountHeader() {
  if (!currentUser) {
    return;
  }

  inboxUser.textContent = currentUser.displayName || currentUser.username;
  anonymousModeToggle.checked = Boolean(currentUser.anonymousMode);
  activeStatus.textContent = currentUser.anonymousMode ? "Anonymous Mode on" : "Active now";
  accountPresenceDot.classList.toggle("is-active", !currentUser.anonymousMode);
  document.body.dataset.theme = currentUser.theme || "vintage-dark";
  document.body.dataset.font = currentUser.fontStyle || "serif";
}

function userInitial(name) {
  return String(name || "F").trim().slice(0, 1).toUpperCase();
}

function getRecipient(username) {
  return recipients.find((user) => user.username === username) || null;
}

function conversationDisplay(conversation) {
  if (conversation.peer) {
    return conversation.peer;
  }

  return getRecipient(conversation.peerUsername) || {
    username: conversation.peerUsername,
    displayName: conversation.peerUsername
  };
}

function messagePreview(message) {
  if (!message) {
    return "No letters yet";
  }

  if (message.text) {
    return message.text;
  }

  if (message.attachment) {
    if (message.kind === "audio") return "Voice note";
    if (message.kind === "image") return "Photo";
    if (message.kind === "video") return "Video";
    return message.attachment.name || "Attachment";
  }

  return "Message";
}

function renderActiveFriends() {
  const visible = activeUsers.filter((user) => user.username !== currentUser.username).slice(0, 8);

  if (!visible.length) {
    activeFriends.innerHTML = '<span class="file-hint">No active friends right now.</span>';
    return;
  }

  activeFriends.replaceChildren(
    ...visible.map((user) => {
      const item = document.createElement("button");
      const avatar = document.createElement("span");
      const name = document.createElement("span");
      item.className = "active-friend";
      item.type = "button";
      item.dataset.username = user.username;
      avatar.className = "sender-avatar";
      avatar.textContent = userInitial(user.displayName);
      if (user.profileImageData) {
        avatar.style.backgroundImage = `url(${user.profileImageData})`;
        avatar.textContent = "";
      }
      name.textContent = user.displayName || user.username;
      item.append(avatar, name);
      item.addEventListener("click", () => selectConversation(user.username));
      return item;
    })
  );
}

function ensureConversationForRecipients() {
  const existing = new Set(conversations.map((item) => item.peerUsername));
  const additions = recipients
    .filter((user) => currentUser && user.username !== currentUser.username && user.username !== "admin")
    .filter((user) => !existing.has(user.username))
    .map((user) => ({
      peerUsername: user.username,
      peer: user,
      lastMessage: null,
      unreadCount: 0
    }));

  conversations = [...conversations, ...additions];
}

function renderChatList() {
  ensureConversationForRecipients();
  const query = chatSearch.value.trim().toLowerCase();
  const ordered = [...conversations].filter((conversation) => {
    const peer = conversationDisplay(conversation);
    return !query || `${peer.displayName} ${messagePreview(conversation.lastMessage)}`.toLowerCase().includes(query);
  });

  if (!ordered.length) {
    chatList.innerHTML = '<div class="empty-state">No chats yet.</div>';
    return;
  }

  const nodes = ordered.map((conversation) => {
    const peer = conversationDisplay(conversation);
    const node = chatTemplate.content.firstElementChild.cloneNode(true);
    const avatar = node.querySelector(".chat-avatar");
    const title = node.querySelector(".chat-title");
    const preview = node.querySelector(".chat-preview");
    const dot = node.querySelector(".presence-dot");
    const unread = node.querySelector(".unread-badge");

    node.dataset.peer = conversation.peerUsername;
    node.classList.toggle("is-selected", conversation.peerUsername === currentPeer);
    avatar.textContent = userInitial(peer.displayName);
    if (peer.profileImageData) {
      avatar.style.backgroundImage = `url(${peer.profileImageData})`;
      avatar.textContent = "";
    }
    title.textContent = peer.displayName || peer.username;
    preview.textContent =
      conversation.peerUsername === "__letters__"
        ? "Anonymous letters and surprise notes"
        : messagePreview(conversation.lastMessage);
    dot.classList.toggle("is-active", Boolean(peer.isActive));

    if (conversation.unreadCount > 0) {
      unread.textContent = String(conversation.unreadCount);
      unread.classList.remove("is-hidden");
    }

    node.addEventListener("click", () => selectConversation(conversation.peerUsername));
    return node;
  });

  chatList.replaceChildren(...nodes);
}

function updatePeerHeader() {
  const conversation = conversations.find((item) => item.peerUsername === currentPeer);
  const peer = conversation ? conversationDisplay(conversation) : getRecipient(currentPeer);
  const name = peer ? peer.displayName || peer.username : "Choose a chat";

  peerName.textContent = name;
  peerAvatar.textContent = userInitial(name);
  peerAvatar.style.backgroundImage = "";

  if (peer && peer.profileImageData) {
    peerAvatar.style.backgroundImage = `url(${peer.profileImageData})`;
    peerAvatar.textContent = "";
  }

  if (currentPeer === "__letters__") {
    peerStatus.textContent = "Anonymous letters from your private page";
    starredButton.disabled = false;
    accountMessageForm.classList.add("is-hidden");
    return;
  }

  peerStatus.textContent = peer && peer.isActive ? "Active now" : "Quiet for now";
  starredButton.disabled = false;
  accountMessageForm.classList.remove("is-hidden");
  accountRecipient.value = currentPeer;
}

function findReplyMessage(id) {
  return currentMessages.find((message) => message.id === id);
}

function renderAttachment(message, container) {
  const attachment = message.attachment || message.image;

  if (!attachment || !attachment.data) {
    container.classList.add("is-hidden");
    return;
  }

  container.classList.remove("is-hidden");
  container.replaceChildren();

  if (message.kind === "image" || attachment.mime.startsWith("image/")) {
    const img = document.createElement("img");
    img.className = "message-image";
    img.src = attachment.data;
    img.alt = attachment.name || "Attached photo";
    container.append(img);
    return;
  }

  if (message.kind === "audio" || attachment.mime.startsWith("audio/")) {
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = attachment.data;
    container.append(audio);
    return;
  }

  if (message.kind === "video" || attachment.mime.startsWith("video/")) {
    const video = document.createElement("video");
    video.controls = true;
    video.src = attachment.data;
    container.append(video);
    return;
  }

  const link = document.createElement("a");
  link.href = attachment.data;
  link.download = attachment.name || "attachment";
  link.textContent = attachment.name || "Open attachment";
  link.className = "attachment-link";
  container.append(link);
}

function renderReactions(message, row) {
  row.replaceChildren();
  const entries = Object.entries(message.reactions || {}).filter(([, users]) => Array.isArray(users) && users.length);

  for (const [emoji, users] of entries) {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.textContent = `${emoji} ${users.length}`;
    pill.addEventListener("click", () => toggleReaction(message.id, emoji));
    row.append(pill);
  }
}

function renderMessages(messages) {
  currentMessages = messages;

  if (!messages.length) {
    messageList.innerHTML = '<div class="empty-state">No messages here yet.</div>';
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const message of messages) {
    const node = messageTemplate.content.firstElementChild.cloneNode(true);
    const isMine = message.senderUsername === currentUser.username;
    const reply = findReplyMessage(message.replyToId);

    node.dataset.id = message.id;
    node.classList.toggle("is-mine", isMine);
    node.classList.toggle("is-new", !isMine && !message.readAt);
    node.classList.toggle("is-starred", (message.starredBy || []).includes(currentUser.username));
    node.querySelector(".bubble-sender").textContent = isMine ? "You" : message.senderName || "Anonymous";
    node.querySelector(".message-time").textContent = formatDate(message.createdAt);

    const replyReference = node.querySelector(".reply-reference");
    if (reply) {
      replyReference.textContent = `Replying to ${messagePreview(reply).slice(0, 72)}`;
      replyReference.classList.remove("is-hidden");
    }

    const text = node.querySelector(".message-text");
    if (message.text) {
      text.textContent = message.text;
    } else {
      text.classList.add("is-hidden");
    }

    renderAttachment(message, node.querySelector(".message-media"));
    renderReactions(message, node.querySelector(".reaction-row"));

    const starButton = node.querySelector('[data-action="star"]');
    starButton.textContent = (message.starredBy || []).includes(currentUser.username) ? "Starred" : "Star";
    node.querySelector('[data-action="reply"]').addEventListener("click", () => startReply(message));
    node.querySelector('[data-action="star"]').addEventListener("click", () => toggleStar(message.id));
    node.querySelector('[data-action="react"]').addEventListener("click", () => toggleReaction(message.id, "❤️"));

    const receipt = node.querySelector(".read-receipt");
    if (isMine && message.readAt && !currentUser.anonymousMode) {
      receipt.textContent = "Seen";
    }

    fragment.append(node);
  }

  messageList.replaceChildren(fragment);
  messageList.scrollTop = messageList.scrollHeight;
}

async function loadSession() {
  try {
    const response = await fetch("/api/session", { cache: "no-store" });
    const result = await response.json();
    currentUser = result.user || null;

    if (!currentUser) {
      showLoginPanel();
      return false;
    }

    showMessagesPanel();
    connectSocket();
    startAutoRefresh();
    await loadAll();
    return true;
  } catch {
    showLoginPanel();
    return false;
  }
}

async function loadRecipients() {
  const response = await fetch("/api/recipients", { cache: "no-store" });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Could not load recipients.");
  }

  recipients = result.recipients || [];
}

async function loadChats() {
  const response = await fetch("/api/chats", { cache: "no-store" });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Could not load chats.");
  }

  conversations = result.conversations || [];

  if (!currentPeer && conversations.length) {
    currentPeer = conversations[0].peerUsername;
  }

  if (!conversations.some((conversation) => conversation.peerUsername === currentPeer)) {
    currentPeer = conversations[0] ? conversations[0].peerUsername : "__letters__";
  }
}

async function loadActiveFriends() {
  const response = await fetch("/api/active-friends", { cache: "no-store" });
  const result = await response.json();

  if (response.ok) {
    activeUsers = result.users || [];
    renderActiveFriends();
  }
}

async function loadMessages(options = {}) {
  const query = messageSearch.value.trim();
  const response = await fetch(`/api/chats/${encodeURIComponent(currentPeer)}/messages?q=${encodeURIComponent(query)}`, {
    cache: "no-store"
  });
  const result = await response.json();

  if (!response.ok) {
    setStatus(result.error || "Could not load messages.", "error");
    return;
  }

  updatePeerHeader();
  renderMessages(result.messages || []);

  if (!options.skipRead && currentPeer) {
    await markRead();
  }
}

async function loadAll() {
  setStatus("Opening letters...", "neutral");
  try {
    await loadRecipients();
    await loadChats();
    await loadActiveFriends();
    renderChatList();
    await loadMessages({ skipRead: true });
    showLetterAlerts();
    setStatus("Live and synced.", "success");
  } catch (error) {
    setStatus(error.message || "Could not load inbox.", "error");
  }
}

async function selectConversation(peerUsername) {
  currentPeer = peerUsername;
  accountRecipient.value = peerUsername;
  renderChatList();
  clearReply();
  await loadMessages();
}

async function markRead() {
  if (currentUser.anonymousMode || !currentPeer) {
    return;
  }

  await fetch(`/api/chats/${encodeURIComponent(currentPeer)}/read`, { method: "POST" });
}

function showLetterAlerts() {
  const unread = conversations.filter((conversation) => conversation.unreadCount > 0).slice(0, 3);
  letterAlerts.replaceChildren();

  for (const conversation of unread) {
    const peer = conversationDisplay(conversation);
    const alert = document.createElement("button");
    const title = document.createElement("strong");
    const preview = document.createElement("span");
    alert.className = "letter-alert";
    alert.type = "button";
    title.textContent = peer.displayName || peer.username;
    preview.textContent = messagePreview(conversation.lastMessage).slice(0, 90);
    alert.append(title, preview);
    alert.addEventListener("click", () => selectConversation(conversation.peerUsername));
    letterAlerts.append(alert);
  }
}

function connectSocket() {
  if (!window.io || socket) {
    return;
  }

  socket = window.io();

  socket.on("presence:update", ({ users }) => {
    recipients = recipients.map((recipient) => {
      const fresh = users.find((user) => user.username === recipient.username);
      return fresh || recipient;
    });
    activeUsers = users.filter((user) => user.isActive);
    renderActiveFriends();
    renderChatList();
    updatePeerHeader();
  });

  socket.on("chat:message", async ({ message }) => {
    upsertConversationFromMessage(message);
    renderChatList();

    if (message.senderUsername !== currentUser.username) {
      showSoftAlert(message);
    }

    if (
      currentPeer === message.senderUsername ||
      currentPeer === message.recipientUsername ||
      (currentPeer === "__letters__" && !message.senderUsername)
    ) {
      await loadMessages();
    }
  });

  socket.on("chat:reaction", ({ message }) => updateMessageInView(message));
  socket.on("chat:starred", ({ message }) => updateMessageInView(message));

  socket.on("chat:read", ({ ids, readAt }) => {
    currentMessages = currentMessages.map((message) =>
      ids.includes(message.id) ? { ...message, readAt } : message
    );
    renderMessages(currentMessages);
  });

  socket.on("chat:typing", ({ from, displayName, typing }) => {
    if (from !== currentPeer) {
      return;
    }

    typingStatus.textContent = typing ? `${displayName} is writing...` : "";
  });
}

function updateMessageInView(message) {
  const index = currentMessages.findIndex((item) => item.id === message.id);

  if (index !== -1) {
    currentMessages[index] = message;
    renderMessages(currentMessages);
  }
}

function upsertConversationFromMessage(message) {
  const peerUsername = !message.senderUsername
    ? "__letters__"
    : message.senderUsername === currentUser.username
      ? message.recipientUsername
      : message.senderUsername;
  let conversation = conversations.find((item) => item.peerUsername === peerUsername);

  if (!conversation) {
    conversation = {
      peerUsername,
      peer: peerUsername === "__letters__" ? null : getRecipient(peerUsername),
      unreadCount: 0
    };
    conversations.unshift(conversation);
  }

  conversation.lastMessage = message;
  if (message.recipientUsername === currentUser.username && peerUsername !== currentPeer) {
    conversation.unreadCount += 1;
  }
}

function showSoftAlert(message) {
  const alert = document.createElement("button");
  const title = document.createElement("strong");
  const preview = document.createElement("span");
  alert.className = "letter-alert";
  alert.type = "button";
  title.textContent = message.senderName || "Someone";
  preview.textContent = messagePreview(message).slice(0, 90);
  alert.append(title, preview);
  alert.addEventListener("click", () => selectConversation(message.senderUsername || "__letters__"));
  letterAlerts.prepend(alert);
  window.setTimeout(() => alert.remove(), 9000);
}

function startReply(message) {
  replyToId.value = message.id;
  replyPreviewText.textContent = `Replying to ${messagePreview(message).slice(0, 120)}`;
  replyPreview.classList.remove("is-hidden");
  accountMessage.focus();
}

function clearReply() {
  replyToId.value = "";
  replyPreview.classList.add("is-hidden");
}

function selectedAttachmentFile() {
  return pendingAudioBlob
    || (accountCameraImage.files && accountCameraImage.files[0])
    || (accountGalleryImage.files && accountGalleryImage.files[0])
    || null;
}

function validateAttachment(file) {
  if (!file) return "";
  if (file.size > ATTACHMENT_MAX_BYTES) return "Please keep media under 8 MB.";
  return "";
}

function updateAttachmentName() {
  const file = selectedAttachmentFile();
  if (!file) {
    accountImageName.textContent = "Text, photo, video, file, or voice note. Starred messages stay saved.";
    return;
  }
  accountImageName.textContent = file.name || "Voice note ready";
}

async function sendMessage(event) {
  event.preventDefault();

  if (!currentPeer || currentPeer === "__letters__") {
    setComposerStatus("Choose a person to message.", "error");
    return;
  }

  const text = accountMessage.value.trim();
  const file = selectedAttachmentFile();
  const fileError = validateAttachment(file);

  if (!text && !file) {
    setComposerStatus("Write a message or attach something.", "error");
    return;
  }

  if (countCharacters(text) > 500) {
    setComposerStatus("Please keep it to 500 characters.", "error");
    return;
  }

  if (fileError) {
    setComposerStatus(fileError, "error");
    return;
  }

  const payload = new FormData();
  payload.append("recipientUsername", currentPeer);
  payload.append("message", text);
  payload.append("replyToId", replyToId.value);

  if (file) {
    payload.append("attachment", file, file.name || "voice-note.webm");
  }

  accountSendButton.disabled = true;
  setComposerStatus("Sending...", "neutral");

  try {
    const response = await fetch("/api/message", {
      method: "POST",
      body: payload
    });
    const result = await response.json();

    if (!response.ok) {
      setComposerStatus(result.error || "Could not send message.", "error");
      return;
    }

    accountMessage.value = "";
    accountGalleryImage.value = "";
    accountCameraImage.value = "";
    pendingAudioBlob = null;
    clearReply();
    updateCounter();
    updateAttachmentName();
    setComposerStatus("Sent.", "success");
    await loadAll();
  } catch {
    setComposerStatus("Network error. Please try again.", "error");
  } finally {
    accountSendButton.disabled = false;
  }
}

async function toggleStar(id) {
  const response = await fetch(`/api/messages/${encodeURIComponent(id)}/star`, { method: "POST" });
  const result = await response.json();
  if (response.ok) updateMessageInView(result.message);
}

async function toggleReaction(id, emoji) {
  const response = await fetch(`/api/messages/${encodeURIComponent(id)}/reactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emoji })
  });
  const result = await response.json();
  if (response.ok) updateMessageInView(result.message);
}

async function toggleAnonymousMode() {
  anonymousModeToggle.disabled = true;
  setInlineStatus(privacyStatus, "Saving...", "neutral");

  try {
    const response = await fetch("/api/settings/anonymous-mode", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anonymousMode: anonymousModeToggle.checked })
    });
    const result = await response.json();

    if (!response.ok) {
      anonymousModeToggle.checked = !anonymousModeToggle.checked;
      setInlineStatus(privacyStatus, result.error || "Could not save.", "error");
      return;
    }

    currentUser = result.user;
    updateAccountHeader();
    setInlineStatus(privacyStatus, "Saved.", "success");
  } catch {
    anonymousModeToggle.checked = !anonymousModeToggle.checked;
    setInlineStatus(privacyStatus, "Network error.", "error");
  } finally {
    anonymousModeToggle.disabled = false;
  }
}

async function toggleRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    recordAudioButton.textContent = "Voice note";
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setComposerStatus("Voice recording is not available in this browser.", "error");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordingChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) recordingChunks.push(event.data);
    });
    mediaRecorder.addEventListener("stop", () => {
      pendingAudioBlob = new File(recordingChunks, `voice-note-${Date.now()}.webm`, { type: "audio/webm" });
      stream.getTracks().forEach((track) => track.stop());
      updateAttachmentName();
    });
    mediaRecorder.start();
    recordAudioButton.textContent = "Stop";
  } catch {
    setComposerStatus("Microphone permission was not available.", "error");
  }
}

function emitTyping() {
  if (!socket || !currentPeer || currentUser.anonymousMode || currentPeer === "__letters__") return;
  socket.emit("chat:typing", { recipientUsername: currentPeer, typing: true });
  window.clearTimeout(typingTimer);
  typingTimer = window.setTimeout(() => {
    socket.emit("chat:typing", { recipientUsername: currentPeer, typing: false });
  }, TYPING_IDLE_MS);
}

function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = window.setInterval(() => {
    if (!document.hidden && currentUser) {
      loadAll();
    }
  }, REFRESH_MS);
}

function stopAutoRefresh() {
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, scope: "account" })
    });
    const result = await response.json();

    if (!response.ok) {
      setLoginMessage(result.error || "Could not open inbox.", "error");
      return;
    }

    currentUser = result.user;
    setLoginMessage("Opened.", "success");
    showMessagesPanel();
    connectSocket();
    startAutoRefresh();
    await loadAll();
  } catch {
    setLoginMessage("Network error. Please try again.", "error");
  } finally {
    button.disabled = false;
  }
});

refreshButton.addEventListener("click", loadAll);
menuButton.addEventListener("click", openDrawer);
closeMenuButton.addEventListener("click", closeDrawer);
drawerBackdrop.addEventListener("click", closeDrawer);
anonymousModeToggle.addEventListener("change", toggleAnonymousMode);
accountMessage.addEventListener("input", () => {
  updateCounter();
  emitTyping();
});
accountMessageForm.addEventListener("submit", sendMessage);
chatSearch.addEventListener("input", renderChatList);
messageSearch.addEventListener("input", () => loadMessages({ skipRead: true }));
cancelReplyButton.addEventListener("click", clearReply);
recordAudioButton.addEventListener("click", toggleRecording);
starredButton.addEventListener("click", async () => {
  const response = await fetch("/api/messages/starred", { cache: "no-store" });
  const result = await response.json();
  if (response.ok) renderMessages(result.messages || []);
});
accountGalleryImage.addEventListener("change", () => {
  if (accountGalleryImage.files && accountGalleryImage.files[0]) accountCameraImage.value = "";
  pendingAudioBlob = null;
  updateAttachmentName();
});
accountCameraImage.addEventListener("change", () => {
  if (accountCameraImage.files && accountCameraImage.files[0]) accountGalleryImage.value = "";
  pendingAudioBlob = null;
  updateAttachmentName();
});
clearAccountImage.addEventListener("click", () => {
  accountGalleryImage.value = "";
  accountCameraImage.value = "";
  pendingAudioBlob = null;
  updateAttachmentName();
});
logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    await fetch("/api/logout", { method: "POST" });
  } finally {
    currentUser = null;
    logoutButton.disabled = false;
    loginForm.reset();
    showLoginPanel();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDrawer();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && currentUser) loadAll();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

updateCounter();
updateAttachmentName();
loadSession();
