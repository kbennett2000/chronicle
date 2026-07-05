import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect } from "./harness";
import { seedConnection } from "./connection";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

test.describe("Resume shows prior turns (issue #49)", () => {
  test("Continue surfaces an existing session's transcript, not 'the tale hasn't begun'", async ({
    page,
    chronicleServer,
  }) => {
    // Seed a prior session's log + transcript directly on disk (no Agent SDK
    // needed). This is the exact shape #49 broke on: real history exists, but
    // the campaign has no persisted .session-id, so Continue starts a fresh
    // empty log — and /state must still fall back to the log that has turns.
    const logDir = path.join(REPO_ROOT, "campaigns", chronicleServer.campaignId, "session-log");
    const base = "session-2020-01-01T00-00-00-000Z";
    fs.writeFileSync(path.join(logDir, `${base}.md`), `# ${base}\n\nThe seeded hall.\n`);
    fs.writeFileSync(
      path.join(logDir, `${base}.transcript.jsonl`),
      [
        JSON.stringify({
          turnIndex: 0,
          timestamp: "2020-01-01T00:00:00.000Z",
          playerMessage: "look around",
          narration: "You stand in the seeded hall, torches guttering.",
        }),
        JSON.stringify({
          turnIndex: 1,
          timestamp: "2020-01-01T00:01:00.000Z",
          playerMessage: "press on",
          narration: "The seeded corridor bends north toward a distant hum.",
        }),
      ].join("\n") + "\n"
    );

    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await page.getByTestId("continue-button").click();
    await expect(page.getByText("ACTIVE PLAY")).toBeVisible();

    // The seeded narration renders; the empty-state copy does not.
    await expect(page.getByText("You stand in the seeded hall, torches guttering.")).toBeVisible();
    await expect(page.getByText("The seeded corridor bends north toward a distant hum.")).toBeVisible();
    await expect(page.getByText("The tale hasn't begun — say what you do.")).toHaveCount(0);
  });
});
