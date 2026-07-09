# ADR-0031: Ground scene/moment images in known entities' canonical appearance

## Status
Accepted. Builds directly on ADR-0030 (DM-emitted scene caption). Reuses the
same design principle as issue #104's `mergeCharacterAppearance` (the portrait
path), extended from one entity to several.

## Context
Since ADR-0030, scene/moment images are illustrated from the DM-emitted
`[SCENE: ...]` caption rather than raw narration, so the picture is *about the
right moment*. But the caption only describes what the DM free-wrote. When a
**known** entity — the player character, or a named NPC already recorded in
`npc-roster.md` — is in that moment, the image renders them as a **generic
stand-in**: a different face, different armor, a stranger. The scene is right;
the people in it are not on-model.

This is exactly the drift ADR/issue #104 already fixed for the **portrait**
path. `mergeCharacterAppearance` anchors a character portrait with the canonical
`appearance` stored on `character-sheet.json`, because the DM's free-written
description "comes out close but not matching." The portrait fix never reached
the scene path: the `/illustrate` and `/animate` moment branches dispatch
`entityType === "scene"`, which bypasses the `entityType === "character"` guard
on `mergeCharacterAppearance`.

Two ways to know who is in a scene:

1. **Name-matching** the caption/narration against the roster. Rejected: it
   misses the player character (never named in-caption — the caption is written
   in the third person about "a ranger", not by name), and it cannot tell
   *visibly present in frame* from *merely mentioned/remembered/off-screen*.
2. **A DM-emitted presence list.** The DM already knows who is in the moment and
   already emits one inline tag reliably (the caption). Adding a second optional
   tag costs no API key and no extra model call — it rides the same turn text.

We take option 2.

## Decision
The DM emits, after the mandatory `[SCENE: ...]` line, one **optional** final
tag naming the KNOWN roster entities **visibly present** in this moment, by
canonical name, focal subject first:

```
[SCENE: a hooded ranger crouches over a dying fire as a scarred woman watches]
[PRESENT: Marta, Aelar]
```

- The tag lists only entities that **already exist** in the campaign's state
  files (the player character, or a `## <Name>` entry in `npc-roster.md`) and
  are **actually in frame** — not merely mentioned. Focal subject first, at most
  three. If none are present (a landscape, a brand-new unrecorded stranger), the
  DM **omits the tag entirely**.
- Like `[SCENE:]`, it is stripped from player-facing narration, never referenced
  in prose, and never written to the session log.

At the description-resolution seam (`resolveMomentDescription` → the 500-char
cap, in the `/illustrate` and `/animate` moment branches), a new multi-entity
helper `groundSceneDescription` looks up each present entity's **canonical**
appearance — the player character from `readCharacterIdentity().appearance`
(character-sheet.json), NPCs from the `- **Description:**` bullet in
`npc-roster.md` — and prepends a budgeted appearance snippet to the scene
description. This **canonical lookup**, not the DM's free-write, is what
guarantees the scene matches the portrait.

Budget: at most three entities, focal subject first; appearance tags are
prepended (so they survive the 500-char cap, exactly as `mergeCharacterAppearance`
does) but never push the scene description itself out — extra entities are
dropped *before* the cap bites, so the actual moment is never truncated to make
room for appearances.

Because the fix is upstream at the shared description — which flows unchanged
through `generateImage`/`generateVideo` → `getImageBackend(provider).generate()`
— it benefits **both** the grok and local (ComfyUI/SDXL) backends and **both**
illustrate and animate, without touching any backend internals.

`presentEntities` is persisted additively on `TurnTranscriptRecord` (same shape
and absent-means-unset contract as `sceneCaption`), so regenerate and animate
reuse the same list the turn was recorded with.

## Consequences
- **Graceful, never required.** No `[PRESENT:]` tag, no matched entity, or a
  missing appearance field → the helper returns the description unchanged and
  the scene renders from the caption alone (today's behavior). Grounding never
  throws and never blocks a render.
- **Portrait path untouched.** `mergeCharacterAppearance` and its
  `entityType === "character"` gate are byte-identical; the entity/portrait MCP
  tool path is unchanged. Scene grounding is a separate helper at a separate
  seam.
- **NPC appearance source.** NPC entries have no dedicated appearance field;
  appearance is folded into the freeform `Description` bullet. We read that
  bullet server-side, reusing the same `## <Name>` section-scan
  (`HEADING_LINE_RE`) that `withNpcField` already uses to *write* portrait
  bullets — we do not depend on the web-side `parseNpcRoster` (not importable
  server-side).
- **Reliability rides the caption.** `[PRESENT:]` emission depends on the same
  DM compliance as `[SCENE:]` (now an OUTPUT FORMAT contract, ADR-0030 #130
  amendment). Unlike the caption, a missing `[PRESENT:]` is *not* backfilled by
  a retry — it is optional by design, and its absence degrades to today's
  ungrounded (but correct-moment) scene, which is acceptable.
- **Scope.** Player character + named NPCs only. Locations and items are out of
  scope for this slice.
```
