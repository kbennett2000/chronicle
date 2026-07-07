import { useEffect, useState } from "react";
import { ToggleRow } from "./LookControls";
import type { MusicConfig, MusicOverride, MusicSource } from "../lib/music";

// Issue #109 / ADR-0020 (amended): the per-game music override editor, shared by
// the campaign-scoped section of Settings and the inline popover beside the
// Active-Play transport. The caller owns persistence (Settings and Play each
// re-fetch config + settings after a change and pass the fresh values back down);
// this stays presentational.
//
// UX model: a single "Customize for this game" master toggle. OFF → the game
// tracks the user's account default (no override stored). ON → concrete controls
// seeded from the currently-effective config, each edit writing an override
// field. The three-level field-by-field precedence in the backend is a superset
// of what this UI writes; we deliberately edit only enabled/source/playlist
// (URL is a LAN/server concern left to the account default and inherited).

interface MusicOverrideEditorProps {
  /** The stored per-game override (settings.music), or undefined when absent. */
  override: MusicOverride | undefined;
  /** The effective, campaign-resolved config (campaign → user → .env). Drives the
   * control values so they always show what this game will actually play. */
  effective: MusicConfig;
  /** Persist a partial override (each field written independently). */
  onPatch: (patch: MusicOverride) => void;
  /** Drop the override entirely — resume tracking the account default. */
  onReset: () => void;
  /** Tighter spacing + hint copy for the in-play popover. */
  compact?: boolean;
}

const pillBase = {
  flex: 1,
  cursor: "pointer",
  padding: "8px 10px",
  borderRadius: 4,
  fontFamily: "var(--font-body)",
  fontSize: 12.5,
  textAlign: "center" as const,
  color: "var(--ink)",
};

export function MusicOverrideEditor({ override, effective, onPatch, onReset, compact }: MusicOverrideEditorProps) {
  const hasOverride = !!override && Object.keys(override).length > 0;
  const [playlist, setPlaylist] = useState(effective.navidrome.playlist);

  // Keep the playlist buffer in step when the effective config reloads (a save
  // round-trips, or the popover reopens on a different game).
  useEffect(() => {
    setPlaylist(effective.navidrome.playlist);
  }, [effective.navidrome.playlist]);

  function enableOverride(on: boolean) {
    if (!on) {
      onReset();
      return;
    }
    // Seed a concrete override from what the game plays right now, so turning the
    // toggle on doesn't visibly change playback until the player edits something.
    const seed: MusicOverride = { enabled: effective.enabled, source: effective.source };
    if (effective.source === "navidrome" && effective.navidrome.playlist) {
      seed.navidromePlaylist = effective.navidrome.playlist;
    }
    onPatch(seed);
  }

  return (
    <div>
      <ToggleRow
        testId="game-music-override"
        title="Customize music for this game"
        description={hasOverride ? "This game uses its own music settings." : "This game follows your account default."}
        checked={hasOverride}
        onChange={enableOverride}
      />

      {hasOverride && (
        <div style={{ marginTop: compact ? 8 : 10 }}>
          <ToggleRow
            testId="game-music-enabled"
            title="Play background music"
            description="Off silences music for this game only."
            checked={effective.enabled}
            onChange={(next) => onPatch({ enabled: next })}
          />

          {effective.enabled && (
            <>
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                {(["local", "navidrome"] as const).map((src: MusicSource) => {
                  const selected = effective.source === src;
                  return (
                    <button
                      key={src}
                      data-testid={`game-music-source-${src}`}
                      onClick={() => onPatch({ source: src })}
                      style={{
                        ...pillBase,
                        background: selected ? "rgba(168,81,31,.25)" : "rgba(12,8,5,.5)",
                        border: `1px solid ${selected ? "var(--ember)" : "rgba(109,90,56,.4)"}`,
                      }}
                    >
                      {src === "local" ? "Local files" : "Navidrome"}
                    </button>
                  );
                })}
              </div>

              {effective.source === "local" && (
                <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 7 }}>
                  {effective.localTrackCount > 0
                    ? `${effective.localTrackCount} track${effective.localTrackCount === 1 ? "" : "s"} in the music/ folder — shuffled.`
                    : "No files in the music/ folder yet."}
                </div>
              )}

              {effective.source === "navidrome" && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--ink-dim)", marginBottom: 4 }}>
                    Navidrome playlist{" "}
                    <span style={{ color: "var(--ink-faint)" }}>— leave blank to use your account playlist</span>
                  </div>
                  <input
                    data-testid="game-music-playlist"
                    value={playlist}
                    onChange={(e) => setPlaylist(e.target.value)}
                    onBlur={() => playlist !== effective.navidrome.playlist && onPatch({ navidromePlaylist: playlist })}
                    placeholder="playlist name for this game"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      background: "rgba(12,8,5,.5)",
                      border: "1px solid rgba(109,90,56,.4)",
                      borderRadius: 4,
                      padding: "8px 12px",
                      color: "var(--ink)",
                      fontFamily: "var(--font-body)",
                      fontSize: 13,
                      outline: "none",
                    }}
                  />
                  {!effective.navidrome.configured && (
                    <div style={{ fontSize: 11, color: "var(--ember)", marginTop: 5 }}>
                      Navidrome isn't configured on the server (.env) — playback won't work until it is.
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
