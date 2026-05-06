const form = document.querySelector("#secret-login-form");
const message = document.querySelector("#login-message");
const button = form.querySelector("button");

function setMessage(text, type) {
  message.textContent = text;
  message.dataset.type = type;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const password = String(formData.get("password") || "");

  if (!password.trim()) {
    setMessage("Password required.", "error");
    return;
  }

  button.disabled = true;
  setMessage("Checking...", "neutral");

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        password,
        scope: "secret"
      })
    });

    const result = await response.json();

    if (!response.ok) {
      setMessage(result.error || "Could not unlock the page.", "error");
      return;
    }

    setMessage("Unlocked.", "success");
    window.location.assign(result.redirectTo || "/secret-8392-love-note");
  } catch {
    setMessage("Network error. Please try again.", "error");
  } finally {
    button.disabled = false;
  }
});
