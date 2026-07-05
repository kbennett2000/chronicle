import { defineConfig } from "@playwright/test";

// Tests point at a real chronicle backend (see tests/e2e/chronicle-server.ts)
// serving the built public/ output, not the Vite dev server — this is the
// same topology the app actually ships in, and it's the only way to
// exercise real GET/POST calls against the file-backed state.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    trace: "retain-on-failure",
  },
});
