const form = document.querySelector("#message-form");
const senderNameInput = document.querySelector("#sender-name");
const recipientSelect = document.querySelector("#recipient");
const textarea = document.querySelector("#message");
const counter = document.querySelector("#character-count");
const statusMessage = document.querySelector("#message-status");
const button = form.querySelector("button");

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
    option.textContent = recipient.displayName || recipient.username;
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

textarea.addEventListener("input", updateCounter);
updateCounter();
loadRecipients();

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const senderName = senderNameInput.value.trim();
  const recipientUsername = recipientSelect.value;
  const message = textarea.value.trim();

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

  if (!message) {
    setStatus("Write a note first.", "error");
    return;
  }

  if (countCharacters(message) > 500) {
    setStatus("Please keep it to 500 characters.", "error");
    return;
  }

  button.disabled = true;
  setStatus("Sending...", "neutral");

  try {
    const response = await fetch("/api/message", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        senderName,
        recipientUsername,
        message
      })
    });

    const result = await response.json();

    if (!response.ok) {
      setStatus(result.error || "The note could not be sent.", "error");
      return;
    }

    textarea.value = "";
    updateCounter();
    setStatus(result.message || "Sent.", "success");
  } catch {
    setStatus("Network error. Please try again.", "error");
  } finally {
    button.disabled = false;
  }
});
