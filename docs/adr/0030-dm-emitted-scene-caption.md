# ADR-0030: DM-emitted inline scene caption for moment images

## Status
Accepted. Amended by the "Reliability amendment (Issue #130)" section below —
the caption is reframed from a numbered "exception to rule 17" into a required
OUTPUT FORMAT contract, and a missing caption is backstopped by one free
same-session retry.

## Context
Scene/moment images (the user-triggered "Illustrate this moment" and its
"Animate" sibling) look good and hold their art style, but they are not *about
the actual moment*. The root cause is the description source: both moment seams
feed the **raw turn narration** to the image/video model.

- `src/server.ts` `/illustrate` moment branch:
  `(override || record.narration.trim()).slice(0, 500)`.
- `src/server.ts` `/animate` moment branch: the same construction.
- Auto-illustrate has no separate route — the web client calls `/illustrate`
  with no `description`, so it too lands on the narration fallback.

Turn narration is second-person story prose with interiority, dialogue, and
time-passage that an image model cannot render. Handed that slab, the model
scavenges stray concrete nouns and produces a pretty but off-moment image.

Everything *downstream* of the description is already correct and shared:
`buildImagePrompt` (ADR-0004/0028) leads with the weighted art-style clause and
appends the anti-drift scene negatives, and both the local (ComfyUI/SDXL) and
grok backends only prepend style — neither re-derives the description. So the
fix belongs **upstream, at the description source**, where it benefits both
backends without touching either backend's internals.

The **character/entity image path is already correct and separate**: the MCP
`generate_image` tool + `mergeCharacterAppearance` use a curated per-entity
visual description, never `record.narration`. It must stay byte-identical.

The obvious fix — distill the narration into a caption with a cheap one-shot
model call — was considered and **rejected**: it requires configuring and
paying for an API key, and the app deliberately runs the DM engine on the
Claude subscription (`ANTHROPIC_API_KEY` unset). We do not want to stand up a
paid, separately-keyed call, nor risk flipping the DM engine onto per-token
billing, for a caption we can get for free.

## Decision

### The DM emits the caption inline, for free, as part of the turn it already writes
The DM already generates every turn on the subscription. So the DM itself
produces the visual caption: it ends each reply with exactly one final,
machine-readable line of the form

```
[SCENE: <one short third-person, present-tense visual description of this moment>]
```

— concrete subject(s), setting, action, lighting/mood, notable objects; no
second person, no dialogue, no inner thoughts, no passage of time, and **no
art-style/medium words** (style is still added downstream by
`buildImagePrompt`, so duplicating it here would double it). There is **no
separate model call anywhere in this design**.

The instruction lives in `systemPrompt()` (`src/dm-engine.ts`), the single
prompt builder shared by both the Claude and Grok backends, so one rule covers
both. It is worded as the **sole explicit exception to the existing
no-backstage rule** (everything-you-output-is-player-facing), and it instructs
the DM to keep the line out of the append-only session-log entry. The turn-zero
`openingDirective()` gets a matching closing-line instruction, since its "write
only the in-world scene, no meta commentary" wording would otherwise suppress
the caption on the opening turn.

### Parse, strip, and store at the server — one choke point
The turn text (`result.text`, already run through `stripMetaChatter` inside the
backend; no existing pattern touches `[SCENE:]`, so the line survives as the
final line) is parsed at the server's three turn handlers (`/turns`,
`/opening`, edit re-run). A new pure helper `extractSceneCaption(text)` in
`src/narration.ts` returns `{ narration, sceneCaption? }`: the caption's inner
text, and the narration with the `[SCENE:...]` token(s) removed. The three
handlers then use the **stripped narration** everywhere the raw text was used —
the JSON response to the client and `appendTurnTranscript` — so the caption
never reaches the UI, and the stored `narration` is clean.

Because turn delivery is **non-streaming** (the server sends the fully-assembled
narration in one JSON response; the engine's `onText` hook is a no-op at every
call site), the trailing `[SCENE:]` line can never flash to the player during
generation — a synchronous strip before the response is sufficient. The
frontend renders narration as plain pre-wrap text, so an unstripped line *would*
show verbatim; stripping at the server is what prevents that.

### Cache on the turn record; seams prefer it
`TurnTranscriptRecord` gains an additive optional `sceneCaption?: string`
(same absent-means-unset semantics as `image`/`video`; no migration, records
are parsed untyped). `appendTurnTranscript` takes it as a new argument and
writes it at append time — the caption is known then, so no separate
read-modify-rewrite setter is needed (unlike `image`/`video`, which are
attached after the fact).

A second pure helper `resolveMomentDescription(override, record)` encodes the
seam precedence: explicit user **override** (the existing refine behavior, e.g.
"the same scene at night") → cached **`record.sceneCaption`** → **narration**
fallback. Both moment seams call it instead of reading `record.narration`
directly, keeping the downstream `.slice(0, 500)` + `"a scene from the story"`
backstop. `/animate` reads the same field, so a moment's still and its later
animation share one caption.

### Graceful fallback — illustration never breaks
If a turn has no `[SCENE:]` line (the model omitted it, or it was an error turn,
where the text is intentionally left un-stripped and un-parsed), `sceneCaption`
is simply absent and the seam falls through to today's narration behavior.
Nothing new can fail the illustrate/animate path.

## Alternatives considered
- **Cheap one-shot distillation via the Messages API** (a `captionForScene`
  helper calling a small model like Haiku). Rejected: needs a configured, paid
  API key; the app intentionally runs on the Claude subscription with no key,
  and we won't add paid infrastructure — or risk moving the DM engine onto
  per-token billing — for a caption the DM can emit for free inline.
- **Strip the caption inside `stripMetaChatter`.** Rejected: that function runs
  inside the backend and returns only a cleaned string, so it would discard the
  caption before the server could capture it. We parse at the server instead,
  where both the caption and the stripped narration are available.
- **A separate MCP tool the DM calls to record the caption** (like
  `generate_image`). Rejected as heavier than needed: an inline trailing line is
  parseable with a regex, adds no tool round-trip, and reuses the turn the DM
  already writes. The entity path already owns the tool-based description; the
  moment path only needs one line.
- **Store the caption but keep feeding narration to the seams.** Rejected: it
  would defeat the purpose — the seams must consume the caption for the image to
  match the moment.

## Consequences
- Scene/moment images (and their animations) are drawn from a concentrated,
  style-neutral, present-tense visual caption of the moment instead of a prose
  slab — the still now matches what just happened. Style is still applied
  downstream, unchanged.
- Both image backends benefit with **no backend changes** — the fix is entirely
  upstream at the description source.
- The character/entity path is untouched and byte-identical.
- Every existing turn without a caption, and every turn where the model omits
  the line, degrades gracefully to today's narration behavior — no migration,
  no new failure mode on the illustrate/animate path.
- The DM prompt now carries one deliberate non-narration output convention
  (`[SCENE:]`), the single documented exception to the no-backstage rule; the
  server strips it so it stays invisible to the player. The append-only `.md`
  session log is kept clean at the prompt level (the DM is told not to include
  the line in its log entry), since the server has no write seam there.
- Grok occasionally finishes a turn with empty text (a known intermittent
  issue); on those turns there is simply no caption and the narration fallback
  applies. The shared prompt means both backends emit the line whenever they
  produce prose.

## Reliability amendment (Issue #130)

The original decision worked but leaned entirely on the model choosing to emit
the line. In live play the DM **routinely omitted** it, so `record.sceneCaption`
was null and scene images silently fell back to the narration slab — the very
failure this ADR set out to fix (verified: a live turn showed `sceneCaption:
None`). Two changes make the caption reliable, still with **no new model, API
key, paid call, or HTTP client** — any retry reuses the same DM engine on the
same subscription via the existing `backend.runTurn(...)`/session path.

### Part A — reframe the prompt as a required output contract
The caption is no longer a numbered story rule framed as "the sole exception to
rule 17" (that framing was too weak — buried mid-list, it read as an aside). It
now lives in its **own `OUTPUT FORMAT` section pushed last** onto the assembled
system prompt in `systemPrompt()`, so it is the final thing the model reads
before generating. It is stated as a hard contract: every reply is (1) narration
then (2) a mandatory final `[SCENE: ...]` line, and a reply is *incomplete*
without it. The content rules are unchanged (one line; third-person; present
tense; visual only; no second person/dialogue/inner-thoughts/time-passage/
art-style words; never in the session-log append). `openingDirective()` (turn 0)
points at the same OUTPUT FORMAT contract instead of its old "sole exception"
wording.

### Part B — one free same-session retry when the line is missing
When a turn is parsed and no `[SCENE:]` line is found, the server makes **exactly
one** follow-up request to the **same DM session** (`resumeSessionId` = the
turn's own session id) whose whole prompt (`SCENE_CAPTION_RETRY_PROMPT`) asks
only for the caption line for the turn just narrated, and forbids any narration
or file/session-log writes. Its reply is parsed by `parseRetryCaption` (which
accepts a proper `[SCENE:]` line or a bare sentence) and patched onto the record
via the new `setTranscriptRecordSceneCaption` setter — the post-hoc analog of
`setTranscriptRecordImage`/`Video`, needed because the caption now arrives after
the record was appended.

Constraints that keep it safe and non-disruptive:
- **Never blocks the player.** The retry runs *after* the narration response is
  already sent (narration is captured, stripped, persisted, and returned first);
  the caption is best-effort and only gates the image.
- **At most one retry, no loop.** `retrySceneCaption` invokes the injected
  engine call exactly once; on an engine error, an empty reply, or a throw it
  returns `undefined` and the record stays captionless → the seams fall back to
  narration (today's behavior). A turn never hangs or breaks over a missing
  caption.
- **Session single-flight preserved.** The caller still holds the `busy` lock
  across the retry, so the resume can't race a concurrent player turn (issue
  #31).
- **The narrative thread stays clean.** `active.sessionId` is *not* advanced to
  the retry's returned session id, so the throwaway caption Q&A never enters the
  next narrative turn's resumed history.
- **Engine-agnostic.** The retry dispatches through the same `getBackend(...).
  runTurn(...)` seam, so it works for whichever backend ran the turn — Claude
  (Agent SDK resume) or Grok (`--resume`). For Grok's known empty-text turns the
  retry may also be empty, which the narration fallback already covers.

`extractSceneCaption`, `resolveMomentDescription`, the two moment seams, the
`sceneCaption` record field, and both image backends are unchanged — the
reliability work is confined to the prompt (`dm-engine.ts`), the parse/retry
helpers (`narration.ts`), the post-hoc setter (`campaign-store.ts`), and the
three turn handlers (`server.ts`).
