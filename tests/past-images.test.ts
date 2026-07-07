import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { listCampaignImages, CAMPAIGNS_ROOT } from "../src/campaign-store.js";

// ADR-0019: campaigns nest under a user dir. Use a throwaway user under the real
// CAMPAIGNS_ROOT with a unique suffix so we never collide with a real campaign,
// and always clean up.
const TEST_USER = `zz-past-images-${process.pid}`;
const userRoot = path.join(CAMPAIGNS_ROOT, TEST_USER);

function makeCampaign(id: string, imageFiles: string[]): void {
  const imagesDir = path.join(userRoot, id, "images");
  fs.mkdirSync(imagesDir, { recursive: true });
  for (const f of imageFiles) fs.writeFileSync(path.join(imagesDir, f), "x");
}

test("listCampaignImages collects every image across the user's campaigns (#105)", () => {
  try {
    makeCampaign("alpha", ["character-hero.jpg", "scene-1.png", "notes.txt"]);
    makeCampaign("beta", ["npc-garrick.webp"]);
    makeCampaign("gamma", []); // has an images/ dir but nothing in it
    fs.mkdirSync(path.join(userRoot, "delta"), { recursive: true }); // no images/ dir at all

    const all = listCampaignImages(TEST_USER);
    // Non-image files are ignored; empty/imageless campaigns contribute nothing.
    assert.deepEqual(
      all.map((r) => `${r.campaignId}/${r.filename}`).sort(),
      ["alpha/character-hero.jpg", "alpha/scene-1.png", "beta/npc-garrick.webp"]
    );

    // exclude drops one campaign (e.g. the game being started).
    const excluded = listCampaignImages(TEST_USER, "alpha");
    assert.deepEqual(
      excluded.map((r) => r.campaignId).sort(),
      ["beta"]
    );
  } finally {
    fs.rmSync(userRoot, { recursive: true, force: true });
  }
});

test("listCampaignImages returns [] for a user with no campaigns dir (#105)", () => {
  assert.deepEqual(listCampaignImages(`zz-nonexistent-${process.pid}`), []);
});
