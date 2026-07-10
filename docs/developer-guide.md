# Developer & Architecture Guide

This page is for developers and technically curious readers who want to
understand how Chronicle works, run it in development, or build on it. If you
just want to *play*, you don't need any of this — start with the
[User Guide](user-guide/index.md).

---

## What Chronicle is

Chronicle is a **mobile-first solo D&D 5e app**. A Claude Agent SDK–powered DM
engine runs each campaign with **persistent, file-backed state** (not just
conversation history), which is the core bet: the two failure modes of existing
AI-DM apps are **state drift** and **content repetition**, and both are fixed by
giving the DM real memory (files on disk) plus seed-table-driven novelty
constraints — not by tuning the model's personality.

The fullest treatment lives in
[`docs/design/chronicle-design-doc.md`](design/chronicle-design-doc.md).
Architecturally significant decisions are recorded as ADRs in
[`docs/adr/`](adr/), numbered sequentially — start with
[`0001-core-architecture.md`](adr/0001-core-architecture.md).

---

## Architecture at a glance

Two **decoupled services** that communicate only through campaign state files on
disk — never directly:

```
        Phone / tablet (browser)
                  │  HTTP (LAN, no HTTPS — single household)
                  ▼
   ┌─────────────────────────────────┐
   │  Node HTTP server (src/server.ts)│  ← serves the built UI *and* the API
   │                                  │     from one origin
   │   ┌──────────────────────────┐   │
   │   │  DM engine (per campaign)│   │   Claude Agent SDK  (default)
   │   │  src/dm-engine.ts        │───┼──▶  or Grok CLI      (per-campaign)
   │   └──────────────────────────┘   │
   └───────────────┬─────────────────┘
                   │ reads/writes plain files
                   ▼
   campaigns/<user>/<campaign>/   ← character-sheet.json, world-state.md,
       character-sheet.json          npc-roster.md, quest-log.md,
       world-state.md                content-registry.md, session-log/
       npc-roster.md                 images/*.jpg
       ...
                   ▲
                   │ reads state, writes images + video (decoupled)
   ┌───────────────┴─────────────────┐
   │  Asset worker — pluggable        │  scene art + portraits (Grok Build `grok`
   │  image backend (Grok | ComfyUI)  │  CLI, or local ComfyUI/SDXL on your GPU);
   │  + on-demand video (Grok Imagine)│  optional "Animate" clips; off by default
   │  src/image-backends/, video-*.ts │
   └─────────────────────────────────┘
```

- The **DM engine** narrates, adjudicates 5e rules, and updates the campaign's
  state files every turn. It is a **pluggable backend** (ADR-0018): Claude
  Agent SDK by default, or the headless Grok CLI, chosen *per campaign*.
- The **asset worker** generates images through a **pluggable image backend**
  (ADR-0027): the Grok Build `grok` CLI (default, zero-infra) or a **local
  ComfyUI/SDXL** engine on the host's GPU (no per-image cost). Short **video
  clips** are produced on demand via Grok Imagine ("Animate", ADR-0026). It only
  ever reads state and writes media files — the two services never call each
  other, so an asset failure can't break a turn (design §2).
- **Persistent state** is the anti-drift layer (design §3): plain JSON/Markdown
  per campaign. Anti-repetition seed tables live in
  [`data/seed-tables.json`](../data/seed-tables.json) (design §4).

---

## Services & dependencies it relies on

| Concern | What it uses | Notes |
|---|---|---|
| DM reasoning | **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) | Default engine. Uses the host's **Claude subscription** login under `~/.claude` (leave `ANTHROPIC_API_KEY` unset). See ADR-0017. |
| Alternate DM | **Grok** headless CLI | Per-campaign engine choice (ADR-0018). |
| Images | **Pluggable backend** — Grok Build `grok` CLI **or** local ComfyUI/SDXL | Provider chosen per-campaign, live-switchable (ADR-0027). Grok is the zero-infra default (auth under `~/.grok` / `XAI_API_KEY`); the local backend draws on the host's GPU with no per-image cost. Optional (ADR-0009). |
| Local inference | **ComfyUI** + SDXL checkpoints | `comfyui.url` in config.json (default `http://localhost:8188`). Per-tier quality (fast/standard/high, ADR-0029), scene-style adherence (ADR-0028), and LoRA-backed art styles (ADR-0032). Checked-in graphs in `src/workflows/*.json`. |
| Video (optional) | **Grok Imagine** `grok` CLI `/imagine-video` | On-demand "Animate" clips, never auto-generated (ADR-0026); served from `/campaigns/:id/videos/`. |
| Rules grounding | **SRD text** in [`reference/srd/`](../reference/srd/) | SRD-grounded adjudication (ADR-0006). |
| Music (optional) | Local files **or** a LAN **Navidrome** server | Proxied server-side so the browser never sees Navidrome creds (ADR-0020). |
| Tool calls | **MCP** (`@modelcontextprotocol/sdk`) | Dice / seed / texture / image tools exposed to the DM (`src/mcp-servers/`). |

Auth posture (ADR-0003): single-household LAN, **no HTTPS**, don't port-forward.
Per-user accounts (ADR-0019) — each person registers in-app and sees only their
own campaigns; sessions live under a gitignored `users/`.

---

## Tech stack

- **TypeScript / Node (≥22) everywhere** — one language for a solo-maintained
  project. The backend runs via `tsx` with **no build step** (and no
  hot-reload — restart after changing `src/`).
- **Backend** (`src/`): a plain `node:http` server. Key modules: `dm-engine.ts`,
  `dm-backend.ts` + `backends/` (Claude vs Grok), `narration.ts` (strips
  backstage chatter from player-facing prose), `campaign-store.ts`,
  `user-store.ts`, `music-store.ts`, `character-gen.ts`, `dice.ts`,
  `seed-selector.ts` / `texture-selector.ts`. **Media:** `image-generator.ts`
  (thin dispatcher) + `image-backends/` (`grok.ts`, `local.ts`, `style-loras.ts`,
  `index.ts`, `types.ts`), `image-prompt.ts`, `video-generator.ts` /
  `video-store.ts`, and checked-in ComfyUI graphs in `workflows/*.json`. Deps:
  `@anthropic-ai/claude-agent-sdk`, `@modelcontextprotocol/sdk`, `dotenv`, `zod`.
- **Frontend** (`web/`): **React 18 + Vite 6**, TypeScript. No router — a single
  `useState<Screen>` switch in `web/src/App.tsx`. Built into `public/`, which the
  backend serves as its static root, so **API and UI share one origin**.
- **State**: plain files per campaign under `campaigns/<user>/<campaign>/`. Real
  campaign data is out of git (ADR-0005); `test-campaign` and
  `campaigns/_registry/` are tracked exceptions.

---

## Running it in development

Prerequisites and full LAN-hosting steps live in [`SETUP.md`](../SETUP.md). The
short version:

```bash
# one-time: install backend + web deps and build the UI
npm run setup

# copy config (optional — a fresh checkout boots from config.example.json).
# Edit config.json to set server.host / port; put the bootstrap account in
# secrets.json. See docs/configuration.md.
cp config.example.json config.json
cp secrets.example.json secrets.json

# make sure the DM engine can reach Claude (subscription login)
claude            # log in once; leave ANTHROPIC_API_KEY unset

# run the server (serves API + built UI on http://<HOST>:<PORT>, default :4317)
npm start
```

Front-end iteration with hot-reload (proxies `/campaigns` and `/models` to the
backend on `PORT`):

```bash
cd web && npm run dev
```

Useful scripts:

| Command | What it does |
|---|---|
| `npm start` / `npm run serve` | Start the HTTP server (`tsx src/server.ts`). |
| `npm run setup` | Install both packages and build the UI into `public/`. |
| `npm run build:web` | Rebuild just the web UI. |
| `npm run dm` | Headless CLI DM loop (`src/cli.ts`) — the original Slice-1 entry point. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run test:unit` | Backend unit tests. |
| `cd web && npm run test:e2e` | Playwright e2e (mobile + desktop projects). |
| `npm run migrate:multi-user` | One-time migration of pre-multi-user campaigns. |
| `npm run verify:grok-parity` | End-to-end Grok backend parity check on a throwaway campaign. |

Some verification/utility scripts under `scripts/` are **not** wired into
`package.json` — run them directly with `npx tsx scripts/<name>.ts`:
`verify-comfyui.ts` (local ComfyUI reachable + draws a real image),
`verify-lora-styles.ts` (LoRA art-style recipes resolve/load, ADR-0032),
`verify-video-gen.ts` (Grok Imagine clip end-to-end, ADR-0026),
`capture-docs-media.ts` (regenerate the doc screenshots/GIFs), and
`scratch-campaign.ts` (create/delete a disposable throwaway campaign).

For an always-on host, run under **systemd** — see [`deploy/README.md`](../deploy/README.md).

---

## Screens (frontend map)

Top-level screens switch in `web/src/App.tsx`
(`Screen = "home" | "play" | "settings" | "gamesettings" | "newcharacter" | "auth"`):

- **Auth** (`screens/Auth.tsx`) — register / log in, server address.
- **Home** (`screens/Home.tsx`) — chronicle list, continue/switch/delete.
- **New Character** (`screens/NewCharacter.tsx`) — character creation, world/look/engine.
- **Play** (`screens/Play.tsx`) — the core game screen: narration transcript,
  turn input, scene images, music transport, side panels.
- **Game Settings** (`screens/GameSettings.tsx`) — per-campaign look/world/music.
- **Settings** (`screens/Settings.tsx`) — account defaults, connection, logout.

Play-screen panels (`web/src/panels/`): **Self** (`SelfPanel` / `CharacterSheetFull`),
**Folk** (`FolkPanel`), **Quest** (`QuestPanel`), **Views** (`GalleryPanel`).
Desktop vs mobile branches at 900px via `web/src/lib/useIsDesktop.ts` (ADR-0021).

The UI is instrumented with stable `data-testid` hooks used by the e2e suite and
by the documentation media capture script (`scripts/capture-docs-media.ts`).

---

## Building on Chronicle / contributing

Workflow conventions (from [`CLAUDE.md`](../CLAUDE.md)):

- **ADR-first.** Any architecturally significant change gets an ADR in
  [`docs/adr/`](adr/) before or alongside implementation.
- **Vertical slices.** Prefer many small, independently shippable/testable
  cycles over large monolithic ones.
- **Definition of done:** every unit of work traces to a GitHub issue, and each
  slice ends with its own committed + pushed change.
- **Campaign data hygiene:** never run destructive git operations against
  anything under `campaigns/`; ad-hoc validation uses a throwaway scratch
  campaign (`scripts/scratch-campaign.ts`), never `test-campaign` or a real game.

Good places to extend: additional DM backends (`src/backends/`) or image
backends (`src/image-backends/`), new MCP tools (`src/mcp-servers/`), art styles
— both prompt shaping (`src/image-prompt.ts`) and LoRA recipes
(`src/image-backends/style-loras.ts`, ADR-0032), music sources
(`src/music-store.ts`), and the desktop layout (ADR-0021/0022).

Start here: read [`docs/adr/0001-core-architecture.md`](adr/0001-core-architecture.md),
then the design doc, then skim the ADR index for the area you're touching.
