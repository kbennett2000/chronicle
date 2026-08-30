/** ADR-0040 session-rotation A/B harness. Answers one question empirically:
 * does starting a FRESH Claude Agent SDK session (re-primed purely from the
 * state files via catchUpDirective) produce better narration than RESUMING the
 * long accumulated session — the suspected cause of long-campaign "laziness"?
 *
 * It runs the SAME next-turn input two ways against a NON-DESTRUCTIVE COPY of a
 * real campaign (default: ted-the-wizard) and prints the two narrations plus
 * objective metrics (tokens, latency, word count, unique-word ratio, tool-call
 * counts) side by side for a human to judge.
 *
 * HYGIENE (CLAUDE.md): the live campaign is READ-ONLY here. Every write goes to
 * throwaway `scratch-`-prefixed copies (the same deletion rail as
 * scripts/scratch-campaign.ts), which are removed on teardown. The engine's
 * per-turn cwd/permission gate is the copy dir, so even if the resumed arm's
 * replayed history references the real campaign's absolute paths, any write to
 * them is DENIED — the live game cannot be touched. Run only when you are not
 * mid-session on the source campaign.
 *
 * Usage:
 *   npx tsx scripts/ab-fresh-session.ts
 *   npx tsx scripts/ab-fresh-session.ts --input "I search the study for the missing page."
 *   npx tsx scripts/ab-fresh-session.ts --campaign ted-the-wizard --repeat 2 --keep
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runTurn, catchUpDirective } from "../src/dm-engine.js";
import {
  resolveCampaignDir,
  scaffoldCampaign,
  readPersistedSessionId,
  readCampaignModel,
  readCampaignSettings,
  readCampaignProvider,
  resolveSessionLog,
} from "../src/campaign-store.js";
import { userIdForUsername } from "../src/user-store.js";
import { secrets } from "../src/config.js";
import { extractMomentTags } from "../src/narration.js";

const SCRATCH_PREFIX = "scratch-";
// The four persistent state files that ARE the campaign (mirrors dm-engine's
// STATE_FILES / campaign-store's SNAPSHOT_STATE_FILES — neither is exported, and
// this list is stable). These get copied from the source campaign into each arm.
const STATE_FILES = ["character-sheet.json", "world-state.md", "npc-roster.md", "quest-log.md"];

// Safe, scene-agnostic continuations used when no --input is given: each works
// regardless of exactly where the story stands, so the harness needs no
// knowledge of the campaign's current moment.
const DEFAULT_INPUTS = [
  "I take a moment to look around and get my bearings, staying alert to anything out of place.",
  "I press on with what I was doing, watching carefully for how things react.",
  "I turn to whoever is nearest and ask what they make of the situation.",
];

interface Args {
  inputs: string[];
  campaign: string;
  user: string;
  repeat: number;
  keep: boolean;
}

function parseArgs(argv: string[]): Args {
  const inputs: string[] = [];
  let campaign = "ted-the-wizard";
  let user = secrets.bootstrap.username || "kris";
  let repeat = 1;
  let keep = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input") inputs.push(argv[++i]);
    else if (argv[i] === "--campaign") campaign = argv[++i];
    else if (argv[i] === "--user") user = argv[++i];
    else if (argv[i] === "--repeat") repeat = Math.max(1, parseInt(argv[++i], 10) || 1);
    else if (argv[i] === "--keep") keep = true;
  }
  return { inputs: inputs.length ? inputs : DEFAULT_INPUTS, campaign, user, repeat, keep };
}

/** Create a throwaway copy of the source campaign's STATE (not its .session-id),
 * with image/video generation forced OFF so the A/B isolates narration rather
 * than dragging in ComfyUI latency/side effects. Returns the copy's dir. */
function seedCopy(userId: string, srcDir: string): { id: string; dir: string } {
  const id = `${SCRATCH_PREFIX}ab-${Math.random().toString(36).slice(2, 8)}-${Date.now()}`.toLowerCase();
  const sheet = JSON.parse(fs.readFileSync(path.join(srcDir, "character-sheet.json"), "utf8"));
  // Start from the source's real settings so engine/world/tone/length match,
  // then disable the media seams (both arms identically).
  const settings = JSON.parse(fs.readFileSync(path.join(srcDir, "campaign-settings.json"), "utf8"));
  settings.generateImages = false;
  settings.generateVideos = false;
  settings.autoIllustrateTurns = false;
  scaffoldCampaign(userId, id, sheet, settings);
  const dir = resolveCampaignDir(userId, id);
  // Overwrite the scaffold's empty state files with the source's real ones.
  for (const f of STATE_FILES) fs.copyFileSync(path.join(srcDir, f), path.join(dir, f));
  // Replace the empty session-log dir with the source's real logs INCLUDING the
  // `.transcript.jsonl` siblings — log routing (resolveSessionLog) reads the
  // transcript, not the `.md`, to decide which log "holds the story".
  fs.rmSync(path.join(dir, "session-log"), { recursive: true, force: true });
  fs.cpSync(path.join(srcDir, "session-log"), path.join(dir, "session-log"), { recursive: true });
  return { id, dir };
}

/** The Agent SDK stores each turn's conversation in
 * `~/.claude/projects/<slug>/<sessionId>.jsonl`, where the slug is the turn's cwd
 * (the campaign dir) with every non-alphanumeric char replaced by "-" (verified
 * against the SDK's own `Co()`; it only truncates+hashes past 200 chars, and our
 * scratch paths are far shorter). This is SEPARATE from Chronicle's own
 * `.transcript.jsonl` under the campaign dir (ADR-0007). */
function sdkProjectDir(dirPath: string): string {
  const real = fs.realpathSync(dirPath);
  const slug = real.replace(/[^a-zA-Z0-9]/g, "-");
  return path.join(os.homedir(), ".claude", "projects", slug);
}

/** Reproduce the "resumed" arm faithfully without touching the source: copy the
 * source campaign's real SDK conversation into the COPY's own SDK project slug,
 * so `runTurn(cwd=copyDir, resume=sessionId)` finds it there. New turns then
 * branch into the copy's slug — the source's SDK store is never written. */
function plantSession(copyDir: string, srcDir: string, sessionId: string): void {
  const srcFile = path.join(sdkProjectDir(srcDir), `${sessionId}.jsonl`);
  if (!fs.existsSync(srcFile)) {
    throw new Error(`source SDK conversation not found on disk: ${srcFile}`);
  }
  const destDir = sdkProjectDir(copyDir);
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(srcFile, path.join(destDir, `${sessionId}.jsonl`));
}

function destroyCopy(dir: string): void {
  // Belt-and-suspenders: only ever delete a scratch-prefixed dir.
  if (!path.basename(dir).startsWith(SCRATCH_PREFIX)) {
    console.error(`refusing to delete non-scratch dir: ${dir}`);
    return;
  }
  // Remove both the campaign copy AND its SDK conversation slug dir.
  const slugDir = sdkProjectDir(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  if (path.basename(slugDir).includes("scratch-ab-")) {
    fs.rmSync(slugDir, { recursive: true, force: true });
  }
}

interface ArmMetrics {
  arm: "resumed" | "fresh";
  latencyMs: number;
  isError: boolean;
  narration: string;
  wordCount: number;
  uniqueWordRatio: number;
  reads: number;
  srdReads: number;
  toolCalls: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  costUsd?: number;
}

/** Run one arm, capturing the engine's stderr tool-call logs so we can count
 * Reads / SRD reads / tool calls without changing the engine. */
async function runArm(
  arm: "resumed" | "fresh",
  copyDir: string,
  userInput: string,
  resumeSessionId: string | undefined,
  model: string,
): Promise<ArmMetrics> {
  const settings = readCampaignSettings(copyDir);
  const logPath = resolveSessionLog(copyDir, /*resuming*/ arm === "resumed");
  const logs: string[] = [];
  const origError = console.error;
  console.error = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  const start = Date.now();
  let result;
  try {
    result = await runTurn(copyDir, logPath, userInput, resumeSessionId, model, settings, () => {});
  } finally {
    console.error = origError;
  }
  const latencyMs = Date.now() - start;

  const reads = logs.filter((l) => l.startsWith("[dm-engine] Read:"));
  const srdReads = reads.filter((l) => l.includes("/reference/srd/"));
  const toolCalls = logs.filter((l) => l.includes("PreToolUse ALLOW"));
  const { narration } = extractMomentTags(result.text);
  const words = narration.toLowerCase().match(/[a-z']+/g) ?? [];
  const uniqueWordRatio = words.length ? new Set(words).size / words.length : 0;

  return {
    arm,
    latencyMs,
    isError: result.isError,
    narration,
    wordCount: words.length,
    uniqueWordRatio,
    reads: reads.length,
    srdReads: srdReads.length,
    toolCalls: toolCalls.length,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
    cacheReadTokens: result.usage?.cacheReadInputTokens,
    costUsd: result.usage?.totalCostUsd,
  };
}

function fmt(n: number | undefined): string {
  return n === undefined ? "—" : n.toLocaleString();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const userId = userIdForUsername(args.user);
  const srcDir = resolveCampaignDir(userId, args.campaign);
  if (!fs.existsSync(srcDir)) {
    console.error(`source campaign not found: ${args.campaign} (user ${args.user})`);
    process.exit(1);
  }
  const provider = readCampaignProvider(srcDir);
  if (provider !== "claude") {
    console.error(
      `this harness drives the Claude Agent SDK engine directly, but '${args.campaign}' is on provider '${provider}'.`,
    );
    process.exit(1);
  }
  const model = readCampaignModel(srcDir);
  const srcSessionId = readPersistedSessionId(srcDir);
  if (!srcSessionId) {
    console.error(`'${args.campaign}' has no .session-id — nothing to resume for the 'resumed' arm.`);
    process.exit(1);
  }

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "chronicle-ab-"));
  console.log(`\nSession-rotation A/B — source: ${args.campaign} (${model})`);
  console.log(`Resumed arm resumes real session ${srcSessionId} (campaign files stay read-only).`);
  console.log(`Outputs: ${outDir}\n`);

  const createdCopies: string[] = [];
  const rows: ArmMetrics[] = [];
  let runNo = 0;
  try {
    for (const input of args.inputs) {
      for (let r = 0; r < args.repeat; r++) {
        runNo++;
        console.log(`── run ${runNo}: "${input.slice(0, 60)}${input.length > 60 ? "…" : ""}"`);

        // Two independent copies, one per arm, from the same source snapshot —
        // avoids any ordering bias between arms.
        const a = seedCopy(userId, srcDir);
        const b = seedCopy(userId, srcDir);
        createdCopies.push(a.dir, b.dir);

        // Arm (a): resume the long accumulated session, raw player input. Plant
        // the source's SDK conversation into copy A's slug so the resume finds it
        // there (never in the source's store).
        plantSession(a.dir, srcDir, srcSessionId);
        const resumed = await runArm("resumed", a.dir, input, srcSessionId, model);
        // Arm (b): fresh session (no resume), re-primed via catchUpDirective.
        const catchUp = catchUpDirective(b.dir, resolveSessionLog(b.dir, false), input);
        const fresh = await runArm("fresh", b.dir, catchUp, undefined, model);

        rows.push(resumed, fresh);
        const base = `run${String(runNo).padStart(2, "0")}`;
        fs.writeFileSync(path.join(outDir, `${base}-input.txt`), input);
        fs.writeFileSync(path.join(outDir, `${base}-resumed.md`), resumed.narration);
        fs.writeFileSync(path.join(outDir, `${base}-fresh.md`), fresh.narration);

        for (const m of [resumed, fresh]) {
          console.log(
            `   ${m.arm.padEnd(7)} ${(m.latencyMs / 1000).toFixed(1)}s  ` +
              `words=${m.wordCount} uniq=${(m.uniqueWordRatio * 100).toFixed(0)}%  ` +
              `reads=${m.reads}(srd ${m.srdReads}) tools=${m.toolCalls}  ` +
              `in=${fmt(m.inputTokens)} cacheR=${fmt(m.cacheReadTokens)} out=${fmt(m.outputTokens)} ` +
              `$${m.costUsd?.toFixed(4) ?? "—"}${m.isError ? "  [ERROR]" : ""}`,
          );
        }
      }
    }

    // Aggregate summary: averages per arm.
    console.log(`\n── averages over ${runNo} run(s) ──`);
    for (const arm of ["resumed", "fresh"] as const) {
      const a = rows.filter((r) => r.arm === arm);
      const avg = (sel: (m: ArmMetrics) => number | undefined) => {
        const vals = a.map(sel).filter((v): v is number => v !== undefined);
        return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : undefined;
      };
      console.log(
        `   ${arm.padEnd(7)} lat=${((avg((m) => m.latencyMs) ?? 0) / 1000).toFixed(1)}s  ` +
          `words=${(avg((m) => m.wordCount) ?? 0).toFixed(0)} uniq=${((avg((m) => m.uniqueWordRatio) ?? 0) * 100).toFixed(0)}%  ` +
          `inTok=${fmt(Math.round(avg((m) => m.inputTokens) ?? 0))} outTok=${fmt(Math.round(avg((m) => m.outputTokens) ?? 0))} ` +
          `cost=$${(avg((m) => m.costUsd) ?? 0).toFixed(4)}`,
      );
    }
    console.log(`\nRead the narrations side by side in: ${outDir}`);
    console.log(`(resumed = today's behavior; fresh = session rotation)\n`);
  } finally {
    if (!args.keep) {
      for (const dir of createdCopies) destroyCopy(dir);
    } else {
      console.log(`--keep set: left ${createdCopies.length} scratch copies in place.`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
