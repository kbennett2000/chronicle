import { test, expect } from "./harness";
import { seedConnection } from "./connection";

test.describe("Deterministic turn transcripts (ADR-0007)", () => {
  test("a multi-turn conversation attributes each turn correctly, UI and API alike", async ({
    page,
    chronicleServer,
  }) => {
    // Two real Agent SDK turns on haiku — still real seconds, not mocked.
    test.setTimeout(120_000);

    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await page.getByTestId("continue-button").click();
    await expect(page.getByText("ACTIVE PLAY")).toBeVisible();

    const firstMessage = "First turn: I knock on the door.";
    const secondMessage = "Second turn: I open the door.";

    await page.getByTestId("turn-input").fill(firstMessage);
    await page.getByTestId("send-button").click();
    await expect(page.getByTestId("narration")).toHaveCount(1, { timeout: 60_000 });

    await page.getByTestId("turn-input").fill(secondMessage);
    await page.getByTestId("send-button").click();
    await expect(page.getByTestId("narration")).toHaveCount(2, { timeout: 60_000 });

    // UI order: each player message directly precedes its own narration,
    // in submission order — this is exactly what a swapped/misattributed
    // transcript would get wrong.
    await expect(page.getByTestId("player-message").nth(0)).toHaveText(firstMessage);
    await expect(page.getByTestId("player-message").nth(1)).toHaveText(secondMessage);

    // Cross-check against the real, deterministic backend record — not
    // just "the UI shows two of each," but that the UI's narration text
    // for each turn is exactly the transcript's narration for that
    // turnIndex, matched to the right playerMessage.
    const state = (await (
      await page.request.get(
        `${chronicleServer.baseURL}/campaigns/${chronicleServer.campaignId}/state`,
        { headers: { "X-Chronicle-Token": chronicleServer.token } }
      )
    ).json()) as {
      currentSessionLog?: {
        transcript: Array<{ turnIndex: number; playerMessage: string; narration: string }>;
      };
    };

    const transcript = state.currentSessionLog?.transcript ?? [];
    expect(transcript).toHaveLength(2);
    expect(transcript[0].turnIndex).toBe(0);
    expect(transcript[1].turnIndex).toBe(1);
    expect(transcript[0].playerMessage).toBe(firstMessage);
    expect(transcript[1].playerMessage).toBe(secondMessage);

    await expect(page.getByTestId("narration").nth(0)).toHaveText(transcript[0].narration);
    await expect(page.getByTestId("narration").nth(1)).toHaveText(transcript[1].narration);
  });
});
