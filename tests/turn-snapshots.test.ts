import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  writePreTurnSnapshot,
  hasPreTurnSnapshot,
  restorePreTurnSnapshot,
  truncateTranscript,
  pruneSnapshotsAfter,
  appendTurnTranscript,
  readTurnTranscript,
} from "../src/campaign-store.js";

// Issue #68 (ADR-0016): the pre-turn snapshot/restore/truncate primitives that
// back editable history. Pure filesystem behavior — exercised without a model.

const SESSION_REL = "session-log/session-test.md";

function scratchCampaign(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chronicle-snap-"));
  fs.mkdirSync(path.join(dir, "session-log"), { recursive: true });
  fs.writeFileSync(path.join(dir, "character-sheet.json"), JSON.stringify({ name: "Kira", hp: { current: 10, max: 10 } }));
  fs.writeFileSync(path.join(dir, "world-state.md"), "## Current Situation\nAt the gate.\n");
  fs.writeFileSync(path.join(dir, "npc-roster.md"), "# NPC Roster\n");
  fs.writeFileSync(path.join(dir, "quest-log.md"), "# Quests\n");
  fs.writeFileSync(path.join(dir, SESSION_REL), "# Session test\n");
  return dir;
}

test("snapshot then restore rewinds the state files and prose log (#68)", () => {
  const dir = scratchCampaign();
  try {
    // Snapshot the pre-turn-0 world.
    writePreTurnSnapshot(dir, SESSION_REL, 0);
    assert.equal(hasPreTurnSnapshot(dir, SESSION_REL, 0), true);

    // The turn "runs": mutate every tracked file.
    fs.writeFileSync(path.join(dir, "character-sheet.json"), JSON.stringify({ name: "Kira", hp: { current: 3, max: 10 } }));
    fs.writeFileSync(path.join(dir, "world-state.md"), "## Current Situation\nBleeding in the pit.\n");
    fs.appendFileSync(path.join(dir, SESSION_REL), "Turn 0 happened.\n");

    restorePreTurnSnapshot(dir, SESSION_REL, 0);

    const sheet = JSON.parse(fs.readFileSync(path.join(dir, "character-sheet.json"), "utf8"));
    assert.equal(sheet.hp.current, 10, "HP rewound");
    assert.match(fs.readFileSync(path.join(dir, "world-state.md"), "utf8"), /At the gate/);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, SESSION_REL), "utf8"), /Turn 0 happened/, "prose log rewound");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("hasPreTurnSnapshot is false for a turn that was never snapshotted (#68)", () => {
  const dir = scratchCampaign();
  try {
    assert.equal(hasPreTurnSnapshot(dir, SESSION_REL, 3), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("restorePreTurnSnapshot throws when the snapshot is missing (#68)", () => {
  const dir = scratchCampaign();
  try {
    assert.throws(() => restorePreTurnSnapshot(dir, SESSION_REL, 7), /no pre-turn snapshot/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("truncateTranscript keeps only the first N records (#68)", () => {
  const dir = scratchCampaign();
  try {
    for (let i = 0; i < 5; i++) appendTurnTranscript(dir, SESSION_REL, `msg ${i}`, `narration ${i}`);
    assert.equal(readTurnTranscript(dir, SESSION_REL).length, 5);

    truncateTranscript(dir, SESSION_REL, 2);
    const kept = readTurnTranscript(dir, SESSION_REL);
    assert.equal(kept.length, 2);
    assert.deepEqual(kept.map((r) => r.turnIndex), [0, 1]);

    // A subsequent append lands at the truncated index (the re-run's slot).
    const next = appendTurnTranscript(dir, SESSION_REL, "edited", "new narration");
    assert.equal(next.turnIndex, 2);

    truncateTranscript(dir, SESSION_REL, 0);
    assert.equal(readTurnTranscript(dir, SESSION_REL).length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pruneSnapshotsAfter drops later snapshots but keeps the edited turn's (#68)", () => {
  const dir = scratchCampaign();
  try {
    for (let i = 0; i < 4; i++) writePreTurnSnapshot(dir, SESSION_REL, i);
    pruneSnapshotsAfter(dir, SESSION_REL, 1);
    assert.equal(hasPreTurnSnapshot(dir, SESSION_REL, 0), true);
    assert.equal(hasPreTurnSnapshot(dir, SESSION_REL, 1), true, "the edited turn's snapshot is kept");
    assert.equal(hasPreTurnSnapshot(dir, SESSION_REL, 2), false);
    assert.equal(hasPreTurnSnapshot(dir, SESSION_REL, 3), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
