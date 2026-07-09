# ADR-0032: LoRA-backed art-style recipes (local backend)

## Status
Accepted. Builds on ADR-0027 (pluggable image backend), ADR-0028 (scene-style
adherence + per-campaign seed), ADR-0029 (quality tiers / refiner), and ADR-0031
(scene entity grounding). Grok backend, the portrait path, and grounding are
untouched.

## Context
On the local ComfyUI/SDXL backend an art style is currently a **prompt clause
only**: `buildImagePrompt` leads the positive prompt with `settings.artStyle`
(issue #104), and ADR-0028 adds SDXL weighting + anti-drift negatives for scenes.
That reliably reaches styles SDXL already knows how to render — "Lego-style",
"watercolour", "photorealistic". But some looks need model *weights*, not words:
true low-resolution **pixel art** with hard aliased edges, or the impasto brush
texture of an **oil painting**. No prompt clause pulls base SDXL there; the result
is "a painting of X" rather than an image that *is* a pixel/oil rendering.

ComfyUI already supports this via **LoRA** files (small fine-tune weight deltas)
loaded with a `LoraLoader` node between the checkpoint and the sampler. The local
backend loads a checked-in SDXL txt2img graph (`src/workflows/sdxl-txt2img.json`)
and a refiner variant for `quality=high` (`sdxl-refiner.json`, ADR-0029), injecting
prompt/seed/negatives into the cloned graph per call. We want a style to *also* be
able to load a specialized LoRA, additively, at the same seam — without disturbing
the many styles that are prompt-only today, the grok backend, or the portrait /
grounding paths.

This slice ships the **mechanism** and proves it on exactly **two** styles; a
follow-up slice adds more recipes and the preset-button UI.

## Decision

### A style-recipe map, keyed on the configured style
`src/image-backends/style-loras.ts` exports `STYLE_LORAS`, a map keyed on the
**normalized** (`trim().toLowerCase()`) `settings.artStyle` → a recipe:

```ts
interface StyleLora {
  loraFile: string;         // filename in ComfyUI's models/loras/, .safetensors
  trigger: string;          // token ensured present in the positive prompt
  strength: number;         // applied to both strength_model and strength_clip
  noRefiner?: boolean;      // skip the base→refiner pass under quality=high
  extraNegatives?: string;  // Slice 2: per-style extra negative-prompt terms
}
```

A style with **no entry** — free-text, or any of the existing prompt-only presets
— keeps today's behavior **exactly**. `lookupStyleLora(artStyle?)` returns the
recipe or `undefined`. This slice ships two entries:

| artStyle | loraFile | trigger | strength | noRefiner |
|---|---|---|---|---|
| `pixel art` | `pixel-art-xl.safetensors` (Pixel Art XL, NeriJS) | `pixel art` | 1.0 | yes |
| `oil painting` | `ClassipeintXL2.1.safetensors` (ClassipeintXL v2.1, EldritchAdam) | `oil painting` | 0.8 | yes |

Both are base **SDXL 1.0** `.safetensors`, verified before wiring, and live in
`~/comfyui/models/loras/` as **host assets** — not committed, exactly like the
refiner checkpoint in ADR-0029 (real assets are out of git, ADR-0005). The ADR is
their provenance record.

### Amendment — Slice 2 (#138): full preset roster + per-style negatives + new presets
Slice 2 extends the recipe map to the rest of the shipping presets and adds six new
selectable presets, reusing the identical mechanism. Two small additions:

- **`extraNegatives?` on `StyleLora`** — optional per-style negative-prompt terms,
  appended to the negative CLIP nodes (`"7"`/`"13"`) via the same `appendNodeText` path
  the ADR-0028 anti-drift negatives already use, but only when that style's recipe is
  active. Used by `comic book` (`book, magazine`) to suppress the source LoRA's tendency
  to draw comic-book *covers* with cover text. This is the only backend change; the
  runtime injection, trigger, `/object_info` gate, and `noRefiner` handling are unchanged.
- **New presets need no server change.** `settings.artStyle` is free-form (typeof-checked
  only, no allow-list), so a new preset is purely a `web/…/LookControls.tsx` `ART_PRESETS`
  addition; the free-text escape hatch is preserved. A `PRESET_LABELS` map provides
  display-only names (e.g. stored `3d` shown as "3D / Pixar").

**Every LoRA style is `noRefiner: true`, on purpose** (kept as an invariant-tested rule,
not a temporary limit). The SDXL refiner's sole job is fine *photoreal* detail; every
LoRA style we ship is a deliberately non-photoreal look (pixel art, oil, comic, lego,
anime, sketch, watercolour, storybook, pixar/3d, cyberpunk, ukiyo-e, claymation), which
the refiner would fight rather than improve. So at `quality=high` a LoRA style renders as
a base high-steps pass with the LoRA — the ADR-0028 style clause/negatives and per-campaign
seed still apply. Refiner-chain LoRA injection (a 2nd `LoraLoader` off node 11) remains a
**future item**, worth adding only if a photoreal LoRA style is ever introduced.

Full Slice-2 roster (all base SDXL 1.0, all `noRefiner: true`; final strengths may be
lowered from these starting points during grounding-coexistence tuning):

Sources: gating on CivitAI is per-creator, so where the brief's specific model was
login-gated, an equivalent **ungated** base-SDXL LoRA (different creator, or a Hugging Face
mirror) was used and verified (safetensors header, 2048-dim SDXL cross-attention, tens–hundreds
of MB). Final roster as installed:

| artStyle | loraFile (host) | trigger | strength | source |
|---|---|---|---|---|
| `comic book` | `EldritchComicsXL1.2.safetensors` | `comic book` | 0.9 | Eldritch Comics XL (EldritchAdam), CivitAI 305491; `extraNegatives: "book, magazine"` |
| `lego-style` | `Lego_XL_v2.1.safetensors` | `LEGO MiniFig` | 0.8 | LeLo LEGO XL v2.1 (lordjia), CivitAI 318915; key normalizes from preset `Lego-style` |
| `pencil sketch` | `sketch_style.safetensors` | `sketch` | 1.0 | Caith's Sketch XL, CivitAI 254554 |
| `watercolour` | `watercolor-orie-xl.safetensors` | `watercolor style` | 1.0 | Watercolor (orie) SDXL, CivitAI 332971 |
| `anime` | `animelora-sdxl.safetensors` | `anime` | 0.9 | Anime LoRA SDXL, HF `Muapi/animelora-sdxl` |
| `storybook` | `StoryBookRedmond-KidsRedmAF.safetensors` | `KidsRedmAF` | 1.0 | StorybookRedmond (artificialguybr), CivitAI 145304 |
| `3d` | `PixarXL.safetensors` | `pixar style` | 1.0 | Pixar Style SDXL, CivitAI 211735; shown "3D / Pixar" |
| `cyberpunk` | `cyberpunk_xl_v1.safetensors` | `cyberpunk` | 0.8 | Cyberpunk Sci-Fi XL, CivitAI 149348 |
| `ukiyo-e` | `Ukiyo-e-Art-XL.safetensors` | `Ukiyo-e Art` | 0.8 | Ukiyo-e Art SDXL, CivitAI 154278 |
| `claymation` | `CLAYMATE-v2-sdxl.safetensors` | `claymation` | 1.0 | CLAYMATE v2 SDXL, HF `Muapi/claymate-claymation-style-for-sdxl` |
| `ghibli` | — | — | — | new preset; no reliable ungated **SDXL** Ghibli LoRA (candidate CivitAI 128832 is SD 1.5) → **prompt-only** |

`noir` stays prompt-only (no reliable base-SDXL LoRA) — no recipe. `ghibli` ships as a
prompt-only preset. Any style whose file couldn't be obtained from an ungated SDXL source is
left prompt-only and flagged rather than blocking the slice. Final strengths above may have been
lowered from starting points during grounding-coexistence tuning; the PR/report records changes.

### Runtime graph injection, not a baked template node
When (and only when) a recipe matches, the backend inserts a `LoraLoader` node into
the **cloned** graph and repoints edges:

```
node "20" = LoraLoader { lora_name, strength_model, strength_clip, model:["4",0], clip:["4",1] }
node "6".clip  → ["20", 1]   // positive CLIPTextEncode
node "7".clip  → ["20", 1]   // negative CLIPTextEncode
node "3".model → ["20", 0]   // KSampler
```

`["4",0]`/`["4",1]` are the checkpoint loader's only model/clip consumers (the VAE
comes from a separate `VAELoader`, node 10), so those three rewires are the complete
set. When there is **no recipe** the graph is submitted exactly as today — so
"unmapped = byte-identical" and "no LoRA node when unmapped" hold trivially, with no
second template to maintain and no risk to the existing ADR-0028/0029 graph tests.
The checked-in JSON templates are **not edited**. (The alternative — baking a
strength-0 `LoraLoader` into the templates and bypassing it — was rejected: it would
still change the submitted JSON for every unmapped generation and complicate the
byte-identical guarantee for no gain.)

### noRefiner recipes, and why any recipe forces the base workflow this slice
Both proof styles are "no refiner" looks: the SDXL refiner's job is fine
photo-real detail, which actively *fights* aliased pixel art and painterly
brushwork. `noRefiner` says "under `quality=high`, don't run the base→refiner
ensemble."

More strongly: this slice only wires the LoRA into the **base chain** (nodes
4/6/7/3). The refiner graph has a *separate* model chain (refiner checkpoint node
11 → encoders 12/13 → sampler 14) that we do **not** LoRA-wire yet. So if a recipe
ran on the refiner workflow, the LoRA would apply to the base pass only and be
silently dropped by the refiner pass — a half-application. To make that impossible,
`resolveEffectiveTier(quality, recipe)` swaps to a **base high-steps tier**
(`sdxl-txt2img.json`, 40 steps, 300 s budget) whenever *any* recipe is active, not
only for `noRefiner` ones. Invariant: **recipe active ⇒ base workflow ⇒ the LoRA
fully applies.** A future non-`noRefiner` recipe additionally logs a warning that
refiner-aware LoRA injection isn't implemented. That refiner-aware injection (a
second `LoraLoader` off node 11) is a deliberate deferral.

### The trigger word rides the existing prompt, after the cap
Many style LoRAs are trained with a trigger token. After `sanitizeImagePrompt`
builds the prompt, if the recipe's `trigger` isn't already a case-insensitive
substring, the backend prepends `"${trigger}. "`. This happens **after** the
500-char sanitize cap (which the style clause already sits outside of, issue #104),
so it only lengthens the string and never eats into the grounding budget that
ADR-0031 prepends *before* the cap — a grounded character stays on-model. For the
two proof styles `trigger === artStyle`, so the leading style clause already
contains it and nothing is duplicated; the LoRA node itself is what applies the
look. The field exists for future styles whose LoRA needs a distinct rare token.

### Availability is checked against ComfyUI, and failure is prompt-only
The backend talks to ComfyUI over HTTP and ComfyUI may run on a **different host**
(`COMFYUI_URL`), so a local `fs.existsSync` on `models/loras/` would check the wrong
filesystem. Instead the backend asks ComfyUI what it can actually load: `GET
/object_info/LoraLoader`, and confirms `recipe.loraFile` is in that node's
`lora_name` enum. A missing file, a non-200, or any thrown error → log + **fall
back to prompt-only** and still generate. The whole LoRA path (lookup → tier swap →
availability → trigger → inject) is wrapped in its **own inner try/catch**, so it
can never reach the backend's outer catch, which would *fail the image*. This
preserves the ADR-0027 contract: an image is best-effort and never blocks a DM turn.
The extra `/object_info` round-trip happens only when a recipe matched (never for
prompt-only styles) and is a cheap localhost call.

### Everything else is unchanged
`ImageBackendArgs`, the `generateImage` dispatcher, `buildImagePrompt`,
`sceneStyleNegatives`, `deriveCampaignSeed`, the grok backend, the video path, the
portrait `mergeCharacterAppearance` path, and scene grounding are all untouched. The
recipe is resolved *inside* the local backend from `settings.artStyle`, already in
scope; no new field is threaded through any interface, and `generateLocalImage`
keeps its `(args, fetchFn)` signature — the availability check reuses the existing
injected `fetchFn`, so tests drive it with the same stub.

## Alternatives considered
- **Bake a bypassed LoRA node into the checked-in templates.** Rejected: it alters
  the submitted graph for every unmapped generation, weakening the byte-identical
  guarantee, and adds a second thing to keep in sync across both templates.
- **Local `fs.existsSync` availability check.** Rejected: wrong filesystem when
  ComfyUI is remote; would skip a LoRA the GPU host actually has, or "confirm" one it
  can't see. The `/object_info` query is the GPU host's own view.
- **Let ComfyUI reject an unknown LoRA (node_errors).** Rejected as the *primary*
  path: `node_errors` maps to `{ ok:false }` — a **failed image**, not the required
  prompt-only fallback. The pre-flight `/object_info` check turns "not downloaded
  yet" into a graceful degrade instead.
- **Refiner-aware LoRA injection now.** Deferred: a second `LoraLoader` off the
  refiner checkpoint is only needed once a non-`noRefiner` LoRA style exists, and the
  "any recipe ⇒ base workflow" rule makes the half-application impossible until then.
- **Per-channel strengths (`strength_model` ≠ `strength_clip`).** Deferred as tuning;
  a single `strength` is the standard default and enough to prove the mechanism.

## Consequences
- A style can now change SDXL's *weights*, not just its prompt, on the local backend
  — reaching looks (pixel art, oil paint) a clause alone can't. Proven on two styles;
  more recipes + preset buttons are a follow-up slice.
- Two host-dependency LoRA files join the refiner checkpoint as documented, uncommitted
  provisioning under `~/comfyui/models/loras/`.
- `quality=high` on a LoRA style renders as a base high-steps pass, not base→refiner —
  a deliberate quality/style trade recorded here; the seed and ADR-0028 style clause /
  negatives still apply, so it stays coherent with the campaign's other images.
- The refiner chain is not LoRA-aware yet; the "any recipe ⇒ base workflow" guard keeps
  that safe, and a future slice can add a refiner `LoraLoader` without reshaping this.
- Grok, video, portrait, and grounding paths and all their tests are byte-for-byte
  unchanged.
