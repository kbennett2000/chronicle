import fs from "node:fs";
import { test, expect, campaignDir } from "./harness";
import { seedConnection } from "./connection";

// ADR-0021 / ADR-0022: at desktop width (this spec runs in the "desktop"
// Playwright project, see playwright.config.ts) the Play screen docks the
// Self/Folk/Quest/Views panels into a persistent side column instead of the
// mobile slide-up bottom sheet, and the Self tab renders the full official
// character sheet (CharacterSheetFull) rather than the compact mobile SelfPanel.

function writeSheet(campaignId: string, patch: Record<string, unknown>): void {
  const p = campaignDir(campaignId, "character-sheet.json");
  const sheet = JSON.parse(fs.readFileSync(p, "utf8"));
  fs.writeFileSync(p, JSON.stringify({ ...sheet, ...patch }, null, 2) + "\n");
}

async function enterPlay(page: import("@playwright/test").Page, baseURL: string, token: string, campaignId: string) {
  await seedConnection(page, baseURL, token);
  await page.goto(`${baseURL}/?campaign=${campaignId}`);
  await page.getByTestId("continue-button").click();
  await expect(page.getByText("ACTIVE PLAY")).toBeVisible();
}

test.describe("Desktop layout (ADR-0021 / ADR-0022)", () => {
  test("Play docks panels in a side column (no bottom sheet); Self shows the full sheet", async ({ page, chronicleServer }) => {
    await enterPlay(page, chronicleServer.baseURL, chronicleServer.token, chronicleServer.campaignId);

    // The side panel is present without any tap and defaults to Self, rendering
    // the full official sheet (not the mobile SelfPanel).
    await expect(page.getByTestId("desktop-sidebar")).toBeVisible();
    await expect(page.getByTestId("desktop-panel")).toBeVisible();
    await expect(page.getByTestId("sheet-full")).toBeVisible();
    await expect(page.getByTestId("sheet-name")).toHaveText("Testa Trialwright");
    // The mobile compact panel is NOT used on desktop.
    await expect(page.getByTestId("self-name")).toHaveCount(0);

    // No mobile bottom sheet exists on desktop.
    await expect(page.locator(".sheet-panel")).toHaveCount(0);

    // The seeded sheet renders every official-sheet region — including the boxes
    // for data the engine doesn't track yet (empty, faithful to a blank sheet) —
    // without crashing.
    await expect(page.getByTestId("sheet-attacks")).toBeVisible();
    await expect(page.getByTestId("sheet-death-saves")).toBeVisible();
    await expect(page.getByTestId("sheet-inspiration")).toBeVisible();
    await expect(page.getByTestId("sheet-ability-strength")).toBeVisible();

    // Switching tabs swaps the docked panel in place (no sheet opens).
    await page.getByTestId("tab-folk").click();
    await expect(page.getByTestId("sheet-full")).toHaveCount(0);
    await expect(page.locator(".sheet-panel")).toHaveCount(0);

    await page.getByTestId("tab-self").click();
    await expect(page.getByTestId("sheet-full")).toBeVisible();
  });

  test("Full sheet renders derived combat/skill numbers from stored inputs", async ({ page, chronicleServer }) => {
    // A complete sheet: Wizard L5 (PB +3). DEX 16 (+3), INT 16 (+3), WIS 14 (+2).
    writeSheet(chronicleServer.campaignId, {
      abilityScores: { strength: 10, dexterity: 16, constitution: 12, intelligence: 16, wisdom: 14, charisma: 8 },
      armorClass: 15,
      hp: { current: 20, max: 28 },
      speed: 30,
      xp: 6500,
      savingThrowProficiencies: ["intelligence", "wisdom"],
      skillProficiencies: ["arcana", "investigation"],
      background: "Sage",
      alignment: "Neutral Good",
      personality: { traits: "Endlessly curious.", ideals: "Knowledge.", bonds: "My tower.", flaws: "Arrogant." },
      featuresAndTraits: [{ name: "Arcane Recovery" }],
      languages: ["Common", "Draconic"],
      otherProficiencies: ["Quarterstaff"],
    });

    await enterPlay(page, chronicleServer.baseURL, chronicleServer.token, chronicleServer.campaignId);

    // Ability box shows score + modifier.
    await expect(page.getByTestId("sheet-ability-intelligence")).toContainText("16");
    await expect(page.getByTestId("sheet-ability-intelligence")).toContainText("+3");

    // All six saves and all eighteen skills render.
    await expect(page.getByTestId("sheet-save-row")).toHaveCount(6);
    await expect(page.getByTestId("sheet-skill-row")).toHaveCount(18);

    // Derived numbers: AC 15, initiative = DEX mod (+3), passive perception =
    // 10 + WIS mod (+2) = 12.
    await expect(page.getByTestId("sheet-ac")).toContainText("15");
    await expect(page.getByTestId("sheet-initiative")).toContainText("+3");
    await expect(page.getByTestId("sheet-passive")).toContainText("12");

    // Authored fields flow through.
    await expect(page.getByTestId("sheet-feature")).toHaveCount(1);
    await expect(page.getByTestId("sheet-language")).toHaveCount(2);
    await expect(page.getByTestId("sheet-full")).toContainText("Sage");

    // Unmodeled regions are still present as empty boxes (ADR-0022).
    await expect(page.getByTestId("sheet-attacks")).toBeVisible();
    await expect(page.getByTestId("sheet-inspiration")).toBeVisible();
  });
});
