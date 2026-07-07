import { useEffect, useState } from "react";
import type { Connection } from "../lib/connection";
import { getCampaignSettings } from "../lib/campaign";
import {
  getMusicConfig,
  saveCampaignMusicSettings,
  resetCampaignMusicSettings,
  type MusicConfig,
  type MusicOverride,
} from "../lib/music";
import { MusicOverrideEditor } from "./MusicOverrideEditor";

// Issue #109: the inline per-game music override, opened from a small button
// beside the Active-Play transport so a player can retune this game's music
// mid-session without leaving the table. Wraps the same MusicOverrideEditor the
// Settings screen uses; on any change it re-fetches and calls onChanged() so the
// caller reloads playback (useMusicPlayer.reload).

interface GameMusicPopoverProps {
  connection: Connection;
  campaignId: string;
  /** Called after any override change so playback picks up the new config. */
  onChanged: () => void;
}

export function GameMusicPopover({ connection, campaignId, onChanged }: GameMusicPopoverProps) {
  const [open, setOpen] = useState(false);
  const [effective, setEffective] = useState<MusicConfig | null>(null);
  const [override, setOverride] = useState<MusicOverride | undefined>(undefined);

  async function refresh() {
    try {
      const [cfg, s] = await Promise.all([
        getMusicConfig(connection, campaignId),
        getCampaignSettings(connection, campaignId),
      ]);
      setEffective(cfg);
      setOverride(s.music);
    } catch {
      // best-effort — the popover just shows nothing loadable
    }
  }

  // Load fresh each time the popover opens (state may have changed elsewhere).
  useEffect(() => {
    if (open) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, campaignId]);

  async function patch(p: MusicOverride) {
    await saveCampaignMusicSettings(connection, campaignId, p);
    await refresh();
    onChanged();
  }

  async function reset() {
    await resetCampaignMusicSettings(connection, campaignId);
    await refresh();
    onChanged();
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        className="icon-button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Music for this game"
        aria-expanded={open}
        data-testid="game-music-button"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="var(--brass)" aria-hidden="true">
          <path d="M12 2.5v7.1a2.4 2.4 0 1 0 1.2 2.1V4.3l-5 1v6.4A2.4 2.4 0 1 1 7 9.8V3.2z" />
        </svg>
      </button>

      {open && (
        <>
          {/* Click-away backdrop. */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
            data-testid="game-music-backdrop"
          />
          <div
            data-testid="game-music-popover"
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              zIndex: 41,
              width: 288,
              maxWidth: "calc(100vw - 24px)",
              padding: 14,
              borderRadius: 6,
              background: "var(--panel, rgba(24,17,10,.98))",
              border: "1px solid rgba(109,90,56,.5)",
              boxShadow: "0 12px 32px rgba(0,0,0,.5)",
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 12,
                letterSpacing: 1.2,
                color: "var(--ink-dim)",
                marginBottom: 10,
              }}
            >
              MUSIC FOR THIS GAME
            </div>
            {effective ? (
              <MusicOverrideEditor
                connection={connection}
                campaignId={campaignId}
                override={override}
                effective={effective}
                onPatch={patch}
                onReset={reset}
                compact
              />
            ) : (
              <div style={{ fontSize: 12, color: "var(--ink-faint)" }}>Loading…</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
