// Generates Chronicle's ambient music bed as an original, self-authored WAV
// (issues #43, #53). No samples, no third-party audio — just additive synthesis
// — so the committed loop carries no licensing obligation on this public repo
// (CC0 / original work). Run `node scripts/generate-ambient.mjs <out.wav>` then
// encode to ogg/mp3 (see web/public/audio/README.md).
//
// WHY THIS IS NOT A DRONE (issue #53, second pass): the first cut (#43) was one
// fused organ pitch; the second (#53 v1) was an evolving *pad* — a real chord
// progression, but every voice sustained continuously with no note onsets, so
// it still read as one morphing tone. This version adds what actually makes the
// ear hear *music*: discrete, enveloped events.
//   1. A plucked ARPEGGIO MELODY — harp/music-box-like notes with a fast attack
//      and exponential decay, so each note has an audible onset (a transient),
//      arpeggiating the current chord.
//   2. A soft rhythmic PULSE — a low, gentle mallet thump on a slow beat grid,
//      giving a sense of tempo/heartbeat.
//   3. The chord PAD from the previous version, kept but dropped in level so it
//      is a warm bed under the melody rather than the whole sound.
// Mood stays calm, warm, candlelit.
//
// SEAMLESS LOOP: the pad's oscillators/LFOs are integer multiples of 1/DURATION
// (as before). The plucked notes and pulses are rendered with WRAP-AROUND: each
// enveloped event is summed into the buffer modulo DURATION, and both patterns
// repeat an integer number of times over DURATION, so a note whose tail crosses
// the loop point simply continues at the head — the seam is continuous by
// construction. Do NOT add a fade at the file ends; it would break the loop.

import fs from "node:fs";

const SR = 44100;
const DURATION = 48; // seconds — four chords, ~12s each; long enough to breathe
const CHANNELS = 2;
const total = SR * DURATION;

// Snap any frequency to the nearest k/DURATION so freq*DURATION is an integer
// (seamless for the sustained pad). Harmless for the enveloped notes too.
const q = (hz) => Math.round(hz * DURATION) / DURATION;

// Equal-temperament note frequencies (Hz), named for readability.
const N = {
  E2: 82.41, F2: 87.31, G2: 98.0, A2: 110.0, B2: 123.47,
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.0, A3: 220.0, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0,
};

// A warm, resolving minor progression — Am → F → C → G — voiced low and close
// so it stays candlelit. `pan` (-1..1) spreads the voices for width.
const CHORDS = [
  // Am
  [ { f: N.A2, a: 1.0, pan: -0.15 }, { f: N.C3, a: 0.8, pan: 0.25 }, { f: N.E3, a: 0.75, pan: -0.3 }, { f: N.A3, a: 0.6, pan: 0.35 } ],
  // F
  [ { f: N.F2, a: 1.0, pan: -0.2 }, { f: N.A2, a: 0.8, pan: 0.3 }, { f: N.C3, a: 0.72, pan: -0.28 }, { f: N.F3, a: 0.58, pan: 0.2 } ],
  // C
  [ { f: N.C3, a: 1.0, pan: -0.15 }, { f: N.E3, a: 0.78, pan: 0.28 }, { f: N.G3, a: 0.72, pan: -0.32 }, { f: N.C4, a: 0.5, pan: 0.3 } ],
  // G
  [ { f: N.G2, a: 1.0, pan: -0.2 }, { f: N.B2, a: 0.78, pan: 0.3 }, { f: N.D3, a: 0.72, pan: -0.25 }, { f: N.G3, a: 0.56, pan: 0.22 } ],
];
const NCHORDS = CHORDS.length;

// Per-chord melodic arpeggio (higher octave so it sits above the low pad and is
// clearly heard). Each is an 8-step up-and-back contour over that chord's tones.
const ARPS = [
  [N.A4, N.C5, N.E5, N.A5, N.E5, N.C5, N.E5, N.C5], // Am
  [N.F4, N.A4, N.C5, N.F5, N.C5, N.A4, N.C5, N.A4], // F
  [N.G4, N.C5, N.E5, N.G5, N.E5, N.C5, N.E5, N.C5], // C
  [N.G4, N.B4, N.D5, N.G5, N.D5, N.B4, N.D5, N.B4], // G
];

const left = new Float64Array(total);
const right = new Float64Array(total);

// ---- Layer 1: sustained chord PAD (kept, but quieter) -----------------------
// A warm organ-ish stack + a chorus partner detuned by an on-grid amount for
// slow beating. Chord weight is a periodic raised-cosine bump so the four chords
// crossfade smoothly across the loop.
const PAD_LEVEL = 0.5; // dropped from 1.0 so the melody sits on top
const HARMONICS = [ { mult: 1, a: 1.0 }, { mult: 2, a: 0.2 }, { mult: 3, a: 0.07 } ];
const DETUNE_HZ = 3 / DURATION;
const DETUNE_A = 0.6;
function phaseFor(k) {
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
    const fd = q(note.f) + DETUNE_HZ;
    terms.push({ w: 2 * Math.PI * fd, a: DETUNE_A, ph: 2 * Math.PI * phaseFor(voiceId++) });
    const gainL = note.a * Math.sqrt(0.5 * (1 - note.pan));
    const gainR = note.a * Math.sqrt(0.5 * (1 + note.pan));
    return { terms, gainL, gainR };
  })
);
function chordWeights(theta) {
  const w = new Array(NCHORDS);
  let sum = 0;
  for (let c = 0; c < NCHORDS; c++) {
    const center = (2 * Math.PI * c) / NCHORDS;
    const b = 0.5 + 0.5 * Math.cos(theta - center);
    const v = b * b;
    w[c] = v;
    sum += v;
  }
  for (let c = 0; c < NCHORDS; c++) w[c] /= sum || 1;
  return w;
}
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
  left[i] += l * PAD_LEVEL;
  right[i] += r * PAD_LEVEL;
}

// ---- Layer 2: plucked ARPEGGIO MELODY (the "it's music now" layer) ----------
// Discrete notes with a fast attack + exponential decay → an audible onset per
// note. Rendered with wrap-around so the loop seam is continuous. Chord slot is
// picked from note time so the melody follows the Am→F→C→G progression.
const MEL_NOTES = 64; // notes over the loop (integer → seamless), 0.75s apart
const MEL_INTERVAL = total / MEL_NOTES;
const NOTES_PER_CHORD = MEL_NOTES / NCHORDS; // 16
const MEL_ATTACK = Math.floor(SR * 0.005); // 5 ms — crisp onset
const MEL_TAU = 0.34; // s — exponential decay time constant
const MEL_TAIL = Math.floor(SR * 1.6); // render window per note (~4.7 tau)
const MEL_LEVEL = 0.42;
// Harp-ish timbre: fundamental + a couple of quiet harmonics.
const MEL_PARTIALS = [ { mult: 1, a: 1.0 }, { mult: 2, a: 0.5 }, { mult: 3, a: 0.22 } ];
for (let k = 0; k < MEL_NOTES; k++) {
  const start = Math.round(k * MEL_INTERVAL);
  const chord = Math.floor(k / NOTES_PER_CHORD) % NCHORDS;
  const step = k % ARPS[chord].length;
  const freq = q(ARPS[chord][step]);
  const w = 2 * Math.PI * freq;
  // Gentle accent on the first note of each chord so the changes are felt.
  const velocity = step === 0 ? 1.0 : 0.72;
  // Alternate a little L/R for width without extra voices.
  const pan = (k % 2 === 0 ? -1 : 1) * 0.28;
  const gainL = velocity * MEL_LEVEL * Math.sqrt(0.5 * (1 - pan));
  const gainR = velocity * MEL_LEVEL * Math.sqrt(0.5 * (1 + pan));
  for (let j = 0; j < MEL_TAIL; j++) {
    const tSince = j / SR;
    // attack ramp then exponential decay
    const env = j < MEL_ATTACK ? j / MEL_ATTACK : Math.exp(-(j - MEL_ATTACK) / SR / MEL_TAU);
    if (env < 1e-4) break;
    let s = 0;
    for (const p of MEL_PARTIALS) s += p.a * Math.sin(w * p.mult * tSince);
    const idx = (start + j) % total; // wrap-around → seamless
    left[idx] += s * env * gainL;
    right[idx] += s * env * gainR;
  }
}

// ---- Layer 3: soft PULSE (slow heartbeat/mallet) ----------------------------
// A low, gentle thump on a slow grid gives a sense of tempo without turning the
// bed into a drum track. Low sine + quick percussive envelope, wrap-around.
const PULSES = 24; // over the loop → one every 2 s (integer → seamless)
const PULSE_INTERVAL = total / PULSES;
const PULSE_FREQ = q(65.41); // C2-ish, felt more than heard
const PULSE_TAU = 0.16;
const PULSE_ATTACK = Math.floor(SR * 0.004);
const PULSE_TAIL = Math.floor(SR * 0.9);
const PULSE_LEVEL = 0.34;
const pw = 2 * Math.PI * PULSE_FREQ;
for (let k = 0; k < PULSES; k++) {
  const start = Math.round(k * PULSE_INTERVAL);
  // A soft two-beat feel: every other pulse a touch softer.
  const velocity = k % 2 === 0 ? 1.0 : 0.7;
  for (let j = 0; j < PULSE_TAIL; j++) {
    const tSince = j / SR;
    const env = j < PULSE_ATTACK ? j / PULSE_ATTACK : Math.exp(-(j - PULSE_ATTACK) / SR / PULSE_TAU);
    if (env < 1e-4) break;
    // A little pitch drop over the thump for a natural mallet feel.
    const s = Math.sin(pw * tSince) + 0.3 * Math.sin(2 * pw * tSince);
    const v = s * env * velocity * PULSE_LEVEL;
    const idx = (start + j) % total;
    left[idx] += v;
    right[idx] += v;
  }
}

// ---- Layer 4: quiet air bed (low-passed noise), made seamless by an ----------
// equal-power crossfade of its own continuation back into its head.
function makeNoise(seed) {
  const XF = Math.floor(SR * 1.0);
  const raw = new Float64Array(total + XF);
  let s = seed >>> 0;
  const rand = () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return (s / 0xffffffff) * 2 - 1;
  };
  const cutoffA = 0.02;
  let lp = 0;
  for (let i = 0; i < raw.length; i++) {
    lp += cutoffA * (rand() - lp);
    raw[i] = lp;
  }
  const out = new Float64Array(total);
  for (let i = 0; i < total; i++) out[i] = raw[i];
  for (let i = 0; i < XF; i++) {
    const fin = Math.sin((Math.PI / 2) * (i / XF));
    const fout = Math.cos((Math.PI / 2) * (i / XF));
    out[i] = raw[i] * fin + raw[total + i] * fout;
  }
  return out;
}
const noiseL = makeNoise(0x1a2b3c4d);
const noiseR = makeNoise(0x5e6f7a8b);
let airPeak = 1e-9;
for (let i = 0; i < total; i++) airPeak = Math.max(airPeak, Math.abs(noiseL[i]), Math.abs(noiseR[i]));
const airGain = (0.05 / airPeak) * 1.6;
for (let i = 0; i < total; i++) {
  left[i] += noiseL[i] * airGain;
  right[i] += noiseR[i] * airGain;
}

// ---- Normalize to a safe peak (never clip) and write 16-bit PCM WAV ---------
const outPath = process.argv[2] || "ambient.wav";
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
  `wrote ${outPath} — ${DURATION}s ${SR}Hz stereo, Am→F→C→G pad + plucked arpeggio + soft pulse, peak-normalized (gain ${gain.toFixed(3)})`
);
