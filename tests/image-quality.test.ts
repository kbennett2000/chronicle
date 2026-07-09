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

// ADR-0029: the local quality tier resolves campaign → user → .env
// (DEFAULT_IMAGE_QUALITY) → code default "standard", mirroring resolveImageProvider.
// Code default "standard" keeps every existing game/account byte-identical to pre-0029.

/** Run `fn` with DEFAULT_IMAGE_QUALITY set to `val` (or unset), restoring after so
 * env-dependent assertions don't leak into other tests. */
function withEnv(val: string | undefined, fn: () => void): void {
  const prev = process.env.DEFAULT_IMAGE_QUALITY;
  if (val === undefined) delete process.env.DEFAULT_IMAGE_QUALITY;
  else process.env.DEFAULT_IMAGE_QUALITY = val;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.DEFAULT_IMAGE_QUALITY;
    else process.env.DEFAULT_IMAGE_QUALITY = prev;
  }
}

test("isValidImageQuality: accepts only the three tiers", () => {
  for (const good of ["fast", "standard", "high"]) assert.equal(isValidImageQuality(good), true);
  for (const bad of ["ultra", "", "STANDARD", undefined, null, 5]) {
    assert.equal(isValidImageQuality(bad), false);
  }
});

test("resolveImageQuality: a campaign override wins over the user default", () => {
  withEnv(undefined, () => {
    assert.equal(resolveImageQuality("standard", "high"), "high");
    assert.equal(resolveImageQuality("high", "fast"), "fast");
  });
});

test("resolveImageQuality: an unset campaign value falls through to the user default", () => {
  withEnv(undefined, () => {
    assert.equal(resolveImageQuality("high", undefined), "high");
  });
});

test("resolveImageQuality: both unset → .env DEFAULT_IMAGE_QUALITY", () => {
  withEnv("fast", () => {
    assert.equal(resolveImageQuality(undefined, undefined), "fast");
  });
});

test("resolveImageQuality: nothing set anywhere → code default 'standard'", () => {
  withEnv(undefined, () => {
    assert.equal(resolveImageQuality(undefined, undefined), "standard");
  });
});

test("resolveImageQuality: an invalid campaign/user/env value is ignored", () => {
  withEnv("nonsense", () => {
    // invalid campaign → invalid user → invalid env → "standard"
    assert.equal(resolveImageQuality("bogus", "garbage"), "standard");
  });
  withEnv("high", () => {
    // invalid campaign & user are skipped, but valid env wins
    assert.equal(resolveImageQuality("bogus", "garbage"), "high");
  });
});

test("resolveImageQualityForCampaign: a per-game override wins end-to-end", () => {
  const userId = `zz-imgqual-${process.pid}`;
  const id = `zz-imgqual-camp-${process.hrtime.bigint()}`;
  const dir = scaffoldCampaign(userId, id, { name: "I", race: "Human", class: "Wizard", level: 1 });
  try {
    withEnv(undefined, () => {
      persistCampaignSettings(dir, { imageQuality: "high" });
      assert.equal(resolveImageQualityForCampaign(dir, readCampaignSettings(dir)), "high");
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveImageQualityForCampaign: no game override → the account default (read from the nested user)", () => {
  const userId = `zz-imgqual-${process.pid}-${process.hrtime.bigint()}`;
  const id = "zz-imgqual-camp";
  const dir = scaffoldCampaign(userId, id, { name: "I", race: "Human", class: "Wizard", level: 1 });
  try {
    withEnv(undefined, () => {
      writeUserSettings(userId, { imageQuality: "fast" });
      // Campaign has no imageQuality → falls to the user's account default.
      assert.equal(resolveImageQualityForCampaign(dir, readCampaignSettings(dir)), "fast");
    });
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
