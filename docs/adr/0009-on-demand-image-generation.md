# 0009 — User-triggered on-demand image generation

## Status
Accepted

## Context
Image generation (ADR-0001's decoupled asset engine, wired in Slice 9) is
invoked **only** by the DM engine, and only opportunistically: the model calls
the `generate_image` MCP tool at an entity's *first* creation (character
creation, an NPC's first appearance, first entry to a location, a notable item,
a boss reveal — design doc §8). This produced three field reports (issues #37,
#41, #42):

- On a campaign that already has a character and known NPCs, those "first
  creation" moments have already passed, so turning "Generate scene art" on
  produces **nothing** — the Views gallery stays at "0 of N illustrated."
- Every failure mode of the `grok` shell-out is swallowed and surfaced only to
  server stderr (`image-generator.ts`), so from the player's side "enabled but
  no images" is indistinguishable from "Grok Build isn't authenticated."
- Players want to **choose** what gets illustrated — #42 asks specifically for a
  per-response "make an image" option.

## Decision
Add explicit, user-triggered image generation, invoked outside a turn via a new
authenticated route **`POST /campaigns/:id/illustrate`**:

- `{ kind: "entity", entityType, name, description }` — illustrate a known
  character / NPC / location. On success the returned relative path is recorded
  into the same source of truth the model writes (`portraitImage` in
  `character-sheet.json`; a `- **Portrait asset ID:**` bullet under the NPC's
  `## <Name>` heading; an indented `- Image:` line under the location's
  `world-state.md` bullet) so the existing gallery/portrait code — which reads
  images *out of* state files, per the handoff — picks it up unchanged.
- `{ kind: "moment", turnIndex }` — illustrate a specific DM response. The
  turn's own narration (from the ADR-0007 transcript) is the description; the
  image path is persisted onto that transcript record (see the ADR-0007 note
  below) so it re-appears on reload.

Design points:

1. **Independent of the `generateImages` toggle.** That toggle governs the
   model's *automatic* generation during a turn. A manual "Draw this" is explicit
   intent and works whenever Grok Build is reachable; the toggle does not gate
   it. `artStyle` from settings is still applied.
2. **Reuses `generateImage()` directly** — no model/MCP round-trip. That function
   already never throws; the endpoint returns its `{ ok, relPath?, error? }`
   verbatim with HTTP 200 (a domain result, like a turn's 502), so the client can
   render the exact failure reason instead of a silent no-op.
3. **No new single-flight lock.** Single-household trust boundary (ADR-0003);
   on-demand illustration is not the racy shared-turn-state path issue #31
   guarded.

### ADR-0007 addendum (additive)
`TurnTranscriptRecord` gains an optional `image?: string`. This is
backward-compatible: older records simply omit it, and the deterministic
per-turn append is unchanged. A moment illustration rewrites the one record it
targets to add the field; it never re-derives narration or player text.

## Consequences
- "Enabled but no images" is fixed at the root: the player can illustrate any
  entity or any response on demand, and a Grok failure now states its reason.
- Two small server-side markdown writers (NPC portrait bullet, location image
  line) now mirror what the model was instructed to write; they are pure string
  transforms with unit tests, and share the literal field/heading names checked
  by `heading-consistency.spec.ts`.
- Scene/moment images are a new class of generated asset not tied to an entity;
  they live in the campaign `images/` dir like the rest and are addressed by the
  transcript record rather than a state-file entry.
