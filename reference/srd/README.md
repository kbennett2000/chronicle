# SRD Reference — Rules Adjudication

This directory holds excerpted/paraphrased rules text from the *Dungeons &
Dragons System Reference Document 5.2* ("SRD 5.2", 2024 rules), used as
DM-engine reference material for adjudicating 5e mechanics — not stuffed
into every prompt, but read on demand via the model's existing file-read
access. See ADR-0006 for why this slice (Slice 10) chose SRD 5.2 over SRD
5.1, and `docs/design/chronicle-design-doc.md` §5.

## License and attribution

SRD 5.2 is provided by Wizards of the Coast LLC under the **Creative
Commons Attribution 4.0 International License (CC-BY-4.0)**. Full text of
that license: https://creativecommons.org/licenses/by/4.0/legalcode.
Source: https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.pdf,
also mirrored at https://www.dndbeyond.com/srd. This project's use of and
modifications to that text (excerpting, reformatting into per-topic
Markdown files, occasional paraphrase for brevity) are its own; the
underlying rules text is © Wizards of the Coast LLC, used under CC-BY-4.0.

## Scope (Slice 10 — core resolution)

- `ability-checks.md` — ability checks, skills, DC guidance
- `combat-resolution.md` — D20 Tests, attack rolls, AC, saving throw
  target numbers, critical hits
- `advantage-disadvantage.md` — Advantage/Disadvantage rolling and
  stacking rules
- `conditions.md` — all standard conditions (Blinded, Charmed, ... through
  Unconscious)

## Scope (Slice 11 — spellcasting and class features)

- `spell-slots.md` — slot progression tables (full/half/third casters,
  Warlock Pact Magic), recharge timing, multiclass slot totals
- `spellcasting-mechanics.md` — casting time/range/components/duration
  resolution, Concentration (including the save-DC formula and what
  breaks it), ritual casting, cantrips
- `class-features.md` — a curated subset of class features with a
  defined mechanical effect (Rogue Sneak Attack/Cunning Action, Fighter
  Second Wind/Action Surge, Barbarian Rage, Paladin Lay on Hands, Cleric
  Channel Divinity: Turn Undead, Wizard Arcane Recovery), not a full
  per-class reprint — see that file's own scope note for why and how to
  extend it

Split into three topic files rather than one large spellcasting blob, or
one file per class, for the same reason Slice 10 split by mechanic: each
stays focused enough to read (and correct, if Kris spot-checks a number
against actual play) independently, and `class-features.md` in particular
is deliberately a curated subset rather than exhaustive — attempting all
twelve classes' full feature lists in one slice would trade accuracy for
completionism the campaign doesn't need yet.

## Scope (Slice 12 — rest mechanics, death saves, exhaustion)

- `resting.md` — Short Rest Hit Dice recovery, Long Rest recovery (HP,
  Hit Dice, spell slots, Exhaustion reduction, feature recharge)
- `death-saves-and-dying.md` — dropping to 0 HP, Instant Death, Death
  Saving Throws, stabilizing
- `exhaustion.md` — the six-level Exhaustion track, its cumulative
  effects, and how it's removed

Same one-file-per-mechanic split as Slices 10-11, for the same reason:
each stays independently readable/spot-checkable. These three were kept
separate rather than folded into one "downtime/dying" file because
they're adjudicated at different moments in play (end of a rest vs. a
hit that drops HP to 0 vs. an environmental/forced-march effect) and a
DM mid-turn benefits from being able to name the exact file for the
exact situation, same rationale as the Slice 10 core-resolution split.
