import { useEffect, useState } from "react";
import type { Connection } from "../lib/connection";
import type { ConnectionStatus } from "../lib/api";
import {
  getCampaignSettings,
  getModels,
  startSession,
  updateCampaignSettings,
  type CampaignSettings,
  type ModelOption,
} from "../lib/campaign";

interface SettingsProps {
  onBack: () => void;
  connection: Connection;
  campaignId: string;
  connectionStatus: ConnectionStatus;
  onSaveConnection: (connection: Connection) => void;
  onTestConnection: () => void;
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  unchecked: "Not yet tested",
  checking: "Testing…",
  connected: "Connected to the hearth",
  unauthorized: "Wrong passphrase",
  unreachable: "Could not reach that address — check the IP and that both devices are on the same network",
  "origin-mismatch": "This page was loaded from a different address — reload the app from the address above",
};

const ART_PRESETS = ["comic book", "Lego-style", "pencil sketch", "watercolour", "anime", "pixel art", "noir", "oil painting"];

const INTENSITY_OPTIONS: Array<{ id: "standard" | "low"; label: string; note: string }> = [
  { id: "standard", label: "Standard", note: "Full range of humour and description." },
  { id: "low", label: "Low", note: "No crude humour; violence stays non-graphic." },
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
}: SettingsProps) {
  const [serverAddress, setServerAddress] = useState(connection.serverAddress);
  const [passphrase, setPassphrase] = useState(connection.passphrase);

  const [models, setModels] = useState<ModelOption[]>([]);
  const [settings, setSettings] = useState<CampaignSettings | null>(null);
  const [customArtStyle, setCustomArtStyle] = useState("");
  const [whimsyDraft, setWhimsyDraft] = useState(0);

  const [modelSave, setModelSave] = useState<SaveState>("idle");
  const [lookSave, setLookSave] = useState<SaveState>("idle");
  const [worldSave, setWorldSave] = useState<SaveState>("idle");

  useEffect(() => {
    let cancelled = false;
    Promise.all([getModels(connection), getCampaignSettings(connection, campaignId)])
      .then(([modelsResult, settingsResult]) => {
        if (cancelled) return;
        setModels(modelsResult.models);
        setSettings(settingsResult);
        setWhimsyDraft(settingsResult.toneWhimsy ?? 0);
        if (settingsResult.artStyle && !ART_PRESETS.includes(settingsResult.artStyle)) {
          setCustomArtStyle(settingsResult.artStyle);
        }
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
      await startSession(connection, campaignId, modelId);
      setSettings((prev) => (prev ? { ...prev, model: modelId } : prev));
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
            {models.map((option) => {
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
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "11px 14px",
                borderRadius: 4,
                background: "rgba(28,20,12,.55)",
                border: "1px solid rgba(109,90,56,.36)",
              }}
            >
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 13.5, color: "var(--ink)" }}>Generate scene art</div>
                <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 2 }}>Off by default · needs Grok Build configured</div>
              </div>
              <button
                data-testid="images-toggle"
                aria-pressed={!!settings.generateImages}
                onClick={() => patchSettings({ generateImages: !settings.generateImages }, setLookSave)}
                style={{
                  width: 46,
                  height: 26,
                  borderRadius: 20,
                  cursor: "pointer",
                  border: `1px solid ${settings.generateImages ? "rgba(211,112,60,.9)" : "rgba(109,90,56,.4)"}`,
                  background: settings.generateImages ? "rgba(211,112,60,.85)" : "rgba(12,8,5,.6)",
                  position: "relative",
                  transition: "background 0.2s, border-color 0.2s",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 2,
                    left: settings.generateImages ? 24 : 2,
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: settings.generateImages ? "#fbeede" : "#8c7c62",
                    transition: "left 0.2s, background 0.2s",
                  }}
                />
              </button>
            </div>

            <div style={{ fontSize: 12, color: "var(--ink-dim)", margin: "12px 0 7px" }}>
              Art style <span style={{ color: "var(--ink-faint)" }}>— appended to every image prompt</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {ART_PRESETS.map((preset) => {
                const selected = settings.artStyle === preset && !customArtStyle;
                return (
                  <button
                    key={preset}
                    data-testid="art-preset"
                    data-selected={selected}
                    onClick={() => {
                      setCustomArtStyle("");
                      patchSettings({ artStyle: preset }, setLookSave);
                    }}
                    style={{
                      cursor: "pointer",
                      padding: "7px 12px",
                      borderRadius: 20,
                      fontFamily: "var(--font-body)",
                      fontSize: 12.5,
                      background: selected ? "rgba(211,112,60,.9)" : "rgba(28,20,12,.5)",
                      border: `1px solid ${selected ? "rgba(211,112,60,.9)" : "rgba(109,90,56,.36)"}`,
                      color: selected ? "#fbeede" : "var(--ink-dim)",
                    }}
                  >
                    {preset}
                  </button>
                );
              })}
            </div>
            <input
              value={customArtStyle}
              onChange={(e) => setCustomArtStyle(e.target.value)}
              onBlur={() => {
                if (customArtStyle.trim()) patchSettings({ artStyle: customArtStyle.trim() }, setLookSave);
              }}
              placeholder="or describe your own — stained glass, ukiyo-e, storybook…"
              data-testid="art-custom-input"
              style={{
                marginTop: 8,
                width: "100%",
                boxSizing: "border-box",
                background: customArtStyle ? "rgba(124,61,32,.2)" : "rgba(12,8,5,.5)",
                border: `1px solid ${customArtStyle ? "rgba(211,112,60,.7)" : "rgba(109,90,56,.4)"}`,
                borderRadius: 20,
                padding: "8px 14px",
                color: "var(--ink)",
                fontFamily: "var(--font-body)",
                fontStyle: "italic",
                fontSize: 13,
                outline: "none",
              }}
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

            {/* Issue #44: engine rolls dice by default; off = you provide values. */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "11px 14px",
                borderRadius: 4,
                background: "rgba(28,20,12,.55)",
                border: "1px solid rgba(109,90,56,.36)",
                margin: "18px 0 0",
              }}
            >
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 13.5, color: "var(--ink)" }}>Auto-roll dice</div>
                <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 2 }}>
                  On: the DM rolls for you · Off: you supply your own roll values
                </div>
              </div>
              {(() => {
                const on = settings.autoRollDice !== false; // absent === on
                return (
                  <button
                    data-testid="dice-toggle"
                    aria-pressed={on}
                    onClick={() => patchSettings({ autoRollDice: !on }, setWorldSave)}
                    style={{
                      width: 46,
                      height: 26,
                      borderRadius: 20,
                      cursor: "pointer",
                      border: `1px solid ${on ? "rgba(211,112,60,.9)" : "rgba(109,90,56,.4)"}`,
                      background: on ? "rgba(211,112,60,.85)" : "rgba(12,8,5,.6)",
                      position: "relative",
                      transition: "background 0.2s, border-color 0.2s",
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        top: 2,
                        left: on ? 24 : 2,
                        width: 20,
                        height: 20,
                        borderRadius: "50%",
                        background: on ? "#fbeede" : "#8c7c62",
                        transition: "left 0.2s, background 0.2s",
                      }}
                    />
                  </button>
                );
              })()}
            </div>

            <div data-testid="world-save-status" style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 6 }}>
              {worldSave === "saving" && "Saving…"}
              {worldSave === "saved" && "Saved (POST /settings)."}
              {worldSave === "error" && "Couldn't save — try again."}
            </div>
          </>
        )}

        {/* THE HEARTH */}
        <div style={sectionHeadingStyle}>THE HEARTH</div>
        <div style={{ fontSize: 11.5, color: "var(--ink-faint)", fontStyle: "italic", marginBottom: 10 }}>
          Your phone only talks to your home server over the LAN — that
          server is what reaches out to Claude and Grok.
        </div>

        <div style={{ fontSize: 11, color: "var(--ink-dim)", marginBottom: 4 }}>Server address</div>
        <input
          value={serverAddress}
          onChange={(e) => setServerAddress(e.target.value)}
          placeholder="192.168.1.24:4317"
          style={textInputStyle}
        />
        <div style={{ fontSize: 11, color: "var(--ink-dim)", margin: "11px 0 4px" }}>Passphrase</div>
        <input value={passphrase} onChange={(e) => setPassphrase(e.target.value)} type="password" style={textInputStyle} />

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
          onClick={() => onSaveConnection({ serverAddress, passphrase })}
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
          {/* Issue #35: while checking, the button itself is the "working"
              indicator; on success App navigates Home, and on failure the
              status line above (next to TEST) shows the reason — so there's
              always a visible response, and no duplicated status text. */}
          {connectionStatus === "checking" ? "RECONNECTING…" : "SAVE & RECONNECT"}
        </button>
      </div>
    </div>
  );
}
