# Death Saving Throws and Dying

Source: *System Reference Document 5.2* ("SRD 5.2"), provided by Wizards
of the Coast LLC under the Creative Commons Attribution 4.0 International
License (CC-BY-4.0). This file quotes/paraphrases the relevant rules text
for DM reference during play; see `reference/srd/README.md` for the full
attribution and scope note.

## Dropping to 0 HP

A creature that takes damage that reduces it to 0 HP, and isn't killed
outright (see Instant Death below), falls **Unconscious**. This is a
special case of Unconscious that also requires Death Saving Throws each
turn, as described below.

If damage reduces a creature to 0 HP with **damage remaining**, and that
remaining damage equals or exceeds the creature's HP maximum, the
creature dies outright (**Instant Death**) — no death saves.

## Death Saving Throws

At the start of each of its turns while at 0 HP, an Unconscious creature
makes a Death Saving Throw: roll a **d20** with no modifiers.
- **10 or higher:** success.
- **9 or lower:** failure.
- **Natural 1:** counts as **two failures**.
- **Natural 20:** the creature regains **1 HP** and becomes conscious
  immediately — the roll ends the dying sequence entirely, not just one
  success.

Track successes and failures separately (each maxes at 3, don't let
either exceed it) on `character-sheet.json`.

- **3 successes:** the creature becomes **Stable** (see below) — it stops
  making death saves but remains Unconscious at 0 HP until it regains any
  HP.
- **3 failures:** the creature **dies**.

Successes and failures don't need to be consecutive, but reset to zero
once the creature returns to a state above 0 HP (via healing or a
natural 20) or once it dies/stabilizes.

**Taking damage while at 0 HP:** any damage taken while already at 0 HP
counts as **one failed death save**; a **Critical Hit** received at 0 HP
counts as **two failed** death saves instead. This is in addition to
Instant Death applying if the damage is large enough (see above).

## Stabilizing

A creature can be stabilized (without regaining any HP) by a successful
**DC 10 Wisdom (Medicine) check** made by another creature within 5 feet,
or by any effect that explicitly stabilizes. A Stable creature stops
rolling death saves and stops losing them, remains Unconscious at 0 HP,
and regains **1 HP after 1d4 hours** if not healed sooner.

## Applying rule 13 here

Death save success/failure counts, current HP, and Stable/Unconscious
status are all state tracked in `character-sheet.json`. Write the update
for a save's outcome first, then narrate the resulting tally (e.g. "2
successes, 1 failure") by reading it back from the file, not by counting
in reasoning alone — a miscounted tally here is a life-or-death-stakes
version of the exact drift rule 13 exists to prevent.
