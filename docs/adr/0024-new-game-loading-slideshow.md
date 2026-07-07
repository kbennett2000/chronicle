# ADR-0024: New-game loading slideshow of past-game art

## Status
Accepted

## Context
Starting a brand-new game blocks on the DM engine generating the opening scene —
a genuinely long wait (the whole point of the file-backed engine is a rich,
grounded first turn, which takes time). During that wait the Play screen shows
only `OpeningSceneLoader`: a flickering ember and "Weaving the opening of your
tale…". It's correct but empty, and it reads as "is this stuck?" (issue #105).

A returning player has usually accumulated generated art from prior campaigns —
character portraits, NPCs, locations, illustrated moments — sitting in each
campaign's `images/` directory. That art is a natural, on-brand thing to show
while they wait.

Constraints from the request: only if the player actually has prior images;
smooth, slow cross-dissolves (nothing sharp or jarring); ~7s per image
(tunable); tasteful, blends with the existing UI.

## Decision
Show a dim, slowly cross-fading slideshow of the player's **own** past-game
images behind the existing opening loader.

**Backend.** A new authenticated route `GET /past-images` (optionally
`?exclude=<campaignId>` to skip the game being started) returns
`[{ campaignId, filename }]` for every image across the caller's campaigns,
backed by `listCampaignImages(userId, exclude)` in `campaign-store.ts` — one
`readdirSync` of each campaign's `images/` dir, filtered to image extensions. No
image bytes are served here; each ref is loaded through the existing
`GET /campaigns/:id/images/:filename` route. Like every route, `userId` comes
from the session, never the URL (ADR-0019), so a player can only ever see their
own art — this introduces a cross-*campaign* read but never a cross-*user* one.

**Frontend.** `LoadingSlideshow` (`web/src/components/LoadingSlideshow.tsx`)
fetches the list, shuffles it, caps it (16 images) so a large back-catalogue
can't pull tens of MB for a few-second screen, and loads each as a `blob:` URL
via the existing `fetchImageBlob` (the image route needs an auth header a bare
`<img src>` can't attach). Two stacked layers cross-dissolve via an opacity
transition, held 7s each, with a very slow drift-zoom (`@keyframes
slideshowDrift`) so held frames feel alive. A radial scrim keeps the ember and
loader text legible on top. Object URLs are revoked on unmount.

If the player has no prior images (or the list can't be fetched), the component
renders nothing and the loader looks exactly as it did before — a first-time
player is never worse off.

## Consequences
- Cheap: no full campaign state loads — one directory read per campaign, only on
  the new-game loading screen.
- The display interval (7s) and image cap (16) are named constants, easy to tune.
- Bounded memory and no leaks (capped set, URLs revoked on unmount).
- New cross-campaign read pattern on the backend; kept strictly within the
  caller's own campaigns root, consistent with ADR-0019.
- Reuses existing primitives (`fetchImageBlob`, the per-campaign image route,
  `listCampaigns`' campaign-enumeration approach) rather than adding a new
  image-serving path.
