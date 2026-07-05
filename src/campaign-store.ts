import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CAMPAIGNS_ROOT = path.resolve(__dirname, "../campaigns");

const CAMPAIGN_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export class InvalidCampaignIdError extends Error {}
export class CampaignNotFoundError extends Error {}

/** Resolves a campaign id to its working directory, rejecting anything
 * that isn't a plain directory name directly under CAMPAIGNS_ROOT (no
 * path traversal, no absolute paths). */
export function resolveCampaignDir(campaignId: string): string {
  if (!CAMPAIGN_ID_PATTERN.test(campaignId)) {
    throw new InvalidCampaignIdError(`invalid campaign id: ${campaignId}`);
  }
  const dir = path.resolve(CAMPAIGNS_ROOT, campaignId);
  if (path.dirname(dir) !== CAMPAIGNS_ROOT) {
    throw new InvalidCampaignIdError(`invalid campaign id: ${campaignId}`);
  }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new CampaignNotFoundError(`campaign not found: ${campaignId}`);
  }
  return dir;
}

/** Per design doc §8: player-facing model choices, each labeled with its
 * fidelity/cost tradeoff rather than just the raw model id. Stored
 * per-campaign, not globally — a long-running campaign shouldn't
 * silently change adjudication quality mid-story. */
export const MODEL_OPTIONS = [
  {
    id: "claude-sonnet-5",
    label:
      "Claude Sonnet 5 (recommended) — matched to this workload (narrative + rules-following state management), not a cost compromise.",
  },
  {
    id: "claude-opus-4-8",
    label:
      "Claude Opus 4.8 — maximum rules/narrative fidelity, for players who don't mind a higher per-session cost.",
  },
  {
    id: "claude-haiku-4-5",
    label:
      "Claude Haiku 4.5 — faster and cheaper, less precise on rules. A testing/casual-session option, not the recommended default.",
  },
] as const;

export type ModelId = (typeof MODEL_OPTIONS)[number]["id"];
export const DEFAULT_MODEL: ModelId = "claude-sonnet-5";

export function isValidModelId(value: string): value is ModelId {
  return MODEL_OPTIONS.some((m) => m.id === value);
}

const campaignSettingsFile = (campaignDir: string) =>
  path.join(campaignDir, "campaign-settings.json");

/** Existing campaigns with no stored preference default to DEFAULT_MODEL
 * rather than erroring — the setting is optional, not required. */
export function readCampaignModel(campaignDir: string): ModelId {
  const file = campaignSettingsFile(campaignDir);
  if (!fs.existsSync(file)) return DEFAULT_MODEL;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof parsed.model === "string" && isValidModelId(parsed.model)) {
      return parsed.model;
    }
  } catch {
    // fall through to default
  }
  return DEFAULT_MODEL;
}

export function persistCampaignModel(campaignDir: string, model: ModelId): void {
  fs.writeFileSync(campaignSettingsFile(campaignDir), JSON.stringify({ model }, null, 2) + "\n");
}

const sessionIdFile = (campaignDir: string) => path.join(campaignDir, ".session-id");

export function readPersistedSessionId(campaignDir: string): string | undefined {
  const file = sessionIdFile(campaignDir);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : undefined;
}

export function persistSessionId(campaignDir: string, sessionId: string): void {
  fs.writeFileSync(sessionIdFile(campaignDir), sessionId);
}

/** Creates a new append-only session-log file and returns its path,
 * relative to the campaign directory (this is what dm-engine's system
 * prompt tells the model to append to). */
export function startSessionLog(campaignDir: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const relPath = `session-log/session-${timestamp}.md`;
  fs.writeFileSync(path.join(campaignDir, relPath), `# Session ${timestamp}\n\n`);
  return relPath;
}

function latestSessionLogPath(campaignDir: string): string | undefined {
  const dir = path.join(campaignDir, "session-log");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  return files.length > 0 ? `session-log/${files[files.length - 1]}` : undefined;
}

/** One log file per session-log/§3's actual "session," not per API call:
 * reuses the most recent log file when resuming an existing Agent SDK
 * conversation, and only starts a fresh one for a genuinely new
 * conversation. Calling startSessionLog() on every resume (e.g. once per
 * page load, once per settings change) fragmented the log across mostly
 * empty files — the model kept writing to whichever file it remembered
 * from earlier in the resumed conversation, not the newest one. */
export function resolveSessionLog(campaignDir: string, resuming: boolean): string {
  if (resuming) {
    const existing = latestSessionLogPath(campaignDir);
    if (existing) return existing;
  }
  return startSessionLog(campaignDir);
}

export interface StateSnapshot {
  characterSheet: unknown;
  worldState: string;
  npcRoster: string;
  questLog: string;
  model: ModelId;
  currentSessionLog?: { path: string; content: string };
}

export function readStateSnapshot(
  campaignDir: string,
  currentSessionLogRelPath?: string
): StateSnapshot {
  const read = (name: string) => fs.readFileSync(path.join(campaignDir, name), "utf8");

  const snapshot: StateSnapshot = {
    characterSheet: JSON.parse(read("character-sheet.json")),
    worldState: read("world-state.md"),
    npcRoster: read("npc-roster.md"),
    questLog: read("quest-log.md"),
    model: readCampaignModel(campaignDir),
  };

  if (currentSessionLogRelPath) {
    const abs = path.join(campaignDir, currentSessionLogRelPath);
    if (fs.existsSync(abs)) {
      snapshot.currentSessionLog = {
        path: currentSessionLogRelPath,
        content: fs.readFileSync(abs, "utf8"),
      };
    }
  }

  return snapshot;
}
