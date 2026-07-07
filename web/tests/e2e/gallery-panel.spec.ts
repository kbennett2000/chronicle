import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect, campaignDir } from "./harness";
import { seedConnection } from "./connection";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const PORTRAIT_FIXTURE = path.join(REPO_ROOT, "docs/design/handoff-2026-07/assets/portrait-wren.png");

function campaignPath(campaignId: string, ...parts: string[]): string {
  return campaignDir(campaignId, ...parts);
}

function writeCharacterSheet(campaignId: string, patch: Record<string, unknown>): void {
  const sheetPath = campaignPath(campaignId, "character-sheet.json");
  const sheet = JSON.parse(fs.readFileSync(sheetPath, "utf8"));
  fs.writeFileSync(sheetPath, JSON.stringify({ ...sheet, ...patch }, null, 2) + "\n");
}

function writeNpcRoster(campaignId: string, markdown: string): void {
  fs.writeFileSync(campaignPath(campaignId, "npc-roster.md"), markdown);
}

function writeWorldState(campaignId: string, markdown: string): void {
  fs.writeFileSync(campaignPath(campaignId, "world-state.md"), markdown);
}

function seedPortraitImage(campaignId: string, filename: string): void {
  const imagesDir = campaignPath(campaignId, "images");
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.copyFileSync(PORTRAIT_FIXTURE, path.join(imagesDir, filename));
}

async function openGalleryPanel(page: import("@playwright/test").Page): Promise<void> {
  await page.getByTestId("continue-button").click();
  await expect(page.getByText("ACTIVE PLAY")).toBeVisible();
  await page.getByTestId("tab-views").click();
}

test.describe("Views panel (gallery)", () => {
  test("mixed data: character + NPC + location, some with images, most without, plus lightbox open/close", async ({
    page,
    chronicleServer,
  }) => {
    writeCharacterSheet(chronicleServer.campaignId, { name: "Kira Emberfall", portraitImage: "images/character-kira.jpg" });
    seedPortraitImage(chronicleServer.campaignId, "character-kira.jpg");

    writeNpcRoster(
      chronicleServer.campaignId,
      `# NPC Roster

## Garrick
- **Description:** Stout gate guard.
- **Disposition:** Grateful.
- **Knows:** The watchtower lights.
- **Portrait asset ID:** (none yet)

## Barrow
- **Description:** Broad, balding innkeeper.
- **Disposition:** Friendly.
- **Knows:** Town rumors.
- **Portrait asset ID:** images/npc-barrow.jpg
`
    );
    seedPortraitImage(chronicleServer.campaignId, "npc-barrow.jpg");

    writeWorldState(
      chronicleServer.campaignId,
      `# World State

## Current Situation
Standing in Millhaven.

## Locations Visited
- **Millhaven (main street)** — a small trade town.
- **Old watchtower (exterior)** — squat grey stone tower.
  Image: images/location-watchtower.jpg

## Factions
_(none established yet)_
`
    );
    seedPortraitImage(chronicleServer.campaignId, "location-watchtower.jpg");

    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await openGalleryPanel(page);

    // 5 entities total (character, 2 NPCs, 2 locations); 3 illustrated.
    await expect(page.getByTestId("gallery-count")).toContainText("3 of 5 illustrated");
    await expect(page.getByTestId("gallery-tile")).toHaveCount(3);
    await expect(page.getByTestId("gallery-tile-empty")).toHaveCount(2);
    await expect(page.getByText("Garrick")).toBeVisible();

    await page.getByTestId("gallery-tile").filter({ hasText: "Barrow" }).click();
    await expect(page.getByTestId("gallery-lightbox")).toBeVisible();
    await expect(page.getByTestId("lightbox-image")).toBeVisible();
    await expect(page.getByTestId("gallery-lightbox").getByText("NPC", { exact: true })).toBeVisible();

    // Tapping anywhere on the lightbox (the scrim itself) closes it.
    await page.getByTestId("gallery-lightbox").click({ position: { x: 5, y: 5 } });
    await expect(page.getByTestId("gallery-lightbox")).toBeHidden();
  });

  test("zero images anywhere: grid still renders one real 'no likeness' tile per entity", async ({
    page,
    chronicleServer,
  }) => {
    // Deliberately not seeding any images or NPC/location entries — a
    // fresh scratch campaign has only its character, with no portrait.
    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await openGalleryPanel(page);

    await expect(page.getByTestId("gallery-count")).toContainText("0 of 1 illustrated");
    await expect(page.getByTestId("gallery-tile")).toHaveCount(0);
    await expect(page.getByTestId("gallery-tile-empty")).toHaveCount(1);
    await expect(page.getByText("— no likeness —")).toBeVisible();
  });

  test("Draw this surfaces the Grok failure reason instead of failing silently (issues #37/#42)", async ({
    page,
    chronicleServer,
  }) => {
    // The whole point of on-demand illustration (ADR-0009) is that a Grok
    // failure is visible. Mock the endpoint's domain error (HTTP 200 with
    // ok:false) so this stays deterministic without invoking the real
    // grok CLI, and assert the exact reason renders under the tile.
    await page.route(`**/campaigns/${chronicleServer.campaignId}/illustrate`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "Grok Build invocation failed: grok CLI not found on PATH" }),
      });
    });

    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await openGalleryPanel(page);

    await page.getByTestId("gallery-draw").click();
    await expect(page.getByTestId("gallery-draw-error")).toContainText("grok CLI not found");
  });

  test("sabotage: an image path with no file on disk falls back to a clean empty tile, not a broken image", async ({
    page,
    chronicleServer,
  }) => {
    // Barrow's portrait is recorded but the file was never actually
    // saved (e.g. image generation failed after the state file was
    // already written, or the file was since deleted) — useAuthedImage's
    // fetch-fails-to-null path (Slice 20/21) must carry over cleanly to
    // Views, the first panel exercising it across all three entity types
    // at once.
    writeNpcRoster(
      chronicleServer.campaignId,
      `# NPC Roster

## Barrow
- **Description:** Broad, balding innkeeper.
- **Disposition:** Friendly.
- **Knows:** Town rumors.
- **Portrait asset ID:** images/npc-barrow-missing.jpg
`
    );

    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await openGalleryPanel(page);

    await expect(page.getByTestId("gallery-count")).toContainText("0 of 2 illustrated");
    await expect(page.getByTestId("gallery-tile")).toHaveCount(0);
    await expect(page.getByTestId("gallery-tile-empty")).toHaveCount(2);
    await expect(page.getByText("Barrow")).toBeVisible();
    await expect(page.getByText("— no likeness —")).toHaveCount(2);
  });
});
