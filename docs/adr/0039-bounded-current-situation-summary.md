# ADR-0039: Bounded, rewritten-each-turn "Current Situation" summary

Status: Accepted
Date: 2026-08-30

## Context

world-state.md's `## Current Situation` section is meant to be the single
present-moment snapshot the DM grounds its narration against, and it is what the
Home ("YOUR CHRONICLES") card shows as a campaign's "where you left off". The DM
system prompt (src/dm-engine.ts rule 5) told the model to "rewrite it every
turn", but in practice the model **appends**: the `ted-the-wizard` campaign's
section grew to ~72KB with 57 stacked "CURRENT MOMENT" blocks and kept growing
each turn. Two failures result:

1. **The Home card renders a wall of text.** It reads the raw section body
   (`findMarkdownSection` → untruncated `body`) and shows all of it.
2. **Per-turn token bloat.** The engine feeds world-state.md back to the model
   every turn (`STATE_FILES`, src/dm-engine.ts), so an unbounded section inflates
   the cost and context of every subsequent turn — not just the display.

Prompt wording alone is probabilistic; it had already failed here for dozens of
turns. And `"CURRENT MOMENT:"` is emergent model output, not a code-side
delimiter, so there is nothing reliable to parse and prune server-side.

## Decision

`## Current Situation` is contractually a **short, present-tense, fully
rewritten-each-turn summary** (3-4 sentences, ~60 words) — never an append-only
log. Enforced in two layers:

1. **Prompt discipline (probabilistic).** src/dm-engine.ts rule 5 and the
   opening-scene prompt now state a hard length ceiling, "overwrite this section
   in its entirety each turn — never append", an explicit prohibition on
   accumulating stacked moment/timestamp blocks, where history goes instead
   (append-only session log, Locations Visited, quest-log.md), and a self-trim
   clause ("if it's already longer, replace the whole thing with a fresh short
   summary"). The literal `"Current Situation"` heading is unchanged (guarded by
   tests/heading-consistency.spec.ts).

2. **Deterministic display cap (the backstop).** A budget constant
   `SITUATION_SUMMARY_MAX_CHARS = 280` bounds what any surface displays,
   regardless of what the model wrote:
   - **Server:** `currentSituation()` (src/campaign-store.ts) truncates the
     flattened section at a word boundary with a trailing `…`, protecting the
     `GET /campaigns` list endpoint and any API consumer.
   - **Client:** `summarizeSituation()` (web/src/lib/markdown.ts) applies the
     same cap where the Home card derives its text from the raw state markdown,
     plus a defensive CSS line-clamp on the card.

   Because src/ and web/src/ are separate bundles with **no shared module**, the
   budget is deliberately mirrored (src/campaign-store.ts and
   web/src/lib/state-headings.ts). This ADR is the authoritative value both must
   match.

## Consequences

- The Home menu can never wall again, regardless of model behavior — the cap is
  deterministic and independent of the prompt.
- Live campaigns **self-heal**: once the strengthened rule 5 lands, the next DM
  turn reads the over-long section, sees it exceeds budget, and replaces it
  whole. Token bloat persists only until that first turn.
- **No destructive edits to existing campaign data.** `ted-the-wizard` and any
  other in-flight campaign are left untouched on disk (ADR-0005 / CLAUDE.md git
  policy); the cap handles display immediately and the model handles the file on
  its next turn. Any one-time compaction of an existing file is out of scope —
  it would be a separate, opt-in, non-destructive, consented step.
- The mirrored constant is a small duplication cost; the alternative (a shared
  package across the Node and browser builds) is disproportionate for one number.
- Budget is tunable: 280 chars / ~60 words is a readability call, changed by
  editing the two constants and the prompt ceiling together.
