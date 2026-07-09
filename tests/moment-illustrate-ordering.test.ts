import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  startSessionLog,
  appendTurnTranscript,
  readTurnTranscript,
  setTranscriptRecordSceneCaption,
} from "../src/campaign-store.js";
import { resolveMomentDescription } from "../src/narration.js";

// Issue #142: the fresh-turn auto-illustrate seam (`/illustrate` moment) draws
// from `record.sceneCaption` when present and falls back to `narration` when it
// isn't. On a turn where the DM omitted [SCENE:], the caption is written by the
// after-response backfill; the seam waits for it (via `active.settling`) and
// RE-READS the record before resolving. These tests pin the exact persist →
// re-read → resolve chain that fix relies on, using the real campaign-store
// functions the server calls — no model, no network, no GPU.

/** A minimal on-disk campaign (not scaffoldCampaign, which writes under the real
 * CAMPAIGNS_ROOT). The transcript primitives are pure filesystem, so a temp dir
 * exercises them without touching campaigns/. Mirrors opening-scene.test.ts. */
function tempCampaign(): { dir: string; sessionLog: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chronicle-illustrate-order-"));
  fs.mkdirSync(path.join(dir, "session-log"));
  const sessionLog = startSessionLog(dir);
  return { dir, sessionLog };
}

const NARRATION =
  "You wade into the flooded crypt; the lantern gutters and black water laps at carved pillars.";
const CAPTION =
  "a lone adventurer wading knee-deep through a flooded stone crypt, lantern light on black water";

test("omitted-caption turn: BEFORE the backfill, the moment seam resolves to narration", () => {
  const { dir, sessionLog } = tempCampaign();
  try {
    // The DM omitted [SCENE:] → the record is persisted captionless (as /turns,
    // /opening, and edit re-run all do via extractMomentTags → appendTurnTranscript).
    const record = appendTurnTranscript(dir, sessionLog, "I enter the crypt.", NARRATION);
    assert.equal(record.sceneCaption, undefined, "the turn is persisted without a caption");

    // This is exactly the stale read the pre-fix auto-illustrate raced into:
    // the seam finds no caption and falls back to the raw prose slab.
    const reread = readTurnTranscript(dir, sessionLog).find((r) => r.turnIndex === 0)!;
    assert.equal(resolveMomentDescription("", reread), NARRATION);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("after the backfill patches the record, re-reading yields the CAPTION, not narration", () => {
  const { dir, sessionLog } = tempCampaign();
  try {
    appendTurnTranscript(dir, sessionLog, "I enter the crypt.", NARRATION);

    // The after-response backfill (retrySceneCaption → setTranscriptRecordSceneCaption)
    // patches the on-disk record. This is what `await active.settling` waits for.
    setTranscriptRecordSceneCaption(dir, sessionLog, 0, CAPTION);

    // The fix RE-READS the record after settling. The freshly-stored caption now
    // wins over narration — the image is drawn from the caption, as intended.
    const reread = readTurnTranscript(dir, sessionLog).find((r) => r.turnIndex === 0)!;
    assert.equal(reread.sceneCaption, CAPTION, "the backfill is persisted before the re-read");
    assert.equal(resolveMomentDescription("", reread), CAPTION);
    assert.notEqual(resolveMomentDescription("", reread), NARRATION);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("inline [SCENE:] turn: the caption is on the record immediately — no backfill needed", () => {
  const { dir, sessionLog } = tempCampaign();
  try {
    // When the DM emits [SCENE:] inline, appendTurnTranscript stores it up front;
    // the moment seam resolves to the caption with no settling wait at all.
    appendTurnTranscript(dir, sessionLog, "I enter the crypt.", NARRATION, CAPTION);
    const reread = readTurnTranscript(dir, sessionLog).find((r) => r.turnIndex === 0)!;
    assert.equal(reread.sceneCaption, CAPTION);
    assert.equal(resolveMomentDescription("", reread), CAPTION);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an explicit refine override still wins over a stored caption (regenerate path)", () => {
  const { dir, sessionLog } = tempCampaign();
  try {
    appendTurnTranscript(dir, sessionLog, "I enter the crypt.", NARRATION, CAPTION);
    const reread = readTurnTranscript(dir, sessionLog).find((r) => r.turnIndex === 0)!;
    // Issue #66: a manual regenerate passes a description override, which the
    // seam honors ahead of the cached caption — the fix's "no override" guard
    // must not disturb this.
    assert.equal(resolveMomentDescription("the same crypt, but at night", reread), "the same crypt, but at night");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
