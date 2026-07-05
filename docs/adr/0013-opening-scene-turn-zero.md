# 0013 — Opening scene (turn-zero)

## Status
Accepted

## Context
Issue #54 ("terrible start"): a freshly created character is dropped straight
into Play on a blank parchment reading *"The tale hasn't begun — say what you
do."* with an empty input. There is no scene, no hook, no orientation — a new
player cannot tell whether the app is broken.

The root cause is structural. `POST /campaigns` (`src/server.ts`) →
`scaffoldCampaign` (`src/campaign-store.ts`) writes only blank template state
files (`EMPTY_WORLD_STATE` etc.) and **runs no turn**. Play's zero-turn branch
(`web/src/screens/Play.tsx`, gated on `turns.length === 0`) therefore renders its
literal empty-state placeholder. Nothing in the system has ever produced a
DM-initiated beat — every turn to date is a response to a non-empty player
`message`, and both the `POST /turns` guard and the render path assume a player
spoke first.

ADR-0010 already anticipated this: "the opening DM scene is expected to establish
gear in-fiction" — but that scene was never built. This ADR builds it.

## Decision
A new campaign's **first transcript record is a DM-initiated turn** — "turn-zero"
— with an **empty `playerMessage`**. It is produced from a server-composed
director cue (never player-typed text), generated lazily by the client the first
time the player enters Play with zero turns.

**Backend** (`src/dm-engine.ts`, `src/server.ts`, `src/campaign-store.ts`):
- `openingDirective(campaignDir)` (dm-engine) composes the one-time director cue
  from the on-disk character identity (`readCharacterIdentity`). It instructs the
  DM to narrate an immersive opening that reflects the established world/tone
  (already threaded into `systemPrompt` via `settings`), grounds the character,
  presents one immediate hook, establishes starting gear in-fiction, updates
  `world-state.md`'s `## Current Situation`, and ends inviting the player to act.
  It is run through the ordinary `runTurn(...)`, so every existing guarantee —
  dice/image/state tools, the ADR-0008 permission gate, `stripMetaChatter`,
  session resume — applies unchanged. The cue is ephemeral: it is passed as the
  turn's `userInput` but never persisted.
- `POST /campaigns/:id/opening` mirrors the `/turns` handler: requires an active
  session (409 otherwise), honors the single-flight `busy` lock, and is
  **idempotent** — if the campaign already has ≥1 transcript record it returns
  `{ narration, alreadyStarted: true }` from the latest record instead of
  generating a second opening (guards against a double client fire).
- The turn is persisted with `appendTurnTranscript(campaignDir, sessionLogPath,
  "", result.text)`. **The empty `playerMessage` string is the turn-zero
  marker.** The `TurnTranscriptRecord` schema already types `playerMessage` as a
  plain (required) string; the empty-string convention is documented on it.

**Frontend** (`web/src/lib/campaign.ts`, `web/src/screens/Play.tsx`):
- `generateOpening(connection, campaignId)` calls the endpoint, treating
  200/502 as domain results like `sendTurn`.
- Play renders the "YOU" block only when `playerMessage.trim() !== ""`, so a
  turn-zero record shows narration alone.
- On load with zero turns, Play fires `generateOpening()` once (a `useRef`
  guard), showing a "setting the scene…" state. On success it renders the single
  opening turn; on failure it falls back to the input plus an inline notice, so
  the player is never stuck on a dead screen.

## Consequences
- **Latency lives in Play, by choice.** The player enters immediately and watches
  the scene weave, rather than the Create button freezing during a multi-second
  generation. If the opening fails (engine/network), manual play still works —
  the fallback is the pre-existing "type your action" path.
- **Turn-zero is a first-class, empty-`playerMessage` record**, not a special
  side-channel. Resume, the `/state` snapshot, chapter parsing, and illustration
  all treat it as an ordinary turn (it simply has no player line). Any future
  DM-initiated beat (a time-skip narration, a between-sessions recap) can reuse
  the same convention.
- **Idempotency is server-enforced**, not merely client-guarded, so a page reload
  or a double mount cannot spawn a second opening.
- No new mechanical rules are introduced. The opening establishes starting gear
  in-fiction, which ADR-0010 explicitly deferred to "the opening DM scene"; a
  future slice may still add SRD starting equipment. Flagged, per CLAUDE.md, as a
  fiction-only choice rather than an asserted rules decision.
