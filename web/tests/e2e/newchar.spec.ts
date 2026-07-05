import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect } from "./harness";
import { seedConnection } from "./connection";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

test.describe("New character / new campaign (issue #36)", () => {
  test("Begin a New Chronicle creates a campaign from a character and enters Play", async ({
    page,
    chronicleServer,
  }) => {
    // The character-creation POST creates a real campaign dir the harness's
    // scratch cleanup won't know about — capture its id and remove it here.
    let createdId: string | null = null;
    page.on("response", async (res) => {
      if (res.request().method() === "POST" && res.url().endsWith("/campaigns") && res.status() === 201) {
        createdId = (await res.json()).campaignId;
      }
    });

    try {
      await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
      await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
      await expect(page.getByTestId("campaign-card")).toBeVisible();

      await page.getByTestId("new-chronicle").click();
      await expect(page.getByText("NEW CHRONICLE")).toBeVisible();

      await page.getByTestId("newchar-name").fill("E2E Newchar Fixture");
      await page.getByTestId("newchar-race").selectOption("Elf");
      await page.getByTestId("newchar-class").selectOption("Wizard");

      // Point-buy: start at 8s (27 points). Spend some on DEX and CON and
      // watch the derived stats update. Wizard d6 + CON mod; AC 10 + DEX mod.
      await page.getByTestId("newchar-dexterity-inc").click(); // 8 -> 9
      await page.getByTestId("newchar-dexterity-inc").click(); // 9 -> 10
      await page.getByTestId("newchar-constitution-inc").click(); // 8 -> 9
      await page.getByTestId("newchar-constitution-inc").click(); // 9 -> 10
      await expect(page.getByTestId("newchar-dexterity-score")).toHaveText("10");
      await expect(page.getByTestId("newchar-hp")).toHaveText("6"); // d6 + 0
      await expect(page.getByTestId("newchar-ac")).toHaveText("10"); // 10 + 0

      const createResponse = page.waitForResponse(
        (res) => res.request().method() === "POST" && res.url().endsWith("/campaigns")
      );
      await page.getByTestId("newchar-create").click();
      const res = await createResponse;
      expect(res.status()).toBe(201);

      // Lands in Play on the brand-new campaign.
      await expect(page.getByText("ACTIVE PLAY")).toBeVisible();
      await expect(page.getByText("The tale hasn't begun — say what you do.")).toBeVisible();

      // The new character is really on disk with derived, authoritative stats.
      expect(createdId).toBeTruthy();
      const sheet = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, "campaigns", createdId!, "character-sheet.json"), "utf8")
      );
      expect(sheet.name).toBe("E2E Newchar Fixture");
      expect(sheet.race).toBe("Elf");
      expect(sheet.class).toBe("Wizard");
      expect(sheet.level).toBe(1);
      expect(sheet.hp).toEqual({ current: 6, max: 6 });
      expect(sheet.armorClass).toBe(10);
    } finally {
      if (createdId) {
        fs.rmSync(path.join(REPO_ROOT, "campaigns", createdId), { recursive: true, force: true });
      }
    }
  });
});
