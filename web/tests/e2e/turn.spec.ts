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

  test("a combat/SRD-adjudication turn's narration stays in character — no tool/permission talk leaks through", async ({
    page,
    chronicleServer,
  }) => {
    // See issue #29: a full played session (Slice 25's mandated cross-
    // panel QA pass, not just re-running this existing suite) found the
    // DM engine breaking character on a combat turn specifically —
    // narrating things like "I need permission to write the campaign
    // state files" instead of resolving the attack. Every real-API test
    // in this file up to now only ever sent non-combat actions ("I look
    // around the room") and only asserted narration was non-empty/non-
    // error, never that its *content* was actually coherent narrative —
    // exactly why isolated/content-blind testing missed this. Marked
    // fixme until the underlying tool-permission issue in issue #29 is
    // root-caused; remove the fixme once it's fixed and confirm this
    // passes for real.
    test.fixme(true, "blocked on https://github.com/kbennett2000/chronicle/issues/29");
    test.setTimeout(120_000);

    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await page.getByTestId("continue-button").click();
    await expect(page.getByText("ACTIVE PLAY")).toBeVisible();

    const turnRequest = page.waitForRequest((req) => req.url().includes("/turns") && req.method() === "POST");
    await page.getByTestId("turn-input").fill("I draw my weapon and attack whatever's lurking in the shadows ahead.");
    await page.getByTestId("send-button").click();
    const response = await (await turnRequest).response();
    const body = await response?.json();

    expect(body.isError).toBe(false);
    const narration: string = body.narration.toLowerCase();
    for (const tell of ["permission", ".claude", "settings.json", "/config", "i cannot", "i need to pause"]) {
      expect(narration).not.toContain(tell);
    }
  });

  test("a successful turn refreshes Self/Folk/Quest/Views state, not just the turn transcript", async ({
    page,
    chronicleServer,
  }) => {
    // Found during Slice 25's full-session QA pass: Play.tsx fetched
    // characterSheet/npcRoster/questLog/worldState exactly once, at
    // mount, and never again — a turn only ever patched the local turn
    // transcript. A real player who played a few turns then opened Folk/
    // Quest/Views would see whatever was true *before* the session
    // started, forever, until a full remount. No isolated panel test
    // could ever catch this (they all seed their fixture file to disk
    // before the page loads, so the one-time initial fetch is always
    // already correct — no test ever played a turn and then checked a
    // panel in the same session). This doesn't depend on the real
    // model's unpredictable narrative content — it just confirms the
    // refetch mechanism itself fires after a successful turn.
    test.setTimeout(120_000);

    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await page.getByTestId("continue-button").click();
    await expect(page.getByText("ACTIVE PLAY")).toBeVisible();

    const turnRequest = page.waitForRequest((req) => req.url().includes("/turns") && req.method() === "POST");
    const stateRefetchRequest = page.waitForRequest(
      (req) =>
        req.url() === `${chronicleServer.baseURL}/campaigns/${chronicleServer.campaignId}/state` &&
        req.method() === "GET"
    );
    await page.getByTestId("turn-input").fill("I look around the room.");
    await page.getByTestId("send-button").click();

    const turnResponse = await (await turnRequest).response();
    expect(turnResponse?.status()).toBe(200);
    const turnBody = await turnResponse?.json();
    expect(turnBody.isError).toBe(false);

    // A fresh GET /state fires after the turn resolves — this is what
    // actually keeps Self/Folk/Quest/Views current mid-session.
    await stateRefetchRequest;
  });
});
