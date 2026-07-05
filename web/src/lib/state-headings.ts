/** Canonical markdown heading strings the frontend parser looks for in
 * state files the DM engine writes. These must match the literal text
 * the backend actually produces — see tests/heading-consistency.spec.ts,
 * which asserts src/dm-engine.ts's system prompt and
 * scripts/scratch-campaign.ts's template still use these exact headings.
 * If either source drifts, that test fails loudly instead of
 * findMarkdownSection silently returning undefined. */
export const CURRENT_SITUATION_HEADING = "Current Situation";
export const LOCATIONS_VISITED_HEADING = "Locations Visited";
export const QUEST_ACTIVE_HEADING = "Active";
export const QUEST_COMPLETED_HEADING = "Completed";

/** npc-roster.md's per-entry `- **Field:** value` bullet names — same
 * "must match the backend's literal text" contract as the headings
 * above, cross-checked against scripts/scratch-campaign.ts's template
 * and src/image-generator.ts's tool instructions to the model in
 * tests/heading-consistency.spec.ts. */
export const NPC_DESCRIPTION_FIELD = "Description";
export const NPC_DISPOSITION_FIELD = "Disposition";
export const NPC_KNOWS_FIELD = "Knows";
export const NPC_PORTRAIT_FIELD = "Portrait asset ID";
