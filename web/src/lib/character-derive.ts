import type { CharacterSheet } from "./campaign";

/** Issue #67 (ADR-0015): derive-don't-store. Every number here is computed from
 * the sheet's persisted inputs (scores, level, proficiency SETS) so it can't go
 * stale when the DM engine rewrites level/HP/etc. mid-play. Mirrors the SRD
 * tables in src/character-gen.ts; the server stays authoritative on write.
 * ALL FORMULAS ARE FLAGGED FOR RULES REVIEW (see ADR-0015). */

export type AbilityKey =
  | "strength"
  | "dexterity"
  | "constitution"
  | "intelligence"
  | "wisdom"
  | "charisma";

export interface SkillDef {
  key: string;
  label: string;
  ability: AbilityKey;
}

/** The 18 SRD skills and their governing ability (RULES-REVIEW item 6). */
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

export const ABILITY_LABELS: Array<{ key: AbilityKey; label: string }> = [
  { key: "strength", label: "STR" },
  { key: "dexterity", label: "DEX" },
  { key: "constitution", label: "CON" },
  { key: "intelligence", label: "INT" },
  { key: "wisdom", label: "WIS" },
  { key: "charisma", label: "CHA" },
];

/** RULES-REVIEW item 2: ability modifier = floor((score - 10) / 2). */
export function abilityMod(score: number | undefined): number {
  if (typeof score !== "number") return 0;
  return Math.floor((score - 10) / 2);
}

/** RULES-REVIEW item 1: PB = 2 + floor((level - 1) / 4). */
export function proficiencyBonus(level: number | undefined): number {
  const l = typeof level === "number" && level >= 1 ? level : 1;
  return 2 + Math.floor((l - 1) / 4);
}

export function formatMod(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

function abilityScore(sheet: CharacterSheet, ability: AbilityKey): number | undefined {
  return sheet.abilityScores?.[ability];
}

/** RULES-REVIEW item 3: save mod = ability mod + (proficient ? PB : 0). */
export function savingThrowMod(sheet: CharacterSheet, ability: AbilityKey): number {
  const proficient = (sheet.savingThrowProficiencies ?? []).includes(ability);
  return abilityMod(abilityScore(sheet, ability)) + (proficient ? proficiencyBonus(sheet.level) : 0);
}

/** RULES-REVIEW item 3: skill mod = ability mod + (prof ? PB : 0) + (expertise ? PB : 0). */
export function skillMod(sheet: CharacterSheet, skill: SkillDef): number {
  const pb = proficiencyBonus(sheet.level);
  const proficient = (sheet.skillProficiencies ?? []).includes(skill.key);
  const hasExpertise = (sheet.expertise ?? []).includes(skill.key);
  return abilityMod(abilityScore(sheet, skill.ability)) + (proficient ? pb : 0) + (hasExpertise ? pb : 0);
}

/** RULES-REVIEW item 4: passive Perception = 10 + Perception skill modifier. */
export function passivePerception(sheet: CharacterSheet): number {
  const perception = SKILLS.find((s) => s.key === "perception")!;
  return 10 + skillMod(sheet, perception);
}

/** RULES-REVIEW item 5: initiative = DEX modifier only. */
export function initiative(sheet: CharacterSheet): number {
  return abilityMod(abilityScore(sheet, "dexterity"));
}

export function isSkillProficient(sheet: CharacterSheet, key: string): boolean {
  return (sheet.skillProficiencies ?? []).includes(key);
}

export function hasExpertise(sheet: CharacterSheet, key: string): boolean {
  return (sheet.expertise ?? []).includes(key);
}
