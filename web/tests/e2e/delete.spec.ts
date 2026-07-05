import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect } from "./harness";
import { seedConnection } from "./connection";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

const SCORES = {
  strength: 10,
  dexterity: 10,
  constitution: 10,
  intelligence: 10,
  wisdom: 10,
  charisma: 10,
};

test.describe("Delete a chronicle (issue #50)", () => {
  test("deletes another chronicle from Home via the trash icon + confirm", async ({
    page,
    chronicleServer,
  }) => {
    const headers = { "X-Chronicle-Token": chronicleServer.token };
    let createdId: string | null = null;
    const uniqueName = `Deletable ${Date.now()}`;
    try {
      // A second campaign, created straight through the API so the active
      // harness campaign stays active (and is left for the harness to clean).
      const createRes = await page.request.post(`${chronicleServer.baseURL}/campaigns`, {
        headers,
        data: { character: { name: uniqueName, race: "Human", class: "Rogue", abilityScores: SCORES } },
      });
      expect(createRes.status()).toBe(201);
      createdId = (await createRes.json()).campaignId;
      expect(fs.existsSync(path.join(REPO_ROOT, "campaigns", createdId!))).toBe(true);

      await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
      await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
      await expect(page.getByTestId("campaign-card")).toBeVisible();

      // It shows up under OTHER CHRONICLES; delete it via its own trash button.
      const trash = page.getByLabel(`Delete ${uniqueName}`);
      await expect(trash).toBeVisible();
      await trash.click();

      await expect(page.getByTestId("delete-confirm")).toBeVisible();
      await page.getByTestId("delete-confirm-button").click();

      // Row disappears and the directory is really gone.
      await expect(page.getByLabel(`Delete ${uniqueName}`)).toHaveCount(0);
      await expect
        .poll(() => fs.existsSync(path.join(REPO_ROOT, "campaigns", createdId!)))
        .toBe(false);
      createdId = null;
    } finally {
      if (createdId) fs.rmSync(path.join(REPO_ROOT, "campaigns", createdId), { recursive: true, force: true });
    }
  });

  test("refuses to delete the tracked test-campaign fixture (403)", async ({ page, chronicleServer }) => {
    const res = await page.request.delete(`${chronicleServer.baseURL}/campaigns/test-campaign`, {
      headers: { "X-Chronicle-Token": chronicleServer.token },
    });
    expect(res.status()).toBe(403);
    // And it's still on disk, untouched.
    expect(fs.existsSync(path.join(REPO_ROOT, "campaigns", "test-campaign"))).toBe(true);
  });
});
