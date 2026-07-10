# ADR-0033: File-based configuration (config.json + secrets.json)

## Status
Accepted. Supersedes the `.env` / `dotenv` configuration convention referenced by
ADR-0003 (localhost-only default), ADR-0019 (per-user accounts + bootstrap user),
ADR-0020 (music / Navidrome), ADR-0027 (pluggable image backend), and ADR-0029
(image quality tiers). Those decisions are unchanged; only *where their knobs come
from* changes.

## Context
Every operational knob in Chronicle was read from `process.env`, loaded from a root
`.env` via the `dotenv` dependency and documented in a `.env.example`. Reads were
scattered across 10+ modules (`server.ts`, `user-store.ts`, `music-store.ts`,
`video-store.ts`, `seed-selector.ts`, `image-backends/*`), each with its own inline
default, and the `.env` had to be loaded *before* any module-scope read (hence the
"side-effecting `import "dotenv/config"` must be first" comment in `server.ts` and
`cli.ts`). There was no single typed source of truth, secrets and non-secrets lived
in the same undocumented file, and the shell environment could silently override
anything.

For a personal LAN app the priority is a **clear, well-documented, safe-by-default
file setup** — not the twelve-factor "config in the environment" model, which buys
container/deploy portability Chronicle doesn't need and pays for it with exactly the
scatter above.

## Decision

### Two files, settings vs secrets
Config lives in two JSON files at the repo root, each with a committed
`*.example.json` sibling:

| File | Git | Contents |
|---|---|---|
| `config.json` | **ignored** | real non-secret settings |
| `config.example.json` | committed | real safe defaults + `_comment*` fields; **also the fallback** when `config.json` is absent |
| `secrets.json` | **ignored** | secrets only (bootstrap + Navidrome credentials) |
| `secrets.example.json` | committed | empty placeholders |

The split is the point: **secrets never enter git** (`.gitignore` covers both real
files), while the non-secret example holds honest defaults and doubles as the runtime
fallback so a fresh checkout runs with zero setup. JSON has no comment syntax, so the
examples self-document via `_comment*` string keys, which the loader ignores.

### One typed, frozen loader — `src/config.ts`
A single module reads both files **once at startup**, deep-merges them over a built-in
`DEFAULTS` object, deep-freezes the result, and exports `config` + `secrets`. Every
consumer imports from here; nothing reads `process.env`. Resolution rules:

- **Missing `config.json`** → fall back to `config.example.json` (so a fresh checkout
  boots).
- **Missing `secrets.json`** → treated as `{}`; features needing a secret degrade
  exactly as an unset env var did before (no Navidrome credentials → music source
  unavailable; no bootstrap password → bootstrap user simply not created). Never
  crashes on missing optional config.
- **Malformed JSON** → logged warning, fall back to defaults/example — never a hard
  crash on a stray comma.

The loader resolves the files from the repo root via `import.meta.url` (like
`CAMPAIGNS_ROOT`), so it is cwd-independent and works identically inside the spawned
stdio MCP subprocesses.

### Per-field settings resolution unchanged except its last fallback
The existing field-by-field resolvers (`resolveMusicConfig`, `resolveVideoConfig`,
`resolveImageProvider`/`Quality`) keep their precedence — **campaign → user → default**
— and only their *final* fallback moves from `process.env.DEFAULT_*` to
`config.defaults.*`. Behavior is identical when the config matches the old `.env`
defaults. To keep these resolvers unit-testable without the ambient singleton, each
takes an optional injected `defaults` argument that defaults to `config.defaults`.

Every current default value is preserved exactly (server 127.0.0.1:4317, comfyui
`http://localhost:8188`, image `grok`/`standard`, video `5`/`480p`/`square`, seed
wildcard `0.175`, etc.). The optional free/enum seed fields with no prior default
(`artStyle`, `worldSetting`, `contentIntensity`, `toneWhimsy`) are represented as
`""`/`null`, and `newUserDefaultSettings()` keeps its validity-gating so those stay
**omitted** from a new user's `settings.json` byte-for-byte as before. Fields with a
concrete default (model, provider, responseLength, autoRollDice, …) are now seeded
explicitly — an **effect-neutral** change, since the downstream code already applied
those same values whenever the field was absent.

### MCP per-turn campaign scoping is runtime IPC via argv, not config
`CHRONICLE_CAMPAIGN_DIR` was never *config* — it is a per-turn value the Grok backend
injects into each stdio MCP subprocess so the subprocess knows which campaign it
serves (ADR-0018). It is therefore **runtime IPC, distinct from file config**, and to
keep `grep -rn "process.env" src/` returning *nothing with no exceptions*, it moves
from the subprocess `env` to a **discrete `args` element** in the per-turn
`.grok/config.toml` (`args = [serverPath, campaignDir]`). `requireCampaignDir()` reads
`process.argv` instead of `process.env`. A discrete array element keeps campaign paths
containing spaces safe.

## Alternatives considered
- **Keep `.env` / `dotenv`.** Rejected: the scatter, load-order fragility, and mixed
  secrets/non-secrets are exactly what this ADR removes; twelve-factor env config buys
  deploy portability a single-host personal app does not need.
- **One combined config file.** Rejected: mixing secrets and non-secrets in one file
  makes it unsafe to ever commit an example of the real thing, and invites accidentally
  committing credentials. The two-file split lets the non-secret example be both honest
  and the fallback.
- **A config library (convict / zod-config / cosmiconfig).** Rejected: no new npm
  dependencies for a job the built-in `JSON.parse` + a small typed loader does cleanly.
- **Leave `CHRONICLE_CAMPAIGN_DIR` as a documented env exception.** Rejected: the goal
  is a *literally* empty `process.env` grep in `src/`, and argv passes the same value
  through the same subprocess-spawn mechanism with no ambient-environment surface.

## Consequences
- Single typed, frozen source of truth; every consumer imports `config`/`secrets`.
- `grep -rn "process.env" src/` is empty; `dotenv` and `.env.example` are removed.
- A fresh `git clone` boots from the committed example files with no setup; enabling
  Navidrome or a non-default bootstrap user is an explicit, documented opt-in in
  `secrets.json`.
- Config load order is no longer fragile: the loader is an ordinary import with no
  "must be first" side-effect requirement.
- Dev/CI scripts that spawned a server on an ephemeral port via `env` now write a
  temporary `config.json` (backed up + restored) instead; ambient `...process.env`
  pass-through to child processes (for PATH / API keys) is unchanged and lives outside
  `src/`.
- User-facing setup is documented in `docs/configuration.md`, linked from the README.
