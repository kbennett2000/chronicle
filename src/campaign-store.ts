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

function readRawSettings(campaignDir: string): Record<string, unknown> {
  const file = campaignSettingsFile(campaignDir);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function writeRawSettings(campaignDir: string, raw: Record<string, unknown>): void {
  fs.writeFileSync(campaignSettingsFile(campaignDir), JSON.stringify(raw, null, 2) + "\n");
}

/** Existing campaigns with no stored preference default to DEFAULT_MODEL
 * rather than erroring — the setting is optional, not required. */
export function readCampaignModel(campaignDir: string): ModelId {
  const raw = readRawSettings(campaignDir);
  return typeof raw.model === "string" && isValidModelId(raw.model) ? raw.model : DEFAULT_MODEL;
}

/** Merges onto the existing file rather than overwriting it — this file
 * also holds the ADR-0004 reskin/tone/intensity fields below, and a plain
 * model-only write would silently wipe them out. */
export function persistCampaignModel(campaignDir: string, model: ModelId): void {
  writeRawSettings(campaignDir, { ...readRawSettings(campaignDir), model });
}

/** Per ADR-0004: optional per-campaign narration-layer dials, stored
 * alongside model selection. All absent = standard fantasy defaults,
 * existing WILDCARD_CHANCE, no content bounding — this feature is opt-in. */
export type ContentIntensity = "standard" | "low";
export const CONTENT_INTENSITIES: ContentIntensity[] = ["standard", "low"];

export interface CampaignSettings {
  model: ModelId;
  artStyle?: string;
  worldSetting?: string;
  /** 0-1. Overrides seed-selector's WILDCARD_CHANCE when set (per ADR-0004,
   * this is a UI surface on that existing config, not new machinery). */
  toneWhimsy?: number;
  contentIntensity?: ContentIntensity;
  /** Per Slice 9 / design doc §2.2: defaults to false (absent) since it
   * depends on Grok Build/SuperGrok access being configured on the host —
   * opt-in, never assumed. */
  generateImages?: boolean;
}

export function readCampaignSettings(campaignDir: string): CampaignSettings {
  const raw = readRawSettings(campaignDir);
  const settings: CampaignSettings = { model: readCampaignModel(campaignDir) };
  if (typeof raw.artStyle === "string" && raw.artStyle.trim()) {
    settings.artStyle = raw.artStyle.trim();
  }
  if (typeof raw.worldSetting === "string" && raw.worldSetting.trim()) {
    settings.worldSetting = raw.worldSetting.trim();
  }
  if (typeof raw.toneWhimsy === "number" && raw.toneWhimsy >= 0 && raw.toneWhimsy <= 1) {
    settings.toneWhimsy = raw.toneWhimsy;
  }
  if (
    typeof raw.contentIntensity === "string" &&
    CONTENT_INTENSITIES.includes(raw.contentIntensity as ContentIntensity)
  ) {
    settings.contentIntensity = raw.contentIntensity as ContentIntensity;
  }
  if (typeof raw.generateImages === "boolean") {
    settings.generateImages = raw.generateImages;
  }
  return settings;
}

/** Merges the given updates onto existing settings. An empty-string
 * artStyle/worldSetting clears that field back to "absent" (i.e. default)
 * rather than being stored as a literal empty string. */
export function persistCampaignSettings(
  campaignDir: string,
  updates: Partial<Omit<CampaignSettings, "model">>
): CampaignSettings {
  const raw = readRawSettings(campaignDir);
  const merged: Record<string, unknown> = { ...raw, ...updates };
  if (merged.artStyle === "") delete merged.artStyle;
  if (merged.worldSetting === "") delete merged.worldSetting;
  writeRawSettings(campaignDir, merged);
  return readCampaignSettings(campaignDir);
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
