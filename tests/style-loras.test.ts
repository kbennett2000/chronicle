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
  assert.equal(lookupStyleLora("stained glass"), undefined);
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

test("lookupStyleLora: every Slice-2 style resolves (case-insensitive) to its recipe file", () => {
  const cases: [string, string][] = [
    ["comic book", "EldritchComicsXL1.2.safetensors"],
    ["Comic Book", "EldritchComicsXL1.2.safetensors"],
    ["Lego-style", "Lego_XL_v2.1.safetensors"], // the picker stores "Lego-style"
    ["pencil sketch", "sketch_style.safetensors"],
    ["watercolour", "watercolor-orie-xl.safetensors"],
    ["anime", "animelora-sdxl.safetensors"],
    ["storybook", "StoryBookRedmond-KidsRedmAF.safetensors"],
    ["3d", "PixarXL.safetensors"],
    ["3D", "PixarXL.safetensors"],
    ["cyberpunk", "cyberpunk_xl_v1.safetensors"],
    ["ukiyo-e", "Ukiyo-e-Art-XL.safetensors"],
    ["Ukiyo-E", "Ukiyo-e-Art-XL.safetensors"],
    ["claymation", "CLAYMATE-v2-sdxl.safetensors"],
  ];
  for (const [style, file] of cases) {
    const r = lookupStyleLora(style);
    assert.ok(r, `"${style}" should resolve to a recipe`);
    assert.equal(r.loraFile, file, `"${style}" → wrong file`);
  }
});

test("lookupStyleLora: noir and ghibli stay prompt-only (no recipe)", () => {
  assert.equal(lookupStyleLora("noir"), undefined);
  assert.equal(lookupStyleLora("ghibli"), undefined);
});

test("STYLE_LORAS: comic book carries per-style extraNegatives; others don't set them", () => {
  assert.equal(STYLE_LORAS["comic book"].extraNegatives, "book, magazine");
  assert.equal(STYLE_LORAS["pixel art"].extraNegatives, undefined);
  assert.equal(STYLE_LORAS["lego-style"].extraNegatives, undefined);
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
