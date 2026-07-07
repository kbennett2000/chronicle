import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sanitizeImagePrompt, mergeCharacterAppearance } from "../src/image-generator.js";
import type { CampaignSettings } from "../src/campaign-store.js";

function campaignWithSheet(sheet: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chronicle-appearance-"));
  fs.writeFileSync(path.join(dir, "character-sheet.json"), JSON.stringify(sheet));
  return dir;
}

const styled: CampaignSettings = { generateImages: true, artStyle: "ink wash" } as CampaignSettings;
const plain: CampaignSettings = { generateImages: true } as CampaignSettings;

test("passes a clean scene through and leads with the art style (#104)", () => {
  // Issue #104: the style leads the prompt as its own clause rather than
  // trailing as "in the style of X", so adjectival styles aren't ignored.
  assert.equal(
    sanitizeImagePrompt("A dwarf blacksmith at a glowing forge", styled),
    "ink wash. A dwarf blacksmith at a glowing forge"
  );
  const photoreal: CampaignSettings = { generateImages: true, artStyle: "photorealistic" } as CampaignSettings;
  assert.equal(
    sanitizeImagePrompt("A towering cyclops with one golden eye", photoreal),
    "photorealistic. A towering cyclops with one golden eye"
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

test("anchors a character portrait with the stored appearance (#104)", () => {
  const dir = campaignWithSheet({
    name: "Bob the Guy",
    appearance: "a towering one-eyed cyclops in worn leather armor",
  });
  // Model's free-written description gets the canonical appearance prepended...
  assert.equal(
    mergeCharacterAppearance(dir, "descends toward a mossy well, eye fixed on the dark water"),
    "a towering one-eyed cyclops in worn leather armor descends toward a mossy well, eye fixed on the dark water"
  );
  // ...but not duplicated when the model already restated it.
  assert.equal(
    mergeCharacterAppearance(dir, "A towering one-eyed cyclops in worn leather armor stands by the well"),
    "A towering one-eyed cyclops in worn leather armor stands by the well"
  );
});

test("leaves the description untouched when the sheet has no appearance (#104)", () => {
  const dir = campaignWithSheet({ name: "Bob the Guy" });
  assert.equal(mergeCharacterAppearance(dir, "stands by the well"), "stands by the well");
});

test("hard-caps prompt length so a leaked context blob can't balloon the call (#58)", () => {
  const huge = "orc ".repeat(1000); // ~4000 chars, no punctuation to strip on
  const out = sanitizeImagePrompt(huge, plain);
  // 500-char cap on the description; the (style-less) prompt is just the cap.
  assert.ok(out.length <= 500, `expected <=500 chars, got ${out.length}`);
});
