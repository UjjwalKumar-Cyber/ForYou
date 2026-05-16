const form = document.querySelector("#message-form");
const senderNameInput = document.querySelector("#sender-name");
const recipientSelect = document.querySelector("#recipient");
const textarea = document.querySelector("#message");
const galleryImageInput = document.querySelector("#message-gallery-image");
const cameraImageInput = document.querySelector("#message-camera-image");
const clearImageButton = document.querySelector("#clear-message-image");
const imageName = document.querySelector("#message-image-name");
const counter = document.querySelector("#character-count");
const statusMessage = document.querySelector("#message-status");
const button = form.querySelector("button[type='submit']");

const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "application/pdf",
  "text/plain"
]);

function countCharacters(value) {
  return Array.from(value).length;
}

function setStatus(text, type) {
  statusMessage.textContent = text;
  statusMessage.dataset.type = type;
}

function updateCounter() {
  const count = countCharacters(textarea.value);
  counter.textContent = String(count);
  counter.parentElement.dataset.warning = count > 450 ? "true" : "false";
}

function recipientLabel(recipient) {
  const name = recipient.displayName || recipient.username;
  const activeText = recipient.isActive ? "● active" : "○ offline";
  return `${name} ${activeText}`;
}

function setRecipients(recipients) {
  if (!recipients.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No inboxes available";
    recipientSelect.replaceChildren(option);
    button.disabled = true;
    setStatus("No message inboxes are set up yet.", "error");
    return;
  }

  const options = recipients.map((recipient) => {
    const option = document.createElement("option");
    option.value = recipient.username;
    option.textContent = recipientLabel(recipient);
    return option;
  });

  recipientSelect.replaceChildren(...options);
  button.disabled = false;
}

async function loadRecipients() {
  try {
    const response = await fetch("/api/recipients", {
      cache: "no-store"
    });
    const result = await response.json();

    if (!response.ok) {
      setStatus(result.error || "Could not load inboxes.", "error");
      return;
    }

    setRecipients(result.recipients || []);
  } catch {
    setStatus("Network error. Please refresh once.", "error");
  }
}

function selectedImageFile() {
  return (cameraImageInput.files && cameraImageInput.files[0])
    || (galleryImageInput.files && galleryImageInput.files[0])
    || null;
}

function selectedImageError(file) {
  if (!file) {
    return "";
  }

  const type = file.type || "";
  const isKnownMedia =
    type.startsWith("image/") ||
    type.startsWith("video/") ||
    type.startsWith("audio/") ||
    ALLOWED_ATTACHMENT_TYPES.has(type);

  if (type && !isKnownMedia) {
    return "Please choose an image, video, audio, PDF, or text file.";
  }

  if (file.size > ATTACHMENT_MAX_BYTES) {
    return "Please choose media under 8 MB.";
  }

  return "";
}

function updateImageName() {
  const file = selectedImageFile();

  if (!file) {
    imageName.textContent = "Optional photo, video, audio, file, or camera capture, up to 8 MB.";
    return;
  }

  const error = selectedImageError(file);

  if (error) {
    galleryImageInput.value = "";
    cameraImageInput.value = "";
    imageName.textContent = "Optional photo, video, audio, file, or camera capture, up to 8 MB.";
    setStatus(error, "error");
    return;
  }

  imageName.textContent = file.name;
  setStatus("", "neutral");
}

textarea.addEventListener("input", updateCounter);
galleryImageInput.addEventListener("change", () => {
  if (galleryImageInput.files && galleryImageInput.files[0]) {
    cameraImageInput.value = "";
  }
  updateImageName();
});
cameraImageInput.addEventListener("change", () => {
  if (cameraImageInput.files && cameraImageInput.files[0]) {
    galleryImageInput.value = "";
  }
  updateImageName();
});
clearImageButton.addEventListener("click", () => {
  galleryImageInput.value = "";
  cameraImageInput.value = "";
  updateImageName();
});
updateCounter();
updateImageName();
loadRecipients();

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const senderName = senderNameInput.value.trim();
  const recipientUsername = recipientSelect.value;
  const message = textarea.value.trim();
  const imageFile = selectedImageFile();
  const imageError = selectedImageError(imageFile);

  if (!senderName) {
    setStatus("Add your name first.", "error");
    return;
  }

  if (countCharacters(senderName) > 60) {
    setStatus("Please keep your name short.", "error");
    return;
  }

  if (!recipientUsername) {
    setStatus("Choose who should receive it.", "error");
    return;
  }

  if (!message && !imageFile) {
    setStatus("Write a note or attach a photo first.", "error");
    return;
  }

  if (countCharacters(message) > 500) {
    setStatus("Please keep it to 500 characters.", "error");
    return;
  }

  if (imageError) {
    setStatus(imageError, "error");
    return;
  }

  const payload = new FormData();
  payload.append("senderName", senderName);
  payload.append("recipientUsername", recipientUsername);
  payload.append("message", message);

  if (imageFile) {
    payload.append("attachment", imageFile);
  }

  button.disabled = true;
  setStatus("Sending...", "neutral");

  try {
    const response = await fetch("/api/message", {
      method: "POST",
      body: payload
    });

    const result = await response.json();

    if (!response.ok) {
      setStatus(result.error || "The note could not be sent.", "error");
      return;
    }

    textarea.value = "";
    galleryImageInput.value = "";
    cameraImageInput.value = "";
    updateCounter();
    updateImageName();
    setStatus(result.message || "Sent.", "success");
  } catch {
    setStatus("Network error. Please try again.", "error");
  } finally {
    button.disabled = false;
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
