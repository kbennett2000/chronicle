# 0015 — Full character sheet: authored vs derived fields

## Status
Accepted

## Context
Issue #67 asks for a full D&D 5e character sheet in the app. Today
`character-sheet.json` and the "Self" panel carry only name/race/class/
level, HP, AC, ability scores, conditions, currency, and inventory — a
fraction of the official sheet. Players want the rest: saving-throw
proficiencies, the 18 skills with their modifiers, proficiency bonus,
initiative, speed, passive Perception, background, alignment,
personality/ideals/bonds/flaws, and features & traits.

Two forces constrain the design:

1. **The DM engine rewrites `character-sheet.json` mid-play** (HP, XP,
   conditions, and in principle `level`). Anything we *store* that is
   actually a *function of* other stored fields will silently rot the
   moment the model touches its input (store `proficiencyBonus: 2`, let
   the DM level the character to 5, and it's now wrong).
2. **All new fields must be optional and degrade gracefully** — old
   sheets (including the tracked `test-campaign`) and every future DM
   write must still load. This is the standing backend-contract rule.

## Decision
**Store the inputs, derive the numbers.** Persist only what cannot be
recomputed from other stored fields; compute everything else at render
time from a single pure module.

### Persisted (user/DM-authored), all optional
Added to `character-sheet.json` and the `CharacterSheet` type:
`background`, `alignment`, `personality {traits, ideals, bonds, flaws}`,
`savingThrowProficiencies` (ability keys), `skillProficiencies` (skill
keys), `expertise` (skill keys), `languages`, `otherProficiencies`,
`featuresAndTraits` (`{name, description?, source?}`), and `speed` (feet).

`speed` is persisted rather than derived: it comes from race, and the
sheet has no race→speed lookup at render time without duplicating the
table client-side; persisting it also lets the DM override it (a spell, a
mount) like any other state.

### Derived (never stored) — `web/src/lib/character-derive.ts`
A pure, unit-tested module: `proficiencyBonus(level)`, `abilityMod(score)`,
`savingThrowMod(sheet, ability)`, `skillMod(sheet, skillKey)`,
`passivePerception(sheet)`, `initiative(sheet)`, and the `SKILLS` constant
(18 entries, each `{key, label, ability}`).

### Creation
`NewCharacter.tsx` captures the authored fields. Class-based **skill
proficiency selection is required from the player** (a "choose N from the
class list" checkbox group) rather than auto-picked — auto-selection is a
rules opinion, and requiring the choice is both more accurate and keeps
the server from baking one in. Saving-throw proficiencies are derived from
class and shown read-only. `buildCharacterSheet` validates a submitted
skill set is a subset of the class list of exactly the allowed size.

### Display
`SelfPanel.tsx` expands into a full, mobile-scrollable sheet using
collapsible sections (combat + abilities open by default; saves, skills,
features, personality collapsed). Every new section is guarded by field
presence so old/partial sheets render cleanly.

The DM **system prompt is not changed** in this slice: the model already
free-writes the JSON, and teaching it to actively maintain saves/skills/
features is deferred to its own slice (flagged below).

## Rules-accuracy — FLAGGED FOR KRIS'S REVIEW (per CLAUDE.md)
None of the following is asserted correct; each is the explicit review
surface, mirroring ADR-0010's derivation list:

1. **Proficiency bonus** = `2 + floor((level − 1) / 4)` (so +2 at levels
   1–4; char-gen forces level 1).
2. **Saving-throw modifier** = ability mod + (proficient ? PB : 0).
3. **Skill modifier** = ability mod + (proficient ? PB : 0) +
   (expertise ? PB : 0).
4. **Passive Perception** = 10 + Perception skill modifier (no +5 for
   advantage, no other situational bonuses).
5. **Initiative** = DEX modifier only (no feats/other bonuses modeled).
6. **Skill → ability map** (the 18): Athletics→STR; Acrobatics/Sleight of
   Hand/Stealth→DEX; Arcana/History/Investigation/Nature/Religion→INT;
   Animal Handling/Insight/Medicine/Perception/Survival→WIS; Deception/
   Intimidation/Performance/Persuasion→CHA.
7. **`CLASS_SAVE_PROFICIENCIES`** — each class's two saving throws.
8. **`CLASS_SKILL_CHOICES`** — each class's skill list and choose-count.
9. **`RACE_SPEED`** — base walking speed per species. **The 2014 vs 2024
   SRD diverge here** (2014 gives Dwarf/Halfling/Gnome 25 ft; 2024 gives
   many species 30 ft). This table's values are a 2024-leaning default and
   are the single most likely divergence — confirm against the intended
   edition.
10. **Backgrounds grant no skill proficiencies or ability increases here**
    — the same simplification ADR-0010 already flagged (this slice does
    not change it).
11. **Expertise at creation**: Rogue selects 2 from its chosen
    proficiencies; other classes 0. Whether to expose expertise selection
    at level 1 at all is a product/rules call.

The hardcoded tables live beside `CLASS_HIT_DICE` in
`src/character-gen.ts` with the same "curated SRD subset, hardcoded
because reference/srd/ doesn't carry it, FLAGGED" caveat, and are mirrored
client-side in `NewCharacter.tsx` / `character-derive.ts` (the server stays
authoritative on submit).

## Consequences
- Every derived number has one source of truth and can't drift when the DM
  edits `level` or a score; the derivations are the review surface and
  live in one pure module + one server file.
- **Client/server table drift** is the main risk (skill/class/speed tables
  are duplicated). Mitigated by keeping the tables small and adjacent to
  their existing mirrors; a parity test (cf.
  `web/tests/heading-consistency.spec.ts`) can lock them together.
- **Existing sheets** (incl. `test-campaign`) have no proficiency sets, so
  their saves/skills render as ability-mod-only until edited. Graceful and
  expected; backfilling fixtures is out of scope.
- Teaching the DM engine to maintain the new fields is a **deferred,
  separately-flagged slice** — until then those fields change only through
  creation and any future in-app editing.
