# ADR-0038: Editable full prompt + no-render prompt preview

Status: Accepted
Date: 2026-08-29

## Context

The per-image editor and the in-transcript "↻ Regenerate image" box let a player
retype a scene/entity **caption**, but that caption is only the trailing segment
of the real positive prompt. Before it reaches the model it is wrapped with
material the player never sees or controls: the grounded canonical appearance of
present entities (ADR-0031), the weighted art-style clause (ADR-0028), and — on
the local backend — a LoRA style trigger (ADR-0032). So a caption edit is diluted
by fixed prepended text, and Kris (correctly) sensed "this is NOT all the input
that is used to generate the image." Scriptorium lets you edit the whole prompt;
Kris wants the same control.

(The paired complaint — "if I change all this the image doesn't really change
much" — was primarily the pinned seed, fixed separately in #166: a blank editor
seed now sends a fresh random seed per redraw instead of the deterministic
per-scene seed.)

## Decision

Add, as per-call **editor-driven** inputs (never campaign settings):

1. **A no-render preview** — `preview: boolean` on `GenerateImageOptions` /
   `ImageBackendArgs`. When set, the backend assembles the effective positive
   prompt exactly as it would to render, then returns it as
   `ImageGenResult.previewPrompt` **without** touching ComfyUI / shelling out to
   grok and **without** writing a file. The `/illustrate` route surfaces it (no
   `relPath`, so no transcript/entity record is mutated). Both backends honor
   `preview` so a preview can never accidentally trigger a real generation.

2. **A full positive-prompt override** — `promptOverride?: string`. When set, it
   replaces the assembled positive prompt **verbatim** (skips the art-style clause
   and the LoRA trigger). The style recipe is still resolved, so its LoRA node and
   extra negatives still wire in — only the positive **text** is the user's. The
   negative-prompt pipeline (workflow static + ADR-0028 anti-drift + recipe +
   user) is untouched; the existing negative field still edits the user layer.
   Capped at 1200 chars (SDXL CLIP truncates near 77 tokens anyway; this only
   fences off an absurd paste). On grok the override simply replaces the prose.

## UI

A shared `FullPromptField` component (so the two surfaces never drift) renders an
"Advanced: edit the full prompt" checkbox; on first open it fetches the assembled
prompt via the preview and prefills a textarea, with a "↻ Reload current" button
and a one-line caution that overriding the auto-added character look can make a
character look **less consistent between images** (the ADR-0031 trade-off, made
knowingly). Wired into both the gallery `ImageEditor` (entities) and the
in-transcript regenerate box in `Play.tsx` (moments). The moment box additionally
sends a fresh random seed on each Redraw (the #166 fix, which had only reached the
gallery editor).

## Consequences

- The player can take full manual control of the prompt when they want it, and
  otherwise keeps the grounded/consistent default (the checkbox is off by default).
- Overriding the prompt deliberately bypasses ADR-0031 appearance grounding — a
  documented, opt-in drift risk, surfaced in the UI caution.
- Composes with img2img (ADR-0036) and IP-Adapter likeness (ADR-0037): those
  rewire the sampler's latent/model, orthogonal to the positive-prompt text.
- The preview reflects the current caption but not the editor's other pending
  look overrides (art style, model); taking over the full prompt supersedes the
  art-style picker anyway, so this is acceptable.
