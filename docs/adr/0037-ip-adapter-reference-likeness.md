# ADR-0037: IP-Adapter reference likeness (local backend)

Status: Accepted
Date: 2026-08-29

## Context

Chronicle grounds a character's look in TEXT (canonical appearance prepended to
the prompt, #104/ADR-0031), but text can't hold a face steady across redraws.
Scriptorium's Edit picture offers "keep the character's face" — IP-Adapter
identity conditioning on a reference portrait. Kris wants it.

## Decision

Add IP-Adapter reference conditioning to the local backend as a per-call,
editor-driven override. Ported verbatim from imagegen-service (their ADR-0007).

- `GenerateImageOptions` gains `referenceImageAbsPath`, `likenessStrength`,
  `likenessStart`. The `/illustrate` route accepts either a campaign-relative
  `referenceImageRelPath` (path-guarded; default: the image being edited) OR an
  uploaded `referencePhoto` (base64/data-URL, written to a temp file cleaned up in
  a `finally`). `likenessStrength` validates to `(0,1.5]`, `likenessStart` to
  `[0,0.5]`.
- `applyIPAdapter(graph, imageName, weight, startAt, faceCrop)` in
  `src/image-backends/local.ts`: inject `LoadImage "21"`, `IPAdapterModelLoader
  "22"` (`ip-adapter-plus-face_sdxl_vit-h.safetensors`), `CLIPVisionLoader "23"`
  (`CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors`), optional `PrepImageForClipVision
  "25"` head-crop, and `IPAdapterAdvanced "24"`; repoint the base sampler `"3"`
  `model` through `"24"`. The adapter's `model` input reads the LoRA node `"20"`
  when a style recipe is active, else the checkpoint `"4"` — so it composes AFTER a
  LoRA. Defaults: `weight` 0.5, `start_at` 0.3, `weight_type "ease in-out"`,
  `embeds_scaling "V only"`.
- **Degrades to prompt-only** (never fails the render) when IP-Adapter isn't
  installed or the reference upload fails — a reference is an enhancement.
  `ipAdapterAvailable` probes `/object_info/IPAdapterModelLoader` and confirms the
  face model is in its combo; the head-crop node is probed separately and omitted
  if absent. Base chain only (forces base workflow at the refiner tier).

## Host dependency

IP-Adapter is an **optional, manually-installed** capability (imagegen-service
doesn't script it either). The host needs the **ComfyUI_IPAdapter_plus** custom
node plus two model files in ComfyUI's dirs:
`models/ipadapter/ip-adapter-plus-face_sdxl_vit-h.safetensors` and
`models/clip_vision/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors` (both from HF
`h94/IP-Adapter`). The reference host already has all three; when absent the
feature simply degrades.

## Consequences

- Composes with img2img (ADR-0036) and LoRA styles (ADR-0032).
- Only `referencePhoto`/the current image is used (single reference); multi-face
  masking is out of scope. `likenessStart` is the crowded-scene relief valve
  (raise it), matching imagegen-service.
- Grok ignores all of it (local-only).
