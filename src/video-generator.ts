// ADR-0034: video-generation dispatcher. `generateVideo` resolves a provider
// (grok Imagine CLI or local ComfyUI) and delegates to the chosen VideoBackend, so
// the /animate route stays provider-agnostic. Mirrors image-generator.ts's
// `generateImage`. The signature and every call site are unchanged from ADR-0026.
import type { CampaignSettings } from "./campaign-store.js";
import type { ImageEntityType } from "./image-generator.js";
import type { VideoConfig } from "./video-store.js";
import {
  getVideoBackend,
  resolveVideoProviderForCampaign,
  resolveVideoModelForCampaign,
} from "./video-backends/index.js";
import type { VideoGenResult } from "./video-backends/types.js";

// Re-exported for import-path stability (tests and callers still import these here).
export { buildVideoPrompt, newestVideoUnder } from "./video-backends/grok.js";
export type { VideoGenResult } from "./video-backends/types.js";

export interface GenerateVideoOptions {
  /** The two-step workflow (ADR-0026): the existing still at this campaign-relative
   * path is the source frame. Grok stages it into its temp dir; the local backend
   * uploads it to ComfyUI. Omitted → grok does text-to-video; local fails cleanly. */
  baseImageRelPath?: string;
}

/** Resolve the provider and delegate to its backend. Never throws — each backend
 * catches every failure and returns { ok: false, error }, since a clip is
 * best-effort and must never block the UI (design doc §8). */
export async function generateVideo(
  campaignDir: string,
  entityType: ImageEntityType,
  name: string,
  description: string,
  settings: CampaignSettings,
  video: VideoConfig,
  opts: GenerateVideoOptions = {}
): Promise<VideoGenResult> {
  const provider = resolveVideoProviderForCampaign(campaignDir, settings);
  // The local backend picks a model; grok ignores it.
  const videoModel = provider === "local" ? resolveVideoModelForCampaign(campaignDir, settings) : undefined;
  return getVideoBackend(provider).generate({
    campaignDir,
    entityType,
    name,
    description,
    settings,
    video,
    baseImageRelPath: opts.baseImageRelPath,
    videoModel,
  });
}
