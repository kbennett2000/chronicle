import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect, campaignDir } from "./harness";
import { seedConnection } from "./connection";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const PORTRAIT_FIXTURE = path.join(REPO_ROOT, "docs/design/handoff-2026-07/assets/portrait-wren.png");

function writeNpcRoster(campaignId: string, markdown: string): void {
  fs.writeFileSync(campaignDir(campaignId, "npc-roster.md"), markdown);
}

function seedPortraitImage(campaignId: string, filename: string): void {
  const imagesDir = campaignDir(campaignId, "images");
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.copyFileSync(PORTRAIT_FIXTURE, path.join(imagesDir, filename));
}

async function openFolkPanel(page: import("@playwright/test").Page): Promise<void> {
  await page.getByTestId("continue-button").click();
  await expect(page.getByText("ACTIVE PLAY")).toBeVisible();
  await page.getByTestId("tab-folk").click();
}

test.describe("Folk panel (NPC roster)", () => {
  test("multiple NPCs, mixed with/without portraits, render name/disposition/knows", async ({
    page,
    chronicleServer,
  }) => {
    // Garrick's value carries image-generator.ts's "images/" relPath
    // prefix verbatim, per its own tool instructions — this also
    // exercises the basename-stripping fix in lib/useAuthedImage.ts.
    // Mother Yarrow uses the literal "(none yet)" placeholder the
    // template ships, which must read as no-portrait, not a filename.
    writeNpcRoster(
      chronicleServer.campaignId,
      `# NPC Roster

## Garrick
- **Description:** Stout gate guard in a mismatched breastplate.
- **Disposition:** Grateful and respectful.
- **Knows:** The watchtower lights are blue-green, after dark.
- **Portrait asset ID:** images/npc-garrick.jpg

## Mother Yarrow
- **Description:** An elderly Millhaven woman.
- **Disposition:** Unknown — no direct interaction yet.
- **Knows:** Recounts her grandmother's stories of the sealed tower.
- **Portrait asset ID:** (none yet)
`
    );
    seedPortraitImage(chronicleServer.campaignId, "npc-garrick.jpg");

    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await openFolkPanel(page);

    await expect(page.getByTestId("folk-npc")).toHaveCount(2);
    await expect(page.getByTestId("folk-npc-name").nth(0)).toHaveText("Garrick");
    await expect(page.getByTestId("folk-npc-disposition").nth(0)).toContainText("GRATEFUL");
    await expect(page.getByText("blue-green, after dark", { exact: false })).toBeVisible();

    // Garrick has a real, fetched portrait; Mother Yarrow does not.
    await expect(page.getByTestId("folk-portrait-image")).toHaveCount(1);
    const src = await page.getByTestId("folk-portrait-image").getAttribute("src");
    expect(src).toMatch(/^blob:/);
    await expect(page.getByTestId("folk-portrait-none")).toHaveCount(1);
    await expect(page.getByText("no likeness yet")).toBeVisible();
  });

  test("zero NPCs met yet: real empty state, not the template's literal placeholder heading", async ({
    page,
    chronicleServer,
  }) => {
    // Deliberately not seeding npc-roster.md — a fresh scratch campaign's
    // default template (scripts/scratch-campaign.ts's EMPTY_NPC_ROSTER)
    // ships an HTML-comment-wrapped "## <Name>" example entry, which
    // must NOT render as a bogus NPC.
    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await openFolkPanel(page);

    await expect(page.getByText("No one worth naming has crossed your path yet.")).toBeVisible();
    await expect(page.getByTestId("folk-npc")).toHaveCount(0);
    await expect(page.getByText("<Name>")).toHaveCount(0);
  });

  test("a section missing an expected field warns instead of crashing", async ({ page, chronicleServer }) => {
    writeNpcRoster(
      chronicleServer.campaignId,
      `# NPC Roster

## Barrow
- **Description:** Broad, balding innkeeper of the Gilded Antler.
- **Disposition:** Friendly and talkative.
`
    );

    const warnings: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "warning") warnings.push(msg.text());
    });

    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await openFolkPanel(page);

    // Renders what it does have — no crash, no error boundary — rather
    // than dropping the whole entry.
    await expect(page.getByTestId("folk-npc-name")).toHaveText("Barrow");
    await expect(page.getByText("Broad, balding innkeeper", { exact: false })).toBeVisible();

    expect(warnings.some((w) => w.includes("Barrow") && w.includes("Knows"))).toBe(true);
  });
});
