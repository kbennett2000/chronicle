import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractSceneCaption,
  extractPresentEntities,
  extractMomentTags,
  resolveMomentDescription,
  parseRetryCaption,
  retrySceneCaption,
} from "../src/narration.js";

// ── extractSceneCaption (ADR-0030 / #128) ───────────────────────────────────

test("extractSceneCaption pulls the caption off the final line and strips it", () => {
  const text =
    "The lantern gutters as Kael steps into the flooded crypt.\n\n" +
    "[SCENE: a lone adventurer wading knee-deep through a flooded stone crypt, lantern light rippling on black water, moss on carved pillars]";
  const { narration, sceneCaption } = extractSceneCaption(text);
  assert.equal(sceneCaption, "a lone adventurer wading knee-deep through a flooded stone crypt, lantern light rippling on black water, moss on carved pillars");
  // The caption line is gone from what the player reads...
  assert.ok(!/\[SCENE:/i.test(narration), "narration must not contain the [SCENE:] marker");
  // ...and the prose itself is preserved.
  assert.equal(narration, "The lantern gutters as Kael steps into the flooded crypt.");
});

test("extractSceneCaption returns text unchanged and no caption when absent", () => {
  const text = "You push open the tavern door. The room falls silent.";
  const { narration, sceneCaption } = extractSceneCaption(text);
  assert.equal(sceneCaption, undefined);
  assert.equal(narration, text);
});

test("extractSceneCaption tolerates trailing whitespace and newlines around the marker", () => {
  const text = "Smoke curls from the ruined watchtower.\n\n[SCENE: a crumbling watchtower smoldering at dusk]   \n\n";
  const { narration, sceneCaption } = extractSceneCaption(text);
  assert.equal(sceneCaption, "a crumbling watchtower smoldering at dusk");
  assert.equal(narration, "Smoke curls from the ruined watchtower.");
});

test("extractSceneCaption is case-insensitive on the marker keyword", () => {
  const { sceneCaption } = extractSceneCaption("Rain lashes the pier.\n[scene: rain on a wooden pier at night]");
  assert.equal(sceneCaption, "rain on a wooden pier at night");
});

test("extractSceneCaption keeps the last non-empty caption if the model emits more than one", () => {
  const text = "Beat one.\n[SCENE: first framing]\nBeat two.\n[SCENE: final framing]";
  const { narration, sceneCaption } = extractSceneCaption(text);
  assert.equal(sceneCaption, "final framing");
  // Every marker is stripped from the prose, not just the last.
  assert.ok(!/\[SCENE:/i.test(narration));
  assert.ok(narration.includes("Beat one."));
  assert.ok(narration.includes("Beat two."));
});

test("extractSceneCaption strips an empty marker but yields no caption", () => {
  const text = "The road forks ahead.\n[SCENE: ]";
  const { narration, sceneCaption } = extractSceneCaption(text);
  assert.equal(sceneCaption, undefined);
  assert.ok(!/\[SCENE:/i.test(narration), "empty marker must still be removed from player text");
  assert.equal(narration, "The road forks ahead.");
});

test("extractSceneCaption never throws on empty input", () => {
  assert.deepEqual(extractSceneCaption(""), { narration: "" });
});

// ── extractPresentEntities (ADR-0031 / #134) ────────────────────────────────

test("extractPresentEntities parses a comma list and strips the tag", () => {
  const text =
    "Marta bars the door as the wraith drifts closer.\n" +
    "[SCENE: a woman braces a door against a pale wraith in a candlelit hall]\n" +
    "[PRESENT: Marta, Kael]";
  const { narration, presentEntities } = extractPresentEntities(text);
  assert.deepEqual(presentEntities, ["Marta", "Kael"]);
  assert.ok(!/\[PRESENT:/i.test(narration), "narration must not contain the [PRESENT:] marker");
  // The [SCENE:] line is left intact by this parser (extractSceneCaption owns it).
  assert.ok(narration.includes("[SCENE:"));
});

test("extractPresentEntities returns an empty list and unchanged text when absent", () => {
  const text = "A cold wind crosses the empty moor.\n[SCENE: a windswept moor under grey cloud]";
  const { narration, presentEntities } = extractPresentEntities(text);
  assert.deepEqual(presentEntities, []);
  assert.equal(narration, text);
});

test("extractPresentEntities trims, drops empties, and dedupes case-insensitively (focal-first order)", () => {
  const { presentEntities } = extractPresentEntities("[PRESENT:  Marta ,, kael, MARTA , Kael ]");
  assert.deepEqual(presentEntities, ["Marta", "kael"]);
});

test("extractPresentEntities keeps the last non-empty tag if the model emits more than one", () => {
  const { narration, presentEntities } = extractPresentEntities(
    "[PRESENT: Aelar]\nmid\n[PRESENT: Marta, Kael]"
  );
  assert.deepEqual(presentEntities, ["Marta", "Kael"]);
  assert.ok(!/\[PRESENT:/i.test(narration), "every marker is stripped, not just the last");
});

test("extractPresentEntities strips an empty tag but yields no names", () => {
  const { narration, presentEntities } = extractPresentEntities("The hall stands empty.\n[PRESENT: ]");
  assert.deepEqual(presentEntities, []);
  assert.ok(!/\[PRESENT:/i.test(narration));
  assert.equal(narration, "The hall stands empty.");
});

test("extractPresentEntities never throws on empty input", () => {
  assert.deepEqual(extractPresentEntities(""), { narration: "", presentEntities: [] });
});

// ── extractMomentTags: both tags in one pass (ADR-0031 seam) ─────────────────

test("extractMomentTags pulls caption + present list and fully strips both from narration", () => {
  const text =
    "Kael lowers his bow as Marta steps from the shadow of the arch.\n\n" +
    "[SCENE: a ranger lowers a longbow as a scarred woman emerges from a stone arch at dusk]\n" +
    "[PRESENT: Kael, Marta]";
  const { narration, sceneCaption, presentEntities } = extractMomentTags(text);
  assert.equal(sceneCaption, "a ranger lowers a longbow as a scarred woman emerges from a stone arch at dusk");
  assert.deepEqual(presentEntities, ["Kael", "Marta"]);
  assert.ok(!/\[SCENE:/i.test(narration) && !/\[PRESENT:/i.test(narration), "no tag leaks to the player");
  assert.equal(narration, "Kael lowers his bow as Marta steps from the shadow of the arch.");
});

test("extractMomentTags: order-independent — [PRESENT:] before [SCENE:] still parses both", () => {
  const text = "beat\n[PRESENT: Marta]\n[SCENE: a woman at a forge]";
  const { sceneCaption, presentEntities } = extractMomentTags(text);
  assert.equal(sceneCaption, "a woman at a forge");
  assert.deepEqual(presentEntities, ["Marta"]);
});

test("extractMomentTags: caption present, no present tag → empty list, caption intact", () => {
  const { sceneCaption, presentEntities } = extractMomentTags("beat\n[SCENE: a lone gull over grey surf]");
  assert.equal(sceneCaption, "a lone gull over grey surf");
  assert.deepEqual(presentEntities, []);
});

// ── resolveMomentDescription precedence (ADR-0030 seam) ──────────────────────

test("resolveMomentDescription: explicit override wins and does not consult the caption", () => {
  const record = { narration: "long prose slab", sceneCaption: "the cached caption" };
  assert.equal(resolveMomentDescription("the same scene, but at night", record), "the same scene, but at night");
});

test("resolveMomentDescription: cached caption is used over narration when there is no override", () => {
  const record = { narration: "long prose slab", sceneCaption: "the cached caption" };
  assert.equal(resolveMomentDescription("", record), "the cached caption");
});

test("resolveMomentDescription: falls back to narration when no caption is stored", () => {
  const record = { narration: "long prose slab" };
  assert.equal(resolveMomentDescription("", record), "long prose slab");
});

test("resolveMomentDescription: a blank caption falls through to narration", () => {
  const record = { narration: "long prose slab", sceneCaption: "   " };
  assert.equal(resolveMomentDescription("", record), "long prose slab");
});

// ── resolveMomentDescription AUTO mode (ADR-0030 race amendment / #146) ───────
// AUTO illustration is DRIVEN BY the caption: with no caption it must SKIP
// (return undefined) rather than scavenge narration. Narration fallback survives
// only on the manual path.

test("resolveMomentDescription AUTO: a parsed caption is used, never narration", () => {
  const record = { narration: "long prose slab", sceneCaption: "the cached caption" };
  assert.equal(resolveMomentDescription("", record, { auto: true }), "the cached caption");
});

test("resolveMomentDescription AUTO: NO caption returns undefined (skip), not narration", () => {
  const record = { narration: "long prose slab" };
  assert.equal(resolveMomentDescription("", record, { auto: true }), undefined);
});

test("resolveMomentDescription AUTO: a blank caption returns undefined (skip), not narration", () => {
  const record = { narration: "long prose slab", sceneCaption: "   " };
  assert.equal(resolveMomentDescription("", record, { auto: true }), undefined);
});

test("resolveMomentDescription AUTO: an explicit override still wins over the skip", () => {
  const record = { narration: "long prose slab" };
  assert.equal(resolveMomentDescription("dusk, wider shot", record, { auto: true }), "dusk, wider shot");
});

test("resolveMomentDescription MANUAL: no caption still falls back to narration (fallback preserved)", () => {
  const record = { narration: "long prose slab" };
  // No opts (and explicit auto:false) — the manual path keeps narration fallback.
  assert.equal(resolveMomentDescription("", record), "long prose slab");
  assert.equal(resolveMomentDescription("", record, { auto: false }), "long prose slab");
});

// ── parseRetryCaption (ADR-0030 reliability amendment / #130) ────────────────

test("parseRetryCaption reads a proper [SCENE: ...] retry reply", () => {
  assert.equal(
    parseRetryCaption("[SCENE: a ranger crouched at the treeline watching torchlit riders pass]"),
    "a ranger crouched at the treeline watching torchlit riders pass"
  );
});

test("parseRetryCaption accepts a bare line with no marker", () => {
  assert.equal(
    parseRetryCaption("a lantern-lit dock at low tide, crates stacked on wet planks"),
    "a lantern-lit dock at low tide, crates stacked on wet planks"
  );
});

test("parseRetryCaption strips a bare 'SCENE:' label and takes the last non-empty line", () => {
  assert.equal(parseRetryCaption("Sure, here it is:\nSCENE: a storm breaking over black cliffs"),
    "a storm breaking over black cliffs");
});

test("parseRetryCaption returns undefined on empty or whitespace input", () => {
  assert.equal(parseRetryCaption(""), undefined);
  assert.equal(parseRetryCaption("   \n  \n"), undefined);
});

// ── retrySceneCaption: one-shot backfill, no loop (ADR-0030 / #130) ──────────

test("retrySceneCaption invokes the engine exactly once and returns the caption", async () => {
  let calls = 0;
  const caption = await retrySceneCaption(async () => {
    calls++;
    return { text: "[SCENE: a caravan halted in a red-rock canyon at noon]", isError: false };
  });
  assert.equal(caption, "a caravan halted in a red-rock canyon at noon");
  assert.equal(calls, 1, "retry must fire exactly once — no loop");
});

test("retrySceneCaption returns undefined when the retry yields empty text (narration fallback)", async () => {
  let calls = 0;
  const caption = await retrySceneCaption(async () => {
    calls++;
    return { text: "", isError: false };
  });
  assert.equal(caption, undefined);
  assert.equal(calls, 1, "still exactly one attempt — no loop on empty");
});

test("retrySceneCaption returns undefined when the retry is an engine error", async () => {
  const caption = await retrySceneCaption(async () => ({ text: "whatever", isError: true }));
  assert.equal(caption, undefined);
});

test("retrySceneCaption never throws when the engine call rejects", async () => {
  let calls = 0;
  const caption = await retrySceneCaption(async () => {
    calls++;
    throw new Error("engine blew up");
  });
  assert.equal(caption, undefined);
  assert.equal(calls, 1, "one attempt, swallowed error, no loop");
});
