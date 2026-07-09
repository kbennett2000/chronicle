// Issue #118: on-demand Grok Imagine video clips. Video parameters are
// prompt-driven text (not CLI flags): duration, resolution, and aspect ratio
// are described in the /imagine-video prompt. They are configurable at two
// levels — account (player defaults) and per-campaign override — resolved
// field-by-field campaign → user → `.env` → code default, exactly like the
// music config (see resolveMusicConfig in music-store.ts). Defaults per the
// issue notes: 5-second clip, 480p, square.

export type VideoResolution = "480p" | "720p";
export const VIDEO_RESOLUTIONS: VideoResolution[] = ["480p", "720p"];

export type VideoAspect = "square" | "16:9" | "9:16";
export const VIDEO_ASPECTS: VideoAspect[] = ["square", "16:9", "9:16"];

/** Grok caps clips at ~15s; shorter is more stable (issue notes). */
export const MIN_VIDEO_SECONDS = 1;
export const MAX_VIDEO_SECONDS = 15;

/** Code-level defaults (last fallback after campaign/user/.env). */
export const DEFAULT_VIDEO: VideoConfig = {
  durationSeconds: 5,
  resolution: "480p",
  aspectRatio: "square",
};

/** A stored video-params override (a `video` key in account or campaign
 * settings). All optional — an unset field falls through to the next level. */
export interface UserVideo {
  durationSeconds?: number;
  resolution?: VideoResolution;
  aspectRatio?: VideoAspect;
}

/** The effective, fully-resolved video params. */
export interface VideoConfig {
  durationSeconds: number;
  resolution: VideoResolution;
  aspectRatio: VideoAspect;
}

/** Validate/normalize a raw stored or posted video override into a UserVideo,
 * rejecting type/range violations. Shared by the user-defaults validator, the
 * per-campaign settings route, and readCampaignSettings so all three agree on
 * the shape (mirrors parseMusicBlock). */
export function parseVideoBlock(raw: unknown): { value: UserVideo } | { error: string } {
  if (typeof raw !== "object" || raw === null) return { error: "video must be an object" };
  const v = raw as Record<string, unknown>;
  const video: UserVideo = {};
  if (v.durationSeconds !== undefined) {
    if (
      typeof v.durationSeconds !== "number" ||
      !Number.isFinite(v.durationSeconds) ||
      !Number.isInteger(v.durationSeconds) ||
      v.durationSeconds < MIN_VIDEO_SECONDS ||
      v.durationSeconds > MAX_VIDEO_SECONDS
    ) {
      return { error: `video.durationSeconds must be an integer between ${MIN_VIDEO_SECONDS} and ${MAX_VIDEO_SECONDS}` };
    }
    video.durationSeconds = v.durationSeconds;
  }
  if (v.resolution !== undefined) {
    if (!VIDEO_RESOLUTIONS.includes(v.resolution as VideoResolution)) {
      return { error: `video.resolution must be one of ${VIDEO_RESOLUTIONS.join(", ")}` };
    }
    video.resolution = v.resolution as VideoResolution;
  }
  if (v.aspectRatio !== undefined) {
    if (!VIDEO_ASPECTS.includes(v.aspectRatio as VideoAspect)) {
      return { error: `video.aspectRatio must be one of ${VIDEO_ASPECTS.join(", ")}` };
    }
    video.aspectRatio = v.aspectRatio as VideoAspect;
  }
  return { value: video };
}

function envDuration(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < MIN_VIDEO_SECONDS || n > MAX_VIDEO_SECONDS) {
    return undefined;
  }
  return n;
}

function envResolution(v: string | undefined): VideoResolution | undefined {
  return VIDEO_RESOLUTIONS.includes(v as VideoResolution) ? (v as VideoResolution) : undefined;
}

function envAspect(v: string | undefined): VideoAspect | undefined {
  return VIDEO_ASPECTS.includes(v as VideoAspect) ? (v as VideoAspect) : undefined;
}

/** Effective video params. Precedence is field-by-field:
 * campaign override → user override → `.env` default → code default.
 * A per-game override wins where set; each unset field falls through to the
 * user's account default, then `.env`, then DEFAULT_VIDEO (mirrors
 * resolveMusicConfig). */
export function resolveVideoConfig(userVideo: UserVideo = {}, campaignVideo: UserVideo = {}): VideoConfig {
  const pick = <K extends keyof UserVideo>(key: K): UserVideo[K] => campaignVideo[key] ?? userVideo[key];
  return {
    durationSeconds:
      pick("durationSeconds") ?? envDuration(process.env.DEFAULT_VIDEO_DURATION) ?? DEFAULT_VIDEO.durationSeconds,
    resolution: pick("resolution") ?? envResolution(process.env.DEFAULT_VIDEO_RESOLUTION) ?? DEFAULT_VIDEO.resolution,
    aspectRatio: pick("aspectRatio") ?? envAspect(process.env.DEFAULT_VIDEO_ASPECT) ?? DEFAULT_VIDEO.aspectRatio,
  };
}

/** Human-readable aspect clause for the /imagine-video prompt. Grok reads
 * "square" / "16:9" / "9:16" directly (issue notes' parameter table). */
export function aspectPhrase(aspect: VideoAspect): string {
  return aspect === "square" ? "square aspect ratio" : `${aspect} aspect ratio`;
}
