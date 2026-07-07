import { test as base, expect } from "@playwright/test";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { userIdForUsername, USERS_ROOT } from "../../../src/user-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
// ADR-0019: auth is per-user. The harness registers a dedicated user and owns
// its scratch campaigns under that user's dir; `token` is that user's session
// token (obtained from the server after boot), not a shared secret.
const HARNESS_USERNAME = "e2e-harness-user";
const HARNESS_PASSWORD = "e2e-harness-pass";
const HARNESS_USER_ID = userIdForUsername(HARNESS_USERNAME);

export interface ChronicleTestServer {
  baseURL: string;
  token: string;
  campaignId: string;
  /** Kills the backend process early, before the fixture's own teardown —
   * for tests that need to simulate the server going away mid-session
   * (e.g. a same-origin address that was reachable at page load but isn't
   * anymore). Safe to call more than once; the fixture's teardown no-ops
   * if this already ran. */
  stop: () => void;
}

function runScratchScript(args: string[]): string {
  return execFileSync("npx", ["tsx", "scripts/scratch-campaign.ts", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
}

/** Create a scratch campaign owned by the harness user (ADR-0019). */
function createScratchCampaign(): string {
  return runScratchScript(["create", "--user", HARNESS_USERNAME]);
}

function deleteScratchCampaign(campaignId: string): string {
  return runScratchScript(["delete", campaignId, "--user", HARNESS_USERNAME]);
}

/** Issue #114: the account defaults (users/<id>/settings.json) are now editable
 * from the main Settings screen and inherited by every NEW campaign. They live
 * on disk for the reused harness user, so a spec that changes them (e.g. the
 * settings-panel specs switching the default engine) would otherwise leak into
 * every later spec — a freshly-created campaign inheriting a switched engine,
 * the Settings screen opening on a polluted state, etc. Reset to a clean slate
 * per test so the suite stays order-independent. Music is deliberately left out:
 * the server's DEFAULT_MUSIC_* env provides the fallback the mute specs rely on,
 * so an empty defaults file is exactly the right clean baseline. */
function resetHarnessUserDefaults(): void {
  const file = path.join(USERS_ROOT, HARNESS_USER_ID, "settings.json");
  try {
    fs.writeFileSync(file, "{}\n");
  } catch {
    // best-effort — if the user dir isn't there yet, authenticate() creates it
  }
}

/** Register (or log in, if a prior run already created it) the harness user and
 * return its session token — the value every spec sends as X-Chronicle-Token. */
async function authenticate(baseURL: string): Promise<string> {
  const body = { username: HARNESS_USERNAME, password: HARNESS_PASSWORD };
  const reg = await fetch(`${baseURL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (reg.status === 201) return ((await reg.json()) as { token: string }).token;
  const login = await fetch(`${baseURL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (login.status !== 200) throw new Error(`harness auth failed: ${login.status}`);
  return ((await login.json()) as { token: string }).token;
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

async function waitForReady(baseURL: string, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // The SPA shell is served unauthenticated (ADR-0019) — a 200 here means
      // the server is listening, without needing a token we don't have yet.
      const res = await fetch(`${baseURL}/`);
      if (res.status === 200) return;
    } catch {
      // not listening yet — keep polling
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`chronicle server at ${baseURL} did not become ready in time`);
}

// ADR-0019 nested campaigns under the owner user. Specs that reach into a
// campaign's files on disk must go through this so they resolve the same
// `campaigns/<userId>/<campaignId>/…` path the server uses — the flat
// `campaigns/<campaignId>` path several specs used pre-multi-user no longer
// exists. Exported for those specs (variadic tail joins subpaths).
export const campaignDir = (campaignId: string, ...parts: string[]): string =>
  path.join(REPO_ROOT, "campaigns", HARNESS_USER_ID, campaignId, ...parts);

const campaignDirFor = (campaignId: string): string => campaignDir(campaignId);

/** Seeds the scratch campaign with deterministic content so assertions on
 * rendered state check against known values, not the scratch template's
 * blank defaults. */
function seedCampaignContent(campaignId: string): void {
  const dir = campaignDirFor(campaignId);

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

/** Seeds a single opening turn (ADR-0013: turn-zero, empty playerMessage) so
 * the campaign reads as "already started." Play only auto-generates an opening
 * scene when a campaign has ZERO turns (issue #54) — most specs just want to
 * reach Play and exercise UI/panels, not fire a real Agent SDK opening every
 * time, so the default `chronicleServer` fixture is pre-opened with this. Specs
 * that specifically test the turn/opening flow use `unopenedChronicleServer`
 * (zero turns) instead. No persisted .session-id is written — the seeded turn
 * is history, not a resumable Agent SDK conversation (a fresh log is started on
 * session/start, and /state falls back to this one for its transcript). */
function seedOpeningTurn(campaignId: string): void {
  const logDir = path.join(campaignDirFor(campaignId), "session-log");
  const base = "session-2020-01-01T00-00-00-000Z";
  fs.writeFileSync(path.join(logDir, `${base}.md`), `# ${base}\n\nThe seeded opening.\n`);
  fs.writeFileSync(
    path.join(logDir, `${base}.transcript.jsonl`),
    JSON.stringify({
      turnIndex: 0,
      timestamp: "2020-01-01T00:00:00.000Z",
      playerMessage: "",
      narration: "Torchlight throws long shadows across the seeded hall as your tale begins.",
    }) + "\n"
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
async function bootServer(
  campaignId: string,
  use: (server: ChronicleTestServer) => Promise<void>,
  host = "127.0.0.1"
): Promise<void> {
  const port = 4500 + Math.floor(Math.random() * 400);
  const baseURL = `http://127.0.0.1:${port}`;
  // detached: true makes this process the leader of its own process
  // group (pid === pgid) — see killServerTree below for why that matters.
  const proc: ChildProcess = spawn("npx", ["tsx", "src/server.ts"], {
    cwd: REPO_ROOT,
    // ADR-0020: enable music so the mute control renders in Play for the specs
    // that exercise it (local source, no tracks needed — the button is gated on
    // music being enabled, not on a track existing).
    env: {
      ...process.env,
      PORT: String(port),
      HOST: host,
      DEFAULT_MUSIC_ENABLED: "true",
      DEFAULT_MUSIC_SOURCE: "local",
    },
    stdio: "pipe",
    detached: true,
  });

  let stderr = "";
  proc.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  let token: string;
  try {
    await waitForReady(baseURL);
    token = await authenticate(baseURL);
    // #114: clean the reused harness user's account defaults so per-test state
    // is deterministic (this user persists across tests and runs on disk).
    resetHarnessUserDefaults();
  } catch (err) {
    killServerTree(proc);
    deleteScratchCampaign(campaignId);
    throw new Error(`${(err as Error).message}\n${stderr}`);
  }

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    killServerTree(proc);
  };

  await use({ baseURL, token, campaignId, stop });

  stop();
  deleteScratchCampaign(campaignId);
}

export const test = base.extend<
  {
    chronicleServer: ChronicleTestServer;
    unopenedChronicleServer: ChronicleTestServer;
    freshChronicleServer: ChronicleTestServer;
    crossOriginChronicleServer: ChronicleTestServer;
  },
  object
>({
  // Pre-opened (ADR-0013): seeded content + a turn-zero opening record, so
  // entering Play does NOT auto-fire a real Agent SDK opening. This is the
  // right default for every UI/panel spec — they reach Play and test their
  // own thing without paying for (and racing against) an opening turn.
  chronicleServer: async ({}, use) => {
    const campaignId = createScratchCampaign();
    seedCampaignContent(campaignId);
    seedOpeningTurn(campaignId);
    await bootServer(campaignId, use);
  },

  // Seeded content but ZERO turns — entering Play auto-generates the opening
  // scene (issue #54). For specs that specifically exercise the turn/opening
  // flow (turn, transcript, opening) and need a real, empty starting log.
  unopenedChronicleServer: async ({}, use) => {
    const campaignId = createScratchCampaign();
    seedCampaignContent(campaignId);
    await bootServer(campaignId, use);
  },

  // Deliberately unseeded — scratch-campaign.ts's own blank defaults, not
  // seedCampaignContent's fixture prose. Some scenarios (issue #33's
  // black-screen-on-first-connect) only reproduce against a campaign that
  // has genuinely never been touched, since seeded content or a stored
  // client-side connection can mask the exact bug being verified.
  freshChronicleServer: async ({}, use) => {
    const campaignId = createScratchCampaign();
    await bootServer(campaignId, use);
  },

  // Bound to 0.0.0.0 (not just 127.0.0.1) so the same running server is
  // genuinely reachable via two different origins in the browser's eyes —
  // "127.0.0.1" and "localhost" are distinct origins even though they
  // resolve to the same box, which is exactly issue #34's scenario (one
  // address to load the page, a different-but-legitimate address
  // configured in Hearth) without depending on this machine's real LAN IP
  // being reachable/stable in CI.
  crossOriginChronicleServer: async ({}, use) => {
    const campaignId = createScratchCampaign();
    await bootServer(campaignId, use, "0.0.0.0");
  },
});

export { expect };
