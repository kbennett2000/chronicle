import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { catchUpDirective } from "../src/dm-engine.js";

/** ADR-0040: catchUpDirective is pure filesystem + prompt composition (like
 * openingDirective), so a temp dir exercises it without touching campaigns/. */
function tempCampaign(sheet: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chronicle-catchup-"));
  fs.writeFileSync(path.join(dir, "character-sheet.json"), JSON.stringify(sheet));
  fs.writeFileSync(path.join(dir, "world-state.md"), "## Current Situation\n\nMid-scene.\n");
  fs.writeFileSync(path.join(dir, "npc-roster.md"), "# NPCs\n");
  fs.writeFileSync(path.join(dir, "quest-log.md"), "# Quests\n");
  fs.mkdirSync(path.join(dir, "session-log"));
  return dir;
}

test("catchUpDirective names all four state files by absolute path plus the session log", () => {
  const dir = tempCampaign({ name: "Ted", race: "Human", class: "Wizard", level: 5 });
  const logPath = "session-log/session-2026-08-30.md";
  try {
    const d = catchUpDirective(dir, logPath, "I look around.");
    assert.match(d, new RegExp(path.join(dir, "world-state.md").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(d, new RegExp(path.join(dir, "character-sheet.json").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(d, new RegExp(path.join(dir, "npc-roster.md").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(d, new RegExp(path.join(dir, "quest-log.md").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(d, /session-log\/session-2026-08-30\.md/);
    assert.match(d, /Current Situation/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("catchUpDirective embeds the player's next action verbatim", () => {
  const dir = tempCampaign({ name: "Ted", race: "Human", class: "Wizard", level: 5 });
  try {
    const input = "I whisper the incantation and reach for the ledger on the desk.";
    const d = catchUpDirective(dir, "session-log/x.md", input);
    assert.ok(d.includes(input), "directive must contain the player's action");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("catchUpDirective is a mid-campaign resume, NOT a fresh opening", () => {
  const dir = tempCampaign({ name: "Ted", race: "Human", class: "Wizard", level: 5 });
  try {
    const d = catchUpDirective(dir, "session-log/x.md", "I look around.");
    // It must not read like the turn-zero opening cue (openingDirective's
    // signature phrasing). It legitimately says "do NOT write an opening scene",
    // so we don't forbid that phrase — only the opening's affirmative cues.
    assert.doesNotMatch(d, /Begin the campaign/i);
    assert.doesNotMatch(d, /very first moment of play/i);
    assert.doesNotMatch(d, /Write the\s+opening scene now/i);
    // It must signal continuity explicitly.
    assert.match(d, /already in progress/i);
    assert.match(d, /no interruption/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("catchUpDirective names the real character", () => {
  const dir = tempCampaign({ name: "Ted the Wizard", race: "Human", class: "Wizard", level: 5 });
  try {
    const d = catchUpDirective(dir, "session-log/x.md", "I look around.");
    assert.match(d, /Ted the Wizard/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
