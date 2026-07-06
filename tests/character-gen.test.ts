import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCharacterSheet,
  deriveCampaignId,
  abilityModifier,
  CharacterValidationError,
  MAX_APPEARANCE_CHARS,
} from "../src/character-gen.js";

const scores = {
  strength: 10,
  dexterity: 16,
  constitution: 14,
  intelligence: 12,
  wisdom: 11,
  charisma: 8,
};

test("abilityModifier follows the standard 5e formula", () => {
  assert.equal(abilityModifier(10), 0);
  assert.equal(abilityModifier(16), 3);
  assert.equal(abilityModifier(8), -1);
  assert.equal(abilityModifier(20), 5);
});

test("buildCharacterSheet derives level-1 HP (hit die + CON mod) and unarmored AC (10 + DEX mod)", () => {
  const sheet = buildCharacterSheet({ name: "Kira", race: "Human", class: "Rogue", abilityScores: scores });
  // Rogue d8 + CON mod (+2) = 10
  assert.deepEqual(sheet.hp, { current: 10, max: 10 });
  // 10 + DEX mod (+3) = 13
  assert.equal(sheet.armorClass, 13);
  assert.equal(sheet.level, 1);
  assert.equal(sheet.xp, 0);
  assert.deepEqual(sheet.currency, { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
});

test("buildCharacterSheet stores a trimmed appearance when given, and omits it otherwise (#71)", () => {
  const withLook = buildCharacterSheet({
    name: "Vashka", race: "Goliath", class: "Barbarian", abilityScores: scores,
    appearance: "  A tall female goliath with grey skin and dark braids.  ",
  });
  assert.equal(withLook.appearance, "A tall female goliath with grey skin and dark braids.");

  const withoutLook = buildCharacterSheet({ name: "Kira", race: "Human", class: "Rogue", abilityScores: scores });
  assert.equal("appearance" in withoutLook, false);

  // Blank/whitespace appearance is treated as absent, not stored as "".
  const blankLook = buildCharacterSheet({ name: "Kira", race: "Human", class: "Rogue", abilityScores: scores, appearance: "   " });
  assert.equal("appearance" in blankLook, false);
});

test("buildCharacterSheet rejects an over-long or non-string appearance (#71)", () => {
  assert.throws(
    () => buildCharacterSheet({ name: "Kira", race: "Human", class: "Rogue", abilityScores: scores, appearance: "x".repeat(MAX_APPEARANCE_CHARS + 1) }),
    CharacterValidationError
  );
  assert.throws(
    () => buildCharacterSheet({ name: "Kira", race: "Human", class: "Rogue", abilityScores: scores, appearance: 42 as never }),
    CharacterValidationError
  );
});

test("buildCharacterSheet derives class save proficiencies and race speed (#67)", () => {
  const rogue = buildCharacterSheet({ name: "Kira", race: "Human", class: "Rogue", abilityScores: scores });
  assert.deepEqual(rogue.savingThrowProficiencies, ["dexterity", "intelligence"]);
  assert.equal(rogue.speed, 30);
  const goliath = buildCharacterSheet({ name: "Vashka", race: "Goliath", class: "Barbarian", abilityScores: scores });
  assert.equal(goliath.speed, 35);
  assert.deepEqual(goliath.savingThrowProficiencies, ["strength", "constitution"]);
});

test("buildCharacterSheet validates class skill picks (#67)", () => {
  // Rogue must choose exactly 4 from its list.
  const ok = buildCharacterSheet({
    name: "Kira", race: "Human", class: "Rogue", abilityScores: scores,
    skillProficiencies: ["stealth", "acrobatics", "deception", "perception"],
  });
  assert.deepEqual(ok.skillProficiencies, ["stealth", "acrobatics", "deception", "perception"]);

  // Wrong count.
  assert.throws(
    () => buildCharacterSheet({ name: "Kira", race: "Human", class: "Rogue", abilityScores: scores, skillProficiencies: ["stealth", "acrobatics"] }),
    CharacterValidationError
  );
  // Skill not on the class list (Arcana isn't a Rogue skill).
  assert.throws(
    () => buildCharacterSheet({ name: "Kira", race: "Human", class: "Rogue", abilityScores: scores, skillProficiencies: ["arcana", "acrobatics", "deception", "perception"] }),
    CharacterValidationError
  );
  // Duplicates.
  assert.throws(
    () => buildCharacterSheet({ name: "Kira", race: "Human", class: "Rogue", abilityScores: scores, skillProficiencies: ["stealth", "stealth", "deception", "perception"] }),
    CharacterValidationError
  );
});

test("buildCharacterSheet expertise must be a subset of chosen skills (#67)", () => {
  const ok = buildCharacterSheet({
    name: "Kira", race: "Human", class: "Rogue", abilityScores: scores,
    skillProficiencies: ["stealth", "acrobatics", "deception", "perception"],
    expertise: ["stealth", "perception"],
  });
  assert.deepEqual(ok.expertise, ["stealth", "perception"]);
  assert.throws(
    () => buildCharacterSheet({
      name: "Kira", race: "Human", class: "Rogue", abilityScores: scores,
      skillProficiencies: ["stealth", "acrobatics", "deception", "perception"],
      expertise: ["athletics"],
    }),
    CharacterValidationError
  );
});

test("buildCharacterSheet omits skills when not supplied but still sets derived arrays (#67)", () => {
  const sheet = buildCharacterSheet({ name: "Kira", race: "Human", class: "Rogue", abilityScores: scores });
  assert.deepEqual(sheet.skillProficiencies, []);
  assert.deepEqual(sheet.expertise, []);
  assert.deepEqual(sheet.featuresAndTraits, []);
  assert.equal("background" in sheet, false);
});

test("buildCharacterSheet applies the right hit die per class", () => {
  const barbarian = buildCharacterSheet({ name: "Grok", race: "Goliath", class: "Barbarian", abilityScores: scores });
  assert.equal((barbarian.hp as { max: number }).max, 14); // d12 + 2
  const wizard = buildCharacterSheet({ name: "Mira", race: "Gnome", class: "Wizard", abilityScores: scores });
  assert.equal((wizard.hp as { max: number }).max, 8); // d6 + 2
});

test("buildCharacterSheet HP is at least 1 even with a very negative CON mod", () => {
  const frail = buildCharacterSheet({
    name: "Wisp",
    race: "Elf",
    class: "Wizard",
    abilityScores: { ...scores, constitution: 1 }, // -5 mod, d6 -> 1
  });
  assert.equal((frail.hp as { max: number }).max, 1);
});

test("buildCharacterSheet rejects a blank name, unknown race/class, and out-of-range scores", () => {
  assert.throws(() => buildCharacterSheet({ name: "  ", race: "Human", class: "Rogue", abilityScores: scores }), CharacterValidationError);
  assert.throws(() => buildCharacterSheet({ name: "X", race: "Vulcan", class: "Rogue", abilityScores: scores }), CharacterValidationError);
  assert.throws(() => buildCharacterSheet({ name: "X", race: "Human", class: "Jester", abilityScores: scores }), CharacterValidationError);
  assert.throws(
    () => buildCharacterSheet({ name: "X", race: "Human", class: "Rogue", abilityScores: { ...scores, strength: 25 } }),
    CharacterValidationError
  );
});

test("deriveCampaignId slugifies and disambiguates against existing ids", () => {
  assert.equal(deriveCampaignId("Kira Emberfall", () => false), "kira-emberfall");
  assert.equal(deriveCampaignId("!!!", () => false), "hero");
  const taken = new Set(["kira-emberfall"]);
  assert.equal(deriveCampaignId("Kira Emberfall", (id) => taken.has(id)), "kira-emberfall-2");
});
