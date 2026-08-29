import type { CampaignSettings, CampaignSettingsPatch, VideoModelInfo } from "../lib/campaign";
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
  value: Pick<CampaignSettings, "generateVideos" | "video" | "videoProvider" | "videoModel">;
  /** The effective resolved params (campaign → user → .env → default) so a chip
   * shows what an unset field will actually use. Optional — falls back to the
   * stored override then to nothing while loading. */
  effective?: VideoConfig;
  /** ADR-0035: local video models + their readiness (from getVideoModels). The model
   * picker shows only when the engine is local and this is non-empty. Defaults to []. */
  videoModels?: VideoModelInfo[];
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

export function VideoSettingsEditor({ value, effective, videoModels = [], onPatch }: VideoSettingsEditorProps) {
  // The value a control shows: the stored per-game/account override if present,
  // else the effective resolved value, else the code default.
  const duration = value.video?.durationSeconds ?? effective?.durationSeconds ?? 5;
  const resolution: VideoResolution = value.video?.resolution ?? effective?.resolution ?? "480p";
  const aspect: VideoAspect = value.video?.aspectRatio ?? effective?.aspectRatio ?? "square";
  const provider = value.videoProvider ?? "grok";
  const videoModel = value.videoModel ?? "ltxv";

  const setDuration = (next: number) => {
    const clamped = Math.min(MAX_VIDEO_SECONDS, Math.max(MIN_VIDEO_SECONDS, next));
    onPatch({ video: { durationSeconds: clamped } });
  };

  return (
    <>
      <ToggleRow
        testId="videos-toggle"
        title="Enable video clips"
        description="Off by default · adds an “Animate” button to stills · Grok or local ComfyUI"
        checked={!!value.generateVideos}
        onChange={(next) => onPatch({ generateVideos: next })}
      />

      {value.generateVideos && (
        <div
          data-testid="video-params"
          style={{ marginTop: 8, padding: "11px 14px", borderRadius: 4, background: "rgba(28,20,12,.4)", border: "1px solid rgba(109,90,56,.3)" }}
        >
          {/* ADR-0034: which engine animates — cloud Grok or local ComfyUI. */}
          <div style={{ fontSize: 12, color: "var(--ink-dim)", marginBottom: 7 }}>
            Video engine <span style={{ color: "var(--ink-faint)" }}>— who animates the clip</span>
          </div>
          <div style={{ display: "flex", gap: 7, marginBottom: 4 }}>
            {([
              { id: "grok", label: "Grok Imagine", hint: "cloud · the grok CLI" },
              { id: "local", label: "Local · ComfyUI", hint: "your GPU · Wan / LTX-Video" },
            ] as const).map((o) => {
              const active = provider === o.id;
              return (
                <button
                  key={o.id}
                  data-testid="video-provider-option"
                  data-provider={o.id}
                  data-selected={active}
                  onClick={() => onPatch({ videoProvider: o.id })}
                  style={{
                    flex: 1,
                    cursor: "pointer",
                    padding: "9px 12px",
                    borderRadius: 4,
                    textAlign: "left",
                    color: active ? "var(--ink)" : "var(--ink-faint)",
                    background: active ? "rgba(52,74,124,.3)" : "rgba(28,20,12,.5)",
                    border: `1px solid ${active ? "rgba(120,150,211,.55)" : "rgba(109,90,56,.32)"}`,
                  }}
                >
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 13 }}>{o.label}</div>
                  <div style={{ fontSize: 10, color: "var(--ink-faint)", marginTop: 2 }}>{o.hint}</div>
                </button>
              );
            })}
          </div>

          {/* ADR-0035: local video model — shown only for the local engine. */}
          {provider === "local" && videoModels.length > 0 && (
            <>
              <div style={{ fontSize: 12, color: "var(--ink-dim)", margin: "14px 0 7px" }}>
                Local model <span style={{ color: "var(--ink-faint)" }}>— LTX-Video is lighter; Wan is heavier</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {videoModels.map((m) => (
                  <button
                    key={m.model}
                    data-testid="video-model"
                    data-model={m.model}
                    data-selected={videoModel === m.model}
                    onClick={() => onPatch({ videoModel: m.model })}
                    title={m.ready ? "Installed on the ComfyUI host" : "Model files not installed — run its fetch script"}
                    style={chipStyle(videoModel === m.model)}
                  >
                    {m.label}
                    {!m.ready && <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.8 }}>· not installed</span>}
                  </button>
                ))}
              </div>
            </>
          )}

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
