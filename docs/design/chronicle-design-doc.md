# Chronicle — Design Doc v0.1

## 1. Vision

A solo-play D&D 5e app for mobile, where a persistent agentic backend acts as
Dungeon Master. The core bet: the thing wrong with existing AI-DM apps isn't
DM "personality" quality, it's **state drift and content repetition** — both
solvable by giving the DM real persistent memory and real novelty constraints,
instead of asking a chat model to remember and improvise everything from a
rolling context window.

Primary user: a casual mobile player who wants faithful 5e rules, minimal
typing friction, and campaigns/NPCs/missions that don't feel recycled.

## 2. Core Architecture

Two decoupled services. Neither is aware of the other's internals — they
communicate through the campaign's persistent state files.

### 2.1 DM Engine — pluggable backend (Claude Agent SDK or Grok)
- A `DmBackend` seam (ADR-0018) lets the DM brain run on either the **Claude
  Agent SDK** (default) or the **Grok** headless CLI, chosen **per campaign**
  like the model is (§8). Both implement the same `runTurn(...) → TurnResult`,
  so everything downstream (transcript, session persistence, response shape) is
  provider-agnostic.
- Claude path: embeds the same agent loop that powers Claude Code (file
  read/write, tool execution, session management) directly in the backend
  process — one Agent SDK session per active campaign, working directory = that
  campaign's state folder.
- Grok path: `grok -p … --cwd <campaignDir> --sandbox workspace
  --system-prompt-override <systemPrompt>` headless, with the four host tools
  (dice / seed / texture / image) exposed as stdio MCP servers wired per turn
  via `.grok/config.toml`. The kernel sandbox + a pre-tool-use hook confine
  writes to the campaign dir. See ADR-0018.
- Either way, responsible for: narration, rules adjudication, updating state
  files, emitting asset-request events.

### 2.2 Asset Engine — Grok Build (headless)
- Note: Grok appears in two distinct roles — here as the always-headless
  **image** worker, and (ADR-0018) as an optional **DM** backend in §2.1. They
  are separate invocations with separate isolation.
- Runs `grok -p "/imagine <prompt>"` non-interactively (or via ACP) as a
  separate worker process, triggered by DM Engine events — not called by the
  DM Engine's own reasoning loop.
- Prompts are built **from the entity's already-established description** in
  the state files, never invented fresh — so art matches what's already been
  narrated, not a divergent guess.
- Output cached per-entity, keyed by ID, generated once, reused forever.
- Video generation (`/imagine-video`) deferred — not currently working in
  testing. Config schema should leave room for it, feature flagged off.

## 3. Persistent Campaign State (the anti-drift layer)

Per-campaign working directory, treated like a small repo:

- `character-sheet.json` — HP, inventory, conditions, XP, spell slots
- `world-state.md` — locations visited, factions, and a required
  **"Current Situation"** heading, kept up to date every turn — this is
  what narration gets grounded against, not just a location history
- `npc-roster.md` — every *named* NPC: description, disposition, what they
  know, portrait asset ID
- `quest-log.md` — active / completed threads. Gets the **same per-turn
  update discipline as `world-state.md`** — discoveries and complications
  must be reflected in the relevant quest entry the same turn they land in
  world-state, not just noted there and left for a later touch-up
- `content-registry.md` — every mission archetype, NPC name/role, and
  villain motive used, across the campaign (or account) — checked before
  generating anything new
- `session-log/` — append-only narrative history, one file per session

Every turn: DM Engine reads relevant files, updates them as things change,
and keeps only recent narrative prose in the model's working context — not
the whole campaign history. This is the direct fix for inventory amnesia,
NPC contradictions, and lost HP/condition tracking.

## 4. Solving Repetition (the actual ask that started this)

Prompt templates alone don't fix this — they change *how* something is said,
not *what* gets generated. The fix is a content-diversity layer:

- **Seed tables, not free invention.** Quest hooks, complications, locations,
  and villain motives are rolled from tables; Claude elaborates a randomly
  seeded combination rather than inventing from a blank page.
  - `data/seed-tables.json` (v2) is the canonical, much-expanded content
    library: conventional + wildcard pools for quest hooks, complications,
    and villain motives; combinatorial NPCs (role x trait x quirk, 46,240
    combinations) and locations (archetype x modifier, 1,705 combinations)
    with standalone wildcard entries for each; plus `surreal_moments`,
    `emotional_beats`, `travel_events`(+wildcard), `rumors`, and
    `encounter_twists` — covering travel, downtime, and combat/social scenes,
    not just quest/NPC/location generation.
  - **Registry scope is split by category**, not uniform:
    - **Global** (identity-bearing, must not repeat across the whole
      account): quest hooks, complications, villain motives, NPCs
      (combo or standalone), locations (combo or standalone).
    - **Per-campaign only** (texture, fine to recur across different
      campaigns, shouldn't repeat within one story): surreal moments,
      emotional beats, travel events, rumors, encounter twists.
  - Wildcard pools sampled at a low, configurable rate (`wildcard_chance`,
    default ~15-20%) across all conventional/wildcard pairs, so strangeness
    punctuates rather than saturates.
  - **Field-level anti-repetition**, not just combo-level: Slice 5 validation
    showed exact-combo dedup alone still lets individual fields (a trait, a
    modifier) recur well before the combo space is exhausted, since field
    pools are much smaller than the full combo count. Selection should bias
    against recently-used individual field values, not just check the full
    combo — this is a real fix, not a nice-to-have, and should land before
    the table gets used heavily.
  - `emotional_beats` and `surreal_moments` in particular are judgment calls,
    not fixed-cadence rolls — the DM decides *when* injecting one would land
    well (after a loss, a quiet moment, a reunion), rather than sampling
    them on a timer.
- **Content registry** (§3) — generation calls must check it and exclude
  recent repeats.
- **Persistent NPC identity** — NPCs are real entries in `npc-roster.md`,
  not re-derived per scene.

## 5. Rules Fidelity

She explicitly wants 5e rules followed, not rules-light narration. Approach:
**SRD-grounded** — the agent consults the open-licensed 5e SRD text as
reference material via file/tool access, checking mechanics against source
rather than recalling them from training. This is a deliberate scope
increase over "vibes-based" adjudication and should be its own slice, not
bundled into the first one.

## 6. Prompt Template System

- Every Claude Agent SDK call site uses a versioned template, not a hardcoded
  string.
- Templates are grouped into **profiles** (same pattern as Photo Wrangler's
  style profile library) — swappable/editable as a set.
- Split templates into two tiers:
  - **Cosmetic** (tone, verbosity, reading level) — safe to hot-swap mid-session.
  - **Structural** (world/rules adjudication) — locked per-session to avoid
    tone/difficulty lurches mid-story.

## 7. UI

### Input
- Free text stays primary.
- **Action chips** for mechanical actions (attack, search, talk, use item,
  move) — an escape hatch from typing, not a replacement.
- **Contextual suggested replies** (3–4 tappable "what do you do" options)
  above the text box.
- **Voice input** (dictation) — phone-native, near-zero added cost.
- Response length should match input length/intent, not reward long typing
  with padded output.

### Reducing text load via visual state
Anything that's bookkeeping dressed as narration gets pulled out of prose
into persistent UI:
- Character sheet & inventory panel
- NPC roster cards (portrait, name, disposition)
- HP/condition bar + initiative tracker in combat
- Location card / map thumbnail per scene
- Visual/animated dice rolls
- Condensed "story so far" recap panel instead of prose recap on return

### Shell
- **Mobile (primary):** fixed story/chat view; other panels live in a
  bottom sheet / drawer, tap or swipe accessed — no drag-to-resize.
- **Desktop/tablet (secondary):** freely resizable/movable/dockable panel
  layout (Golden Layout / Dockview / react-mosaic), saved layouts.
- **Contextual auto-surfacing** either way: combat opens the HP/initiative
  panel automatically; meeting a new NPC briefly surfaces their card;
  pure exploration recedes to just story.

## 8. Image Generation Trigger Points

Fires only on **first creation** of a registry entry, not every mention:

- Character creation → portrait
- First appearance of a **named/major NPC**
- First entry into a **significant location**
- Discovery of a **notable item** (magic/legendary gear, quest-critical object)
- A boss/major antagonist's reveal

Settings screen: single **Generate Images** toggle (video toggle stubbed,
hidden/off, for later), plus a **provider toggle** and a **model selector**
(ADR-0018):
- **Provider toggle** (Claude / Grok): picks the DM backend (§2.1). Claude is
  the recommended default. The model list below shows the selected provider's
  models.
- **Claude models:** default `claude-sonnet-5` — matched to this workload
  (narrative + rules-following state management), not a cost compromise;
  optional upgrade `claude-opus-4-8` (maximum rules/narrative fidelity, higher
  per-session cost); optional budget `claude-haiku-4-5` (faster/cheaper, less
  precise on rules — a testing/casual option, not the default).
- **Grok models:** `grok-build` (512K context, the recommended Grok DM) and
  `grok-composer-2.5-fast` (200K, faster/cheaper but coding-tuned, so prose may
  read plainer).
- Both provider and model are **per-campaign** (stored in
  `campaign-settings.json`), not global, and changing either **resets the DM
  session** — a long-running campaign shouldn't silently change adjudication
  quality or engine mid-story unless the player chooses to switch it. Because
  Grok's DM runs under a workspace sandbox, a Grok campaign's anti-repetition
  seed registry is kept per-campaign rather than in the shared global registry
  (ADR-0018 Slice 5).

## 9. Open Decisions To Confirm With Her Directly
- How much visual competes with prose — dashboard-heavy vs. book-with-a-dice-tray.
- Strict SRD rules-following vs. some flexibility, once she's tried both.

## 10. Vertical Slice Roadmap
1. Headless Agent SDK session, one campaign, one character, text-only loop,
   state files as in §3. No UI polish, no images, no seed tables. Goal:
   prove the persistence-fixes-drift hypothesis over ~10+ turns.
2. Mobile-first chat UI wrapping Slice 1.
3. Seed tables + content registry (repetition fix).
4. SRD-grounded rules adjudication.
5. Image generation via Grok Build headless, trigger events, caching.
6. Prompt template/profile system, cosmetic vs. structural split.
7. **[Removed — see §13]** Real dice/character-sheet UI is deferred to the
   Claude Design handoff rather than built by CC first.
8. Desktop dockable panel layout (optional, lower priority than mobile;
   also likely folds into the Design handoff rather than a CC slice).

## 11. Adaptive Music (scoped for later, not yet a slice)

Direct feedback from testing the reference app: she likes music that shifts
with scene atmosphere, but sometimes mutes it — the friction of muting
matters as much as the feature itself.

- **Curated royalty-free ambient loops tagged by mood** (combat, exploration,
  tavern/town, tense, emotional, triumphant), not AI-generated audio — same
  curated-asset philosophy as the seed tables, and avoids per-session
  generation latency/looping/copyright issues.
- DM engine emits a **mood tag** per scene (on meaningful change, not every
  turn) — same event pattern as the image-generation triggers (§8) — and
  the frontend crossfades to the matching track.
- Settings screen holds the persisted on/off default and volume.
- **A fast, obvious mute/volume control lives on the play screen itself**,
  not buried in settings — this is the actual fix for "sometimes muted it,"
  not just having the feature.
- Sequenced after image generation and the mobile UI work is further
  along — not competing for the next slice yet.

## 12. Per-Campaign Customization: Style, Setting, Tone, Intensity

See ADR-0004 for the architecture decision. Four dials, all stored
alongside the existing provider + model selection (§8) in
`campaign-settings.json`, all optional with sensible defaults:

- **Art style** — freeform string appended to image-generation prompts.
  UI offers presets (comic book, Lego-style, pencil sketch, watercolor,
  anime, pixel art, noir, oil painting) plus a custom text field.
- **World setting** — optional freeform description (medieval fantasy is
  the default with nothing set). Reskins the *flavor* of rolled seeds via
  DM engine instruction; does not fork or bypass the seed tables,
  selector, or registry. Copyright guardrail: real IP names (Star Wars,
  etc.) are genre inspiration only — the DM invents original names,
  never reproduces copyrighted characters/factions/places verbatim.
- **Tone/whimsy** — a slider surfacing the existing `wildcard_chance`
  config plus `emotional_beats` frequency, rather than new machinery.
- **Content intensity** — bounds crude humor (`[funny/crude]` entries) and
  how graphically combat/violence gets described. Independent of the
  other three dials.

## 13. Claude Design Handoff Gate

The mobile UI built so far (Slice 3 onward) is functional scaffolding, not
the intended final UX. Full UI/UX polish is deliberately deferred to
Claude Design, working directly with Kris — but only once the backend
*contract* Design would build against stops changing shape, so their work
isn't invalidated by ongoing backend churn.

**Gate criteria (all must be true before handoff):**
1. Settings/customization surface fully locked — model, images, art style,
   world setting, tone, content intensity all exist and are wired
   (completes at end of Slice 8).
2. Image generation actually producing real files being served, with
   defined loading/failure states — not just scoped.
3. State-snapshot API final in shape (character sheet, NPC roster,
   quest log, world state, session log) — largely true now, confirm
   nothing else is about to reshape it.

**Explicitly not gates** (don't change the data shape the UI consumes,
so Design can start before these land): SRD rules-grounding, texture-
category wiring (travel/rumors/encounter twists), adaptive music.

**Consequence for the roadmap:** roadmap item 4 ("dice roller + character
sheet as real UI, not markdown") is removed as a slice — it's exactly the
kind of UI polish Design should build once, not something CC builds
roughly now for Design to redo later.

When the gate is met, the deliverable is a complete backend brief for
Design: full API surface (endpoints, request/response shapes), the
state-file schema, the settings model, how images arrive and where
they're served from, auth (shared-secret header), and an explicit note on
what's *not* the backend's concern (styling, layout, interaction design).
