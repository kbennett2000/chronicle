import { test, expect } from "./harness";
import { seedConnection } from "./connection";

test.describe("Opening scene (turn-zero) — issue #54, ADR-0013", () => {
  test("a fresh campaign auto-generates an opening narration, once, with no player line", async ({
    page,
    unopenedChronicleServer,
  }) => {
    // One real Agent SDK turn: the DM-initiated opening scene.
    test.setTimeout(120_000);

    await seedConnection(page, unopenedChronicleServer.baseURL, unopenedChronicleServer.token);

    // The opening is fired by the client on entering Play; capture its POST.
    const openingRequest = page.waitForRequest(
      (req) => req.url().includes("/opening") && req.method() === "POST"
    );

    await page.goto(`${unopenedChronicleServer.baseURL}/?campaign=${unopenedChronicleServer.campaignId}`);
    await page.getByTestId("continue-button").click();
    await expect(page.getByText("ACTIVE PLAY")).toBeVisible();

    // The "setting the scene" state shows while it generates — never the old
    // blank "the tale hasn't begun" placeholder.
    await expect(page.getByText("The Dungeon Master is setting the scene")).toBeVisible();
    await expect(page.getByText("The tale hasn't begun — say what you do.")).toHaveCount(0);

    const openingResponse = await (await openingRequest).response();
    expect(openingResponse?.status()).toBe(200);
    const openingBody = await openingResponse?.json();
    expect(openingBody.isError).toBe(false);
    expect(typeof openingBody.narration).toBe("string");
    expect(openingBody.narration.length).toBeGreaterThan(0);

    // Renders as exactly one narration, with NO "YOU" block (turn-zero has an
    // empty playerMessage).
    await expect(page.getByTestId("narration")).toHaveCount(1, { timeout: 90_000 });
    await expect(page.getByTestId("player-message")).toHaveCount(0);
    await expect(page.getByTestId("turn-input")).toBeEnabled();

    // Persisted as a single turn-zero record with an empty playerMessage.
    const state = (await (
      await page.request.get(
        `${unopenedChronicleServer.baseURL}/campaigns/${unopenedChronicleServer.campaignId}/state`,
        { headers: { "X-Chronicle-Token": unopenedChronicleServer.token } }
      )
    ).json()) as {
      currentSessionLog?: { transcript: Array<{ turnIndex: number; playerMessage: string; narration: string }> };
    };
    const transcript = state.currentSessionLog?.transcript ?? [];
    expect(transcript).toHaveLength(1);
    expect(transcript[0].turnIndex).toBe(0);
    expect(transcript[0].playerMessage).toBe("");

    // Idempotent (ADR-0013): reloading does NOT generate a second opening —
    // Play sees an existing turn and skips the auto-trigger entirely.
    await page.reload();
    await page.getByTestId("continue-button").click();
    await expect(page.getByText("ACTIVE PLAY")).toBeVisible();
    await expect(page.getByTestId("narration")).toHaveCount(1);

    const after = (await (
      await page.request.get(
        `${unopenedChronicleServer.baseURL}/campaigns/${unopenedChronicleServer.campaignId}/state`,
        { headers: { "X-Chronicle-Token": unopenedChronicleServer.token } }
      )
    ).json()) as { currentSessionLog?: { transcript: unknown[] } };
    expect(after.currentSessionLog?.transcript ?? []).toHaveLength(1);
  });
});
