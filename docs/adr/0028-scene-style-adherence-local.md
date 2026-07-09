# ADR-0028: Holding the art style on scene/location images (local backend)

## Status
Accepted

## Context
ADR-0027 shipped the local ComfyUI/SDXL image backend. In play it holds the
configured art style faithfully for **tight subjects** — a CHARACTER portrait or an
NPC comes out on-style (a "Lego-style" campaign gets convincing plastic minifigs).
But **SCENE and LOCATION images drift**: they revert to SDXL's default graphite /
ink-wash / muted-sketch look and ignore the configured style.

The cause is not the style string — it is identical for both paths — but how much
the *subject* resists it. A character prompt ("a weathered dwarf blacksmith") is a
tight subject that pins the composition, so the leading style clause dominates what's
left of the model's freedom. An open scene prompt ("a vast throne room, shafts of
light, banners") is loose: the model has enormous latitude, the single style clause
is diluted across it, and SDXL falls back to its training-prior default aesthetic.
**Same style string, different resistance.** So the scene path needs the style pushed
*harder* — more weight and active steering away from the default — not a different
style.

A secondary, related want surfaced in play: each image uses a fully random SDXL seed,
so a campaign's images read as unrelated one-off rolls rather than one coherent
illustrated world.

Everything here is confined to the **local** backend. The Grok path draws through a
coding agent we cannot weight-tune this way, and the video path (ADR-0026) is out of
scope; both must stay byte-for-byte unchanged, as must their tests.

## Decision

### Branch scene vs. character in the shared prompt builder, behind an optional arg
`buildImagePrompt(description, settings)` (in `src/image-prompt.ts`, reached via
`sanitizeImagePrompt`) is the one prompt authority, called by grok (2 args), video
(2 args) and local. It already **leads** with the style (`"${artStyle}. <desc>"`,
issue #104). We add an **optional third argument** carrying the entity type; only the
local backend passes it, so grok/video/existing tests call with two args and get
**byte-identical output**.

```ts
export interface PromptStyleOpts { entityType?: ImageEntityType; }
buildImagePrompt(description, settings, opts?): string
```

For **scene-class** entities (`location`, `scene`) with a configured style, the style
clause is emphasized with SDXL prompt weighting, still leading:

```
(Lego-style:1.3). a vast throne room, shafts of light, banners
```

For everything else (character / npc / item / boss, or no style, or the two-arg
callers) the output is exactly today's `"${artStyle}. <desc>"`. This is the whole
"split the paths so the scene path gets the stronger treatment without changing the
character path that already works" — one branch, in the one place prompts are built.

### Steer the negative prompt away from the default drift (general, not per-style)
SDXL scenes drift *toward* graphite/monochrome/sketch. For scene-class entities with
a configured style, `sceneStyleNegatives(settings, entityType)` returns a general
anti-drift set — `monochrome, grayscale, graphite, pencil sketch, charcoal, ink wash,
muted colors, desaturated` — which the local backend appends to the workflow's static
negative prompt (node `"7"`). This is deliberately **style-agnostic**: it names the
unwanted default look, not "not-lego".

The one guard: if the configured style is *itself* an intentionally monochrome or
linework style (matched case-insensitively against `noir, sketch, pencil, charcoal,
graphite, ink, monochrome, grayscale, black and white, line art, etching`), the
helper returns `""` — we must never push away from a look the player deliberately
chose. Color-forward presets (Lego, watercolour, pixel art, comic book, oil painting,
anime) get the full push; noir and pencil sketch correctly opt out.

### A stable per-campaign seed lineage
The random seed is replaced with a deterministic derivation, `deriveCampaignSeed(
campaignDir, name)`:

```
base   = fnv1a(campaignId)          // stable anchor for the whole campaign
offset = fnv1a(slug(name)) % 1024   // small per-entity spread
seed   = (base + offset) >>> 0      // uint32, in a 1024-wide band around the anchor
```

`campaignId` is the campaign dir's basename; `fnv1a` is a tiny inline uint32 string
hash (no dependency, no `Math.random`). Every image in a campaign lands in a narrow
seed band anchored to that campaign, so their low-level SDXL noise is correlated —
they read as one illustrated world — while each entity still gets a distinct seed.
Being deterministic, re-illustrating the same entity reproduces its image, a mild
bonus. This applies campaign-wide, including characters; a fixed seed is no worse than
a random one, so the already-good character path is unaffected.

## Alternatives considered
- **Raise the sampler CFG for scenes** instead of weighting the prompt. Rejected:
  CFG pushes the *entire* prompt harder (and raises artifacting/oversaturation), not
  the style specifically; prompt-token weighting targets exactly the style clause.
- **A separate scene-only workflow template.** Rejected as premature — the txt2img
  graph is identical; only the injected positive/negative/seed differ, which the
  backend already sets per call. A second template would duplicate the graph for no
  structural gain.
- **Put the weighting in a local-only prompt builder** rather than an optional arg on
  the shared one. Rejected: it would duplicate the meta-chatter stripping and length
  cap that live in `sanitizeImagePrompt`. An optional arg keeps one prompt authority
  and still leaves grok/video untouched.
- **A single constant per-campaign seed** for maximum coherence. Rejected: identical
  seeds across similar scene prompts risk near-duplicate compositions; the small
  per-entity offset keeps coherence while guaranteeing distinct images.

## Consequences
- Scene/location images on the local backend hold color-forward styles far more
  reliably; verified on the live service across Lego / watercolour / pixel art.
- `src/image-prompt.ts` now knows the entity type (via an optional arg) — the seam the
  local backend branches on. Grok, video, and their tests are unchanged because they
  never pass it.
- Weighting/negative steering are **local-only**; the Grok backend cannot be tuned
  this way and keeps its current behavior.
- Seeds are now deterministic per (campaign, entity). Re-illustration reproduces an
  image rather than rolling a new one — intended, but worth noting if a "reroll"
  affordance is ever wanted (it would vary the offset input).
- The anti-drift negative and its mono-style opt-out are a heuristic keyed on the
  style *string*; an exotic monochrome style not covered by the hint set could still
  be fought. The hint set is easy to extend and the risk is cosmetic (a color push on
  a style that wanted none), never a failure.
