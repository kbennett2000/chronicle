# Chronicle — Backend Brief for Claude Design

**Purpose of this document:** everything Design needs to know about the
backend Chronicle's UI plugs into. This covers data and contracts only —
styling, layout, visual design, and interaction design are deliberately
**not** covered here; that's the whole point of this handoff. Where this
doc says "the current UI does X," treat that as the functional behavior to
preserve, not the visual approach to keep.

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

Every API route (everything below except static asset serving) requires
a header:

```
X-Chronicle-Token: <shared secret>
```

Missing or wrong token returns 401. This is a single shared passphrase for
one household LAN, not per-user accounts — there's no login/identity
system, just this one gate. The existing UI has a Settings -> Connection
section where the server address and this passphrase are entered and
stored client-side (currently localStorage); that functional piece needs
to keep existing in whatever Design builds, since without it the app
can't reach its own backend.

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
    currentSessionLog: { path: string; content: string } | undefined
  }
```
**Correction:** `currentSessionLog` is an object, not a bare markdown
string, and can be `undefined` entirely if no session has been started
yet for that snapshot. Use `currentSessionLog?.content`. This response
also includes an extra `model` field not documented before (harmless,
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

## 8. Known Constraints Worth Knowing

- Video generation is scoped but not implemented (/imagine-video wasn't
  working in testing) -- no video-related settings or endpoints exist.
- This is a single-household LAN app, not multi-user -- no per-user
  identity anywhere in the API.
- SRD-grounded rules adjudication and the travel/rumor/encounter-twist
  narrative content are still pending backend work -- they don't change
  any API shape above, so Design doesn't need to wait on them.
