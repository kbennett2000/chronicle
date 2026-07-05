# 0010 — Campaign creation & character generation

## Status
Accepted

## Context
Until now a campaign could only be created out-of-band (`scripts/scratch-campaign.ts`,
or by hand), and the web client was hard-wired to a single campaign via the
`?campaign=` query param (`web/src/lib/campaign.ts`). Issue #36 — "Can I start a
new game/character or do I have to use this one?" — is the direct consequence:
there is no in-app way to begin a fresh game, and no way to see or pick between
multiple chronicles.

## Decision
Add in-app campaign creation with a real character-creation form, plus a
campaign list so Home can show every chronicle.

**Backend** (`src/campaign-store.ts`, `src/server.ts`):

- `scaffoldCampaign(campaignId, characterSheet, settings?)` — the single
  campaign-scaffolding primitive (directory + `session-log/` + the four state
  files + `campaign-settings.json`). `scripts/scratch-campaign.ts` now calls it
  too, so scratch and real campaigns are created the exact same way.
- `GET /campaigns` — lists every campaign under `campaigns/` (skipping
  `_registry` and any dir without a `character-sheet.json`), each with
  `{ id, name, race, class, level, situation }` (situation = the world-state
  "Current Situation" section).
- `POST /campaigns` — body `{ character }`; derives a valid campaign id from the
  name (slug + short suffix, matching `CAMPAIGN_ID_PATTERN`), builds the sheet,
  scaffolds, returns `{ campaignId }`.

**Character-sheet derivation is deterministic and — per CLAUDE.md — FLAGGED FOR
RULES REVIEW, not asserted correct.** The specific choices Kris should confirm:

- **Point-buy** on the client: 27 points, scores 8–15, standard 5e costs
  (8→0 … 13→5, 14→7, 15→9). This is the canonical SRD point-buy.
- **Ability modifier** = `floor((score − 10) / 2)`.
- **Starting HP** = class hit-die maximum + CON modifier (min 1). Hit dice
  (Barbarian d12; Fighter/Paladin/Ranger d10; Bard/Cleric/Druid/Monk/Rogue/
  Warlock d8; Sorcerer/Wizard d6) are standard SRD 5.2 values, hardcoded here
  because `reference/srd/` is a curated adjudication subset and does not carry
  the class hit-die table.
- **Unarmored AC** = 10 + DEX modifier. Starting armor/shields are not modeled
  at creation.
- **No racial ability bonuses** are applied. Under the 2024 SRD, ability-score
  increases come from **background**, which this form does not yet model; race
  is captured as identity/flavor only. This is the most likely point of
  rules-divergence and is called out for review.
- **Starting equipment and gold are left empty.** The opening DM scene is
  expected to establish gear in-fiction; a future slice may add SRD starting
  equipment. Flagged.

Level 1, `xp 0`, no conditions, empty inventory, zeroed currency, empty
`spellSlots`.

**Frontend** (`web/src/App.tsx`, `screens/Home.tsx`, new `screens/NewCharacter.tsx`,
`lib/campaign.ts`): App holds the active `campaignId` in state (seeded from
`?campaign=` or the first listed campaign); Home lists chronicles and offers
"Begin a New Chronicle"; the form collects name / race / class / point-buy
abilities and shows derived HP/AC/modifiers live before creating.

## Consequences
- `?campaign=` still works and still wins when present, so existing links and the
  e2e harness (which always passes `?campaign=`) are unaffected.
- The mechanical derivations above are the explicit review surface for Kris; if
  any is wrong, it changes only `buildCharacterSheet` (server) and the form's
  live preview — not the persistence or API shape.
- Creating a campaign is now a network-exposed write. It stays behind the same
  shared-secret auth as every other route (ADR-0003); ids are slugified and
  pattern-checked, so a create can't escape `campaigns/`.

## Amendment (issue #48) — describe the world at creation
Field feedback: players expected to describe the world *while* creating a
character, not only afterward in Settings. `POST /campaigns` now accepts an
optional `settings` object (`worldSetting`, `toneWhimsy`, `contentIntensity`)
alongside `character`, validated with the same rules as `POST
/campaigns/:id/settings` and persisted via `persistCampaignSettings` right after
`scaffoldCampaign`. The creation form (`NewCharacter.tsx`) gains an optional
"THE WORLD" section mirroring the Settings vocabulary; omitted fields keep the
standard-fantasy defaults and stay editable later. New campaigns also scaffold
`autoRollDice: true` (ADR-0011). No change to the derivation or id rules above.
