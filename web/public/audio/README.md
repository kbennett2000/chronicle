# Ambient audio

`ambient.ogg` / `ambient.mp3` — Chronicle's candlelit ambient music bed
(issue #43). Vite copies this `web/public/` tree into the build output
(`../public/audio/`), which `server.ts` serves.

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

The loop is seamless by construction: every partial and LFO frequency is an
integer multiple of `1/DURATION`, so the waveform matches at the loop seam.
`.ogg` is the primary source (gapless); `.mp3` is a fallback for browsers that
don't play Vorbis (a tiny seam there is acceptable).
