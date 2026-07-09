import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSceneCaption, resolveMomentDescription } from "../src/narration.js";

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
