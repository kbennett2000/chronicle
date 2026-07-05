import { test, expect } from "./harness";
import { seedConnection } from "./connection";

async function getSettings(
  page: import("@playwright/test").Page,
  baseURL: string,
  token: string,
  campaignId: string
): Promise<Record<string, unknown>> {
  const res = await page.request.get(`${baseURL}/campaigns/${campaignId}/settings`, {
    headers: { "X-Chronicle-Token": token },
  });
  return res.json();
}

test.describe("Auto-roll dice setting (issue #44)", () => {
  test("defaults on, and turning it off persists via POST /settings and survives reload", async ({
    page,
    chronicleServer,
  }) => {
    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await page.getByText("SETTINGS", { exact: true }).click();

    // Absent in settings === on: the toggle reads pressed by default.
    await expect(page.getByTestId("dice-toggle")).toHaveAttribute("aria-pressed", "true");

    await page.getByTestId("dice-toggle").click();
    await expect(page.getByTestId("world-save-status")).toContainText("Saved");
    await expect(page.getByTestId("dice-toggle")).toHaveAttribute("aria-pressed", "false");

    const persisted = await getSettings(
      page,
      chronicleServer.baseURL,
      chronicleServer.token,
      chronicleServer.campaignId
    );
    expect(persisted.autoRollDice).toBe(false);

    // Survives a reload (persisted server-side, not just React state).
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await page.getByText("SETTINGS", { exact: true }).click();
    await expect(page.getByTestId("dice-toggle")).toHaveAttribute("aria-pressed", "false");
  });
});
