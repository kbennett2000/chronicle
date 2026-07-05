import type { CampaignSettings } from "./campaign-store.js";

/** Builds the prompt for the (not-yet-implemented, Slice 6) image
 * generation worker from a state-file description — a character portrait,
 * an NPC/location/item's first-appearance description, or a boss reveal,
 * per design doc §8. Appends the campaign's configured art style, if any,
 * per ADR-0004: this only changes how a generated image looks, never what
 * gets generated. */
export function buildImagePrompt(description: string, settings: CampaignSettings): string {
  return settings.artStyle ? `${description}, in the style of ${settings.artStyle}` : description;
}
