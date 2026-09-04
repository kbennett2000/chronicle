# CLAUDE.md — Chronicle

## What this project is
Chronicle is a mobile-first solo D&D 5e app. A Claude Agent SDK-powered DM
engine runs each campaign with persistent, file-backed state (not just
conversation history) to eliminate state drift and content repetition —
the two failures of existing AI-DM apps. A separate, decoupled asset engine
generates and caches images at key story moments via a pluggable backend
(ADR-0027) — Grok Build headless, or a local ComfyUI/SDXL engine.

Architecturally significant decisions live in `docs/adr/`, numbered
sequentially — read `0001-core-architecture.md` first, and
`docs/adr/README.md` for the full index. Original design context lives in
`docs/design/chronicle-design-doc.md`, but note it is a **v0.1 planning
artifact**: where it and an ADR disagree, the ADR wins.

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
  `docs/adr/0005-campaign-data-git-policy.md`); `campaigns/kris/test-campaign`
  (the tracked fixture — note it moved under the multi-user layout) and
  `campaigns/_registry/` are named, deliberate exceptions and stay
  tracked. Destructive git operations (`checkout`, `reset --hard`,
  `clean`) are never run against anything under `campaigns/`. Ad-hoc
  validation during a slice always uses a disposable throwaway campaign
  directory created and deleted within that slice — never `test-campaign`
  or any campaign Kris is actually playing.
- Agents (if/when added) live in `.claude/agents/`.

## Tech stack
- TypeScript/Node across backend and frontend — single language for a
  solo-maintained project.
- `@anthropic-ai/claude-agent-sdk` for the DM engine, pinned in
  `package.json`. The DM backend itself is **pluggable** (ADR-0018) —
  Claude or Grok, selected per campaign.
- Image generation via a **pluggable backend** (ADR-0027): Grok Build CLI
  (headless; `XAI_API_KEY` or `~/.grok`, do not commit keys) or a local
  ComfyUI/SDXL engine on the host GPU — the local path adds per-style LoRA
  recipes (ADR-0032), img2img "change amount" (ADR-0036), and IP-Adapter
  reference likeness (ADR-0037).
- Video generation is **pluggable** too (ADR-0034): Grok Imagine (ADR-0026)
  or a local ComfyUI Wan 2.2 / LTX-Video backend (ADR-0035).
- Campaign state stored as plain files (JSON/Markdown) per campaign,
  per the schema in the design doc §3.

## How it runs
- **Configuration is file-based** (ADR-0033): `config.json` for settings and
  `secrets.json` for passwords — both git-ignored, both seeded from their
  committed `.example` twins. **The loader ignores environment variables**:
  there is no `.env`, and `PORT`/`HOST` do nothing. Every key is documented
  in `docs/configuration.md`.
- `npm start` runs `tsx src/server.ts` directly. No build step for backend
  changes — but **no hot-reload either**. After editing `src/`, restart the
  server or you'll sit there testing stale code wondering why the fix didn't
  take.
- On the always-on host Chronicle runs as a **systemd user service**
  (ADR-0041): `systemctl --user restart chronicle` to pick up `src/` changes,
  `journalctl --user -u chronicle -f` for logs. Setup is in `deploy/README.md`.
- The web UI is served from the **committed `public/` bundle**, so a front-end
  change isn't done until `npm run build:web` has run and the regenerated
  `public/` is committed alongside the `web/src/` change in the same PR. Two
  PRs that both touch the bundle will collide — rebuild the second one against
  the merged base rather than hand-resolving the conflict.
- **Multi-user** (ADR-0019): users register their own accounts — no shared
  secret — and campaigns nest at `campaigns/<user>/<campaign>/`.
- Install guides: `SETUP.md` (technical/LAN hosting) and
  `docs/user-guide/install/{linux,mac,windows}.md` (end-user).

## Repo conventions
- Public repo, MIT licensed — with SRD 5.2 rules text as the CC-BY-4.0
  exception (see `NOTICE`; surfaced to players at the foot of Settings).
- No API keys, tokens, or `.grok`/`.claude` auth state committed.
  `config.json` and `secrets.json` are git-ignored (ADR-0033).

## What NOT to do yet
> **Historical (kickoff sequencing).** All three gates below have since been
> passed — images (ADR-0009/0027), SRD grounding (ADR-0006), and the desktop
> layout (ADR-0021/0022) are all shipped, as is the original Slice 1 goal of
> proving the file-backed state loop removes drift. Kept for the record of
> the original slice ordering.
- No image generation wiring until the DM engine's state-file loop is
  proven (Slice 1 complete).
- No SRD rules-grounding until its own dedicated slice.
- No desktop dockable-panel UI until mobile-first UI is working — it's
  explicitly lower priority.
