# Handoff: Chronicle — Solo D&D 5e Mobile App

## Overview
Chronicle is a **mobile-first, single-household solo D&D 5e app**. A Claude-powered DM engine runs each campaign against persistent, file-backed state; a decoupled worker (Grok Build) generates scene/character art at key story moments. This package is the **UI design** for the player-facing app: a warm, candlelit "illuminated manuscript" that reads like *a book with a dice tray*, not a stats dashboard with a chat window.

The design deliberately answers the product's one open UX question — how much persistent character UI to show — by keeping the reading surface clean and **surfacing status only on change**, with a four-tab journal (Self / Folk / Quest / Views) always one tap away at the bottom.

---

## About the Design Files
The files in this bundle are **design references created in HTML**, not production code to copy line-for-line. `Chronicle.dc.html` is a self-contained streaming HTML prototype (a "Design Component") that demonstrates intended look, motion, copy, and behavior.

**Your task:** recreate these designs in the target codebase's environment using its established patterns and libraries. If no app shell exists yet, React Native / Expo (mobile-first) or a React + Vite PWA are both natural fits — the prototype is plain React-style state and would port directly. Treat the HTML as the source of visual truth (measurements, colors, type, motion, copy) and the **backend contract** below as the source of behavioral truth.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, motion, and copy are all intended as shown. Recreate the UI faithfully using the codebase's component library, then wire it to the real API. The only non-final elements are the **images**, which are AI-placeholder stand-ins (see *Assets*).

## How to run the reference
It needs its runtime + relative assets, so serve the folder rather than opening the file directly:
```bash
cd design_handoff_chronicle
npx serve .        # or: python3 -m http.server
# open the printed URL, then open Chronicle.dc.html
```
Requires internet (Google Fonts: Cormorant, Cormorant SC, Spectral). It opens on **Home**; tap *Continue the tale* → Active Play; the four bottom tabs open the journal panels; the gear on Home opens Settings.
Two preview-only props exist on the root component: `startScreen` (`home|play|settings`) and `imagesOn` (boolean) — handy for jumping straight to a screen or previewing the images-off world.

---

## The design system (tokens)

### Color
| Token | Hex | Use |
|---|---|---|
| `ink` | `#efe6d2` | primary text (warm bone / candlelit ink) |
| `ink-dim` | `#c2b398` | secondary text, narration continuation |
| `ink-faint` | `#8c7c62` | tertiary labels, placeholders, meta |
| `void` | `#0d0906` | app backdrop (near-black warm) |
| `leather` | `#19120b` | chrome bands, tabs, input dock, buttons |
| `leather-hi` | `#241a10` | raised leather (gradients, insets) |
| `page` | `#332614` | parchment page base (under texture) |
| `ember` | `#d3703c` | **vitality, urgency, primary action, wax** |
| `ember-deep` | `#7c3d20` | ember shadow / player-input rule |
| `arcane` | `#67a6b5` | **magic, quests, info, connection, links** |
| `arcane-deep` | `#2f565f` | arcane fills, completed-step checks |
| `brass` | `#b8965a` | dividers, seals, metal chrome, mute glyph |
| `brass-dim` | `#6d5a38` | hairline rules, tarnished edges |

Coin colors (5e denominations): `pp #cfd6d8` · `gp #c9a24a` · `ep #cfc9a8` · `sp #b9b6ad` · `cp #b06a3a`.

**Accent discipline:** ember = the character's body/vitality and the one primary action per screen; arcane = the world/magic/quests and any tappable link/connection; brass = physical "furniture" (rules, seals, mechanisms). Gold-leaf/gilt is deliberately avoided (per art direction) — brass is *tarnished*, never shiny.

### Typography
- **Cormorant SC** (small-caps display) — wordmark, section headers, names, stat values, tab labels, buttons. Weights 600/700. Letter-spacing scales with size: wordmark 44px / 700 / ~7px tracking; section headers 10–12px / 600 / 1.5–2.5px; names 15–22px / 600–700.
- **Cormorant** 600 — illuminated drop-caps only (~44–52px, `ember`).
- **Spectral** — all body/narration/UI prose. 300–600 + italics. Narration 16px / line-height 1.64; secondary prose 12–13px. Italic is used for flavor, whispers, "current situation", and input placeholders.
- **ui-monospace / Menlo** — connection fields only (server address, passphrase).

### Shape, depth, motion
- **Radii:** parchment pages ~2px (they read as torn, not rounded); leather buttons/inputs 3–4px; pill controls 20–24px; bottom-sheet 16px top corners; coins/seals circular.
- **Shadows:** pages float on `0 20px 40px rgba(0,0,0,.45)` + inset `0 0 42px rgba(14,9,4,.62)` inner vignette + inset `0 0 0 1.5px` dark edge line. Framed art plates add `0 0 0 1px rgba(184,150,90,.5)` (brass frame) + inset `0 0 0 4px rgba(20,12,6,.4)` (mat).
- **Candlelight:** every screen carries an ambient overlay — `radial-gradient(90% 40% at 50% 0%, rgba(150,104,52,.16), transparent 42%)` warm at top, darkened at the bottom, `pointer-events:none`.
- **Animations (`@keyframes`):** `flicker` (flame, 2.2–2.4s ease-in-out ∞) · `dotPulse` (loading ellipsis, 1.4s, staggered .2s) · `emberGlow` (HP wax seal, 2.4s) · `riseIn` (card entrance, .5s) · `sheetUp` (journal panels, .34s `cubic-bezier(.2,.8,.2,1)`) · `fadeIn` (screens/overlays, .25–.4s).

### Signature detail — torn/deckled parchment edges
Parchment surfaces get organic torn edges from an SVG filter, **not** clip-paths:
```html
<filter id="deckle" x="-8%" y="-8%" width="116%" height="116%">
  <feTurbulence type="fractalNoise" baseFrequency="0.013 0.017" numOctaves="2" seed="7" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="12" xChannelSelector="R" yChannelSelector="G"/>
</filter>
```
It is applied to a **background layer** (`position:absolute; inset:0`) that holds the parchment fill; the text content sits on an **unfiltered sibling on top**, so copy stays crisp while the paper edge frays. A smaller `#deckle2` (scale 7) is used on inline notes/chips.
Parchment fill = `radial-gradient(ellipse 72% 44% at 50% 3%, rgba(158,116,60,.30), transparent 60%)` (candlelight) over `parchment-warm.png` (cover). Leather fill = `leather-warm.png` (cover) over `#19120b`.

> Native recreation note: on React Native, reproduce torn edges with a masked PNG/SVG or `react-native-svg` turbulence; on web, the filter above is production-ready.

---

## Screens / Views

The whole app is one phone-sized surface (designed at 402×874, iOS dark frame; content runs edge-to-edge under the status bar). Navigation model: **Home** and **Settings** are full screens; **Active Play** is home base; the four **journal panels** are bottom-sheets over Play; the **lightbox** is a modal over the gallery.

### 1. Home — campaign shelf
- **Purpose:** choose/resume a campaign; entry to Settings; shows connection status.
- **Layout:** vertical, leather ground. Centered wordmark block (diamond-flourish rule, `CHRONICLE` 44px, italic tagline "a solo tale, kept by candlelight"). `YOUR CHRONICLES` section label. One **campaign card** (torn parchment): a 150px scene-art header with a gradient scrim, `SESSION 4` badge (top-right), and title *The Millbrook Road* overlaid bottom-left; below it a 34px circular avatar + `Wren Ashcombe` / `Half-Elf Ranger · Level 3`; a brass hairline; a `CURRENT SITUATION` block (arcane label + italic one-liner); a full-width ember **Continue the tale** button; "last played 2 days ago · autosaved". Secondary ghost button `＋ Begin a new chronicle`. Footer bar: arcane dot + "the hearth · 192.168.1.24" (connection state) and a **Settings** entry (right).
- **API:** *Continue* → `POST /campaigns/:id/session/start` → `{ sessionId, resumed }`, then load `GET /campaigns/:id/state` and enter Play. Current-situation line comes from the required "Current Situation" section of `worldState`. Footer status reflects whether the stored server address + passphrase currently authenticate.

### 2. Active Play — the reading surface
- **Purpose:** read narration, take actions, glance at nothing you didn't ask for.
- **Layout:** (a) **running-head chrome** (54px below status bar): left = circular home chevron; center = small-caps running head `iv · MILLBROOK` (chapter · location); right = **mute** control. (b) **Narration page** (torn parchment, flex-fills, scrolls): the session log. (c) **Input dock**: leather pill — arcane "inkwell" dot, italic `What do you do?` field, circular ember send button. (d) **Journal tab bar**: four leather tabs with rounded tops.
- **Session-log entry types** (styled distinctly, no chat bubbles):
  - *Chapter* — centered small-caps + brass rule.
  - *DM narration* — 16px Spectral `ink`; the first beat gets an **illuminated drop-cap** (Cormorant, ember).
  - *Player action* — indented, `ember-deep` left rule, small-caps `YOU` label, italic `ink-dim` text.
  - *HP / rules event ("surface on change")* — a small torn wax-note, rotated ~-2.5°, ember, glowing: e.g. `−6 hp · the wolf's tooth`. This is how damage/among status reaches the player — **not** a persistent HP bar.
  - *Story event* — centered arcane divider (e.g. `OLD WICK THISTLEWOOD ENTERS THE TALE`) on first NPC appearance.
  - *Image reveal* — a framed art plate + small-caps caption, inline in the flow, when art was generated this turn.
  - *Loading* — flame glyph (`flicker`) + "The Dungeon Master is weaving what happens next" with pulsing ellipsis.
- **Tabs:** `Self` carries a live **wax-seal HP** (glowing ember disc with a hairline crack + `18/24`) — the seal is the only always-visible vitality cue, and it only draws the eye because it just changed. `Folk`, `Quest`, `Views` show a small brass glyph + small-caps label.
- **API:** send → `POST /campaigns/:id/turns { message }` → `{ narration, sessionId, isError }`. **The loading state is mandatory and can last real seconds** when the turn triggers image generation (synchronous today). Log is hydrated from `currentSessionLog` (markdown). Image plates load from `GET /campaigns/:id/images/:filename` (auth-gated), filename read from the entity's state entry.

### 3. Panel — Self (character sheet)
- **Purpose:** the deliberate check-in; full mechanical detail lives here (and only here).
- **Layout (bottom sheet, torn parchment, grabber + title `CHARACTER` + ✕):** portrait plate (or no-likeness) + name / class-level / **XP bar** (arcane) with `2,700 / 3,400 xp to level 4`; a three-up **Vitality / Armour / Speed** row (Vitality = flame + `18/24` in ember); **Conditions** chips (e.g. `Wounded`, ember); **Abilities** 3×2 grid (STR–CHA with modifiers, arcane mods); **Spell slots** (1st) as filled/spent pips; **Purse** — all five denominations as coloured coins (`1 pp · 23 gp · 0 ep · 8 sp · 12 cp`, zeros shown); **Carried** inventory list with italic notes.
- **API:** `characterSheet` JSON from `GET /state` — HP, AC, conditions, XP, spell slots, `currency:{cp,sp,ep,gp,pp}`, inventory, `portraitImage` (filename or absent). Show all five currency denominations even when 0.

### 4. Panel — Folk (NPC roster)
- **Purpose:** who you've met and what they know.
- **Layout:** list of NPC rows — 56×64 portrait plate **or** a dashed "no likeness" tile; name (small-caps), small-caps disposition tag (color-keyed: brass = notable/fair, faint = neutral/unknown), italic note.
- **No-likeness is the common case** and is styled as an in-world absence, never an error. Example roster mixes one illustrated NPC (Old Wick) with two un-illustrated (Gate-warden Bram, the turnip-seller).
- **API:** `npcRoster` markdown from `GET /state`; image filename present on an entry only once generated.

### 5. Panel — Quest log
- **Layout:** `ACTIVE` quests (title, italic detail, step checklist with wax-stamp checks — done steps strike through, arcane fill) → `THREADS` (open questions, dimmed) → `CLOSED` (struck-through, arcane check).
- **API:** `questLog` markdown from `GET /state`.

### 6. Panel — Views (scene gallery / scrapbook)
- **Purpose:** the dedicated place to look back on generated art (an explicitly-requested feature).
- **Layout:** header count `3 of 14 illustrated · most faces and places are never drawn`; 2-column grid mixing **filled plates** (type label + name over a scrim, tappable → lightbox) and **no-likeness tiles** (dashed, "— no likeness —"). The empty state dominating the grid is intentional and correct.
- **API:** there is **no "list images" endpoint** — gallery is assembled by reading image filenames out of `worldState` / `npcRoster` / `characterSheet` entries and fetching each via `GET /images/:filename`.

### 7. Lightbox
- Full-width image on a near-black scrim, small-caps type label + name + `first drawn · Session N`; tap anywhere to close.

### 8. Settings
- **Purpose:** the model/art/world/connection controls; also the required LAN connection fields.
- **Sections & controls:**
  - `THE ENGINE` — three selectable **model** rows (label + served description + radio), with the note "Locked once a story is underway."
  - `THE LOOK` — **Generate scene art** toggle (note: "Off by default · needs Grok Build configured"); **Art style** = 8 preset chips (single-select) **plus a free-text "or describe your own…" field** (typing sets a custom style and de-selects presets; picking a preset clears the custom text).
  - `THE WORLD` — **Setting** free-text ("empty keeps standard fantasy", placeholder "underwater merfolk city-states…"); **Tone & whimsy** slider 0–1 with a live word label (Grounded → Deeply strange); **Content intensity** = Standard / Low segmented, each with a note.
  - `THE HEARTH` — italic clarifier *"Your phone only talks to your home server over the LAN — that server is what reaches out to Claude and Grok."*; **Server address** (monospace); **Passphrase** (monospace, masked); connection status dot + **Test** button.
- **API:** `GET/POST /campaigns/:id/settings` for `{ model, artStyle?, worldSetting?, toneWhimsy(0–1), contentIntensity('standard'|'low'), generateImages }`. Model options + their fidelity/cost descriptions come from `GET /models` — **do not hardcode** those descriptions. Server address + passphrase are stored client-side and sent as the `X-Chronicle-Token` header (see Auth).

---

## Interactions & Behavior
- **Navigation:** Home ↔ Settings ↔ Play are screen swaps (`fadeIn`). Tabs open a bottom-sheet panel (`sheetUp`) over Play with a scrim; tapping the scrim, the ✕, or the grabber closes it. Gallery tiles open the lightbox; tap-anywhere closes.
- **Send a turn:** disabled while a turn is in flight; on submit, append the player action immediately, show the flame "weaving…" loader, then append the DM narration when the response resolves. **Never assume instant** — image-generating turns take seconds.
- **Mute:** single tap, always at the top-right of Play; toggles between three brass sound-bars and bars + ember slash (dimmed). It must remain a one-tap, always-visible control (adaptive music is planned but not yet built — design it in now).
- **"Surface on change":** status (HP/conditions) is pushed into the narration flow as wax-notes at the moment it changes, and mirrored on the Self wax-seal; there is no ambient HP readout on the reading surface.
- **Empty/pending art:** "no likeness yet" renders as a normal, expected state everywhere art can appear (roster, gallery, portraits) — styled in-world, never as an error.

## State Management
Prototype state (see the logic class in `Chronicle.dc.html`):
```
screen: 'home' | 'play' | 'settings'
panel:  null | 'self' | 'folk' | 'quest' | 'views'
lightbox: <galleryItem> | null
input: string          sending: boolean        muted: boolean
hp / hpMax             artCustom: string       messages: SessionLogEntry[]
settings: { model, artStyle, worldSetting, toneWhimsy, contentIntensity,
            generateImages, serverAddress, passphrase }
```
Real data source: `GET /campaigns/:id/state` hydrates the log + all four panels; `GET /settings` + `GET /models` hydrate Settings. `messages` is append-only (mirror of `currentSessionLog`). `model` is locked once a session has started.

---

## Backend contract (authoritative)
Full text in **`backend-contract.md`** (copied into this bundle). Essentials:
- **Auth:** every route requires header `X-Chronicle-Token: <shared passphrase>`; 401 otherwise. Single household LAN secret, no user accounts. Address + passphrase entered in Settings → The Hearth, stored client-side.
- **Endpoints:** `POST /campaigns/:id/session/start` · `POST /campaigns/:id/turns` · `GET /campaigns/:id/state` · `GET/POST /campaigns/:id/settings` · `GET /models` · `GET /campaigns/:id/images/:filename`.
- **Image trigger points** (generated once, on first creation): character portrait, first major-NPC appearance, first significant-location entry, notable item, boss reveal. Failure never blocks narration — the entity simply has no image.
- **Image filenames:** `<entity-type>-<slug>.<ext>` e.g. `location-millbrook-town-square.jpg`, `npc-old-wick-thistlewood.jpg`; the path lives in that entity's state entry.
- **Not the UI's concern / not built yet:** video, multi-user identity. SRD rules adjudication + travel/rumor content are pending but don't change any API shape.

---

## Assets
All images in `assets/` are **AI-placeholder stand-ins** (procedurally generated for the mock), sized/framed to match the real pipeline. Replace with Grok Build output using the entity-type-slug filenames above.
| File | Role | Real equivalent |
|---|---|---|
| `scene-millbrook.png` | Home card + narration reveal + gallery (location) | `location-millbrook-town-square.*` |
| `portrait-thistlewood.png` | Folk + gallery (NPC) | `npc-old-wick-thistlewood.*` |
| `portrait-wren.png` | Self + Home avatar + gallery (character) | character portrait |
| `parchment-warm.png` | tiling parchment page fill | UI texture (ship with app) |
| `leather-warm.png` | tiling leather chrome fill | UI texture (ship with app) |

The app appends the **`artStyle`** setting to every generation prompt, so keep base prompts style-agnostic. Landscape ~3:2 for locations, ~4:5 for portraits. Fonts are Google Fonts (Cormorant, Cormorant SC, Spectral) — bundle them for offline/native use.

## Files in this bundle
- `Chronicle.dc.html` — the hi-fi prototype (visual source of truth; open via a static server).
- `ios-frame.jsx`, `support.js` — device-frame component + the prototype's runtime (needed to run the reference; **not** part of the app to build).
- `assets/` — placeholder art + textures.
- `backend-contract.md` — the full backend/API brief.
- `README.md` — this document.

## Design intent — please preserve
1. **A book with a dice tray, not a dashboard with a chat box.** Minimal persistent chrome.
2. **Status surfaces on change**, woven into the narrative; no ambient HP bar on the reading surface.
3. **Full mechanical detail is a deliberate check-in** (the Self sheet), not always-on.
4. **"No likeness yet" is normal and common**, styled in-world.
5. **A real "DM is thinking/weaving" state** — turns can take real seconds.
6. **Mute is always one tap**, never buried.
7. **A dedicated gallery** for looking back on scene art.
8. **All five currency denominations**; **model locked** mid-story.
