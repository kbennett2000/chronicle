# ADR-0003: LAN Exposure and Minimal Auth

## Status
Proposed — to be finalized as part of the LAN-hosting slice

## Context
Per ADR-0002, the DM engine's permission scope was deliberately revisited
when it moved from a trusted local CLI loop to a network-reachable HTTP
service — but that service has still only ever been reachable from
localhost. Serving it to devices elsewhere on the home LAN (a phone, a
second PC) is the actual trigger ADR-0002 said to watch for: the service
is now reachable by something other than a trusted local script, even if
that something is just a household device on a private network.

Currently the HTTP API (Slice 2) has no authentication at all — reasonable
when only reachable from the same machine, not reasonable once bound to a
LAN interface.

## Decision (proposed)
1. Bind the server to the LAN interface (not `0.0.0.0` to the open internet
   — this stays a home-LAN-only service, not internet-exposed).
2. Add a minimal shared-secret check: a single passphrase/token, set via
   an environment variable (never committed, never logged), required on
   every request via a header. This is intentionally lightweight — not
   per-user accounts — appropriate for "my household, my LAN," not a
   multi-tenant or internet-facing posture.
3. Document, don't automate, the network-level pieces that are Kris's
   call, not code's: reserving a static LAN IP (or an mDNS hostname) for
   the host machine, and opening the chosen port in the Ubuntu firewall.
4. Explicitly out of scope for now: HTTPS/TLS. Browsers require a secure
   context for microphone access, which will matter once voice input is
   scoped, but isn't a blocker for text-only play today. Revisit this ADR
   again when that slice comes up rather than solving it preemptively.

## Consequences
- Playtesting becomes possible from her actual devices, which is the
  point of this slice.
- The shared secret is a real secret — must never land in the public repo,
  in commit history, or in logs. Worth a `.env.example` with a placeholder
  and a `.gitignore` entry for the real `.env`, checked explicitly.
- This is a deliberately minimal posture for a single-household LAN. If
  Chronicle is ever reachable beyond that (hosted, multi-user, exposed to
  the internet), this ADR does not cover that case — treat it as a new
  decision when that day comes, not an extension of this one.
