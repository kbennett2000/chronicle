import fs from "node:fs";
import { test, expect, campaignDir } from "./harness";
import { seedConnection } from "./connection";

function writeQuestLog(campaignId: string, markdown: string): void {
  fs.writeFileSync(campaignDir(campaignId, "quest-log.md"), markdown);
}

async function openQuestPanel(page: import("@playwright/test").Page): Promise<void> {
  await page.getByTestId("continue-button").click();
  await expect(page.getByText("ACTIVE PLAY")).toBeVisible();
  await page.getByTestId("tab-quest").click();
}

test.describe("Quest panel (quest log)", () => {
  test("active quest with progress notes, plus a completed quest, render correctly", async ({
    page,
    chronicleServer,
  }) => {
    writeQuestLog(
      chronicleServer.campaignId,
      `# Quest Log

## Active
- **Strange lights at the watchtower** — rumor brought Kira to Millhaven.
  Garrick says the lights are blue-green, after dark.
  - First tower foray (day 2): reached the first landing, driven off by a
    giant spider.
  - **Tobin RESCUED (day 3):** carried out to Millhaven.

## Completed
- **Cross the Greywood** — reached Millhaven before nightfall.
`
    );

    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await openQuestPanel(page);

    await expect(page.getByTestId("quest-active")).toHaveCount(1);
    await expect(page.getByTestId("quest-title")).toHaveText("Strange lights at the watchtower");
    await expect(page.getByTestId("quest-detail")).toContainText("rumor brought Kira to Millhaven");
    await expect(page.getByTestId("quest-detail")).toContainText("blue-green, after dark");
    await expect(page.getByTestId("quest-progress")).toHaveCount(2);
    await expect(page.getByTestId("quest-progress").nth(0)).toContainText("giant spider");
    await expect(page.getByTestId("quest-progress").nth(1)).toContainText("Tobin RESCUED");

    await expect(page.getByTestId("quest-completed")).toHaveCount(1);
    await expect(page.getByTestId("quest-completed-title")).toHaveText("Cross the Greywood");
  });

  test("zero quests yet: real empty state, not the template's placeholder text", async ({ page, chronicleServer }) => {
    // Deliberately not seeding quest-log.md — a fresh scratch campaign's
    // default template (scripts/scratch-campaign.ts's EMPTY_QUEST_LOG)
    // ships "_(none yet)_" under both headings, which must render as a
    // clean empty state, not a bogus quest entry.
    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await openQuestPanel(page);

    await expect(page.getByText("No thread worth tracking has begun yet.")).toBeVisible();
    await expect(page.getByTestId("quest-active")).toHaveCount(0);
    await expect(page.getByTestId("quest-completed")).toHaveCount(0);
    await expect(page.getByText("(none yet)", { exact: false })).toHaveCount(0);
  });

  test("a malformed Active heading warns instead of crashing, and renders no quests", async ({
    page,
    chronicleServer,
  }) => {
    // Sabotage: misspell the "## Active" heading the way a DM-engine
    // system-prompt drift would — findMarkdownSection's console.warn
    // discipline (lib/markdown.ts) should fire, and the panel should fall
    // back to its empty state rather than crash.
    writeQuestLog(
      chronicleServer.campaignId,
      `# Quest Log

## Actve
- **Strange lights at the watchtower** — rumor brought Kira to Millhaven.

## Completed
_(none yet)_
`
    );

    const warnings: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "warning") warnings.push(msg.text());
    });

    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await openQuestPanel(page);

    await expect(page.getByTestId("quest-active")).toHaveCount(0);
    await expect(page.getByText("No thread worth tracking has begun yet.")).toBeVisible();
    expect(warnings.some((w) => w.includes("Active"))).toBe(true);
  });
});
