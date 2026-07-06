# 0016 — Editable history via pre-turn state snapshots

## Status
Accepted

## Context
Issue #68: players want to edit a past message when they change their mind
and have the story re-run from there. This is not a cosmetic transcript
edit — the player expects the outcome to change, so the DM must re-narrate
from the edited action, discarding everything after it.

Two hard constraints:

1. **Re-running an old turn must run against the world as it was BEFORE
   that turn.** The DM engine rewrites the state files (`character-sheet.json`,
   `world-state.md`, `npc-roster.md`, `quest-log.md`) and appends to the
   prose session log every turn. Re-running turn 5 against turn-40 state
   would be incoherent — HP, location, quests, NPCs would all be wrong.
   Nothing today snapshots per-turn state.
2. **The Agent SDK conversation is linear.** The installed
   `@anthropic-ai/claude-agent-sdk` (v0.3.201) *does* expose native
   `forkSession` / `resumeSessionAt` / `rewindFiles` (gated on
   `enableFileCheckpointing`), which could rewind both files and
   conversation. But `rewindFiles` only works for turns that ran *with
   checkpointing enabled*, and verifying it end-to-end needs a live,
   billed model session that could not be exercised in this slice's
   environment.

## Decision
Implement editable history with **deterministic pre-turn state snapshots
+ a fresh SDK session on re-run**, not the SDK-native rewind. This is fully
testable without a live model and rests on the project's founding
principle (ADR-0001): **campaign state lives in files, not the SDK's
conversation memory**, so re-running on a fresh session loses nothing that
matters for *state* — only conversational voice/continuity, which the
restored prose log and state files carry well enough.

### Snapshots (`src/campaign-store.ts`)
Before every turn and the opening, the server writes a snapshot of the
mutable state — the four state files **plus the active prose session log**
— into `session-log/snapshots/<sessionBase>/turn-<NNNN>/`, with a
`manifest.json`. Snapshot `turn-K` == "state as it was before turn K
ran". The transcript `.jsonl` is *not* snapshotted; it's handled by
truncation. Snapshotting the prose log (append-only) means restoring an
earlier copy cleanly drops the discarded turns' summaries.

Functions: `writePreTurnSnapshot`, `hasPreTurnSnapshot`,
`restorePreTurnSnapshot` (reads all files into memory, then writes — no
half-restore), `truncateTranscript`, `pruneSnapshotsAfter`.

### Edit endpoint (`src/server.ts`)
`POST /campaigns/:id/turns/:turnIndex/edit` `{ message }`:
restore the snapshot for `turnIndex` → truncate the transcript to
`turnIndex` → prune now-orphaned later snapshots → **clear the SDK session
id (fresh session)** → `runTurn` the edited message (or `openingDirective`
when `turnIndex === 0` is the opening) → append the re-run record. Guarded
by the same `busy` single-flight lock as `/turns`. Because the re-run
always uses a fresh session on the *current* model, it also sidesteps the
resume-pins-the-old-model issue entirely.

### Client (`web/src/screens/Play.tsx`)
An "✎ Edit" control on each settled player message swaps it into a
textarea; "Save & re-run" confirms the discard (with the count of turns
that will be lost) and calls the endpoint, then rebuilds the log from the
server. Turn-zero openings get a "↺ Reweave the opening" control instead.

### Backward compatibility & limitation
**Snapshots only exist for turns played after this ships.** Editing an
older turn returns a graceful `409` ("this turn can't be rewound"). This
is an accepted limitation, not a bug — existing campaigns' pre-feature
history is not rewindable.

### git
`session-log/snapshots/` is runtime rewind state, not source. Real
campaigns are already gitignored (ADR-0005); a re-exclusion is added for
the tracked `test-campaign` fixture so its snapshots never enter git.

## Consequences
- Fully deterministic and unit-testable (snapshot → restore → truncate),
  with no dependency on unverified SDK behavior.
- **Continuity trade-off**: the re-run's DM voice/detail can shift, and it
  may mildly diverge from retained earlier prose, because the fresh
  session doesn't carry the old conversation. Mitigated by the restored
  state files + prose log, which the per-turn "read the files first"
  discipline leans on. Acceptable given ADR-0001.
- **Orphaned images**: a discarded turn's moment image file is left on
  disk (harmless — the gallery/moment views read only from the restored
  state + truncated transcript, so it never renders).
- **Disk growth**: snapshots accumulate one small directory per turn.
  Negligible for solo play; a pruning cap can be added later if needed
  (flagged, not implemented).
- **Future optimization**: once `rewindFiles` + `forkSession` can be
  verified live, migrating to the SDK-native path would preserve
  conversational continuity across the edit. The endpoint/client contract
  here would not need to change — only the server-side rewind mechanism.
