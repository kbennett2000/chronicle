# ADR-0022: Official character-sheet view (desktop)

## Status
Accepted

## Context
Issue #67 asks to render the character in the **recognizable official D&D 5e
sheet** — the WotC form with the ability columns down the left, saving
throws/skills, the AC/initiative/speed/HP combat block, attacks & spellcasting,
equipment, and the personality/features columns on the right. Kris's issue
comment: *"I think it should go in the Self section."*

The underlying data already exists. ADR-0015 (issue #67's own ADR) added the
authored fields (`savingThrowProficiencies`, `skillProficiencies`, `expertise`,
`background`, `alignment`, `personality`, `featuresAndTraits`, `speed`,
`languages`, `otherProficiencies`) and the derive-don't-store module
`web/src/lib/character-derive.ts` (proficiency bonus, saves, all 18 skills,
passive perception, initiative). The current mobile `SelfPanel.tsx` renders all
of it — but as a compact vertical, collapsible layout, not the familiar sheet.

Two facts shape the decision:
1. **The wide official sheet needs horizontal room**, which only desktop has.
   ADR-0021 just gave Play a persistent desktop side column; the sheet is the
   natural thing to render there. Kris chose **full sheet on desktop, compact
   `SelfPanel` on mobile**.
2. **A handful of official-sheet regions have no backing data** — attacks &
   spellcasting table, death saves, hit dice, temporary HP, inspiration, and a
   spell list. Adding those fields (and teaching the DM engine to maintain them)
   is exactly the deferred slice ADR-0015 flagged; issue #67's agreed scope is
   **render what we already have, no backend/DM changes.**

## Decision
Add `web/src/panels/CharacterSheetFull.tsx` — a new **desktop-only** component
that lays the existing `CharacterSheet` out as the official sheet, and render it
in the Play desktop side panel when the **Self** tab is active. Mobile keeps
`SelfPanel.tsx` unchanged.

- **Data source:** the same `CharacterSheet` and `character-derive.ts` the mobile
  panel uses. No new fields, no server change, no DM-prompt change.
- **Unmodeled regions render as empty form boxes** — the Attacks & Spellcasting
  ruled rows, Death Saves bubbles, Hit Dice, Temp HP, and Inspiration appear as
  the blank labelled boxes they are on a real printed sheet. This is faithful to
  the artifact and honest about what the engine doesn't track yet, and it leaves
  an obvious home for the future data slice to fill in.
- **Every region is presence-guarded**, exactly like `SelfPanel` — a pre-ADR-0015
  sheet (no proficiency sets, no personality) renders cleanly (ability-mod-only
  saves/skills, empty boxes), never throws. This is the standing
  degrade-gracefully backend contract.
- **Styled with the in-world theme tokens** (parchment/ink/brass, display/body
  fonts), not a literal white WotC PDF — it reads as the same candlelit artifact
  as the rest of the app, in the official *arrangement*.

## Consequences
- The Self section on desktop is the full, recognizable sheet; phones keep the
  compact panel best suited to a narrow screen. One data model feeds both.
- The empty attacks/death-saves/hit-dice/temp-HP/inspiration boxes are visible
  placeholders. When the deferred ADR-0015 DM-maintenance slice lands (adding
  those fields + teaching the engine to write them), those boxes fill in with no
  layout change.
- All the ADR-0015 rules-review items (PB/save/skill formulas, class tables,
  race speed) still apply — this view surfaces those derived numbers more
  prominently, so it is more exposure of the same flagged formulas, not new ones.
- Desktop-only keeps mobile risk at zero and matches Kris's chosen split; if a
  future pass wants the official layout on mobile too, `CharacterSheetFull` is
  already responsive-grid-based and could be reused there.
