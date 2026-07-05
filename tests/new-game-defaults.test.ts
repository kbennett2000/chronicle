import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  scaffoldCampaign,
  persistCampaignModel,
  persistCampaignSettings,
  newGameDefaultSettings,
} from "../src/campaign-store.js";

// Throwaway ids under the real CAMPAIGNS_ROOT with a guaranteed-unique suffix,
// always cleaned up. newGameDefaultSettings scans the whole root, so recency is
// pinned with fs.utimes to a far-future time to win deterministically over
// whatever real campaigns (test-campaign, etc.) happen to be present.
function uniqueId(suffix: string): string {
  return `zz-newgame-${suffix}-${process.pid}-${process.hrtime.bigint()}`;
}

function stampTranscript(campaignDir: string, whenMs: number): void {
  const file = path.join(campaignDir, "session-log", "session-test.transcript.jsonl");
  fs.writeFileSync(
    file,
    JSON.stringify({ turnIndex: 0, timestamp: new Date(whenMs).toISOString(), playerMessage: "", narration: "x" }) + "\n"
  );
  const when = whenMs / 1000;
  fs.utimesSync(file, when, when);
}

test("newGameDefaultSettings copies the most recently played campaign, minus worldSetting (#64)", () => {
  const older = uniqueId("older");
  const newer = uniqueId("newer");
  const olderDir = scaffoldCampaign(older, { name: "Older", race: "Human", class: "Rogue", level: 1 });
  const newerDir = scaffoldCampaign(newer, { name: "Newer", race: "Elf", class: "Wizard", level: 1 });
  try {
    persistCampaignModel(olderDir, "claude-sonnet-5");
    persistCampaignSettings(olderDir, { generateImages: false, autoRollDice: true });

    persistCampaignModel(newerDir, "claude-haiku-4-5");
    persistCampaignSettings(newerDir, {
      generateImages: true,
      artStyle: "Lego-style",
      autoIllustrateTurns: true,
      autoRollDice: false,
      contentIntensity: "low",
      toneWhimsy: 0.5,
      worldSetting: "in a cave with cats",
    });

    // Make `newer` unambiguously the most recent across the whole campaigns root.
    stampTranscript(olderDir, Date.parse("2000-01-01T00:00:00Z"));
    stampTranscript(newerDir, Date.parse("2099-01-01T00:00:00Z"));

    const defaults = newGameDefaultSettings();
    assert.equal(defaults.model, "claude-haiku-4-5");
    assert.equal(defaults.generateImages, true);
    assert.equal(defaults.artStyle, "Lego-style");
    assert.equal(defaults.autoIllustrateTurns, true);
    assert.equal(defaults.autoRollDice, false);
    assert.equal(defaults.contentIntensity, "low");
    assert.equal(defaults.toneWhimsy, 0.5);
    // worldSetting is the premise of each specific game — never inherited.
    assert.equal("worldSetting" in defaults, false);
  } finally {
    fs.rmSync(olderDir, { recursive: true, force: true });
    fs.rmSync(newerDir, { recursive: true, force: true });
  }
});
