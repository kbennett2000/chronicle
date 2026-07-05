# Spell Slots

Source: *System Reference Document 5.2* ("SRD 5.2"), provided by Wizards
of the Coast LLC under the Creative Commons Attribution 4.0 International
License (CC-BY-4.0). This file quotes/paraphrases the relevant rules text
for DM reference during play; see `reference/srd/README.md` for the full
attribution and scope note.

A spell slot is expended to cast a spell of that slot's level or lower (a
higher-level slot can cast a lower-level spell, usually with a stronger
effect per that spell's own "Using a Higher-Level Slot" text — narrate
accordingly if the player chooses to upcast). **Spell slots recharge on a
Long Rest**, except Warlock Pact Magic slots (see below), which recharge
on a **Short or Long Rest**. Track remaining slots per level in
`character-sheet.json`'s `spellSlots` object and deduct the moment a slot
is spent — not deferred to end of turn.

## Full Casters (Bard, Cleric, Druid, Sorcerer, Wizard)

| Level | 1st | 2nd | 3rd | 4th | 5th | 6th | 7th | 8th | 9th |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 2 | | | | | | | | |
| 2 | 3 | | | | | | | | |
| 3 | 4 | 2 | | | | | | | |
| 4 | 4 | 3 | | | | | | | |
| 5 | 4 | 3 | 2 | | | | | | |
| 6 | 4 | 3 | 3 | | | | | | |
| 7 | 4 | 3 | 3 | 1 | | | | | |
| 8 | 4 | 3 | 3 | 2 | | | | | |
| 9 | 4 | 3 | 3 | 3 | 1 | | | | |
| 10 | 4 | 3 | 3 | 3 | 2 | | | | |
| 11 | 4 | 3 | 3 | 3 | 2 | 1 | | | |
| 12 | 4 | 3 | 3 | 3 | 2 | 1 | | | |
| 13 | 4 | 3 | 3 | 3 | 2 | 1 | 1 | | |
| 14 | 4 | 3 | 3 | 3 | 2 | 1 | 1 | | |
| 15 | 4 | 3 | 3 | 3 | 2 | 1 | 1 | 1 | |
| 16 | 4 | 3 | 3 | 3 | 2 | 1 | 1 | 1 | |
| 17 | 4 | 3 | 3 | 3 | 2 | 1 | 1 | 1 | 1 |
| 18 | 4 | 3 | 3 | 3 | 3 | 1 | 1 | 1 | 1 |
| 19 | 4 | 3 | 3 | 3 | 3 | 2 | 1 | 1 | 1 |
| 20 | 4 | 3 | 3 | 3 | 3 | 2 | 2 | 1 | 1 |

Cantrips (level-0 spells) are cast without expending a slot and are not
tracked in `spellSlots`.

## Half Casters (Paladin, Ranger)

Gain spellcasting at level 2; no slots before then.

| Level | 1st | 2nd | 3rd | 4th | 5th |
|---|---|---|---|---|---|
| 2 | 2 | | | | |
| 3 | 3 | | | | |
| 4 | 3 | | | | |
| 5 | 4 | 2 | | | |
| 6 | 4 | 2 | | | |
| 7 | 4 | 3 | | | |
| 8 | 4 | 3 | | | |
| 9 | 4 | 3 | 2 | | |
| 10 | 4 | 3 | 2 | | |
| 11 | 4 | 3 | 3 | | |
| 12 | 4 | 3 | 3 | | |
| 13 | 4 | 3 | 3 | 1 | |
| 14 | 4 | 3 | 3 | 1 | |
| 15 | 4 | 3 | 3 | 2 | |
| 16 | 4 | 3 | 3 | 2 | |
| 17 | 4 | 3 | 3 | 3 | 1 |
| 18 | 4 | 3 | 3 | 3 | 1 |
| 19 | 4 | 3 | 3 | 3 | 2 |
| 20 | 4 | 3 | 3 | 3 | 2 |

## Third Casters (Eldritch Knight Fighter, Arcane Trickster Rogue)

Gain spellcasting at level 3; slots cap at 4th level, using the same
progression pace as half-casters but scaled to a third of the caster's
class level (round down) for slot-table lookup purposes. Consult the SRD's
full multiclass/third-caster tables directly if Kira ever takes one of
these subclasses — not reproduced here since neither is in play yet.

## Warlock Pact Magic (separate track, recharges on Short Rest)

| Level | Slots | Slot Level |
|---|---|---|
| 1 | 1 | 1st |
| 2 | 2 | 1st |
| 3 | 2 | 2nd |
| 4 | 2 | 2nd |
| 5 | 2 | 3rd |
| 6 | 2 | 3rd |
| 7 | 2 | 4th |
| 8 | 2 | 4th |
| 9 | 2 | 5th |
| 10 | 2 | 5th |
| 11 | 3 | 5th |
| 12 | 3 | 5th |
| 13 | 3 | 5th |
| 14 | 3 | 5th |
| 15 | 3 | 5th |
| 16 | 3 | 5th |
| 17 | 4 | 5th |
| 18 | 4 | 5th |
| 19 | 4 | 5th |
| 20 | 4 | 5th |

All of a Warlock's Pact Magic slots are always the level shown, regardless
of which level spell is cast with them (a 1st-level spell cast with a
5th-level Pact Magic slot is cast at 5th level).

## Multiclass spellcasters

If Kira ever multiclasses into a second spellcasting class, don't total
slots by adding each class's own table independently. Instead: sum each
class's contribution toward one combined caster level (full casters count
their full level; half casters count level ÷ 2 rounded down; third
casters count level ÷ 3 rounded down; Warlock Pact Magic slots stay on
their own separate track and are never combined with this total), then
look up that combined level on the **Full Casters** table above for the
total slot pool. Not needed yet at Kira's current level/class — flagged
here for when it becomes relevant.

See `spellcasting-mechanics.md` for how a slot is spent when casting
(casting time, components, range, duration, concentration) and
`class-features.md` for how prepared/known spells are determined per
class.
