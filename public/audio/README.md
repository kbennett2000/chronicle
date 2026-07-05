# Ambient audio

`ambient.ogg` / `ambient.mp3` — Chronicle's candlelit ambient music bed
(issues #43, #53). A calm, warm 48-second pad that moves through a slow
Am→F→C→G chord progression with gentle chorus and a low airy wash. Vite copies
this `web/public/` tree into the build output (`../public/audio/`), which
`server.ts` serves.

Issue #53 note: the first version was seven sine partials that were all
harmonics of one 27.5 Hz fundamental, so they fused into a single static
organ-like tone. This version plays a real chord *voicing* and *progression*
instead, so it reads as evolving music rather than a drone.

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
