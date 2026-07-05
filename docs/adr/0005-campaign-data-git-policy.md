# ADR-0005: Campaign Data Git Policy

## Status
Accepted (written retroactively — this ADR was referenced by number
elsewhere in the repo before it existed; this fills that gap and is now
the source of truth going forward).

## Context
Chronicle's repo is public. `campaigns/` will hold real player data once
actual play begins — a real person's private story choices, character
details, and session history. That must never enter public git history.
At the same time, `test-campaign/` is dummy dev/validation data with no
privacy stakes, and has been usefully tracked and committed several times
already (including recovering from an accidental data-loss incident
during Slice 8 validation) — tracking it in git is a feature there, not a
risk.

A prior slice's documentation referenced "ADR-0005" as the source of a
"campaigns/ is out of git's remit entirely" policy, but no such file was
ever actually created, and practice had already diverged from that stated
intent (test-campaign is tracked). This ADR resolves the drift by stating
the actual intended policy plainly.

## Decision
1. **Campaign directories are gitignored by default.** Real player
   campaigns never enter git, full stop — no exceptions, no "just this
   once."
2. **`test-campaign/` is an explicit, named exception** — a known dev/
   validation fixture, deliberately tracked and committed as part of
   normal slice work, per the existing commit-discipline and test-data-
   hygiene rules in CLAUDE.md.
3. **`scratch-*` campaigns are never committed either way** — they're
   created and destroyed within a single validation task via
   `scripts/scratch-campaign.ts` and should never outlive that task, so
   the gitignore question doesn't really apply to them, but for clarity:
   they're covered by the same default-ignore rule as any other non-
   `test-campaign` directory.
4. `.gitignore` should read approximately:
   ```
   campaigns/*
   !campaigns/test-campaign
   !campaigns/test-campaign/**
   ```
   (excluding `campaigns/_registry/` if that's meant to ship as shared
   infra rather than per-campaign data — confirm its intended status
   while touching this.)

## Consequences
- No real campaign data can accidentally end up in public git history
  going forward.
- `test-campaign`'s existing commit history is fine as-is — it's dummy
  data, no cleanup needed there.
- **Not solved by this ADR:** if a real campaign ever needs backup/
  recovery (the same motivation that made test-campaign's git tracking
  useful during the earlier data-loss incident), the mechanism must be
  something other than committing to this public repo — a local backup
  strategy, decided separately, later. This ADR only guarantees real data
  doesn't go somewhere it definitely shouldn't; it doesn't yet solve
  where real data's backup *should* go.
