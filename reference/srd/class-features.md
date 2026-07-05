# Class Features

Source: *System Reference Document 5.2* ("SRD 5.2"), provided by Wizards
of the Coast LLC under the Creative Commons Attribution 4.0 International
License (CC-BY-4.0). This file quotes/paraphrases the relevant rules text
for DM reference during play; see `reference/srd/README.md` for the full
attribution and scope note.

**Scope note:** this is a curated subset of class features that have a
*defined mechanical effect* requiring adjudication (extra damage, a
resource pool, a saving throw, a numeric bonus) — not a full reprint of
every class's feature list. Covers Kira's current class (Rogue) plus one
representative feature each from the other classes most likely to come up
(Fighter, Barbarian, Paladin, Cleric, Wizard). If a class/feature not
listed here comes up in play, consult the full SRD 5.2 text directly and
add it here afterward — same additive-file principle as
`docs/adr/0006-srd-grounded-rules-adjudication.md` used for the
spellcasting files.

Track feature uses (e.g. "Rage: 2/2 remaining today") in
`character-sheet.json` and reset them exactly when the feature's own
recharge condition says to (short rest, long rest, or daily) — don't
reset early or let a use silently regenerate.

## Rogue

### Sneak Attack
Once per turn, deal extra damage on **one** hit with a **Finesse or
ranged weapon**, if either:
- The attack has **Advantage**, or
- **Another enemy of the target is within 5 feet of it**, that enemy
  isn't Incapacitated, and the attack does **not** have Disadvantage.

Extra damage scales with Rogue level (round up to the nearest odd level
bracket): **1d6 at level 1**, increasing by 1d6 every 2 Rogue levels
(2d6 at 3rd, 3d6 at 5th, 4d6 at 7th, ... up to 10d6 at 19th).

### Cunning Action (level 2)
As a **Bonus Action**, take the **Dash, Disengage, or Hide** action.

## Fighter

### Second Wind
As a **Bonus Action**, regain **1d10 + Fighter level** HP. Usable once
per Short or Long Rest.

### Action Surge (level 2)
Take **one additional action** on your turn. Usable once per Short or
Long Rest (twice between rests starting at level 17, but not more than
once in the same turn).

## Barbarian

### Rage (Bonus Action)
While raging: **Advantage on Strength checks and Strength saving
throws**; **Resistance to Bludgeoning, Piercing, and Slashing damage**;
and a **melee damage bonus** on Strength-based attacks that scales with
Barbarian level — **+2 at levels 1-8, +3 at levels 9-15, +4 at levels
16-20**. Can't concentrate on spells or cast them while raging (beyond
any exception a specific subclass feature grants).

Lasts **1 minute**; ends early if the Barbarian is knocked Unconscious,
or if a turn passes without the Barbarian attacking, taking damage, or
voluntarily ending it. Limited uses per Long Rest, scaling with level (2
at level 1, up to unlimited at level 20) — track remaining uses on
`character-sheet.json`.

## Paladin

### Lay on Hands
A pool of **5 × Paladin level** HP, replenished on a Long Rest. As an
action, touch a creature and restore HP from the pool (any split across
uses), or expend **5 points** from the pool to cure one disease or
neutralize one poison affecting the touched creature instead of
restoring HP.

## Cleric

### Channel Divinity: Turn Undead
As an action, present a holy symbol; each **Undead creature within 30
feet that can see or hear the Cleric** must make a **Wisdom saving throw
against the Cleric's Spell Save DC** (see `spellcasting-mechanics.md`).
On a failure, the Undead is **Turned** for 1 minute or until it takes
damage: it must spend its turns trying to move as far from the Cleric as
possible, and can't willingly move within 30 feet of the Cleric, and
can't take Reactions and can only use the Dodge action unless it has
nowhere to move. Uses of Channel Divinity are limited per Short/Long Rest
(1 at low level, more at higher level) — track remaining uses.

## Wizard

### Arcane Recovery
Once per day, when finishing a **Short Rest**, recover expended spell
slots with a combined level **no greater than half the Wizard's level
(round up)**, and **no single recovered slot may be 6th level or
higher**. E.g. a 4th-level Wizard (half-level rounded up = 2) could
recover one 2nd-level slot, or two 1st-level slots.

See `spell-slots.md` for slot tracking generally and
`spellcasting-mechanics.md` for how a recovered/expended slot is actually
used to cast a spell.
