// Generates Chronicle's ambient music bed as an original, self-authored WAV
// (issue #43). No samples, no third-party audio — just additive synthesis — so
// the committed loop carries no licensing obligation on this public repo
// (CC0 / original work). Run `node scripts/generate-ambient.mjs <out.wav>` then
// encode to ogg/mp3 (see public/audio/README.md).
//
// SEAMLESS LOOP: every partial and every LFO frequency is an integer multiple
// of 1/DURATION, so the waveform (and its slope) match exactly at t=0 and t=D —
// `<audio loop>` repeats with no click. Do not add a fade at the file ends;
// that would BREAK the loop. The slow swell comes from the periodic LFOs.

import fs from "node:fs";

const SR = 44100;
const DURATION = 30; // seconds — long enough that the repeat isn't obvious
const CHANNELS = 2;

// A low, candlelit drone: an A minor-ish open chord with a quiet upper shimmer.
// Each freq is rounded to the nearest k/DURATION so freq*DURATION is an integer.
const q = (hz) => Math.round(hz * DURATION) / DURATION;
const PARTIALS = [
  { f: q(55), a: 0.5, lfo: 1, phase: 0.0 }, // A1 root
  { f: q(82.5), a: 0.28, lfo: 2, phase: 0.2 }, // E2 fifth
  { f: q(110), a: 0.34, lfo: 1, phase: 0.5 }, // A2
  { f: q(165), a: 0.18, lfo: 3, phase: 0.1 }, // E3
  { f: q(220), a: 0.16, lfo: 2, phase: 0.7 }, // A3
  { f: q(330), a: 0.07, lfo: 4, phase: 0.3 }, // E4 shimmer
  { f: q(440), a: 0.05, lfo: 5, phase: 0.9 }, // A4 shimmer
];

// Slow amplitude LFOs (also k/DURATION): index 1 -> one cycle over the whole
// loop, higher indices breathe faster. Kept shallow so it swells, not pulses.
const lfoHz = (k) => k / DURATION;
const swell = (k, t, phase, chan) => {
  // A small stereo phase offset gives the bed a little width without breaking
  // the loop (the offset is constant, the LFO stays periodic over DURATION).
  const stereo = chan === 0 ? 0 : 0.12;
  return 0.72 + 0.28 * Math.sin(2 * Math.PI * lfoHz(k) * t + 2 * Math.PI * (phase + stereo));
};

const outPath = process.argv[2] || "ambient.wav";
const total = SR * DURATION;
const bytesPerSample = 2;
const dataBytes = total * CHANNELS * bytesPerSample;

const buf = Buffer.alloc(44 + dataBytes);
// WAV header
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

// First pass: synthesize into floats so we can normalize to a safe peak.
const left = new Float64Array(total);
const right = new Float64Array(total);
let peak = 0;
for (let i = 0; i < total; i++) {
  const t = i / SR;
  let l = 0;
  let r = 0;
  for (const p of PARTIALS) {
    const wave = Math.sin(2 * Math.PI * p.f * t + 2 * Math.PI * p.phase);
    l += wave * p.a * swell(p.lfo, t, p.phase, 0);
    r += wave * p.a * swell(p.lfo, t, p.phase, 1);
  }
  left[i] = l;
  right[i] = r;
  peak = Math.max(peak, Math.abs(l), Math.abs(r));
}

const gain = (0.72 / peak) || 0; // headroom; never clip
let off = 44;
for (let i = 0; i < total; i++) {
  const l = Math.round(Math.max(-1, Math.min(1, left[i] * gain)) * 32767);
  const r = Math.round(Math.max(-1, Math.min(1, right[i] * gain)) * 32767);
  buf.writeInt16LE(l, off);
  buf.writeInt16LE(r, off + 2);
  off += 4;
}

fs.writeFileSync(outPath, buf);
console.log(`wrote ${outPath} — ${DURATION}s ${SR}Hz stereo, peak-normalized (gain ${gain.toFixed(3)})`);
