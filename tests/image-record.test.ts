import { test } from "node:test";
import assert from "node:assert/strict";
import { withNpcPortrait, withLocationImage } from "../src/campaign-store.js";

// These pure string transforms must produce exactly what the frontend parser
// reads back: web/src/lib/markdown.ts's BULLET_FIELD_RE for the NPC bullet,
// and web/src/lib/gallery.ts's IMAGE_LINE_RE for the location line. The regexes
// below are copied from those files so a drift on either side fails here.
const BULLET_FIELD_RE = /^-\s*\*\*([^*]+):\*\*\s?(.*)$/;
const IMAGE_LINE_RE = /^-?\s*\*{0,2}Image\*{0,2}:\s*(.+)$/i;

test("withNpcPortrait inserts a portrait bullet the frontend parser reads", () => {
  const roster = `# NPC Roster

## Garrick
- **Description:** Stout gate guard.
- **Disposition:** Grateful ally.
`;
  const out = withNpcPortrait(roster, "Garrick", "images/npc-garrick.jpg");
  const bulletLine = out.split("\n").find((l) => l.includes("Portrait asset ID"));
  assert.ok(bulletLine, "portrait bullet present");
  const m = BULLET_FIELD_RE.exec(bulletLine!.trim());
  assert.ok(m, "portrait bullet matches BULLET_FIELD_RE");
  assert.equal(m![1].trim(), "Portrait asset ID");
  assert.equal(m![2].trim(), "images/npc-garrick.jpg");
  // Existing fields survive.
  assert.ok(out.includes("- **Description:** Stout gate guard."));
});

test("withNpcPortrait replaces an existing portrait rather than duplicating", () => {
  const roster = `# NPC Roster

## Garrick
- **Portrait asset ID:** images/npc-garrick-old.jpg
- **Description:** Stout gate guard.
`;
  const out = withNpcPortrait(roster, "Garrick", "images/npc-garrick.jpg");
  const count = out.split("\n").filter((l) => l.includes("Portrait asset ID")).length;
  assert.equal(count, 1, "exactly one portrait bullet");
  assert.ok(out.includes("images/npc-garrick.jpg"));
  assert.ok(!out.includes("images/npc-garrick-old.jpg"));
});

test("withNpcPortrait is case-insensitive on the NPC name and matches only that NPC", () => {
  const roster = `# NPC Roster

## Garrick
- **Description:** Guard.

## Barrow
- **Description:** Innkeeper.
`;
  const out = withNpcPortrait(roster, "barrow", "images/npc-barrow.jpg");
  const garrickSection = out.split("## Barrow")[0];
  assert.ok(!garrickSection.includes("Portrait asset ID"), "Garrick untouched");
  assert.ok(out.split("## Barrow")[1].includes("images/npc-barrow.jpg"));
});

test("withLocationImage inserts an Image line the gallery parser reads", () => {
  const world = `# World State

## Current Situation
Morning at the tavern.

## Locations Visited
- **The Gilded Antler** — a warm tavern.
- **Old watchtower** — abandoned, blue-green lights.
`;
  const out = withLocationImage(world, "Old watchtower", "images/location-old-watchtower.jpg");
  const lines = out.split("\n");
  const idx = lines.findIndex((l) => l.includes("Old watchtower"));
  const imageLine = lines[idx + 1];
  assert.ok(/^[ \t]/.test(imageLine), "image line is indented under the bullet");
  const m = IMAGE_LINE_RE.exec(imageLine.trim());
  assert.ok(m, "image line matches gallery IMAGE_LINE_RE");
  assert.equal(m![1].trim(), "images/location-old-watchtower.jpg");
  // The other location is untouched.
  assert.ok(!out.includes("Gilded Antler** — a warm tavern.\n  - Image"));
});

test("withLocationImage replaces an existing Image line rather than duplicating", () => {
  const world = `# World State

## Locations Visited
- **Old watchtower** — abandoned.
  - Image: images/location-old-watchtower-old.jpg
`;
  const out = withLocationImage(world, "Old watchtower", "images/location-old-watchtower.jpg");
  const count = out.split("\n").filter((l) => /Image:/i.test(l)).length;
  assert.equal(count, 1, "exactly one image line");
  assert.ok(out.includes("images/location-old-watchtower.jpg"));
  assert.ok(!out.includes("old-watchtower-old.jpg"));
});

test("withLocationImage leaves content untouched when the section is absent", () => {
  const world = `# World State\n\n## Current Situation\nNo locations section here.\n`;
  assert.equal(withLocationImage(world, "Nowhere", "images/x.jpg"), world);
});
