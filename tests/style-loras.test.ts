import { test } from "node:test";
import assert from "node:assert/strict";
import { STYLE_LORAS, lookupStyleLora } from "../src/image-backends/style-loras.js";

// ADR-0032: the style→LoRA recipe map for the local ComfyUI backend. Pure lookup +
// invariants — no ComfyUI, no GPU, no real .safetensors involved.

test("lookupStyleLora: normalizes the key (trim + case-insensitive) to the same recipe", () => {
  const canonical = lookupStyleLora("pixel art");
  assert.ok(canonical, "'pixel art' should map to a recipe");
  // Different casing / surrounding whitespace resolve to the SAME recipe object.
  assert.equal(lookupStyleLora("Pixel Art"), canonical);
  assert.equal(lookupStyleLora("  pixel art  "), canonical);
  assert.equal(lookupStyleLora("PIXEL ART"), canonical);
});

test("lookupStyleLora: unmapped / free-text / empty styles return undefined (prompt-only)", () => {
  assert.equal(lookupStyleLora("ink wash"), undefined);
  assert.equal(lookupStyleLora("Lego-style"), undefined);
  assert.equal(lookupStyleLora("a style nobody mapped"), undefined);
  assert.equal(lookupStyleLora(""), undefined);
  assert.equal(lookupStyleLora(undefined), undefined);
  assert.equal(lookupStyleLora(null), undefined);
});

test("STYLE_LORAS: the two proof recipes have the expected shape", () => {
  const pixel = STYLE_LORAS["pixel art"];
  const oil = STYLE_LORAS["oil painting"];
  assert.equal(pixel.loraFile, "pixel-art-xl.safetensors");
  assert.equal(pixel.trigger, "pixel art");
  assert.equal(pixel.strength, 1.0);
  assert.equal(oil.loraFile, "ClassipeintXL2.1.safetensors");
  assert.equal(oil.trigger, "oil painting");
  assert.equal(oil.strength, 0.8);
});

test("STYLE_LORAS invariant: every recipe is noRefiner this slice (only the base chain is LoRA-wired)", () => {
  // Guards the ADR-0032 invariant: a non-noRefiner recipe would half-apply under
  // quality=high once refiner-aware injection lands. This test forces that to be a
  // deliberate change, caught in CI.
  for (const [style, recipe] of Object.entries(STYLE_LORAS)) {
    assert.equal(recipe.noRefiner, true, `recipe "${style}" must set noRefiner: true`);
    assert.match(recipe.loraFile, /\.safetensors$/, `recipe "${style}" loraFile must be .safetensors`);
    assert.ok(recipe.strength > 0 && recipe.strength <= 2, `recipe "${style}" strength out of range`);
  }
});
