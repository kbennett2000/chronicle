# ADR-0002: Agent SDK Permission Scope Beyond the CLI Prototype

## Status
Accepted — implemented in Slice 2

## Context
Slice 1's harness ran the Agent SDK with `permissionMode: "bypassPermissions"`,
appropriate for a trusted, single-user local CLI loop with no service
boundary and no human approver in the loop. Slice 2 moves the DM engine
behind an HTTP service boundary (see roadmap), which changes the trust
model: the process is no longer just "me running a script," it's a
long-running service a client talks to over a network, even if that
network is localhost for now.

## Decision
Replace blanket `bypassPermissions` with an explicit, scoped tool/directory
allowlist:
- File read/write restricted to the specific campaign's working directory,
  not the filesystem broadly.
- No arbitrary shell/bash execution unless a concrete need emerges — the DM
  engine's job is reading/writing campaign state files, not running
  commands.
- Revisit this ADR (don't silently expand scope) if a future slice needs
  the engine to do something outside file read/write on its own directory.

Implemented as `allowedTools: ["Read(./**)", "Write(./**)", "Edit(./**)",
"Glob(./**)"]` with `disallowedTools: ["Bash"]` and
`permissionMode: "dontAsk"`, with the Agent SDK session's `cwd` set to the
specific campaign's working directory. The path-scoped rules resolve
relative to `cwd`, so they cover exactly that campaign's directory; `Bash`
is removed from the tool set entirely rather than merely denied;
`dontAsk` converts anything not pre-approved into an outright denial
instead of a prompt, appropriate for a headless service with no human
approver.

## Consequences
- Slightly more setup than blanket bypass; worth it before this is
  reachable by anything other than a trusted local script.
- This is the kind of boundary that should be re-checked any time the
  service's reachability changes (e.g., local-only vs. eventually
  multi-user/hosted) — flag it again at that point rather than assuming
  this ADR covers a future architecture it wasn't written for.
