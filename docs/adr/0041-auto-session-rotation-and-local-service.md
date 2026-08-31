# ADR-0041: Automatic session rotation + always-on local service

Status: Accepted
Date: 2026-08-31

## Context

ADR-0040 shipped **session rotation**: because the state files (not the SDK
conversation) are Chronicle's source of truth, dropping the resumed SDK session
and re-priming a fresh one from the state files (`catchUpDirective`) loses no game
state and cures the long-campaign "lazy DM" drift caused by an unbounded resumed
transcript. That ADR shipped it as a **manual** control only — a "Start a fresh
session" button (`POST /campaigns/:id/session/refresh`), with automatic rotation
explicitly deferred as a follow-up.

Live play (the `ted-the-wizard` testbed) confirmed fresh sessions dramatically
improve output: a rotated turn re-reads the state files and produces rich,
un-repetitive story, at a fraction of the resumed turn's token cost. Having to
remember to press a button is the wrong ergonomics for a fix this reliable — the
sharp-DM state should be the default, maintained automatically.

Separately, the server has been run by hand (`npm run serve`) and had to be
restarted manually after every reboot or code change. For a single-user home
setup that is friction; it should come up on boot and stay up.

## Decision

### 1. Automatic session rotation (opt-out, every N turns)

Two new per-campaign `CampaignSettings` fields:

- `autoRotateSession?: boolean` — **default ON** (absent ≡ ON, mirroring
  `autoRollDice`). Explicit `false` disables it; the manual button still works.
- `autoRotateTurns?: number` — turns between automatic fresh sessions.
  Absent ≡ `DEFAULT_AUTO_ROTATE_TURNS` (**5**). A finite integer ≥ 1.

The trigger is a pure, unit-tested helper
`shouldAutoRotate(totalTurns, settings)` in `campaign-store.ts`: rotate when
auto-rotation is enabled and `totalTurns` is a positive multiple of the interval.

**Where it fires.** In the `POST /campaigns/:id/turns` handler, *after* a
successful turn and *after* any same-session scene-caption backfill (which needs
the still-live session), the handler checks `shouldAutoRotate(priorTurns + 1,
settings)` and, when true, drops the session exactly as the manual path does:

```ts
active.sessionId = undefined;
clearPersistedSessionId(campaignDir);
```

The **next** turn then takes the existing fresh-session branch
(`resumeSessionId === undefined && priorTurns > 0` → `catchUpDirective`). No
`runTurn`/engine changes; the current turn's latency is unaffected — only the
next turn pays the (cheaper) re-prime.

**Why total-turn modulo, not "turns since last rotation".** The campaign's
transcript log is continuous across rotations (rotation clears only the
`.session-id`, never the log), and there is no persisted per-turn counter. Keying
off the running total needs no new state and is deterministic. A manual rotation
between multiples is harmless — the next automatic rotation still lands on the
next multiple. Introducing a "turns since rotation" baseline would require new
persisted state for no meaningful behavioural gain.

**Surfaced in two places**, both defaulting to on / 5:
- the **New Chronicle** setup screen (copy-on-create, pre-filled from the last
  game like the other dials), and
- **Game Settings → THE DUNGEON MASTER**, beside the retained manual button.

Reused UI primitives: `ToggleRow` and a new small `TurnsField` in
`web/src/components/LookControls.tsx`.

### 2. Always-on local service

The server is run as a **systemd *user* service** on the host, not a hand-started
process:

- Port/host come from `config.json` (`server.port` / `server.host`) — the actual
  configuration surface post-ADR-0033; **environment variables are ignored** by
  the config loader, so the stale `.env`/`PORT` references in the older
  `deploy/` system-unit template do not apply. For this host: `port: 9999`,
  `host: "0.0.0.0"` (LAN-reachable so the mobile-first UI can be played from a
  phone on the same network; Chronicle's per-user auth, ADR-0023, guards it).
  `config.json` is git-ignored and per-machine, so this is a local change, not a
  committed one.
- `ExecStart=/bin/bash -lc 'npm start'` from the repo working directory. A login
  shell picks up the nvm-managed node robustly (rather than hardcoding an
  nvm path that changes on upgrade). `npm start` → `tsx src/server.ts` runs
  `src/` directly, so **a restart always runs the latest server code with no
  build step**. The web bundle is served from the committed `public/`; it is
  rebuilt and committed as part of front-end changes (this slice does so), *not*
  rebuilt on start — a start-time rebuild would rewrite hashed tracked files and
  leave the repo perpetually dirty.
- `systemctl --user enable --now chronicle` + `loginctl enable-linger <user>` so
  it starts at boot without an interactive login and auto-restarts on failure.

A **user** unit (not the repo's `deploy/chronicle.service` *system* template) is
used because the DM engine and the image/video backends rely on the user's nvm
node, `~/.grok` / ComfyUI, and home-directory campaign data; running as the login
user avoids the system-unit's node-invisibility and permission mismatches. The
stale `deploy/` docs are refreshed to point at `config.json` (not `.env`) and to
document the user-service + linger approach.

## Consequences

- Long campaigns keep a sharp DM automatically; the fix is the default, not a
  chore. Players who want the old resume-forever behaviour set the toggle off.
- Every ~N turns one turn re-reads the state files (a few extra tool calls and a
  short delay on *that* turn); this is the intended cost and is far cheaper than
  the unbounded resumed context it replaces.
- The rotation cadence keys off total turns, so changing `autoRotateTurns`
  mid-campaign re-phases future rotations against the new interval immediately.
- The host serves Chronicle on `0.0.0.0:9999` at boot. LAN exposure is limited to
  the home network and gated by per-user auth; if a host firewall (e.g. `ufw`) is
  active, `9999/tcp` must be allowed on the LAN interface.

## Alternatives considered

- **Size-threshold rotation** (rotate when the transcript/context exceeds N KB)
  — more precise but needs a size signal the turn loop doesn't currently compute,
  and a turn-count cadence is simpler and predictable for players. Deferred.
- **"Turns since last rotation" counter** — rejected; needs new persisted state
  for no behavioural gain over total-turn modulo (see above).
- **Repo system unit / rebuild-on-start** — rejected for the nvm/permission and
  dirty-tree reasons above.
