import fs from "node:fs";
import { test, expect, campaignDir } from "./harness";
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

  test("without a stored token, redirects to the login screen (ADR-0019)", async ({
    page,
    chronicleServer,
  }) => {
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await expect(page.getByTestId("auth-submit")).toBeVisible();
    await expect(page.getByTestId("auth-username")).toBeVisible();
  });
});

// ADR-0039: the Home card must never render the full "## Current Situation"
// section as a wall of text, even when the DM has let it grow into a stacked
// append-only log. summarizeSituation() bounds it to SITUATION_SUMMARY_MAX_CHARS
// (280) at the derivation site, with a defensive CSS clamp on top.
test.describe("Home screen — Current Situation is bounded (ADR-0039)", () => {
  test("a bloated, many-moment situation renders as a short capped summary", async ({
    page,
    chronicleServer,
  }) => {
    // Overwrite world-state.md with a ted-the-wizard-style bloated section:
    // 57 stacked beats, oldest first, a unique sentinel on the LAST beat.
    const beats = Array.from(
      { length: 57 },
      (_, i) => `CURRENT MOMENT: beat number ${i} in which a great many words pile up unbounded.`
    );
    beats.push("CURRENT MOMENT: ZZLASTBEAT the final appended beat that must be clipped off.");
    fs.writeFileSync(
      campaignDir(chronicleServer.campaignId, "world-state.md"),
      `# World State\n\n## Current Situation\n${beats.join(" ")}\n\n## Locations Visited\n_(none yet)_\n`
    );

    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);

    const card = page.getByTestId("current-situation");
    await expect(card).toBeVisible();

    const rendered = (await card.textContent()) ?? "";
    // Bounded to the cap (280) plus the single-char ellipsis.
    expect(rendered.length).toBeLessThanOrEqual(281);
    expect(rendered.endsWith("…")).toBe(true);
    // The cap keeps the front of the section, so the last appended beat's
    // sentinel is clipped — the card is never the whole wall.
    expect(rendered).not.toContain("ZZLASTBEAT");
  });
});

// #97: a stale ?campaign= link or a deleted game (e.g. Kris's `qroky-qrok`) used
// to dead-end Home on a raw "Couldn't read this campaign" error. It now drops to
// a recoverable empty state, with the user's real chronicles listed below to
// pick from in a tap.
test.describe("Home screen — unknown campaign recovers gracefully (#97)", () => {
  test("a 404 active campaign shows the recoverable empty state, not an error", async ({
    page,
    chronicleServer,
  }) => {
    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=zz-no-such-campaign`);

    // No raw error card; instead the recoverable empty state...
    await expect(page.getByTestId("home-no-campaign")).toBeVisible();
    await expect(page.getByText("Couldn't read this campaign")).toHaveCount(0);
    // ...worded for a user who does have chronicles, just not this one...
    await expect(page.getByTestId("home-no-campaign")).toContainText("choose one below");
    // ...and the user's real chronicle is listed below to recover in one tap.
    await expect(page.getByTestId("other-chronicle").first()).toBeVisible();
  });
});
