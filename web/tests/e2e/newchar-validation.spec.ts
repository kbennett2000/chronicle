import { test, expect } from "./harness";
import { seedConnection } from "./connection";

// #97: the fields that gate "BEGIN THE TALE" (name, skills, expertise) sit near
// the top of a long scrolling form; the button is at the bottom. A user who
// filled the visible lower dials saw a dead, unexplained button. The button now
// (a) names exactly what's still missing in a hint, and (b) is no longer a native
// `disabled` element — a tap while incomplete scrolls to the first blocking
// section instead of doing nothing.

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

    // Fresh form: the hint names what's missing and the button describes itself
    // by it (aria-describedby) so assistive tech announces the requirement.
    await expect(hint).toContainText("a name");
    await expect(hint).toContainText("2 more skills");
    await expect(button).toHaveAttribute("aria-describedby", "newchar-missing");

    // Give it a name — that item drops off the hint; skills still block.
    await page.getByTestId("newchar-name").fill("Hint Tester");
    await expect(hint).not.toContainText("a name");
    await expect(hint).toContainText("skill");

    // Pick the two Wizard skills — the hint clears and the button is ready.
    await page.getByTestId("newchar-skill").nth(0).click();
    await page.getByTestId("newchar-skill").nth(1).click();
    await expect(hint).toHaveCount(0);
    await expect(button).not.toHaveAttribute("aria-describedby", "newchar-missing");
  });

  test("tapping the still-disabled button guides to the first blocking section", async ({ page, chronicleServer }) => {
    await seedConnection(page, chronicleServer.baseURL, chronicleServer.token);
    await page.goto(`${chronicleServer.baseURL}/?campaign=${chronicleServer.campaignId}`);
    await page.getByTestId("new-chronicle").click();
    await expect(page.getByText("NEW CHRONICLE")).toBeVisible();
    await page.getByTestId("newchar-class").selectOption("Wizard");

    const button = page.getByTestId("newchar-create");
    // Scroll the button into view and tap it while the form is incomplete.
    await button.scrollIntoViewIfNeeded();
    await button.click();

    // The tap did NOT create a game (we're still on the form) and it pulled the
    // first blocker — the name field — into view.
    await expect(page.getByText("NEW CHRONICLE")).toBeVisible();
    await expect(page.getByTestId("newchar-name")).toBeInViewport();

    // Give a name, tap again: now the SKILLS section is the blocker and is scrolled to.
    await page.getByTestId("newchar-name").fill("Guided Wanderer");
    await button.scrollIntoViewIfNeeded();
    await button.click();
    await expect(page.getByTestId("newchar-skills-remaining")).toBeInViewport();
  });
});
