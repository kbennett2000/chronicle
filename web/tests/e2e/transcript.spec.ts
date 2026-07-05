import { test, expect } from "./harness";
import { seedConnection } from "./connection";

test.describe("Deterministic turn transcripts (ADR-0007)", () => {
  test("a multi-turn conversation attributes each turn correctly, UI and API alike", async ({
    page,
    unopenedChronicleServer,
  }) => {
    // Three real Agent SDK turns on haiku — the auto-generated opening scene
    // (ADR-0013, turn-zero) plus two player turns. Real seconds, not mocked.
    test.setTimeout(240_000);

    await seedConnection(page, unopenedChronicleServer.baseURL, unopenedChronicleServer.token);
    await page.goto(`${unopenedChronicleServer.baseURL}/?campaign=${unopenedChronicleServer.campaignId}`);
    await page.getByTestId("continue-button").click();
    await expect(page.getByText("ACTIVE PLAY")).toBeVisible();

    // Turn-zero: the opening scene lands first, as one narration with no
    // "YOU" line (empty playerMessage).
    await expect(page.getByTestId("narration")).toHaveCount(1, { timeout: 90_000 });
    await expect(page.getByTestId("player-message")).toHaveCount(0);

    const firstMessage = "First turn: I knock on the door.";
    const secondMessage = "Second turn: I open the door.";

    await page.getByTestId("turn-input").fill(firstMessage);
    await page.getByTestId("send-button").click();
    await expect(page.getByTestId("narration")).toHaveCount(2, { timeout: 90_000 });

    await page.getByTestId("turn-input").fill(secondMessage);
    await page.getByTestId("send-button").click();
    await expect(page.getByTestId("narration")).toHaveCount(3, { timeout: 90_000 });

    // UI order: each player message directly precedes its own narration, in
    // submission order — the opening (turn-zero) has no player-message block,
    // so the two player lines are nth(0)/nth(1) even though they map to the
    // 2nd/3rd narration blocks. This is exactly what a swapped/misattributed
    // transcript would get wrong.
    await expect(page.getByTestId("player-message")).toHaveCount(2);
    await expect(page.getByTestId("player-message").nth(0)).toHaveText(firstMessage);
    await expect(page.getByTestId("player-message").nth(1)).toHaveText(secondMessage);

    // Cross-check against the real, deterministic backend record — not
    // just "the UI shows the right counts," but that each turnIndex's
    // narration matches, with the opening at index 0 (empty playerMessage).
    const state = (await (
      await page.request.get(
        `${unopenedChronicleServer.baseURL}/campaigns/${unopenedChronicleServer.campaignId}/state`,
        { headers: { "X-Chronicle-Token": unopenedChronicleServer.token } }
      )
    ).json()) as {
      currentSessionLog?: {
        transcript: Array<{ turnIndex: number; playerMessage: string; narration: string }>;
      };
    };

    const transcript = state.currentSessionLog?.transcript ?? [];
    expect(transcript).toHaveLength(3);
    expect(transcript[0].turnIndex).toBe(0);
    expect(transcript[0].playerMessage).toBe(""); // turn-zero opening (ADR-0013)
    expect(transcript[1].turnIndex).toBe(1);
    expect(transcript[2].turnIndex).toBe(2);
    expect(transcript[1].playerMessage).toBe(firstMessage);
    expect(transcript[2].playerMessage).toBe(secondMessage);

    await expect(page.getByTestId("narration").nth(0)).toHaveText(transcript[0].narration);
    await expect(page.getByTestId("narration").nth(1)).toHaveText(transcript[1].narration);
    await expect(page.getByTestId("narration").nth(2)).toHaveText(transcript[2].narration);
  });
});
