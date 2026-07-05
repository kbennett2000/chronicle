import { test, expect } from "./harness";

test.describe("First real connection — brand-new campaign (issue #33)", () => {
  test("entering a bare host:port address and Save & Reconnect does not crash", async ({
    page,
    freshChronicleServer,
  }) => {
    // Deliberately a fresh browser context (no seedConnection call) against
    // a scratch campaign that has never been played — this is exactly the
    // "fresh install, first real connection" state that crashed: no stored
    // client-side connection, no prior turns, world-state.md/quest-log.md/
    // npc-roster.md all still at scratch-campaign.ts's blank defaults.
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto(`${freshChronicleServer.baseURL}/?campaign=${freshChronicleServer.campaignId}`);

    // No connection saved yet -> redirected to Settings, per existing
    // Slice 15 behavior (also covered by home.spec.ts's own regression
    // test) — this test's own job starts after that, at Save & Reconnect.
    await expect(page.getByText("THE HEARTH")).toBeVisible();

    // The address field's own placeholder ("192.168.1.24:4317") is bare
    // host:port with no scheme — issue #33's root cause only reproduces
    // when the typed address matches that same shape, not a fully
    // qualified http://... URL.
    const bareAddress = freshChronicleServer.baseURL.replace(/^https?:\/\//, "");
    await page.locator('input[placeholder="192.168.1.24:4317"]').fill(bareAddress);
    await page.locator('input[type="password"]').fill(freshChronicleServer.token);
    await page.getByRole("button", { name: "SAVE & RECONNECT" }).click();

    // Issue #35: a successful Save & Reconnect now lands on Home directly
    // (it used to stay on Settings and require a manual Back). Home is still
    // where issue #33's crash happened — Home's own GET /state fetch over the
    // same previously-broken serverOrigin() URL — so the regression guard
    // below is unchanged, just reached automatically now.

    // The actual regression: this used to throw (Cannot read properties of
    // undefined, reading 'replace'/'map') and take down the whole React
    // tree, leaving a blank black screen with no visible UI at all.
    await expect(page.getByText("CHRONICLE", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("current-situation")).toContainText("not yet started");
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    expect(pageErrors).toEqual([]);

    // Settings' own model list (fetched over the same connection) also
    // rendered correctly rather than crashing on an undefined models array.
    await page.getByText("SETTINGS", { exact: true }).click();
    await expect(page.getByTestId("model-option").first()).toBeVisible();
  });
});
