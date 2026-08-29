// ADR-0034: the pluggable video-generation backend contract. One interface, two
// implementations (grok Imagine CLI, local ComfyUI) behind a single dispatch in
// video-generator.ts's `generateVideo`. Mirrors src/image-backends/ (ImageBackend)
// exactly, which itself mirrors src/backends/ (DmBackend).
import type { CampaignSettings } from "../campaign-store.js";
import type { ImageEntityType } from "../image-generator.js";
import type { VideoConfig } from "../video-store.js";

/** Which engine animates a campaign's stills. `grok` shells out to the Grok Build
 * CLI's /imagine-video (the original, default); `local` talks to a self-hosted
 * ComfyUI over HTTP (Wan 2.2 / LTX-Video, ADR-0035). */
export type VideoProvider = "grok" | "local";
export const VIDEO_PROVIDERS: VideoProvider[] = ["grok", "local"];
export function isValidVideoProvider(v: unknown): v is VideoProvider {
  return v === "grok" || v === "local";
}

export interface VideoGenResult {
  ok: boolean;
  /** Path relative to campaignDir, e.g. "videos/npc-barrow.mp4". */
  relPath?: string;
  error?: string;
}

/** Backend-neutral input for one video generation. `description` is the raw,
 * already-established entity/scene text; each backend turns it into a prompt.
 * `video` is the resolved duration/resolution/aspect (VideoConfig). */
export interface VideoBackendArgs {
  campaignDir: string;
  entityType: ImageEntityType;
  name: string;
  description: string;
  settings: CampaignSettings;
  video: VideoConfig;
  /** The two-step workflow (ADR-0026): a campaign-relative still to animate. Grok
   * stages it into its temp dir; the local backend uploads it to ComfyUI. When
   * absent, grok does a pure text-to-video clip; the local backend fails cleanly
   * (image-to-video needs a source frame). */
  baseImageRelPath?: string;
  /** ADR-0035: which local video model to use ("wan-5b" | "ltxv"). Set by the
   * dispatcher via resolveVideoModelForCampaign. Local-only — grok ignores it. */
  videoModel?: string;
}

/** One video engine. `generate` NEVER throws — every failure mode is caught and
 * returned as `{ ok: false, error }`, since a clip is best-effort and must never
 * block the UI (design doc §8; same discipline as ImageBackend). */
export interface VideoBackend {
  readonly provider: VideoProvider;
  generate(args: VideoBackendArgs): Promise<VideoGenResult>;
}
