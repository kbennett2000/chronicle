# ADR-0029: Per-tier image quality (fast / standard / high) — local backend

## Status
Accepted

## Context
ADR-0027 stood up the local ComfyUI/SDXL backend; ADR-0028 made scenes hold their
art style. Both draw at a fixed 1024×1024 with a fixed 25-step `euler`/`normal`
sample. That is a single quality point: fine for most turns, but there is no way to
say "spend more time on this image" — nor to say "don't bother, I'm iterating."

The lever we want is **time for quality at a fixed resolution** — "more intelligence
when generating," not more pixels. On the reference RTX 5070 an SDXL image is ~7.5s
warm; the operator is happy to wait longer for a hero image, and happy to trade a
little fidelity for speed while iterating. Resolution is deliberately held constant:
larger canvases change composition and cost VRAM non-linearly, and the existing
1024×1024 is already the SDXL sweet spot. What changes is **sampling effort** and,
at the top tier, **a second model**.

This is a natural sibling to the two-level settings already in place. `imageProvider`
(ADR-0027), `music` (ADR-0020) and `video` (ADR-0026) all resolve a field
**campaign override → user default → `.env` → code default**, live, at read time —
freely switchable with no create-time seed. A quality tier has exactly that shape and
exactly that "affects only the next image, no session state" property.

**Scope is the local backend only.** Grok's `/imagine` has no step/sampler knobs we
control, so the tier does not apply to it — grok generation, its safety cage, and its
tests are untouched.

## Decision

### `imageQuality: "fast" | "standard" | "high"`, resolved like `imageProvider`
A new flat enum on `CampaignSettings`, resolved by `resolveImageQuality`
(`src/image-backends/index.ts`) with the identical precedence and live-resolution as
`resolveImageProvider`: **campaign → user → `.env DEFAULT_IMAGE_QUALITY` → code
default `"standard"`**. `resolveImageQualityForCampaign(campaignDir, settings)`
recovers the owning user from the `campaigns/<userId>/<campaignId>` nesting
(ADR-0019), exactly as the provider wrapper does, because the seam fires mid-turn
inside the MCP tool where only `campaignDir` is in scope.

Code default `"standard"` makes the whole feature a **no-op for every existing game
and account**: an unset tier resolves to standard, which is byte-for-byte today's
generation. It is **excluded from the create-time seed** (like `imageProvider`,
`music`, `video`) and NOT added to `newUserDefaultSettings` — it live-tracks the
account default until explicitly overridden. It is **freely switchable mid-campaign**;
flipping it only changes how the *next* image is drawn. The dispatcher
(`generateImage`) resolves the tier beside the provider and passes it to the backend
via a new optional `ImageBackendArgs.imageQuality`; grok never reads the field.

### What each tier does (local SDXL, resolution fixed at 1024×1024)

| tier | workflow | steps / sampler | second pass | timeout |
|---|---|---|---|---|
| `fast` | `sdxl-txt2img.json` | 15, `euler`/`normal` | — | 120s |
| `standard` | `sdxl-txt2img.json` | 25, `euler`/`normal` — **today, unchanged** | — | 120s |
| `high` | `sdxl-refiner.json` | 40 total, `dpmpp_2m`/`karras` | **SDXL refiner** | 300s |

`standard` loads the same template and (re)sets `steps = 25` — the value already in
the template — so the submitted graph is identical to pre-0029. `fast` only lowers
the step count on the same base graph. `high` runs the SDXL **base→refiner
"ensemble of expert denoisers"**: the base model denoises steps 0→~32 of 40 and
hands the still-noisy latent to the refiner model, which finishes ~32→40. The refiner
is trained on the low-noise final steps and adds fine detail/coherence the base model
alone smears. `high` also switches to `dpmpp_2m`/`karras`, a higher-quality
sampler/scheduler that suits the longer schedule.

All of ADR-0028's style work — the weighted style clause, the anti-drift negatives,
and the per-campaign seed lineage — **applies unchanged at every tier**. Quality is
orthogonal to style: the refiner's own CLIP-encode nodes receive the same positive
and negative text, and both samplers receive the same derived seed, so a `high`
render of an entity is the same image as its `standard` render, only more refined.

### Tier-aware timeout
The flat ~120s cap (ADR-0027) assumed one ~7.5s pass with headroom for a cold load or
busy queue. `high` adds a second model load (see VRAM below) plus more steps, so its
budget is raised to **300s**. The cap stays a real ceiling — a hung job still fails
gracefully and the turn keeps narrating — it is just tier-dependent. The per-HTTP-call
`REQUEST_TIMEOUT_MS` (30s) is unchanged: generation is asynchronous and polled, so no
single HTTP request runs longer regardless of tier.

### The refiner checkpoint is a documented host dependency
`high` needs `sd_xl_refiner_1.0.safetensors` in ComfyUI's `models/checkpoints/`
(the directory already holding `sd_xl_base_1.0.safetensors`). As with the base model
in Slice 0, this is host provisioning, obtained from Hugging Face
`stabilityai/stable-diffusion-xl-refiner-1.0`:

```
curl -L -o <comfyui>/models/checkpoints/sd_xl_refiner_1.0.safetensors \
  https://huggingface.co/stabilityai/stable-diffusion-xl-refiner-1.0/resolve/main/sd_xl_refiner_1.0.safetensors
```

If the checkpoint is absent, ComfyUI's `/prompt` rejects the `high` graph with
`node_errors`, which `local.ts` already surfaces as `{ ok: false }` — the DM turn
keeps narrating with no image, never a crash. So the dependency is a soft one: `fast`
and `standard` are unaffected, and only `high` degrades (to no-image) on a host that
hasn't installed the refiner.

### VRAM: base and refiner do not co-reside — ComfyUI swaps
Base SDXL alone peaks at ~10.9GB of the ~11.5GB usable on the 12GB 5070, so base +
refiner cannot be resident together. ComfyUI's model manager unloads the base model
to load the refiner between the two passes. This is the accepted cost of `high` — the
whole point is that the user opted into waiting. Live validation on the 5070 (same
1024×1024 Lego-style throne-room scene, same seed at every tier) confirmed the
two-model graph **completes without OOM** — the model swap keeps peak VRAM in line
with a single-model pass:

| tier | time | peak VRAM |
|---|---|---|
| fast (15 steps) | 5.0s | 11186 MiB |
| standard (25 steps) | 7.6s | 11192 MiB |
| high (base+refiner, ~40 steps) | 13.7s | 11615 MiB |

`high` peaks only ~0.4GB above `standard` — proof the base and refiner do **not**
co-reside; ComfyUI swaps them, trading time (the base→refiner reload) for the extra
detail. All three held the configured style with no graphite drift; `high` produced
visibly cleaner surfaces and minifig detail. Had the naive graph OOM'd, the fallback
was ComfyUI's sequential/low-VRAM offload; it was not needed.

## Alternatives considered
- **Scale resolution instead of effort.** Rejected: the request is explicitly "more
  intelligence, not more pixels." Higher resolution changes composition, risks SDXL's
  known >1024 artifacts, and blows VRAM non-linearly — a different feature.
- **One workflow with a runtime `steps`/refiner flag instead of a second template.**
  Rejected: the refiner graph has a genuinely different topology (two checkpoints, two
  sampler nodes, `KSamplerAdvanced` with a base/refiner step split). A checked-in
  `sdxl-refiner.json` is clearer and diffable than assembling that graph in code, and
  keeps `standard`'s template provably untouched.
- **A single higher step count for everyone (no tiers).** Rejected: it would silently
  slow every existing game and still not deliver the refiner's detail. Tiers keep
  `standard` a strict no-op and make the cost opt-in.
- **A fourth "ultra" tier (refiner + upscale).** Deferred: an upscaler pass is a
  separate lever (it *does* change pixels) and can be added later without disturbing
  this three-tier shape.
- **Copy-on-create seed the tier onto new users** (like `generateImages`). Rejected:
  it belongs with the live-resolved family (`imageProvider`/`music`/`video`), so a
  changed `.env` default reaches existing accounts and there's one resolution story.

## Consequences
- Players get a per-game (and per-account-default) quality dial with no migration:
  every existing game resolves to `standard` = today's exact output.
- The local backend now selects one of two checked-in workflow templates and a
  tier-aware timeout; the prompt/seed injection is generalized to write both the base
  and (when present) the refiner nodes, so ADR-0028's style guarantees hold at every
  tier.
- `high` introduces a soft host dependency (the refiner checkpoint) and a slower,
  model-swapping generation; it degrades to no-image, never a crash, if unmet.
- Grok is entirely unaffected — the tier is a local-only concept and grok ignores the
  new arg.
- The three-tier shape leaves room for a later upscale-based tier without reshaping
  the setting.
