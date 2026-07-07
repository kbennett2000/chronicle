import { test, expect } from "./harness";
import { seedConnection } from "./connection";

// #96: a user whose campaign id resolves to a campaign they don't own (a
// brand-new account with no games — campaignId falls back to the "test-campaign"
// fixture that doesn't exist under their user dir) got GET
// /campaigns/<id>/settings → 404. That rejection was swallowed and the Settings
// screen spun "Reading campaign settings…" forever, hiding THE LOOK / THE WORLD.
// It must now stop spinning and show an empty state, with the global sections
// (music, hearth) still usable.

test.describe("Settings screen — no-campaign empty state (#96)", () => {
  test("a 404 on campaign settings shows an empty state, not an infinite spinner", async ({
    page,
    chronicleServer,
  }) => {
    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    // Point at a campaign the user does not own → the settings fetch 404s.
    await page.goto(`${chronicleServer.baseURL}/?campaign=zz-no-such-campaign`);
    await page.getByText("SETTINGS", { exact: true }).click();

    // The empty-state message appears and the loading text is gone.
    await expect(page.getByTestId("settings-no-campaign")).toBeVisible();
    await expect(page.getByText("Reading campaign settings…")).toHaveCount(0);

    // Campaign-scoped controls stay hidden (no half-rendered empty sections).
    await expect(page.getByTestId("images-toggle")).toHaveCount(0);
    await expect(page.getByTestId("world-setting-input")).toHaveCount(0);

    // Global sections still work: the music toggle and the signed-in/hearth
    // block render regardless of campaign.
    await expect(page.getByTestId("music-enabled")).toBeVisible();
    await expect(page.getByTestId("save-reconnect")).toBeVisible();
  });

  test("a real campaign still loads its settings normally", async ({ page, chronicleServer }) => {
    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await page.getByText("SETTINGS", { exact: true }).click();

    // The campaign-scoped controls render; no empty state.
    await expect(page.getByTestId("images-toggle")).toBeVisible();
    await expect(page.getByTestId("settings-no-campaign")).toHaveCount(0);
  });
});
