import type { CampaignSettings, CampaignSettingsPatch } from "../lib/campaign";
import {
  VIDEO_RESOLUTIONS,
  VIDEO_ASPECTS,
  MIN_VIDEO_SECONDS,
  MAX_VIDEO_SECONDS,
  type VideoConfig,
  type VideoResolution,
  type VideoAspect,
} from "../lib/video";
import { ToggleRow } from "./LookControls";

// Issue #118 (ADR-0026): shared "THE MOTION" controls — the generateVideos
// opt-in toggle that reveals the on-demand "Animate" affordance, plus the three
// prompt-driven params (duration/resolution/aspect). Used identically by the
// account Settings screen, the in-game GameSettings screen, and New Chronicle;
// the host owns where each patch persists (/me/settings vs /campaigns/:id/settings).
// Purely presentational.

interface VideoSettingsEditorProps {
  value: Pick<CampaignSettings, "generateVideos" | "video">;
  /** The effective resolved params (campaign → user → .env → default) so a chip
   * shows what an unset field will actually use. Optional — falls back to the
   * stored override then to nothing while loading. */
  effective?: VideoConfig;
  onPatch: (patch: CampaignSettingsPatch) => void;
}

const chipStyle = (selected: boolean) => ({
  cursor: "pointer",
  padding: "7px 12px",
  borderRadius: 20,
  fontFamily: "var(--font-body)",
  fontSize: 12.5,
  background: selected ? "rgba(120,150,211,.9)" : "rgba(28,20,12,.5)",
  border: `1px solid ${selected ? "rgba(120,150,211,.9)" : "rgba(109,90,56,.36)"}`,
  color: selected ? "#0b1220" : "var(--ink-dim)",
});

export function VideoSettingsEditor({ value, effective, onPatch }: VideoSettingsEditorProps) {
  // The value a control shows: the stored per-game/account override if present,
  // else the effective resolved value, else the code default.
  const duration = value.video?.durationSeconds ?? effective?.durationSeconds ?? 5;
  const resolution: VideoResolution = value.video?.resolution ?? effective?.resolution ?? "480p";
  const aspect: VideoAspect = value.video?.aspectRatio ?? effective?.aspectRatio ?? "square";

  const setDuration = (next: number) => {
    const clamped = Math.min(MAX_VIDEO_SECONDS, Math.max(MIN_VIDEO_SECONDS, next));
    onPatch({ video: { durationSeconds: clamped } });
  };

  return (
    <>
      <ToggleRow
        testId="videos-toggle"
        title="Enable video clips"
        description="Off by default · needs Grok Build · adds an “Animate” button to stills"
        checked={!!value.generateVideos}
        onChange={(next) => onPatch({ generateVideos: next })}
      />

      {value.generateVideos && (
        <div
          data-testid="video-params"
          style={{ marginTop: 8, padding: "11px 14px", borderRadius: 4, background: "rgba(28,20,12,.4)", border: "1px solid rgba(109,90,56,.3)" }}
        >
          {/* Duration */}
          <div style={{ fontSize: 12, color: "var(--ink-dim)", marginBottom: 7 }}>
            Clip length <span style={{ color: "var(--ink-faint)" }}>— {MIN_VIDEO_SECONDS}–{MAX_VIDEO_SECONDS}s (shorter is steadier)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              data-testid="video-duration-dec"
              onClick={() => setDuration(duration - 1)}
              disabled={duration <= MIN_VIDEO_SECONDS}
              style={{ width: 30, height: 30, borderRadius: "50%", cursor: "pointer", border: "1px solid rgba(109,90,56,.5)", background: "rgba(12,8,5,.6)", color: "var(--ink)", fontSize: 16, lineHeight: 1 }}
            >
              −
            </button>
            <div data-testid="video-duration-value" style={{ minWidth: 48, textAlign: "center", fontFamily: "var(--font-display)", fontSize: 15, color: "var(--ink)" }}>
              {duration}s
            </div>
            <button
              data-testid="video-duration-inc"
              onClick={() => setDuration(duration + 1)}
              disabled={duration >= MAX_VIDEO_SECONDS}
              style={{ width: 30, height: 30, borderRadius: "50%", cursor: "pointer", border: "1px solid rgba(109,90,56,.5)", background: "rgba(12,8,5,.6)", color: "var(--ink)", fontSize: 16, lineHeight: 1 }}
            >
              +
            </button>
          </div>

          {/* Resolution */}
          <div style={{ fontSize: 12, color: "var(--ink-dim)", margin: "14px 0 7px" }}>Resolution</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {VIDEO_RESOLUTIONS.map((r) => (
              <button
                key={r}
                data-testid="video-resolution"
                data-selected={resolution === r}
                onClick={() => onPatch({ video: { resolution: r } })}
                style={chipStyle(resolution === r)}
              >
                {r}
              </button>
            ))}
          </div>

          {/* Aspect ratio */}
          <div style={{ fontSize: 12, color: "var(--ink-dim)", margin: "14px 0 7px" }}>Shape</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {VIDEO_ASPECTS.map((a) => (
              <button
                key={a}
                data-testid="video-aspect"
                data-selected={aspect === a}
                onClick={() => onPatch({ video: { aspectRatio: a } })}
                style={chipStyle(aspect === a)}
              >
                {a === "square" ? "square" : a}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
