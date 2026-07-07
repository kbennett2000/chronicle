import { test, expect } from "./harness";
import { seedConnection } from "./connection";

// Issue #114: the main Settings screen (reached from Home) edits the signed-in
// account's DEFAULTS — the engine, look, and world every NEW chronicle inherits
// — via POST /me/settings. It no longer touches whatever game is "active", and
// the engine no longer rides POST /session/start (that path, and its mid-game
// crash, is gone from this screen). Per-game editing lives on the in-game
// settings screen — see gamesettings.spec.ts.

async function readUserDefaults(
  page: import("@playwright/test").Page,
  baseURL: string,
  token: string
): Promise<Record<string, unknown>> {
  const res = await page.request.get(`${baseURL}/me/settings`, {
    headers: { "X-Chronicle-Token": token },
  });
  return res.json();
}

test.describe("Settings screen — account defaults (#114)", () => {
  test("Engine: choosing a model saves it as the account default via POST /me/settings", async ({
    page,
    chronicleServer,
  }) => {
    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await expect(page.getByTestId("campaign-card")).toBeVisible();
    await page.getByText("SETTINGS", { exact: true }).click();

    // The default engine is Claude, so its three models are offered.
    await expect(page.getByTestId("model-option")).toHaveCount(3);

    // The change must ride POST /me/settings, never a per-campaign endpoint or
    // a session/start (both would be the old, muddled behavior).
    const campaignSettingsPosts: string[] = [];
    const sessionStarts: string[] = [];
    page.on("request", (req) => {
      if (req.method() !== "POST") return;
      if (req.url().includes(`/campaigns/${chronicleServer.campaignId}/settings`)) campaignSettingsPosts.push(req.url());
      if (req.url().includes("/session/start")) sessionStarts.push(req.url());
    });
    const meSettingsPost = page.waitForRequest(
      (req) => req.url().endsWith("/me/settings") && req.method() === "POST"
    );

    await page.getByTestId("model-option").filter({ hasText: "Opus 4.8" }).click();

    expect((await meSettingsPost).postDataJSON()).toMatchObject({ model: "claude-opus-4-8" });
    expect(campaignSettingsPosts).toEqual([]);
    expect(sessionStarts).toEqual([]);

    await expect(page.getByTestId("model-save-status")).toContainText("Saved as your default engine");
    await expect(page.getByTestId("model-option").filter({ hasText: "Opus 4.8" })).toHaveAttribute(
      "data-selected",
      "true"
    );

    // Persisted account-side, not just a visually-updated radio button.
    const persisted = await readUserDefaults(page, chronicleServer.baseURL, chronicleServer.token);
    expect(persisted.model).toBe("claude-opus-4-8");

    // Reload the whole app and revisit Settings — still reflects the change.
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await page.getByText("SETTINGS", { exact: true }).click();
    await expect(page.getByTestId("model-option").filter({ hasText: "Opus 4.8" })).toHaveAttribute(
      "data-selected",
      "true"
    );
  });

  test("Engine: switching provider saves the default engine + its default model to /me/settings", async ({
    page,
    chronicleServer,
  }) => {
    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await expect(page.getByTestId("campaign-card")).toBeVisible();
    await page.getByText("SETTINGS", { exact: true }).click();

    await expect(page.getByTestId("provider-option")).toHaveCount(2);
    await expect(page.getByTestId("provider-option").filter({ hasText: "Claude" })).toHaveAttribute(
      "data-selected",
      "true"
    );
    await expect(page.getByTestId("model-option")).toHaveCount(3);

    const meSettingsPost = page.waitForRequest(
      (req) => req.url().endsWith("/me/settings") && req.method() === "POST"
    );
    await page.getByTestId("provider-option").filter({ hasText: "Grok" }).click();

    // Switching the default engine also sets that engine's default model.
    expect((await meSettingsPost).postDataJSON()).toMatchObject({ provider: "grok", model: "grok-build" });

    await expect(page.getByTestId("provider-option").filter({ hasText: "Grok" })).toHaveAttribute(
      "data-selected",
      "true"
    );
    await expect(page.getByTestId("model-option")).toHaveCount(2);

    const persisted = await readUserDefaults(page, chronicleServer.baseURL, chronicleServer.token);
    expect(persisted.provider).toBe("grok");
    expect(persisted.model).toBe("grok-build");
  });

  test("Look + World: toggles and text save to /me/settings and survive reload", async ({
    page,
    chronicleServer,
  }) => {
    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await page.getByText("SETTINGS", { exact: true }).click();

    await expect(page.getByTestId("images-toggle")).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("images-toggle").click();
    await expect(page.getByTestId("look-save-status")).toContainText("Saved as your default");
    await expect(page.getByTestId("images-toggle")).toHaveAttribute("aria-pressed", "true");

    await page.getByTestId("world-setting-input").fill("underwater merfolk city-states");
    await page.getByTestId("world-setting-input").blur();
    await expect(page.getByTestId("world-save-status")).toContainText("Saved as your default");

    const persisted = await readUserDefaults(page, chronicleServer.baseURL, chronicleServer.token);
    expect(persisted.generateImages).toBe(true);
    expect(persisted.worldSetting).toBe("underwater merfolk city-states");

    // These are account defaults — the active game's own settings are untouched.
    const campaignSettings = await page.request
      .get(`${chronicleServer.baseURL}/campaigns/${chronicleServer.campaignId}/settings`, {
        headers: { "X-Chronicle-Token": chronicleServer.token },
      })
      .then((r) => r.json());
    expect(campaignSettings.worldSetting).not.toBe("underwater merfolk city-states");

    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await page.getByText("SETTINGS", { exact: true }).click();
    await expect(page.getByTestId("images-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("world-setting-input")).toHaveValue("underwater merfolk city-states");
  });

  test("Hearth: Save & Reconnect gives feedback and returns Home on success (issue #35)", async ({
    page,
    chronicleServer,
  }) => {
    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await expect(page.getByTestId("campaign-card")).toBeVisible();
    await page.getByText("SETTINGS", { exact: true }).click();

    await expect(page.getByTestId("save-reconnect")).toBeVisible();
    await page.getByTestId("save-reconnect").click();
    await expect(page.getByTestId("campaign-card")).toBeVisible();
  });

  test("a failed defaults save surfaces its own error status, not a silent no-op", async ({ page, chronicleServer }) => {
    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await page.getByText("SETTINGS", { exact: true }).click();
    await expect(page.getByTestId("images-toggle")).toBeVisible();

    // Sabotage: break the auth header for just the /me/settings POST so the
    // request genuinely fails server-side (401).
    await page.route("**/me/settings", async (route) => {
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
