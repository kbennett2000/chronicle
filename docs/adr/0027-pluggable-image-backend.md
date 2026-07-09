# ADR-0027: Pluggable image-generation backend (Grok + local ComfyUI)

## Status
Accepted

## Context
Chronicle's asset worker is decoupled from the DM engine (ADR-0001) and, until
now, has exactly one implementation: the Grok Build `grok` CLI's `/imagine`,
shelled out headlessly by `generateImage` in `src/image-generator.ts` and reached
on-demand via `/illustrate` (ADR-0009). There is no provider indirection — Grok is
hardwired in.

Slice 0 (issue #120, `docs/adr/`-adjacent spike) stood up **ComfyUI + SDXL** as an
always-on local systemd service on the host's GPU and proved, via
`scripts/verify-comfyui.ts`, that its HTTP API produces a real image end-to-end
(~7.5s per 1024×1024 image). That gives Chronicle a genuine second engine: draw
images locally, on your own GPU, with no per-image cost and no external dependency
— a natural sibling to the Grok path for anyone who has the hardware.

We already have two precedents for exactly the two things this needs:

- **A provider abstraction:** ADR-0018 introduced `DmBackend` — one interface,
  two implementations (Claude, Grok), a single dispatch line so `src/server.ts`
  stays provider-agnostic. Image generation should follow the same shape.
- **Live per-field settings resolution:** music (ADR-0020, `resolveMusicConfig`)
  and video (ADR-0026, `resolveVideoConfig`) both resolve a setting field-by-field
  **campaign override → user default → `.env` → code default**, at read time, so a
  choice can be changed freely without touching create-time state.

## Decision

### An `ImageBackend` interface with two implementations behind one dispatch
Introduce `src/image-backends/` (mirroring `src/backends/` for the DM engine):

```ts
interface ImageBackend {
  readonly provider: ImageProvider;                 // "grok" | "local"
  generate(args: ImageBackendArgs): Promise<ImageGenResult>;   // never throws
}
```

`ImageGenResult` is the **unchanged** `{ ok, relPath?, error? }` contract today's
`generateImage` returns (relPath is `images/<file>` under the campaign dir). Both
backends save into the campaign's own `images/` dir with the identical
`<entityType>-<slug><ext>` filename convention, so every downstream consumer —
`runGenerateImageTool`, both MCP servers, both `/illustrate` branches, the
`recordEntityImage` / `setTranscriptRecordImage` writers, and
`GET /campaigns/:id/images/:filename` — is untouched.

`generateImage(campaignDir, entityType, name, description, settings)` keeps its
signature and becomes a thin dispatcher: resolve the provider, then delegate to the
chosen backend. It is the single choke point every path already funnels through
(the in-turn SDK MCP tool via `createImageMcpServer`, the stdio MCP server in
`src/mcp-servers/image-server.ts`, and both `/illustrate` branches), so **all four
call sites change zero lines.**

- **grok backend** — a verbatim lift of the current logic and its whole safety
  cage (throwaway `mkdtemp` workDir, `--deny` mutators, SIGKILL-on-timeout,
  `~/.grok` session salvage-locate, never-throw). That apparatus exists to cage
  Grok — a full coding agent (issue #60) — and stays, unchanged, for this backend
  only.
- **local backend** — talks to ComfyUI's HTTP API (`POST /prompt`, poll
  `/history/<id>`, `GET /view`), lifting the proven dance from
  `scripts/verify-comfyui.ts`. The SDXL txt2img graph is a checked-in template
  (`src/workflows/sdxl-txt2img.json`) with injectable positive-prompt and seed.
  ComfyUI is an HTTP service, not an agent, so this backend is deliberately
  **simpler** — no temp dir, no sandbox, no `--deny`. It keeps the same failure
  discipline: never throw, cap the wait (~120s, abort), and on any
  unreachable/failed/timed-out call log and return `{ ok: false, error }` so a DM
  turn keeps narrating and `/illustrate` degrades gracefully.

Both backends reuse the provider-agnostic prompt construction (`buildImagePrompt`
in `src/image-prompt.ts`, via `sanitizeImagePrompt`) — it is not duplicated.

### Provider selection is a normal, live-resolved setting
`imageProvider` (`"grok" | "local"`) is resolved field-by-field **campaign
override → user default → `.env` (`DEFAULT_IMAGE_PROVIDER`) → code default
`"grok"`** by `resolveImageProvider`, the same machinery as `resolveMusicConfig` /
`resolveVideoConfig`. Code default `"grok"` preserves today's behavior exactly.
`COMFYUI_URL` (default `http://localhost:8188`) is an env-only service address — a
host-infrastructure fact, never a per-campaign preference.

Contrast ADR-0025's **set-once** DM engine: `provider`/`model` are copied at create
and only change through a session-resetting `POST /session/start`, because a
resumed Agent SDK session is pinned to its engine and switching mid-session would
corrupt resume state. Image provider has **no such state** — there is no session to
resume, and existing image files are never touched. So it is **freely switchable
mid-campaign**; flipping it just changes who draws the *next* image. Like `music`
and `video`, `imageProvider` is therefore *excluded from the create-time seed* and
live-tracks the account default until explicitly overridden per-game.

Because provider selection lives below the route (it fires mid-turn inside the MCP
tool, where only `campaignDir` is in scope — `RunTurnArgs`/`DmBackend` carry no
`userId`, and the stdio MCP server is a separate subprocess with only
`CHRONICLE_CAMPAIGN_DIR`), the resolver assembles its inputs one layer lower than
the music/video routes do: a new `campaignDirUserId(campaignDir)` recovers the
owning user from the `campaigns/<userId>/<campaignId>` nesting (ADR-0019), reads
that user's default, and combines it with the campaign override. This keeps the
provider-neutral DM seam and the stdio subprocess launch untouched — no `userId`
threaded through either.

### Security posture — ComfyUI is unauthenticated on the LAN, by decision
The ComfyUI service binds `0.0.0.0` with **no authentication**, a product-owner
decision consistent with ADR-0003's home-LAN trust model. Chronicle always reaches
it at `localhost` on the same host; player devices never contact ComfyUI directly
(they only ever talk to Chronicle, which owns the images). This is a knowingly
accepted posture for a trusted single-operator home LAN, not an oversight. On an
untrusted network the service should be bound to `127.0.0.1` or firewalled.

## Alternatives considered
- **Thread `userId` through the DM seam** (`RunTurnArgs` → both DM backends →
  `runTurn` → the image MCP tool) plus a new env var for the stdio subprocess.
  Rejected: it pushes an image concern into the provider-neutral `DmBackend`
  interface and touches two transport paths, strictly more invasive than deriving
  the user from `campaignDir` — which the stdio path needs regardless.
- **Convert the interface to `Promise<string | null>`.** Rejected: it would drop
  the `error` string that `/illustrate` and the MCP tool body surface, changing the
  client contract for no gain. `ImageGenResult` is kept verbatim.

## Consequences
- A second asset engine exists with no external dependency or per-image cost, for
  operators with a suitable GPU; Grok remains the default and is behavior-identical.
- `generateImage` is now a dispatcher; the Grok specifics (and the `newestImageUnder`
  salvage helper) move into `src/image-backends/grok.ts` and are re-exported from
  `image-generator.ts` so existing imports/tests are unaffected.
- The undocumented Grok session output layout is still depended on, but now confined
  to the grok backend; the local backend depends instead on ComfyUI's documented
  HTTP API, mocked in tests so the suite needs no GPU and no running ComfyUI.
- ADR-0026's on-demand video path can later adopt this same `*Backend` structure if
  a second video engine is added.
