const form = document.querySelector("#message-form");
const senderNameInput = document.querySelector("#sender-name");
const recipientSelect = document.querySelector("#recipient");
const textarea = document.querySelector("#message");
const imageInput = document.querySelector("#message-image");
const clearImageButton = document.querySelector("#clear-message-image");
const imageName = document.querySelector("#message-image-name");
const counter = document.querySelector("#character-count");
const statusMessage = document.querySelector("#message-status");
const button = form.querySelector("button[type='submit']");

const IMAGE_MAX_BYTES = 3 * 1024 * 1024;

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

function selectedImageError() {
  const file = imageInput.files && imageInput.files[0];

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

function updateImageName() {
  const file = imageInput.files && imageInput.files[0];

  if (!file) {
    imageName.textContent = "Optional photo or camera capture, up to 3 MB.";
    return;
  }

  const error = selectedImageError();

  if (error) {
    imageInput.value = "";
    imageName.textContent = "Optional photo or camera capture, up to 3 MB.";
    setStatus(error, "error");
    return;
  }

  imageName.textContent = file.name;
  setStatus("", "neutral");
}

textarea.addEventListener("input", updateCounter);
imageInput.addEventListener("change", updateImageName);
clearImageButton.addEventListener("click", () => {
  imageInput.value = "";
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
  const imageFile = imageInput.files && imageInput.files[0];
  const imageError = selectedImageError();

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
    payload.append("image", imageFile);
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
    imageInput.value = "";
    updateCounter();
    updateImageName();
    setStatus(result.message || "Sent.", "success");
  } catch {
    setStatus("Network error. Please try again.", "error");
  } finally {
    button.disabled = false;
  }
});
