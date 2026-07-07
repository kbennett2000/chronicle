# ADR-0020: Music Playback (local files + Navidrome LAN stream)

## Status
Accepted and implemented

## Context
Issue #53: the "ambient music" was a single hand-synthesized bed that, through
several iterations, still read as one sustained tone, and Kris asked for real
music instead. The agreed direction: play the player's **own** music — either
local files dropped into the project, or a **Navidrome** playlist streamed from
a server on the LAN — chosen in the (now per-user, ADR-0019) settings screen.

## Decision
1. **Two sources, chosen per user:** `local` or `navidrome`. Music is opt-in
   (off by default); when enabled, a small transport in the Active Play header
   controls it (and is hidden when music is off). The transport is
   previous / play-pause / next alongside the mute button (issue #108). **Manual
   pause is a separate flag from mute:** playback resumes only when the track is
   both unmuted and not manually paused, so the two controls never override each
   other (unmuting does not un-pause; skipping tracks clears a manual pause).

2. **Local files:** a top-level `music/` folder (gitignored — it's the user's
   own media). Users drop `.mp3/.wav/.ogg/.flac/.m4a` files in, sub-foldered
   however they like. The server lists them and streams individual files (with
   HTTP Range support for seeking); the client shuffles and plays.

3. **Navidrome via a server-side proxy:** the Chronicle server talks to
   Navidrome's **Subsonic API** using credentials from `.env`
   (`NAVIDROME_URL/USER/PASSWORD/PLAYLIST`), resolves the playlist by name, and
   proxies track streams. The browser never sees Navidrome credentials and needs
   no cross-origin/CORS setup against Navidrome. Subsonic token auth
   (`t=md5(password+salt)`, `s=salt`) is used, not the password in the clear.

4. **Config resolution:** `.env` provides the defaults
   (`DEFAULT_MUSIC_ENABLED`, `DEFAULT_MUSIC_SOURCE`, `NAVIDROME_*`). A user may
   override `enabled`, `source`, and the Navidrome **URL/playlist** (but not the
   credentials, which stay server-side) via their account settings (`music` key
   in `/me/settings`, ADR-0019). Effective config = user override → `.env`.

5. **Audio auth via query-param token:** an `<audio>` element can't attach the
   `X-Chronicle-Token` header, and fetching whole tracks as blobs would defeat
   streaming/Range. So the auth gate also accepts the session token as a
   `?token=` query param, letting `<audio src="/music/...?token=…">` stream
   natively with seeking. Acceptable on a LAN (ADR-0003); the token is a
   revocable session token, not a durable secret.

## Consequences
- The old synthesized ambient bed (`public/audio/ambient.*`) stays on disk but
  is no longer the default path; local/Navidrome are the feature going forward.
- `music/` and Navidrome credentials never enter git.
- Query-param tokens can appear in server access logs; on a trusted LAN this is
  an accepted trade for native audio streaming. Not an internet-facing posture
  (ADR-0003 still governs exposure).
