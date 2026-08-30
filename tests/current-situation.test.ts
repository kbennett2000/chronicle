import { test } from "node:test";
import assert from "node:assert/strict";
import { currentSituation, SITUATION_SUMMARY_MAX_CHARS } from "../src/campaign-store.js";

/** ADR-0039: the "## Current Situation" extractor must return a bounded summary
 * so the Home campaign list can never render a wall of text, even when the DM
 * lets the section grow into a stacked append-only log. */

function worldState(situationBody: string): string {
  return [
    "# World State",
    "",
    "## Current Situation",
    situationBody,
    "",
    "## Locations Visited",
    "- Somewhere",
    "",
  ].join("\n");
}

test("caps a long multi-moment section to the budget and ends with an ellipsis", () => {
  // 57 stacked "moment" blocks, mirroring the ted-the-wizard bloat.
  const huge = Array.from({ length: 57 }, (_, i) => `CURRENT MOMENT: beat number ${i} where a great many words are written to pad the section well past any sane budget.`).join(" ");
  const out = currentSituation(worldState(huge));
  assert.ok(out.length <= SITUATION_SUMMARY_MAX_CHARS + 1, `length ${out.length} should be within budget (+1 for the ellipsis)`);
  assert.ok(out.endsWith("…"), "a truncated summary ends with an ellipsis");
});

test("passes a short situation through unchanged (no ellipsis)", () => {
  const short = "Ted stands in a steaming pocket-park where the fountain used to be. The air still tastes faintly of pennies.";
  const out = currentSituation(worldState(short));
  assert.equal(out, short);
  assert.ok(!out.endsWith("…"), "an un-truncated summary keeps no ellipsis");
});

test("returns empty string for the not-yet-started placeholder", () => {
  assert.equal(currentSituation(worldState("_(not yet started)_")), "");
});

test("returns empty string when there is no Current Situation heading", () => {
  assert.equal(currentSituation("# World State\n\n## Locations Visited\n- Nowhere\n"), "");
});

test("truncates on a word boundary, not mid-word", () => {
  const words = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
  const out = currentSituation(worldState(words));
  const body = out.replace(/…$/, "");
  // The last retained token must be a whole "wordN", never a sliced fragment.
  assert.match(body.trim().split(" ").at(-1) ?? "", /^word\d+$/);
});
