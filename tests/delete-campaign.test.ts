import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  scaffoldCampaign,
  deleteCampaign,
  CampaignProtectedError,
  CampaignNotFoundError,
} from "../src/campaign-store.js";

// ADR-0019: campaigns nest under a user dir now. Tests use a throwaway user +
// id under the real CAMPAIGNS_ROOT with a guaranteed-unique suffix so they
// never collide with a real campaign, and always clean up.
const TEST_USER = "zz-delete-test-user";
function uniqueId(): string {
  return `zz-delete-test-${process.pid}-${process.hrtime.bigint()}`;
}

test("deleteCampaign removes a scaffolded campaign directory (#50)", () => {
  const id = uniqueId();
  const dir = scaffoldCampaign(TEST_USER, id, { name: "Doomed", race: "Human", class: "Rogue", level: 1 });
  try {
    assert.ok(fs.existsSync(dir));
    deleteCampaign(TEST_USER, id);
    assert.equal(fs.existsSync(dir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("deleteCampaign refuses the tracked test-campaign fixture", () => {
  // The protected-id guard fires on the campaign id before any fs work, so the
  // fixture is untouched wherever it lives (post-migration: campaigns/kris/).
  assert.throws(() => deleteCampaign(TEST_USER, "test-campaign"), CampaignProtectedError);
});

test("deleteCampaign on a non-existent id throws CampaignNotFoundError, not a silent success", () => {
  assert.throws(() => deleteCampaign(TEST_USER, uniqueId()), CampaignNotFoundError);
});
