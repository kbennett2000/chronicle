# 0011 — Deterministic host-side dice mechanic

## Status
Accepted

## Context
Chronicle had **no dice mechanic at all**. The DM engine adjudicated every d20
test, attack, save, and damage roll in prose — either inventing the number
itself or, in practice, asking the player "what did you roll?" and trusting the
reply. Two field reports followed:

- **#44** — "Auto roll the dice: don't ask me to roll and tell you what I got,
  simulate the roll." With a requested escape hatch: an option to preserve the
  ask-the-player behavior for testing.
- **#45** — "Make sure the game has all these dice" (d4, d6, d8, d10, d100/d%,
  d12, d20).

A model narrating its own rolls is both unfair (it can fudge outcomes) and, on
weaker models, statistically skewed. Randomness that the rules lean on should be
real and host-controlled, like the seed/texture tables already are.

## Decision
Add a host-side dice roller exposed to the DM engine as an MCP tool
`mcp__dice__roll_dice` (`src/dice.ts`), built per-turn alongside the existing
seed/texture/image servers. It is the single source of randomness for rules
resolution.

- **Full die set (#45):** d4, d6, d8, d10, d12, d20, d100 (and the `d%`
  percentile spelling), plus multiple dice (`2d6`), a flat modifier baked into
  the notation (`1d20+5`), and an `advantage`/`disadvantage` mode.
- **RNG:** `node:crypto` `randomInt` — unbiased and inclusive, not `Math.random`.
- **A new per-campaign setting `autoRollDice` (#44),** defaulting **ON**
  (absent is treated as on; new campaigns are scaffolded with `true`). When on,
  the tool is wired into the turn and the system prompt instructs the model to
  roll for every rules-mandated roll and never invent a number or ask the
  player. When explicitly **off**, the tool is not offered and the prompt
  reverts to the old behavior: tell the player exactly what to roll and wait for
  their value. The toggle lives under Settings → THE WORLD and persists via the
  existing `POST /campaigns/:id/settings` path.
- The roller returns a structured result (kept faces, discarded set for
  advantage/disadvantage, modifier, total, natural-20/natural-1 flags, and a
  one-line `detail` summary) plus a text summary the model narrates from.

## Rules-accuracy — FLAGGED FOR REVIEW (per CLAUDE.md)
These mechanical readings are the executor's, **not** verified against the SRD;
Kris should confirm before trusting them:

- Advantage/disadvantage rolls the *whole* notation twice and keeps the
  higher/lower **total**. For the canonical single d20 this is exactly "roll two
  d20, take the higher"; on multi-die pools (e.g. `2d6` with advantage) it is an
  interpretation, not a cited rule.
- A natural 20 / natural 1 is surfaced as a flag only on a single-d20 roll, so
  the model can adjudicate critical hits/misses; **crit damage** (e.g. doubling
  dice) is left entirely to the model, not computed here.
- Modifiers are applied once to the kept total, not per die.

## Consequences
- Rolls are fair, real, and consistent across models; the DM stops asking the
  player to be its RNG.
- Testers can still drive exact values by turning auto-roll off.
- The dice tool is stateless and host-owned — no campaign files, no shared
  registry — so it needs none of the ADR-0002 file-permission machinery.
- Follow-up (not in this slice): the roller does not yet parse compound
  expressions like `1d8+1d6` or keep-highest-N (`4d6kh3`); the model composes
  those as separate calls for now. Crit-damage automation and SRD citation of
  the advantage/crit semantics are deferred to the rules-grounding work.
