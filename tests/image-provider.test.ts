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

// ADR-0027: image provider resolves campaign → user → .env (DEFAULT_IMAGE_PROVIDER)
// → code default "grok", mirroring resolveMusicConfig / resolveVideoConfig, and the
// owning user is recovered from the campaigns/<userId>/<id> nesting at the seam.

/** Run `fn` with DEFAULT_IMAGE_PROVIDER set to `val` (or unset), restoring after,
 * so env-dependent assertions don't leak into other tests. */
function withEnv(val: string | undefined, fn: () => void): void {
  const prev = process.env.DEFAULT_IMAGE_PROVIDER;
  if (val === undefined) delete process.env.DEFAULT_IMAGE_PROVIDER;
  else process.env.DEFAULT_IMAGE_PROVIDER = val;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.DEFAULT_IMAGE_PROVIDER;
    else process.env.DEFAULT_IMAGE_PROVIDER = prev;
  }
}

test("resolveImageProvider: a campaign override wins over the user default", () => {
  withEnv(undefined, () => {
    assert.equal(resolveImageProvider("grok", "local"), "local");
    assert.equal(resolveImageProvider("local", "grok"), "grok");
  });
});

test("resolveImageProvider: an unset campaign value falls through to the user default", () => {
  withEnv(undefined, () => {
    assert.equal(resolveImageProvider("local", undefined), "local");
  });
});

test("resolveImageProvider: both unset → .env DEFAULT_IMAGE_PROVIDER", () => {
  withEnv("local", () => {
    assert.equal(resolveImageProvider(undefined, undefined), "local");
  });
});

test("resolveImageProvider: nothing set anywhere → code default 'grok'", () => {
  withEnv(undefined, () => {
    assert.equal(resolveImageProvider(undefined, undefined), "grok");
  });
});

test("resolveImageProvider: an invalid campaign/user/env value is ignored", () => {
  withEnv("nonsense", () => {
    // invalid campaign → invalid user → invalid env → "grok"
    assert.equal(resolveImageProvider("bogus", "garbage"), "grok");
  });
  withEnv("local", () => {
    // invalid campaign & user are skipped, but valid env wins
    assert.equal(resolveImageProvider("bogus", "garbage"), "local");
  });
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
    withEnv(undefined, () => {
      persistCampaignSettings(dir, { imageProvider: "local" });
      assert.equal(resolveImageProviderForCampaign(dir, readCampaignSettings(dir)), "local");
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveImageProviderForCampaign: no game override → the account default (read from the nested user)", () => {
  const userId = `zz-imgprov-${process.pid}-${process.hrtime.bigint()}`;
  const id = "zz-imgprov-camp";
  const dir = scaffoldCampaign(userId, id, { name: "I", race: "Human", class: "Wizard", level: 1 });
  try {
    withEnv(undefined, () => {
      writeUserSettings(userId, { imageProvider: "local" });
      // Campaign has no imageProvider → falls to the user's account default.
      assert.equal(resolveImageProviderForCampaign(dir, readCampaignSettings(dir)), "local");
    });
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
