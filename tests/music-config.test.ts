import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { resolveMusicConfig } from "../src/music-store.js";
import { scaffoldCampaign, persistCampaignSettings, readCampaignSettings } from "../src/campaign-store.js";

// #109: per-game music override resolves campaign → user → .env, field by field,
// and the campaign override is stored with a nested (one-level-deep) merge so
// patching one field doesn't wipe the siblings.

test("resolveMusicConfig: a campaign override wins field-by-field over the user default", () => {
  const cfg = resolveMusicConfig(
    { source: "local", navidromePlaylist: "user-pl", enabled: true },
    { source: "navidrome", navidromePlaylist: "camp-pl" }
  );
  assert.equal(cfg.source, "navidrome"); // campaign wins
  assert.equal(cfg.navidrome.playlist, "camp-pl"); // campaign wins
  assert.equal(cfg.enabled, true); // campaign silent here → falls to user
});

test("resolveMusicConfig: unset campaign fields fall through to the user default", () => {
  const cfg = resolveMusicConfig(
    { navidromePlaylist: "user-pl", enabled: true },
    { source: "navidrome" }
  );
  assert.equal(cfg.source, "navidrome"); // from campaign
  assert.equal(cfg.navidrome.playlist, "user-pl"); // campaign unset → user
  assert.equal(cfg.enabled, true); // campaign unset → user
});

test("resolveMusicConfig: enabled=false at the campaign level overrides user enabled=true", () => {
  // Nullish coalescing (not ||) so a deliberate `false` isn't lost.
  const cfg = resolveMusicConfig({ enabled: true }, { enabled: false });
  assert.equal(cfg.enabled, false);
});

test("persistCampaignSettings: music override is stored and read back", () => {
  const id = `zz-music-${process.pid}-${process.hrtime.bigint()}`;
  const dir = scaffoldCampaign("zz-music-user", id, { name: "M", race: "Human", class: "Bard", level: 1 });
  try {
    persistCampaignSettings(dir, { music: { source: "navidrome", navidromePlaylist: "metal" } });
    const s = readCampaignSettings(dir);
    assert.equal(s.music?.source, "navidrome");
    assert.equal(s.music?.navidromePlaylist, "metal");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("persistCampaignSettings: patching one music field keeps its siblings (nested merge, #95 shape)", () => {
  const id = `zz-music-${process.pid}-${process.hrtime.bigint()}`;
  const dir = scaffoldCampaign("zz-music-user", id, { name: "M", race: "Human", class: "Bard", level: 1 });
  try {
    persistCampaignSettings(dir, { music: { source: "navidrome", navidromePlaylist: "metal" } });
    // Update only the playlist — source must survive.
    persistCampaignSettings(dir, { music: { navidromePlaylist: "jazz" } });
    const s = readCampaignSettings(dir);
    assert.equal(s.music?.source, "navidrome");
    assert.equal(s.music?.navidromePlaylist, "jazz");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("persistCampaignSettings: an empty-string music field clears that override back to absent", () => {
  const id = `zz-music-${process.pid}-${process.hrtime.bigint()}`;
  const dir = scaffoldCampaign("zz-music-user", id, { name: "M", race: "Human", class: "Bard", level: 1 });
  try {
    persistCampaignSettings(dir, { music: { source: "navidrome", navidromePlaylist: "metal" } });
    // Clear just the playlist → falls back to user/.env; source stays.
    persistCampaignSettings(dir, { music: { navidromePlaylist: "" } });
    const afterOne = readCampaignSettings(dir);
    assert.equal(afterOne.music?.source, "navidrome");
    assert.equal("navidromePlaylist" in (afterOne.music ?? {}), false);
    // Clearing the last remaining field drops the whole override.
    persistCampaignSettings(dir, { music: { source: "" as unknown as "navidrome" } });
    assert.equal("music" in readCampaignSettings(dir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("persistCampaignSettings: music=null resets the override (clears even a stored enabled=false)", () => {
  const id = `zz-music-${process.pid}-${process.hrtime.bigint()}`;
  const dir = scaffoldCampaign("zz-music-user", id, { name: "M", race: "Human", class: "Bard", level: 1 });
  try {
    // A boolean `enabled` can't be cleared via empty string — null is the reset.
    persistCampaignSettings(dir, { music: { enabled: false, source: "navidrome" } });
    assert.equal(readCampaignSettings(dir).music?.enabled, false);
    persistCampaignSettings(dir, { music: null });
    assert.equal("music" in readCampaignSettings(dir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
