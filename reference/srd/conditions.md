# Conditions

Source: *System Reference Document 5.2* ("SRD 5.2"), provided by Wizards
of the Coast LLC under the Creative Commons Attribution 4.0 International
License (CC-BY-4.0). This file quotes/paraphrases the relevant rules text
for DM reference during play; see `reference/srd/README.md` for the full
attribution and scope note.

A condition alters a creature's capabilities in various ways. Apply/remove
conditions per whatever narrated action causes them, and reflect current
conditions in `character-sheet.json` (and the NPC's stat in `npc-roster.md`
if it's an NPC) so they persist across turns instead of being forgotten.

## Blinded
- **Can't See.** Automatically fails any ability check that requires
  sight.
- **Attacks Affected.** Attack rolls against the creature have Advantage;
  its own attack rolls have Disadvantage.

## Charmed
- **Can't Harm the Charmer.** Can't attack the charmer or target it with
  damaging abilities/magical effects.
- **Social Advantage.** The charmer has Advantage on any ability check to
  interact with the charmed creature socially.

## Deafened
- **Can't Hear.** Automatically fails any ability check that requires
  hearing.

## Exhaustion
- **Cumulative levels.** Each time a creature receives this condition, it
  gains 1 Exhaustion level. **Dies if its Exhaustion level reaches 6.**
- **D20 Tests Affected.** Every D20 Test roll is reduced by 2 × the
  creature's Exhaustion level.
- **Speed Reduced.** Speed is reduced by 5 feet × the Exhaustion level.
- **Removing levels.** Finishing a Long Rest removes 1 Exhaustion level.
  At 0, the condition ends entirely.

## Frightened
- **Ability Checks and Attacks Affected.** Disadvantage on ability checks
  and attack rolls while the source of fear is within line of sight.
- **Can't Approach.** Can't willingly move closer to the source of fear.

## Grappled
- **Speed 0.** Speed is 0 and can't increase.
- **Attacks Affected.** Disadvantage on attack rolls against any target
  other than the grappler.
- **Movable.** The grappler can drag/carry the grappled creature when it
  moves (at an extra foot of movement cost per foot, unless the grappled
  creature is Tiny or 2+ sizes smaller).

## Incapacitated
- **Inactive.** Can't take an action, Bonus Action, or Reaction.
- **No Concentration.** Concentration is broken.
- **Speechless.** Can't speak.
- **Surprised.** If Incapacitated when rolling Initiative, Disadvantage on
  that roll.

## Invisible
- **Surprise.** If Invisible when rolling Initiative, Advantage on that
  roll.
- **Concealed.** Unaffected by any effect that requires its target to be
  seen, unless the effect's creator can somehow see the invisible
  creature. Equipment worn/carried is also concealed.
- **Attacks Affected.** Attack rolls against the creature have
  Disadvantage; its own attack rolls have Advantage (unless the attacker
  can somehow see it, in which case neither applies for that attacker).

## Paralyzed
- **Incapacitated.** Has the Incapacitated condition (see above).
- **Speed 0.** Speed is 0 and can't increase.
- **Saving Throws Affected.** Automatically fails Strength and Dexterity
  saving throws.
- **Attacks Affected.** Attack rolls against the creature have Advantage.
- **Automatic Critical Hits.** Any attack roll that hits is a Critical Hit
  if the attacker is within 5 feet.

## Petrified
- **Turned to Inanimate Substance.** Transformed (with nonmagical
  worn/carried objects) into solid stone; weight ×10; stops aging.
- **Incapacitated.** Has the Incapacitated condition.
- **Speed 0.** Speed is 0 and can't increase.
- **Attacks Affected.** Attack rolls against the creature have Advantage.
- **Saving Throws Affected.** Automatically fails Strength and Dexterity
  saving throws.

## Poisoned
- **Ability Checks and Attacks Affected.** Disadvantage on attack rolls
  and ability checks.

## Prone
- **Restricted Movement.** Can only crawl, or spend movement equal to
  half Speed (round down) to stand up and end the condition. If Speed is
  0, can't stand up.
- **Attacks Affected.** Disadvantage on its own attack rolls. Attack rolls
  against it have Advantage if the attacker is within 5 feet, otherwise
  Disadvantage.

## Restrained
- **Speed 0.** Speed is 0 and can't increase.
- **Attacks Affected.** Attack rolls against the creature have Advantage;
  its own attack rolls have Disadvantage.
- **Saving Throws Affected.** Disadvantage on Dexterity saving throws.

## Stunned
- **Incapacitated.** Has the Incapacitated condition.
- **Saving Throws Affected.** Automatically fails Strength and Dexterity
  saving throws.
- **Attacks Affected.** Attack rolls against the creature have Advantage.

## Unconscious
- **Inert.** Has the Incapacitated and Prone conditions, and drops
  whatever it's holding. Remains Prone when the condition ends.
- **Speed 0.** Speed is 0 and can't increase.
- **Attacks Affected.** Attack rolls against it have Advantage.
- **Saving Throws Affected.** Automatically fails Strength and Dexterity
  saving throws.
- **Automatic Critical Hits.** Any attack roll that hits is a Critical Hit
  if the attacker is within 5 feet.
- **Unaware.** Unaware of its surroundings.

See `advantage-disadvantage.md` for how Advantage/Disadvantage combine
when a condition grants one and something else grants the other on the
same roll, and `combat-resolution.md` for the underlying D20 Test/attack
roll/saving throw mechanics these conditions modify.
