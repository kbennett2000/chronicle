# 0012 — Campaign deletion

## Status
Accepted

## Context
Issue #50: there was no way to delete a character/campaign. Once created, a
chronicle lived under `campaigns/<id>/` forever, and play-testing quickly
produced throwaway characters ("Dan the Space Asshole", "9") cluttering Home
with no way to remove them. Deletion is a network-exposed, irreversible,
destructive filesystem operation, so it needs a deliberate design rather than an
ad-hoc `rm`.

## Decision
Add `deleteCampaign(id)` (`campaign-store.ts`) and a **`DELETE /campaigns/:id`**
route, gated by the same shared-secret auth as every other route (ADR-0003).

Safety is layered:

- **Path containment:** `deleteCampaign` resolves the id through
  `resolveCampaignDir`, which already enforces that the id matches
  `CAMPAIGN_ID_PATTERN` and resolves to a plain directory *directly under*
  `CAMPAIGNS_ROOT` — no traversal, no absolute paths, no nested paths. A delete
  therefore can never escape `campaigns/`.
- **Protected fixtures:** a `PROTECTED_CAMPAIGN_IDS` set refuses `test-campaign`
  with a `CampaignProtectedError` → **HTTP 403**, so the app can never destroy
  the tracked test fixture (CLAUDE.md test-data hygiene, ADR-0005). The
  `_registry` helper dir is already unreachable because it fails the id pattern.
- **Not-found** is a `CampaignNotFoundError` → 404, never a silent success.
- The route also drops any in-memory `activeSessions` entry so a later request
  can't resurrect a half-deleted session.

**UI (Home):** each chronicle row — the active card and every "other chronicle"
— carries a trash affordance that opens a confirmation dialog ("`<name>` will be
gone forever … This cannot be undone.") before calling `deleteCampaign`. On
success the list refreshes; deleting the *active* chronicle rebinds Home to
another chronicle (new `onSwitchCampaign` callback, staying on Home) or, if none
remain, routes to character creation.

## Consequences
- Players can clean up throwaway characters; test data hygiene is preserved
  because the one tracked fixture is un-deletable through the app.
- CORS now advertises `DELETE` alongside `GET, POST, OPTIONS`; the shared
  preflight handler already covers it.
- Deletion is permanent (no soft-delete / trash). Real campaign data lives
  outside git (ADR-0005), so a mistaken delete of a *played* campaign is not
  recoverable from version control — the confirmation dialog is the only guard,
  which is acceptable for a single-user household app but noted here as the
  deliberate trade-off.
