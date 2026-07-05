import { test, expect } from "./harness";
import { seedConnection } from "./connection";

test.describe("Journal tab bar + bottom-sheet mechanics", () => {
  test("each tab opens its panel; ✕, grabber, and scrim all close it", async ({
    page,
    chronicleServer,
  }) => {
    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await page.getByTestId("continue-button").click();
    await expect(page.getByText("ACTIVE PLAY")).toBeVisible();

    // Self got real content in Slice 20 (see self-panel.spec.ts); the
    // other three are still Slice 19's stubs, per plan.
    const stubTabs: Array<{ testId: string; label: string }> = [
      { testId: "tab-folk", label: "Folk" },
      { testId: "tab-quest", label: "Quest" },
      { testId: "tab-views", label: "Views" },
    ];

    await page.getByTestId("tab-self").click();
    await expect(page.getByTestId("self-name")).toBeVisible();
    await expect(page.getByText("SELF", { exact: true })).toBeVisible();
    await page.getByTestId("sheet-close").click();
    await expect(page.getByTestId("self-name")).toBeHidden();

    for (const tab of stubTabs) {
      await page.getByTestId(tab.testId).click();
      await expect(page.getByText(`${tab.label} panel — coming soon`)).toBeVisible();
      await expect(page.getByText(tab.label.toUpperCase(), { exact: true })).toBeVisible();
      await page.getByTestId("sheet-close").click();
      await expect(page.getByText(`${tab.label} panel — coming soon`)).toBeHidden();
    }

    // Grabber closes too.
    await page.getByTestId("tab-quest").click();
    await expect(page.getByText("Quest panel — coming soon")).toBeVisible();
    await page.getByTestId("sheet-grabber").click();
    await expect(page.getByText("Quest panel — coming soon")).toBeHidden();

    // Tapping the scrim (outside the sheet) closes it too.
    await page.getByTestId("tab-folk").click();
    await expect(page.getByText("Folk panel — coming soon")).toBeVisible();
    await page.getByTestId("sheet-scrim").click({ position: { x: 5, y: 5 } });
    await expect(page.getByText("Folk panel — coming soon")).toBeHidden();

    // Turn input still works underneath — the panel doesn't leave the
    // input dock stuck disabled or the scrim lingering to eat clicks.
    await page.getByTestId("turn-input").fill("still here");
    await expect(page.getByTestId("turn-input")).toHaveValue("still here");
  });

  test("closing one panel and opening another never leaves two sheets stacked", async ({
    page,
    chronicleServer,
  }) => {
    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await page.getByTestId("continue-button").click();
    await expect(page.getByText("ACTIVE PLAY")).toBeVisible();

    // The sheet covers the tab bar by design (both z-index:30, matching
    // the handoff reference), so switching tabs requires closing first —
    // there's no path to two sheets mounted at once.
    await page.getByTestId("tab-self").click();
    await expect(page.getByTestId("self-name")).toBeVisible();
    await expect(page.getByTestId("sheet-scrim")).toHaveCount(1);

    await page.getByTestId("sheet-close").click();
    await expect(page.getByTestId("self-name")).toBeHidden();
    await expect(page.getByTestId("sheet-scrim")).toHaveCount(0);

    await page.getByTestId("tab-views").click();
    await expect(page.getByText("Views panel — coming soon")).toBeVisible();
    await expect(page.getByTestId("self-name")).toBeHidden();
    await expect(page.getByTestId("sheet-scrim")).toHaveCount(1);
  });
});
