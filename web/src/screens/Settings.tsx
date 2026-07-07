import { useEffect, useState } from "react";
import type { Connection } from "../lib/connection";
import { type ConnectionStatus } from "../lib/api";
import {
  getModels,
  getUserDefaults,
  saveUserDefaults,
  type CampaignSettings,
  type CampaignSettingsPatch,
  type ModelOption,
  type ProviderOption,
} from "../lib/campaign";
import { ToggleRow } from "../components/LookControls";
import { EnginePicker } from "../components/EnginePicker";
import { LookSettingsEditor } from "../components/LookSettingsEditor";
import { WorldSettingsEditor } from "../components/WorldSettingsEditor";
import { PlaylistPicker } from "../components/PlaylistPicker";
import { useIsDesktop } from "../lib/useIsDesktop";
import {
  getMusicConfig,
  saveMusicSettings,
  type MusicConfig,
  type MusicSource,
} from "../lib/music";

interface SettingsProps {
  onBack: () => void;
  connection: Connection;
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

/** Issue #114: the main Settings screen edits the signed-in account's DEFAULTS
 * — the engine, look, and world every NEW chronicle inherits — plus account
 * music and the device connection. It no longer touches whatever game happens
 * to be "active": per-game settings are set when a game is created and changed
 * from the in-game settings screen (the gear in Active Play). This removes the
 * old muddle where opening Settings from Home silently rewrote the current
 * game's engine/look/world, and the awkward "no game yet" empty state (#97).
 *
 * Every content control applies itself immediately on interaction (click a
 * model row, flip a toggle, release the whimsy slider) via POST /me/settings,
 * with a small inline status line. Only Connection keeps an explicit "Save &
 * Reconnect" button — typing a server address char-by-char shouldn't fire a
 * reconnect on every keystroke. */
export function Settings({
  onBack,
  connection,
  connectionStatus,
  onSaveConnection,
  onTestConnection,
  onLogout,
}: SettingsProps) {
  const [serverAddress, setServerAddress] = useState(connection.serverAddress);

  const [models, setModels] = useState<ModelOption[]>([]);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  // The account defaults being edited. Null until loaded.
  const [defaults, setDefaults] = useState<Partial<CampaignSettings> | null>(null);
  const [defaultsStatus, setDefaultsStatus] = useState<"loading" | "ready" | "error">("loading");

  const [engineSave, setEngineSave] = useState<SaveState>("idle");
  const [lookSave, setLookSave] = useState<SaveState>("idle");
  const [worldSave, setWorldSave] = useState<SaveState>("idle");
  const [music, setMusic] = useState<MusicConfig | null>(null);
  const [navUrl, setNavUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    getMusicConfig(connection)
      .then((cfg) => {
        if (cancelled) return;
        setMusic(cfg);
        setNavUrl(cfg.navidrome.url);
      })
      .catch(() => {});
    // Fetch the engine catalog and the account defaults independently.
    getModels(connection)
      .then((modelsResult) => {
        if (cancelled) return;
        setModels(modelsResult.models);
        setProviders(modelsResult.providers);
        // Backfill provider/model if the account has no stored value yet, so the
        // pickers always show a selection.
        setDefaults((prev) =>
          prev
            ? {
                provider: prev.provider ?? modelsResult.defaultProvider,
                model: prev.model ?? modelsResult.default,
                ...prev,
              }
            : prev
        );
      })
      .catch(() => {});
    setDefaultsStatus("loading");
    getUserDefaults(connection)
      .then((result) => {
        if (cancelled) return;
        setDefaults(result);
        setDefaultsStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setDefaults(null);
        setDefaultsStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [connection]);

  /** Persist a patch to the account defaults (POST /me/settings, server-side
   * merge) and reflect it locally. Shared by the engine, look, and world
   * controls — each just supplies its patch and status setter. */
  async function saveDefaults(patch: CampaignSettingsPatch | { provider: string; model: string }, setState: (s: SaveState) => void) {
    setState("saving");
    setDefaults((prev) => ({ ...prev, ...patch }));
    try {
      await saveUserDefaults(connection, patch as Partial<CampaignSettings>);
      setState("saved");
    } catch {
      setState("error");
    }
  }

  /** Switching the default engine picks that provider's default model — the two
   * providers share no models, so the old model can't carry over. */
  function pickProvider(providerId: string) {
    if (defaults?.provider === providerId) return;
    const prov = providers.find((p) => p.id === providerId);
    const model = prov?.default ?? defaults?.model ?? "";
    void saveDefaults({ provider: providerId, model }, setEngineSave);
  }

  function pickModel(modelId: string) {
    if (defaults?.model === modelId) return;
    void saveDefaults({ model: modelId } as CampaignSettingsPatch & { model: string }, setEngineSave);
  }

  /** ADR-0020: persist an account music preference and refresh the local config
   * so the source picker / Navidrome fields reflect it. */
  async function patchMusic(
    patch: Partial<{ enabled: boolean; source: MusicSource; navidromeUrl: string; navidromePlaylist: string }>
  ) {
    try {
      await saveMusicSettings(connection, patch);
      const cfg = await getMusicConfig(connection);
      setMusic(cfg);
      setNavUrl(cfg.navidrome.url);
    } catch {
      // best-effort — the toggle just won't reflect until a working save
    }
  }

  const dotColor = connectionStatus === "connected" ? "var(--arcane)" : "var(--ember)";

  // ADR-0021: cap and center the settings column on desktop; trim the phone
  // status-bar top inset on the header.
  const isDesktop = useIsDesktop();
  const columnStyle = isDesktop ? { width: "100%", maxWidth: 720, margin: "0 auto" } : {};

  return (
    <div className="screen leather-ground">
      <div
        style={{
          flexShrink: 0,
          padding: isDesktop ? "22px 16px 12px" : "54px 16px 12px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderBottom: "1px solid rgba(109,90,56,.3)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, ...columnStyle }}>
          <button className="icon-button" data-testid="settings-back" onClick={onBack}>
            <span className="back-chevron" />
          </button>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, letterSpacing: 2, color: "var(--ink)" }}>
            SETTINGS
          </div>
        </div>
      </div>

      <div className="cx-scroll" style={{ flex: 1, overflowY: "auto", padding: "20px 18px 40px" }}>
        <div style={columnStyle}>
          <div style={{ fontSize: 11.5, color: "var(--ink-faint)", fontStyle: "italic", marginBottom: 4 }}>
            These are your defaults for <strong style={{ color: "var(--ink-dim)" }}>new chronicles</strong>. To change a
            game already in progress, open its settings from the gear in Active Play.
          </div>

          {/* THE ENGINE — account default (#114) */}
          <div style={{ ...sectionHeadingStyle, margin: "12px 0 4px" }}>THE ENGINE</div>
          {defaultsStatus === "loading" ? (
            <div style={{ fontSize: 12, color: "var(--ink-faint)", fontStyle: "italic" }}>Reading your defaults…</div>
          ) : !defaults ? (
            <div style={{ fontSize: 12, color: "var(--ink-faint)", fontStyle: "italic", lineHeight: 1.55 }}>
              Couldn't load your defaults. Check the connection below, then reopen Settings.
            </div>
          ) : (
            <>
              <EnginePicker
                providers={providers}
                models={models}
                provider={defaults.provider ?? ""}
                model={defaults.model ?? ""}
                onPickProvider={pickProvider}
                onPickModel={pickModel}
                status={
                  <div data-testid="model-save-status" style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 2 }}>
                    {engineSave === "saving" && "Saving…"}
                    {engineSave === "saved" && "Saved as your default engine."}
                    {engineSave === "error" && "Couldn't save — try again."}
                  </div>
                }
              />

              {/* THE LOOK — account default */}
              <div style={sectionHeadingStyle}>THE LOOK</div>
              <LookSettingsEditor value={defaults} onPatch={(patch) => saveDefaults(patch, setLookSave)} />
              <div data-testid="look-save-status" style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 6 }}>
                {lookSave === "saving" && "Saving…"}
                {lookSave === "saved" && "Saved as your default."}
                {lookSave === "error" && "Couldn't save — try again."}
              </div>

              {/* THE WORLD — account default */}
              <div style={sectionHeadingStyle}>THE WORLD</div>
              <WorldSettingsEditor value={defaults} onPatch={(patch) => saveDefaults(patch, setWorldSave)} />
              <div data-testid="world-save-status" style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 6 }}>
                {worldSave === "saving" && "Saving…"}
                {worldSave === "saved" && "Saved as your default."}
                {worldSave === "error" && "Couldn't save — try again."}
              </div>
            </>
          )}

          {/* THE MUSIC — ACCOUNT DEFAULT (ADR-0020): background music for every
              game that hasn't set its own override. Your own local files or a
              Navidrome LAN playlist. Off by default; when on, the mute button
              appears in Active Play. */}
          {music && (
            <>
              <div style={sectionHeadingStyle}>MUSIC — ACCOUNT DEFAULT</div>
              <div style={{ fontSize: 11.5, color: "var(--ink-faint)", fontStyle: "italic", marginBottom: 8 }}>
                The music every game uses unless it sets its own from the in-game settings.
              </div>
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
                      <div style={{ fontSize: 11, color: "var(--ink-dim)", margin: "11px 0 4px" }}>Playlist</div>
                      {/* #110: pick from the chronicle-tagged playlists (or add your own). */}
                      <PlaylistPicker
                        connection={connection}
                        campaignId={null}
                        value={music.navidrome.playlist}
                        onChange={(name) => name !== music.navidrome.playlist && patchMusic({ navidromePlaylist: name })}
                      />
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* THE HEARTH */}
          <div style={sectionHeadingStyle}>THE HEARTH</div>
          <div style={{ fontSize: 11.5, color: "var(--ink-faint)", fontStyle: "italic", marginBottom: 10 }}>
            Your phone only talks to your home server over the LAN — that server is what reaches out to Claude and Grok.
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
    </div>
  );
}
