import { useEffect, useState } from "react";
import type { Connection } from "../lib/connection";
import type { ConnectionStatus } from "../lib/api";
import {
  getCampaignSettings,
  getModels,
  startSession,
  updateCampaignSettings,
  saveUserDefaults,
  type CampaignSettings,
  type ModelOption,
  type ProviderOption,
  type ResponseLength,
} from "../lib/campaign";
import { ToggleRow, ArtStylePicker } from "../components/LookControls";
import { getMusicConfig, saveMusicSettings, type MusicConfig, type MusicSource } from "../lib/music";

interface SettingsProps {
  onBack: () => void;
  connection: Connection;
  campaignId: string;
  connectionStatus: ConnectionStatus;
  onSaveConnection: (connection: Connection) => void;
  onTestConnection: () => void;
  onLogout: () => void;
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  unchecked: "Not yet tested",
  checking: "Testing…",
  connected: "Connected to the hearth",
  unauthorized: "Session expired — log in again",
  unreachable: "Could not reach that address — check the IP and that both devices are on the same network",
  "origin-mismatch": "This page was loaded from a different address — reload the app from the address above",
};

const INTENSITY_OPTIONS: Array<{ id: "standard" | "low"; label: string; note: string }> = [
  { id: "standard", label: "Standard", note: "Full range of humour and description." },
  { id: "low", label: "Low", note: "No crude humour; violence stays non-graphic." },
];

// Issue #69: how long/detailed the DM's replies run. Absent === "detailed".
const LENGTH_OPTIONS: Array<{ id: ResponseLength; label: string; note: string }> = [
  { id: "concise", label: "Concise", note: "Short replies that mirror your input length." },
  { id: "standard", label: "Standard", note: "A paragraph or two, scaling with the scene." },
  { id: "detailed", label: "Detailed", note: "Rich, immersive, multi-paragraph narration." },
];

function whimsyLabel(value: number): string {
  if (value < 0.22) return "Grounded";
  if (value < 0.45) return "A little strange";
  if (value < 0.7) return "Often strange";
  return "Deeply strange";
}

const sectionHeadingStyle = {
  fontFamily: "var(--font-display)",
  fontSize: 11,
  letterSpacing: 2,
  color: "var(--brass)",
  margin: "22px 0 4px",
} as const;

const textInputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  background: "rgba(12,8,5,.5)",
  border: "1px solid rgba(109,90,56,.4)",
  borderRadius: 4,
  padding: "10px 13px",
  color: "var(--ink)",
  fontFamily: "var(--font-mono)",
  fontSize: 13,
  outline: "none",
};

type SaveState = "idle" | "saving" | "saved" | "error";

/** Two genuinely different persistence mechanisms live on one screen —
 * model choice only ever changes via POST /session/start (backend
 * contract §5: "model is NOT part of [POST /settings] — posting model to
 * this endpoint silently no-ops"), while every other Engine/Look/World
 * field goes through POST /campaigns/:id/settings. Per Slice 24's own
 * instruction, this must not be papered over with one "Save" button that
 * quietly fires two kinds of requests — so instead every control here
 * applies itself immediately on interaction (click a model row, click an
 * art chip, flip a toggle, release the whimsy slider) with its own small
 * inline status line, the same auto-apply pattern the design mockup
 * itself uses for these three sections. Only Connection keeps an
 * explicit "Save & Reconnect" button, because that one really does need
 * a deliberate commit — typing a passphrase char-by-char shouldn't fire
 * a reconnect attempt on every keystroke. */
export function Settings({
  onBack,
  connection,
  campaignId,
  connectionStatus,
  onSaveConnection,
  onTestConnection,
  onLogout,
}: SettingsProps) {
  const [serverAddress, setServerAddress] = useState(connection.serverAddress);

  const [models, setModels] = useState<ModelOption[]>([]);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [settings, setSettings] = useState<CampaignSettings | null>(null);
  const [whimsyDraft, setWhimsyDraft] = useState(0);

  const [modelSave, setModelSave] = useState<SaveState>("idle");
  const [lookSave, setLookSave] = useState<SaveState>("idle");
  const [worldSave, setWorldSave] = useState<SaveState>("idle");
  const [defaultsSave, setDefaultsSave] = useState<SaveState>("idle");
  const [music, setMusic] = useState<MusicConfig | null>(null);
  const [navUrl, setNavUrl] = useState("");
  const [navPlaylist, setNavPlaylist] = useState("");

  useEffect(() => {
    let cancelled = false;
    getMusicConfig(connection)
      .then((cfg) => {
        if (cancelled) return;
        setMusic(cfg);
        setNavUrl(cfg.navidrome.url);
        setNavPlaylist(cfg.navidrome.playlist);
      })
      .catch(() => {});
    Promise.all([getModels(connection), getCampaignSettings(connection, campaignId)])
      .then(([modelsResult, settingsResult]) => {
        if (cancelled) return;
        setModels(modelsResult.models);
        setProviders(modelsResult.providers);
        setSettings(settingsResult);
        setWhimsyDraft(settingsResult.toneWhimsy ?? 0);
      })
      .catch(() => {
        // Settings are best-effort display — a failed fetch here just
        // leaves the sections showing their loading state, not an error
        // screen; Connection (below) is what actually surfaces
        // reachability problems.
      });
    return () => {
      cancelled = true;
    };
  }, [connection, campaignId]);

  async function pickModel(modelId: string) {
    setModelSave("saving");
    try {
      // Model-only: the clicked model always belongs to the currently-selected
      // provider (the list is filtered to it), and the server resolves provider
      // from stored settings, which this screen keeps in sync. Trust the
      // resolved pair the server returns.
      const result = await startSession(connection, campaignId, modelId);
      setSettings((prev) => (prev ? { ...prev, model: result.model, provider: result.provider } : prev));
      setModelSave("saved");
    } catch {
      setModelSave("error");
    }
  }

  /** ADR-0018: switching the DM engine is the same session-resetting
   * POST /session/start path as a model change. We send only the provider and
   * let the server pick that provider's default model (or keep the stored one
   * if it already belongs) — then trust the resolved {provider, model} pair it
   * returns rather than guessing client-side. */
  async function pickProvider(providerId: string) {
    if (settings?.provider === providerId) return;
    setModelSave("saving");
    try {
      const result = await startSession(connection, campaignId, undefined, providerId);
      setSettings((prev) => (prev ? { ...prev, provider: result.provider, model: result.model } : prev));
      setModelSave("saved");
    } catch {
      setModelSave("error");
    }
  }

  async function patchSettings(patch: Parameters<typeof updateCampaignSettings>[2], setState: (s: SaveState) => void) {
    setState("saving");
    try {
      const next = await updateCampaignSettings(connection, campaignId, patch);
      setSettings(next);
      setState("saved");
    } catch {
      setState("error");
    }
  }

  /** ADR-0019: copy this game's engine/look/play settings into the user's
   * account defaults, so every NEW chronicle starts from them. worldSetting is
   * excluded — that's each game's own premise, typed fresh (ADR-0014). */
  async function saveAsDefaults() {
    if (!settings) return;
    setDefaultsSave("saving");
    try {
      const { worldSetting: _world, ...rest } = settings;
      await saveUserDefaults(connection, rest);
      setDefaultsSave("saved");
    } catch {
      setDefaultsSave("error");
    }
  }

  /** ADR-0020: persist a music preference and refresh the local config so the
   * source picker / Navidrome fields reflect it. */
  async function patchMusic(
    patch: Partial<{ enabled: boolean; source: MusicSource; navidromeUrl: string; navidromePlaylist: string }>
  ) {
    try {
      await saveMusicSettings(connection, patch);
      const cfg = await getMusicConfig(connection);
      setMusic(cfg);
      setNavUrl(cfg.navidrome.url);
      setNavPlaylist(cfg.navidrome.playlist);
    } catch {
      // best-effort — the toggle just won't reflect until a working save
    }
  }

  const dotColor = connectionStatus === "connected" ? "var(--arcane)" : "var(--ember)";

  return (
    <div className="screen leather-ground">
      <div
        style={{
          flexShrink: 0,
          padding: "54px 16px 12px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderBottom: "1px solid rgba(109,90,56,.3)",
        }}
      >
        <button className="icon-button" data-testid="settings-back" onClick={onBack}>
          <span className="back-chevron" />
        </button>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, letterSpacing: 2, color: "var(--ink)" }}>
          SETTINGS
        </div>
      </div>

      <div className="cx-scroll" style={{ flex: 1, overflowY: "auto", padding: "20px 18px 40px" }}>
        {/* THE ENGINE */}
        <div style={{ ...sectionHeadingStyle, margin: "2px 0 4px" }}>THE ENGINE</div>
        {!settings ? (
          <div style={{ fontSize: 12, color: "var(--ink-faint)", fontStyle: "italic" }}>Reading campaign settings…</div>
        ) : (
          <>
            {providers.length > 0 && (
              <div style={{ display: "flex", gap: 7, marginBottom: 10 }}>
                {providers.map((p) => {
                  const active = settings.provider === p.id;
                  return (
                    <button
                      key={p.id}
                      data-testid="provider-option"
                      data-selected={active}
                      title={p.label}
                      onClick={() => pickProvider(p.id)}
                      style={{
                        flex: 1,
                        cursor: "pointer",
                        padding: "9px 12px",
                        borderRadius: 4,
                        fontFamily: "var(--font-display)",
                        fontWeight: 600,
                        fontSize: 13,
                        color: active ? "var(--ink)" : "var(--ink-faint)",
                        background: active ? "rgba(124,61,32,.24)" : "rgba(28,20,12,.5)",
                        border: `1px solid ${active ? "rgba(211,112,60,.55)" : "rgba(109,90,56,.32)"}`,
                      }}
                    >
                      {p.label.split("—")[0].trim()}
                    </button>
                  );
                })}
              </div>
            )}
            {(providers.find((p) => p.id === settings.provider)?.models ?? models).map((option) => {
              const selected = settings.model === option.id;
              return (
                <button
                  key={option.id}
                  data-testid="model-option"
                  data-selected={selected}
                  onClick={() => pickModel(option.id)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    cursor: "pointer",
                    marginBottom: 7,
                    padding: "12px 14px",
                    borderRadius: 4,
                    background: selected ? "rgba(124,61,32,.24)" : "rgba(28,20,12,.5)",
                    border: `1px solid ${selected ? "rgba(211,112,60,.55)" : "rgba(109,90,56,.32)"}`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>
                      {option.label}
                    </span>
                    <span
                      style={{
                        width: 15,
                        height: 15,
                        borderRadius: "50%",
                        border: `1.5px solid ${selected ? "#d3703c" : "#6d5a38"}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: selected ? "#d3703c" : "transparent" }} />
                    </span>
                  </div>
                </button>
              );
            })}
            <div data-testid="model-save-status" style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 2 }}>
              {modelSave === "saving" && "Updating…"}
              {modelSave === "saved" && "Model updated (POST /session/start)."}
              {modelSave === "error" && "Couldn't update the model — try again."}
            </div>
          </>
        )}

        {/* THE LOOK */}
        <div style={sectionHeadingStyle}>THE LOOK</div>
        {settings && (
          <>
            <ToggleRow
              testId="images-toggle"
              title="Generate scene art"
              description="Off by default · needs Grok Build configured"
              checked={!!settings.generateImages}
              onChange={(next) => patchSettings({ generateImages: next }, setLookSave)}
            />

            {/* Issue #56: auto-illustrate each turn — only meaningful (and only
                shown) when scene art is on, since it needs Grok Build too. */}
            {settings.generateImages && (
              <ToggleRow
                testId="auto-illustrate-toggle"
                title="Auto-illustrate each turn"
                description="Draws every DM reply · the image appears a moment after the text"
                checked={!!settings.autoIllustrateTurns}
                onChange={(next) => patchSettings({ autoIllustrateTurns: next }, setLookSave)}
                containerStyle={{ marginTop: 8 }}
              />
            )}

            <ArtStylePicker
              artStyle={settings.artStyle ?? ""}
              onChange={(style) => patchSettings({ artStyle: style }, setLookSave)}
            />
            <div data-testid="look-save-status" style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 6 }}>
              {lookSave === "saving" && "Saving…"}
              {lookSave === "saved" && "Saved (POST /settings)."}
              {lookSave === "error" && "Couldn't save — try again."}
            </div>
          </>
        )}

        {/* THE WORLD */}
        <div style={sectionHeadingStyle}>THE WORLD</div>
        {settings && (
          <>
            <div style={{ fontSize: 12, color: "var(--ink-dim)", marginBottom: 6 }}>
              Setting <span style={{ color: "var(--ink-faint)" }}>— empty keeps standard fantasy</span>
            </div>
            <input
              defaultValue={settings.worldSetting ?? ""}
              onBlur={(e) => patchSettings({ worldSetting: e.target.value.trim() }, setWorldSave)}
              placeholder="e.g. underwater merfolk city-states…"
              data-testid="world-setting-input"
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "rgba(12,8,5,.5)",
                border: "1px solid rgba(109,90,56,.4)",
                borderRadius: 4,
                padding: "11px 13px",
                color: "var(--ink)",
                fontFamily: "var(--font-body)",
                fontStyle: "italic",
                fontSize: 14,
                outline: "none",
              }}
            />

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "18px 0 5px" }}>
              <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>Tone &amp; whimsy</span>
              <span
                data-testid="whimsy-label"
                style={{ fontFamily: "var(--font-display)", fontSize: 11, letterSpacing: 1, color: "var(--ember)" }}
              >
                {whimsyLabel(whimsyDraft)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={whimsyDraft}
              onChange={(e) => {
                const next = Number(e.target.value);
                setWhimsyDraft(next);
                patchSettings({ toneWhimsy: next }, setWorldSave);
              }}
              data-testid="whimsy-slider"
              style={{ width: "100%", accentColor: "#d3703c", height: 4 }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--ink-faint)", marginTop: 3 }}>
              <span>grounded</span>
              <span>deeply strange</span>
            </div>

            <div style={{ fontSize: 12, color: "var(--ink-dim)", margin: "18px 0 6px" }}>Content intensity</div>
            <div style={{ display: "flex", gap: 7 }}>
              {INTENSITY_OPTIONS.map((option) => {
                const selected = (settings.contentIntensity ?? "standard") === option.id;
                return (
                  <button
                    key={option.id}
                    data-testid="intensity-option"
                    data-selected={selected}
                    onClick={() => patchSettings({ contentIntensity: option.id }, setWorldSave)}
                    style={{
                      flex: 1,
                      cursor: "pointer",
                      textAlign: "left",
                      padding: "11px 13px",
                      borderRadius: 4,
                      background: selected ? "rgba(124,61,32,.24)" : "rgba(28,20,12,.5)",
                      border: `1px solid ${selected ? "rgba(211,112,60,.55)" : "rgba(109,90,56,.32)"}`,
                    }}
                  >
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 13, color: selected ? "#efe6d2" : "var(--ink-dim)" }}>
                      {option.label}
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginTop: 3, lineHeight: 1.35 }}>{option.note}</div>
                  </button>
                );
              })}
            </div>

            {/* Issue #69: how long/detailed the DM's replies run. Absent === detailed. */}
            <div style={{ fontSize: 12, color: "var(--ink-dim)", margin: "18px 0 6px" }}>Reply length</div>
            <div style={{ display: "flex", gap: 7 }}>
              {LENGTH_OPTIONS.map((option) => {
                const selected = (settings.responseLength ?? "detailed") === option.id;
                return (
                  <button
                    key={option.id}
                    data-testid="length-option"
                    data-selected={selected}
                    onClick={() => patchSettings({ responseLength: option.id }, setWorldSave)}
                    style={{
                      flex: 1,
                      cursor: "pointer",
                      textAlign: "left",
                      padding: "11px 13px",
                      borderRadius: 4,
                      background: selected ? "rgba(124,61,32,.24)" : "rgba(28,20,12,.5)",
                      border: `1px solid ${selected ? "rgba(211,112,60,.55)" : "rgba(109,90,56,.32)"}`,
                    }}
                  >
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 13, color: selected ? "#efe6d2" : "var(--ink-dim)" }}>
                      {option.label}
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginTop: 3, lineHeight: 1.35 }}>{option.note}</div>
                  </button>
                );
              })}
            </div>

            {/* Issue #44: engine rolls dice by default; off = you provide values. */}
            <ToggleRow
              testId="dice-toggle"
              title="Auto-roll dice"
              description="On: the DM rolls for you · Off: you supply your own roll values"
              checked={settings.autoRollDice !== false} // absent === on
              onChange={(next) => patchSettings({ autoRollDice: next }, setWorldSave)}
              containerStyle={{ margin: "18px 0 0" }}
            />

            <div data-testid="world-save-status" style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 6 }}>
              {worldSave === "saving" && "Saving…"}
              {worldSave === "saved" && "Saved (POST /settings)."}
              {worldSave === "error" && "Couldn't save — try again."}
            </div>
          </>
        )}

        {/* THE MUSIC (ADR-0020): background music — your own local files or a
            Navidrome LAN playlist. Off by default; when on, the mute button
            appears in Active Play. */}
        {music && (
          <>
            <div style={sectionHeadingStyle}>THE MUSIC</div>
            <ToggleRow
              testId="music-enabled"
              title="Play background music"
              description="Off by default · when on, a mute button appears during play"
              checked={music.enabled}
              onChange={(next) => patchMusic({ enabled: next })}
              containerStyle={{ margin: "4px 0 0" }}
            />
            {music.enabled && (
              <>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  {(["local", "navidrome"] as const).map((src) => (
                    <button
                      key={src}
                      data-testid={`music-source-${src}`}
                      onClick={() => patchMusic({ source: src })}
                      style={{
                        flex: 1,
                        cursor: "pointer",
                        padding: "9px 10px",
                        borderRadius: 4,
                        background: music.source === src ? "rgba(168,81,31,.25)" : "rgba(12,8,5,.5)",
                        border: `1px solid ${music.source === src ? "var(--ember)" : "rgba(109,90,56,.4)"}`,
                        color: "var(--ink)",
                        fontFamily: "var(--font-display)",
                        fontSize: 12,
                        letterSpacing: 1,
                      }}
                    >
                      {src === "local" ? "LOCAL FILES" : "NAVIDROME"}
                    </button>
                  ))}
                </div>

                {music.source === "local" && (
                  <div style={{ fontSize: 11.5, color: "var(--ink-faint)", fontStyle: "italic", marginTop: 8 }}>
                    {music.localTrackCount > 0
                      ? `${music.localTrackCount} track${music.localTrackCount === 1 ? "" : "s"} found in the music/ folder — played in shuffle.`
                      : "No files yet — drop .mp3/.wav/.ogg/.flac/.m4a into the music/ folder on the host."}
                  </div>
                )}

                {music.source === "navidrome" && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11.5, color: "var(--ink-faint)", fontStyle: "italic", marginBottom: 8 }}>
                      {music.navidrome.configured
                        ? "Streamed through your home server (credentials stay on the host)."
                        : "Set NAVIDROME_URL / USER / PASSWORD in the host's .env to enable streaming."}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--ink-dim)", marginBottom: 4 }}>Navidrome URL</div>
                    <input
                      value={navUrl}
                      onChange={(e) => setNavUrl(e.target.value)}
                      onBlur={() => navUrl !== music.navidrome.url && patchMusic({ navidromeUrl: navUrl })}
                      placeholder="http://192.168.1.214:4533"
                      style={textInputStyle}
                    />
                    <div style={{ fontSize: 11, color: "var(--ink-dim)", margin: "11px 0 4px" }}>Playlist name</div>
                    <input
                      value={navPlaylist}
                      onChange={(e) => setNavPlaylist(e.target.value)}
                      onBlur={() => navPlaylist !== music.navidrome.playlist && patchMusic({ navidromePlaylist: navPlaylist })}
                      placeholder="chronicle"
                      style={textInputStyle}
                    />
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ACCOUNT DEFAULTS (ADR-0019): make this game's settings the baseline
            for every new chronicle you start. Per-game settings above always
            override these defaults. */}
        {settings && (
          <>
            <div style={sectionHeadingStyle}>NEW-CHRONICLE DEFAULTS</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-faint)", fontStyle: "italic", marginBottom: 8 }}>
              Save this game's engine, look, and play settings as the defaults every
              new chronicle you begin will start from. Each game can still override them.
            </div>
            <button
              onClick={saveAsDefaults}
              data-testid="save-defaults"
              style={{
                cursor: "pointer",
                padding: "9px 14px",
                borderRadius: 3,
                background: "rgba(36,26,16,.6)",
                border: "1px solid var(--brass-dim)",
                color: "var(--ink-dim)",
                fontFamily: "var(--font-display)",
                fontSize: 11,
                letterSpacing: 1.2,
              }}
            >
              SAVE AS MY DEFAULTS
            </button>
            <div data-testid="defaults-save-status" style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 6 }}>
              {defaultsSave === "saving" && "Saving…"}
              {defaultsSave === "saved" && "Saved as your defaults for new chronicles."}
              {defaultsSave === "error" && "Couldn't save — try again."}
            </div>
          </>
        )}

        {/* THE HEARTH */}
        <div style={sectionHeadingStyle}>THE HEARTH</div>
        <div style={{ fontSize: 11.5, color: "var(--ink-faint)", fontStyle: "italic", marginBottom: 10 }}>
          Your phone only talks to your home server over the LAN — that
          server is what reaches out to Claude and Grok.
        </div>

        {/* ADR-0019: signed-in account. Passphrase is gone — identity is your
            account now, obtained on the login screen. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 13px",
            background: "rgba(12,8,5,.5)",
            border: "1px solid rgba(109,90,56,.4)",
            borderRadius: 4,
            marginBottom: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 10.5, color: "var(--ink-dim)", letterSpacing: 1 }}>SIGNED IN AS</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--ink)" }} data-testid="account-username">
              {connection.username || "—"}
            </div>
          </div>
          <button
            onClick={onLogout}
            data-testid="logout"
            style={{
              cursor: "pointer",
              padding: "8px 14px",
              borderRadius: 3,
              background: "rgba(36,26,16,.6)",
              border: "1px solid var(--brass-dim)",
              color: "var(--ink-dim)",
              fontFamily: "var(--font-display)",
              fontSize: 11,
              letterSpacing: 1.5,
            }}
          >
            LOG OUT
          </button>
        </div>

        <div style={{ fontSize: 11, color: "var(--ink-dim)", marginBottom: 4 }}>Server address</div>
        <input
          value={serverAddress}
          onChange={(e) => setServerAddress(e.target.value)}
          placeholder="192.168.1.24:4317"
          style={textInputStyle}
        />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, boxShadow: `0 0 8px ${dotColor}` }} />
            <span style={{ fontSize: 11.5, color: "var(--ink-dim)" }}>{STATUS_LABEL[connectionStatus]}</span>
          </div>
          <button
            onClick={onTestConnection}
            style={{
              cursor: "pointer",
              padding: "8px 14px",
              borderRadius: 3,
              background: "rgba(36,26,16,.6)",
              border: "1px solid var(--brass-dim)",
              color: "var(--ink-dim)",
              fontFamily: "var(--font-display)",
              fontSize: 11,
              letterSpacing: 1.5,
            }}
          >
            TEST
          </button>
        </div>

        <button
          data-testid="save-reconnect"
          disabled={connectionStatus === "checking"}
          onClick={() => onSaveConnection({ ...connection, serverAddress })}
          style={{
            marginTop: 18,
            width: "100%",
            cursor: connectionStatus === "checking" ? "default" : "pointer",
            opacity: connectionStatus === "checking" ? 0.7 : 1,
            padding: 12,
            borderRadius: 3,
            background: "linear-gradient(180deg,#d8743e,#a8511f)",
            border: "none",
            color: "#faf0e2",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: 1.5,
          }}
        >
          {connectionStatus === "checking" ? "RECONNECTING…" : "SAVE & RECONNECT"}
        </button>
      </div>
    </div>
  );
}
