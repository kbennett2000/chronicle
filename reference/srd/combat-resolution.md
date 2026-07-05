# Combat Resolution — Attack Rolls, Saving Throws, D20 Tests

Source: *System Reference Document 5.2* ("SRD 5.2"), provided by Wizards
of the Coast LLC under the Creative Commons Attribution 4.0 International
License (CC-BY-4.0). This file quotes/paraphrases the relevant rules text
for DM reference during play; see `reference/srd/README.md` for the full
attribution and scope note.

## D20 Tests (shared mechanic for checks, saves, and attacks)

When the outcome of an action is uncertain, roll a d20. These rolls come in
three kinds: ability checks, saving throws, and attack rolls. They all
follow the same steps:

1. **Roll 1d20.** You always want to roll high. If the roll has Advantage
   or Disadvantage, roll two d20s and use only one of them — the higher if
   Advantage, the lower if Disadvantage. (See `advantage-disadvantage.md`.)
2. **Add modifiers**: the relevant ability modifier; the Proficiency Bonus
   if the creature is proficient in whatever the test involves; any
   circumstantial bonuses/penalties from a class feature, spell, or other
   rule.
3. **Compare the total to a target number.** If the total equals or
   exceeds the target number, the test succeeds; otherwise it fails.
   - The target number for an **ability check** or **saving throw** is a
     **Difficulty Class (DC)**.
   - The target number for an **attack roll** is the target's
     **Armor Class (AC)**.

## Attack Rolls

An attack roll determines whether an attack hits a target. **An attack
hits if the roll (d20 + modifiers) equals or exceeds the target's Armor
Class.**

| Ability | Attack Type |
|---|---|
| Strength | Melee attack with a weapon or an Unarmed Strike |
| Dexterity | Ranged attack with a weapon |
| Varies | Spell attack (ability determined by the spellcaster's spellcasting feature) |

The Finesse weapon property lets a character use Strength or Dexterity,
whichever is better, for that weapon's attack and damage rolls.

Add the Proficiency Bonus to the attack roll when attacking with a weapon
the creature is proficient with, and always when attacking with a spell.

### Armor Class

- Base AC = 10 + the creature's Dexterity modifier, before armor/magic
  item/spell modifiers are applied.
- A creature with multiple features that calculate AC differently must
  choose one calculation — they don't stack.

### Rolling 20 or 1 on an attack roll

- **Natural 20**: the attack **hits regardless of any modifiers or the
  target's AC** — this is a Critical Hit.
- **Natural 1**: the attack **misses regardless of any modifiers or the
  target's AC.**

## Saving Throws

A saving throw ("save") represents an attempt to evade or resist a threat
— a fiery explosion, poisonous gas, a spell trying to invade the mind. A
creature doesn't choose to make a save voluntarily; it's forced to because
it's at risk. A creature can always choose to fail a save without rolling
if it doesn't want to resist the effect.

| Ability | Make a Save To… |
|---|---|
| Strength | Physically resist direct force |
| Dexterity | Dodge out of harm's way |
| Constitution | Endure a toxic hazard |
| Intelligence | Recognize an illusion as fake |
| Wisdom | Resist a mental assault |
| Charisma | Assert your identity |

Add the Proficiency Bonus to a saving throw if the creature is proficient
in that kind of save.

### Difficulty Class for a saving throw

Determined by whatever effect causes the save (e.g. a spell's DC is set
by the caster's spellcasting ability + Proficiency Bonus) or by the GM
directly when no other rule specifies it.

## Critical Hits and damage

A Critical Hit (natural 20 on an attack roll) hits regardless of
modifiers/AC. See the SRD's full "Combat" chapter for critical-hit damage
doubling mechanics if a specific case needs it — not reproduced here since
this file scopes to the core roll-resolution mechanic, not damage math.

See `advantage-disadvantage.md` for how Advantage/Disadvantage modifies any
of the rolls above, `conditions.md` for how a condition changes what
rolls a creature can make or what Advantage/Disadvantage it has, and
`ability-checks.md` for ability-check-specific DC guidance and the skill
list.
