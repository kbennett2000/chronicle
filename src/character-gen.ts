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

/** Issue #67 (ADR-0015): the 18 SRD skills, each mapped to its governing
 * ability. Hardcoded here (curated SRD subset, like CLASS_HIT_DICE) and
 * mirrored client-side. FLAGGED FOR RULES REVIEW. */
export interface SkillDef {
  key: string;
  label: string;
  ability: AbilityName;
}
export const SKILLS: SkillDef[] = [
  { key: "acrobatics", label: "Acrobatics", ability: "dexterity" },
  { key: "animalHandling", label: "Animal Handling", ability: "wisdom" },
  { key: "arcana", label: "Arcana", ability: "intelligence" },
  { key: "athletics", label: "Athletics", ability: "strength" },
  { key: "deception", label: "Deception", ability: "charisma" },
  { key: "history", label: "History", ability: "intelligence" },
  { key: "insight", label: "Insight", ability: "wisdom" },
  { key: "intimidation", label: "Intimidation", ability: "charisma" },
  { key: "investigation", label: "Investigation", ability: "intelligence" },
  { key: "medicine", label: "Medicine", ability: "wisdom" },
  { key: "nature", label: "Nature", ability: "intelligence" },
  { key: "perception", label: "Perception", ability: "wisdom" },
  { key: "performance", label: "Performance", ability: "charisma" },
  { key: "persuasion", label: "Persuasion", ability: "charisma" },
  { key: "religion", label: "Religion", ability: "intelligence" },
  { key: "sleightOfHand", label: "Sleight of Hand", ability: "dexterity" },
  { key: "stealth", label: "Stealth", ability: "dexterity" },
  { key: "survival", label: "Survival", ability: "wisdom" },
];
export const SKILL_KEYS: string[] = SKILLS.map((s) => s.key);

/** Each class's two saving-throw proficiencies (SRD 2014). FLAGGED. */
export const CLASS_SAVE_PROFICIENCIES: Record<string, AbilityName[]> = {
  Barbarian: ["strength", "constitution"],
  Bard: ["dexterity", "charisma"],
  Cleric: ["wisdom", "charisma"],
  Druid: ["intelligence", "wisdom"],
  Fighter: ["strength", "constitution"],
  Monk: ["strength", "dexterity"],
  Paladin: ["wisdom", "charisma"],
  Ranger: ["strength", "dexterity"],
  Rogue: ["dexterity", "intelligence"],
  Sorcerer: ["constitution", "charisma"],
  Warlock: ["wisdom", "charisma"],
  Wizard: ["intelligence", "wisdom"],
};

/** Each class's skill list and how many the player picks (SRD 2014). Bard
 * chooses from all 18. FLAGGED FOR RULES REVIEW. */
export interface SkillChoice {
  list: string[];
  choose: number;
}
export const CLASS_SKILL_CHOICES: Record<string, SkillChoice> = {
  Barbarian: { list: ["animalHandling", "athletics", "intimidation", "nature", "perception", "survival"], choose: 2 },
  Bard: { list: [...SKILL_KEYS], choose: 3 },
  Cleric: { list: ["history", "insight", "medicine", "persuasion", "religion"], choose: 2 },
  Druid: { list: ["arcana", "animalHandling", "insight", "medicine", "nature", "perception", "religion", "survival"], choose: 2 },
  Fighter: { list: ["acrobatics", "animalHandling", "athletics", "history", "insight", "intimidation", "perception", "survival"], choose: 2 },
  Monk: { list: ["acrobatics", "athletics", "history", "insight", "religion", "stealth"], choose: 2 },
  Paladin: { list: ["athletics", "insight", "intimidation", "medicine", "persuasion", "religion"], choose: 2 },
  Ranger: { list: ["animalHandling", "athletics", "insight", "investigation", "nature", "perception", "stealth", "survival"], choose: 3 },
  Rogue: { list: ["acrobatics", "athletics", "deception", "insight", "intimidation", "investigation", "perception", "performance", "persuasion", "sleightOfHand", "stealth"], choose: 4 },
  Sorcerer: { list: ["arcana", "deception", "insight", "intimidation", "persuasion", "religion"], choose: 2 },
  Warlock: { list: ["arcana", "deception", "history", "intimidation", "investigation", "nature", "religion"], choose: 2 },
  Wizard: { list: ["arcana", "history", "insight", "investigation", "medicine", "religion"], choose: 2 },
};

/** Base walking speed (feet) per species. 2024-leaning default; the 2014 vs
 * 2024 SRD diverge (esp. small races). FLAGGED FOR RULES REVIEW. Anything not
 * listed falls back to 30. */
export const RACE_SPEED: Record<string, number> = {
  Human: 30,
  Elf: 30,
  Dwarf: 30,
  Halfling: 30,
  Dragonborn: 30,
  Gnome: 30,
  "Half-Elf": 30,
  "Half-Orc": 30,
  Tiefling: 30,
  Orc: 30,
  Aasimar: 30,
  Goliath: 35,
};
export const DEFAULT_SPEED = 30;

export interface CharacterCreationInput {
  name: string;
  race: string;
  class: string;
  abilityScores: Record<AbilityName, number>;
  /** Issue #71: free-text physical description (sex, build, hair, skin,
   * distinguishing marks). Optional. The image generator has nothing else to
   * go on — race+class alone rendered a female Goliath as a man — so this is
   * what makes a portrait match the player's intent. Pure flavor, no mechanics. */
  appearance?: string;
  /** Issue #67 (ADR-0015): the class's skill picks — a subset of
   * CLASS_SKILL_CHOICES[class].list of exactly `.choose` entries. */
  skillProficiencies?: string[];
  /** Issue #67: doubled-proficiency skills (Rogue picks 2). Subset of the
   * chosen skillProficiencies. */
  expertise?: string[];
  background?: string;
  alignment?: string;
  personality?: { traits?: string; ideals?: string; bonds?: string; flaws?: string };
}

/** Cap the free-text appearance so a pasted essay can't bloat the sheet or the
 * image prompt. Generous enough for a rich description, short enough to stay a
 * prompt fragment. */
export const MAX_APPEARANCE_CHARS = 600;

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

  let appearance: string | undefined;
  if (input.appearance !== undefined && input.appearance !== null) {
    if (typeof input.appearance !== "string") {
      throw new CharacterValidationError("appearance must be a string");
    }
    const trimmed = input.appearance.trim();
    if (trimmed.length > MAX_APPEARANCE_CHARS) {
      throw new CharacterValidationError(`appearance must be ${MAX_APPEARANCE_CHARS} characters or fewer`);
    }
    if (trimmed) appearance = trimmed;
  }

  // Issue #67 (ADR-0015): validate the class's skill picks and expertise.
  const choice = CLASS_SKILL_CHOICES[input.class];
  let skillProficiencies: string[] = [];
  if (input.skillProficiencies !== undefined && input.skillProficiencies !== null) {
    if (!Array.isArray(input.skillProficiencies) || input.skillProficiencies.some((s) => typeof s !== "string")) {
      throw new CharacterValidationError("skillProficiencies must be an array of skill keys");
    }
    const picks = [...new Set(input.skillProficiencies)];
    if (picks.length !== input.skillProficiencies.length) {
      throw new CharacterValidationError("skillProficiencies must not contain duplicates");
    }
    if (picks.some((s) => !choice.list.includes(s))) {
      throw new CharacterValidationError(`skillProficiencies must be chosen from the ${input.class} skill list`);
    }
    if (picks.length !== choice.choose) {
      throw new CharacterValidationError(`${input.class} must choose exactly ${choice.choose} skill proficiencies`);
    }
    skillProficiencies = picks;
  }

  let expertise: string[] = [];
  if (input.expertise !== undefined && input.expertise !== null) {
    if (!Array.isArray(input.expertise) || input.expertise.some((s) => typeof s !== "string")) {
      throw new CharacterValidationError("expertise must be an array of skill keys");
    }
    const picks = [...new Set(input.expertise)];
    if (picks.some((s) => !skillProficiencies.includes(s))) {
      throw new CharacterValidationError("expertise must be a subset of the chosen skill proficiencies");
    }
    expertise = picks;
  }

  const optionalText = (value: unknown, field: string, max: number): string | undefined => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") throw new CharacterValidationError(`${field} must be a string`);
    const trimmed = value.trim();
    if (trimmed.length > max) throw new CharacterValidationError(`${field} must be ${max} characters or fewer`);
    return trimmed || undefined;
  };
  const background = optionalText(input.background, "background", 120);
  const alignment = optionalText(input.alignment, "alignment", 40);
  const personality = {
    traits: optionalText(input.personality?.traits, "personality.traits", 400),
    ideals: optionalText(input.personality?.ideals, "personality.ideals", 400),
    bonds: optionalText(input.personality?.bonds, "personality.bonds", 400),
    flaws: optionalText(input.personality?.flaws, "personality.flaws", 400),
  };
  const hasPersonality = Object.values(personality).some(Boolean);

  const hitDie = CLASS_HIT_DICE[input.class];
  const conMod = abilityModifier(scores.constitution);
  const dexMod = abilityModifier(scores.dexterity);
  const maxHp = Math.max(1, hitDie + conMod);

  const sheet: Record<string, unknown> = {
    name,
    race: input.race,
    class: input.class,
    level: 1,
    hp: { current: maxHp, max: maxHp },
    armorClass: 10 + dexMod,
    speed: RACE_SPEED[input.race] ?? DEFAULT_SPEED,
    abilityScores: scores,
    // Derived from class (ADR-0015 rules-review item 7); skills are player-chosen.
    savingThrowProficiencies: CLASS_SAVE_PROFICIENCIES[input.class],
    skillProficiencies,
    expertise,
    conditions: [],
    inventory: [],
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    xp: 0,
    spellSlots: {},
    languages: [],
    otherProficiencies: [],
    featuresAndTraits: [],
  };
  // Only write authored fields when they have content — an absent field stays
  // absent on disk (the "field may just not be there yet" contract).
  if (appearance) sheet.appearance = appearance;
  if (background) sheet.background = background;
  if (alignment) sheet.alignment = alignment;
  if (hasPersonality) {
    // Drop the undefined sub-fields so only what was filled is stored.
    sheet.personality = Object.fromEntries(Object.entries(personality).filter(([, v]) => v));
  }
  return sheet;
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
