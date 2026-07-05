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

## Workflow discipline
- **ADR-first.** Any architecturally significant change gets an ADR in
  `docs/adr/` before or alongside implementation — not after the fact.
- **Vertical slices.** Default to many small, independently reviewable
  cycles over large monolithic ones. Each slice should be shippable/testable
  on its own. Flag it explicitly if a monolithic cycle is genuinely the
  better call for a given piece of work.
- **Definition of done:** every unit of work traces to a GitHub issue.
  Open one before starting work if none exists.
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
