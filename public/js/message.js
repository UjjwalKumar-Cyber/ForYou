const form = document.querySelector("#message-form");
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

textarea.addEventListener("input", updateCounter);
updateCounter();

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = textarea.value.trim();

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
      body: JSON.stringify({ message })
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
