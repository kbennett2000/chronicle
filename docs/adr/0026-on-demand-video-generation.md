# 0026 — On-demand video-clip generation (Grok Imagine)

## Status
Accepted

## Context
Chronicle generates still images through the Grok Build `grok` CLI's `/imagine`
(ADR-0001's decoupled asset engine; on-demand path in ADR-0009). Issue #118 asks
to add **short video clips** via the same CLI's `/imagine-video`, using the same
scene prompt that drives a still, and to make the clip parameters (duration,
resolution, aspect ratio) configurable at both the account and per-campaign
level.

Two properties of video shape the design:

- **Cost/latency.** Clips are markedly slower and more expensive than stills
  (the issue notes cap clips at ~15s and recommend 6–10s for stability). Auto
  generating one at every "key moment" the way images work would be costly and
  slow every turn.
- **Consistency.** The recommended Grok workflow is two-step: perfect a still
  first, then animate *that image* so motion is added to a fixed composition.

## Decision

### On-demand only — the DM never generates video
Unlike `generateImages`, there is **no DM-engine tool and no auto path** for
video. A clip is only ever produced by an explicit player action ("Animate"),
invoked outside a turn via a new authenticated route
**`POST /campaigns/:id/animate`** (a direct analog of `/illustrate`):

- `{ kind: "moment", turnIndex, description? }` — animate a specific DM
  response. The clip's relative path is persisted onto that transcript record.
- `{ kind: "entity", entityType, name, description? }` — animate a known
  character / NPC / location; the path is recorded into the same state files the
  portrait uses, under a **distinct** field so a clip never overwrites its still
  (`portraitVideo` on `character-sheet.json`; a `- **Portrait video ID:**`
  bullet; an indented `- Video:` line).

Served back through **`GET /campaigns/:id/videos/:filename`**, the same
authenticated, path-traversal-guarded shape as the images route, with a
`VIDEO_CONTENT_TYPES` map (`.mp4`/`.webm`/`.mov`).

### `generateVideos` is an opt-in visibility toggle
A boolean `generateVideos` (default absent/false, copy-on-create like
`generateImages`) gates whether the "Animate" affordances appear. It is opt-in
because — exactly like images — it depends on Grok Build being installed and
authenticated on the host. The on-demand endpoint itself, like `/illustrate`,
works whenever Grok is reachable.

### Base image passed by path, not session context
The natural Grok phrasing is `/imagine-video use the image I just generated`,
which relies on **session context**. That context does **not** survive here:
every generation runs in a fresh `mkdtemp` working directory with a fresh
session (the issue #60 isolation model — Grok is a full coding agent and must
never run against the repo). So the two-step workflow uses the explicit-path
form: the existing still is copied into the throwaway `workDir` and referenced by
a plain filename in the prompt (`/imagine-video base.jpg <motion>, 5 second
video, 480p, square`). `Read` is intentionally not among the denied tools, and
cwd *is* `workDir`, so a relative filename resolves. All other safety flags
(temp-dir isolation, `--deny` mutators, SIGKILL-on-timeout, salvage-locate,
never-throw) are identical to `generateImage`.

### Two-level, prompt-driven parameters
Grok's `/imagine-video` reads duration/resolution/aspect from prose, not flags.
The params are modeled as a `video?: UserVideo` block resolved field-by-field
**campaign override → user override → `.env` → code default** by
`resolveVideoConfig` — the same two-level machinery as music (ADR-0020). Code
defaults per the issue: **5-second, 480p, square.** Like `music`, the `video`
override is *excluded from the create-time seed* so a game live-tracks the
account default until explicitly overridden; `generateVideos` (the boolean) is
seeded copy-on-create like `generateImages`.

## Consequences
- A new generated-asset class (clips) lives in the campaign `videos/` dir,
  addressed either by a transcript record (moments) or a state-file field
  (entities) — mirroring how images split between the two.
- The NPC/location markdown writers are refactored to be field-label-parameterized
  so the video bullet/line reuses the exact section logic as the portrait one.
- Video generation cannot slow or block a DM turn: it is never on the turn path.
- The undocumented Grok session output layout is now depended on in a second
  place (`video-generator.ts`); the salvage scan checks both a `videos/` and the
  `images/` session subdir and video extensions, confirmed empirically.
