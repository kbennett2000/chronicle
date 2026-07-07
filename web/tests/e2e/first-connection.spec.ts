import { test, expect } from "./harness";

test.describe("First real connection — brand-new campaign (issue #33)", () => {
  test("registering an account from a bare host:port address does not crash", async ({
    page,
    freshChronicleServer,
  }) => {
    // Deliberately a fresh browser context (no seedConnection call) against a
    // scratch campaign that has never been played — the "fresh install, first
    // real connection" state that crashed. ADR-0019: the first screen is now
    // Auth (register/login), not the passphrase Hearth, so this exercises the
    // new entry flow while keeping issue #33's regression guard (a bare
    // host:port address rendering Home without blowing up the React tree).
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto(`${freshChronicleServer.baseURL}/?campaign=${freshChronicleServer.campaignId}`);

    // No token stored yet -> the login/register screen.
    await expect(page.getByTestId("auth-submit")).toBeVisible();

    // Issue #33's root cause only reproduces when the typed address matches the
    // bare host:port placeholder shape, not a fully qualified http://... URL.
    const bareAddress = freshChronicleServer.baseURL.replace(/^https?:\/\//, "");
    await page.getByTestId("auth-server").fill(bareAddress);
    // Switch to "create account" and register a unique user for this run.
    await page.getByTestId("auth-toggle-mode").click();
    await page.getByTestId("auth-username").fill(`first-conn-${Date.now()}`);
    await page.getByTestId("auth-password").fill("first-conn-pass");
    await page.getByTestId("auth-submit").click();

    // The actual regression: Home used to throw (Cannot read properties of
    // undefined) over the same previously-broken serverOrigin() URL and take
    // down the whole React tree, leaving a blank black screen.
    await expect(page.getByText("CHRONICLE", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    expect(pageErrors).toEqual([]);

    // Settings' own model list (fetched over the same connection) also renders.
    await page.getByText("SETTINGS", { exact: true }).click();
    await expect(page.getByTestId("model-option").first()).toBeVisible();
  });
});
