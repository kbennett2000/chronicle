import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { CAMPAIGNS_ROOT } from "./campaign-store.js";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_TABLES_PATH = path.resolve(__dirname, "../data/seed-tables.json");
const REGISTRY_DIR = path.join(CAMPAIGNS_ROOT, "_registry");
const REGISTRY_PATH = path.join(REGISTRY_DIR, "content-registry.md");

/** Scratch campaigns (per scratch-campaign.ts's own naming convention) are
 * wholesale-created and -deleted for one-off validation runs. Rolling seeds
 * against the shared global registry during those runs pollutes it with
 * throwaway entries that then need a manual git revert before every commit.
 * Routing a scratch campaign's registry reads/writes to a file inside its
 * own directory instead means the registry is deleted along with the
 * campaign — no separate cleanup step, ever. */
function isScratchCampaign(campaignDir: string): boolean {
  return path.basename(campaignDir).startsWith("scratch-");
}

/** `localRegistry` forces the per-campaign registry file even for a non-scratch
 * campaign. The Grok backend sets it: its `--sandbox workspace` confines writes
 * to campaignDir, and the shared global registry (campaigns/_registry/) is a
 * SIBLING outside that sandbox, so a global read/write would be blocked. A Grok
 * campaign therefore dedups against its own history only — see seed-server.ts
 * and ADR-0018 Slice 5. The Claude in-process path never passes it, so its
 * cross-campaign global registry is unchanged. */
function registryPathFor(campaignDir?: string, localRegistry = false): { dir: string; path: string } {
  if (campaignDir && (localRegistry || isScratchCampaign(campaignDir))) {
    return { dir: campaignDir, path: path.join(campaignDir, "content-registry.md") };
  }
  return { dir: REGISTRY_DIR, path: REGISTRY_PATH };
}

/** Chance a roll draws from a wildcard pool instead of the conventional one,
 * per design doc §4 ("~15-20%, so strangeness punctuates rather than
 * saturates"). Overridable via config.defaults.seedWildcardChance for tuning
 * (ADR-0033), and per-campaign via ADR-0004's toneWhimsy setting (see
 * createSeedMcpServer below) — the config value is the process-wide default;
 * toneWhimsy is a per-campaign override on top of it. */
export const WILDCARD_CHANCE = config.defaults.seedWildcardChance;

/** How many of the most recent combo rolls (per category) to pull
 * individual field values from when biasing away from recent reuse. */
const FIELD_RECENCY_WINDOW = 6;

/** Weight multiplier applied to a field value that appears in the recency
 * window — soft deprioritization, not exclusion, so pools nearing
 * exhaustion don't paint the roller into a corner. */
const FIELD_RECENCY_PENALTY = 0.15;

export type SeedCategory =
  | "quest_hook"
  | "complication"
  | "villain_motive"
  | "location"
  | "npc";

const CATEGORY_ORDER: SeedCategory[] = [
  "quest_hook",
  "complication",
  "villain_motive",
  "location",
  "npc",
];

interface SeedTables {
  quest_hooks: string[];
  quest_hooks_wildcard: string[];
  complications: string[];
  complications_wildcard: string[];
  villain_motives: string[];
  villain_motives_wildcard: string[];
  location_archetypes: string[];
  location_modifiers: string[];
  locations_wildcard_standalone: string[];
  npc_roles: string[];
  npc_traits: string[];
  npc_quirks: string[];
  npcs_wildcard_standalone: string[];
}

type RegistryData = Record<SeedCategory, string[]>;

export interface SeedResult {
  category: SeedCategory;
  /** Combo categories (npc, location) join their fields with " | ", unless
   * a standalone wildcard entry was drawn instead of a combo. */
  value: string;
  /** True if every option/combo in the table was already logged, so this
   * one is a forced reuse rather than a fresh pick. */
  exhausted: boolean;
}

function loadSeedTables(): SeedTables {
  return JSON.parse(fs.readFileSync(SEED_TABLES_PATH, "utf8"));
}

function emptyRegistry(): RegistryData {
  return { quest_hook: [], complication: [], villain_motive: [], location: [], npc: [] };
}

function parseRegistry(text: string): RegistryData {
  const data = emptyRegistry();
  let current: SeedCategory | null = null;
  for (const line of text.split("\n")) {
    const heading = line.match(/^##\s+(\S+)/);
    if (heading) {
      current = CATEGORY_ORDER.includes(heading[1] as SeedCategory)
        ? (heading[1] as SeedCategory)
        : null;
      continue;
    }
    if (current && line.startsWith("- ")) {
      data[current].push(line.slice(2).trim());
    }
  }
  return data;
}

function serializeRegistry(data: RegistryData): string {
  const header = `# Content Registry

Global, cross-campaign log of every seed table entry or combination
rolled so far. Checked before rolling anything new, to keep quest hooks,
complications, villain motives, locations, and NPCs from repeating across
campaigns rather than just within one story. Combo categories (npc,
location) are logged as \`field | field | field\`, except standalone
wildcard draws, which are logged as their full text with no separators;
single-entry categories log the entry text as-is. Entries are written the
instant they're rolled, before use, so a crash mid-turn can't lose the log.
`;
  const sections = CATEGORY_ORDER.map((category) => {
    const lines = data[category].map((v) => `- ${v}`).join("\n");
    return `\n## ${category}\n${lines}${lines ? "\n" : ""}`;
  });
  return header + sections.join("");
}

function readRegistry(campaignDir?: string, localRegistry = false): RegistryData {
  const { dir, path: registryPath } = registryPathFor(campaignDir, localRegistry);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(registryPath)) {
    fs.writeFileSync(registryPath, serializeRegistry(emptyRegistry()));
  }
  return parseRegistry(fs.readFileSync(registryPath, "utf8"));
}

/** Appends `value` to `category`'s section. Synchronous, no `await` between
 * the read and the write, so no other campaign's turn can interleave and
 * lose this update within this process. */
function logEntry(category: SeedCategory, value: string, campaignDir?: string, localRegistry = false): void {
  const registry = readRegistry(campaignDir, localRegistry);
  registry[category].push(value);
  fs.writeFileSync(registryPathFor(campaignDir, localRegistry).path, serializeRegistry(registry));
}

export function pickUnused(options: string[], used: Set<string>): { value: string; exhausted: boolean } {
  const remaining = options.filter((o) => !used.has(o));
  if (remaining.length > 0) {
    return { value: remaining[Math.floor(Math.random() * remaining.length)], exhausted: false };
  }
  return { value: options[Math.floor(Math.random() * options.length)], exhausted: true };
}

/** Single-value categories (quest_hook, complication, villain_motive): roll
 * from the wildcard pool at WILDCARD_CHANCE, otherwise the conventional
 * pool. Dedup is checked against the full registry set regardless of which
 * pool a value came from — the registry doesn't distinguish origin. */
export function pickWithWildcard(
  conventional: string[],
  wildcard: string[],
  used: Set<string>,
  wildcardChance: number
): { value: string; exhausted: boolean } {
  const pool = Math.random() < wildcardChance ? wildcard : conventional;
  return pickUnused(pool, used);
}

/** Weighted random pick that deprioritizes (not excludes) values seen in
 * `recent` — used per-field so combo rolls stop reusing e.g. the same
 * trait or modifier well before the full combo space is exhausted. */
function pickFieldWeighted(options: string[], recent: Set<string>): string {
  const weights = options.map((o) => (recent.has(o) ? FIELD_RECENCY_PENALTY : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < options.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return options[i];
  }
  return options[options.length - 1];
}

/** Recent field values, per field index, drawn from the last
 * FIELD_RECENCY_WINDOW combo entries logged for `category`. Entries that
 * don't split into exactly `fieldCount` parts (i.e. standalone wildcard
 * draws) are skipped — they have no decomposable fields to track. */
function recentFieldSets(usedCombos: string[], fieldCount: number): Set<string>[] {
  const sets = Array.from({ length: fieldCount }, () => new Set<string>());
  const combos = usedCombos
    .map((c) => c.split(" | "))
    .filter((parts) => parts.length === fieldCount);
  for (const combo of combos.slice(-FIELD_RECENCY_WINDOW)) {
    combo.forEach((value, i) => sets[i].add(value));
  }
  return sets;
}

/** Combo categories (npc, location) sample by rejection rather than
 * enumerating the full cross product — fields x fields is small (<=1000)
 * so a bounded number of random draws reliably finds an unused combo. Each
 * field is drawn with recency-weighted sampling so individual field values
 * (a trait, a modifier) don't recur every few rolls even while the combo
 * space itself is nowhere near exhausted. */
function pickUnusedCombo(
  fields: string[][],
  usedCombos: string[]
): { value: string; exhausted: boolean } {
  const used = new Set(usedCombos);
  const recent = recentFieldSets(usedCombos, fields.length);
  const totalCombos = fields.reduce((n, f) => n * f.length, 1);
  const maxAttempts = Math.min(500, totalCombos * 3);
  let combo: string[] = [];
  for (let i = 0; i < maxAttempts; i++) {
    combo = fields.map((f, idx) => pickFieldWeighted(f, recent[idx]));
    if (!used.has(combo.join(" | "))) {
      return { value: combo.join(" | "), exhausted: false };
    }
  }
  return { value: combo.join(" | "), exhausted: true };
}

/** Combo categories (npc, location) additionally roll a fully-formed
 * standalone wildcard entry at WILDCARD_CHANCE instead of building a combo
 * from fields — these have no separate fields to bias/track. */
function pickComboWithWildcard(
  fields: string[][],
  standalone: string[],
  usedCombos: string[],
  wildcardChance: number
): { value: string; exhausted: boolean } {
  if (Math.random() < wildcardChance) {
    return pickUnused(standalone, new Set(usedCombos));
  }
  return pickUnusedCombo(fields, usedCombos);
}

/** Rolls a fresh seed for `category`, excluding anything already logged in
 * the registry, and logs the result immediately (before the caller has done
 * anything with it). `wildcardChance` defaults to the module-wide
 * WILDCARD_CHANCE but can be overridden per call — this is how ADR-0004's
 * per-campaign toneWhimsy setting reaches the roll without forking any of
 * the table/registry logic itself. `campaignDir`, when given, routes a
 * scratch- campaign to its own isolated registry file instead of the
 * shared global one (see registryPathFor). `localRegistry` forces that same
 * per-campaign isolation for a non-scratch campaign — the Grok backend sets it
 * because the global registry is outside its sandbox (ADR-0018 Slice 5). */
export function rollSeed(
  category: SeedCategory,
  wildcardChance: number = WILDCARD_CHANCE,
  campaignDir?: string,
  localRegistry = false
): SeedResult {
  const tables = loadSeedTables();
  const registry = readRegistry(campaignDir, localRegistry);

  let picked: { value: string; exhausted: boolean };
  switch (category) {
    case "npc":
      picked = pickComboWithWildcard(
        [tables.npc_roles, tables.npc_traits, tables.npc_quirks],
        tables.npcs_wildcard_standalone,
        registry.npc,
        wildcardChance
      );
      break;
    case "location":
      picked = pickComboWithWildcard(
        [tables.location_archetypes, tables.location_modifiers],
        tables.locations_wildcard_standalone,
        registry.location,
        wildcardChance
      );
      break;
    case "quest_hook":
      picked = pickWithWildcard(
        tables.quest_hooks,
        tables.quest_hooks_wildcard,
        new Set(registry.quest_hook),
        wildcardChance
      );
      break;
    case "complication":
      picked = pickWithWildcard(
        tables.complications,
        tables.complications_wildcard,
        new Set(registry.complication),
        wildcardChance
      );
      break;
    case "villain_motive":
      picked = pickWithWildcard(
        tables.villain_motives,
        tables.villain_motives_wildcard,
        new Set(registry.villain_motive),
        wildcardChance
      );
      break;
  }

  logEntry(category, picked.value, campaignDir, localRegistry);
  return { category, value: picked.value, exhausted: picked.exhausted };
}

const CATEGORY_FIELD_LABELS: Record<SeedCategory, string> = {
  quest_hook: "hook",
  complication: "complication",
  villain_motive: "motive",
  location: "archetype | modifier",
  npc: "role | trait | quirk",
};

/** Builds the seed-tables MCP server with `wildcardChance` baked into its
 * roll_seed tool. A fresh server is built per turn (see dm-engine.ts) so
 * each campaign's ADR-0004 toneWhimsy setting — if any — applies without
 * mutating shared module state that other campaigns' in-flight turns might
 * be reading. `campaignDir`, when given, is threaded into rollSeed so a
 * scratch- campaign's rolls land in its own isolated registry file instead
 * of the shared global one. */
/** Shared tool metadata (ADR-0018): one source of truth for the in-process
 * Claude tool and the standalone stdio MCP server (src/mcp-servers/seed-server.ts). */
export const ROLL_SEED_DESCRIPTION = `Roll a fresh story seed before creating a genuinely NEW npc-roster.md
entry, world-state.md location, or quest-log.md quest thread — not on
every mention, only the first time that NPC/location/quest is created.
Elaborate the returned seed in your own words as natural narration and
state-file prose; never quote or recite its wording verbatim, it's
inspiration, not dialogue. The seed is drawn from a registry of what has
already been used, so it won't repeat something you've introduced before.`;

export const ROLL_SEED_INPUT_SHAPE = {
  category: z
    .enum(["quest_hook", "complication", "villain_motive", "location", "npc"])
    .describe(
      "quest_hook/complication/villain_motive: single story beat. location: new place (archetype + modifier, occasionally a standalone wildcard place). npc: new named character (role + trait + quirk, occasionally a standalone wildcard character)."
    ),
};

/** Provider-neutral tool body. `wildcardChance`/`campaignDir` are supplied by
 * the caller: the in-process server bakes them into a closure per turn; the
 * stdio server reads them from env + the campaign's live settings per call.
 * `localRegistry` is set by the Grok stdio server so its sandboxed turn writes
 * a per-campaign registry rather than the out-of-sandbox global one. */
export function runRollSeedTool(
  args: { category: SeedCategory },
  wildcardChance: number = WILDCARD_CHANCE,
  campaignDir?: string,
  localRegistry = false
): { content: { type: "text"; text: string }[] } {
  const result = rollSeed(args.category, wildcardChance, campaignDir, localRegistry);
  const label = CATEGORY_FIELD_LABELS[result.category];
  return {
    content: [
      {
        type: "text" as const,
        text: `Seed (${label}): ${result.value}${
          result.exhausted
            ? "\n(Every option in this table has been used at least once — this is a reuse. Vary your elaboration so it doesn't read like a repeat.)"
            : ""
        }`,
      },
    ],
  };
}

export function createSeedMcpServer(wildcardChance: number = WILDCARD_CHANCE, campaignDir?: string) {
  const rollSeedTool = tool("roll_seed", ROLL_SEED_DESCRIPTION, ROLL_SEED_INPUT_SHAPE, async (args) =>
    runRollSeedTool(args, wildcardChance, campaignDir)
  );

  return createSdkMcpServer({ name: "seed-tables", tools: [rollSeedTool] });
}

export const seedMcpServer = createSeedMcpServer();

export const SEED_TOOL_NAME = "mcp__seed-tables__roll_seed";
