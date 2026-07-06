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

/** Grok's headless flags, finalized in the Slice 0 spike (see ADR-0018):
 * --system-prompt-override carries the full DM prompt (no 10K cap); --sandbox
 * workspace confines writes to campaignDir while allowing SRD reads and blocking
 * repo/.git writes; run_terminal_cmd removed so no shell/git; --always-approve
 * for unattended file edits. No --effort (both grok models reject it). */
async function runGrokTurn(args: RunTurnArgs): Promise<TurnResult> {
  const { campaignDir, sessionLogPath, userInput, resumeSessionId, model, settings } = args;
  const character = readCharacterIdentity(campaignDir);
  const sysPrompt = systemPrompt(campaignDir, sessionLogPath, settings, character, GROK_TOOL_NAMES);

  writeGrokConfig(campaignDir, settings);

  // Reuse the persisted session on resume; otherwise mint a UUID grok will
  // create the session under, and hand it back so the server persists it.
  const newSessionId = randomUUID();
  const grokArgs = [
    "-p",
    userInput,
    "--cwd",
    campaignDir,
    "-m",
    model,
    "--output-format",
    "json",
    "--system-prompt-override",
    sysPrompt,
    "--sandbox",
    "workspace",
    "--disallowed-tools",
    "run_terminal_cmd",
    "--always-approve",
    "--no-plan",
    "--no-subagents",
    "--disable-web-search",
  ];
  if (resumeSessionId) {
    grokArgs.push("--resume", resumeSessionId);
  } else {
    grokArgs.push("--session-id", newSessionId);
  }

  let stdout: string;
  try {
    const result = await execFileAsync("grok", grokArgs, {
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
      sessionId: resumeSessionId,
      isError: true,
      model,
      requestedModel: model,
    };
  }

  // Headless grok returns one JSON blob: { text, stopReason, sessionId, ... }.
  // `.text` is the clean narration; file edits are disk side effects.
  let text = "";
  let sessionId: string | undefined = resumeSessionId ?? newSessionId;
  let isError = false;
  try {
    const parsed = JSON.parse(stdout) as { text?: unknown; sessionId?: unknown; stopReason?: unknown };
    text = typeof parsed.text === "string" ? parsed.text : "";
    if (typeof parsed.sessionId === "string" && parsed.sessionId) {
      sessionId = parsed.sessionId;
    }
    // A run that produced no narration is treated as an engine error so the
    // route returns 502 rather than persisting an empty turn.
    if (!text.trim()) {
      isError = true;
      text = `[DM engine error: grok returned no narration (stopReason=${String(parsed.stopReason)})]`;
    }
  } catch {
    isError = true;
    text = `[DM engine error: could not parse grok output]\n${stdout.slice(0, 500)}`;
  }

  const cleaned = isError
    ? text
    : stripMetaChatter(text, { autoRoll: settings.autoRollDice !== false });

  // Grok's JSON carries no per-message model echo like Claude's, so requested
  // and actual collapse (ADR-0018).
  return { text: cleaned, sessionId, isError, model, requestedModel: model };
}

export const grokBackend: DmBackend = {
  provider: "grok",
  runTurn(args: RunTurnArgs): Promise<TurnResult> {
    return runGrokTurn(args);
  },
};
