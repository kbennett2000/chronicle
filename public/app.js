const params = new URLSearchParams(location.search);
const campaignId = params.get("campaign") || "test-campaign";
const apiBase = `/campaigns/${encodeURIComponent(campaignId)}`;

const chatLog = document.getElementById("chat-log");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatSend = document.getElementById("chat-send");
const sessionBanner = document.getElementById("session-banner");
const modelOptionsEl = document.getElementById("model-options");
const applyModelButton = document.getElementById("apply-model");
const modelStatusEl = document.getElementById("model-status");

let currentModel = null;

function addBubble(role, text) {
  const el = document.createElement("div");
  el.className = `bubble ${role}`;
  el.textContent = text;
  chatLog.appendChild(el);
  chatLog.scrollTop = chatLog.scrollHeight;
  return el;
}

function setBanner(text) {
  sessionBanner.textContent = text;
  sessionBanner.hidden = false;
}

function setSending(sending) {
  chatInput.disabled = sending;
  chatSend.disabled = sending;
}

async function api(path, options) {
  const res = await fetch(`${apiBase}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error || `request failed (${res.status})`);
  }
  return body;
}

async function startSession(model) {
  const body = model ? { model } : {};
  const result = await api("/session/start", { method: "POST", body: JSON.stringify(body) });
  currentModel = result.model;
  setBanner(
    `${result.resumed ? "Resumed" : "Started"} session on ${result.model}` +
      (result.resumed ? ` (${result.sessionId})` : "")
  );
  return result;
}

async function sendTurn(message) {
  setSending(true);
  try {
    const result = await api("/turns", { method: "POST", body: JSON.stringify({ message }) });
    addBubble(result.isError ? "error" : "dm", result.narration || "(no response)");
  } catch (err) {
    addBubble("error", err.message);
  } finally {
    setSending(false);
    chatInput.focus();
  }
}

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;
  addBubble("player", message);
  chatInput.value = "";
  sendTurn(message);
});

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});

// --- Tabs ---
document.querySelectorAll(".tab-button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-button").forEach((b) => b.removeAttribute("aria-current"));
    btn.setAttribute("aria-current", "true");
    document.getElementById("chat-view").hidden = btn.dataset.view !== "chat";
    document.getElementById("settings-view").hidden = btn.dataset.view !== "settings";
  });
});

// --- Settings: model selector ---
async function loadModelOptions() {
  const { models } = await (await fetch("/models")).json();
  const state = await api("/state");
  currentModel = state.model;

  modelOptionsEl.innerHTML = "";
  for (const m of models) {
    const label = document.createElement("label");
    label.className = "model-option";
    label.innerHTML = `
      <input type="radio" name="model" value="${m.id}" ${m.id === currentModel ? "checked" : ""} />
      <span class="model-label">${m.label}</span>
    `;
    modelOptionsEl.appendChild(label);
  }
}

applyModelButton.addEventListener("click", async () => {
  const selected = modelOptionsEl.querySelector('input[name="model"]:checked');
  if (!selected) return;
  modelStatusEl.hidden = false;
  modelStatusEl.textContent = "Starting new session…";
  try {
    const result = await startSession(selected.value);
    modelStatusEl.textContent = `New session started on ${result.model}.`;
    addBubble("system", `— New session started on ${result.model} —`);
  } catch (err) {
    modelStatusEl.textContent = `Error: ${err.message}`;
  }
});

// --- Boot ---
(async function init() {
  try {
    await loadModelOptions();
    const result = await startSession();
    addBubble(
      "system",
      result.resumed
        ? `— Resumed campaign on ${result.model} —`
        : `— New campaign session on ${result.model} —`
    );
  } catch (err) {
    addBubble("error", `Failed to start session: ${err.message}`);
  }
})();
