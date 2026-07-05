import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCharacterSheet,
  deriveCampaignId,
  abilityModifier,
  CharacterValidationError,
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
