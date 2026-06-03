const loginPanel = document.querySelector("#admin-login-panel");
const loginForm = document.querySelector("#admin-login-form");
const loginMessage = document.querySelector("#admin-login-message");
const messagesPanel = document.querySelector("#messages-panel");
const statusMessage = document.querySelector("#admin-status");
const chatList = document.querySelector("#chat-list");
const messageList = document.querySelector("#message-list");
const refreshButton = document.querySelector("#refresh-button");
const logoutButton = document.querySelector("#logout-button");
const inboxUser = document.querySelector("#inbox-user");
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
const letterAlerts = document.querySelector("#letter-alerts");
const peerAvatar = document.querySelector("#peer-avatar");
const peerName = document.querySelector("#peer-name");
const peerStatus = document.querySelector("#peer-status");
const backChatButton = document.querySelector("#back-chat-button");
const viewProfileButton = document.querySelector("#view-profile-button");
const watchTogetherButton = document.querySelector("#watch-together-button");
const peerProfilePanel = document.querySelector("#peer-profile-panel");
const peerProfileBackdrop = document.querySelector("#peer-profile-backdrop");
const peerProfileClose = document.querySelector("#peer-profile-close");
const peerProfileTitle = document.querySelector("#peer-profile-title");
const peerProfileAvatar = document.querySelector("#peer-profile-avatar");
const peerProfileName = document.querySelector("#peer-profile-name");
const peerProfileStatus = document.querySelector("#peer-profile-status");
const peerProfileUsername = document.querySelector("#peer-profile-username");
const peerProfileBio = document.querySelector("#peer-profile-bio");
const watchInAppPanel = document.querySelector("#watch-in-app-panel");
const watchInAppFrame = document.querySelector("#watch-in-app-frame");
const watchInAppClose = document.querySelector("#watch-in-app-close");
const watchInAppTitle = document.querySelector("#watch-in-app-title");
const ultimateAdminPanel = document.querySelector("#ultimate-admin-panel");
const monitorStats = document.querySelector("#monitor-stats");
const monitorUserList = document.querySelector("#monitor-user-list");
const monitorEventList = document.querySelector("#monitor-event-list");
const monitorStatus = document.querySelector("#monitor-status");
const monitorRefreshButton = document.querySelector("#monitor-refresh-button");
const backupNowButton = document.querySelector("#backup-now-button");
const backupStatus = document.querySelector("#backup-status");
const backupHistoryList = document.querySelector("#backup-history-list");
const storageSummaryGrid = document.querySelector("#storage-summary-grid");
const storageTableList = document.querySelector("#storage-table-list");
const cleanupStorageButton = document.querySelector("#cleanup-storage-button");
const cleanupStorageStatus = document.querySelector("#cleanup-storage-status");
const notificationStack = document.querySelector("#notification-stack");
const notificationForm = document.querySelector("#notification-form");
const notificationRecipient = document.querySelector("#notification-recipient");
const notificationTitle = document.querySelector("#notification-title");
const notificationMessage = document.querySelector("#notification-message");
const notificationType = document.querySelector("#notification-type");
const notificationAdminStatus = document.querySelector("#notification-admin-status");
const notificationHistoryList = document.querySelector("#notification-history-list");
const notificationActiveCount = document.querySelector("#notification-active-count");
const userSearchResult = document.querySelector("#user-search-result");
const userSearchStatus = document.querySelector("#user-search-status");

const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
const REFRESH_MS = 120000;
const HEARTBEAT_MS = 45000;
const TYPING_IDLE_MS = 1200;
const MESSAGE_PAGE_SIZE = 50;

let currentUser = null;
let conversations = [];
let recipients = [];
let activeUsers = [];
let currentPeer = "";
let currentMessages = [];
let refreshTimer = null;
let socket = null;
let typingTimer = null;
let messageSearchTimer = null;
let userSearchTimer = null;
let heartbeatTimer = null;
let monitoringDebounceTimer = null;
let pendingAudioBlob = null;
let mediaRecorder = null;
let recordingChunks = [];
let hasOlderMessages = false;
let loadingOlderMessages = false;
const displayedNotificationIds = new Set();

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
  if (!element) return;
  element.textContent = text;
  element.dataset.type = type;
}

function setMonitorStatus(text, type = "neutral") {
  if (!monitorStatus) return;
  monitorStatus.textContent = text;
  monitorStatus.dataset.type = type;
}

function setNotificationAdminStatus(text, type = "neutral") {
  if (!notificationAdminStatus) return;
  notificationAdminStatus.textContent = text;
  notificationAdminStatus.dataset.type = type;
}

function countCharacters(value) {
  return Array.from(value).length;
}

function updateCounter() {
  const count = countCharacters(accountMessage.value);
  accountCharacterCount.textContent = String(count);
  accountCharacterCount.parentElement.dataset.warning = count > 450 ? "true" : "false";
}

function collectClientActivity() {
  const screenInfo = window.screen || {};

  return {
    screenWidth: Math.round(screenInfo.width || window.innerWidth || 0),
    screenHeight: Math.round(screenInfo.height || window.innerHeight || 0),
    devicePixelRatio: Number(window.devicePixelRatio || 1),
    language: navigator.language || "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    onlineState: navigator.onLine
  };
}

function isUltimateAdminUser(user) {
  return Boolean(user && user.role === "ultimate_admin");
}

// UX polish: resize the composer on the next frame so typing feels smooth without layout thrash.
function resizeChatTextarea() {
  window.requestAnimationFrame(() => {
    accountMessage.style.height = "auto";
    accountMessage.style.height = `${Math.min(accountMessage.scrollHeight, 120)}px`;
  });
}

function scrollMessagesToBottom() {
  window.requestAnimationFrame(() => {
    messageList.scrollTo({
      top: messageList.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
    });
  });
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

function closePeerProfile() {
  peerProfilePanel.classList.add("is-hidden");
  peerProfileBackdrop.classList.add("is-hidden");
  peerProfilePanel.setAttribute("aria-hidden", "true");
}

function showMessagesPanel() {
  loginPanel.classList.add("is-hidden");
  messagesPanel.classList.remove("is-hidden");
  updateAccountHeader();
}

function showLoginPanel() {
  stopAutoRefresh();
  stopHeartbeat();
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

function formatChatTime(isoDate) {
  if (!isoDate) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(isoDate));
}

function formatShortDate(isoDate) {
  if (!isoDate) return "never";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(isoDate));
}

function formatDuration(seconds) {
  const value = Number(seconds || 0);

  if (!value) return "0m";
  if (value < 60) return `${value}s`;
  if (value < 3600) return `${Math.floor(value / 60)}m`;
  return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`;
}

function makeEmptyState(text) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = text;
  return empty;
}

function setConversationOpen(open) {
  messagesPanel.classList.toggle("has-open-chat", Boolean(open));
  messagesPanel.classList.toggle("has-no-chat", !open);
}

function updateAccountHeader() {
  if (!currentUser) {
    return;
  }

  inboxUser.textContent = currentUser.displayName || currentUser.username;
  ultimateAdminPanel?.classList.toggle("is-hidden", !isUltimateAdminUser(currentUser));
  document.body.dataset.theme = currentUser.theme || "vintage-dark";
  document.body.dataset.font = currentUser.fontStyle || "serif";
}

function userInitial(name) {
  return String(name || "F").trim().slice(0, 1).toUpperCase();
}

function avatarUrl(user) {
  return (user && (user.profileImageUrl || user.profileImageData)) || "";
}

function applyAvatar(element, user, fallbackName) {
  const name = fallbackName || (user && (user.displayName || user.username)) || "F";
  const imageUrl = avatarUrl(user);

  element.textContent = userInitial(name);
  element.style.backgroundImage = "";

  if (imageUrl) {
    element.style.backgroundImage = `url(${imageUrl})`;
    element.textContent = "";
  }
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

function currentPeerProfile() {
  if (!currentPeer || currentPeer === "__letters__") {
    return null;
  }

  const conversation = conversations.find((item) => item.peerUsername === currentPeer);
  return conversation ? conversationDisplay(conversation) : getRecipient(currentPeer);
}

function watchRoomHash(value) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36).toUpperCase();
}

function conversationWatchRoomId() {
  if (!currentUser || !currentUser.username || !currentPeer || currentPeer === "__letters__") {
    return "";
  }

  const pairKey = [currentUser.username, currentPeer]
    .map((value) => String(value || "").trim().toLowerCase())
    .sort()
    .join(":");

  return `FORYOU-${watchRoomHash(pairKey)}`;
}

function openInAppWatch(roomId, label = "Private room") {
  if (!roomId) {
    showSoftAlert("Open a chat first, then start Watch Together.");
    return;
  }

  const displayName = currentUser ? currentUser.displayName || currentUser.username || "Me" : "Me";
  const username = currentUser ? currentUser.username || "" : "";
  const roomPath = `/watch/${encodeURIComponent(roomId)}?embed=1&name=${encodeURIComponent(displayName)}&username=${encodeURIComponent(username)}`;

  if (!watchInAppPanel || !watchInAppFrame || !watchInAppTitle) {
    window.open(roomPath, "_blank", "noopener");
    return;
  }

  watchInAppTitle.textContent = label;
  watchInAppFrame.src = roomPath;
  watchInAppPanel.classList.remove("is-hidden");
  watchInAppPanel.setAttribute("aria-hidden", "false");
}

function closeInAppWatch() {
  if (!watchInAppPanel || !watchInAppFrame) {
    return;
  }

  watchInAppPanel.classList.add("is-hidden");
  watchInAppPanel.setAttribute("aria-hidden", "true");
  watchInAppFrame.src = "";
}

function openWatchTogether() {
  const roomId = conversationWatchRoomId();
  const peer = currentPeerProfile();

  if (!roomId) {
    showSoftAlert("Open a chat first, then start Watch Together.");
    return;
  }

  openInAppWatch(roomId, peer ? `With ${peer.displayName || peer.username}` : "Private room");

  if (socket && currentPeer && currentPeer !== "__letters__") {
    socket.emit("watch:invite", {
      recipientUsername: currentPeer,
      roomId
    });
  }
}

function openPeerProfile() {
  const peer = currentPeerProfile();

  if (!peer) {
    return;
  }

  const name = peer.displayName || peer.username;
  peerProfileTitle.textContent = name;
  peerProfileName.textContent = name;
  peerProfileUsername.textContent = `@${peer.username}`;
  peerProfileBio.textContent = peer.bio || "No bio yet.";
  peerProfileStatus.textContent = isUltimateAdminUser(currentUser) && peer.isActive ? "Active now" : "";
  peerProfileAvatar.textContent = userInitial(name);
  applyAvatar(peerProfileAvatar, peer, name);

  peerProfilePanel.classList.remove("is-hidden");
  peerProfileBackdrop.classList.remove("is-hidden");
  peerProfilePanel.setAttribute("aria-hidden", "false");
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

function chatPreview(conversation, peer) {
  if (!conversation.lastMessage) {
    return peer.username === "__letters__" ? "Private notes will appear here" : "Tap to start chatting";
  }

  const sender =
    conversation.lastMessage.senderUsername === currentUser.username
      ? "You"
      : conversation.lastMessage.senderName || peer.displayName || peer.username || "Someone";

  return `${sender}: ${messagePreview(conversation.lastMessage)}`;
}

function renderActiveFriends() {
  return;
}

function makeMonitorStat(label, value) {
  const item = document.createElement("span");
  const strong = document.createElement("strong");
  const small = document.createElement("small");
  strong.textContent = String(value);
  small.textContent = label;
  item.append(strong, small);
  return item;
}

function renderMonitoring(data) {
  if (!isUltimateAdminUser(currentUser) || !data || !monitorStats || !monitorUserList || !monitorEventList) {
    return;
  }

  const stats = data.stats || {};
  monitorStats.replaceChildren(
    makeMonitorStat("online", stats.onlineUsers || 0),
    makeMonitorStat("anonymous online", stats.anonymousOnlineUsers || 0),
    makeMonitorStat("alerts", stats.suspiciousEvents || 0),
    makeMonitorStat("restricted", stats.blockedUsers || 0)
  );

  const users = data.users || [];
  if (!users.length) {
    monitorUserList.replaceChildren(makeEmptyState("No account data yet."));
  } else {
    monitorUserList.replaceChildren(
      ...users.map((user) => {
        const item = document.createElement("article");
        const top = document.createElement("div");
        const avatar = document.createElement("span");
        const copy = document.createElement("span");
        const name = document.createElement("strong");
        const meta = document.createElement("small");
        const details = document.createElement("p");
        const actions = document.createElement("div");
        const blockButton = document.createElement("button");
        const suspendButton = document.createElement("button");
        const activateButton = document.createElement("button");
        const searchButton = document.createElement("button");
        const session = user.session || {};
        const isRestricted = user.accountStatus === "blocked" || user.accountStatus === "suspended";
        const location = [session.city, session.country].filter(Boolean).join(", ") || "location unavailable";
        const device = [session.deviceType, session.browser, session.operatingSystem].filter(Boolean).join(" • ") || "device unavailable";

        item.className = "monitor-user-card";
        top.className = "monitor-user-topline";
        avatar.className = "sender-avatar";
        copy.className = "monitor-user-copy";
        actions.className = "monitor-actions";
        applyAvatar(avatar, user, user.displayName);

        name.textContent = `${user.displayName || user.username} @${user.username}`;
        meta.textContent = `${user.isOnline ? "Online" : `Last seen ${formatShortDate(user.lastSeen)}`}${user.anonymousMode ? " • Anonymous Mode" : ""}`;
        details.textContent = `${device} • ${location} • session ${formatDuration(session.durationSeconds || user.sessionDurationSeconds)}`;

        blockButton.type = "button";
        blockButton.textContent = "Block";
        blockButton.disabled = isRestricted || user.username === currentUser.username;
        blockButton.addEventListener("click", () => updateSecurityStatus(user.username, "blocked"));

        suspendButton.type = "button";
        suspendButton.textContent = "Suspend 24h";
        suspendButton.disabled = isRestricted || user.username === currentUser.username;
        suspendButton.addEventListener("click", () => updateSecurityStatus(user.username, "suspended"));

        activateButton.type = "button";
        activateButton.textContent = "Activate";
        activateButton.disabled = !isRestricted;
        activateButton.addEventListener("click", () => updateSecurityStatus(user.username, "active"));

        searchButton.type = "button";
        searchButton.textContent = user.searchHidden ? "Allow search" : "Hide from search";
        searchButton.disabled = user.username === currentUser.username;
        searchButton.addEventListener("click", () => updateSearchVisibility(user.username, !user.searchHidden));

        copy.append(name, meta);
        top.append(avatar, copy);
        actions.append(blockButton, suspendButton, activateButton, searchButton);
        item.append(top, details, actions);
        return item;
      })
    );
  }

  const events = [...(data.suspicious || []), ...(data.adminActions || [])].slice(0, 12);
  if (!events.length) {
    monitorEventList.replaceChildren(makeEmptyState("No recent security events."));
  } else {
    monitorEventList.replaceChildren(
      ...events.map((event) => {
        const item = document.createElement("p");
        const isLogin = Object.prototype.hasOwnProperty.call(event, "success");
        item.className = "monitor-event";
        item.textContent = isLogin
          ? `${event.success ? "Login" : "Failed login"}: ${event.username || "unknown"}${event.suspiciousReason ? ` • ${event.suspiciousReason}` : ""} • ${formatShortDate(event.createdAt)}`
          : `${event.action}: ${event.targetUsername || "system"} • ${formatShortDate(event.createdAt)}`;
        return item;
      })
    );
  }

  setMonitorStatus(`Updated ${formatShortDate(data.generatedAt)}.`, "success");
}

function populateNotificationRecipients() {
  if (!notificationRecipient) {
    return;
  }

  const currentValue = notificationRecipient.value || "__broadcast__";
  const options = [
    new Option("Broadcast to everyone", "__broadcast__"),
    ...recipients
      .filter((user) => user.username)
      .map((user) => new Option(`${user.displayName || user.username} @${user.username}`, user.username))
  ];

  notificationRecipient.replaceChildren(...options);
  notificationRecipient.value = options.some((option) => option.value === currentValue)
    ? currentValue
    : "__broadcast__";
}

async function markPopupRead(id) {
  if (!id) {
    return;
  }

  try {
    await fetch("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id] })
    });
  } catch {
    // Popup read state is best-effort; unread alerts will show again on next login if this fails.
  }
}

function closePopup(node, id) {
  if (!node || node.dataset.closing === "true") {
    return;
  }

  node.dataset.closing = "true";
  node.classList.add("is-leaving");
  window.setTimeout(() => node.remove(), 220);
  markPopupRead(id);
}

function playPopupSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.035, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.2);
  } catch {
    // Sound is optional and may be blocked by browser autoplay rules.
  }
}

function showPopupNotification(notification) {
  if (!notification || !notification.id || displayedNotificationIds.has(notification.id) || !notificationStack) {
    return;
  }

  displayedNotificationIds.add(notification.id);

  const node = document.createElement("article");
  const top = document.createElement("div");
  const title = document.createElement("strong");
  const close = document.createElement("button");
  const message = document.createElement("p");
  const type = notification.type || "info";

  node.className = `popup-alert popup-alert-${type}`;
  top.className = "popup-alert-topline";
  title.textContent = notification.title || "ForyoU notice";
  close.type = "button";
  close.textContent = "Close";
  close.addEventListener("click", () => closePopup(node, notification.id));
  message.textContent = notification.message || "";

  top.append(title, close);
  node.append(top, message);
  notificationStack.prepend(node);
  playPopupSound();

  window.setTimeout(() => closePopup(node, notification.id), 8000);
}

async function loadNotifications() {
  if (!currentUser) {
    return;
  }

  try {
    const response = await fetch("/api/notifications", { cache: "no-store" });
    const result = await response.json();

    if (response.ok) {
      (result.notifications || []).forEach(showPopupNotification);
    }
  } catch {
    // Realtime notifications are socket-driven; this only catches offline alerts.
  }
}

function renderNotificationHistory(data) {
  if (!notificationHistoryList || !notificationActiveCount) {
    return;
  }

  notificationActiveCount.textContent = `${data.activeCount || 0} active`;
  const notifications = data.notifications || [];

  if (!notifications.length) {
    notificationHistoryList.replaceChildren(makeEmptyState("No popup alerts yet."));
    return;
  }

  notificationHistoryList.replaceChildren(
    ...notifications.slice(0, 20).map((notification) => {
      const item = document.createElement("article");
      const copy = document.createElement("span");
      const title = document.createElement("strong");
      const meta = document.createElement("small");
      const message = document.createElement("p");
      const button = document.createElement("button");

      item.className = "notification-history-item";
      copy.className = "notification-history-copy";
      title.textContent = notification.title;
      meta.textContent = `${notification.type} • @${notification.recipientUsername} • ${notification.seen ? "seen" : "active"} • ${formatShortDate(notification.createdAt)}`;
      message.textContent = notification.message;
      button.type = "button";
      button.textContent = "Delete";
      button.addEventListener("click", () => deleteAdminNotification(notification.id));

      copy.append(title, meta, message);
      item.append(copy, button);
      return item;
    })
  );
}

function renderStorageSummary(summary) {
  if (!storageSummaryGrid || !storageTableList) {
    return;
  }

  const stats = summary.stats || {};
  const latestBackup = summary.latestBackup || null;
  storageSummaryGrid.replaceChildren(
    makeMonitorStat("storage", summary.prettyTotal || "0 B"),
    makeMonitorStat("users", stats.totalUsers || 0),
    makeMonitorStat("messages", stats.totalMessages || 0),
    makeMonitorStat("media", summary.mediaStorageMode || "Database"),
    makeMonitorStat("latest backup", latestBackup ? formatShortDate(latestBackup.createdAt) : "none")
  );

  const tables = summary.tables || [];
  if (!tables.length) {
    storageTableList.replaceChildren(makeEmptyState("No storage data yet."));
    return;
  }

  storageTableList.replaceChildren(
    ...tables.map((table) => {
      const item = document.createElement("p");
      item.className = "storage-table-item";
      item.textContent = `${table.name}: ${table.rows || 0} rows${table.bytes ? ` • ${table.bytes} bytes` : ""}`;
      return item;
    })
  );
}

function renderBackupHistory(backups) {
  if (!backupHistoryList) {
    return;
  }

  if (!backups || !backups.length) {
    backupHistoryList.replaceChildren(makeEmptyState("No backups yet."));
    return;
  }

  backupHistoryList.replaceChildren(
    ...backups.map((backup) => {
      const item = document.createElement("article");
      const title = document.createElement("strong");
      const meta = document.createElement("small");
      const details = document.createElement("p");

      item.className = "backup-history-item";
      title.textContent = backup.status === "completed" ? backup.fileName || "Backup completed" : "Backup failed";
      meta.textContent = `${backup.storageMode || "local"} • ${formatShortDate(backup.createdAt)} • ${backup.createdBy || "admin"}`;
      details.textContent = backup.status === "completed"
        ? `${backup.sizeBytes || 0} bytes • ${(backup.rowCounts && backup.rowCounts.messages) || 0} messages`
        : backup.error || "Backup failed";

      item.append(title, meta, details);
      return item;
    })
  );
}

async function loadStorageSummary() {
  if (!isUltimateAdminUser(currentUser)) {
    return;
  }

  try {
    const response = await fetch("/api/admin/storage-summary", { cache: "no-store" });
    const result = await response.json();

    if (response.ok) {
      renderStorageSummary(result.summary || {});
    }
  } catch {
    setInlineStatus(backupStatus, "Could not load storage summary.", "error");
  }
}

async function loadBackups() {
  if (!isUltimateAdminUser(currentUser)) {
    return;
  }

  try {
    const response = await fetch("/api/admin/backups", { cache: "no-store" });
    const result = await response.json();

    if (response.ok) {
      renderBackupHistory(result.backups || []);
    }
  } catch {
    setInlineStatus(backupStatus, "Could not load backup history.", "error");
  }
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

function clearUserSearch() {
  userSearchResult?.classList.add("is-hidden");
  userSearchResult?.replaceChildren();
  if (userSearchStatus) {
    setInlineStatus(userSearchStatus, "", "neutral");
  }
}

function addSearchUserToChats(user) {
  if (!user || !user.username) {
    return;
  }

  if (!recipients.some((recipient) => recipient.username === user.username)) {
    recipients.push(user);
  }

  if (!conversations.some((conversation) => conversation.peerUsername === user.username)) {
    conversations.unshift({
      peerUsername: user.username,
      peer: user,
      lastMessage: null,
      unreadCount: 0
    });
  }
}

function renderUserSearchResult(user) {
  if (!userSearchResult) {
    return;
  }

  const card = document.createElement("article");
  const avatar = document.createElement("span");
  const copy = document.createElement("span");
  const name = document.createElement("strong");
  const meta = document.createElement("small");
  const bio = document.createElement("p");
  const button = document.createElement("button");

  card.className = "user-search-card";
  avatar.className = "sender-avatar";
  copy.className = "user-search-copy";
  name.textContent = user.displayName || user.username;
  meta.textContent = `@${user.username}`;
  bio.textContent = user.bio || "No bio yet.";
  button.type = "button";
  button.textContent = "Start Chat";
  button.addEventListener("click", async () => {
    addSearchUserToChats(user);
    clearUserSearch();
    if (chatSearch) chatSearch.value = "";
    renderChatList();
    await selectConversation(user.username);
  });

  applyAvatar(avatar, user, user.displayName || user.username);
  copy.append(name, meta, bio);
  card.append(avatar, copy, button);
  userSearchResult.replaceChildren(card);
  userSearchResult.classList.remove("is-hidden");
}

async function searchExactUsername() {
  const username = chatSearch.value.trim();

  if (!username) {
    clearUserSearch();
    setInlineStatus(userSearchStatus, "Enter exact username", "neutral");
    return;
  }

  setInlineStatus(userSearchStatus, "Searching...", "neutral");

  try {
    const response = await fetch(`/api/users/search?username=${encodeURIComponent(username)}`, {
      cache: "no-store"
    });
    const result = await response.json();

    if (!response.ok) {
      clearUserSearch();
      setInlineStatus(userSearchStatus, result.error || "User not found", "error");
      return;
    }

    if (!result.ok) {
      clearUserSearch();
      setInlineStatus(userSearchStatus, result.error || "User not found", "error");
      return;
    }

    renderUserSearchResult(result.user);
    setInlineStatus(userSearchStatus, "Found.", "success");
  } catch {
    clearUserSearch();
    setInlineStatus(userSearchStatus, "Network error while searching.", "error");
  }
}

function renderChatList() {
  ensureConversationForRecipients();
  const ordered = [...conversations]
    .sort((a, b) => {
      if (a.unreadCount !== b.unreadCount) {
        return b.unreadCount - a.unreadCount;
      }

      return (
        new Date(b.lastMessage && b.lastMessage.createdAt ? b.lastMessage.createdAt : 0) -
        new Date(a.lastMessage && a.lastMessage.createdAt ? a.lastMessage.createdAt : 0)
      );
    });

  if (!ordered.length) {
    chatList.replaceChildren(makeEmptyState("No chats yet."));
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
    const time = node.querySelector(".chat-time");

    node.dataset.peer = conversation.peerUsername;
    node.classList.toggle("is-selected", conversation.peerUsername === currentPeer);
    node.classList.toggle("has-unread", conversation.unreadCount > 0);
    applyAvatar(avatar, peer, peer.displayName);
    title.textContent = peer.displayName || peer.username;
    preview.textContent = chatPreview(conversation, peer);
    time.textContent = formatChatTime(conversation.lastMessage && conversation.lastMessage.createdAt);
    dot.classList.toggle("is-active", Boolean(isUltimateAdminUser(currentUser) && peer.isActive));

    if (conversation.unreadCount > 0) {
      unread.textContent = String(conversation.unreadCount);
      unread.classList.remove("is-hidden");
    }

    node.addEventListener("click", () => selectConversation(conversation.peerUsername));
    return node;
  });

  chatList.replaceChildren(...nodes);
  // Keep the freshest chats visually anchored near the heading after list refreshes.
  chatList.scrollTop = 0;
}

function updatePeerHeader() {
  if (!currentPeer) {
    setConversationOpen(false);
    peerName.textContent = "Choose a chat";
    peerStatus.textContent = "Tap a name or new text to open message history.";
    peerAvatar.textContent = "F";
    peerAvatar.style.backgroundImage = "";
    starredButton.disabled = true;
    messageSearch.disabled = true;
    accountMessageForm.classList.add("is-hidden");
    viewProfileButton.disabled = true;
    watchTogetherButton.disabled = true;
    return;
  }

  setConversationOpen(true);
  const conversation = conversations.find((item) => item.peerUsername === currentPeer);
  const peer = conversation ? conversationDisplay(conversation) : getRecipient(currentPeer);
  const name = peer ? peer.displayName || peer.username : "Choose a chat";

  peerName.textContent = name;
  applyAvatar(peerAvatar, peer, name);

  if (currentPeer === "__letters__") {
    peerStatus.textContent = "";
    starredButton.disabled = false;
    viewProfileButton.disabled = true;
    watchTogetherButton.disabled = true;
    messageSearch.disabled = false;
    accountMessageForm.classList.add("is-hidden");
    return;
  }

  peerStatus.textContent = isUltimateAdminUser(currentUser) && peer && peer.isActive ? "Active now" : "";
  starredButton.disabled = false;
  viewProfileButton.disabled = false;
  watchTogetherButton.disabled = false;
  messageSearch.disabled = false;
  accountMessageForm.classList.remove("is-hidden");
  accountRecipient.value = currentPeer;
}

function findReplyMessage(id) {
  return currentMessages.find((message) => message.id === id);
}

function renderAttachment(message, container) {
  const attachment = message.attachment || message.image;
  const source = attachment && (attachment.data || attachment.url);

  if (!attachment || !source) {
    container.classList.add("is-hidden");
    return;
  }

  container.classList.remove("is-hidden");
  container.replaceChildren();

  if (message.kind === "image" || attachment.mime.startsWith("image/")) {
    const img = document.createElement("img");
    img.className = "message-image";
    img.loading = "lazy";
    img.decoding = "async";
    img.src = source;
    img.alt = attachment.name || "Attached photo";
    container.append(img);
    return;
  }

  if (message.kind === "audio" || attachment.mime.startsWith("audio/")) {
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "metadata";
    audio.src = source;
    container.append(audio);
    return;
  }

  if (message.kind === "video" || attachment.mime.startsWith("video/")) {
    const video = document.createElement("video");
    video.controls = true;
    video.preload = "metadata";
    video.src = source;
    container.append(video);
    return;
  }

  const link = document.createElement("a");
  link.href = source;
  if (attachment.data) {
    link.download = attachment.name || "attachment";
  } else {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
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

function makeLoadOlderButton() {
  const button = document.createElement("button");
  button.className = "load-older-button";
  button.type = "button";
  button.textContent = loadingOlderMessages ? "Loading..." : "Load older letters";
  button.disabled = loadingOlderMessages;
  button.addEventListener("click", loadOlderMessages);
  return button;
}

function renderMessages(messages, options = {}) {
  currentMessages = messages;

  if (!messages.length) {
    messageList.replaceChildren(makeEmptyState("No messages here yet."));
    return;
  }

  const fragment = document.createDocumentFragment();

  if (hasOlderMessages) {
    fragment.append(makeLoadOlderButton());
  }

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
    node.querySelector('[data-action="delete"]').addEventListener("click", () => deleteMessage(message.id));

    const receipt = node.querySelector(".read-receipt");
    if (isMine && message.readAt && !currentUser.anonymousMode) {
      receipt.textContent = "Seen";
    }

    fragment.append(node);
  }

  messageList.replaceChildren(fragment);
  if (!options.preserveScroll) {
    scrollMessagesToBottom();
  }
}

async function loadSession() {
  try {
    const response = await fetch("/api/session", { cache: "no-store" });
    const result = await response.json();
    currentUser = result.user || null;

    if (!currentUser) {
      document.getElementById("admin-loading-panel")?.classList.add("is-hidden");

      setTimeout(() => {
        if (!currentUser) {
          showLoginPanel();
        }
      }, 1200);

      return false;
    }

    connectSocket();
    startAutoRefresh();
    startHeartbeat();
    await loadAll();
    await loadNotifications();
    await loadAdminMonitoring();
    await loadAdminNotifications();
    await loadStorageSummary();
    await loadBackups();

    showMessagesPanel();
    document.getElementById("admin-loading-panel")?.classList.add("is-hidden");

    return true;
  } catch {
    document.getElementById("admin-loading-panel")?.classList.add("is-hidden");

    setTimeout(() => {
      if (!currentUser) {
        showLoginPanel();
      }
    }, 1200);

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
  populateNotificationRecipients();
}

async function loadChats() {
  const response = await fetch("/api/chats", { cache: "no-store" });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Could not load chats.");
  }

  conversations = result.conversations || [];

  if (
    currentPeer &&
    !conversations.some((conversation) => conversation.peerUsername === currentPeer) &&
    !recipients.some((recipient) => recipient.username === currentPeer)
  ) {
    currentPeer = "";
  }
}

async function loadActiveFriends() {
  if (!isUltimateAdminUser(currentUser)) {
    activeUsers = [];
    renderActiveFriends();
    return;
  }

  const response = await fetch("/api/active-friends", { cache: "no-store" });
  const result = await response.json();

  if (response.ok) {
    activeUsers = result.users || [];
    renderActiveFriends();
  }
}

async function loadAdminMonitoring() {
  if (!isUltimateAdminUser(currentUser)) {
    return;
  }

  setMonitorStatus("Updating...", "neutral");

  try {
    const response = await fetch("/api/admin/monitoring", { cache: "no-store" });
    const result = await response.json();

    if (!response.ok) {
      setMonitorStatus(result.error || "Could not load monitoring.", "error");
      return;
    }

    renderMonitoring(result);
  } catch {
    setMonitorStatus("Network error while loading monitoring.", "error");
  }
}

async function loadAdminNotifications() {
  if (!isUltimateAdminUser(currentUser)) {
    return;
  }

  try {
    const response = await fetch("/api/admin/notifications", { cache: "no-store" });
    const result = await response.json();

    if (response.ok) {
      renderNotificationHistory(result);
    }
  } catch {
    setNotificationAdminStatus("Could not load popup history.", "error");
  }
}

function scheduleMonitoringLoad() {
  if (!isUltimateAdminUser(currentUser)) {
    return;
  }

  window.clearTimeout(monitoringDebounceTimer);
  monitoringDebounceTimer = window.setTimeout(() => {
    loadAdminMonitoring();
    loadAdminNotifications();
    loadStorageSummary();
    loadBackups();
  }, 350);
}

async function updateSecurityStatus(username, accountStatus) {
  if (!isUltimateAdminUser(currentUser)) {
    return;
  }

  const payload = {
    accountStatus,
    blockedReason: accountStatus === "active" ? "" : "Updated by ultimate admin dashboard."
  };

  if (accountStatus === "suspended") {
    payload.suspendedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  }

  setMonitorStatus("Saving account status...", "neutral");

  try {
    const response = await fetch(`/api/admin/users/${encodeURIComponent(username)}/security`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();

    if (!response.ok) {
      setMonitorStatus(result.error || "Could not update account.", "error");
      return;
    }

    setMonitorStatus("Account status saved.", "success");
    await loadAdminMonitoring();
    await loadAll();
  } catch {
    setMonitorStatus("Network error while saving account.", "error");
  }
}

async function updateSearchVisibility(username, searchHidden) {
  if (!isUltimateAdminUser(currentUser)) {
    return;
  }

  setMonitorStatus(searchHidden ? "Hiding user from search..." : "Allowing user search...", "neutral");

  try {
    const response = await fetch(`/api/admin/users/${encodeURIComponent(username)}/search-visibility`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ searchHidden })
    });
    const result = await response.json();

    if (!response.ok) {
      setMonitorStatus(result.error || "Could not update search visibility.", "error");
      return;
    }

    setMonitorStatus(searchHidden ? "User hidden from exact search." : "User allowed in exact search.", "success");
    await loadAdminMonitoring();
    await loadAll();
  } catch {
    setMonitorStatus("Network error while saving search visibility.", "error");
  }
}

async function cleanStorage() {
  if (!isUltimateAdminUser(currentUser) || !cleanupStorageButton) {
    return;
  }

  const warning = "This deletes logs only. Messages, users, memories and media stay safe.";
  if (!window.confirm(warning)) {
    return;
  }

  cleanupStorageButton.disabled = true;
  setInlineStatus(cleanupStorageStatus, "Cleaning logs...", "neutral");

  try {
    const response = await fetch("/api/admin/cleanup-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true })
    });
    const result = await response.json();

    if (!response.ok) {
      setInlineStatus(cleanupStorageStatus, result.error || "Could not clean storage.", "error");
      return;
    }

    setInlineStatus(
      cleanupStorageStatus,
      `Cleaned ${result.totalRowsRemoved || 0} log rows. Saved ${result.totalSaved || "0 B"}.`,
      "success"
    );
    await loadAdminMonitoring();
    await loadAdminNotifications();
    await loadStorageSummary();
  } catch {
    setInlineStatus(cleanupStorageStatus, "Network error while cleaning storage.", "error");
  } finally {
    cleanupStorageButton.disabled = false;
  }
}

async function backupNow() {
  if (!isUltimateAdminUser(currentUser) || !backupNowButton) {
    return;
  }

  backupNowButton.disabled = true;
  setInlineStatus(backupStatus, "Creating backup...", "neutral");

  try {
    const response = await fetch("/api/admin/backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const result = await response.json();

    if (!response.ok) {
      setInlineStatus(backupStatus, result.error || "Backup failed", "error");
      await loadBackups();
      return;
    }

    const location = result.downloadUrl || result.filePath || result.folderPath || "backup history";
    setInlineStatus(backupStatus, `Backup completed. Saved to ${location}.`, "success");
    await loadStorageSummary();
    await loadBackups();
  } catch {
    setInlineStatus(backupStatus, "Backup failed", "error");
    await loadBackups();
  } finally {
    backupNowButton.disabled = false;
  }
}

async function sendAdminNotification(event) {
  event.preventDefault();

  if (!isUltimateAdminUser(currentUser)) {
    return;
  }

  const recipientValue = notificationRecipient.value;
  const payload = {
    broadcast: recipientValue === "__broadcast__",
    recipientUsername: recipientValue === "__broadcast__" ? "" : recipientValue,
    title: notificationTitle.value.trim(),
    message: notificationMessage.value.trim(),
    type: notificationType.value
  };

  if (!payload.title || !payload.message) {
    setNotificationAdminStatus("Title and message are required.", "error");
    return;
  }

  setNotificationAdminStatus("Sending popup...", "neutral");

  try {
    const response = await fetch("/api/admin/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();

    if (!response.ok) {
      setNotificationAdminStatus(result.error || "Could not send popup.", "error");
      return;
    }

    notificationTitle.value = "";
    notificationMessage.value = "";
    setNotificationAdminStatus(`Sent ${result.count || 0} popup alert${result.count === 1 ? "" : "s"}.`, "success");
    await loadAdminNotifications();
  } catch {
    setNotificationAdminStatus("Network error while sending popup.", "error");
  }
}

async function deleteAdminNotification(id) {
  setNotificationAdminStatus("Deleting popup...", "neutral");

  try {
    const response = await fetch(`/api/admin/notifications/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
    const result = await response.json();

    if (!response.ok) {
      setNotificationAdminStatus(result.error || "Could not delete popup.", "error");
      return;
    }

    setNotificationAdminStatus("Popup deleted.", "success");
    await loadAdminNotifications();
  } catch {
    setNotificationAdminStatus("Network error while deleting popup.", "error");
  }
}

async function sendHeartbeat() {
  if (!currentUser) {
    return;
  }

  try {
    const response = await fetch("/api/ping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activity: collectClientActivity() })
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      setLoginMessage(result.error || "Please log in again.", "error");
      currentUser = null;
      showLoginPanel();
      return;
    }

    if (result.user) {
      currentUser = result.user;
      updateAccountHeader();
    }
  } catch {
    // Heartbeats are best-effort; the next socket or manual refresh will repair the view.
  }
}

async function loadMessages(options = {}) {
  if (!currentPeer) {
    updatePeerHeader();
    messageList.replaceChildren(makeEmptyState("Tap a name or new text to open the full chat history."));
    return;
  }

  const query = messageSearch.value.trim();
  const params = new URLSearchParams({
    q: query,
    limit: String(MESSAGE_PAGE_SIZE)
  });
  const response = await fetch(`/api/chats/${encodeURIComponent(currentPeer)}/messages?${params.toString()}`, {
    cache: "no-store"
  });
  const result = await response.json();

  if (!response.ok) {
    setStatus(result.error || "Could not load messages.", "error");
    return;
  }

  updatePeerHeader();
  hasOlderMessages = (result.messages || []).length >= MESSAGE_PAGE_SIZE;
  renderMessages(result.messages || []);

  if (!options.skipRead && currentPeer) {
    await markRead();
  }
}

async function loadOlderMessages() {
  if (!currentPeer || !currentMessages.length || loadingOlderMessages) {
    return;
  }

  loadingOlderMessages = true;
  renderMessages(currentMessages, { preserveScroll: true });

  const previousHeight = messageList.scrollHeight;
  const query = messageSearch.value.trim();
  const before = currentMessages[0] && currentMessages[0].createdAt;
  const params = new URLSearchParams({
    q: query,
    limit: String(MESSAGE_PAGE_SIZE),
    before: before || ""
  });

  try {
    const response = await fetch(`/api/chats/${encodeURIComponent(currentPeer)}/messages?${params.toString()}`, {
      cache: "no-store"
    });
    const result = await response.json();

    if (!response.ok) {
      setStatus(result.error || "Could not load older messages.", "error");
      return;
    }

    const olderMessages = result.messages || [];
    const seen = new Set(currentMessages.map((message) => message.id));
    hasOlderMessages = olderMessages.length >= MESSAGE_PAGE_SIZE;
    renderMessages([...olderMessages.filter((message) => !seen.has(message.id)), ...currentMessages], {
      preserveScroll: true
    });
    window.requestAnimationFrame(() => {
      messageList.scrollTop = Math.max(0, messageList.scrollHeight - previousHeight);
    });
  } catch {
    setStatus("Network error while loading older messages.", "error");
  } finally {
    loadingOlderMessages = false;
    renderMessages(currentMessages, { preserveScroll: true });
  }
}

async function loadAll() {
  setStatus("Opening letters...", "neutral");
  try {
    await loadRecipients();
    await loadChats();
    await loadActiveFriends();
    renderChatList();
    if (currentPeer) {
      await loadMessages({ skipRead: true });
    } else {
      updatePeerHeader();
      messageList.replaceChildren(makeEmptyState("Tap a name or new text to open the full chat history."));
    }
    setStatus("Synced.");
  } catch (error) {
    setStatus(error.message || "Could not load inbox.", "error");
  }
}

async function selectConversation(peerUsername) {
  currentPeer = peerUsername;
  accountRecipient.value = peerUsername;
  messageSearch.value = "";
  renderChatList();
  clearReply();
  await loadMessages();
}

function closeConversation() {
  currentPeer = "";
  typingStatus.textContent = "";
  clearReply();
  renderChatList();
  updatePeerHeader();
  messageList.replaceChildren(makeEmptyState("Tap a name or new text to open the full chat history."));
}

async function markRead() {
  if (currentUser.anonymousMode || !currentPeer) {
    return;
  }

  await fetch(`/api/chats/${encodeURIComponent(currentPeer)}/read`, { method: "POST" });
}

function showLetterAlerts() {
  letterAlerts.replaceChildren();
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

  socket.on("admin:monitoring-dirty", scheduleMonitoringLoad);

  socket.on("notification:alert", ({ notification }) => {
    showPopupNotification(notification);
    scheduleMonitoringLoad();
  });

  socket.on("notification:batch", ({ notifications }) => {
    (notifications || []).forEach(showPopupNotification);
  });

  socket.on("watch:invite", ({ roomId, displayName }) => {
    showSoftAlert(`${displayName || "Someone"} invited you to Watch Together.`);
    openInAppWatch(roomId, displayName ? `With ${displayName}` : "Private room");
  });

  socket.on("watch:invite:sent", () => {
    showSoftAlert("Watch Together invite sent.");
  });

  socket.on("account:security", ({ message }) => {
    setLoginMessage(message || "Your account status changed. Please log in again.", "error");
    currentUser = null;
    showLoginPanel();
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
  if (typeof message === "string") {
    setStatus(message);
    return;
  }

  setStatus(`New text from ${message.senderName || "Someone"}.`);
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
    resizeChatTextarea();
    updateAttachmentName();
    setComposerStatus("Sent.", "success");
    upsertConversationFromMessage(result.item);
    renderChatList();

    if (currentPeer === result.item.recipientUsername) {
      renderMessages([...currentMessages, result.item]);
    }
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

async function deleteMessage(id) {
  const response = await fetch(`/api/messages/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
  const result = await response.json();

  if (!response.ok) {
    setComposerStatus(result.error || "Could not delete message.", "error");
    return;
  }

  currentMessages = currentMessages.filter((message) => message.id !== id);
  renderMessages(currentMessages);
  setComposerStatus("Message deleted.", "success");
  await loadChats();
  renderChatList();
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
      scheduleMonitoringLoad();
    }
  }, REFRESH_MS);
}

function stopAutoRefresh() {
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function startHeartbeat() {
  stopHeartbeat();
  sendHeartbeat();
  heartbeatTimer = window.setInterval(() => {
    if (!document.hidden && currentUser) {
      sendHeartbeat();
    }
  }, HEARTBEAT_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
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
      body: JSON.stringify({ username, password, scope: "account", activity: collectClientActivity() })
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
    startHeartbeat();
    await loadAll();
    await loadNotifications();
    await loadAdminMonitoring();
    await loadAdminNotifications();
    await loadStorageSummary();
    await loadBackups();
  } catch {
    setLoginMessage("Network error. Please try again.", "error");
  } finally {
    button.disabled = false;
  }
});

refreshButton.addEventListener("click", loadAll);
monitorRefreshButton?.addEventListener("click", loadAdminMonitoring);
backupNowButton?.addEventListener("click", backupNow);
cleanupStorageButton?.addEventListener("click", cleanStorage);
notificationForm?.addEventListener("submit", sendAdminNotification);
backChatButton.addEventListener("click", closeConversation);
viewProfileButton.addEventListener("click", openPeerProfile);
watchTogetherButton.addEventListener("click", openWatchTogether);
watchInAppClose?.addEventListener("click", closeInAppWatch);
peerProfileClose.addEventListener("click", closePeerProfile);
peerProfileBackdrop.addEventListener("click", closePeerProfile);
menuButton.addEventListener("click", openDrawer);
closeMenuButton.addEventListener("click", closeDrawer);
drawerBackdrop.addEventListener("click", closeDrawer);
accountMessage.addEventListener("input", () => {
  updateCounter();
  resizeChatTextarea();
  emitTyping();
});
accountMessageForm.addEventListener("submit", sendMessage);
chatSearch.addEventListener("input", () => {
  window.clearTimeout(userSearchTimer);
  userSearchTimer = window.setTimeout(searchExactUsername, 320);
});
messageSearch.addEventListener("input", () => {
  window.clearTimeout(messageSearchTimer);
  messageSearchTimer = window.setTimeout(() => loadMessages({ skipRead: true }), 250);
});
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
  if (event.key === "Escape") {
    closeDrawer();
    closePeerProfile();
  }
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && currentUser) {
    sendHeartbeat();
    loadAll();
    scheduleMonitoringLoad();
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

updateCounter();
resizeChatTextarea();
updateAttachmentName();
loadSession();
