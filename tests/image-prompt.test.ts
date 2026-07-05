import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeImagePrompt } from "../src/image-generator.js";
import type { CampaignSettings } from "../src/campaign-store.js";

const styled: CampaignSettings = { generateImages: true, artStyle: "ink wash" } as CampaignSettings;
const plain: CampaignSettings = { generateImages: true } as CampaignSettings;

test("passes a clean scene through and appends the art style", () => {
  assert.equal(
    sanitizeImagePrompt("A dwarf blacksmith at a glowing forge", styled),
    "A dwarf blacksmith at a glowing forge, in the style of ink wash"
  );
});

test("strips recognized DM bookkeeping chatter before the scene (#60)", () => {
  // The illustrate path feeds turn narration straight to /imagine; recognized
  // meta-chatter must not survive into the prompt.
  const out = sanitizeImagePrompt(
    "I'll update the character sheet now. A wolf lunges from the treeline.",
    plain
  );
  assert.equal(out, "A wolf lunges from the treeline.");
});

test("never yields an empty prompt (#60)", () => {
  // Empty/whitespace input falls back to a generic scene rather than "".
  assert.equal(sanitizeImagePrompt("   ", plain), "a scene from the story");
  assert.equal(sanitizeImagePrompt("", plain), "a scene from the story");
  // Input that is entirely strippable chatter falls back to the RAW description
  // (non-empty) rather than collapsing to "" — better to send the original text
  // than nothing at all.
  const out = sanitizeImagePrompt("Back to the story.", plain);
  assert.equal(out, "Back to the story.");
});

test("hard-caps prompt length so a leaked context blob can't balloon the call (#58)", () => {
  const huge = "orc ".repeat(1000); // ~4000 chars, no punctuation to strip on
  const out = sanitizeImagePrompt(huge, plain);
  // 500-char cap on the description; the (style-less) prompt is just the cap.
  assert.ok(out.length <= 500, `expected <=500 chars, got ${out.length}`);
});
