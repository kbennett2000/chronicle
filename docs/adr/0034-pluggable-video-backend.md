# ADR-0034: Pluggable video-generation backend (Grok Imagine + local ComfyUI)

Status: Accepted
Date: 2026-08-29

## Context

On-demand video (ADR-0026) shells out to the Grok Build CLI's `/imagine-video`.
It is the only video path and is hardwired: `generateVideo` in
`src/video-generator.ts` contains a single `execFile("grok", …)` site with no
provider abstraction — unlike images, which since ADR-0027 sit behind a
pluggable `ImageBackend` seam (`src/image-backends/`) with a `grok` and a
`local` (self-hosted ComfyUI) implementation.

Kris wants to animate stills on **local** models too (no cloud cost), the way
the sibling project imagegen-service already does with ComfyUI's native
image-to-video nodes (Wan 2.2 TI2V 5B and LTX-Video 2B). That needs the same
kind of seam images already have.

## Decision

Introduce a `VideoBackend` seam mirroring `ImageBackend` exactly, so every video
path stays provider-agnostic below one dispatch.

- **`src/video-backends/types.ts`** — `VideoProvider = "grok" | "local"`,
  `VideoBackendArgs`, `VideoGenResult`, and the `VideoBackend` interface
  (`generate(args)` NEVER throws — a clip is best-effort, like an image).
- **`src/video-backends/grok.ts`** — the existing `/imagine-video` logic moved
  verbatim (same isolated-tempdir + `--deny` cage from #60, same salvage scan).
- **`src/video-backends/local.ts`** — a ComfyUI image-to-video backend (see
  ADR-0035): upload the still, submit a Wan/LTXV graph, poll, save the mp4.
- **`src/video-backends/index.ts`** — `getVideoBackend(provider)` (a call-time
  switch, grok fallback — same TDZ-safety reasoning as `getImageBackend`) plus
  `resolveVideoProvider` / `resolveVideoProviderForCampaign`, field-by-field
  precedence: campaign override → user default → `config.defaults.videoProvider`
  → code default `"grok"`.
- `generateVideo` becomes a thin dispatcher: resolve the provider, delegate to
  the backend. Its signature and every call site are unchanged.

A new `videoProvider` setting is added at all three levels
(`config.defaults.videoProvider`, user settings, `CampaignSettings.videoProvider`),
freely switchable mid-campaign like `imageProvider` — it only affects the NEXT
clip, so there is no session reset.

## Consequences

- Grok behavior is byte-identical to before: with `videoProvider` absent/`"grok"`
  the dispatcher resolves to the grok backend running the moved-verbatim code.
  This ADR's slice ships grok-only; the local backend lands in ADR-0035.
- Video now has the same two-level override + live-resolution model as images
  and music, so the settings UI and the resolvers read the same way.
- Local video is heavier than local images (minutes, model-load pauses,
  ~12–18 GB of model files) — those trade-offs and the ComfyUI contract are
  ADR-0035's concern, kept out of the seam.
