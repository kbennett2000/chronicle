import { test, expect } from "./harness";

test.describe("Cross-origin connection (issue #34)", () => {
  test("loading from one origin and configuring a different-but-reachable origin succeeds", async ({
    page,
    crossOriginChronicleServer,
  }) => {
    const { baseURL, token, campaignId } = crossOriginChronicleServer;
    const port = new URL(baseURL).port;
    // "localhost" and "127.0.0.1" are different origins to the browser even
    // though both reach this same 0.0.0.0-bound server — loading from one
    // and configuring the other in Hearth is exactly issue #34's repro
    // (one address to reach the page, a different legitimate address
    // configured for the API), without depending on a real LAN IP.
    await page.goto(`http://127.0.0.1:${port}/?campaign=${campaignId}`);
    await expect(page.getByText("THE HEARTH")).toBeVisible();

    await page.locator('input[placeholder="192.168.1.24:4317"]').fill(`localhost:${port}`);
    await page.locator('input[type="password"]').fill(token);

    const corsErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && /CORS/i.test(msg.text())) corsErrors.push(msg.text());
    });

    await page.getByRole("button", { name: "SAVE & RECONNECT" }).click();
    // Issue #35: a successful (cross-origin, CORS-clean) reconnect now lands
    // on Home directly rather than staying on Settings.
    await expect(page.getByText("CHRONICLE", { exact: true })).toBeVisible({ timeout: 10_000 });
    expect(corsErrors).toEqual([]);
  });

  test("a genuinely different origin with no server there reports origin-mismatch, not a generic unreachable message", async ({
    page,
    crossOriginChronicleServer,
  }) => {
    const { baseURL, campaignId } = crossOriginChronicleServer;
    const port = new URL(baseURL).port;

    await page.goto(`http://127.0.0.1:${port}/?campaign=${campaignId}`);
    await expect(page.getByText("THE HEARTH")).toBeVisible();

    // A different origin (by hostname) than the page's own — reachable or
    // not doesn't matter for this assertion, since a mismatched origin is
    // knowable client-side before the request even completes (see
    // lib/api.ts's checkConnection). Using "localhost" against a port
    // nothing listens on keeps this deterministic without another server.
    await page.locator('input[placeholder="192.168.1.24:4317"]').fill("localhost:1");
    await page.locator('input[type="password"]').fill("whatever");
    await page.getByRole("button", { name: "SAVE & RECONNECT" }).click();

    await expect(
      page.getByText("This page was loaded from a different address — reload the app from the address above")
    ).toBeVisible({ timeout: 10_000 });
  });

  test("sabotage: a same-origin unreachable address still reports the generic unreachable message", async ({
    page,
    crossOriginChronicleServer,
  }) => {
    const { baseURL, campaignId, stop } = crossOriginChronicleServer;
    const port = new URL(baseURL).port;

    await page.goto(`http://127.0.0.1:${port}/?campaign=${campaignId}`);
    await expect(page.getByText("THE HEARTH")).toBeVisible();

    // Exact same origin the page itself loaded from — an "origin mismatch"
    // is impossible to construct here by definition (a mismatched origin
    // can't be the one that served this page), so the only way to get a
    // genuine same-origin failure is the server actually going away after
    // load. That's the real-world case this message must still cover
    // correctly: not every unreachable address is an origin mismatch.
    await page.locator('input[placeholder="192.168.1.24:4317"]').fill(`127.0.0.1:${port}`);
    await page.locator('input[type="password"]').fill("whatever");
    stop();
    await page.getByRole("button", { name: "SAVE & RECONNECT" }).click();

    await expect(page.getByText(/Could not reach that address/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/different address/)).toHaveCount(0);
  });
});
