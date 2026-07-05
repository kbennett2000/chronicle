# ADR-0006: SRD-Grounded Rules Adjudication (Core Resolution Mechanics)

## Status
Accepted

## Context
Per design doc §5, rules fidelity is a first-class requirement — the DM
engine should adjudicate 5e mechanics by consulting actual SRD text rather
than answering from trained recall, which can drift or misremember
specific numbers (DCs, condition effects, advantage/disadvantage stacking
rules). This is a deliberate scope increase, scoped to its own slice
(Slice 10) rather than bundled into earlier ones, and this cycle covers
only core resolution mechanics — ability checks, saving throws, attack
rolls, advantage/disadvantage, and conditions. Spellcasting and
class-feature grounding are an explicit follow-up slice.

## Decision

1. **SRD edition: 5.2 (2024 rules), not 5.1 (2014).** SRD 5.2 is the
   current, more permissively licensed option — released under
   Creative Commons Attribution 4.0 International (CC-BY-4.0), a more
   modern and slightly more permissive license than 5.1's original OGL/
   CC-BY variants, and it matches the ruleset actually used by the
   `claude-sonnet-5` / `claude-opus-4-8` models' 5e training baseline for
   this project going forward. Sourced directly from Wizards of the
   Coast's official distribution
   (`https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.pdf`,
   also mirrored at `dndbeyond.com/srd`), converted to text, and
   hand-curated into the files below — not an unvetted third-party mirror.

2. **Split into focused per-topic Markdown files under `reference/srd/`,
   not one large blob:**
   - `ability-checks.md`
   - `combat-resolution.md`
   - `advantage-disadvantage.md`
   - `conditions.md`
   - `README.md` (license/attribution + scope note)

   The model reads only the specific file relevant to the mechanic it's
   adjudicating, via its existing `Read(./**)` tool access — not injected
   into every system prompt. This keeps prompt size proportional to what
   a turn actually needs, and keeps each file focused enough to audit or
   correct independently (e.g. if Kris finds a transcription error in
   `conditions.md`, he can fix that one file without touching the others).

3. **System-prompt rule is narrow and mechanical, not a blanket "use the
   SRD for everything" instruction:** it names the specific situations
   (attack rolls, saving throws, DCs, advantage/disadvantage, conditions)
   and the specific files to consult, and explicitly does *not* extend to
   spells or class features yet — avoiding scope creep into the next
   slice's territory before that reference material exists.

4. **Validation must produce evidence of actual file reads, not just
   plausible narration.** Since the model already narrates 5e-flavored
   text convincingly from trained recall, narration quality alone can't
   distinguish "consulted the source" from "guessed correctly." Validation
   captures which `reference/srd/*.md` files the model's tool-use blocks
   actually read during a turn (via the Agent SDK's message stream, same
   place tool calls already surface) as the actual evidence.

## Consequences
- `reference/srd/` is checked into the repo (not `campaigns/`) — it's
  static reference content shared across all campaigns, not per-campaign
  state.
- Extending to spellcasting/class features later means adding more files
  in the same directory and extending the system-prompt rule to name
  them — this structure was chosen specifically so that follow-up slice
  is additive, not a rework.
- If SRD 5.2 is ever found to diverge from what Kris's actual table
  expects (since he's flagged he doesn't know 5e rules deeply and defers
  rules-accuracy calls for review), individual condition/mechanic entries
  can be corrected in place without re-sourcing the whole document.
