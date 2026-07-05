import { test, expect } from "./harness";
import { seedConnection } from "./connection";

test.describe("Mute control (Active Play)", () => {
  test("one tap toggles the bars+slash icon, and the choice survives a reload", async ({ page, chronicleServer }) => {
    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await page.getByTestId("continue-button").click();
    await expect(page.getByText("ACTIVE PLAY")).toBeVisible();

    await expect(page.getByTestId("mute-toggle")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("mute-slash")).toHaveCount(0);

    await page.getByTestId("mute-toggle").click();
    await expect(page.getByTestId("mute-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("mute-slash")).toBeVisible();

    // Reload lands back on Home (no URL-synced screen routing — a real
    // finding from Slice 25's full-session QA pass, not a regression
    // introduced by this test) — re-enter Play and confirm the *persisted*
    // preference survived, not just the in-memory React state.
    await page.reload();
    await expect(page.getByTestId("campaign-card")).toBeVisible();
    await page.getByTestId("continue-button").click();
    await expect(page.getByText("ACTIVE PLAY")).toBeVisible();
    await expect(page.getByTestId("mute-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("mute-slash")).toBeVisible();

    // Un-mute persists too — not just the muted state.
    await page.getByTestId("mute-toggle").click();
    await expect(page.getByTestId("mute-toggle")).toHaveAttribute("aria-pressed", "false");
    await page.reload();
    await page.getByTestId("continue-button").click();
    await expect(page.getByText("ACTIVE PLAY")).toBeVisible();
    await expect(page.getByTestId("mute-toggle")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("mute-slash")).toHaveCount(0);
  });
});
