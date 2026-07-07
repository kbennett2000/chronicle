# ADR-0025: Settings-tier separation and set-once engine

## Status
Accepted

## Context
Chronicle has a deliberate two-tier settings model: **account defaults**
(`users/<id>/settings.json`, via `/me/settings`, seeded from `.env` at
registration — ADR-0019) that every new chronicle inherits, and **per-game**
settings (`campaigns/.../campaign-settings.json`, via `/campaigns/:id/settings`)
that override them for one game. In the UI those tiers were muddled, and one
combination crashed (issue #114):

- The **main Settings screen** (reached from Home) edited the *active game's*
  engine/look/world — `POST /session/start` and `POST /campaigns/:id/settings`
  — silently operating on whatever campaign happened to be "active," alongside
  genuinely account-level (music defaults, "save as defaults") and device-level
  (server address, logout) controls. When there was no active game it showed an
  awkward empty state (#97).
- After a game started there was **no way to change its per-game settings** at
  all except the music/playlist, exposed in-game by `GameMusicPopover`.
- **Switching the engine mid-game crashed.** The switch left a stale,
  provider-agnostic `.session-id` (`campaign-store.ts`, never cleared) that was
  later handed to the wrong backend's resume: a Grok session UUID passed to the
  Claude Agent SDK's `query({ resume })` can't be resolved, so the turn ended
  502/500. The in-memory resume-guard (ADR-0018, #57) is defeated on the *second*
  `session/start` after a switch, because the same handler overwrites the very
  "prior provider" snapshot it reads.

## Decision
Draw the tier boundary in the UI to match the data model, and make the engine
**set-once**.

**Main Settings = account defaults + device.** The Home Settings screen edits
the signed-in account's defaults — the engine, look, and world every *new*
chronicle inherits (`POST /me/settings`) — plus account music and the device
connection. It no longer reads or writes any campaign, so it needs no
`campaignId`, and the #97 empty state and the redundant "Save as my defaults"
button are gone (editing now *is* editing the defaults). Its engine picker writes
the default provider/model pair directly — no `session/start`, so it can't reach
the crash path.

**In-game Settings screen = this game.** A new full-screen `GameSettings` screen,
opened by a gear in the Active Play header (beside the music popover; back returns
to Play), edits the running game's Look, World, and music
(`POST /campaigns/:id/settings`). The engine and model are shown **read-only**
with a lock note.

**Engine/model are set-once.** They are chosen when a game is created (the
new-game form) and locked once play has begun. The UI offers no mid-game switch
at all (the main screen edits defaults; the in-game screen is read-only). The
backend enforces it defensively: `POST /campaigns/:id/session/start` rejects an
*explicit, differing* provider/model with **409** once a session has been
persisted (`isEngineChangeLocked` predicate). A no-arg `session/start` — the
entry-flow re-start on continue / new-game create — is always allowed, and before
the first session nothing is locked, so the new-game form can still pick the
engine. Gating on "a session id exists" is precise: the crash *requires* a
persisted session to resume, so this is exactly the condition that could go wrong.

**Shared editors.** The Engine/Look/World controls are extracted into
presentational components (`EnginePicker`, `LookSettingsEditor`,
`WorldSettingsEditor`) rendered identically by both screens, differing only in
where the caller persists — the same "shared editor, caller owns persistence"
pattern as `MusicOverrideEditor` (ADR-0020). `EnginePicker` has a `readOnly` mode
for the locked in-game engine.

## Consequences
- **No mid-game engine crash.** With no UI switch path and the backend 409, the
  stale-`.session-id` resume can't be triggered. We did not make session identity
  provider-aware (e.g. clearing `.session-id` on a provider/model change); that
  remains possible future hardening but is unnecessary while the engine is
  set-once, and is noted in the code where the guard lives.
- **Clean separation.** "My defaults for new games" and "this game's settings"
  are now distinct screens with distinct endpoints — no more silent rewrites of
  the active game from Home, and no no-campaign empty state.
- **A player cannot change a running game's engine.** This is intentional. The
  escape hatch is to start a new chronicle with the desired engine. Because the
  engine is chosen at creation and the file-backed state (ADR-0001) is portable,
  nothing else is lost.
- **Account defaults are now user-global mutable state in tests.** Because they
  persist on disk for a reused user and are inherited by new campaigns, the e2e
  harness resets them per test to stay order-independent.
- Model/provider still change only through `session/start`, never
  `POST /settings` (the ADR-0018 contract is unchanged); the new guard simply
  bounds *when* that change is allowed.
