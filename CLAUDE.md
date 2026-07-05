# CLAUDE.md — Chronicle

## What this project is
Chronicle is a mobile-first solo D&D 5e app. A Claude Agent SDK-powered DM
engine runs each campaign with persistent, file-backed state (not just
conversation history) to eliminate state drift and content repetition —
the two failures of existing AI-DM apps. A separate, decoupled asset worker
(Grok Build, headless) generates and caches images at key story moments.

Full design context lives in `docs/design/chronicle-design-doc.md`.
Architecturally significant decisions live in `docs/adr/`, numbered
sequentially — read `0001-core-architecture.md` first.

## Roles
- **Product owner / strategist / D&D domain advisor:** browser Claude
  (Kris's human collaborator drives via prompts written in that thread).
- **Executor:** Claude Code (you), working in this repo.
- Kris is a solo developer under Twelve Rocks LLC. He does not know D&D
  rules in depth — rules-accuracy decisions should be flagged for review
  rather than assumed correct, and cited against the SRD text once that
  slice is in scope.

## Commit discipline
- **Every slice ends with its own commit(s), pushed, before the slice is
  reported done.** Uncommitted work is not "done" — it's a liability
  sitting in a working tree, one crash or accidental `git checkout` away
  from gone (see the test-data-hygiene incident this rule exists because
  of).
- Do not let multiple slices' work accumulate uncommitted "to batch
  later" — each slice's changes get committed and pushed at the end of
  that slice, closing that slice's own issue at that point, not in a
  retroactive bulk commit spanning several issues.
- If a slice is interrupted or spans more than one session, commit
  incremental progress rather than leaving it all uncommitted until the
  slice fully wraps.

## Test data hygiene
- **Never run destructive git operations** (`checkout`, `reset`, `clean`)
  against anything under `campaigns/` without first checking `git status`/
  `git diff` for uncommitted changes — no exceptions, regardless of how
  confident the change looks like "just my own test pollution."
- **All experimental/disposable validation uses a freshly created scratch
  campaign directory**, created and destroyed by
  `scripts/scratch-campaign.ts` (create/delete in one command) — never
  `test-campaign` or any other named fixture. This removes any reason to
  hand-roll a git-checkout cleanup dance again.
- `test-campaign` (or any deliberately-maintained fixture) must be left in
  a **clean, committed git state at the end of every slice** — either
  commit meaningful changes or revert to clean before calling the slice
  done. Dirty fixture state is never inherited silently across slices.

## Workflow discipline
- **ADR-first.** Any architecturally significant change gets an ADR in
  `docs/adr/` before or alongside implementation — not after the fact.
- **Vertical slices.** Default to many small, independently reviewable
  cycles over large monolithic ones. Each slice should be shippable/testable
  on its own. Flag it explicitly if a monolithic cycle is genuinely the
  better call for a given piece of work.
- **Definition of done:** every unit of work traces to a GitHub issue.
  Open one before starting work if none exists.
- **Real campaign data is out of git's remit** (see
  `docs/adr/0005-campaign-data-git-policy.md`); `test-campaign` and
  `campaigns/_registry/` are named, deliberate exceptions and stay
  tracked. Destructive git operations (`checkout`, `reset --hard`,
  `clean`) are never run against anything under `campaigns/`. Ad-hoc
  validation during a slice always uses a disposable throwaway campaign
  directory created and deleted within that slice — never `test-campaign`
  or any campaign Kris is actually playing.
- Agents (if/when added) live in `.claude/agents/`.

## Tech stack (initial)
- TypeScript/Node across backend and frontend — single language for a
  solo-maintained project.
- `@anthropic-ai/claude-agent-sdk` (or current equivalent package name —
  confirm against current docs before pinning) for the DM engine.
- Grok Build CLI, invoked headlessly, for image generation. Requires
  `XAI_API_KEY` or equivalent auth in the environment; do not commit keys.
- Campaign state stored as plain files (JSON/Markdown) per campaign,
  per the schema in the design doc §3.

## Repo conventions
- Public repo. No API keys, tokens, or `.grok`/`.claude` auth state
  committed — confirm `.gitignore` covers these before first commit.
- Slice 1 goal (see kickoff prompt): prove the file-backed state loop
  removes drift, before any UI, images, or rules-grounding work begins.

## What NOT to do yet
- No image generation wiring until the DM engine's state-file loop is
  proven (Slice 1 complete).
- No SRD rules-grounding until its own dedicated slice.
- No desktop dockable-panel UI until mobile-first UI is working — it's
  explicitly lower priority.
