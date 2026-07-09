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
  /** These looks fight the SDXL refiner's photo-real detail, so skip the base→refiner
   * pass under quality=high (ADR-0029). This slice only LoRA-wires the base chain, so
   * `resolveEffectiveTier` forces the base workflow for ANY recipe regardless — this
   * flag documents the style's intent and gates a future refiner-aware path. */
  noRefiner?: boolean;
}

/** ADR-0032: the two proof styles. Keyed on the NORMALIZED (trim+lowercase) style
 * name — look up via `lookupStyleLora`, never index this directly with a raw string.
 * A follow-up slice adds more recipes + preset buttons. INVARIANT for this slice:
 * every recipe is `noRefiner` (asserted by tests), because only the base chain is
 * LoRA-wired. */
export const STYLE_LORAS: Record<string, StyleLora> = {
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
