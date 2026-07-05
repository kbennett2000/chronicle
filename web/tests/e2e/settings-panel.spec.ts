import { test, expect } from "./harness";
import { seedConnection } from "./connection";

async function readCampaignSettings(
  page: import("@playwright/test").Page,
  baseURL: string,
  token: string,
  campaignId: string
): Promise<Record<string, unknown>> {
  const res = await page.request.get(`${baseURL}/campaigns/${campaignId}/settings`, {
    headers: { "X-Chronicle-Token": token },
  });
  return res.json();
}

test.describe("Settings screen", () => {
  test("Engine: model choice hits POST /session/start (never /settings), and persists across reload", async ({
    page,
    chronicleServer,
  }) => {
    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await expect(page.getByTestId("campaign-card")).toBeVisible();
    await page.getByText("SETTINGS", { exact: true }).click();

    await expect(page.getByTestId("model-option")).toHaveCount(3);
    // harness.ts's seedCampaignContent sets this fixture's model to
    // claude-haiku-4-5 (cheap/fast for e2e turns), not the app's own
    // sonnet default — asserting against the real seeded value here.
    await expect(page.getByTestId("model-option").filter({ hasText: "Haiku 4.5" })).toHaveAttribute(
      "data-selected",
      "true"
    );

    const settingsRequests: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes(`/campaigns/${chronicleServer.campaignId}/settings`)) {
        settingsRequests.push(req.url());
      }
    });
    const sessionStartRequest = page.waitForRequest(
      (req) => req.url().includes("/session/start") && req.method() === "POST"
    );

    await page.getByTestId("model-option").filter({ hasText: "Opus 4.8" }).click();

    const request = await sessionStartRequest;
    const postedBody = request.postDataJSON();
    expect(postedBody).toEqual({ model: "claude-opus-4-8" });
    expect(settingsRequests).toEqual([]); // never hit POST /settings for a model change

    await expect(page.getByTestId("model-save-status")).toContainText("Model updated");
    await expect(page.getByTestId("model-option").filter({ hasText: "Opus 4.8" })).toHaveAttribute(
      "data-selected",
      "true"
    );

    // Confirmed server-side, not just a visually-updated radio button.
    const persisted = await readCampaignSettings(
      page,
      chronicleServer.baseURL,
      chronicleServer.token,
      chronicleServer.campaignId
    );
    expect(persisted.model).toBe("claude-opus-4-8");

    // Reload the whole app and revisit Settings — still reflects the change.
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await page.getByText("SETTINGS", { exact: true }).click();
    await expect(page.getByTestId("model-option").filter({ hasText: "Opus 4.8" })).toHaveAttribute(
      "data-selected",
      "true"
    );
  });

  test("Look: generateImages toggle and a custom art style persist via POST /settings", async ({
    page,
    chronicleServer,
  }) => {
    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await page.getByText("SETTINGS", { exact: true }).click();

    await expect(page.getByTestId("images-toggle")).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("images-toggle").click();
    await expect(page.getByTestId("look-save-status")).toContainText("Saved");
    await expect(page.getByTestId("images-toggle")).toHaveAttribute("aria-pressed", "true");

    await page.getByTestId("art-custom-input").fill("stained glass");
    await page.getByTestId("art-custom-input").blur();
    await expect(page.getByTestId("look-save-status")).toContainText("Saved");

    const persisted = await readCampaignSettings(
      page,
      chronicleServer.baseURL,
      chronicleServer.token,
      chronicleServer.campaignId
    );
    expect(persisted.generateImages).toBe(true);
    expect(persisted.artStyle).toBe("stained glass");

    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await page.getByText("SETTINGS", { exact: true }).click();
    await expect(page.getByTestId("images-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("art-custom-input")).toHaveValue("stained glass");
  });

  test("World: worldSetting, tone/whimsy, and content intensity all persist via POST /settings", async ({
    page,
    chronicleServer,
  }) => {
    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await page.getByText("SETTINGS", { exact: true }).click();

    await page.getByTestId("world-setting-input").fill("underwater merfolk city-states");
    await page.getByTestId("world-setting-input").blur();
    await expect(page.getByTestId("world-save-status")).toContainText("Saved");

    await page.getByTestId("whimsy-slider").focus();
    await page.getByTestId("whimsy-slider").press("End"); // range input -> max (1)
    await expect(page.getByTestId("whimsy-label")).toHaveText("Deeply strange");
    await expect(page.getByTestId("world-save-status")).toContainText("Saved");

    await page.getByTestId("intensity-option").filter({ hasText: "Low" }).click();
    await expect(page.getByTestId("intensity-option").filter({ hasText: "Low" })).toHaveAttribute(
      "data-selected",
      "true"
    );

    const persisted = await readCampaignSettings(
      page,
      chronicleServer.baseURL,
      chronicleServer.token,
      chronicleServer.campaignId
    );
    expect(persisted.worldSetting).toBe("underwater merfolk city-states");
    expect(persisted.toneWhimsy).toBe(1);
    expect(persisted.contentIntensity).toBe("low");

    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await page.getByText("SETTINGS", { exact: true }).click();
    await expect(page.getByTestId("world-setting-input")).toHaveValue("underwater merfolk city-states");
    await expect(page.getByTestId("whimsy-label")).toHaveText("Deeply strange");
    await expect(page.getByTestId("intensity-option").filter({ hasText: "Low" })).toHaveAttribute(
      "data-selected",
      "true"
    );
  });

  test("a failed settings save surfaces its own error status, not a silent no-op", async ({ page, chronicleServer }) => {
    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await page.getByText("SETTINGS", { exact: true }).click();
    await expect(page.getByTestId("images-toggle")).toBeVisible();

    // Sabotage: break the auth header for just the settings POST so the
    // request genuinely fails server-side (401), same "confirm it can
    // fail" discipline as every prior panel's malformed-input case.
    await page.route(`**/campaigns/${chronicleServer.campaignId}/settings`, async (route) => {
      if (route.request().method() === "POST") {
        await route.continue({ headers: { ...route.request().headers(), "x-chronicle-token": "wrong-token" } });
      } else {
        await route.continue();
      }
    });

    await page.getByTestId("images-toggle").click();
    await expect(page.getByTestId("look-save-status")).toContainText("Couldn't save");
  });
});
