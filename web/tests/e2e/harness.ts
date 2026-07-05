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

/** `npx tsx src/server.ts` is not one process but two: tsx's own CLI
 * re-execs itself as a child to install its ESM loader hooks (confirmed
 * via `ps aux` — one "node .../tsx" wrapper plus one "node --require
 * .../loader.mjs" grandchild actually bound to the port), and npx may add
 * a third layer on top of that. A plain `proc.kill()` only signals the
 * immediate spawned process, never that grandchild — so every prior e2e
 * run leaked its real server process forever (298 confirmed still running
 * across old sessions before this fix), each one a live process quietly
 * consuming CPU/memory/FDs indefinitely. That accumulating pressure is
 * what made tests/e2e/turn.spec.ts — the one real, network-bound Agent
 * SDK call in the whole suite — intermittently fail with a reset
 * connection when run as part of a full suite (competing against however
 * many leaked servers had piled up) while reliably passing in isolation.
 * `detached: true` on spawn makes `proc` the leader of its own process
 * group (pid === pgid); signalling the negative pid kills that whole
 * group — wrapper, grandchild, and any layer in between — in one shot. */
function killServerTree(proc: ChildProcess): void {
  if (!proc.pid) {
    proc.kill();
    return;
  }
  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch {
    // Group may already be gone.
  }
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

  // Haiku, not the scratch template's sonnet default — this campaign is
  // disposable test fixture data, not a real story, so the fastest/
  // cheapest model is the right call for e2e turns that hit the real
  // Agent SDK (see tests/e2e/turn.spec.ts).
  fs.writeFileSync(
    path.join(dir, "campaign-settings.json"),
    JSON.stringify({ model: "claude-haiku-4-5" }, null, 2) + "\n"
  );
}

/** Reusable per-test fixture: boots a real chronicle backend against a
 * disposable scratch campaign (per CLAUDE.md test-data-hygiene — this is
 * exactly the "ad-hoc validation" case scripts/scratch-campaign.ts exists
 * for, so test-campaign itself is never touched or dirtied by e2e runs).
 * Every future UI slice's Playwright specs should import `test`/`expect`
 * from this file rather than re-deriving this setup.
 *
 * Deliberately test-scoped, not worker-scoped: a worker-scoped instance is
 * shared across every test in a file (and every file run by that worker),
 * so any test that submits a turn leaves state the next test wasn't
 * expecting — Slice 18 found this the hard way when adding a second
 * turn-submitting spec made an unrelated "fresh campaign" test fail,
 * because it was fresh several tests ago, not anymore. One server+
 * campaign per test costs a few extra seconds of boot time; it buys
 * actual isolation. */
async function bootServer(campaignId: string, use: (server: ChronicleTestServer) => Promise<void>): Promise<void> {
  const port = 4500 + Math.floor(Math.random() * 400);
  const baseURL = `http://127.0.0.1:${port}`;
  // detached: true makes this process the leader of its own process
  // group (pid === pgid) — see killServerTree below for why that matters.
  const proc: ChildProcess = spawn("npx", ["tsx", "src/server.ts"], {
    cwd: REPO_ROOT,
    env: { ...process.env, CHRONICLE_SHARED_SECRET: TOKEN, PORT: String(port), HOST: "127.0.0.1" },
    stdio: "pipe",
    detached: true,
  });

  let stderr = "";
  proc.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForReady(baseURL, TOKEN);
  } catch (err) {
    killServerTree(proc);
    runScratchScript(["delete", campaignId]);
    throw new Error(`${(err as Error).message}\n${stderr}`);
  }

  await use({ baseURL, token: TOKEN, campaignId });

  killServerTree(proc);
  runScratchScript(["delete", campaignId]);
}

export const test = base.extend<{ chronicleServer: ChronicleTestServer; freshChronicleServer: ChronicleTestServer }, object>({
  chronicleServer: async ({}, use) => {
    const campaignId = runScratchScript(["create"]);
    seedCampaignContent(campaignId);
    await bootServer(campaignId, use);
  },

  // Deliberately unseeded — scratch-campaign.ts's own blank defaults, not
  // seedCampaignContent's fixture prose. Some scenarios (issue #33's
  // black-screen-on-first-connect) only reproduce against a campaign that
  // has genuinely never been touched, since seeded content or a stored
  // client-side connection can mask the exact bug being verified.
  freshChronicleServer: async ({}, use) => {
    const campaignId = runScratchScript(["create"]);
    await bootServer(campaignId, use);
  },
});

export { expect };
