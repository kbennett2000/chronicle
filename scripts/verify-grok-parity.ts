/**
 * Automated Grok/Claude parity sweep (ADR-0018 Slice 7).
 *
 * Drives a disposable scratch campaign through the REAL server — opening, a few
 * turns, session resume, and a mid-campaign provider switch — and asserts that a
 * Grok DM turn behaves mechanically like a Claude one: narration returns, state
 * files update, the (per-campaign) seed + texture registries grow, an in-turn
 * image lands, resume continues the session, and a Grok->Claude switch resets the
 * session yet keeps playing (state is file-backed, ADR-0001).
 *
 * It is intentionally a run-it-yourself tool, not a CI unit test: each real DM
 * turn takes minutes and needs live auth (an authenticated `grok` CLI in ~/.grok
 * or XAI_API_KEY, and Claude Agent SDK credentials). It self-cleans — kills the
 * server, deletes the scratch campaign — and watches `git status` so a run can
 * never dirty test-campaign or the shared registry.
 *
 * Usage:
 *   npm run verify:grok-parity
 *   CHRONICLE_PARITY_MODEL=grok-composer-2.5-fast CHRONICLE_PARITY_TURNS=2 npm run verify:grok-parity
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { userIdForUsername } from "../src/user-store.js";
import { withEphemeralConfig } from "./ephemeral-config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
// ADR-0019: auth is per-user now. The sweep registers (or logs in) a dedicated
// parity user and owns its scratch campaign under that user's dir.
const PARITY_USERNAME = "grok-parity-user";
const PARITY_PASSWORD = "grok-parity-pass";
const PARITY_USER_ID = userIdForUsername(PARITY_USERNAME);
let token = "";
const GROK_MODEL = process.env.CHRONICLE_PARITY_MODEL || "grok-build";
const CLAUDE_MODEL = "claude-haiku-4-5"; // cheapest/fastest for the switch-back turn
const TURN_COUNT = Number(process.env.CHRONICLE_PARITY_TURNS || 3);

// ── tiny check harness ──────────────────────────────────────────────────────
let failures = 0;
function check(label: string, ok: boolean, detail = ""): boolean {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
  return ok;
}
function step(label: string): void {
  console.log(`\n▶ ${label}`);
}

// ── scratch campaign + server plumbing (mirrors web/tests/e2e/harness.ts) ─────
function scratch(args: string[]): string {
  return execFileSync("npx", ["tsx", "scripts/scratch-campaign.ts", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
}

/** Spawn `npx tsx src/server.ts` as its own process-group leader so the whole
 * tsx wrapper+grandchild tree can be killed in one shot (see harness.ts). */
function killServerTree(proc: ChildProcess): void {
  if (!proc.pid) return void proc.kill();
  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch {
    /* group already gone */
  }
}

async function waitForReady(baseURL: string, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // The SPA shell is served unauthenticated (ADR-0019), so a 200 here means
      // the server is listening without needing a token we don't have yet.
      const res = await fetch(`${baseURL}/`);
      if (res.status === 200) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server at ${baseURL} did not become ready in time`);
}

/** Register the parity user (or log in if it already exists from a prior run)
 * and stash its session token for all subsequent authenticated calls. */
async function authenticate(baseURL: string): Promise<void> {
  const reg = await api(baseURL, "POST", "/auth/register", {
    username: PARITY_USERNAME,
    password: PARITY_PASSWORD,
  });
  if (reg.status === 201) {
    token = reg.body.token;
    return;
  }
  const login = await api(baseURL, "POST", "/auth/login", {
    username: PARITY_USERNAME,
    password: PARITY_PASSWORD,
  });
  if (login.status !== 200) throw new Error(`parity auth failed: ${login.status} ${JSON.stringify(login.body)}`);
  token = login.body.token;
}

async function api(
  baseURL: string,
  method: "GET" | "POST",
  route: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseURL}${route}`, {
    method,
    headers: { "X-Chronicle-Token": token, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* leave as text */
  }
  return { status: res.status, body: parsed };
}

// ── state helpers ─────────────────────────────────────────────────────────────
const STATE_FILES = ["character-sheet.json", "world-state.md", "npc-roster.md", "quest-log.md"];
function hashFile(p: string): string {
  if (!fs.existsSync(p)) return "";
  return crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex");
}
function snapshotState(dir: string): Record<string, string> {
  return Object.fromEntries(STATE_FILES.map((f) => [f, hashFile(path.join(dir, f))]));
}

/** All git-dirty paths under campaigns/ EXCEPT the scratch dir itself — the set
 * that must stay identical across the run (a Grok turn must never write the
 * shared registry or test-campaign). */
function foreignCampaignDirt(scratchId: string): string[] {
  const out = execFileSync("git", ["status", "--porcelain", "--", "campaigns/"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return out
    .split("\n")
    .filter((l) => l.trim() !== "")
    .filter((l) => !l.includes(`campaigns/${scratchId}/`))
    .sort();
}

function seedCharacter(dir: string): void {
  const sheet = JSON.parse(fs.readFileSync(path.join(dir, "character-sheet.json"), "utf8"));
  sheet.name = "Parity Proband";
  sheet.race = "Human";
  sheet.class = "Ranger";
  sheet.level = 3;
  sheet.hp = { current: 24, max: 24 };
  sheet.armorClass = 14;
  fs.writeFileSync(path.join(dir, "character-sheet.json"), JSON.stringify(sheet, null, 2) + "\n");
}

const TURN_PROMPTS = [
  "I walk into the nearest town and look for the tavern. Who's the innkeeper, and what's their name and manner?",
  "I ask the innkeeper about any local trouble worth coin, and shake hands on a job. Roll whatever you need.",
  "I head to the place they described and take in the sight of it. Paint me the scene.",
  "I search the area carefully for anything hidden. Make the check.",
  "I introduce myself to the first stranger I meet on the road and learn their story.",
];

async function main(): Promise<void> {
  console.log(`Grok/Claude parity sweep — grok model=${GROK_MODEL}, turns=${TURN_COUNT}`);

  step("Preconditions");
  let grokOk = false;
  try {
    execFileSync("grok", ["--version"], { encoding: "utf8", stdio: "pipe" });
    grokOk = true;
  } catch {
    /* absent */
  }
  check("`grok` CLI is on PATH (needed for Grok turns + images)", grokOk,
    grokOk ? "" : "install/authenticate the grok CLI — see SETUP.md §7");

  // Create the scratch Grok campaign (images + auto-roll on) under the parity
  // user (ADR-0019) and seed a real PC.
  const scratchId = scratch([
    "create",
    "--user",
    PARITY_USERNAME,
    "--provider",
    "grok",
    "--model",
    GROK_MODEL,
    "--images",
  ]);
  const dir = path.join(REPO_ROOT, "campaigns", PARITY_USER_ID, scratchId);
  seedCharacter(dir);
  console.log(`  scratch campaign: ${scratchId} (user ${PARITY_USER_ID})`);

  const baselineForeignDirt = foreignCampaignDirt(scratchId);

  const port = 4900 + Math.floor(Math.random() * 300);
  const baseURL = `http://127.0.0.1:${port}`;
  // The server takes host/port from config.json now (ADR-0033), not env — hand it
  // an ephemeral one on the chosen port; restoreConfig() puts back any real one.
  const restoreConfig = withEphemeralConfig({ server: { host: "127.0.0.1", port } });
  const proc = spawn("npx", ["tsx", "src/server.ts"], {
    cwd: REPO_ROOT,
    env: { ...process.env },
    stdio: "pipe",
    detached: true,
  });
  let serverLog = "";
  proc.stdout?.on("data", (c) => (serverLog += c));
  proc.stderr?.on("data", (c) => (serverLog += c));

  try {
    await waitForReady(baseURL);
    await authenticate(baseURL);

    step("Start a Grok session");
    const start = await api(baseURL, "POST", `/campaigns/${scratchId}/session/start`, {
      provider: "grok",
      model: GROK_MODEL,
    });
    check("session/start returns provider=grok", start.body?.provider === "grok", `got ${start.body?.provider}`);
    check("session/start returns the requested Grok model", start.body?.model === GROK_MODEL, `got ${start.body?.model}`);

    step("Opening scene");
    const opening = await api(baseURL, "POST", `/campaigns/${scratchId}/opening`);
    check("opening returns non-error narration", opening.status === 200 && !opening.body?.isError && !!opening.body?.narration?.trim(),
      `status=${opening.status} isError=${opening.body?.isError}`);

    const preTurns = snapshotState(dir);

    step(`Play ${TURN_COUNT} Grok turn(s)`);
    let lastSessionId: string | null = opening.body?.sessionId ?? null;
    for (let i = 0; i < TURN_COUNT; i++) {
      const msg = TURN_PROMPTS[i % TURN_PROMPTS.length];
      const t = await api(baseURL, "POST", `/campaigns/${scratchId}/turns`, { message: msg });
      const ok = t.status === 200 && !t.body?.isError && !!t.body?.narration?.trim();
      check(`turn ${i + 1} returns narration`, ok, ok ? "" : `status=${t.status} isError=${t.body?.isError} :: ${String(t.body?.narration).slice(0, 120)}`);
      if (t.body?.sessionId) lastSessionId = t.body.sessionId;
    }

    step("State + registries updated (per-campaign, sandbox-safe)");
    const postTurns = snapshotState(dir);
    const changed = STATE_FILES.filter((f) => preTurns[f] !== postTurns[f]);
    for (const f of STATE_FILES) {
      const did = preTurns[f] !== postTurns[f];
      console.log(`    ${did ? "·changed" : "·same   "} ${f}`);
    }
    check("at least one state file changed across the turns", changed.length > 0, `${changed.length}/${STATE_FILES.length} changed`);

    const localRegistry = path.join(dir, "content-registry.md");
    check("per-campaign seed registry exists inside the campaign dir", fs.existsSync(localRegistry),
      "Grok's sandbox redirects it here (Slice 5)");
    check("texture registry exists inside the campaign dir", fs.existsSync(path.join(dir, "texture-registry.md")));
    check("no seed registry was written to the shared campaigns/_registry/",
      !fs.existsSync(path.join(REPO_ROOT, "campaigns", "_registry", "content-registry.md")) ||
        !foreignCampaignDirt(scratchId).some((l) => l.includes("_registry/")), "");

    step("In-turn image generation");
    const imagesDir = path.join(dir, "images");
    const imageCount = fs.existsSync(imagesDir) ? fs.readdirSync(imagesDir).filter((f) => !f.startsWith(".")).length : 0;
    check("at least one image landed in images/", imageCount > 0,
      grokOk ? `${imageCount} file(s)` : "grok CLI absent — images can't generate; not counted against parity");

    step("Session resume continues the same conversation");
    const resumeTurn = await api(baseURL, "POST", `/campaigns/${scratchId}/turns`, {
      message: "I glance back the way I came and press on.",
    });
    check("post-resume turn still returns narration", resumeTurn.status === 200 && !resumeTurn.body?.isError && !!resumeTurn.body?.narration?.trim());
    check("session id is stable/continued across turns", !!lastSessionId, `sessionId=${lastSessionId}`);

    step("Mid-campaign Grok → Claude switch resets the session and keeps playing");
    const switchStart = await api(baseURL, "POST", `/campaigns/${scratchId}/session/start`, {
      provider: "claude",
      model: CLAUDE_MODEL,
    });
    check("switch returns provider=claude", switchStart.body?.provider === "claude", `got ${switchStart.body?.provider}`);
    check("switch is NOT a resume (session reset on provider change)", switchStart.body?.resumed === false, `resumed=${switchStart.body?.resumed}`);
    const claudeTurn = await api(baseURL, "POST", `/campaigns/${scratchId}/turns`, {
      message: "I make camp for the night and take stock of what I'm carrying.",
    });
    check("a Claude turn plays on from the file-backed state", claudeTurn.status === 200 && !claudeTurn.body?.isError && !!claudeTurn.body?.narration?.trim(),
      `status=${claudeTurn.status} isError=${claudeTurn.body?.isError}`);

    step("Git hygiene: nothing outside the scratch dir was touched");
    const afterForeignDirt = foreignCampaignDirt(scratchId);
    const introduced = afterForeignDirt.filter((l) => !baselineForeignDirt.includes(l));
    check("no new dirt in test-campaign / _registry / other campaigns", introduced.length === 0,
      introduced.length ? `introduced:\n      ${introduced.join("\n      ")}` : "");
  } catch (err) {
    console.error(`\n✗ sweep aborted: ${(err as Error).message}`);
    console.error(serverLog.slice(-2000));
    failures++;
  } finally {
    step("Cleanup");
    killServerTree(proc);
    restoreConfig();
    try {
      const del = scratch(["delete", scratchId, "--user", PARITY_USERNAME]);
      check("scratch campaign deleted", del.includes("deleted"), del);
    } catch (e) {
      check("scratch campaign deleted", false, String(e));
    }
  }

  console.log(`\n${failures === 0 ? "PARITY PASS ✓" : `PARITY FAIL ✗ (${failures} check(s) failed)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
