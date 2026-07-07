import type { CampaignSettings } from "./campaign-store.js";

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
 * reading acceptably for a named-artist style. */
export function buildImagePrompt(description: string, settings: CampaignSettings): string {
  return settings.artStyle ? `${settings.artStyle}. ${description}` : description;
}
