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

### 2.1 DM Engine — Claude Agent SDK
- Embeds the same agent loop that powers Claude Code (file read/write, tool
  execution, session management) directly in the app's backend process —
  not the interactive CLI.
- One Agent SDK session per active campaign, working directory = that
  campaign's state folder.
- Responsible for: narration, rules adjudication, updating state files,
  emitting asset-request events.

### 2.2 Asset Engine — Grok Build (headless)
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
hidden/off, for later), plus a **model selector**:
- Default: `claude-sonnet-5` — matched to this workload (narrative +
  rules-following state management), not a cost compromise.
- Optional upgrade: `claude-opus-4-8`, labeled for players who want maximum
  rules/narrative fidelity and don't mind a higher per-session cost.
- Optional budget option: `claude-haiku-4-5`, labeled honestly as
  faster/cheaper but less precise on rules — a testing/casual-session
  option, not the recommended default.
- Model choice is per-campaign (stored alongside campaign state), not
  global — a long-running campaign shouldn't silently change adjudication
  quality mid-story unless the player chooses to switch it.

## 9. Open Decisions To Confirm With Her Directly
- How much visual competes with prose — dashboard-heavy vs. book-with-a-dice-tray.
- Strict SRD rules-following vs. some flexibility, once she's tried both.

## 10. Vertical Slice Roadmap
1. Headless Agent SDK session, one campaign, one character, text-only loop,
   state files as in §3. No UI polish, no images, no seed tables. Goal:
   prove the persistence-fixes-drift hypothesis over ~10+ turns.
2. Mobile-first chat UI wrapping Slice 1.
3. Seed tables + content registry (repetition fix).
4. Dice roller + character sheet as real UI, not markdown.
5. SRD-grounded rules adjudication.
6. Image generation via Grok Build headless, trigger events, caching.
7. Prompt template/profile system, cosmetic vs. structural split.
8. Desktop dockable panel layout (optional, lower priority than mobile).
