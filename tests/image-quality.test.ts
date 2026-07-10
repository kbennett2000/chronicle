import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  resolveImageQuality,
  resolveImageQualityForCampaign,
} from "../src/image-backends/index.js";
import { isValidImageQuality } from "../src/image-backends/types.js";
import {
  scaffoldCampaign,
  persistCampaignSettings,
  readCampaignSettings,
} from "../src/campaign-store.js";
import { writeUserSettings, USERS_ROOT } from "../src/user-store.js";

// ADR-0029/0033: the local quality tier resolves campaign → user → config default
// (config.defaults.imageQuality, injectable here) → code default "standard", mirroring
// resolveImageProvider. Code default "standard" keeps every existing game/account
// byte-identical to pre-0029.

test("isValidImageQuality: accepts only the three tiers", () => {
  for (const good of ["fast", "standard", "high"]) assert.equal(isValidImageQuality(good), true);
  for (const bad of ["ultra", "", "STANDARD", undefined, null, 5]) {
    assert.equal(isValidImageQuality(bad), false);
  }
});

test("resolveImageQuality: a campaign override wins over the user default", () => {
  assert.equal(resolveImageQuality("standard", "high"), "high");
  assert.equal(resolveImageQuality("high", "fast"), "fast");
});

test("resolveImageQuality: an unset campaign value falls through to the user default", () => {
  assert.equal(resolveImageQuality("high", undefined), "high");
});

test("resolveImageQuality: both unset → the config default", () => {
  assert.equal(resolveImageQuality(undefined, undefined, "fast"), "fast");
});

test("resolveImageQuality: nothing valid anywhere → code default 'standard'", () => {
  // An invalid config default falls through to the ultimate code fallback.
  assert.equal(resolveImageQuality(undefined, undefined, "nonsense"), "standard");
});

test("resolveImageQuality: an invalid campaign/user/config value is ignored", () => {
  // invalid campaign → invalid user → invalid config default → "standard"
  assert.equal(resolveImageQuality("bogus", "garbage", "nonsense"), "standard");
  // invalid campaign & user are skipped, but a valid config default wins
  assert.equal(resolveImageQuality("bogus", "garbage", "high"), "high");
});

test("resolveImageQualityForCampaign: a per-game override wins end-to-end", () => {
  const userId = `zz-imgqual-${process.pid}`;
  const id = `zz-imgqual-camp-${process.hrtime.bigint()}`;
  const dir = scaffoldCampaign(userId, id, { name: "I", race: "Human", class: "Wizard", level: 1 });
  try {
    persistCampaignSettings(dir, { imageQuality: "high" });
    assert.equal(resolveImageQualityForCampaign(dir, readCampaignSettings(dir)), "high");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveImageQualityForCampaign: no game override → the account default (read from the nested user)", () => {
  const userId = `zz-imgqual-${process.pid}-${process.hrtime.bigint()}`;
  const id = "zz-imgqual-camp";
  const dir = scaffoldCampaign(userId, id, { name: "I", race: "Human", class: "Wizard", level: 1 });
  try {
    writeUserSettings(userId, { imageQuality: "fast" });
    // Campaign has no imageQuality → falls to the user's account default.
    assert.equal(resolveImageQualityForCampaign(dir, readCampaignSettings(dir)), "fast");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(path.join(USERS_ROOT, userId), { recursive: true, force: true });
  }
});

test("persistCampaignSettings: imageQuality is stored, read back, and null resets to account default", () => {
  const userId = "zz-imgqual-persist-user";
  const id = `zz-imgqual-persist-${process.hrtime.bigint()}`;
  const dir = scaffoldCampaign(userId, id, { name: "I", race: "Human", class: "Wizard", level: 1 });
  try {
    persistCampaignSettings(dir, { imageQuality: "high" });
    assert.equal(readCampaignSettings(dir).imageQuality, "high");
    // null drops the per-game override so the game tracks the account default again.
    persistCampaignSettings(dir, { imageQuality: null });
    assert.equal("imageQuality" in readCampaignSettings(dir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
