// ADR-0027: the pluggable image-generation backend contract. One interface, two
// implementations (grok, local ComfyUI) behind a single dispatch in
// image-generator.ts's `generateImage`. Mirrors src/backends/ (DmBackend) for the
// DM engine.
import type { CampaignSettings } from "../campaign-store.js";

/** Which engine draws a campaign's images. `grok` shells out to the Grok Build
 * CLI (the original, default); `local` talks to a self-hosted ComfyUI over HTTP. */
export type ImageProvider = "grok" | "local";
export const IMAGE_PROVIDERS: ImageProvider[] = ["grok", "local"];
export function isValidImageProvider(v: unknown): v is ImageProvider {
  return v === "grok" || v === "local";
}

/** The kinds of entity an image can portray. `scene` is used only by the
 * /illustrate "moment" branch; the MCP tool shape offers the other five. */
export type ImageEntityType = "character" | "npc" | "location" | "item" | "boss" | "scene";

export interface ImageGenResult {
  ok: boolean;
  /** Path relative to campaignDir, e.g. "images/npc-barrow.jpg". */
  relPath?: string;
  error?: string;
}

/** Backend-neutral input for one image generation. `description` is the raw,
 * already-established entity/scene text; each backend sanitizes it into a prompt
 * via sanitizeImagePrompt (which is provider-agnostic). */
export interface ImageBackendArgs {
  campaignDir: string;
  entityType: ImageEntityType;
  name: string;
  description: string;
  settings: CampaignSettings;
}

/** One image engine. `generate` NEVER throws — every failure mode is caught and
 * returned as `{ ok: false, error }`, since an image is best-effort and must
 * never block a DM turn (design doc §8). */
export interface ImageBackend {
  readonly provider: ImageProvider;
  generate(args: ImageBackendArgs): Promise<ImageGenResult>;
}
