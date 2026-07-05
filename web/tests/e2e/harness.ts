import { test as base, expect } from "@playwright/test";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const TOKEN = "e2e-harness-token";

export interface ChronicleTestServer {
  baseURL: string;
  token: string;
  campaignId: string;
}

function runScratchScript(args: string[]): string {
  return execFileSync("npx", ["tsx", "scripts/scratch-campaign.ts", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
}

async function waitForReady(baseURL: string, token: string, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseURL}/models`, { headers: { "X-Chronicle-Token": token } });
      if (res.status === 200) return;
    } catch {
      // not listening yet — keep polling
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`chronicle server at ${baseURL} did not become ready in time`);
}

/** Seeds the scratch campaign with deterministic content so assertions on
 * rendered state check against known values, not the scratch template's
 * blank defaults. */
function seedCampaignContent(campaignId: string): void {
  const dir = path.join(REPO_ROOT, "campaigns", campaignId);

  const sheetPath = path.join(dir, "character-sheet.json");
  const sheet = JSON.parse(fs.readFileSync(sheetPath, "utf8"));
  sheet.name = "Testa Trialwright";
  sheet.race = "Gnome";
  sheet.class = "Wizard";
  sheet.level = 5;
  fs.writeFileSync(sheetPath, JSON.stringify(sheet, null, 2) + "\n");

  fs.writeFileSync(
    path.join(dir, "world-state.md"),
    `# World State

## Current Situation
Standing at the edge of a test fixture, wondering if the harness works.

## Locations Visited
_(none yet)_

## Factions
_(none established yet)_
`
  );
}

/** Reusable worker-scoped fixture: boots a real chronicle backend against a
 * disposable scratch campaign (per CLAUDE.md test-data-hygiene — this is
 * exactly the "ad-hoc validation" case scripts/scratch-campaign.ts exists
 * for, so test-campaign itself is never touched or dirtied by e2e runs).
 * Every future UI slice's Playwright specs should import `test`/`expect`
 * from this file rather than re-deriving this setup. */
export const test = base.extend<object, { chronicleServer: ChronicleTestServer }>({
  chronicleServer: [
    async ({}, use) => {
      const campaignId = runScratchScript(["create"]);
      seedCampaignContent(campaignId);

      const port = 4500 + Math.floor(Math.random() * 400);
      const baseURL = `http://127.0.0.1:${port}`;
      const proc: ChildProcess = spawn("npx", ["tsx", "src/server.ts"], {
        cwd: REPO_ROOT,
        env: { ...process.env, CHRONICLE_SHARED_SECRET: TOKEN, PORT: String(port), HOST: "127.0.0.1" },
        stdio: "pipe",
      });

      let stderr = "";
      proc.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      try {
        await waitForReady(baseURL, TOKEN);
      } catch (err) {
        proc.kill();
        runScratchScript(["delete", campaignId]);
        throw new Error(`${(err as Error).message}\n${stderr}`);
      }

      await use({ baseURL, token: TOKEN, campaignId });

      proc.kill();
      runScratchScript(["delete", campaignId]);
    },
    { scope: "worker" },
  ],
});

export { expect };
