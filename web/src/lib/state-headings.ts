/** Canonical markdown heading strings the frontend parser looks for in
 * state files the DM engine writes. These must match the literal text
 * the backend actually produces — see tests/heading-consistency.spec.ts,
 * which asserts src/dm-engine.ts's system prompt and
 * scripts/scratch-campaign.ts's template still use these exact headings.
 * If either source drifts, that test fails loudly instead of
 * findMarkdownSection silently returning undefined. */
export const CURRENT_SITUATION_HEADING = "Current Situation";
export const QUEST_ACTIVE_HEADING = "Active";
export const QUEST_COMPLETED_HEADING = "Completed";
