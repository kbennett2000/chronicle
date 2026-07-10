import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { resolveVideoConfig, parseVideoBlock, DEFAULT_VIDEO } from "../src/video-store.js";
import { scaffoldCampaign, persistCampaignSettings, readCampaignSettings } from "../src/campaign-store.js";

// #118 / ADR-0033: per-game video params resolve campaign → user → config default
// → code default, field by field, and the campaign override is stored with a nested
// (one-level-deep) merge so patching one field doesn't wipe the siblings — exactly
// the music model. The config default is injectable so tests seed it directly.

test("resolveVideoConfig: falls back to code defaults when nothing is set", () => {
  const cfg = resolveVideoConfig();
  assert.deepEqual(cfg, DEFAULT_VIDEO);
  assert.equal(cfg.durationSeconds, 5);
  assert.equal(cfg.resolution, "480p");
  assert.equal(cfg.aspectRatio, "square");
});

test("resolveVideoConfig: a campaign override wins field-by-field over the user default", () => {
  const cfg = resolveVideoConfig(
    { durationSeconds: 10, resolution: "720p", aspectRatio: "16:9" },
    { durationSeconds: 6, resolution: "480p" }
  );
  assert.equal(cfg.durationSeconds, 6); // campaign wins
  assert.equal(cfg.resolution, "480p"); // campaign wins
  assert.equal(cfg.aspectRatio, "16:9"); // campaign silent → user
});

test("resolveVideoConfig: unset campaign fields fall through to the user default", () => {
  const cfg = resolveVideoConfig({ durationSeconds: 8, aspectRatio: "9:16" }, { resolution: "720p" });
  assert.equal(cfg.resolution, "720p"); // from campaign
  assert.equal(cfg.durationSeconds, 8); // campaign unset → user
  assert.equal(cfg.aspectRatio, "9:16"); // campaign unset → user
});

test("resolveVideoConfig: the config default fills fields neither level sets", () => {
  const configDefault = { videoDuration: 12, videoResolution: "720p", videoAspect: "9:16" };
  const cfg = resolveVideoConfig({}, {}, configDefault);
  assert.equal(cfg.durationSeconds, 12);
  assert.equal(cfg.resolution, "720p");
  assert.equal(cfg.aspectRatio, "9:16");
  // A user field still wins over the config default.
  assert.equal(resolveVideoConfig({ resolution: "480p" }, {}, configDefault).resolution, "480p");
});

test("resolveVideoConfig: malformed config-default values are ignored (fall to code default)", () => {
  const cfg = resolveVideoConfig({}, {}, {
    videoDuration: 999, // out of 1–15 range
    videoResolution: "1080p", // not an allowed value
    videoAspect: "square",
  });
  assert.equal(cfg.durationSeconds, DEFAULT_VIDEO.durationSeconds);
  assert.equal(cfg.resolution, DEFAULT_VIDEO.resolution);
});

test("parseVideoBlock: accepts valid fields and rejects bad ones", () => {
  assert.ok("value" in parseVideoBlock({ durationSeconds: 7, resolution: "720p", aspectRatio: "square" }));
  assert.ok("error" in parseVideoBlock({ durationSeconds: 0 }));
  assert.ok("error" in parseVideoBlock({ durationSeconds: 16 }));
  assert.ok("error" in parseVideoBlock({ durationSeconds: 5.5 }));
  assert.ok("error" in parseVideoBlock({ resolution: "1080p" }));
  assert.ok("error" in parseVideoBlock({ aspectRatio: "wide" }));
  assert.ok("error" in parseVideoBlock("nope"));
});

test("persistCampaignSettings: video override is stored and read back", () => {
  const id = `zz-video-${process.pid}-${process.hrtime.bigint()}`;
  const dir = scaffoldCampaign("zz-video-user", id, { name: "V", race: "Human", class: "Bard", level: 1 });
  try {
    persistCampaignSettings(dir, { video: { durationSeconds: 8, resolution: "720p" } });
    const s = readCampaignSettings(dir);
    assert.equal(s.video?.durationSeconds, 8);
    assert.equal(s.video?.resolution, "720p");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("persistCampaignSettings: patching one video field keeps its siblings (nested merge)", () => {
  const id = `zz-video-${process.pid}-${process.hrtime.bigint()}`;
  const dir = scaffoldCampaign("zz-video-user", id, { name: "V", race: "Human", class: "Bard", level: 1 });
  try {
    persistCampaignSettings(dir, { video: { durationSeconds: 8, resolution: "720p" } });
    persistCampaignSettings(dir, { video: { durationSeconds: 12 } }); // only duration
    const s = readCampaignSettings(dir);
    assert.equal(s.video?.durationSeconds, 12);
    assert.equal(s.video?.resolution, "720p"); // survives
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("persistCampaignSettings: video=null resets the override", () => {
  const id = `zz-video-${process.pid}-${process.hrtime.bigint()}`;
  const dir = scaffoldCampaign("zz-video-user", id, { name: "V", race: "Human", class: "Bard", level: 1 });
  try {
    persistCampaignSettings(dir, { video: { durationSeconds: 8 } });
    assert.equal(readCampaignSettings(dir).video?.durationSeconds, 8);
    persistCampaignSettings(dir, { video: null });
    assert.equal("video" in readCampaignSettings(dir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("readCampaignSettings: generateVideos boolean round-trips", () => {
  const id = `zz-video-${process.pid}-${process.hrtime.bigint()}`;
  const dir = scaffoldCampaign("zz-video-user", id, { name: "V", race: "Human", class: "Bard", level: 1 });
  try {
    persistCampaignSettings(dir, { generateVideos: true });
    assert.equal(readCampaignSettings(dir).generateVideos, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
