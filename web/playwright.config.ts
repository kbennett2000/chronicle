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
});
