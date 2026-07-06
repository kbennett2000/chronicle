# ADR-0018: Pluggable DM-Engine Backend (Claude + Grok)

## Status
Accepted (Slice 0 — validation-spike evidence recorded below; implementation
proceeds in subsequent slices)

## Context
The DM engine — narration, 5e adjudication, and the per-turn state-file update
discipline (ADR-0001) — runs only on the Claude Agent SDK (`query()` in
`src/dm-engine.ts`). Grok is used solely for images (ADR-0009). The product
owner wants a per-campaign **Settings option to switch the DM brain between
Claude and Grok**, at **full feature parity** (the four host tools the DM uses —
dice, seed-based anti-repetition, texture tables, in-turn image generation),
offering **both Grok models** (`grok-build`, `grok-composer-2.5-fast`), surfaced
as a **provider toggle** in the "THE ENGINE" settings section that mirrors the
existing per-campaign, session-resetting model semantics.

The dominant risk was unproven: whether Grok, driven headlessly, would actually
follow Chronicle's strict per-turn "read state → narrate → update every affected
file" discipline well enough to be playable, and whether it could be confined
safely — Grok is a full agentic coder that once ran `git commit`/`git push` on
its own when pointed at this repo (issue #60), and a DM turn *must* write inside
`campaignDir`, which lives inside the repo, so the empty-temp-dir isolation that
made image-gen safe is unavailable here.

## Decision
Introduce a `DmBackend` abstraction. Both providers implement
`runTurn(args): Promise<TurnResult>` returning the **unchanged** `TurnResult`
`{text, sessionId, isError, model, requestedModel}`, so `src/server.ts` stays
provider-agnostic below a single dispatch line. `provider` becomes a
per-campaign field in `campaign-settings.json`, excluded from the settings PATCH
type exactly like `model` — it changes only via `POST /session/start`, which
resets the session (no silent mid-story adjudication shift; generalizes the #57
model-switch guard to reset when **either** provider or model changes). The four
host tools are ported to standalone stdio MCP servers reusing the existing pure
functions. Grok is invoked headlessly, confined by `--sandbox workspace` plus
tool-removal and a pre-tool-use hook.

## Slice 0 validation spike — evidence (grok CLI v0.2.82, model `grok-build`)
A throwaway spike ran two turns (opening + a resumed player action) on a
disposable scratch campaign using the **real** `systemPrompt()`, watching
`git status` throughout. Results:

- **Prompt delivery — SOLVED better than planned.** grok has
  `--system-prompt-override` (a true *replace*, mapped from Claude Code's
  `--system-prompt`), not just the append-only `--rules`. The ~11K–13K DM prompt
  is passed whole via `--system-prompt-override`, so **Grok's 10,000-char
  AGENTS.md cap is irrelevant** and no persona/prompt split is needed. Delivered
  11,082 chars with no truncation; adherence confirms it was received in full.
- **State-file writes land, discipline followed.** Turn 1 (opening) rewrote
  `world-state.md`'s Current Situation and appended the session log. Turn 2 (a
  search) correctly updated `character-sheet.json` — added the found item and
  raised gold — and the session log. Grok read and edited the campaign files via
  its own file tools under the sandbox.
- **Adherence is playable.** Present-tense narration grounded in the exact
  character sheet (halfling rogue, gear, the circled-room map), coherent across
  turns, clean of meta-chatter, one hook, no menu options.
- **Sandbox + anti-rogue-commit — SOLVED and stronger than planned.**
  `--sandbox workspace` = *read everywhere, write only to CWD (`campaignDir`) +
  `/tmp` + `~/.grok`*. So (a) SRD (`reference/srd`, outside `campaignDir`,
  ADR-0006) is **readable by construction** — the planned `--allow`/SRD-copy
  workaround is unnecessary; and (b) the repo `.git` and `src/` (outside the
  campaign-dir CWD) are **not writable**, blocking the rogue-commit at the
  filesystem layer. Plus `--disallowed-tools run_terminal_cmd` removes the
  terminal tool entirely. Post-spike `git status` showed Grok modified **no**
  tracked repo file, created nothing under `src/`/`docs/`, and never touched
  `.git`. All writes landed inside the gitignored scratch campaign.
- **Session continuity works.** `--session-id <uuid>` creates; `--resume <uuid>`
  resumes; the `sessionId` is echoed in the JSON. Turn 2 resumed and held
  continuity (same scene/NPCs). Maps 1:1 onto the existing `.session-id`
  persist/resume.
- **Headless output.** `--output-format json` → `{text, stopReason, sessionId,
  requestId}`; `.text` is the clean narration (file edits are disk side
  effects). `stopReason=EndTurn` on success.
- **Performance.** ~116s and ~151s per turn with `grok-build` — slower than
  trivial but comparable to Claude's minutes-long turns; acceptable for solo
  play. `grok-composer-2.5-fast` may be quicker.

**Gate verdict: PASS.** The dominant risks (prompt fit, discipline adherence,
safe confinement, resume) are resolved empirically. Two not fully spiked and
carried into later slices as validation steps: **MCP-server reachability**
(Slice 3 — grok documents stdio MCP via `config.toml`; not yet exercised) and
**SRD reads under real rules adjudication** (Slice 4 — enabled by the workspace
sandbox, but not driven by a combat/rules turn in the spike).

## Consequences
- **Grok invocation shape** (finalized from the spike): `grok -p <userInput>
  --cwd <campaignDir> -m <model> --output-format json --system-prompt-override
  <systemPrompt> --sandbox workspace --disallowed-tools run_terminal_cmd
  --always-approve --no-plan --no-subagents --disable-web-search` with
  `--session-id <uuid>` (new) or `--resume <uuid>`. **No `--effort`** (both grok
  models reject reasoningEffort — image-generator.ts:174).
- **For Grok, requested-vs-actual model collapses** (`model = requestedModel`)
  — the JSON carries no per-message model echo like Claude's. `modelsMatch`
  still holds trivially.
- Plan risks #2 (10K prompt cap) and #3 (sandbox vs SRD) are **retired** by
  `--system-prompt-override` and `--sandbox workspace`. Remaining risks: Grok
  rules-adherence at scale (mitigated — the per-campaign, session-resetting
  selector lets a player fall back to Claude anytime), and the cross-process
  content-registry write race (acceptable under the `active.busy` single-flight
  lock; a solo player runs one turn at a time).
- This extends ADR-0002 (permission scope: the sandbox + pre-tool-use hook are
  the Grok-side enforcement), ADR-0004 (per-turn `.grok/config.toml` + live
  settings reads re-establish "no cross-campaign bleed" out-of-process),
  ADR-0006 (SRD grant, now via read-everywhere sandbox), and ADR-0008
  (deterministic host-side permission — replicated in a `.grok/hooks/`
  pre-tool-use script sharing one confinement policy with the Claude gate).

## Alternatives considered
- **`--rules` append + AGENTS.md split** for the prompt — rejected once
  `--system-prompt-override` was found; the split duplicated the DM contract
  across two mechanisms and risked drift.
- **`--sandbox strict`** — rejected: it confines *reads* to CWD, which would
  block SRD; `workspace` confines only writes, which is exactly the boundary
  needed.
- **Copying SRD into each campaign dir** to satisfy a stricter sandbox —
  unnecessary given `workspace` reads everywhere.
