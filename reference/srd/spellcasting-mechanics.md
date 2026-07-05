# Spellcasting Mechanics

Source: *System Reference Document 5.2* ("SRD 5.2"), provided by Wizards
of the Coast LLC under the Creative Commons Attribution 4.0 International
License (CC-BY-4.0). This file quotes/paraphrases the relevant rules text
for DM reference during play; see `reference/srd/README.md` for the full
attribution and scope note.

## Casting a spell

1. **Casting time.** Most spells use the Magic action (one action). Some
   use a Bonus Action or a Reaction (cast only in response to the trigger
   named in that spell's own description). Spells with a casting time of
   1 minute or longer require taking the Magic action on every one of the
   caster's turns for that duration, and Concentration for the entire
   time, and are interrupted if Concentration breaks before it finishes.
2. **Range.** One of: **Self** (affects the caster, sometimes with an area
   originating from them), **Touch** (caster must physically touch the
   target), or a **distance in feet** (target/origin point must be within
   that distance and within the caster's line of effect).
3. **Components** — all required components (as listed in the spell's own
   description) must be met to cast it:
   - **Verbal (V):** the caster must be able to speak in a normal voice.
     Blocked by conditions/effects that prevent speech (e.g. Silence,
     being gagged, the Incapacitated condition since it makes the caster
     Speechless).
   - **Somatic (S):** the caster needs at least one hand free to
     gesture — blocked if both hands are full and no free hand is
     available.
   - **Material (M):** a specified physical component must be accessible.
     **Not consumed unless the spell's own description says so.** The
     caster needs a free hand to retrieve/hold it, or may substitute a
     component pouch or spellcasting focus in place of any material
     component that doesn't list a cost or consumption — a costed/
     consumed material component (e.g. "a diamond worth 300+ gp, which
     the spell consumes") must actually be spent from inventory/currency,
     not hand-waved.
4. **Spell Save DC** = 8 + spellcasting ability modifier + Proficiency
   Bonus. Used whenever the spell's target makes a saving throw against
   it.
5. **Spell Attack Modifier** = spellcasting ability modifier +
   Proficiency Bonus. Used for a spell attack roll (see
   `combat-resolution.md` for attack-roll resolution generally).
6. **Duration** — one of:
   - **Instantaneous.** The effect happens and is over; nothing to track
     afterward.
   - **Time span** (rounds/minutes/hours/etc). Track it; the caster may
     voluntarily end it early unless Incapacitated.
   - **Concentration.** See below — tracked continuously, not just for a
     fixed duration, since it can end early.

## Concentration

Only **one Concentration spell can be active at a time.** Starting to
cast another Concentration spell immediately ends any current one — the
new spell doesn't queue behind it.

Concentration breaks when:
- The caster starts casting another spell that requires Concentration.
- The caster **takes damage**: make a Constitution saving throw, **DC =
  10 or half the damage taken (round down), whichever is higher, to a
  maximum DC of 30.** Failure ends the Concentration spell immediately.
- The caster gains the **Incapacitated** condition, or dies.
- The caster chooses to end it voluntarily (no action required).

Track the active Concentration spell (if any) explicitly in
`character-sheet.json` — don't rely on narrative memory of "a spell is
still up" across turns, since a missed concentration check several turns
later is exactly the kind of state drift this SRD-grounding effort exists
to prevent. Roll the Constitution save the instant qualifying damage is
narrated, in the same turn — don't defer it.

## Ritual casting

If the caster has a spell **prepared/known that has the Ritual tag**, and
has a class feature that grants Ritual Casting, they may cast it as a
Ritual: the casting time becomes **10 minutes longer** than normal, and
**no spell slot is expended.** A ritual can't be cast if the caster
doesn't have Ritual Casting (not every class has this feature) even if
the spell itself has the Ritual tag.

## Cantrips

A cantrip is a level-0 spell, cast **without expending a spell slot**, at
will. Otherwise resolved exactly like any other spell (attack roll or
save, range, components, duration) per its own description.

See `spell-slots.md` for slot-tracking and recharge rules, and
`combat-resolution.md` for how a spell attack roll or a saving throw
DC is actually resolved once this file determines that a save or attack
roll applies.
