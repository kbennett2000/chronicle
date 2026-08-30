# ADR-0040: Session rotation — fresh-session catch-up to cure long-campaign drift

Status: Accepted
Date: 2026-08-30

## Context

Chronicle's DM engine runs each turn by **resuming one persistent Claude Agent
SDK conversation per campaign**, keyed by a `.session-id` file in the campaign
directory (`src/dm-engine.ts` `runTurn`, `options.resume`). The SDK reloads the
full accumulated transcript each turn and appends the new player message. That
transcript — all prior narration **plus every `Read` tool-result, which carries
full state-file bodies** — grows without bound. There is no summarization,
windowing, or compaction anywhere in the turn loop.

Two consequences over a long campaign:

1. **Quality drift ("laziness").** As the resent context approaches and pressures
   the window, narration gets terser and less inventive. The `ted-the-wizard`
   campaign's transcript reached ~867 KB / 167 messages.
2. **Baked-in bloat.** ADR-0039 bounded the *file* fed each turn (`## Current
   Situation`), but every pre-fix turn already put an oversized (~72 KB) read
   into the session history as a `tool_result`. Those remain in the resumed
   conversation and are resent every turn until the session is reset — ADR-0039's
   display/file cap does not touch already-accumulated SDK history.

Crucially, Chronicle is **file-backed by design**: the state files, not the
conversation, are the source of truth (`src/dm-engine.ts` system prompt: "this is
the source of truth, not your conversation memory"). The codebase already relies
on this — on a mid-campaign model or provider switch it *drops* the SDK session
and starts fresh rather than resume, reasoning that "dropping the session loses
nothing that matters" because state lives in files (`src/server.ts` `ActiveSession`
docs; #57 / ADR-0018). Rotating the session is the same safe move, applied
deliberately to shed accumulated context.

## Decision

Introduce **session rotation**: a game can start a *fresh* SDK conversation while
preserving all game state, by dropping `resume` and re-priming the DM purely from
the state files.

1. **`catchUpDirective(campaignDir, sessionLogPath, playerInput)`** in
   `src/dm-engine.ts`, beside `openingDirective`. It is a director cue passed as a
   turn's `userInput` on a fresh (non-resumed) session. Unlike `openingDirective`
   (which narrates a brand-new turn-zero opening), it instructs the DM: this
   campaign is already in progress — do **not** open, re-introduce, recap, or say
   "welcome back"; silently reconstruct the current state by reading world-state.md
   (esp. `## Current Situation`), character-sheet.json, npc-roster.md, quest-log.md,
   and the tail of the session log; then answer the player's next action seamlessly
   as a normal turn. It leans on `systemPrompt` (present on the fresh session) for
   the standard per-turn rules and supplies only the one thing a fresh session
   lacks: *there is prior story — reconstruct it from files, this is not turn zero.*

2. **Manual control.** `POST /campaigns/:id/session/refresh` (templated on the
   `/opening` route) clears the persisted session (`active.sessionId = undefined`,
   `.session-id` dropped), runs one turn with `catchUpDirective(...)` and
   `resumeSessionId = undefined`, persists the resulting new session id, and appends
   the turn to the **same** session log so the story stays continuous. The frontend
   exposes it as a "Start a fresh session" control in the in-game settings screen.

3. **Observability.** `TurnResult` gains an optional `usage` field (input/output
   tokens + cost) read from the SDK `result` message, previously discarded. This
   supports the A/B experiment and general per-turn cost logging.

An **A/B experiment** (`scripts/ab-fresh-session.ts`) validated the approach on a
non-destructive **copy** of `ted-the-wizard` (never the live campaign): the same
next-turn input run resumed-vs-fresh, comparing narration plus objective metrics
(tokens, latency, word count, tool-call counts).

## Consequences

- **Quality:** a rotated session behaves like a rested DM — it re-reads compact,
  authoritative files instead of dragging a growing transcript. It also sheds the
  pre-ADR-0039 baked-in bloat that a file cap alone cannot remove.
- **Safety:** rotation loses no game state (files are the source of truth) and
  performs no destructive edits to campaign data (ADR-0005). It reuses the exact
  fresh-session mechanism already trusted for model/provider switches (#57 /
  ADR-0018) and turn edits (ADR-0016).
- **Continuity risk:** anything a player established only in conversation and never
  written to a state file is not carried across a rotation. `catchUpDirective`
  mitigates by reconstructing from the session-log tail as well; the durable fix is
  the existing per-turn discipline of writing state to files (rules 1–8).
- **Scope:** only a *manual* rotation ships here. An **automatic** size-threshold
  rotation (rotate transparently once the `.transcript.jsonl` exceeds a budget) is
  a natural follow-up but is deliberately left out until the manual path is proven
  in live play, so a rotation is always visible rather than silent.
- Complements ADR-0039 (bounded Current Situation): that bounded the file; this
  bounds the conversation.
