// ADR-0035: LTX-Video (Lightricks) 2B image-to-video workflow renderer, ported from
// imagegen-service (ADR-0015 there). Same convention as the Wan renderer: a template
// JSON under src/workflows/ is mutated BY NODE ID on a fresh clone per call — pure,
// no shared mutable state. Node ids/classes match ComfyUI's native LTXV i2v template
// (CheckpointLoaderSimple + CLIPLoader type=ltxv + LTXVImgToVideo + LTXVConditioning
// + LTXVScheduler + KSamplerSelect + SamplerCustom + CreateVideo/SaveVideo).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { VideoGraph, VideoRenderParams } from "./video-models.js";

const WORKFLOWS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../workflows");
export const LTXV_WORKFLOW = "ltxv-i2v.json";

// The two files this workflow needs ComfyUI to have loaded. The v0.9.5 2B checkpoint
// bundles its VAE, so no separate VAE file; the T5-XXL text encoder is loaded separately.
export const LTXV_CHECKPOINT = "ltx-video-2b-v0.9.5.safetensors";
export const LTXV_TEXT_ENCODER = "t5xxl_fp8_e4m3fn_scaled.safetensors";

// Defaults from the canonical template: 768x512, 97 frames, 24 fps playback.
export const LTXV_DEFAULT_WIDTH = 768;
export const LTXV_DEFAULT_HEIGHT = 512;
export const LTXV_DEFAULT_FPS = 24;
export const LTXV_DEFAULT_FRAMES = 97;
// Shared cap with Wan (121 is a valid value on both lattices); the grid snap below
// keeps LTX on its own 8n+1 lattice.
export const LTXV_MAX_FRAMES = 121;

type GraphNode = { class_type: string; inputs: Record<string, unknown> };

function node(graph: VideoGraph, id: string): GraphNode {
  const n = graph[id];
  if (!n) throw new Error(`ltxv workflow template is missing node "${id}"`);
  return n;
}

// Snap a requested pixel dimension to LTX's multiple-of-32 grid, with a floor.
export function normalizeLtxvDimension(value: number | undefined, fallback: number): number {
  const v = Number.isFinite(value) ? (value as number) : fallback;
  return Math.max(32, Math.round(v / 32) * 32);
}

// Snap a requested frame count to LTX's valid 8n+1 grid (1,9,17,...) and cap at
// LTXV_MAX_FRAMES. LTX's temporal VAE compresses by 8, so only 8n+1 lengths are valid.
export function normalizeLtxvFrames(value: number | undefined): number {
  const v = Number.isFinite(value) ? (value as number) : LTXV_DEFAULT_FRAMES;
  const capped = Math.min(LTXV_MAX_FRAMES, Math.max(1, Math.floor(v)));
  const n = Math.round((capped - 1) / 8);
  return Math.max(1, Math.min(LTXV_MAX_FRAMES, n * 8 + 1));
}

// Render the LTX i2v graph: read the template, clone, inject params by node id. Pure.
export function renderLtxvWorkflow(params: VideoRenderParams): VideoGraph {
  const graph = JSON.parse(readFileSync(path.join(WORKFLOWS_DIR, LTXV_WORKFLOW), "utf8")) as VideoGraph;

  const width = normalizeLtxvDimension(params.width, LTXV_DEFAULT_WIDTH);
  const height = normalizeLtxvDimension(params.height, LTXV_DEFAULT_HEIGHT);
  const length = normalizeLtxvFrames(params.frames);
  const fps = Number.isFinite(params.fps) ? (params.fps as number) : LTXV_DEFAULT_FPS;
  const seed = Number.isFinite(params.seed) ? (params.seed as number) : randomSeed();

  node(graph, "6").inputs.text = params.prompt;
  if (params.negativePrompt) {
    const neg = node(graph, "7");
    neg.inputs.text = `${neg.inputs.text}, ${params.negativePrompt}`;
  }
  // Resolution + length live on LTXVImgToVideo (node 77); it resizes the input internally.
  const imgToVideo = node(graph, "77");
  imgToVideo.inputs.width = width;
  imgToVideo.inputs.height = height;
  imgToVideo.inputs.length = length;
  node(graph, "80").inputs.fps = fps;
  node(graph, "72").inputs.noise_seed = seed;
  node(graph, "78").inputs.image = params.imageName;

  return graph;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000);
}
