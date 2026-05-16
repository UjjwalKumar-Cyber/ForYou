const avatarForm = document.querySelector("#avatar-form");
const avatarInput = document.querySelector("#avatar-input");
const avatarStatus = document.querySelector("#avatar-status");
const profileAvatar = document.querySelector("#profile-avatar");
const profileName = document.querySelector("#profile-name");
const profileBio = document.querySelector("#profile-bio");
const profileForm = document.querySelector("#profile-form");
const displayName = document.querySelector("#display-name");
const bioInput = document.querySelector("#profile-bio-input");
const emailInput = document.querySelector("#profile-email");
const anonymousMode = document.querySelector("#profile-anonymous-mode");
const profileTheme = document.querySelector("#profile-theme");
const profileFont = document.querySelector("#profile-font");
const profileWallpaper = document.querySelector("#profile-wallpaper");
const profileColor = document.querySelector("#profile-color");
const profileStatus = document.querySelector("#profile-status");
const usernameForm = document.querySelector("#account-profile-form");
const accountUsername = document.querySelector("#account-username");
const usernameStatus = document.querySelector("#username-status");
const passwordForm = document.querySelector("#account-password-form");
const accountPassword = document.querySelector("#account-new-password");
const passwordStatus = document.querySelector("#password-status");

let currentUser = null;

function setStatus(element, text, type = "neutral") {
  element.textContent = text;
  element.dataset.type = type;
}

function initial(name) {
  return String(name || "F").trim().slice(0, 1).toUpperCase();
}

function avatarUrl(user) {
  return (user && (user.profileImageUrl || user.profileImageData)) || "";
}

function applyUser(user) {
  currentUser = user;
  profileName.textContent = user.displayName || user.username;
  profileBio.textContent = user.bio || "A small note about you.";
  profileAvatar.textContent = initial(user.displayName || user.username);
  profileAvatar.style.backgroundImage = "";

  if (avatarUrl(user)) {
    profileAvatar.style.backgroundImage = `url(${avatarUrl(user)})`;
    profileAvatar.textContent = "";
  }

  displayName.value = user.displayName || user.username;
  bioInput.value = user.bio || "";
  emailInput.value = user.email || "";
  if (anonymousMode) {
    anonymousMode.checked = Boolean(user.anonymousMode);
  }
  profileTheme.value = user.theme || "vintage-dark";
  profileFont.value = user.fontStyle || "serif";
  profileWallpaper.value = user.wallpaper || "paper";
  profileColor.value = user.themeColor || "rose";
  accountUsername.value = user.username || "";
  document.body.dataset.theme = user.theme || "vintage-dark";
  document.body.dataset.font = user.fontStyle || "serif";
}

async function loadProfile() {
  const response = await fetch("/api/profile", { cache: "no-store" });
  const result = await response.json();

  if (!response.ok || !result.user) {
    window.location.href = "/admin";
    return;
  }

  applyUser(result.user);
}

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(profileStatus, "Saving...", "neutral");

  const response = await fetch("/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      displayName: displayName.value,
      bio: bioInput.value,
      email: emailInput.value,
      anonymousMode: anonymousMode ? anonymousMode.checked : Boolean(currentUser && currentUser.anonymousMode),
      theme: profileTheme.value,
      wallpaper: profileWallpaper.value,
      fontStyle: profileFont.value,
      themeColor: profileColor.value
    })
  });
  const result = await response.json();

  if (!response.ok) {
    setStatus(profileStatus, result.error || "Could not save profile.", "error");
    return;
  }

  applyUser(result.user);
  setStatus(profileStatus, "Profile saved.", "success");
});

avatarForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!avatarInput.files || !avatarInput.files[0]) {
    setStatus(avatarStatus, "Choose a picture first.", "error");
    return;
  }

  const payload = new FormData();
  payload.append("avatar", avatarInput.files[0]);
  setStatus(avatarStatus, "Saving...", "neutral");

  const response = await fetch("/api/profile/avatar", {
    method: "POST",
    body: payload
  });
  const result = await response.json();

  if (!response.ok) {
    setStatus(avatarStatus, result.error || "Could not save picture.", "error");
    return;
  }

  avatarInput.value = "";
  applyUser(result.user);
  setStatus(avatarStatus, "Picture saved.", "success");
});

usernameForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = accountUsername.value.trim();

  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    setStatus(usernameStatus, "Use 3-32 letters, numbers, dot, dash, or underscore.", "error");
    return;
  }

  setStatus(usernameStatus, "Saving...", "neutral");
  const response = await fetch("/api/account/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username })
  });
  const result = await response.json();

  if (!response.ok) {
    setStatus(usernameStatus, result.error || "Could not update username.", "error");
    return;
  }

  applyUser(result.user);
  setStatus(usernameStatus, "Username saved.", "success");
});

passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = accountPassword.value;

  if (password.length < 4 || password.length > 128) {
    setStatus(passwordStatus, "Password must be 4-128 characters.", "error");
    return;
  }

  setStatus(passwordStatus, "Saving...", "neutral");
  const response = await fetch("/api/account/password", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  });
  const result = await response.json();

  if (!response.ok) {
    setStatus(passwordStatus, result.error || "Could not update password.", "error");
    return;
  }

  accountPassword.value = "";
  setStatus(passwordStatus, result.message || "Password updated.", "success");
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

loadProfile();
