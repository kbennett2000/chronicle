import { test, expect } from "./harness";
import { seedConnection } from "./connection";

test.describe("Home screen — connected state", () => {
  test("renders real state and Continue starts a real session", async ({ page, chronicleServer }) => {
    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);

    // Lands on Home, not the no-connection -> Settings redirect from Slice 15.
    await expect(page.getByText("CHRONICLE", { exact: true })).toBeVisible();
    await expect(page.getByTestId("campaign-card")).toBeVisible();

    // Real GET /state content, not placeholder copy.
    await expect(page.getByTestId("character-name")).toHaveText("Testa Trialwright");
    await expect(page.getByText("Gnome Wizard · Level 5")).toBeVisible();
    await expect(page.getByTestId("current-situation")).toContainText(
      "Standing at the edge of a test fixture"
    );

    // Connection footer reflects a real, successful check, not a placeholder.
    await expect(page.getByTestId("connection-dot")).toBeVisible();
    await expect(page.getByText(`the hearth · ${chronicleServer.baseURL}`)).toBeVisible();

    // Continue -> a real POST /session/start against this backend.
    const sessionStartRequest = page.waitForRequest(
      (req) => req.url().includes("/session/start") && req.method() === "POST"
    );
    await page.getByTestId("continue-button").click();
    const request = await sessionStartRequest;
    expect(request.url()).toBe(`${chronicleServer.baseURL}/campaigns/${chronicleServer.campaignId}/session/start`);

    const response = await request.response();
    expect(response?.status()).toBe(200);
    const body = await response?.json();
    expect(body.resumed).toBe(false);
    // No turn has run yet for this fresh scratch campaign, so the Agent
    // SDK session doesn't exist server-side yet — sessionId is only
    // assigned once runTurn() actually creates one (see server.ts).
    expect(body.sessionId).toBeNull();

    // Transitions to Play on success.
    await expect(page.getByText("ACTIVE PLAY")).toBeVisible();
  });

  test("without a stored connection, still redirects to Settings (Slice 15 regression)", async ({
    page,
    chronicleServer,
  }) => {
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await expect(page.getByText("SETTINGS", { exact: true })).toBeVisible();
    await expect(page.getByText("THE HEARTH")).toBeVisible();
  });
});
