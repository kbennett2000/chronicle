# ADR-0004: Setting Reskin as a Narration-Layer Instruction, Not a Content Fork

## Status
Accepted

## Context
Requested: per-character art style (fed to the image-generation prompt)
and an optional per-character world/setting description (medieval, sci-fi,
underwater, Star-Wars-like, etc.), plus room for further customization
dials in the same family.

## Decision
1. **Art style** and **setting description** are stored per-campaign
   (alongside the existing model selection in `campaign-settings.json`),
   not per some new "character" entity — this app's campaign model is
   already one character per campaign.
2. **Setting reskin is a narration-layer instruction, not a fork of the
   seed-table content or the selector/registry logic.** The seed tables
   (quest hooks, NPC roles, locations, etc.) remain genre-neutral
   structural content. When a setting is configured, the DM engine is
   instructed to translate a rolled seed's *flavor* into that setting
   while preserving its underlying structure and 5e mechanics — e.g. a
   rolled "blacksmith" NPC role becomes an "engineer" or "gunsmith" in a
   sci-fi setting, without changing the registry entry logged (the
   registry still tracks the seed, not its reskinned name).
3. **Copyright guardrail, built in from the start:** setting descriptions
   that reference existing copyrighted properties (e.g. "Star Wars") are
   treated as genre/tone inspiration only. The DM engine must invent its
   own original characters, factions, ships, and place names — never
   reproduce actual copyrighted named characters or content. This is a
   system-prompt rule, not a runtime filter. **It must be implemented as a
   clearly labeled, standalone constant/comment block in `dm-engine.ts`
   (e.g. `COPYRIGHT_GUARDRAIL_RULE`), not inlined anonymously into a
   longer prompt string** — Kris needs to be able to find and tighten this
   himself immediately if copyrighted content ever surfaces in play,
   without waiting on a slice cycle.
4. **Tone/whimsy** and **content intensity** are separate sliders in the
   same settings family, reusing existing infrastructure:
   - Tone/whimsy is a UI surface on the existing `wildcard_chance` config
     plus how often `emotional_beats` gets used.
   - Content intensity bounds crude humor (`[funny/crude]` entries) and how
     graphically violence/combat gets described — independent of setting
     or tone, since some players want low-crude/low-gore regardless of
     genre.
5. **Art style** is a freeform string (with common presets offered in the
   UI: comic book, Lego-style, pencil sketch, watercolor, anime, pixel art,
   noir, oil painting) applied to every image-generation prompt built
   from state-file descriptions (§8 of the design doc) — it doesn't change
   what gets generated, only how it looks.

   **Update (issue #104):** the style now *leads* the prompt as its own
   clause (`"<artStyle>. <description>"`) rather than trailing as
   `"<description>, in the style of <artStyle>"`. Image models read
   "in the style of X" as an artist/movement reference, so adjectival render
   styles (photorealistic, watercolor, oil painting) were effectively
   ignored. Leading with the style weights it heavily and honors those
   adjectival styles while still reading acceptably for a named-artist style.
   See `buildImagePrompt` in `src/image-prompt.ts`. Separately, in-turn
   **character** portraits now prepend the character sheet's stored
   `appearance` (issue #71) to the model-authored description so the portrait
   can't drift off the canonical look (`mergeCharacterAppearance` in
   `src/image-generator.ts`).

## Consequences
- No changes needed to `seed-selector.ts` or the registry — this is
  additive at the prompt/instruction layer only.
- The DM engine's system prompt grows another rule set (reskin + copyright
  guardrail + tone + intensity) — worth watching that this doesn't bloat
  past what's actually load-bearing; revisit if it starts crowding out
  other instructions.
- A campaign with no setting configured defaults to standard fantasy —
  this feature is opt-in, not a required step in campaign creation.
