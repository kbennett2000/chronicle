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
const serverAddressInput = document.getElementById("server-address");
const serverPassphraseInput = document.getElementById("server-passphrase");
const saveConnectionButton = document.getElementById("save-connection");
const connectionStatusEl = document.getElementById("connection-status");

const artStylePresetSelect = document.getElementById("art-style-preset");
const artStyleCustomRow = document.getElementById("art-style-custom-row");
const artStyleCustomInput = document.getElementById("art-style-custom");
const worldSettingInput = document.getElementById("world-setting");
const toneWhimsyInput = document.getElementById("tone-whimsy");
const toneWhimsyValueEl = document.getElementById("tone-whimsy-value");
const contentIntensitySelect = document.getElementById("content-intensity");
const saveStoryStyleButton = document.getElementById("save-story-style");
const storyStyleStatusEl = document.getElementById("story-style-status");

const generateImagesToggle = document.getElementById("generate-images-toggle");
const generateImagesStatusEl = document.getElementById("generate-images-status");

const DEFAULT_TONE_WHIMSY = 0.175;
const PRESET_ART_STYLES = new Set(
  Array.from(artStylePresetSelect.options)
    .map((o) => o.value)
    .filter((v) => v && v !== "custom")
);

let currentModel = null;

// --- Connection settings (server address + shared-secret passphrase) ---
// Per ADR-0003: the server requires this passphrase on every API request
// once it's reachable from other LAN devices. Stored in localStorage only
// (never sent anywhere but this configured server, never logged).
const CONNECTION_KEY = "chronicle.connection";

function loadConnection() {
  try {
    return JSON.parse(localStorage.getItem(CONNECTION_KEY)) || { serverAddress: "", passphrase: "" };
  } catch {
    return { serverAddress: "", passphrase: "" };
  }
}

function saveConnection(conn) {
  localStorage.setItem(CONNECTION_KEY, JSON.stringify(conn));
}

let connection = loadConnection();

function serverOrigin() {
  return connection.serverAddress.trim().replace(/\/$/, "") || "";
}

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

async function apiFetch(fullPath, options) {
  const res = await fetch(`${serverOrigin()}${fullPath}`, {
    headers: {
      "Content-Type": "application/json",
      "X-Chronicle-Token": connection.passphrase,
    },
    ...options,
  });
  if (res.status === 401) {
    throw new Error("Not authorized — set the server address and passphrase in Settings.");
  }
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error || `request failed (${res.status})`);
  }
  return body;
}

function api(path, options) {
  return apiFetch(`${apiBase}${path}`, options);
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
  const { models } = await apiFetch("/models");
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

// --- Settings: story style (art style, world setting, tone, intensity) ---
function updateToneWhimsyLabel() {
  toneWhimsyValueEl.textContent = `${toneWhimsyInput.value}%`;
}

function updateArtStyleCustomVisibility() {
  artStyleCustomRow.hidden = artStylePresetSelect.value !== "custom";
}

async function loadStoryStyle() {
  const settings = await api("/settings");

  if (settings.artStyle && PRESET_ART_STYLES.has(settings.artStyle)) {
    artStylePresetSelect.value = settings.artStyle;
  } else if (settings.artStyle) {
    artStylePresetSelect.value = "custom";
    artStyleCustomInput.value = settings.artStyle;
  } else {
    artStylePresetSelect.value = "";
  }
  updateArtStyleCustomVisibility();

  worldSettingInput.value = settings.worldSetting || "";
  toneWhimsyInput.value = Math.round((settings.toneWhimsy ?? DEFAULT_TONE_WHIMSY) * 100);
  updateToneWhimsyLabel();
  contentIntensitySelect.value = settings.contentIntensity || "standard";
  generateImagesToggle.checked = Boolean(settings.generateImages);
}

artStylePresetSelect.addEventListener("change", updateArtStyleCustomVisibility);
toneWhimsyInput.addEventListener("input", updateToneWhimsyLabel);

saveStoryStyleButton.addEventListener("click", async () => {
  const artStyle =
    artStylePresetSelect.value === "custom"
      ? artStyleCustomInput.value.trim()
      : artStylePresetSelect.value;

  storyStyleStatusEl.hidden = false;
  storyStyleStatusEl.textContent = "Saving…";
  try {
    await api("/settings", {
      method: "POST",
      body: JSON.stringify({
        artStyle,
        worldSetting: worldSettingInput.value.trim(),
        toneWhimsy: Number(toneWhimsyInput.value) / 100,
        contentIntensity: contentIntensitySelect.value,
      }),
    });
    storyStyleStatusEl.textContent = "Saved. Applies to the next session you start.";
  } catch (err) {
    storyStyleStatusEl.textContent = `Error: ${err.message}`;
  }
});

// --- Settings: image generation toggle ---
generateImagesToggle.addEventListener("change", async () => {
  generateImagesStatusEl.hidden = false;
  generateImagesStatusEl.textContent = "Saving…";
  try {
    await api("/settings", {
      method: "POST",
      body: JSON.stringify({ generateImages: generateImagesToggle.checked }),
    });
    generateImagesStatusEl.textContent = generateImagesToggle.checked
      ? "Saved. Applies to the next session you start."
      : "Saved. Image generation off.";
  } catch (err) {
    generateImagesToggle.checked = !generateImagesToggle.checked;
    generateImagesStatusEl.textContent = `Error: ${err.message}`;
  }
});

// --- Settings: connection (server address + passphrase) ---
serverAddressInput.value = connection.serverAddress;
serverPassphraseInput.value = connection.passphrase;

saveConnectionButton.addEventListener("click", () => {
  connection = {
    serverAddress: serverAddressInput.value.trim(),
    passphrase: serverPassphraseInput.value,
  };
  saveConnection(connection);
  connectionStatusEl.hidden = false;
  connectionStatusEl.textContent = "Saved. Reconnecting…";
  boot();
});

// --- Boot ---
async function boot() {
  if (!connection.passphrase) {
    addBubble(
      "system",
      "— Set the server address and passphrase in Settings, then Save & reconnect —"
    );
    return;
  }
  try {
    await loadModelOptions();
    await loadStoryStyle();
    const result = await startSession();
    addBubble(
      "system",
      result.resumed
        ? `— Resumed campaign on ${result.model} —`
        : `— New campaign session on ${result.model} —`
    );
    if (connectionStatusEl) {
      connectionStatusEl.textContent = "Connected.";
    }
  } catch (err) {
    addBubble("error", `Failed to start session: ${err.message}`);
  }
}

boot();
