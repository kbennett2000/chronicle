// Generates Chronicle's ambient music bed as an original, self-authored WAV
// (issues #43, #53). No samples, no third-party audio — just additive synthesis
// — so the committed loop carries no licensing obligation on this public repo
// (CC0 / original work). Run `node scripts/generate-ambient.mjs <out.wav>` then
// encode to ogg/mp3 (see web/public/audio/README.md).
//
// WHY THIS IS NOT A DRONE (issue #53): the first cut (issue #43) summed seven
// sine partials that were all harmonics of a single 27.5 Hz fundamental, so the
// ear fused them into one static organ pitch. This version instead plays an
// actual chord VOICING (spread thirds/fifths/octaves that don't collapse into
// one tone) and moves through a slow four-chord PROGRESSION, with per-chord
// swell, gentle chorus detune, and a quiet filtered-air bed — so it reads as
// evolving music, not a held tone. Mood: calm, warm, candlelit.
//
// SEAMLESS LOOP: every oscillator frequency and every LFO/progression rate is an
// integer multiple of 1/DURATION, so the tonal part matches (value AND slope) at
// t=0 and t=DURATION. The noise bed is made periodic with an equal-power
// crossfade of its own continuation back into its head. Do NOT add a fade at the
// file ends — that would break the loop; the movement comes from the progression
// and swells, which are already periodic over DURATION.

import fs from "node:fs";

const SR = 44100;
const DURATION = 48; // seconds — four chords, ~12s each; long enough to breathe
const CHANNELS = 2;

// Snap any frequency to the nearest k/DURATION so freq*DURATION is an integer
// (seamless). The shift is at most 1/96 Hz — inaudible — but it's what lets the
// waveform wrap without a click.
const q = (hz) => Math.round(hz * DURATION) / DURATION;

// Equal-temperament note frequencies (Hz), named for readability.
const N = {
  E2: 82.41, F2: 87.31, G2: 98.0, A2: 110.0, B2: 123.47,
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.0, A3: 220.0, B3: 246.94,
  C4: 261.63, E4: 329.63,
};

// A warm, resolving minor progression — Am → F → C → G — voiced low and close
// so it stays candlelit rather than bright. Each chord is 3–4 notes; the lowest
// note of each carries a touch more weight for warmth. `pan` (-1..1) spreads the
// voices for width without any extra oscillators.
const CHORDS = [
  // Am
  [ { f: N.A2, a: 1.0, pan: -0.15 }, { f: N.C3, a: 0.8, pan: 0.25 }, { f: N.E3, a: 0.75, pan: -0.3 }, { f: N.A3, a: 0.6, pan: 0.35 } ],
  // F  (F major — the A carries over, so the change is gentle)
  [ { f: N.F2, a: 1.0, pan: -0.2 }, { f: N.A2, a: 0.8, pan: 0.3 }, { f: N.C3, a: 0.72, pan: -0.28 }, { f: N.F3, a: 0.58, pan: 0.2 } ],
  // C
  [ { f: N.C3, a: 1.0, pan: -0.15 }, { f: N.E3, a: 0.78, pan: 0.28 }, { f: N.G3, a: 0.72, pan: -0.32 }, { f: N.C4, a: 0.5, pan: 0.3 } ],
  // G
  [ { f: N.G2, a: 1.0, pan: -0.2 }, { f: N.B2, a: 0.78, pan: 0.3 }, { f: N.D3, a: 0.72, pan: -0.25 }, { f: N.G3, a: 0.56, pan: 0.22 } ],
];

// Timbre per voice: a warm organ-ish stack (fundamental + soft octave + faint
// twelfth) plus a chorus partner detuned by 3/DURATION Hz (on-grid, so still
// seamless) for slow beating that keeps the pad alive.
const HARMONICS = [ { mult: 1, a: 1.0 }, { mult: 2, a: 0.2 }, { mult: 3, a: 0.07 } ];
const DETUNE_HZ = 3 / DURATION; // ~0.0625 Hz → ~16s beat period
const DETUNE_A = 0.6;

// Precompute per-voice oscillator terms (angular freq + random-but-fixed phase).
// Phases are deterministic (seeded by index) so regeneration is reproducible and
// Math.random() — unavailable in some sandboxes — isn't needed.
function phaseFor(k) {
  // cheap deterministic hash → [0,1)
  const x = Math.sin(k * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
let voiceId = 0;
const VOICES = CHORDS.map((chord) =>
  chord.map((note) => {
    const terms = [];
    for (const h of HARMONICS) {
      const f = q(note.f * h.mult);
      terms.push({ w: 2 * Math.PI * f, a: h.a, ph: 2 * Math.PI * phaseFor(voiceId++) });
    }
    // Detuned fundamental partner (chorus).
    const fd = q(note.f) + DETUNE_HZ;
    terms.push({ w: 2 * Math.PI * fd, a: DETUNE_A, ph: 2 * Math.PI * phaseFor(voiceId++) });
    const gainL = note.a * Math.sqrt(0.5 * (1 - note.pan));
    const gainR = note.a * Math.sqrt(0.5 * (1 + note.pan));
    return { terms, gainL, gainR };
  })
);

// Chord weight over the loop: a smooth, periodic raised-cosine bump centered on
// each chord's slot. Squared so chords are fairly distinct but still crossfade.
// Normalized per-sample (÷ sum) so total loudness stays constant through the
// progression. Being a function of θ = 2π t/DURATION, it's exactly periodic and
// C¹-continuous at the seam.
const NCHORDS = CHORDS.length;
function chordWeights(theta) {
  const w = new Array(NCHORDS);
  let sum = 0;
  for (let c = 0; c < NCHORDS; c++) {
    const center = (2 * Math.PI * c) / NCHORDS;
    const b = 0.5 + 0.5 * Math.cos(theta - center);
    const v = b * b; // sharpen
    w[c] = v;
    sum += v;
  }
  for (let c = 0; c < NCHORDS; c++) w[c] /= sum || 1;
  return w;
}

const outPath = process.argv[2] || "ambient.wav";
const total = SR * DURATION;

// ---- Tonal layer (inherently periodic) -------------------------------------
const left = new Float64Array(total);
const right = new Float64Array(total);
for (let i = 0; i < total; i++) {
  const t = i / SR;
  const theta = (2 * Math.PI * i) / total;
  const w = chordWeights(theta);
  let l = 0;
  let r = 0;
  for (let c = 0; c < NCHORDS; c++) {
    const wc = w[c];
    if (wc < 1e-4) continue;
    for (const v of VOICES[c]) {
      let s = 0;
      for (const term of v.terms) s += term.a * Math.sin(term.w * t + term.ph);
      l += wc * s * v.gainL;
      r += wc * s * v.gainR;
    }
  }
  left[i] = l;
  right[i] = r;
}

// ---- Air layer: quiet low-passed noise, made seamless by an equal-power -----
// crossfade of its own continuation back into its head. Deterministic PRNG so
// regeneration is reproducible.
function makeNoise(seed) {
  // Generate a touch past the loop so the tail has a natural continuation to
  // crossfade the head against.
  const XF = Math.floor(SR * 1.0); // 1s equal-power crossfade
  const raw = new Float64Array(total + XF);
  let s = seed >>> 0;
  const rand = () => {
    // xorshift32 → [-1,1)
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return (s / 0xffffffff) * 2 - 1;
  };
  // One-pole low-pass for a soft, airy wash (no harsh high end).
  const cutoffA = 0.02; // ~ gentle; smaller = darker
  let lp = 0;
  for (let i = 0; i < raw.length; i++) {
    lp += cutoffA * (rand() - lp);
    raw[i] = lp;
  }
  const out = new Float64Array(total);
  for (let i = 0; i < total; i++) out[i] = raw[i];
  // Blend the continuation (raw[total + i]) fading out against the head fading
  // in, over the first XF samples — makes out[total-1]→out[0] continuous.
  for (let i = 0; i < XF; i++) {
    const fin = Math.sin((Math.PI / 2) * (i / XF));
    const fout = Math.cos((Math.PI / 2) * (i / XF));
    out[i] = raw[i] * fin + raw[total + i] * fout;
  }
  return out;
}
const noiseL = makeNoise(0x1a2b3c4d);
const noiseR = makeNoise(0x5e6f7a8b);
const AIR_A = 2.2; // relative to the raw (very low-amplitude) lp noise; balanced below

// Normalize the air bed to a small target level, then mix under the tonal pad.
let airPeak = 1e-9;
for (let i = 0; i < total; i++) airPeak = Math.max(airPeak, Math.abs(noiseL[i]), Math.abs(noiseR[i]));
const airGain = (0.06 / airPeak) * AIR_A;
for (let i = 0; i < total; i++) {
  left[i] += noiseL[i] * airGain;
  right[i] += noiseR[i] * airGain;
}

// ---- Normalize to a safe peak (never clip) and write 16-bit PCM WAV ---------
let peak = 0;
for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
const gain = 0.72 / (peak || 1); // ~ -2.85 dBFS headroom

const bytesPerSample = 2;
const dataBytes = total * CHANNELS * bytesPerSample;
const buf = Buffer.alloc(44 + dataBytes);
buf.write("RIFF", 0);
buf.writeUInt32LE(36 + dataBytes, 4);
buf.write("WAVE", 8);
buf.write("fmt ", 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20); // PCM
buf.writeUInt16LE(CHANNELS, 22);
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * CHANNELS * bytesPerSample, 28);
buf.writeUInt16LE(CHANNELS * bytesPerSample, 32);
buf.writeUInt16LE(16, 34);
buf.write("data", 36);
buf.writeUInt32LE(dataBytes, 40);

let off = 44;
for (let i = 0; i < total; i++) {
  const l = Math.round(Math.max(-1, Math.min(1, left[i] * gain)) * 32767);
  const r = Math.round(Math.max(-1, Math.min(1, right[i] * gain)) * 32767);
  buf.writeInt16LE(l, off);
  buf.writeInt16LE(r, off + 2);
  off += 4;
}

fs.writeFileSync(outPath, buf);
console.log(
  `wrote ${outPath} — ${DURATION}s ${SR}Hz stereo, Am→F→C→G pad, peak-normalized (gain ${gain.toFixed(3)})`
);
