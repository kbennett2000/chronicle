import { test, expect } from "./harness";
import { seedConnection } from "./connection";

// #97: the fields that gate "BEGIN THE TALE" (name, skills, expertise) sit near
// the top of a long scrolling form; the button is at the bottom. A user who
// filled the visible lower dials saw a dead, unexplained button. The button now
// carries a hint naming exactly what's still missing.

test.describe("New game — disabled button explains what's missing (#97)", () => {
  test("BEGIN THE TALE lists missing fields until they're satisfied", async ({ page, chronicleServer }) => {
    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await expect(page.getByTestId("campaign-card")).toBeVisible();
    await page.getByTestId("new-chronicle").click();
    await expect(page.getByText("NEW CHRONICLE")).toBeVisible();

    // Wizard: choose 2 skills, no expertise — a small, deterministic required set.
    await page.getByTestId("newchar-class").selectOption("Wizard");

    const button = page.getByTestId("newchar-create");
    const hint = page.getByTestId("newchar-missing");

    // Fresh form: button disabled, and the hint names what's missing.
    await expect(button).toBeDisabled();
    await expect(hint).toContainText("a name");
    await expect(hint).toContainText("2 more skills");

    // Give it a name — that item drops off the hint; skills still block.
    await page.getByTestId("newchar-name").fill("Hint Tester");
    await expect(hint).not.toContainText("a name");
    await expect(hint).toContainText("skill");
    await expect(button).toBeDisabled();

    // Pick the two Wizard skills — the hint clears and the button enables.
    await page.getByTestId("newchar-skill").nth(0).click();
    await page.getByTestId("newchar-skill").nth(1).click();
    await expect(hint).toHaveCount(0);
    await expect(button).toBeEnabled();
  });
});
