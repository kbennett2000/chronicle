import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractSceneCaption,
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
