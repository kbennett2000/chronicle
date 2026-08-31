import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  shouldAutoRotate,
  readCampaignSettings,
  persistCampaignSettings,
  DEFAULT_AUTO_ROTATE_TURNS,
} from "../src/campaign-store.js";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "chronicle-autorotate-"));
}

// --- shouldAutoRotate: the pure rotation-trigger arithmetic (#184 / ADR-0040) ---

test("default-ON: rotates at every multiple of the default interval (5)", () => {
  // Absent autoRotateSession === ON; absent autoRotateTurns === DEFAULT (5).
  for (const n of [5, 10, 15, 100]) {
    assert.equal(shouldAutoRotate(n, {}), true, `should rotate at turn ${n}`);
  }
  for (const n of [1, 2, 3, 4, 6, 9, 11]) {
    assert.equal(shouldAutoRotate(n, {}), false, `should NOT rotate at turn ${n}`);
  }
});

test("never rotates at turn 0 (nothing to catch up on)", () => {
  assert.equal(shouldAutoRotate(0, {}), false);
  assert.equal(shouldAutoRotate(0, { autoRotateTurns: 1 }), false);
});

test("explicit false disables rotation entirely", () => {
  for (const n of [5, 10, 25]) {
    assert.equal(shouldAutoRotate(n, { autoRotateSession: false }), false);
  }
});

test("respects a custom interval", () => {
  assert.equal(shouldAutoRotate(3, { autoRotateTurns: 3 }), true);
  assert.equal(shouldAutoRotate(6, { autoRotateTurns: 3 }), true);
  assert.equal(shouldAutoRotate(4, { autoRotateTurns: 3 }), false);
  // interval of 1 rotates every turn (except turn 0).
  assert.equal(shouldAutoRotate(1, { autoRotateTurns: 1 }), true);
  assert.equal(shouldAutoRotate(2, { autoRotateTurns: 1 }), true);
});

test("invalid/out-of-range interval falls back to the default", () => {
  // < 1, non-finite, or fractional values are ignored → DEFAULT_AUTO_ROTATE_TURNS.
  assert.equal(DEFAULT_AUTO_ROTATE_TURNS, 5);
  assert.equal(shouldAutoRotate(5, { autoRotateTurns: 0 }), true);
  assert.equal(shouldAutoRotate(5, { autoRotateTurns: -3 }), true);
  assert.equal(shouldAutoRotate(5, { autoRotateTurns: Number.NaN }), true);
  assert.equal(shouldAutoRotate(4, { autoRotateTurns: 0 }), false);
  // fractional interval floors: 2.9 → 2.
  assert.equal(shouldAutoRotate(2, { autoRotateTurns: 2.9 }), true);
});

// --- settings round-trip: the two new fields persist & read back (#184) ---

test("autoRotateSession / autoRotateTurns round-trip through settings file", () => {
  const dir = tempDir();
  try {
    // Absent by default (consumers treat absent as ON / default interval).
    const fresh = readCampaignSettings(dir);
    assert.equal(fresh.autoRotateSession, undefined);
    assert.equal(fresh.autoRotateTurns, undefined);

    persistCampaignSettings(dir, { autoRotateSession: false, autoRotateTurns: 8 });
    const read = readCampaignSettings(dir);
    assert.equal(read.autoRotateSession, false);
    assert.equal(read.autoRotateTurns, 8);

    // Re-enable and change interval; merge-write must not clobber it.
    persistCampaignSettings(dir, { autoRotateSession: true, autoRotateTurns: 3 });
    const read2 = readCampaignSettings(dir);
    assert.equal(read2.autoRotateSession, true);
    assert.equal(read2.autoRotateTurns, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid stored autoRotateTurns is dropped on read (falls through to default)", () => {
  const dir = tempDir();
  try {
    // Write a raw settings file with a bad interval directly.
    fs.writeFileSync(
      path.join(dir, "campaign-settings.json"),
      JSON.stringify({ autoRotateTurns: 0, autoRotateSession: true })
    );
    const read = readCampaignSettings(dir);
    assert.equal(read.autoRotateTurns, undefined, "bad interval not attached");
    assert.equal(read.autoRotateSession, true);
    // With the interval absent, shouldAutoRotate uses the default (5).
    assert.equal(shouldAutoRotate(5, read), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
