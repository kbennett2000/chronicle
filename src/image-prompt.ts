import type { CampaignSettings } from "./campaign-store.js";
import type { ImageEntityType } from "./image-backends/types.js";

/** Entity types whose prompts are *open compositions* rather than a tight subject.
 * A character/npc/item/boss is a pinned subject that constrains SDXL enough that the
 * leading style clause dominates; a location/scene is loose, so the style clause is
 * diluted and SDXL reverts to its default look (ADR-0028). The scene path therefore
 * gets stronger style treatment on the local backend. Exported for tests. */
export const SCENE_ENTITY_TYPES = new Set<ImageEntityType>(["location", "scene"]);

/** Per-call options for prompt construction. Only the local backend passes these
 * (with the entity type it already has in scope); grok and the video path call
 * `buildImagePrompt`/`sanitizeImagePrompt` with no opts, so their output is
 * byte-identical to before ADR-0028. */
export interface PromptStyleOpts {
  entityType?: ImageEntityType;
}

/** Builds the /imagine prompt from a state-file description — a character
 * portrait, an NPC/location/item's first-appearance description, or a boss
 * reveal, per design doc §8. Prepends the campaign's configured art style, if
 * any, per ADR-0004: this only changes how a generated image looks, never what
 * gets generated.
 *
 * Issue #104: the style LEADS the prompt as its own clause ("Photorealistic.
 * <description>") rather than trailing as "..., in the style of X". Image models
 * read "in the style of X" as an artist/movement reference (e.g. "in the style
 * of Rembrandt"), so adjectival render styles like "photorealistic",
 * "watercolor", or "oil painting" were effectively ignored. Leading with the
 * style weights it heavily and honors those adjectival styles, while still
 * reading acceptably for a named-artist style.
 *
 * ADR-0028: for open scene/location prompts the leading clause alone loses to
 * SDXL's default aesthetic, so — when the local backend passes a scene-class
 * `entityType` — the style clause is additionally emphasized with SDXL prompt
 * weighting (`(style:1.3). <desc>`). Character-class and opt-less callers
 * (grok, video) are unaffected. */
export function buildImagePrompt(
  description: string,
  settings: CampaignSettings,
  opts?: PromptStyleOpts
): string {
  const style = settings.artStyle;
  if (!style) return description;
  if (opts?.entityType && SCENE_ENTITY_TYPES.has(opts.entityType)) {
    return `(${style}:1.3). ${description}`;
  }
  return `${style}. ${description}`;
}

/** The default aesthetic SDXL scenes drift into (graphite/monochrome sketch). When a
 * color-forward style is configured for a scene, these are appended to the negative
 * prompt to actively push away from that drift. Deliberately style-agnostic — it
 * names the unwanted look, not "not-lego". */
const DRIFT_NEGATIVES = [
  "monochrome",
  "grayscale",
  "graphite",
  "pencil sketch",
  "charcoal",
  "ink wash",
  "muted colors",
  "desaturated",
];

/** Styles that are themselves intentionally monochrome or linework — if the player
 * configured one of these, we must NOT push away from it. Matched as case-insensitive
 * substrings of the configured style. */
const MONOCHROME_STYLE_HINTS = [
  "noir",
  "sketch",
  "pencil",
  "charcoal",
  "graphite",
  "ink",
  "monochrome",
  "grayscale",
  "black and white",
  "line art",
  "etching",
];

/** Extra negative-prompt terms that steer a scene away from SDXL's default
 * graphite/monochrome drift (ADR-0028). Returns "" unless the entity is scene-class
 * AND a style is configured AND that style isn't itself a monochrome/linework look
 * (in which case pushing away from it would fight the player's choice). Local backend
 * only — appended to the workflow's static negative prompt. Unit-testable without
 * ComfyUI. */
export function sceneStyleNegatives(settings: CampaignSettings, entityType: ImageEntityType): string {
  const style = settings.artStyle?.trim();
  if (!style || !SCENE_ENTITY_TYPES.has(entityType)) return "";
  const lower = style.toLowerCase();
  if (MONOCHROME_STYLE_HINTS.some((hint) => lower.includes(hint))) return "";
  return DRIFT_NEGATIVES.join(", ");
}
