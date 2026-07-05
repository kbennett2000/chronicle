import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openingDirective } from "../src/dm-engine.js";
import {
  startSessionLog,
  appendTurnTranscript,
  readTurnTranscript,
  readStateSnapshot,
} from "../src/campaign-store.js";

/** A minimal on-disk campaign (not scaffoldCampaign, which writes under the real
 * CAMPAIGNS_ROOT) — ADR-0013's turn-zero logic is pure filesystem + prompt
 * composition, so a temp dir exercises it without touching campaigns/. */
function tempCampaign(sheet: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chronicle-opening-"));
  fs.writeFileSync(path.join(dir, "character-sheet.json"), JSON.stringify(sheet));
  fs.writeFileSync(path.join(dir, "world-state.md"), "## Current Situation\n\n_(not yet started)_\n");
  fs.writeFileSync(path.join(dir, "npc-roster.md"), "# NPCs\n");
  fs.writeFileSync(path.join(dir, "quest-log.md"), "# Quests\n");
  fs.mkdirSync(path.join(dir, "session-log"));
  return dir;
}

test("openingDirective names the real character and their race/class (ADR-0013, #54)", () => {
  const dir = tempCampaign({ name: "Vex Kalloran", race: "Half-elf", class: "Rogue", level: 1 });
  try {
    const directive = openingDirective(dir);
    assert.match(directive, /Vex Kalloran/);
    assert.match(directive, /Half-elf Rogue/);
    // It must read as a DM instruction to open the story, not as player dialogue.
    assert.match(directive, /Begin the campaign/i);
    assert.match(directive, /Current Situation/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("openingDirective degrades to just the name when race/class are absent", () => {
  const dir = tempCampaign({ name: "Nine", level: 1 });
  try {
    const directive = openingDirective(dir);
    assert.match(directive, /Nine/);
    // No dangling "a  " descriptor when there's no race/class.
    assert.doesNotMatch(directive, /,\s+a\s+\./);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a turn-zero record persists with an empty playerMessage and turnIndex 0 (ADR-0013)", () => {
  const dir = tempCampaign({ name: "Vex", race: "Human", class: "Fighter", level: 1 });
  try {
    const log = startSessionLog(dir);
    // How the server persists an opening scene: empty playerMessage, real narration.
    const rec = appendTurnTranscript(dir, log, "", "The gate groans open onto a rain-black road.");
    assert.equal(rec.turnIndex, 0);
    assert.equal(rec.playerMessage, "");
    assert.match(rec.narration, /rain-black road/);

    // It round-trips as an ordinary transcript record...
    const all = readTurnTranscript(dir, log);
    assert.equal(all.length, 1);
    assert.equal(all[0].playerMessage, "");

    // ...and surfaces through the /state snapshot so Play renders it as the
    // first (DM-initiated) turn rather than the "tale hasn't begun" empty state.
    const snap = readStateSnapshot(dir, log);
    assert.ok(snap.currentSessionLog, "expected currentSessionLog to be populated");
    assert.equal(snap.currentSessionLog!.transcript.length, 1);
    assert.equal(snap.currentSessionLog!.transcript[0].playerMessage, "");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
