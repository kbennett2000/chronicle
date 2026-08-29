# ADR-0036: img2img "change amount" (local backend)

Status: Accepted
Date: 2026-08-29

## Context

The per-image editor (ADR/Slice C) can redraw an image with a tweaked
prompt/style/seed/model, but every redraw is a fresh txt2img — it can't produce
a *variation of the current image* that keeps its composition. Scriptorium's Edit
picture exposes a "change amount" (ComfyUI denoise / img2img strength) that does
exactly that. Kris wants parity.

## Decision

Add img2img to the local ComfyUI backend as a per-call, editor-driven override —
NOT a campaign setting. Ported verbatim from imagegen-service (their ADR-0005).

- `generateImage(…, opts)` gains `GenerateImageOptions` with `initImageAbsPath` +
  `denoise`. The `/illustrate` route parses `initImageRelPath` (campaign-relative,
  path-guarded to absolute via `resolveCampaignImageAbs` — the same basename-only,
  must-exist-under-`images/` guard as `/animate`'s `safeBaseImage`) and `denoise`
  (validated to `(0,1]`), and passes them through.
- `applyImg2Img(graph, imageName, denoise)` in `src/image-backends/local.ts`: add
  `LoadImage` node `"30"` + `VAEEncode` node `"31"` (reusing the template's own
  `VAELoader "10"`), repoint the base sampler `"3"` `latent_image` to `["31",0]`,
  and set its `denoise`. The still is uploaded to ComfyUI via `/upload/image`.
- Default `denoise` 0.65; the editor slider offers 0.2–0.9. Lower = closer to the
  input.
- **Base chain only:** like a LoRA recipe, img2img forces the base workflow when
  the resolved tier is the refiner (the refiner graph has a different shape).
- **Fails cleanly, does NOT degrade:** a failed init-image upload returns
  `{ ok:false, error }` — the init image is the whole point of img2img.
- Output size follows the init image (which is a Chronicle 1024² still), so the
  ignored `EmptyLatentImage` dimensions don't matter.

## Consequences

- Composes with IP-Adapter (ADR-0037): img2img rewires the sampler's
  `latent_image`, IP-Adapter its `model` — orthogonal inputs.
- The init image is always an existing campaign image (the one being edited), so
  no new upload/storage surface beyond ComfyUI's transient input dir.
- Grok ignores `denoise`/init image (local-only concept).
