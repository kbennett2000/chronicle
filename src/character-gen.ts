/** Level-1 character-sheet derivation for in-app character creation
 * (ADR-0010). Every mechanical choice here is a deterministic, standard-SRD
 * assumption FLAGGED FOR RULES REVIEW per CLAUDE.md — not asserted correct.
 * See docs/adr/0010 for the specific choices Kris should confirm. */

export type AbilityName =
  | "strength"
  | "dexterity"
  | "constitution"
  | "intelligence"
  | "wisdom"
  | "charisma";

export const ABILITY_NAMES: AbilityName[] = [
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
  "charisma",
];

/** Standard SRD 5.2 class hit dice. Hardcoded because reference/srd/ is a
 * curated adjudication subset that does not carry the hit-die table. */
export const CLASS_HIT_DICE: Record<string, number> = {
  Barbarian: 12,
  Fighter: 10,
  Paladin: 10,
  Ranger: 10,
  Bard: 8,
  Cleric: 8,
  Druid: 8,
  Monk: 8,
  Rogue: 8,
  Warlock: 8,
  Sorcerer: 6,
  Wizard: 6,
};

export const CLASSES: string[] = Object.keys(CLASS_HIT_DICE);

/** SRD 5.2 (2024) player species. Captured as identity/flavor only — no
 * racial ability bonuses are applied (those come from background under the
 * 2024 rules, which char-gen does not yet model). Flagged in ADR-0010. */
export const RACES: string[] = [
  "Human",
  "Elf",
  "Dwarf",
  "Halfling",
  "Dragonborn",
  "Gnome",
  "Half-Elf",
  "Half-Orc",
  "Tiefling",
  "Orc",
  "Aasimar",
  "Goliath",
];

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export interface CharacterCreationInput {
  name: string;
  race: string;
  class: string;
  abilityScores: Record<AbilityName, number>;
}

export class CharacterValidationError extends Error {}

/** Validates a creation request and derives a complete level-1 sheet in the
 * same shape scripts/scratch-campaign.ts's EMPTY_CHARACTER_SHEET uses (so
 * every downstream reader — panels, gallery — sees a familiar record). */
export function buildCharacterSheet(input: CharacterCreationInput): Record<string, unknown> {
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  if (!name) throw new CharacterValidationError("name is required");
  if (typeof input.race !== "string" || !RACES.includes(input.race)) {
    throw new CharacterValidationError(`race must be one of: ${RACES.join(", ")}`);
  }
  if (typeof input.class !== "string" || !CLASSES.includes(input.class)) {
    throw new CharacterValidationError(`class must be one of: ${CLASSES.join(", ")}`);
  }

  const scores = {} as Record<AbilityName, number>;
  for (const ability of ABILITY_NAMES) {
    const raw = input.abilityScores?.[ability];
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 20) {
      throw new CharacterValidationError(`${ability} must be an integer between 1 and 20`);
    }
    scores[ability] = raw;
  }

  const hitDie = CLASS_HIT_DICE[input.class];
  const conMod = abilityModifier(scores.constitution);
  const dexMod = abilityModifier(scores.dexterity);
  const maxHp = Math.max(1, hitDie + conMod);

  return {
    name,
    race: input.race,
    class: input.class,
    level: 1,
    hp: { current: maxHp, max: maxHp },
    armorClass: 10 + dexMod,
    abilityScores: scores,
    conditions: [],
    inventory: [],
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    xp: 0,
    spellSlots: {},
  };
}

/** Turns a character name into a valid, unique campaign id
 * (CAMPAIGN_ID_PATTERN: /^[a-z0-9][a-z0-9-]*$/). `exists` lets the caller
 * disambiguate against campaigns already on disk. */
export function deriveCampaignId(name: string, exists: (id: string) => boolean): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || "hero";
  const base = /^[a-z0-9]/.test(slug) ? slug : `c-${slug}`;
  if (!exists(base)) return base;
  for (let n = 2; n < 10000; n++) {
    const candidate = `${base}-${n}`;
    if (!exists(candidate)) return candidate;
  }
  throw new Error("could not derive a unique campaign id");
}
