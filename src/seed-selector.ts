import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { CAMPAIGNS_ROOT } from "./campaign-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_TABLES_PATH = path.resolve(__dirname, "../data/seed-tables.json");
const REGISTRY_DIR = path.join(CAMPAIGNS_ROOT, "_registry");
const REGISTRY_PATH = path.join(REGISTRY_DIR, "content-registry.md");

/** Chance a roll draws from a wildcard pool instead of the conventional one,
 * per design doc §4 ("~15-20%, so strangeness punctuates rather than
 * saturates"). Overridable via env for tuning/testing, and per-campaign via
 * ADR-0004's toneWhimsy setting (see createSeedMcpServer below) — the env
 * var is the process-wide default; toneWhimsy is a per-campaign override
 * on top of it. */
const WILDCARD_CHANCE = process.env.SEED_WILDCARD_CHANCE
  ? Number(process.env.SEED_WILDCARD_CHANCE)
  : 0.175;

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

function readRegistry(): RegistryData {
  fs.mkdirSync(REGISTRY_DIR, { recursive: true });
  if (!fs.existsSync(REGISTRY_PATH)) {
    fs.writeFileSync(REGISTRY_PATH, serializeRegistry(emptyRegistry()));
  }
  return parseRegistry(fs.readFileSync(REGISTRY_PATH, "utf8"));
}

/** Appends `value` to `category`'s section. Synchronous, no `await` between
 * the read and the write, so no other campaign's turn can interleave and
 * lose this update within this process. */
function logEntry(category: SeedCategory, value: string): void {
  const registry = readRegistry();
  registry[category].push(value);
  fs.writeFileSync(REGISTRY_PATH, serializeRegistry(registry));
}

function pickUnused(options: string[], used: Set<string>): { value: string; exhausted: boolean } {
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
function pickWithWildcard(
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
 * the global registry, and logs the result immediately (before the caller
 * has done anything with it). `wildcardChance` defaults to the module-wide
 * WILDCARD_CHANCE but can be overridden per call — this is how ADR-0004's
 * per-campaign toneWhimsy setting reaches the roll without forking any of
 * the table/registry logic itself. */
export function rollSeed(category: SeedCategory, wildcardChance: number = WILDCARD_CHANCE): SeedResult {
  const tables = loadSeedTables();
  const registry = readRegistry();

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

  logEntry(category, picked.value);
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
 * be reading. */
export function createSeedMcpServer(wildcardChance: number = WILDCARD_CHANCE) {
  const rollSeedTool = tool(
    "roll_seed",
    `Roll a fresh story seed before creating a genuinely NEW npc-roster.md
entry, world-state.md location, or quest-log.md quest thread — not on
every mention, only the first time that NPC/location/quest is created.
Elaborate the returned seed in your own words as natural narration and
state-file prose; never quote or recite its wording verbatim, it's
inspiration, not dialogue. The seed is drawn from a shared registry across
all campaigns, so it won't repeat something already used elsewhere.`,
    {
      category: z
        .enum(["quest_hook", "complication", "villain_motive", "location", "npc"])
        .describe(
          "quest_hook/complication/villain_motive: single story beat. location: new place (archetype + modifier, occasionally a standalone wildcard place). npc: new named character (role + trait + quirk, occasionally a standalone wildcard character)."
        ),
    },
    async ({ category }) => {
      const result = rollSeed(category, wildcardChance);
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
  );

  return createSdkMcpServer({ name: "seed-tables", tools: [rollSeedTool] });
}

export const seedMcpServer = createSeedMcpServer();

export const SEED_TOOL_NAME = "mcp__seed-tables__roll_seed";
