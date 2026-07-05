# Exhaustion

Source: *System Reference Document 5.2* ("SRD 5.2"), provided by Wizards
of the Coast LLC under the Creative Commons Attribution 4.0 International
License (CC-BY-4.0). This file quotes/paraphrases the relevant rules text
for DM reference during play; see `reference/srd/README.md` for the full
attribution and scope note.

Exhaustion is a single condition with **six cumulative levels**, tracked
as one integer on `character-sheet.json` (0 = none). A creature gains one
or more levels of Exhaustion when a rule, trap, or environmental effect
(e.g. failing a forced march Constitution save, starvation/dehydration,
extreme heat/cold, some monster attacks) says so.

## Effects (cumulative per level)

Each level of Exhaustion currently in effect applies **both** of the
following, and the effects stack — a creature at Exhaustion level 3 has
a **-6 penalty** and **-15 ft.** speed, not just level 3's individual
increment:

- **-2 penalty per level** to every **d20 Test** the creature makes
  (ability checks, attack rolls, and saving throws).
- **-5 ft. per level** to the creature's Speed (to a minimum of 0).

## Death at Level 6

A creature that reaches **Exhaustion level 6** dies.

## Removing Exhaustion

Finishing a **Long Rest** removes **one level** of Exhaustion, **provided
the creature has also had access to food and water** during that rest
(see `resting.md`). Exhaustion does not clear on its own without a Long
Rest that meets this condition.

## Applying rule 13 here

Exhaustion level is a single integer in `character-sheet.json`. When it
changes — gained from an effect, or removed via a Long Rest — write the
new level to the file first, then narrate the resulting level (and its
current d20/Speed penalty) by reading it back from the file, not by
incrementing/decrementing the number in reasoning alone.
