# ADR-0008: Deterministic Host-Side Permission Enforcement (PreToolUse Gate)

## Status
Accepted — implemented in Slice 27. Extends ADR-0002 and ADR-0006; does not
supersede them (their `allowedTools`/`disallowedTools`/`dontAsk`/`cwd`
configuration is retained as defense-in-depth).

## Context
Issue #29: during a real played session the DM engine twice broke character
mid-turn to complain it lacked permission to read/write campaign state files,
quoting the system prompt's own "already fully granted" wording back. If state
writes silently fail — especially during combat, where HP/quest/NPC tracking
matters most — the whole file-backed-state premise (ADR-0001) is undermined.

Slice 26 added logging but could not reproduce the break across 10 runs, and
explicitly refuted the leading theory (that ADR-0006's absolute-path SRD grant
`Read(${SRD_DIR}/**)` fails to compose with the cwd-relative campaign grants
under `permissionMode: "dontAsk"`) as a *deterministic* mismatch — that
combination succeeded every time it occurred.

The remaining structural weakness: with `dontAsk` + a bare `allowedTools`
array, the actual allow/deny decision happens entirely inside the closed-source
SDK via glob-string matching. We neither see it nor control it, so an
intermittent denial of a legitimate tool is invisible and unfixable from our
configuration.

### Key empirical finding (the reason this ADR exists)
The obvious lever — the SDK's `canUseTool` callback — **does not work for our
case.** The SDK auto-approves bare `allowedTools` entries *before* consulting
`canUseTool`, emitting a `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` warning and never
invoking the callback for those tools. Verified against a real turn: with a
`canUseTool` wired up, its allow/deny count was zero while six tool calls
executed. A **PreToolUse hook**, by contrast, fires for *every* tool call
regardless of `allowedTools` (verified: it logged all six), and its
`hookSpecificOutput.permissionDecision` is authoritative. So PreToolUse — not
`canUseTool` — is the only host-side gate that actually sees the tools we care
about.

## Decision
Move the permission decision into our own code, enforced from the PreToolUse
hook that Slice 26 already added for logging:

1. **`decidePermission(toolName, input, campaignDir, generateImages)`** — a
   pure, unit-tested function returning `{ behavior: "allow" }` or
   `{ behavior: "deny", message }`. It allows exactly the ADR-0002/ADR-0006
   grant set, but evaluated from the resolved tool input rather than a glob
   string: campaign-cwd `Read`/`Write`/`Edit`/`Glob` (path contained within
   `campaignDir`), SRD-dir `Read` (read-only, contained within `SRD_DIR`), and
   the `seed-tables`/`texture-tables` host MCP tools (plus `image-tools` only
   when the campaign opted into image generation). Everything else — `Bash`,
   out-of-tree paths, unknown tools — is denied.
2. The **PreToolUse hook** calls `decidePermission`, logs the decision (`ALLOW`/
   `DENY` with tool, resolved input, and deny reason), and returns
   `hookSpecificOutput.permissionDecision` accordingly. This is now both the
   instrumentation and the enforcement point.
3. `allowedTools`, `disallowedTools: ["Bash"]`, `permissionMode: "dontAsk"`,
   and `cwd = campaignDir` are all **retained unchanged** as defense-in-depth.
   `canUseTool` is deliberately **not** used (it would be silently shadowed).

## Consequences
- Every permission decision is now deterministic, made in our code, and logged
  — so the next real #29 occurrence is captured as a concrete `[dm-engine]
  PreToolUse DENY: <tool> <input> — <reason>` line, not just broken narration.
- **This is a structural hardening whose efficacy against #29 is unconfirmed.**
  The bug never reproduced, so we cannot prove this eliminates it. Empirical
  runs during this slice did surface a refined diagnosis, though: in a
  cold-start combat turn the model sometimes fails to read cwd-relative state
  and instead escalates to reading *up* the directory tree
  (`.../chronicle/campaigns`, the repo root) — attempts that are correctly
  denied (they are genuinely out of scope) and can precede a break-character
  moment. That points at model navigation on cold turns, not at a legitimate
  grant being denied. #29 stays open pending a real recurrence with these logs.
- The e2e `test.fixme()` combat-content assertion in `turn.spec.ts` stays
  skipped until #29 is confirmed fixed by an actual recurrence.
- Verified no regression: `turn.spec.ts` and `transcript.spec.ts` (real turns
  that read and write state and assert success) pass, proving the allow path
  lets legitimate cwd/SRD tools through; the scratch run proved the deny path
  fires with clear reasons and no shadow warning.
- Re-check this ADR if the grant set changes (e.g. a future slice needs the
  engine to touch something outside its campaign dir + SRD), the same as
  ADR-0002 asks.
