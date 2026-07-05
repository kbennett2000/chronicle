# ADR-0007: Deterministic Turn Transcripts, Not Reconstructed-From-Prose History

## Status
Accepted

## Context
Slice 17 found that the persisted session-log is a flat list of terse
retrospective bullets the model writes — there's no reliable way to
recover which part of a historical entry was the player's literal action
versus the DM's literal narration, once it's written to disk. Only the
*current, live* session's turns retain that distinction, because the
client happens to hold the player's input and the API's response as two
separate strings in that moment. Once a session ends and a new one
resumes, that distinction is gone — reconstructed only as prose the model
chose to write in retrospect.

This matters beyond cosmetics: the entry-type styling Slice 17 just built
(chapter / narration / player action / story event) has no reliable data
to work with for any turn that isn't in the currently-open session. Folk
and Quest are the next two panels, and both would otherwise inherit the
same "parse structure back out of prose" instinct for their own history.

## Decision
1. **The server, not the model, is responsible for the mechanical fact of
   who said what.** On every `POST /turns` call, `server.ts` appends a
   deterministic record — `{ turnIndex, timestamp, playerMessage,
   narration }` — to a companion transcript file
   (`session-log/session-<timestamp>.transcript.jsonl`), written in code
   at the exact moment both strings are already in hand. This is never
   inferred, parsed, or reconstructed after the fact.
2. **The existing prose session-log stays**, for chapter framing and
   narrative flavor (titles, retrospective summaries) — that's a
   legitimate literary device the model is good at and should keep doing.
   But it is no longer the source of truth for "what did I say / what did
   the DM say" — the transcript is.
3. `GET /campaigns/:id/state`'s `currentSessionLog` gains a `transcript`
   field: the parsed array of turn records for the current session,
   alongside the existing `path`/`content` prose fields. This is an
   additive API change — `path`/`content` are unchanged, `transcript` is
   new.
4. Historical (previous-session) transcripts are addressable the same way
   — one file per session, same format — so a later slice building richer
   history browsing doesn't need another architecture decision, just to
   read more files of the same shape.
5. Old sessions logged before this change (e.g. `test-campaign`'s
   existing history) simply have no transcript file — acceptable, since
   that's dev fixture data. Going forward, every new turn gets one.

## Consequences
- Another API-shape addition after the Slice 14 audit already found three
  drift points — worth accepting now, while only 3 of 10 UI slices are
  built, rather than after Folk/Quest/Views all assume prose-parsing for
  history too.
- `docs/design/claude-design-brief.md` and
  `docs/design/handoff-2026-07/backend-contract.md` both need this
  addition documented, same discipline as the Slice 14 corrections.
- The prose log and the transcript can, in principle, drift from each
  other in tone/detail (the model's summary vs. the literal exchange) —
  that's fine and expected; they answer different questions ("what's the
  story so far" vs. "what exactly was said"), not competing sources for
  the same one.
