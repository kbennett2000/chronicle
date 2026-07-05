import { test, expect } from "./harness";
import { seedConnection } from "./connection";

test.describe("Play screen — first turn on a fresh campaign", () => {
  test("empty log -> submit -> loading state -> real narration appears", async ({ page, chronicleServer }) => {
    // A real Agent SDK turn — no mocking, per this project's own harness
    // philosophy — genuinely takes real seconds even on haiku.
    test.setTimeout(120_000);

    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);

    await page.getByTestId("continue-button").click();
    await expect(page.getByText("ACTIVE PLAY")).toBeVisible();

    // Empty state, not an error, for a campaign with no currentSessionLog yet.
    await expect(page.getByText("The tale hasn't begun — say what you do.")).toBeVisible();

    const turnRequest = page.waitForRequest(
      (req) => req.url().includes("/turns") && req.method() === "POST"
    );
    await page.getByTestId("turn-input").fill("I look around the room.");
    await page.getByTestId("send-button").click();

    // The player's own line renders immediately, before the response.
    await expect(page.getByText("I look around the room.")).toBeVisible();
    // Mandatory loading state while the real turn is in flight.
    await expect(page.getByText("The Dungeon Master is weaving what happens next")).toBeVisible();

    const request = await turnRequest;
    expect(request.url()).toBe(`${chronicleServer.baseURL}/campaigns/${chronicleServer.campaignId}/turns`);
    const response = await request.response();
    expect(response?.status()).toBe(200);
    const body = await response?.json();
    expect(body.isError).toBe(false);
    expect(typeof body.narration).toBe("string");
    expect(body.narration.length).toBeGreaterThan(0);

    // Loading state clears and real narration text renders in the log.
    await expect(page.getByText("The Dungeon Master is weaving what happens next")).toBeHidden();
    await expect(page.getByText(body.narration.slice(0, 40), { exact: false })).toBeVisible();
  });
});
