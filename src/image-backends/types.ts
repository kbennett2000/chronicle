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

/** ADR-0029: a local-backend quality tier that trades generation TIME for QUALITY
 * at a FIXED resolution. `fast` uses fewer sampling steps; `standard` is today's
 * exact 25-step base pass (the no-op default); `high` adds steps AND an SDXL refiner
 * second pass. Grok has no such knobs, so this is a local-only concept — the grok
 * backend ignores it. */
export type ImageQuality = "fast" | "standard" | "high";
export const IMAGE_QUALITIES: ImageQuality[] = ["fast", "standard", "high"];
export function isValidImageQuality(v: unknown): v is ImageQuality {
  return v === "fast" || v === "standard" || v === "high";
}

/** The kinds of entity an image can portray. `scene` is used only by the
 * /illustrate "moment" branch; the MCP tool shape offers the other five. */
export type ImageEntityType = "character" | "npc" | "location" | "item" | "boss" | "scene";

export interface ImageGenResult {
  ok: boolean;
  /** Path relative to campaignDir, e.g. "images/npc-barrow.jpg". */
  relPath?: string;
  error?: string;
  /** ADR-0038: set only on a `preview` call — the fully-assembled positive prompt
   * (art-style clause + LoRA trigger + grounded appearance + description) that WOULD
   * be rendered, returned WITHOUT touching ComfyUI so the editor can prefill its
   * "edit the full prompt" box. No image is written on a preview. */
  previewPrompt?: string;
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
  /** ADR-0029: the resolved quality tier for this generation. Set by the dispatcher
   * (`generateImage`) via resolveImageQualityForCampaign. Local-only — the grok
   * backend never reads it. Absent is treated as "standard" (today's output). */
  imageQuality?: ImageQuality;
  /** ADR-0036: img2img — an ABSOLUTE path to a still to use as the init frame.
   * When set, the local backend encodes it as the sampler's starting latent and
   * renders at `denoise` strength. Editor-driven (per-call). Local-only. */
  initImageAbsPath?: string;
  /** ADR-0036: img2img strength in (0,1]; lower = closer to the init image. Only
   * meaningful with `initImageAbsPath`. Default 0.65. */
  denoise?: number;
  /** ADR-0037: IP-Adapter reference likeness — an ABSOLUTE path to a portrait to
   * condition on ("keep the character's face"). Editor-driven. Local-only; degrades
   * to prompt-only if IP-Adapter isn't installed on the ComfyUI host. */
  referenceImageAbsPath?: string;
  /** ADR-0037: IP-Adapter weight in (0,1.5]; higher = stronger likeness. Default 0.5. */
  likenessStrength?: number;
  /** ADR-0037: IP-Adapter start_at in [0,0.5]; higher relaxes identity in early
   * steps (useful for crowded scenes). Default 0.3. */
  likenessStart?: number;
  /** ADR-0038: the editor's "edit the full prompt" — replaces the assembled positive
   * prompt VERBATIM (skips the art-style clause and LoRA trigger). The LoRA node +
   * negatives still wire in from the recipe; only the positive TEXT is replaced.
   * Editor-driven (per-call). Local-only (grok has no assembled-prompt concept). */
  promptOverride?: string;
  /** ADR-0038: when true, the local backend assembles the positive prompt and returns
   * it as `previewPrompt` WITHOUT rendering (no ComfyUI call, no file written). Used to
   * prefill the editor's full-prompt box. Local-only. */
  preview?: boolean;
}

/** One image engine. `generate` NEVER throws — every failure mode is caught and
 * returned as `{ ok: false, error }`, since an image is best-effort and must
 * never block a DM turn (design doc §8). */
export interface ImageBackend {
  readonly provider: ImageProvider;
  generate(args: ImageBackendArgs): Promise<ImageGenResult>;
}
