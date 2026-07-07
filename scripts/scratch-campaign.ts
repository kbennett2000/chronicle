/** Creates and destroys disposable scratch campaign directories for ad-hoc
 * validation, per CLAUDE.md's "Test data hygiene" rule: experimental runs
 * must never reuse test-campaign or any other named fixture.
 *
 * Usage:
 *   npx tsx scripts/scratch-campaign.ts create
 *   npx tsx scripts/scratch-campaign.ts create --provider grok --model grok-build --images
 *   npx tsx scripts/scratch-campaign.ts delete <id>
 *
 * `create` prints the new campaign id to stdout. Its optional flags let a
 * parity/validation run (scripts/verify-grok-parity.ts) scaffold a campaign on
 * a specific engine instead of the Claude/Sonnet default. `delete` hard-refuses
 * any id that doesn't start with "scratch-" — this is the actual safety rail,
 * not a confirmation prompt that could be bypassed.
 */
import fs from "node:fs";
import path from "node:path";
import { CAMPAIGNS_ROOT, scaffoldCampaign } from "../src/campaign-store.js";

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

interface CreateOptions {
  provider?: string;
  model?: string;
  images?: boolean;
}

/** Parse `--provider x --model y --images` off create's remaining argv. Unknown
 * flags are ignored — this is a validation helper, not a strict CLI. */
function parseCreateOptions(argv: string[]): CreateOptions {
  const opts: CreateOptions = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--provider") opts.provider = argv[++i];
    else if (argv[i] === "--model") opts.model = argv[++i];
    else if (argv[i] === "--images") opts.images = true;
  }
  return opts;
}

function createScratchCampaign(opts: CreateOptions = {}): string {
  // Lowercased: campaign-store.ts's CAMPAIGN_ID_PATTERN only allows
  // lowercase letters, and toISOString()'s literal "T"/"Z" would otherwise
  // produce an id that resolveCampaignDir() rejects.
  const id = `${SCRATCH_PREFIX}${new Date().toISOString().replace(/[:.]/g, "-")}`.toLowerCase();
  // Written verbatim into campaign-settings.json; readCampaignProvider/Settings
  // read provider/model straight back out. Default matches the plain create.
  const settings: Record<string, unknown> = {
    model: opts.model ?? "claude-sonnet-5",
    autoRollDice: true,
  };
  if (opts.provider) settings.provider = opts.provider;
  if (opts.images) settings.generateImages = true;
  scaffoldCampaign(id, EMPTY_CHARACTER_SHEET, settings);
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
    createScratchCampaign(parseCreateOptions(process.argv.slice(3)));
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
