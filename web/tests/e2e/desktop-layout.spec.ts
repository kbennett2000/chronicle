import { test, expect } from "./harness";
import { seedConnection } from "./connection";

// ADR-0021: at desktop width (this spec runs in the "desktop" Playwright project,
// see playwright.config.ts) the Play screen docks the Self/Folk/Quest/Views panels
// into a persistent side column instead of the mobile slide-up bottom sheet, and a
// panel is always shown (defaulting to Self). This suite guards that split; the
// mobile bottom-sheet behavior is covered by the other specs in the "mobile"
// project.
test.describe("Desktop layout (ADR-0021)", () => {
  test("Play docks panels in a persistent side column, not a bottom sheet", async ({ page, chronicleServer }) => {
    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await page.getByTestId("continue-button").click();
    await expect(page.getByText("ACTIVE PLAY")).toBeVisible();

    // The side panel is present without any tap and defaults to Self, showing the
    // seeded character (Testa Trialwright — see harness seedCampaignContent).
    await expect(page.getByTestId("desktop-sidebar")).toBeVisible();
    await expect(page.getByTestId("desktop-panel")).toBeVisible();
    await expect(page.getByTestId("self-name")).toBeVisible();

    // No mobile bottom sheet exists on desktop.
    await expect(page.locator(".sheet-panel")).toHaveCount(0);

    // Switching tabs swaps the docked panel in place (no sheet opens).
    await page.getByTestId("tab-folk").click();
    await expect(page.getByTestId("self-name")).toHaveCount(0);
    await expect(page.locator(".sheet-panel")).toHaveCount(0);

    await page.getByTestId("tab-self").click();
    await expect(page.getByTestId("self-name")).toBeVisible();
  });
});
