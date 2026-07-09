import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  sanitizeImagePrompt,
  mergeCharacterAppearance,
  groundSceneDescription,
  sceneStyleNegatives,
} from "../src/image-generator.js";
import type { CampaignSettings } from "../src/campaign-store.js";

function campaignWithSheet(sheet: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chronicle-appearance-"));
  fs.writeFileSync(path.join(dir, "character-sheet.json"), JSON.stringify(sheet));
  return dir;
}

// ADR-0031 grounding fixtures: a campaign dir with an optional character sheet
// and/or npc-roster.md. NPC appearance lives in the freeform Description bullet.
function campaignWith(opts: { sheet?: Record<string, unknown>; roster?: string }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chronicle-ground-"));
  if (opts.sheet) fs.writeFileSync(path.join(dir, "character-sheet.json"), JSON.stringify(opts.sheet));
  if (opts.roster) fs.writeFileSync(path.join(dir, "npc-roster.md"), opts.roster);
  return dir;
}

function rosterWith(name: string, description?: string): string {
  return (
    `# NPC Roster\n\n## ${name}\n` +
    (description ? `- **Description:** ${description}\n` : "") +
    `- **Disposition:** wary\n- **Knows:** the way through\n`
  );
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

// --- ADR-0031: scene entity grounding (#134) ---

test("groundSceneDescription prepends canonical appearance for the PC and a named NPC, focal subject first (#134)", () => {
  const dir = campaignWith({
    sheet: { name: "Kael", appearance: "a lean half-elf ranger in a green hooded cloak" },
    roster: rosterWith("Marta", "a scarred woman in a leather apron, iron-grey braid"),
  });
  // [PRESENT: Marta, Kael] — Marta is focal (listed first), so her tag leads.
  const out = groundSceneDescription(
    dir,
    "torchlight flares as two figures meet in the ruined gatehouse",
    ["Marta", "Kael"]
  );
  assert.equal(
    out,
    "a scarred woman in a leather apron, iron-grey braid a lean half-elf ranger in a green hooded cloak torchlight flares as two figures meet in the ruined gatehouse"
  );
});

test("groundSceneDescription drops extra entities before the 500-char cap bites, preserving the whole description (#134)", () => {
  const long = (label: string) => `${label} `.repeat(30).trim(); // ~200+ chars each
  const dir = campaignWith({
    sheet: { name: "Kael", appearance: long("appearanceA") },
    roster:
      rosterWith("Marta", long("appearanceB")) + `\n## Bram\n- **Description:** ${long("appearanceC")}\n`,
  });
  const desc = "a tense standoff in a cramped, smoke-filled cellar";
  const out = groundSceneDescription(dir, desc, ["Kael", "Marta", "Bram"]);
  // Assembled prompt never exceeds the downstream cap...
  assert.ok(out.length <= 500, `expected <=500 chars, got ${out.length}`);
  // ...the scene description itself is fully preserved (never truncated)...
  assert.ok(out.endsWith(desc), "description must survive intact at the tail");
  // ...the focal entity (first in the list) is grounded...
  assert.ok(out.startsWith(long("appearanceA")), "focal entity's appearance leads");
  // ...and the ones that wouldn't fit are dropped, not squeezed in mangled.
  assert.ok(!out.includes(long("appearanceC")), "the third entity is dropped before the cap");
});

test("groundSceneDescription caps at three entities even when all fit (#134)", () => {
  const dir = campaignWith({
    sheet: { name: "Kael", appearance: "cloaked ranger" },
    roster:
      rosterWith("Marta", "aproned smith") +
      `\n## Bram\n- **Description:** bearded sailor\n` +
      `\n## Odd\n- **Description:** masked figure\n`,
  });
  const out = groundSceneDescription(dir, "a crowded dockside brawl", ["Marta", "Bram", "Odd", "Kael"]);
  assert.ok(out.includes("aproned smith") && out.includes("bearded sailor") && out.includes("masked figure"));
  assert.ok(!out.includes("cloaked ranger"), "the 4th present entity is beyond the 3-entity budget");
});

test("groundSceneDescription skips an entity whose look the description already states (#134)", () => {
  const dir = campaignWith({ sheet: { name: "Kael", appearance: "a lean half-elf ranger" } });
  const desc = "A lean half-elf ranger nocks an arrow at the cave mouth";
  assert.equal(groundSceneDescription(dir, desc, ["Kael"]), desc);
});

test("groundSceneDescription leaves the description untouched when a present name matches no known entity (#134)", () => {
  const dir = campaignWith({ sheet: { name: "Kael", appearance: "a cloaked ranger" } });
  assert.equal(
    groundSceneDescription(dir, "a hooded stranger waits by the gate", ["Nobody"]),
    "a hooded stranger waits by the gate"
  );
});

test("groundSceneDescription leaves the description untouched when the matched entity has no appearance (#134)", () => {
  // PC sheet has no appearance; NPC has no Description bullet → nothing to ground.
  const dir = campaignWith({ sheet: { name: "Kael" }, roster: rosterWith("Marta") });
  const desc = "two figures square off in the rain";
  assert.equal(groundSceneDescription(dir, desc, ["Kael", "Marta"]), desc);
});

test("groundSceneDescription is a no-op for an empty or absent present list (#134)", () => {
  const dir = campaignWith({ sheet: { name: "Kael", appearance: "a cloaked ranger" } });
  assert.equal(groundSceneDescription(dir, "a quiet meadow at dawn", []), "a quiet meadow at dawn");
  assert.equal(groundSceneDescription(dir, "a quiet meadow at dawn", undefined), "a quiet meadow at dawn");
});

test("hard-caps prompt length so a leaked context blob can't balloon the call (#58)", () => {
  const huge = "orc ".repeat(1000); // ~4000 chars, no punctuation to strip on
  const out = sanitizeImagePrompt(huge, plain);
  // 500-char cap on the description; the (style-less) prompt is just the cap.
  assert.ok(out.length <= 500, `expected <=500 chars, got ${out.length}`);
});

// --- ADR-0028: scene/location style adherence (local backend only) ---

const lego: CampaignSettings = { generateImages: true, artStyle: "Lego-style" } as CampaignSettings;

test("scene-class prompts weight the leading style clause (ADR-0028)", () => {
  // A location/scene is a loose composition, so the style is emphasized with SDXL
  // prompt weighting to survive the model's default-aesthetic drift.
  assert.equal(
    sanitizeImagePrompt("a vast throne room, shafts of light", lego, { entityType: "location" }),
    "(Lego-style:1.3). a vast throne room, shafts of light"
  );
  assert.equal(
    sanitizeImagePrompt("a storm-lashed harbor at dusk", lego, { entityType: "scene" }),
    "(Lego-style:1.3). a storm-lashed harbor at dusk"
  );
});

test("character-class prompts keep the unweighted leading style — the path that already works (ADR-0028)", () => {
  // Tight subjects hold the style already; they must be byte-identical to pre-0028.
  for (const entityType of ["character", "npc", "item", "boss"] as const) {
    assert.equal(
      sanitizeImagePrompt("a weathered dwarf blacksmith", lego, { entityType }),
      "Lego-style. a weathered dwarf blacksmith"
    );
  }
});

test("no opts (grok/video callers) is byte-identical to the pre-0028 output", () => {
  assert.equal(
    sanitizeImagePrompt("a vast throne room", lego),
    "Lego-style. a vast throne room"
  );
});

test("sceneStyleNegatives pushes color-forward scenes off the graphite default (ADR-0028)", () => {
  const neg = sceneStyleNegatives(lego, "location");
  assert.match(neg, /monochrome/);
  assert.match(neg, /graphite/);
  assert.match(neg, /desaturated/);
});

test("sceneStyleNegatives is empty for character-class entities (ADR-0028)", () => {
  assert.equal(sceneStyleNegatives(lego, "character"), "");
  assert.equal(sceneStyleNegatives(lego, "npc"), "");
});

test("sceneStyleNegatives never fights an intentionally monochrome style (ADR-0028)", () => {
  // The player asked for these looks — don't steer away from them.
  for (const artStyle of ["ink wash", "pencil sketch", "noir", "charcoal", "black and white"]) {
    const settings = { generateImages: true, artStyle } as CampaignSettings;
    assert.equal(sceneStyleNegatives(settings, "location"), "", `should opt out for "${artStyle}"`);
  }
});

test("sceneStyleNegatives is empty when no style is configured (ADR-0028)", () => {
  assert.equal(sceneStyleNegatives(plain, "location"), "");
});
