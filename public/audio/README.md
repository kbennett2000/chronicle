# Ambient audio

`ambient.ogg` / `ambient.mp3` — Chronicle's candlelit ambient music bed
(issues #43, #53). A calm, warm 48-second piece: a low Am→F→C→G chord *pad*
with a **plucked arpeggio melody** over it and a **soft rhythmic pulse**
underneath. Vite copies this `web/public/` tree into the build output
(`../public/audio/`), which `server.ts` serves.

Issue #53 history: v1 (#43) was harmonics of one fundamental → a fused organ
tone. v2 (#53) added a chord progression but every voice still *sustained*, so
it read as one morphing drone. v3 (this file) adds discrete, enveloped events —
plucked notes with a fast attack + decay give audible onsets, and a slow pulse
gives tempo — so it reads as actual music, not a tone.

**Cache-busting:** the `<audio>` `<source>` URLs in `web/src/screens/Play.tsx`
carry a `?v=N`. The filename is fixed (not content-hashed), so **bump that `N`
every time you regenerate** — otherwise browsers keep playing the cached old
bed. `server.ts` also serves these with `Cache-Control: no-cache`.

## Licensing
**Original work, released as CC0 / public domain.** It contains no third-party
samples or recordings — it is pure additive synthesis authored in this repo by
`scripts/generate-ambient.mjs`. There is no attribution obligation.

## Regenerating
```
node scripts/generate-ambient.mjs /tmp/ambient.wav
ffmpeg -y -i /tmp/ambient.wav -c:a libvorbis -qscale:a 3 web/public/audio/ambient.ogg
ffmpeg -y -i /tmp/ambient.wav -c:a libmp3lame -qscale:a 5 web/public/audio/ambient.mp3
```
Then `cd web && npm run build` to refresh the copies under `../public/audio/`.

The loop is seamless by construction: every oscillator frequency and every
LFO/progression rate is an integer multiple of `1/DURATION`, so the tonal part
matches (value and slope) at the loop seam; the low noise bed is made periodic
with an equal-power crossfade of its own continuation back into its head. Do not
add a fade at the file ends — that would break the loop. `.ogg` is the primary
source (gapless); `.mp3` is a fallback for browsers that don't play Vorbis (a
tiny seam there is acceptable).
