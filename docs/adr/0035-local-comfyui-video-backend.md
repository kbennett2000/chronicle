# ADR-0035: Local ComfyUI video backend (Wan 2.2 5B + LTX-Video 2B)

Status: Accepted
Date: 2026-08-29

## Context

ADR-0034 introduced the `VideoBackend` seam. This ADR is the `local` backend:
self-hosted ComfyUI image-to-video, so a still can be animated on the host GPU
at no cloud cost — the video counterpart to the local image backend (ADR-0027).

The sibling project imagegen-service already does exactly this with ComfyUI's
**native** image-to-video nodes, which is the source of the port.

## Decision

`src/video-backends/local.ts` animates a still on ComfyUI over HTTP, reusing the
same transport shape as the local image backend plus an image upload:
`POST /upload/image` → `POST /prompt` → poll `/history/<id>` → `GET /view` → save
the mp4 into `<campaignDir>/videos/`. Never throws (a clip is best-effort).

Two models, behind a small registry (`src/video-backends/video-models.ts`),
each with a by-node-id renderer over a checked-in API-format template under
`src/workflows/`:

- **`wan-5b`** — Wan 2.2 TI2V 5B (`wan22-ti2v-5b-i2v.json`). Native 1280×704,
  24 fps, 121-frame (4k+1) cap. ~18 GB of model files.
- **`ltxv`** — LTX-Video 2B (`ltxv-i2v.json`). 768×512, 8n+1 length cap. ~11.5 GB.

`DEFAULT_ANIMATE_MODEL = "ltxv"`: on the 12 GB reference host
(comfyui-host-layout), LTX-Video is the realistic default — Wan 5B fp16 (~10 GB
UNet + ~6.7 GB text encoder) swaps hard. Model choice resolves campaign → user →
`config.defaults.videoModel` → `"ltxv"`.

Key decisions:

- **Core ComfyUI nodes only** — no custom node packs (no WanVideoWrapper, no
  VideoHelperSuite). The only host requirement is a recent ComfyUI build. `ffmpeg`
  is *not* needed for `/animate`.
- **Model files are host assets**, fetched by `scripts/fetch-wan22-models.ts` /
  `fetch-ltxv-models.ts` into `~/comfyui/models` (idempotent, resumable). Never
  committed. The backend **preflights hard** via `/object_info`: unlike a LoRA,
  animation can't degrade to prompt-only, so a missing file returns a clear,
  actionable error naming the fetch script.
- **Image-to-video only** — the local backend requires a base still (no
  text-to-video path); a missing/unfound base image is a clean failure.
- Chronicle's coarse `VideoConfig` (duration / 480p·720p / square·16:9·9:16) maps
  to width/height/frames via `videoDims`; the renderers snap dims to /32 and frames
  to each model's lattice and cap at ~5 s, so an over-long duration clamps rather
  than errors. fps is left to each model's native default.
- `GET /video-models` reports per-model readiness so the picker can badge
  "not installed".

## Consequences

- Local clips are minutes, not seconds, and the first job after an image↔video
  switch pays a model-load pause — the poll budget is 20 minutes.
- Scriptorium's `remix-14b` id is intentionally **not** carried over: it was never
  implemented service-side. The shipped second model is `ltxv`.
- A third video model is additive: a template + renderer + a registry entry, the
  same shape as adding an image LoRA style.
