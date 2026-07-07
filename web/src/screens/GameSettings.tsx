import { useEffect, useState } from "react";
import type { Connection } from "../lib/connection";
import {
  getCampaignSettings,
  getModels,
  updateCampaignSettings,
  type CampaignSettings,
  type CampaignSettingsPatch,
  type ModelOption,
  type ProviderOption,
} from "../lib/campaign";
import { EnginePicker } from "../components/EnginePicker";
import { LookSettingsEditor } from "../components/LookSettingsEditor";
import { WorldSettingsEditor } from "../components/WorldSettingsEditor";
import { MusicOverrideEditor } from "../components/MusicOverrideEditor";
import { useIsDesktop } from "../lib/useIsDesktop";
import { getMusicConfig, saveCampaignMusicSettings, resetCampaignMusicSettings, type MusicConfig, type MusicOverride } from "../lib/music";

interface GameSettingsProps {
  connection: Connection;
  campaignId: string;
  onBack: () => void;
}

const sectionHeadingStyle = {
  fontFamily: "var(--font-display)",
  fontSize: 11,
  letterSpacing: 2,
  color: "var(--brass)",
  margin: "22px 0 4px",
} as const;

type SaveState = "idle" | "saving" | "saved" | "error";

/** Issue #114: the in-game settings screen — reached from the gear in Active
 * Play — changes THIS game's per-game settings while it's in progress (the
 * counterpart to the main Settings screen, which now edits account defaults).
 *
 * It edits the game's Look, World, and music (POST /campaigns/:id/settings),
 * reusing the same shared editors the main screen uses. The engine and model
 * are shown READ-ONLY: they're chosen when the game is created and locked once
 * play begins, because switching mid-game left a stale session id the wrong
 * backend tried to resume and crashed (ADR-0018, #57; the backend also rejects
 * the change with 409). Every control applies itself immediately on interaction. */
export function GameSettings({ connection, campaignId, onBack }: GameSettingsProps) {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [settings, setSettings] = useState<CampaignSettings | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [gameMusic, setGameMusic] = useState<MusicConfig | null>(null);

  const [lookSave, setLookSave] = useState<SaveState>("idle");
  const [worldSave, setWorldSave] = useState<SaveState>("idle");

  useEffect(() => {
    let cancelled = false;
    getModels(connection)
      .then((result) => {
        if (cancelled) return;
        setModels(result.models);
        setProviders(result.providers);
      })
      .catch(() => {});
    getMusicConfig(connection, campaignId)
      .then((cfg) => !cancelled && setGameMusic(cfg))
      .catch(() => {});
    setStatus("loading");
    getCampaignSettings(connection, campaignId)
      .then((result) => {
        if (cancelled) return;
        setSettings(result);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setSettings(null);
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [connection, campaignId]);

  /** Persist a per-game patch (POST /campaigns/:id/settings) and reflect the
   * server's canonical response locally. */
  async function patchSettings(patch: CampaignSettingsPatch, setState: (s: SaveState) => void) {
    setState("saving");
    try {
      const next = await updateCampaignSettings(connection, campaignId, patch);
      setSettings(next);
      setState("saved");
    } catch {
      setState("error");
    }
  }

  /** #109: per-game music override — refresh both the effective config (drives
   * the editor) and settings.music (drives the override-present state). */
  async function patchGameMusic(patch: MusicOverride) {
    try {
      await saveCampaignMusicSettings(connection, campaignId, patch);
      const [cfg, s] = await Promise.all([getMusicConfig(connection, campaignId), getCampaignSettings(connection, campaignId)]);
      setGameMusic(cfg);
      setSettings(s);
    } catch {
      // best-effort
    }
  }

  async function resetGameMusic() {
    try {
      await resetCampaignMusicSettings(connection, campaignId);
      const [cfg, s] = await Promise.all([getMusicConfig(connection, campaignId), getCampaignSettings(connection, campaignId)]);
      setGameMusic(cfg);
      setSettings(s);
    } catch {
      // best-effort
    }
  }

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
          <button className="icon-button" data-testid="game-settings-back" onClick={onBack}>
            <span className="back-chevron" />
          </button>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, letterSpacing: 2, color: "var(--ink)" }}>
            GAME SETTINGS
          </div>
        </div>
      </div>

      <div className="cx-scroll" style={{ flex: 1, overflowY: "auto", padding: "20px 18px 40px" }} data-testid="game-settings-screen">
        <div style={columnStyle}>
          <div style={{ fontSize: 11.5, color: "var(--ink-faint)", fontStyle: "italic", marginBottom: 4 }}>
            Settings for <strong style={{ color: "var(--ink-dim)" }}>this game</strong>. Your defaults for new chronicles live in
            the main Settings screen on Home.
          </div>

          {status === "loading" ? (
            <div style={{ fontSize: 12, color: "var(--ink-faint)", fontStyle: "italic", marginTop: 12 }}>Reading this game's settings…</div>
          ) : !settings ? (
            <div style={{ fontSize: 12, color: "var(--ink-faint)", fontStyle: "italic", marginTop: 12, lineHeight: 1.55 }}>
              Couldn't load this game's settings. Go back and try again.
            </div>
          ) : (
            <>
              {/* THE ENGINE — locked once play has begun (#114) */}
              <div style={{ ...sectionHeadingStyle, margin: "14px 0 4px" }}>THE ENGINE</div>
              <EnginePicker
                providers={providers}
                models={models}
                provider={settings.provider}
                model={settings.model}
                onPickProvider={() => {}}
                onPickModel={() => {}}
                readOnly
                status={
                  <div data-testid="engine-locked-note" style={{ fontSize: 11, color: "var(--ink-faint)", fontStyle: "italic", marginTop: 2, lineHeight: 1.5 }}>
                    The engine and model are chosen when a chronicle is created and locked once play begins. Start a new
                    chronicle to use a different one.
                  </div>
                }
              />

              {/* THE LOOK — this game */}
              <div style={sectionHeadingStyle}>THE LOOK</div>
              <LookSettingsEditor value={settings} onPatch={(patch) => patchSettings(patch, setLookSave)} />
              <div data-testid="look-save-status" style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 6 }}>
                {lookSave === "saving" && "Saving…"}
                {lookSave === "saved" && "Saved for this game."}
                {lookSave === "error" && "Couldn't save — try again."}
              </div>

              {/* THE WORLD — this game */}
              <div style={sectionHeadingStyle}>THE WORLD</div>
              <WorldSettingsEditor value={settings} onPatch={(patch) => patchSettings(patch, setWorldSave)} />
              <div data-testid="world-save-status" style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 6 }}>
                {worldSave === "saving" && "Saving…"}
                {worldSave === "saved" && "Saved for this game."}
                {worldSave === "error" && "Couldn't save — try again."}
              </div>

              {/* MUSIC FOR THIS GAME (#109) */}
              {gameMusic && (
                <>
                  <div style={sectionHeadingStyle}>MUSIC FOR THIS GAME</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-faint)", fontStyle: "italic", marginBottom: 8 }}>
                    Give this chronicle its own music, or leave it following your account default. You can change it any
                    time — even mid-game.
                  </div>
                  <MusicOverrideEditor
                    connection={connection}
                    campaignId={campaignId}
                    override={settings.music}
                    effective={gameMusic}
                    onPatch={patchGameMusic}
                    onReset={resetGameMusic}
                  />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
