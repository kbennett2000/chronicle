# Chronicle — Backend Brief for Claude Design

**Purpose of this document:** everything Design needs to know about the
backend Chronicle's UI plugs into. This covers data and contracts only —
styling, layout, visual design, and interaction design are deliberately
**not** covered here; that's the whole point of this handoff. Where this
doc says "the current UI does X," treat that as the functional behavior to
preserve, not the visual approach to keep.

> **Reconciled with current state 2026-07-09.** This was written against an
> earlier backend; three things have changed since and are corrected inline
> below:
> - **Auth is now per-user accounts** (register / login with username +
>   password), *not* the single shared-secret `X-Chronicle-Token` header
>   described below. Every route is gated by a **session token** obtained at
>   login (ADR-0019). Wherever this doc says `X-Chronicle-Token`, read
>   "the logged-in user's session token."
> - **Video generation is built** (ADR-0026) — on-demand "Animate" clips with a
>   `generateVideos` toggle and `/campaigns/:id/animate` + `/videos/:filename`
>   routes.
> - **Images are a pluggable backend** (Grok Build *or* local ComfyUI/SDXL,
>   ADR-0027), chosen per campaign — not Grok-only.

---

## 1. What Chronicle Is

A mobile-first solo D&D 5e app. A Claude Agent SDK-powered DM engine runs
each campaign with persistent, file-backed state (not just conversation
history), so the story doesn't drift or contradict itself. A separate,
decoupled asset worker (Grok Build, headless) generates and caches images
at key story moments. Full product context is in `docs/design/
chronicle-design-doc.md` if useful background, but the API surface below
is what actually matters for building against.

## 2. Auth

> **Superseded by per-user accounts (ADR-0019).** The shared-passphrase model
> below is no longer how auth works — kept only for context. Current model:
> `POST /auth/register` and `POST /auth/login` (username + password) return a
> **session token**; every other route requires it (an `Authorization` header,
> or `?token=` for media/streaming URLs) and returns 401 without it. Each person
> registers their own account and sees only their own campaigns; campaigns nest
> under `campaigns/<user>/`. The Settings → Connection UX still holds the server
> address, but the passphrase field is replaced by login/identity.

~~Every API route (everything below except static asset serving) requires
a header `X-Chronicle-Token: <shared secret>`; missing or wrong token
returns 401 — a single shared passphrase for one household LAN, no
login/identity system.~~ (Historical; see the note above.)

## 3. Core API Surface

### Send a player action / message
```
POST /campaigns/:id/turns
Body: { message: string }
-> { narration: string, sessionId: string, isError: boolean }
```
**Latency note for Design:** when a turn triggers image generation (see
section 6), this request can take noticeably longer -- Grok Build image
generation adds real seconds, not milliseconds. The UI needs a genuine
"the DM is thinking/drawing" loading state for turns, not just an
instant-response assumption. This is currently synchronous (the HTTP
response waits for everything, including any image call, to finish) --
worth knowing since it directly shapes what loading state design is
needed.

### Get full campaign state
```
GET /campaigns/:id/state
-> {
    characterSheet: {...},   // see section 4
    worldState: string,       // markdown
    npcRoster: string,        // markdown
    questLog: string,         // markdown
    currentSessionLog: {
      path: string;
      content: string;         // prose narrative, for flavor/recap
      transcript: Array<{      // deterministic, server-written turn record
        turnIndex: number;
        timestamp: string;
        playerMessage: string;
        narration: string;
      }>;
    } | undefined
  }
```
**Correction/addition (per ADR-0007):** `currentSessionLog` is an object,
not a bare markdown string, and can be `undefined` entirely if no session
has been started yet for that snapshot. Use `currentSessionLog?.content`
for prose/flavor text, but use `currentSessionLog?.transcript` — not
prose-parsing — for anything that needs to reliably distinguish player
input from DM narration turn-by-turn. The prose log is not a reliable
source for that distinction; the transcript is written deterministically
in code at the moment of each turn, specifically because the model's
retrospective prose can't be trusted to preserve it. This response also
includes an extra `model` field not documented before (harmless,
additive).

### Get/set campaign settings
```
GET  /campaigns/:id/settings
POST /campaigns/:id/settings
Body/response: {
    artStyle?: string,
    worldSetting?: string,
    toneWhimsy?: number,       // 0-1
    contentIntensity?: "standard" | "low",
    generateImages: boolean    // default false
  }
```
**Correction:** `model` is NOT part of this endpoint. It's set/changed
only via the optional `model` field on `POST /campaigns/:id/session/start`
(see below). A settings-screen model control must POST there, not here —
posting `model` to this endpoint silently no-ops.

### Start or resume a campaign session
```
POST /campaigns/:id/session/start
Body (optional): { model?: "claude-sonnet-5" | "claude-opus-4-8" | "claude-haiku-4-5" }
-> { sessionId: string, resumed: boolean, sessionLogPath: string }
```

### List available models (for the model-selector UI)
```
GET /models
-> { models: [{ id: string, label: string }], default: string }
```
**Correction:** response is wrapped in a `models` key, not a bare array,
and there's no separate `description` field — the fidelity/cost tradeoff
copy is baked into `label` as the full row text. Render `label` directly;
don't expect a second field to split out.

### Get a generated image
```
GET /campaigns/:id/images/:filename
-> the image file (binary), same auth gate as everything else
```
Images are .jpg/.png (whatever Grok Build returns), stored under
`campaigns/:id/images/`. Filenames are of the form
`<entity-type>-<slug>.<ext>` (e.g. `npc-old-wick-thistlewood.jpg`,
`location-millbrook-town-square.jpg`). The actual path/filename for a
given entity is recorded in that entity's entry in the relevant state file
(see section 4) -- there's no separate "list all images" endpoint
currently; Design should treat image availability as something discovered
by reading state, not queried separately.

## 4. State-File Schema (what GET /state actually contains)

- **Character sheet** (JSON): HP, inventory, conditions, XP, spell slots,
  `currency: { cp, sp, ep, gp, pp }` (all five 5e denominations, not just
  gold), `portraitImage` (filename or absent if never generated / failed).
- **World state** (markdown): locations visited, factions, and a required
  "Current Situation" section that's what narration is actually grounded
  against. Location entries may include an image filename once generated.
- **NPC roster** (markdown): every named NPC -- description, disposition,
  what they know, image filename once generated.
- **Quest log** (markdown): active/completed threads.
- **Session log** (markdown, one file per session): append-only narrative
  history.

**Important for Design:** these are markdown/JSON, not a rigid schema
with guaranteed fields on every entry -- an NPC met before image
generation was enabled, or one whose image generation failed, simply
won't have an image reference. Design the "no image yet" case as a
normal, expected state, not an error case -- most entities in an
established campaign may never have one if `generateImages` was off for
part of the story.

## 5. Settings Model -- What Each Field Actually Does

- `model` -- which Claude model runs the DM engine for this campaign.
  Locked per-campaign once set (a running story shouldn't silently change
  adjudication quality mid-story).
- `artStyle` -- freeform string (UI currently offers presets: comic book,
  Lego-style, pencil sketch, watercolor, anime, pixel art, noir, oil
  painting -- plus custom text) appended to every image-generation prompt.
  Affects only how images look, not what gets generated.
- `worldSetting` -- freeform string (empty = standard fantasy). Reskins
  the narrative flavor of the story (e.g. "underwater merfolk
  city-states," "sci-fi space opera") while 5e mechanics and story
  structure stay intact underneath.
- `toneWhimsy` -- 0-1, controls how often genuinely strange/surreal
  content surfaces vs. conventional fantasy content. Higher = weirder,
  more frequently.
- `contentIntensity` -- "standard" or "low". Low suppresses crude humor
  and keeps violence description non-graphic.
- `generateImages` -- master on/off for image generation. Default false
  (off) -- requires the backend host to have Grok Build/SuperGrok access
  configured, so it's opt-in, not assumed available.

## 6. Image Generation -- Trigger Points (for Design's mental model)

Images are generated **once, on first creation**, not on every mention:
- Character creation -> portrait
- First appearance of a named/major NPC
- First entry into a significant location
- Discovery of a notable item
- A boss/major antagonist's reveal

Failure is handled gracefully server-side -- a failed generation never
blocks the turn's narration, it just means that entity has no image.
Design should treat "entity has no image" as the default/common case to
design for, not an edge case.

## 7. What's Explicitly NOT the Backend's Concern

- Visual design, layout, color, typography, iconography -- all
  Design/Kris.
- The mobile-first shell vs. desktop dockable-panel layout decision --
  functional requirement (mobile is primary) documented in the design
  doc, but the actual interaction design is open.
- How loading/pending states look (just that they're needed -- see
  section 3).
- How "no image yet" is visually represented (just that it's the common
  case -- see section 6).
- Action chips, suggested replies, voice input -- these were scoped
  conceptually in the design doc but not yet built; fair game for Design
  to shape however makes sense against the API above.

## 8. Known Mockup-vs-Real-Schema Divergences

Found during panel implementation (Slices 20, 22-24) — the design mockup
invented structure the backend schema doesn't actually have. In both
cases the real, un-fabricated shape was implemented instead of inventing
data to match the mockup:

- **Self panel:** mockup showed a Speed stat and an XP progress bar with
  a next-level threshold. Neither exists — there's no `speed` field, and
  computing XP-to-next-level requires the 5e leveling table, which is
  SRD-grounding work not yet done. Rendered raw `xp` as plain text,
  dropped Speed. (Revisit if/when advancement mechanics get their own
  rules-grounding slice.)
- **Quest panel:** mockup invented a three-tier model (Active-with-
  boolean-steps, an open "Threads" middle tier, Closed) with per-step
  `done: true/false` checkboxes. The real schema (per `dm-engine.ts`
  rule 6 and the actual `quest-log.md` shape) is just two sections
  (Active/Completed), each holding freeform prose bullets with nested
  progress notes — no structured step-completion state exists anywhere.
  Built around the real two-section freeform shape instead.
- **Views (gallery) panel:** mockup's lightbox showed a "first drawn ·
  Session N" caption. `image-generator.ts` never records when an image
  was generated — that data doesn't exist anywhere — so it's not
  rendered. Third instance of this same pattern; if a future slice ever
  wants generation-timestamp captions, that's a real (small) addition to
  `image-generator.ts` itself, not something to fake client-side.

- **Settings screen:** not a fabrication case, but a real endpoint-shape
  gotcha the mockup's flat data model hides — `model` (Engine) only ever
  changes via `POST /session/start`, while every other Engine/Look/World
  field (artStyle, worldSetting, toneWhimsy, contentIntensity,
  generateImages) goes through `GET`/`POST /campaigns/:id/settings`.
  Rather than one "Save" button quietly firing two different kinds of
  requests, every control applies itself immediately on interaction
  (click a model row, click an art chip, flip the images toggle, move
  the whimsy slider, blur a text field) with its own small inline
  save-status line — matching the mockup's own auto-apply interaction
  pattern for these sections, which turns out to have been the right
  call for exactly this reason, not just a style choice.

Related, found during Views: **NPC and location image/description
recording aren't structurally consistent.** NPCs get a fixed `## <Name>`
heading with a `Portrait asset ID` field; locations only get a freeform
"Image" line under a bullet, no fixed heading. A tolerant parser handles
this today, but it's worth a future consistency pass in
`image-generator.ts`'s recording convention rather than leaving two
different shapes for what's conceptually the same kind of data.

## 9. Known Constraints Worth Knowing

- ~~Video generation is scoped but not implemented.~~ **Now built** (ADR-0026):
  on-demand "Animate" clips via a `generateVideos` toggle, `POST
  /campaigns/:id/animate`, and `GET /campaigns/:id/videos/:filename`. Clips are
  never auto-generated on a turn.
- ~~This is a single-household LAN app, not multi-user.~~ **Now multi-user**
  (ADR-0019): per-user register/login, per-user campaign isolation. Still a
  single-household-LAN posture (no HTTPS), but with real per-user identity.
- SRD-grounded rules adjudication and the travel/rumor/encounter-twist
  narrative content are still pending backend work -- they don't change
  any API shape above, so Design doesn't need to wait on them.
- Images are a **pluggable backend** — Grok Build or local ComfyUI/SDXL
  (ADR-0027), chosen per campaign; `generateImages` still gates whether any are
  drawn.

## 10. Known Test Debt

- The `turn.spec.ts` flakiness flagged during Slice 22 was root-caused
  and fixed in Slice 23: `tests/e2e/harness.ts`'s server-process teardown
  used a plain `proc.kill()`, but `tsx`'s CLI always re-execs itself as a
  child to install its ESM loader hooks — `proc.kill()` only ever
  signalled that wrapper, never the grandchild actually bound to the
  port. Every e2e run before this fix leaked its real server process
  forever (298 confirmed still running from old sessions before cleanup).
  That accumulating CPU/memory/FD pressure was what made the one real,
  network-bound Agent SDK call in the suite intermittently fail under a
  full run while passing reliably alone. Fixed by spawning detached and
  killing the whole process group on teardown; confirmed clean (zero
  leaked processes, all tests passing) across several consecutive
  full-suite runs since, most recently after Slice 24.
