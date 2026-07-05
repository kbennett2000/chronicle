/** Creates and destroys disposable scratch campaign directories for ad-hoc
 * validation, per CLAUDE.md's "Test data hygiene" rule: experimental runs
 * must never reuse test-campaign or any other named fixture.
 *
 * Usage:
 *   npx tsx scripts/scratch-campaign.ts create
 *   npx tsx scripts/scratch-campaign.ts delete <id>
 *
 * `create` prints the new campaign id to stdout. `delete` hard-refuses any
 * id that doesn't start with "scratch-" — this is the actual safety rail,
 * not a confirmation prompt that could be bypassed.
 */
import fs from "node:fs";
import path from "node:path";
import { CAMPAIGNS_ROOT } from "../src/campaign-store.js";

const SCRATCH_PREFIX = "scratch-";

const EMPTY_CHARACTER_SHEET = {
  name: "",
  race: "",
  class: "",
  level: 1,
  hp: { current: 0, max: 0 },
  armorClass: 10,
  abilityScores: {
    strength: 10,
    dexterity: 10,
    constitution: 10,
    intelligence: 10,
    wisdom: 10,
    charisma: 10,
  },
  conditions: [],
  inventory: [],
  currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  xp: 0,
  spellSlots: {},
};

const EMPTY_WORLD_STATE = `# World State

## Current Situation
_(not yet started)_

## Locations Visited
_(none yet)_

## Factions
_(none established yet)_
`;

const EMPTY_NPC_ROSTER = `# NPC Roster

_(No named NPCs met yet. Add an entry per NPC on first meaningful
introduction, in this format:)_

<!--
## <Name>
- **Description:** appearance, role
- **Disposition:** attitude toward the player, current relationship
- **Knows:** information they can share
- **Portrait asset ID:** (none yet)
-->
`;

const EMPTY_QUEST_LOG = `# Quest Log

## Active
_(none yet)_

## Completed
_(none yet)_
`;

function createScratchCampaign(): string {
  // Lowercased: campaign-store.ts's CAMPAIGN_ID_PATTERN only allows
  // lowercase letters, and toISOString()'s literal "T"/"Z" would otherwise
  // produce an id that resolveCampaignDir() rejects.
  const id = `${SCRATCH_PREFIX}${new Date().toISOString().replace(/[:.]/g, "-")}`.toLowerCase();
  const dir = path.join(CAMPAIGNS_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "session-log"));
  fs.writeFileSync(path.join(dir, "session-log", ".gitkeep"), "");

  fs.writeFileSync(
    path.join(dir, "character-sheet.json"),
    JSON.stringify(EMPTY_CHARACTER_SHEET, null, 2) + "\n"
  );
  fs.writeFileSync(path.join(dir, "world-state.md"), EMPTY_WORLD_STATE);
  fs.writeFileSync(path.join(dir, "npc-roster.md"), EMPTY_NPC_ROSTER);
  fs.writeFileSync(path.join(dir, "quest-log.md"), EMPTY_QUEST_LOG);
  fs.writeFileSync(
    path.join(dir, "campaign-settings.json"),
    JSON.stringify({ model: "claude-sonnet-5" }, null, 2) + "\n"
  );

  console.log(id);
  return id;
}

function deleteScratchCampaign(id: string): void {
  if (!id.startsWith(SCRATCH_PREFIX)) {
    console.error(
      `refusing to delete "${id}": only campaign ids starting with "${SCRATCH_PREFIX}" may be deleted by this tool`
    );
    process.exit(1);
  }

  const dir = path.join(CAMPAIGNS_ROOT, id);
  if (path.dirname(dir) !== CAMPAIGNS_ROOT) {
    console.error(`refusing to delete "${id}": resolves outside campaigns/`);
    process.exit(1);
  }
  if (!fs.existsSync(dir)) {
    console.error(`campaign not found: ${id}`);
    process.exit(1);
  }

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`deleted ${id}`);
}

const [, , command, arg] = process.argv;

switch (command) {
  case "create":
    createScratchCampaign();
    break;
  case "delete":
    if (!arg) {
      console.error("usage: tsx scripts/scratch-campaign.ts delete <id>");
      process.exit(1);
    }
    deleteScratchCampaign(arg);
    break;
  default:
    console.error("usage: tsx scripts/scratch-campaign.ts <create|delete <id>>");
    process.exit(1);
}
