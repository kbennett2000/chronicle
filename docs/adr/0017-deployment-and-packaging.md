# ADR-0017: Deployment & Packaging — Native-First, Docker Deferred

## Status
Accepted

## Context
Chronicle's long-term home is an always-on Ubuntu box on the household LAN, but
it should also be reasonably easy for a Windows or macOS user to stand up. The
question raised was whether to containerize (Docker) and how to make the
listening port easily configurable.

Two constraints are hard requirements:

1. **Claude auth must use a subscription, not a per-token API key.**
2. **Image generation via the `grok` CLI must keep working.**

Relevant facts about how the app runs today:

- The backend is `tsx src/server.ts` — no compile step. The React UI in `web/`
  builds (Vite) into the backend's `public/`, which the same process serves
  statically. One process, one port.
- **The port is already env-driven.** `server.ts` reads `PORT` (default `4317`)
  and `HOST` (default `127.0.0.1`) and `listen(PORT, HOST)`. Production honored
  this already; only the dev-only Vite proxy hardcoded the port (fixed in #73).
- **Claude subscription auth works, but by an undocumented path.** The Agent
  SDK's `query()` spawns the bundled `claude` CLI as a subprocess, and that CLI
  resolves auth the way Claude Code does — including reading OAuth credentials
  from a prior interactive `claude` login at `~/.claude/.credentials.json`. On
  the current host `ANTHROPIC_API_KEY` is unset and turns run fine on the
  subscription login. **However**, Anthropic's documentation states the Agent
  SDK's *supported* auth is `ANTHROPIC_API_KEY` (plus cloud providers), and
  signals that subscription/OAuth auth for programmatic SDK usage is not
  officially supported and may be restricted or separately metered. So the
  behavior we depend on is real today but undocumented and could change under an
  SDK or CLI update. Setting `ANTHROPIC_API_KEY` would switch billing to the
  per-token API, so it must be left **unset** to keep subscription behavior.
- **`grok` is a native, per-OS binary with a `$HOME` login.** It is installed
  outside npm (a platform-specific binary; Linux ELF on the host, under
  `~/.grok/bin`), authenticates via an interactive login stored under `~/.grok`,
  and the engine both shells out to it (`execFile("grok", …)`) and reads its
  output back from `~/.grok/sessions/…` (`os.homedir()`). Images are best-effort
  and decoupled (ADR-0001), never blocking a turn.
- Data paths are module-relative (`campaigns/`, `reference/srd`, `data/`,
  `public/`), so they travel with the code. No Node version was pinned anywhere.

## Decision
Package Chronicle for **native execution**, not Docker.

1. **Pin the runtime and add a one-command bootstrap** (#73): `engines`
   (`node >=22`) + `.nvmrc`, and cross-platform root scripts so any OS runs
   `npm run setup && npm start`.
2. **Supervise the Ubuntu host with systemd** (#74): a unit template that runs
   `npm start`, reads config from `.env`, and restarts on failure/boot.
3. **`PORT` is the single configuration knob** for the listening port, in both
   production and dev (#73).
4. **Keep subscription auth and grok exactly as they are** — host-native, from
   `~/.claude` and `~/.grok`. Document that `ANTHROPIC_API_KEY` must stay unset
   for subscription billing, and that grok is an optional host install.
5. **Do not containerize now.** Record the Docker recipe below so the decision
   can be revisited without re-deriving it.

## Why not Docker
Docker's usual wins here — a consistent Node runtime and a bundled web build —
are real but small, and they don't remove this project's actual setup cost,
which is **two interactive per-host logins that live in `$HOME`**:

- Subscription auth would require mounting `~/.claude` **read-write** (tokens
  refresh) into the container, and still rests on the same undocumented
  SDK-reads-the-CLI-login behavior — now one layer further removed.
- grok would require baking the correct **Linux** binary into the image **and**
  mounting `~/.grok` read-write, with an interactive `grok login` still required
  per host.

So a container keeps every interactive-login step, adds two read-write
credential mounts and a grok-in-image install, and enlarges the maintenance
surface — for a single-user, single-household-LAN app whose canonical home is
one Ubuntu box maintained by a solo developer. The trade isn't worth it now.

## Deferred Docker recipe (if revisited)
If the constraints change (e.g. multi-host, or the SDK gains first-class
container auth), a working container would need:

- **Build deps inside a Linux image** (`npm ci` in the container), so the SDK's
  platform-native `claude` binary is fetched via its `optionalDependencies` —
  never copy a host `node_modules`, whose binary is for the host's OS/arch.
- **Mount `~/.claude` read-write** (subscription login + token refresh), and
  keep `ANTHROPIC_API_KEY` unset. Or switch to `ANTHROPIC_API_KEY` and drop the
  subscription requirement.
- **Install the Linux `grok` binary in the image** and **mount `~/.grok`
  read-write**; run `grok login` once (e.g. via `docker exec`) so the mounted
  volume holds valid auth.
- **Mount `campaigns/` as a volume** for persistence; ship `reference/srd` and
  `data/seed-tables.json` in the image.
- **Set `HOST=0.0.0.0`** in the container and publish `PORT`.

## Consequences
- Fresh setup on any OS is `npm run setup && npm start`; the Ubuntu host gets a
  supervised, boot-persistent service.
- The subscription-auth dependency is now written down as a **known risk** to
  requirement (1): if a future SDK/CLI update drops OAuth resolution, the
  fallback is `ANTHROPIC_API_KEY` (per-token API billing) — a billing-model
  change, not a code rewrite. Worth watching SDK release notes.
- No container isolation: the engine runs as a host user with access to that
  user's `~/.claude` / `~/.grok`. Acceptable for the single-user LAN posture
  (ADR-0003); revisit alongside that ADR if the trust boundary ever widens.
