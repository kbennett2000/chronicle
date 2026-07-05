import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect } from "./harness";
import { seedConnection } from "./connection";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const PORTRAIT_FIXTURE = path.join(REPO_ROOT, "docs/design/handoff-2026-07/assets/portrait-wren.png");

function characterSheetPath(campaignId: string): string {
  return path.join(REPO_ROOT, "campaigns", campaignId, "character-sheet.json");
}

function writeCharacterSheet(campaignId: string, patch: Record<string, unknown>): void {
  const sheetPath = characterSheetPath(campaignId);
  const sheet = JSON.parse(fs.readFileSync(sheetPath, "utf8"));
  fs.writeFileSync(sheetPath, JSON.stringify({ ...sheet, ...patch }, null, 2) + "\n");
}

function deleteCurrencyField(campaignId: string): void {
  const sheetPath = characterSheetPath(campaignId);
  const sheet = JSON.parse(fs.readFileSync(sheetPath, "utf8"));
  delete sheet.currency;
  fs.writeFileSync(sheetPath, JSON.stringify(sheet, null, 2) + "\n");
}

function seedPortraitImage(campaignId: string, filename: string): void {
  const imagesDir = path.join(REPO_ROOT, "campaigns", campaignId, "images");
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.copyFileSync(PORTRAIT_FIXTURE, path.join(imagesDir, filename));
}

async function openSelfPanel(page: import("@playwright/test").Page): Promise<void> {
  await page.getByTestId("continue-button").click();
  await expect(page.getByText("ACTIVE PLAY")).toBeVisible();
  await page.getByTestId("tab-self").click();
}

test.describe("Self panel (character sheet)", () => {
  test("full data: currency, conditions, abilities, spell slots, portrait, inventory all render", async ({
    page,
    chronicleServer,
  }) => {
    writeCharacterSheet(chronicleServer.campaignId, {
      hp: { current: 18, max: 24 },
      armorClass: 15,
      abilityScores: { strength: 14, dexterity: 16, constitution: 12, intelligence: 10, wisdom: 13, charisma: 8 },
      conditions: ["Wounded"],
      inventory: [{ item: "Shortsword", quantity: 1 }, { item: "Arrows", quantity: 20 }],
      xp: 300,
      spellSlots: { "1st": { total: 3, used: 1 } },
      currency: { cp: 12, sp: 8, ep: 0, gp: 23, pp: 1 },
      portraitImage: "portrait-wren.png",
    });
    seedPortraitImage(chronicleServer.campaignId, "portrait-wren.png");

    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await openSelfPanel(page);

    await expect(page.getByTestId("self-name")).toHaveText("Testa Trialwright");
    await expect(page.getByText("18/24")).toBeVisible();
    await expect(page.getByText("15", { exact: true })).toBeVisible();
    await expect(page.getByTestId("self-condition")).toHaveText("Wounded");
    await expect(page.getByText("300 xp")).toBeVisible();
    await expect(page.getByTestId("self-spell-slot-row")).toBeVisible();
    await expect(page.getByTestId("self-inventory-item")).toHaveCount(2);

    await expect(page.getByTestId("self-coin-pp")).toContainText("1");
    await expect(page.getByTestId("self-coin-gp")).toContainText("23");
    await expect(page.getByTestId("self-coin-ep")).toContainText("0");
    await expect(page.getByTestId("self-coin-sp")).toContainText("8");
    await expect(page.getByTestId("self-coin-cp")).toContainText("12");

    // Real authenticated fetch, not a bare <img src> (the route requires
    // the auth header) — assert it actually resolved to a blob: URL, not
    // a broken image.
    const portrait = page.getByTestId("self-portrait-image");
    await expect(portrait).toBeVisible();
    const src = await portrait.getAttribute("src");
    expect(src).toMatch(/^blob:/);
    const naturalWidth = await portrait.evaluate((img: HTMLImageElement) => img.naturalWidth);
    expect(naturalWidth).toBeGreaterThan(0);
    await expect(page.getByTestId("self-portrait-none")).toHaveCount(0);
  });

  test("currency absent (pre-migration sheet): all five denominations render as zero, no crash", async ({
    page,
    chronicleServer,
  }) => {
    deleteCurrencyField(chronicleServer.campaignId);

    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await openSelfPanel(page);

    await expect(page.getByTestId("self-name")).toBeVisible();
    for (const coin of ["pp", "gp", "ep", "sp", "cp"]) {
      await expect(page.getByTestId(`self-coin-${coin}`)).toContainText("0");
    }
  });

  test("no portraitImage: normal-looking empty state, not a broken image", async ({ page, chronicleServer }) => {
    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await openSelfPanel(page);

    await expect(page.getByTestId("self-portrait-none")).toBeVisible();
    await expect(page.getByText("no likeness yet")).toBeVisible();
    await expect(page.getByTestId("self-portrait-image")).toHaveCount(0);
  });
});
