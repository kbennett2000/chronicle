import { defineConfig } from "@playwright/test";

// tests/e2e/* point at a real chronicle backend (see tests/e2e/harness.ts)
// serving the built public/ output, not the Vite dev server — this is the
// same topology the app actually ships in, and it's the only way to
// exercise real GET/POST calls against the file-backed state. Plain
// source-consistency checks (tests/heading-consistency.spec.ts) live
// outside e2e/ and need no server or browser.
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    trace: "retain-on-failure",
  },
  // ADR-0021: the app now branches layout at 900px. The original suite was
  // written against the mobile layout (bottom-sheet panels, bottom tab bar) but
  // ran at Playwright's 1280 default — which is now the *desktop* layout. Pin the
  // main suite to a phone viewport so it keeps testing what it was written for,
  // and put the desktop-only specs (desktop-*.spec.ts) in their own wide-viewport
  // project.
  projects: [
    {
      name: "mobile",
      testIgnore: "**/desktop-*.spec.ts",
      use: { viewport: { width: 390, height: 844 } },
    },
    {
      name: "desktop",
      testMatch: "**/desktop-*.spec.ts",
      use: { viewport: { width: 1280, height: 800 } },
    },
  ],
});
