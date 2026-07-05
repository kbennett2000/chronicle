# Resting

Source: *System Reference Document 5.2* ("SRD 5.2"), provided by Wizards
of the Coast LLC under the Creative Commons Attribution 4.0 International
License (CC-BY-4.0). This file quotes/paraphrases the relevant rules text
for DM reference during play; see `reference/srd/README.md` for the full
attribution and scope note.

## Short Rest

A period of downtime, at least **1 hour** long, during which a character
does nothing more strenuous than eating, drinking, reading, or tending
wounds.

**Hit Dice recovery:** at the end of a Short Rest, a character can spend
one or more of their remaining Hit Dice to regain HP. For each Hit Die
spent, roll that die and add the character's Constitution modifier — the
total is HP regained (minimum 0 per die). A character has a number of Hit
Dice equal to their character level, of a size set by their class (e.g.
d8 for Rogue, d10 for Fighter, d6 for Wizard), and spent Hit Dice are only
recovered on a Long Rest (see below). Track total/remaining Hit Dice and
current HP on `character-sheet.json`.

A Short Rest is also when several class features recharge (Second Wind,
Action Surge, some Channel Divinity uses, Warlock Pact Magic slots) — see
`class-features.md` for feature-specific recharge conditions, and
`spell-slots.md` for Pact Magic specifically.

## Long Rest

A period of extended downtime, at least **8 hours** long, during which a
character sleeps or performs only light activity (no more than 1 hour of
walking, eating, talking, reading, or standing watch). A Long Rest is
interrupted by 1 hour or more of walking, fighting, casting spells, or
similarly strenuous activity, and must restart if interrupted.

A character can't benefit from more than one Long Rest in a 24-hour
period, and must have at least 1 HP at the start of the rest to gain its
benefits.

**On finishing a Long Rest:**
- Regain **all lost HP**.
- Regain spent **Hit Dice**, up to a number equal to **half the
  character's total Hit Dice (round up, minimum 1)**.
- Reduce **Exhaustion** by **one level**, provided the character has also
  had access to food and water during the rest (see `exhaustion.md`).
- All spell slots are restored (see `spell-slots.md`; Warlock Pact Magic
  recovers on a Short Rest instead, not just a Long Rest).
- Class features with a "per Long Rest" recharge reset (see
  `class-features.md`).

## Applying rule 13 here

Hit Dice spent/remaining, HP regained, and Exhaustion level are all
numeric state tracked in `character-sheet.json`. Write the update first,
then narrate the resulting number by reading it back from the file —
don't state a total computed only in reasoning.
