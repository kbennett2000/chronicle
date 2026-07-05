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

    // Self (Slice 20), Folk (Slice 21), and Quest (Slice 22) got real
    // content — see self-panel.spec.ts / folk-panel.spec.ts /
    // quest-panel.spec.ts; Views is still Slice 19's stub, per plan.
    const stubTabs: Array<{ testId: string; label: string }> = [{ testId: "tab-views", label: "Views" }];

    await page.getByTestId("tab-self").click();
    await expect(page.getByTestId("self-name")).toBeVisible();
    await expect(page.getByText("SELF", { exact: true })).toBeVisible();
    await page.getByTestId("sheet-close").click();
    await expect(page.getByTestId("self-name")).toBeHidden();

    // Folk on a fresh scratch campaign (zero NPCs met) shows its own
    // empty state, not the "coming soon" stub copy.
    await page.getByTestId("tab-folk").click();
    await expect(page.getByText("No one worth naming has crossed your path yet.")).toBeVisible();
    await expect(page.getByText("FOLK", { exact: true })).toBeVisible();
    await page.getByTestId("sheet-close").click();
    await expect(page.getByText("No one worth naming has crossed your path yet.")).toBeHidden();

    // Quest on a fresh scratch campaign (zero quests logged) shows its own
    // empty state, not the "coming soon" stub copy.
    await page.getByTestId("tab-quest").click();
    await expect(page.getByText("No thread worth tracking has begun yet.")).toBeVisible();
    await expect(page.getByText("QUEST", { exact: true })).toBeVisible();
    await page.getByTestId("sheet-close").click();
    await expect(page.getByText("No thread worth tracking has begun yet.")).toBeHidden();

    for (const tab of stubTabs) {
      await page.getByTestId(tab.testId).click();
      await expect(page.getByText(`${tab.label} panel — coming soon`)).toBeVisible();
      await expect(page.getByText(tab.label.toUpperCase(), { exact: true })).toBeVisible();
      await page.getByTestId("sheet-close").click();
      await expect(page.getByText(`${tab.label} panel — coming soon`)).toBeHidden();
    }

    // Grabber closes too.
    await page.getByTestId("tab-quest").click();
    await expect(page.getByText("No thread worth tracking has begun yet.")).toBeVisible();
    await page.getByTestId("sheet-grabber").click();
    await expect(page.getByText("No thread worth tracking has begun yet.")).toBeHidden();

    // Tapping the scrim (outside the sheet) closes it too.
    await page.getByTestId("tab-views").click();
    await expect(page.getByText("Views panel — coming soon")).toBeVisible();
    await page.getByTestId("sheet-scrim").click({ position: { x: 5, y: 5 } });
    await expect(page.getByText("Views panel — coming soon")).toBeHidden();

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
