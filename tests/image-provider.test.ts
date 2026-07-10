import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  getImageBackend,
  resolveImageProvider,
  resolveImageProviderForCampaign,
} from "../src/image-backends/index.js";
import type { ImageProvider } from "../src/image-backends/types.js";
import {
  scaffoldCampaign,
  persistCampaignSettings,
  readCampaignSettings,
  campaignDirUserId,
  CAMPAIGNS_ROOT,
} from "../src/campaign-store.js";
import { writeUserSettings, USERS_ROOT } from "../src/user-store.js";

// ADR-0027/0033: image provider resolves campaign → user → config default
// (config.defaults.imageProvider, injectable here) → code default "grok", mirroring
// resolveMusicConfig / resolveVideoConfig, and the owning user is recovered from the
// campaigns/<userId>/<id> nesting at the seam.

test("resolveImageProvider: a campaign override wins over the user default", () => {
  assert.equal(resolveImageProvider("grok", "local"), "local");
  assert.equal(resolveImageProvider("local", "grok"), "grok");
});

test("resolveImageProvider: an unset campaign value falls through to the user default", () => {
  assert.equal(resolveImageProvider("local", undefined), "local");
});

test("resolveImageProvider: both unset → the config default", () => {
  assert.equal(resolveImageProvider(undefined, undefined, "local"), "local");
});

test("resolveImageProvider: nothing valid anywhere → code default 'grok'", () => {
  // An invalid config default falls through to the ultimate code fallback.
  assert.equal(resolveImageProvider(undefined, undefined, "nonsense"), "grok");
});

test("resolveImageProvider: an invalid campaign/user/config value is ignored", () => {
  // invalid campaign → invalid user → invalid config default → "grok"
  assert.equal(resolveImageProvider("bogus", "garbage", "nonsense"), "grok");
  // invalid campaign & user are skipped, but a valid config default wins
  assert.equal(resolveImageProvider("bogus", "garbage", "local"), "local");
});

test("getImageBackend: returns the grok backend for 'grok', and falls back to grok for an unknown provider", () => {
  assert.equal(getImageBackend("grok").provider, "grok");
  // A provider not in the registry (e.g. a stale/typo'd value) must never leave a
  // campaign unable to illustrate — it falls back to grok.
  assert.equal(getImageBackend("bogus" as ImageProvider).provider, "grok");
});

test("campaignDirUserId: derives the owning user from campaigns/<userId>/<id>, undefined out of tree", () => {
  assert.equal(campaignDirUserId(path.join(CAMPAIGNS_ROOT, "alice", "my-game")), "alice");
  // A stray temp dir not nested under a user dir → undefined (→ env/code default).
  assert.equal(campaignDirUserId("/tmp/some/where"), undefined);
  // Directly under CAMPAIGNS_ROOT (no user segment) → undefined.
  assert.equal(campaignDirUserId(path.join(CAMPAIGNS_ROOT, "just-one-level")), undefined);
});

test("resolveImageProviderForCampaign: a per-game override wins end-to-end", () => {
  const userId = `zz-imgprov-${process.pid}`;
  const id = `zz-imgprov-camp-${process.hrtime.bigint()}`;
  const dir = scaffoldCampaign(userId, id, { name: "I", race: "Human", class: "Wizard", level: 1 });
  try {
    persistCampaignSettings(dir, { imageProvider: "local" });
    assert.equal(resolveImageProviderForCampaign(dir, readCampaignSettings(dir)), "local");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveImageProviderForCampaign: no game override → the account default (read from the nested user)", () => {
  const userId = `zz-imgprov-${process.pid}-${process.hrtime.bigint()}`;
  const id = "zz-imgprov-camp";
  const dir = scaffoldCampaign(userId, id, { name: "I", race: "Human", class: "Wizard", level: 1 });
  try {
    writeUserSettings(userId, { imageProvider: "local" });
    // Campaign has no imageProvider → falls to the user's account default.
    assert.equal(resolveImageProviderForCampaign(dir, readCampaignSettings(dir)), "local");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(path.join(USERS_ROOT, userId), { recursive: true, force: true });
  }
});

test("persistCampaignSettings: imageProvider is stored, read back, and null resets to account default", () => {
  const userId = "zz-imgprov-persist-user";
  const id = `zz-imgprov-persist-${process.hrtime.bigint()}`;
  const dir = scaffoldCampaign(userId, id, { name: "I", race: "Human", class: "Wizard", level: 1 });
  try {
    persistCampaignSettings(dir, { imageProvider: "local" });
    assert.equal(readCampaignSettings(dir).imageProvider, "local");
    // null drops the per-game override so the game tracks the account default again.
    persistCampaignSettings(dir, { imageProvider: null });
    assert.equal("imageProvider" in readCampaignSettings(dir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
