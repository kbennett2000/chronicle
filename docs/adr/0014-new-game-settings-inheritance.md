# 0014 — New-game settings inherit from the last-played campaign

## Status
Accepted

## Context
Issue #64 ("Starting a new game changes settings which have to be reverted
back"): a freshly created game came up with the wrong look/play settings —
scene-art **off**, no art style, auto-roll **on** — even though the player's
existing campaign ran with scene-art on, a chosen art style, and auto-roll off.
The player then had to open Settings and reconfigure every new game.

The root cause was the mechanism introduced by #57/#60. New-game defaults were
seeded from two per-device browser caches:

- `chronicle.model` (`web/src/lib/modelPref.ts`, #57), and
- `chronicle.lookPrefs` (`web/src/lib/lookPrefs.ts`, #60).

`lookPrefs` was populated **only** when the player edited a look/play control on
the Settings screen *after #60 shipped* (`Settings.tsx` `patchSettings` →
`saveLookPref`). Any setting configured earlier, never re-toggled, or set on a
different device was absent from the cache — so the new game fell back to the raw
`scaffoldCampaign` defaults (images off, `autoRollDice: true`). The model carried
over only because its separate, older cache happened to be populated. A localStorage
cache keyed on "fields you happened to re-toggle recently on this device" can't
reliably answer "what settings does this player actually use."

A secondary defect lived in the same create path: `NewCharacter.submit()` seeded
`contentIntensity` from the cache and then re-applied the visible picker's value
only when it was *not* `"standard"` — so a cached `"low"` silently overrode a
visibly-selected "Standard".

## Decision
New-game look/play/model defaults are derived **server-side from the most
recently played campaign**, and every dial is **surfaced on the New Chronicle
screen**, pre-filled from that copy. The created game stores its own complete,
explicit copy of the settings. This supersedes #60's per-device localStorage
seeding.

**Backend** (`src/campaign-store.ts`, `src/server.ts`):
- `newGameDefaultSettings()` picks the most recently *played* campaign —
  recency = newest mtime among its `session-log/*.transcript.jsonl` files,
  falling back to `campaign-settings.json` mtime, then the directory — and
  returns that campaign's settings via `readCampaignSettings`, **excluding
  `worldSetting`** (the premise of each specific game, typed fresh). Returns `{}`
  when no eligible campaign exists, so the client uses neutral defaults.
- `GET /new-game-defaults` exposes it as `{ settings }`. It is a top-level path
  so the `/campaigns/:id` matcher can't shadow it.
- `POST /campaigns` already validated and persisted every look/play field; it is
  unchanged. The create screen now always sends them explicitly.

**Frontend** (`web/src/screens/NewCharacter.tsx`, `web/src/lib/campaign.ts`):
- `getNewGameDefaults()` fetches the endpoint. `NewCharacter` pre-fills the model,
  scene-art, auto-illustrate, art-style, auto-roll, content-intensity and tone
  dials from it (neutral fallbacks per field), renders a "THE LOOK" section for
  the look/play toggles, and on submit sends **all** fields explicitly — removing
  the seed-then-conditional-override logic (and with it the contentIntensity bug).

**Removals:** `web/src/lib/lookPrefs.ts` and `web/src/lib/modelPref.ts` are
deleted, and the `saveLookPref` / `savePreferredModel` calls in `Settings.tsx`
are removed. Per-campaign settings remain authoritative on the server and are
reloaded per game — the caches are no longer the source of new-game defaults.

**Shared UI:** the toggle-row and art-style-picker markup, previously only in
`Settings.tsx`, is extracted to `web/src/components/LookControls.tsx` and used by
both screens (testids and behaviour preserved).

## Consequences
- A new game starts like the last one the player actually played, on any device,
  with no dependence on which controls were recently re-toggled. It self-heals
  for existing players immediately.
- Every created campaign now has a fully-populated `campaign-settings.json`
  (explicit values rather than "absent = default"), which is the intended
  "each game owns its own copy" model.
- `worldSetting` is deliberately the one field **not** inherited; if a player
  expected the previous world premise to carry, that is a follow-up decision.
- "Most recently played" is derived from file mtimes, not an explicit
  last-played timestamp. This is sufficient for a single-household app; if
  multi-user or clock-skew concerns arise, an explicit timestamp can replace it.
