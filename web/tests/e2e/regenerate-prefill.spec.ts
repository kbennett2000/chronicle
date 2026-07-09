import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect, campaignDir } from "./harness";
import { seedConnection } from "./connection";

// #132: the regenerate-image box pre-fills with the caption that made the
// current image (the turn's stored sceneCaption), so the player tweaks it
// instead of retyping — and falls back to blank on old, pre-caption turns.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const IMAGE_FIXTURE = path.join(REPO_ROOT, "docs/design/handoff-2026-07/assets/portrait-wren.png");

const CAPTION = "a lone knight on a misty stone causeway at dawn, lantern raised against the fog";

/** Overwrites the fixture campaign's seeded session log with two illustrated
 * moments: turn 0 carries a scene caption; turn 1 (a real player turn) has an
 * image but no caption (an old, pre-caption turn). Both get a real image file
 * on disk so the "↻ Regenerate image" affordance appears. */
function seedIllustratedMoments(campaignId: string): void {
  const imagesDir = campaignDir(campaignId, "images");
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.copyFileSync(IMAGE_FIXTURE, path.join(imagesDir, "scene-0.png"));
  fs.copyFileSync(IMAGE_FIXTURE, path.join(imagesDir, "scene-1.png"));

  const logDir = campaignDir(campaignId, "session-log");
  const base = fs
    .readdirSync(logDir)
    .find((f) => f.endsWith(".transcript.jsonl"))!
    .replace(/\.transcript\.jsonl$/, "");
  fs.writeFileSync(
    path.join(logDir, `${base}.transcript.jsonl`),
    [
      JSON.stringify({
        turnIndex: 0,
        timestamp: "2020-01-01T00:00:00.000Z",
        playerMessage: "",
        narration: "The causeway stretches into the fog as your tale begins.",
        image: "images/scene-0.png",
        sceneCaption: CAPTION,
      }),
      JSON.stringify({
        turnIndex: 1,
        timestamp: "2020-01-01T00:01:00.000Z",
        playerMessage: "I press onward across the causeway.",
        narration: "Your boots find the wet stone as the lantern gutters.",
        image: "images/scene-1.png",
        // deliberately no sceneCaption — an old, pre-caption turn
      }),
    ].join("\n") + "\n"
  );
}

// #142: the caption the server drew from is echoed on the /illustrate response
// and adopted by the client, so a fresh, omitted-caption turn (whose original
// turn response was captionless because the DM omitted [SCENE:] and the server
// backfilled it after responding) still pre-fills its regenerate box.
const BACKFILLED_CAPTION = "a torchlit hall of long shadows, dust hanging in the amber light";

test.describe("Regenerate box adopts the /illustrate caption (#142)", () => {
  test("illustrating a captionless turn pre-fills the regenerate box with the returned caption", async ({
    page,
    chronicleServer,
  }) => {
    // The default fixture seeds a captionless opening turn 0 (narration, no image,
    // no sceneCaption) — exactly an omitted-caption turn. Give it a real image
    // file so the applied relPath renders, then stub /illustrate to return the
    // (backfilled) caption alongside the image, as the fixed server now does.
    const imagesDir = campaignDir(chronicleServer.campaignId, "images");
    fs.mkdirSync(imagesDir, { recursive: true });
    fs.copyFileSync(IMAGE_FIXTURE, path.join(imagesDir, "scene-0.png"));

    await page.route("**/campaigns/*/illustrate", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          relPath: "images/scene-0.png",
          turnIndex: 0,
          sceneCaption: BACKFILLED_CAPTION,
        }),
      });
    });

    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await page.getByTestId("continue-button").click();
    await expect(page.getByText("ACTIVE PLAY")).toBeVisible();

    // Captionless turn → the "Illustrate this moment" affordance, not regenerate.
    await page.getByTestId("illustrate-moment").click();

    // Once the stubbed image + caption land, the affordance flips to Regenerate;
    // opening it pre-fills the caption the server returned (blank before #142).
    await page.getByTestId("regenerate-moment").click();
    await expect(page.getByTestId("regenerate-input")).toHaveValue(BACKFILLED_CAPTION);
  });
});

test.describe("Regenerate-image description prefill (#132)", () => {
  test("prefills the stored caption when present, and is blank when absent", async ({
    page,
    chronicleServer,
  }) => {
    seedIllustratedMoments(chronicleServer.campaignId);

    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await page.getByTestId("continue-button").click();
    await expect(page.getByText("ACTIVE PLAY")).toBeVisible();

    // Both seeded moments hydrate, each with its "↻ Regenerate image" button.
    // (Opening a box swaps that turn's button out for the textarea, so assert
    // one at a time — turn 1 first, then turn 0 — to keep the locators simple.)
    await expect(page.getByTestId("regenerate-moment")).toHaveCount(2);

    // Turn 1 (no caption): the box stays blank — today's fallback behavior.
    await page.getByTestId("regenerate-moment").nth(1).click();
    await expect(page.getByTestId("regenerate-input")).toHaveValue("");

    // Turn 0 (has a caption): opening its box pre-fills the exact caption. Its
    // card precedes turn 1's in the log, so it's the first textarea in the DOM.
    await page.getByTestId("regenerate-moment").nth(0).click();
    await expect(page.getByTestId("regenerate-input").nth(0)).toHaveValue(CAPTION);
  });
});
