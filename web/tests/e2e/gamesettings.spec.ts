import { test, expect } from "./harness";
import { seedConnection } from "./connection";

// Issue #114: the in-game settings screen — reached from the gear in Active Play
// — changes THIS game's per-game settings (Look/World/music) via POST
// /campaigns/:id/settings, while the engine/model are shown READ-ONLY (chosen at
// creation, locked once play begins; the mid-game switch crashed — ADR-0018/#57).

async function openGameSettings(page: import("@playwright/test").Page, baseURL: string, campaignId: string) {
  await page.goto(`${baseURL}/?campaign=${campaignId}`);
  await page.getByTestId("continue-button").click();
  await expect(page.getByText("ACTIVE PLAY")).toBeVisible();
  await page.getByTestId("game-settings-open").click();
  await expect(page.getByTestId("game-settings-screen")).toBeVisible();
}

async function readCampaignSettings(
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

test.describe("In-game settings screen (#114)", () => {
  test("the engine is read-only and locked — no session/start can fire from here", async ({
    page,
    chronicleServer,
  }) => {
    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await openGameSettings(page, chronicleServer.baseURL, chronicleServer.campaignId);

    // The lock note is shown, and the engine controls are disabled — there is no
    // way to switch provider/model from within a game.
    await expect(page.getByTestId("engine-locked-note")).toBeVisible();
    await expect(page.getByTestId("provider-option").first()).toBeDisabled();
    await expect(page.getByTestId("model-option").first()).toBeDisabled();

    // Start watching only now (entering Play already fired the allowed no-arg
    // session/start). Clicking the disabled engine controls must fire nothing.
    const sessionStarts: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/session/start")) sessionStarts.push(req.url());
    });
    await page.getByTestId("provider-option").first().click({ force: true }).catch(() => {});
    await page.getByTestId("model-option").first().click({ force: true }).catch(() => {});
    expect(sessionStarts).toEqual([]);
  });

  test("Look/World changes persist to this game via POST /campaigns/:id/settings", async ({
    page,
    chronicleServer,
  }) => {
    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await openGameSettings(page, chronicleServer.baseURL, chronicleServer.campaignId);

    // Auto-roll dice defaults on (absent === on); turning it off persists (#44).
    await expect(page.getByTestId("dice-toggle")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("dice-toggle").click();
    await expect(page.getByTestId("world-save-status")).toContainText("Saved for this game");
    await expect(page.getByTestId("dice-toggle")).toHaveAttribute("aria-pressed", "false");

    await page.getByTestId("images-toggle").click();
    await expect(page.getByTestId("look-save-status")).toContainText("Saved for this game");

    const persisted = await readCampaignSettings(
      page,
      chronicleServer.baseURL,
      chronicleServer.token,
      chronicleServer.campaignId
    );
    expect(persisted.autoRollDice).toBe(false);
    expect(persisted.generateImages).toBe(true);

    // Survives leaving and re-entering the in-game settings screen.
    await page.getByTestId("game-settings-back").click();
    await expect(page.getByText("ACTIVE PLAY")).toBeVisible();
    await page.getByTestId("game-settings-open").click();
    await expect(page.getByTestId("dice-toggle")).toHaveAttribute("aria-pressed", "false");
  });

  test("back returns to Active Play", async ({ page, chronicleServer }) => {
    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await openGameSettings(page, chronicleServer.baseURL, chronicleServer.campaignId);
    await page.getByTestId("game-settings-back").click();
    await expect(page.getByText("ACTIVE PLAY")).toBeVisible();
  });
});
