import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCharacterIdentity } from "../src/campaign-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function scratchDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "chronicle-identity-"));
}

test("readCharacterIdentity returns the sheet's real name/race/class (issues #51/#48)", () => {
  const dir = scratchDir();
  try {
    fs.writeFileSync(
      path.join(dir, "character-sheet.json"),
      JSON.stringify({ name: "9", race: "Human", class: "Rogue", level: 1 })
    );
    assert.deepEqual(readCharacterIdentity(dir), { name: "9", race: "Human", class: "Rogue" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("readCharacterIdentity degrades to a neutral identity when the sheet is missing/unreadable", () => {
  const dir = scratchDir();
  try {
    // No sheet written.
    assert.equal(readCharacterIdentity(dir).name, "the player character");
    // Unparseable sheet -> same fallback, never throws.
    fs.writeFileSync(path.join(dir, "character-sheet.json"), "{ not json");
    assert.equal(readCharacterIdentity(dir).name, "the player character");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the DM system prompt no longer hardcodes a specific character name", () => {
  // Regression guard for #51/#48: the engine must address whoever the sheet
  // says, so no player-character name may be baked into the prompt source.
  const engine = fs.readFileSync(path.join(__dirname, "../src/dm-engine.ts"), "utf8");
  assert.ok(!engine.includes("Kira Emberfall"), "dm-engine.ts still hardcodes 'Kira Emberfall'");
});
