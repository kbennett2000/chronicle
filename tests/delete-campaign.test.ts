import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  scaffoldCampaign,
  deleteCampaign,
  CAMPAIGNS_ROOT,
  CampaignProtectedError,
  CampaignNotFoundError,
} from "../src/campaign-store.js";

// Uses a throwaway id under the real CAMPAIGNS_ROOT (deleteCampaign only
// operates there) with a guaranteed-unique suffix so it never collides with a
// real campaign, and always cleans itself up.
function uniqueId(): string {
  return `zz-delete-test-${process.pid}-${process.hrtime.bigint()}`;
}

test("deleteCampaign removes a scaffolded campaign directory (#50)", () => {
  const id = uniqueId();
  const dir = scaffoldCampaign(id, { name: "Doomed", race: "Human", class: "Rogue", level: 1 });
  try {
    assert.ok(fs.existsSync(dir));
    deleteCampaign(id);
    assert.equal(fs.existsSync(dir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("deleteCampaign refuses the tracked test-campaign fixture", () => {
  assert.throws(() => deleteCampaign("test-campaign"), CampaignProtectedError);
  // And the fixture is still there (guard fired before any fs work).
  assert.ok(fs.existsSync(path.join(CAMPAIGNS_ROOT, "test-campaign")));
});

test("deleteCampaign on a non-existent id throws CampaignNotFoundError, not a silent success", () => {
  assert.throws(() => deleteCampaign(uniqueId()), CampaignNotFoundError);
});
