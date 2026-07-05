import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { pickUnused, pickWithWildcard, WILDCARD_CHANCE } from "./seed-selector.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_TABLES_PATH = path.resolve(__dirname, "../data/seed-tables.json");

/** Per design doc §4: these five categories are texture, not identity —
 * fine to recur across different campaigns, so dedup is per-campaign only,
 * never the global content-registry.md. Unlike seed-selector.ts's
 * scratch-vs-real split, there's no "which registry" branch here: every
 * campaign, scratch or real, gets its own texture-registry.md. */
export type TextureCategory =
  | "travel_event"
  | "rumor"
  | "encounter_twist"
  | "emotional_beat"
  | "surreal_moment";

const CATEGORY_ORDER: TextureCategory[] = [
  "travel_event",
  "rumor",
  "encounter_twist",
  "emotional_beat",
  "surreal_moment",
];

interface SeedTables {
  travel_events: string[];
  travel_events_wildcard: string[];
  rumors: string[];
  encounter_twists: string[];
  emotional_beats: string[];
  surreal_moments: string[];
}

type RegistryData = Record<TextureCategory, string[]>;

export interface TextureResult {
  category: TextureCategory;
  value: string;
  exhausted: boolean;
}

function loadSeedTables(): SeedTables {
  return JSON.parse(fs.readFileSync(SEED_TABLES_PATH, "utf8"));
}

function emptyRegistry(): RegistryData {
  return {
    travel_event: [],
    rumor: [],
    encounter_twist: [],
    emotional_beat: [],
    surreal_moment: [],
  };
}

function parseRegistry(text: string): RegistryData {
  const data = emptyRegistry();
  let current: TextureCategory | null = null;
  for (const line of text.split("\n")) {
    const heading = line.match(/^##\s+(\S+)/);
    if (heading) {
      current = CATEGORY_ORDER.includes(heading[1] as TextureCategory)
        ? (heading[1] as TextureCategory)
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
  const header = `# Texture Registry

Per-campaign log of travel events, rumors, encounter twists, emotional
beats, and surreal moments rolled so far in this campaign. Checked before
rolling anything new, so texture doesn't repeat within this one story —
unlike content-registry.md, this is per-campaign only: the same entry is
free to recur in a different campaign. Entries are written the instant
they're rolled, before use, so a crash mid-turn can't lose the log.
`;
  const sections = CATEGORY_ORDER.map((category) => {
    const lines = data[category].map((v) => `- ${v}`).join("\n");
    return `\n## ${category}\n${lines}${lines ? "\n" : ""}`;
  });
  return header + sections.join("");
}

const registryPathFor = (campaignDir: string) => path.join(campaignDir, "texture-registry.md");

/** Created lazily — unlike seed-selector.ts's registry, there's no need to
 * eagerly write an empty file on first read, since "file not found yet" is
 * already equivalent to an empty registry. */
function readRegistry(campaignDir: string): RegistryData {
  const registryPath = registryPathFor(campaignDir);
  if (!fs.existsSync(registryPath)) return emptyRegistry();
  return parseRegistry(fs.readFileSync(registryPath, "utf8"));
}

function logEntry(category: TextureCategory, value: string, campaignDir: string): void {
  const registry = readRegistry(campaignDir);
  registry[category].push(value);
  fs.writeFileSync(registryPathFor(campaignDir), serializeRegistry(registry));
}

/** Rolls a fresh texture beat for `category`, excluding anything already
 * logged in this campaign's own texture-registry.md, and logs the result
 * immediately. `wildcardChance` defaults to seed-selector's module-wide
 * WILDCARD_CHANCE but can be overridden per call (ADR-0004's toneWhimsy). */
export function rollTexture(
  category: TextureCategory,
  campaignDir: string,
  wildcardChance: number = WILDCARD_CHANCE
): TextureResult {
  const tables = loadSeedTables();
  const registry = readRegistry(campaignDir);

  let picked: { value: string; exhausted: boolean };
  switch (category) {
    case "travel_event":
      picked = pickWithWildcard(
        tables.travel_events,
        tables.travel_events_wildcard,
        new Set(registry.travel_event),
        wildcardChance
      );
      break;
    case "rumor":
      picked = pickUnused(tables.rumors, new Set(registry.rumor));
      break;
    case "encounter_twist":
      picked = pickUnused(tables.encounter_twists, new Set(registry.encounter_twist));
      break;
    case "emotional_beat":
      picked = pickUnused(tables.emotional_beats, new Set(registry.emotional_beat));
      break;
    case "surreal_moment":
      picked = pickUnused(tables.surreal_moments, new Set(registry.surreal_moment));
      break;
  }

  logEntry(category, picked.value, campaignDir);
  return { category, value: picked.value, exhausted: picked.exhausted };
}

const CATEGORY_TRIGGER_HINTS: Record<TextureCategory, string> = {
  travel_event:
    "while the party is traveling between locations — not on every step, only when a travel stretch would otherwise pass uneventfully",
  rumor:
    "during a social or downtime scene (tavern, market, camp) where overhearing gossip fits naturally",
  encounter_twist:
    "when generating a new combat or tense social encounter, to give it a memorable hook beyond stock stats",
  emotional_beat:
    "after a significant moment (a victory, a loss, a quiet lull, a bond forming) where an emotional beat would land, not on a timer",
  surreal_moment:
    "anywhere, sparingly, for a genuine 'what the fuck just happened' moment of strangeness",
};

/** Builds the texture-tables MCP server, bound to one campaign's own
 * texture-registry.md. A fresh server is built per turn (see dm-engine.ts),
 * same pattern as createSeedMcpServer. */
export function createTextureMcpServer(campaignDir: string, wildcardChance: number = WILDCARD_CHANCE) {
  const rollTextureTool = tool(
    "roll_texture",
    `Roll a fresh texture beat — a travel event, rumor, encounter twist,
emotional beat, or surreal moment — when you judge the moment calls for
one. These are NOT fixed-cadence rolls: don't call this on every travel
scene, every tavern visit, or every encounter, or it will feel mechanical
rather than alive. Call it only when you decide the moment genuinely fits:
${CATEGORY_TRIGGER_HINTS.travel_event} (travel_event); ${CATEGORY_TRIGGER_HINTS.rumor} (rumor);
${CATEGORY_TRIGGER_HINTS.encounter_twist} (encounter_twist); ${CATEGORY_TRIGGER_HINTS.emotional_beat} (emotional_beat);
${CATEGORY_TRIGGER_HINTS.surreal_moment} (surreal_moment).
Elaborate the returned beat in your own words as natural narration; never
quote or recite its wording verbatim, it's inspiration, not dialogue. The
beat is drawn from this campaign's own texture registry, so it won't
repeat something already used earlier in this same story (a different
campaign is free to reuse it — this is texture, not identity).`,
    {
      category: z
        .enum(["travel_event", "rumor", "encounter_twist", "emotional_beat", "surreal_moment"])
        .describe(
          "travel_event: a beat for a journey between locations. rumor: overheard gossip in a social/downtime scene. encounter_twist: a hook that makes a combat/tense encounter memorable. emotional_beat: an emotionally resonant moment tagged [happy]/[sad]/[bittersweet]/[funny]/[awe]. surreal_moment: a sparing, strange 'what just happened' beat."
        ),
    },
    async ({ category }) => {
      const result = rollTexture(category, campaignDir, wildcardChance);
      return {
        content: [
          {
            type: "text" as const,
            text: `Texture (${result.category}): ${result.value}${
              result.exhausted
                ? "\n(Every option in this table has been used at least once in this campaign — this is a reuse. Vary your elaboration so it doesn't read like a repeat.)"
                : ""
            }`,
          },
        ],
      };
    }
  );

  return createSdkMcpServer({ name: "texture-tables", tools: [rollTextureTool] });
}

export const TEXTURE_TOOL_NAME = "mcp__texture-tables__roll_texture";
