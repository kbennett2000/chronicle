import { test } from "node:test";
import assert from "node:assert/strict";
import {
  withNpcPortrait,
  withNpcPortraitVideo,
  withLocationImage,
  withLocationVideo,
} from "../src/campaign-store.js";
import { buildVideoPrompt } from "../src/video-generator.js";
import { DEFAULT_VIDEO } from "../src/video-store.js";
import type { CampaignSettings } from "../src/campaign-store.js";

const SETTINGS: CampaignSettings = { model: "claude-sonnet-5", provider: "claude" };

// #118: the video state-file writers use DISTINCT field labels from the still
// writers, so a clip is recorded alongside — never replacing — the portrait.

test("withNpcPortraitVideo writes a distinct bullet and coexists with the still", () => {
  let roster = `# NPC Roster\n\n## Garrick\n- **Description:** Stout gate guard.\n`;
  roster = withNpcPortrait(roster, "Garrick", "images/npc-garrick.jpg");
  roster = withNpcPortraitVideo(roster, "Garrick", "videos/npc-garrick.mp4");
  assert.ok(roster.includes("- **Portrait asset ID:** images/npc-garrick.jpg"));
  assert.ok(roster.includes("- **Portrait video ID:** videos/npc-garrick.mp4"));
});

test("withNpcPortraitVideo replaces an existing clip rather than duplicating", () => {
  let roster = `# NPC Roster\n\n## Garrick\n- **Portrait video ID:** videos/old.mp4\n`;
  roster = withNpcPortraitVideo(roster, "Garrick", "videos/npc-garrick.mp4");
  const count = roster.split("\n").filter((l) => l.includes("Portrait video ID")).length;
  assert.equal(count, 1);
  assert.ok(!roster.includes("videos/old.mp4"));
});

test("withLocationVideo writes a Video line that coexists with the Image line", () => {
  let world = `# World State\n\n## Locations Visited\n- **Old watchtower** — abandoned.\n`;
  world = withLocationImage(world, "Old watchtower", "images/location-old-watchtower.jpg");
  world = withLocationVideo(world, "Old watchtower", "videos/location-old-watchtower.mp4");
  assert.ok(/^\s+- Image: images\/location-old-watchtower\.jpg$/m.test(world));
  assert.ok(/^\s+- Video: videos\/location-old-watchtower\.mp4$/m.test(world));
});

test("buildVideoPrompt appends the resolved parameter clause", () => {
  const prompt = buildVideoPrompt("a knight on a cliff", SETTINGS, DEFAULT_VIDEO);
  assert.ok(prompt.includes("a knight on a cliff"));
  assert.ok(prompt.includes("5 second video, 480p resolution, square aspect ratio"));
});

test("buildVideoPrompt prepends the base image filename for the animate path", () => {
  const prompt = buildVideoPrompt("slow pan, coat in the wind", SETTINGS, DEFAULT_VIDEO, "base.jpg");
  assert.ok(prompt.startsWith("base.jpg "), "base image leads the prompt");
  assert.ok(prompt.includes("5 second video"));
});

test("buildVideoPrompt honors the art style and non-default params", () => {
  const prompt = buildVideoPrompt("a tavern", { ...SETTINGS, artStyle: "oil painting" }, {
    durationSeconds: 10,
    resolution: "720p",
    aspectRatio: "16:9",
  });
  assert.ok(prompt.startsWith("oil painting."), "art style leads (image-prompt behavior)");
  assert.ok(prompt.includes("10 second video, 720p resolution, 16:9 aspect ratio"));
});
