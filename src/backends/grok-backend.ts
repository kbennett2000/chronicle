import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import type { DmBackend, RunTurnArgs } from "../dm-backend.js";
import { systemPrompt, GROK_TOOL_NAMES, type TurnResult } from "../dm-engine.js";
import { readCharacterIdentity, type CampaignSettings } from "../campaign-store.js";
import { stripMetaChatter } from "../narration.js";

const execFileAsync = promisify(execFile);

/** The single grok invocation, narrowed to what this backend passes and reads.
 * Injectable so the retry logic can be unit-tested without spawning `grok`. */
export type GrokExec = (
  file: "grok",
  args: string[],
  options: { timeout: number; killSignal: NodeJS.Signals; maxBuffer: number }
) => Promise<{ stdout: string; stderr: string }>;

const defaultExec = execFileAsync as unknown as GrokExec;

/** DM turns run a full agentic loop (read state, narrate, update several files),
 * which on grok-build measured ~2-2.5 min in the Slice 0 spike. Give generous
 * headroom; SIGKILL on overrun so a stuck turn can't hold the socket forever. */
const GROK_TURN_TIMEOUT_MS = 600_000;

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // src/backends
const MCP_SERVERS_DIR = path.resolve(__dirname, "../mcp-servers");
// The tsx launcher by absolute path: it resolves the target file's imports
// relative to the FILE, so the MCP servers run correctly no matter what cwd
// grok spawns them in (campaignDir has no node_modules of its own).
const TSX_BIN = path.resolve(__dirname, "../../node_modules/.bin/tsx");

/** Write the per-turn `<campaignDir>/.grok/config.toml` declaring the stdio MCP
 * servers this campaign's settings enable (ADR-0018). Because cwd is campaignDir,
 * this is grok's highest-priority config. `.grok/` is gitignored, and each server
 * gets the campaign dir via env — so there's no cross-campaign bleed (ADR-0004).
 * Only the servers the settings turn on are declared, mirroring how the Claude
 * path conditionally wires dice/image per turn. */
function writeGrokConfig(campaignDir: string, settings: CampaignSettings): void {
  const grokDir = path.join(campaignDir, ".grok");
  fs.mkdirSync(grokDir, { recursive: true });

  const blocks: string[] = [];
  const addServer = (name: string, file: string): void => {
    const serverPath = path.join(MCP_SERVERS_DIR, file);
    blocks.push(
      `[mcp_servers.${name}]\n` +
        `command = ${JSON.stringify(TSX_BIN)}\n` +
        `args = [${JSON.stringify(serverPath)}]\n` +
        `env = { CHRONICLE_CAMPAIGN_DIR = ${JSON.stringify(campaignDir)} }\n`
    );
  };

  // Seed + texture are always available (like the Claude path). Dice and image
  // are gated on the same settings dm-engine gates its in-process tools on.
  addServer("seed-tables", "seed-server.ts");
  addServer("texture-tables", "texture-server.ts");
  if (settings.autoRollDice !== false) addServer("dice", "dice-server.ts");
  if (settings.generateImages) addServer("image-tools", "image-server.ts");

  fs.writeFileSync(path.join(grokDir, "config.toml"), blocks.join("\n") + "\n");
}

/** The outcome of a single grok invocation, classified so the caller can decide
 * whether a retry is warranted. `retryable` marks the intermittent
 * silent-turn/garbled-output case (issue #100) — as opposed to a terminal
 * spawn/timeout/non-zero failure, which retrying wouldn't help. */
interface GrokAttempt {
  text: string;
  sessionId: string | undefined;
  /** No usable narration came back (empty `.text` or unparseable output). */
  retryable: boolean;
  /** The exec itself failed (ENOENT/timeout/non-zero); not the same as a
   * successful-but-silent turn, and never retried. */
  terminal: boolean;
}

/** Run one headless grok turn and parse its single JSON blob
 * ({ text, stopReason, sessionId, ... }). `.text` is the clean narration; file
 * edits are disk side effects. Classifies the result but does not decide policy
 * — the caller owns retry/error handling. */
async function attemptGrokTurn(
  grokArgs: string[],
  campaignDir: string,
  model: string,
  fallbackSessionId: string | undefined,
  execFn: GrokExec
): Promise<GrokAttempt> {
  let stdout: string;
  try {
    const result = await execFn("grok", grokArgs, {
      timeout: GROK_TURN_TIMEOUT_MS,
      killSignal: "SIGKILL",
      maxBuffer: 20 * 1024 * 1024,
    });
    stdout = result.stdout;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { killed?: boolean; stderr?: string };
    const reason =
      e.code === "ENOENT"
        ? "grok CLI not found on PATH"
        : e.killed
          ? `grok timed out after ${GROK_TURN_TIMEOUT_MS}ms`
          : e.stderr?.trim() || e.message || String(err);
    console.error(`[grok-backend] turn failed for ${campaignDir}: ${reason}`);
    return {
      text: `[DM engine error: ${reason}]`,
      // Keep the resume id on failure so the next attempt can continue the session.
      sessionId: fallbackSessionId,
      retryable: false,
      terminal: true,
    };
  }

  let sessionId = fallbackSessionId;
  try {
    const parsed = JSON.parse(stdout) as { text?: unknown; sessionId?: unknown; stopReason?: unknown };
    const text = typeof parsed.text === "string" ? parsed.text : "";
    if (typeof parsed.sessionId === "string" && parsed.sessionId) {
      sessionId = parsed.sessionId;
    }
    if (!text.trim()) {
      return {
        text: `[DM engine error: grok returned no narration (stopReason=${String(parsed.stopReason)})]`,
        sessionId,
        retryable: true,
        terminal: false,
      };
    }
    return { text, sessionId, retryable: false, terminal: false };
  } catch {
    return {
      text: `[DM engine error: could not parse grok output]\n${stdout.slice(0, 500)}`,
      sessionId,
      retryable: true,
      terminal: false,
    };
  }
}

/** Grok's headless flags, finalized in the Slice 0 spike (see ADR-0018):
 * --system-prompt-override carries the full DM prompt (no 10K cap); --sandbox
 * workspace confines writes to campaignDir while allowing SRD reads and blocking
 * repo/.git writes; run_terminal_cmd removed so no shell/git; --always-approve
 * for unattended file edits. No --effort (both grok models reject it).
 *
 * `execFn` is injectable for testing; production uses the real `grok` CLI. */
export async function runGrokTurn(args: RunTurnArgs, execFn: GrokExec = defaultExec): Promise<TurnResult> {
  const { campaignDir, sessionLogPath, userInput, resumeSessionId, model, settings } = args;
  const character = readCharacterIdentity(campaignDir);
  const sysPrompt = systemPrompt(campaignDir, sessionLogPath, settings, character, GROK_TOOL_NAMES);

  writeGrokConfig(campaignDir, settings);

  // Reuse the persisted session on resume; otherwise mint a UUID grok will
  // create the session under, and hand it back so the server persists it.
  const newSessionId = randomUUID();
  const buildArgs = (input: string, resume: string | undefined): string[] => {
    const a = [
      "-p", input,
      "--cwd", campaignDir,
      "-m", model,
      "--output-format", "json",
      "--system-prompt-override", sysPrompt,
      "--sandbox", "workspace",
      "--disallowed-tools", "run_terminal_cmd",
      "--always-approve",
      "--no-plan",
      "--no-subagents",
      "--disable-web-search",
    ];
    if (resume) a.push("--resume", resume);
    else a.push("--session-id", newSessionId);
    return a;
  };

  let attempt = await attemptGrokTurn(
    buildArgs(userInput, resumeSessionId),
    campaignDir,
    model,
    resumeSessionId ?? newSessionId,
    execFn
  );

  // Issue #100: grok-build (and, less often, composer) intermittently completes
  // a DM turn through tool/file edits alone — reading state, generating images —
  // and ends with no narration in `.text`, which would strand the campaign at 0
  // turns. Retry ONCE, resuming the session this attempt just created so it
  // continues the same context, with a nudge that forces the scene into the
  // reply text. Terminal exec failures are not retried.
  if (attempt.retryable) {
    console.error(`[grok-backend] no narration for ${campaignDir}; retrying once with a prose-forcing nudge`);
    const nudge =
      `${userInput}\n\n(Write the scene now as narrated prose in your reply text. ` +
      `Do not answer only through tool calls or file edits.)`;
    const retry = await attemptGrokTurn(
      buildArgs(nudge, attempt.sessionId),
      campaignDir,
      model,
      attempt.sessionId ?? newSessionId,
      execFn
    );
    console.error(
      `[grok-backend] retry for ${campaignDir} ${retry.retryable || retry.terminal ? "still produced no narration" : "succeeded"}`
    );
    attempt = retry;
  }

  const isError = attempt.retryable || attempt.terminal;
  const cleaned = isError
    ? attempt.text
    : stripMetaChatter(attempt.text, { autoRoll: settings.autoRollDice !== false });

  // Grok's JSON carries no per-message model echo like Claude's, so requested
  // and actual collapse (ADR-0018).
  return { text: cleaned, sessionId: attempt.sessionId, isError, model, requestedModel: model };
}

export const grokBackend: DmBackend = {
  provider: "grok",
  runTurn(args: RunTurnArgs): Promise<TurnResult> {
    return runGrokTurn(args);
  },
};
