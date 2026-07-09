// ADR-0032: LoRA-backed art-style recipes for the LOCAL ComfyUI/SDXL backend.
// A style whose name maps to a recipe here ALSO loads a specialized SDXL LoRA
// (a small fine-tune weight delta) via a runtime-injected LoraLoader node — not
// just the prompt clause ADR-0028 already leads with. A style with NO entry
// (free-text, or any of the prompt-only presets) keeps today's behavior exactly.
// Local backend only; grok/video/portrait/grounding paths never consult this.

/** One art-style → SDXL LoRA recipe. Consumed only by the local backend. */
export interface StyleLora {
  /** Filename as ComfyUI sees it under models/loras/, `.safetensors`. A host asset
   * (not committed), verified as base SDXL 1.0 before wiring — see ADR-0032. */
  loraFile: string;
  /** A token the LoRA was trained with, ensured present in the positive prompt
   * (prepended if absent). For the current recipes this equals the style name, so
   * the leading style clause already contains it and nothing is duplicated. */
  trigger: string;
  /** Applied to BOTH strength_model and strength_clip on the LoraLoader node. */
  strength: number;
  /** Every LoRA style sets this true (ADR-0032 Slice-2 amendment): the SDXL refiner only
   * adds photo-real detail, which stylized LoRA looks don't want, so the base→refiner pass
   * is skipped under quality=high (ADR-0029) — a LoRA style renders as a base high-steps
   * pass. `resolveEffectiveTier` forces the base workflow for any recipe. Refiner-chain LoRA
   * injection stays a future item (only worthwhile for a photo-real LoRA style, none here). */
  noRefiner?: boolean;
  /** Slice 2: optional per-style extra negative-prompt terms, appended to the negative CLIP
   * nodes ("7"/"13") when this recipe is active — e.g. "comic book" adds "book, magazine" to
   * suppress the LoRA's tendency to draw comic covers with cover text. */
  extraNegatives?: string;
}

/** ADR-0032: the two proof styles. Keyed on the NORMALIZED (trim+lowercase) style
 * name — look up via `lookupStyleLora`, never index this directly with a raw string.
 * A follow-up slice adds more recipes + preset buttons. INVARIANT for this slice:
 * every recipe is `noRefiner` (asserted by tests), because only the base chain is
 * LoRA-wired. */
export const STYLE_LORAS: Record<string, StyleLora> = {
  // --- Slice 1 (#136) proof styles ---
  "pixel art": {
    loraFile: "pixel-art-xl.safetensors", // Pixel Art XL (NeriJS), SDXL 1.0
    trigger: "pixel art",
    strength: 1.0,
    noRefiner: true,
  },
  "oil painting": {
    loraFile: "ClassipeintXL2.1.safetensors", // ClassipeintXL v2.1 (EldritchAdam), SDXL 1.0
    trigger: "oil painting",
    strength: 0.8,
    noRefiner: true,
  },
  // --- Slice 2 (#138): existing presets (keys normalize from the picker's chip values) ---
  "comic book": {
    loraFile: "EldritchComicsXL1.2.safetensors", // Eldritch Comics XL v1.2 (EldritchAdam), SDXL 1.0
    trigger: "comic book",
    strength: 0.9,
    noRefiner: true,
    extraNegatives: "book, magazine", // suppress comic-cover text/framing
  },
  "lego-style": {
    loraFile: "Lego_XL_v2.1.safetensors", // LeLo LEGO LoRA for XL v2.1 (lordjia), SDXL 1.0
    trigger: "LEGO MiniFig",
    strength: 0.8,
    noRefiner: true,
  },
  "pencil sketch": {
    loraFile: "sketch_style.safetensors", // Caith's Sketch Style XL, SDXL 1.0
    trigger: "sketch",
    strength: 1.0,
    noRefiner: true,
  },
  watercolour: {
    loraFile: "watercolor-orie-xl.safetensors", // Watercolor (orie) SDXL 1.0
    trigger: "watercolor style",
    strength: 1.0,
    noRefiner: true,
  },
  anime: {
    loraFile: "animelora-sdxl.safetensors", // Anime LoRA SDXL 1.0
    trigger: "anime",
    strength: 0.9,
    noRefiner: true,
  },
  // --- Slice 2 (#138): new presets ---
  storybook: {
    loraFile: "StoryBookRedmond-KidsRedmAF.safetensors", // StorybookRedmond (artificialguybr), SDXL 1.0
    trigger: "KidsRedmAF",
    strength: 1.0,
    noRefiner: true,
  },
  "3d": {
    loraFile: "PixarXL.safetensors", // Pixar Style (SDXL 1.0)
    trigger: "pixar style",
    strength: 1.0,
    noRefiner: true,
  },
  cyberpunk: {
    loraFile: "cyberpunk_xl_v1.safetensors", // Cyberpunk Style Sci-Fi XL, SDXL 1.0
    trigger: "cyberpunk",
    strength: 0.8,
    noRefiner: true,
  },
  "ukiyo-e": {
    loraFile: "Ukiyo-e-Art-XL.safetensors", // Ukiyo-e Art (SDXL 1.0)
    trigger: "Ukiyo-e Art",
    strength: 0.8,
    noRefiner: true,
  },
  claymation: {
    loraFile: "CLAYMATE-v2-sdxl.safetensors", // CLAYMATE v2 Claymation Style for SDXL 1.0
    trigger: "claymation",
    strength: 1.0,
    noRefiner: true,
  },
  // "noir" and "ghibli": intentionally NO recipe — prompt-only (no reliable base-SDXL LoRA;
  // ghibli's candidate CivitAI 128832 is SD 1.5). See ADR-0032 Slice-2 amendment.
};

/** Normalize a configured style name into a recipe key: trim + lowercase, so
 * "Pixel Art", " pixel art " and "pixel art" all match the same entry. */
function normalizeStyleKey(artStyle: string): string {
  return artStyle.trim().toLowerCase();
}

/** Resolve a campaign's configured `settings.artStyle` to its LoRA recipe, or
 * `undefined` if the style is unmapped (free-text or a prompt-only preset), in which
 * case the caller renders exactly as today. Never throws. */
export function lookupStyleLora(artStyle?: string | null): StyleLora | undefined {
  if (!artStyle) return undefined;
  return STYLE_LORAS[normalizeStyleKey(artStyle)];
}
