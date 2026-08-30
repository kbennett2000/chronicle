// ADR-0027: the "local" ImageBackend — talks to a self-hosted ComfyUI over HTTP
// (Slice 0 / #120 stood the service up and proved this exact dance in
// scripts/verify-comfyui.ts). Deliberately simpler than the grok backend:
// ComfyUI is a plain HTTP service, not an agent, so there is no temp dir, no
// sandbox, and no `--deny` — just submit a graph, wait, save the PNG. Keeps the
// same failure discipline: NEVER throws, caps the wait, and returns
// `{ ok: false, error }` on anything going wrong so a DM turn keeps narrating.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeImagePrompt, saveGeneratedImage, slugify, sceneStyleNegatives } from "../image-generator.js";
import type { ImageBackend, ImageBackendArgs, ImageGenResult, ImageQuality } from "./types.js";
import { lookupStyleLora, type StyleLora } from "./style-loras.js";
import { config } from "../config.js";

export type FetchFn = typeof fetch;

/** FNV-1a, 32-bit — a tiny dependency-free string hash. Used to derive a stable
 * per-campaign seed (below), NOT for anything security-sensitive. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A deterministic SDXL seed for (campaign, entity), replacing a fully random roll
 * (ADR-0028). Every image in a campaign lands in a 1024-wide seed band anchored to
 * the campaign id, so their low-level noise is correlated — the images read as one
 * illustrated world — while each entity still gets a distinct seed. Deterministic, so
 * re-illustrating the same entity reproduces its image. Exported for tests. */
export function deriveCampaignSeed(campaignDir: string, name: string): number {
  const campaignId = path.basename(campaignDir.replace(/[\\/]+$/, ""));
  const base = fnv1a(campaignId);
  const offset = fnv1a(slugify(name)) % 1024;
  return (base + offset) >>> 0;
}

/** Issue #154: the seed to actually render with. A finite, non-negative
 * `settings.imageSeed` pins the seed (reproducible, user-chosen); otherwise fall
 * back to the deterministic per-(campaign, entity) derivation (ADR-0028).
 * Exported for tests. */
export function resolveImageSeed(
  campaignDir: string,
  name: string,
  imageSeed?: number | null
): number {
  if (typeof imageSeed === "number" && Number.isFinite(imageSeed) && imageSeed >= 0) {
    return Math.floor(imageSeed) >>> 0;
  }
  return deriveCampaignSeed(campaignDir, name);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = path.resolve(__dirname, "../workflows");
const BASE_WORKFLOW = "sdxl-txt2img.json";
const REFINER_WORKFLOW = "sdxl-refiner.json";

/** #174: the refiner checkpoint baked into sdxl-refiner.json's node "11". Used to
 * probe availability (and as the fallback name when config.defaults.imageRefinerModel
 * is unset). Keep in sync with the template. */
const REFINER_CKPT_DEFAULT = "sd_xl_refiner_1.0.safetensors";

/** #178: the BASE checkpoint (node "4") to render with — a campaign's pinned model wins,
 * else the host's configured default (config.defaults.imageModel), else undefined so the
 * workflow template's baked default stands. The config fallback lets a host that relocated
 * the default SDXL base into a subfolder render EXISTING games that never pinned a model
 * (config defaults otherwise only seed newly-created campaigns). Config is injectable for
 * tests (the singleton is frozen). Exported for tests. */
export function resolveBaseCheckpoint(
  settings: { imageModel?: string },
  cfg: { defaults: { imageModel?: string } } = config
): string | undefined {
  return settings.imageModel?.trim() || cfg.defaults.imageModel?.trim() || undefined;
}

/** ADR-0038: sanity cap on an editor full-prompt override. Far above the 500-char
 * assembly cap (SDXL CLIP truncates around 77 tokens anyway) — this only fences off
 * an absurd paste, it isn't a functional limit. */
const MAX_PROMPT_OVERRIDE_CHARS = 1200;

/** ADR-0029: what a quality tier resolves to on the local backend. `workflow` is a
 * checked-in template filename under WORKFLOWS_DIR; `steps` overrides the base
 * sampler's step count (base workflows only — the refiner template bakes its own
 * schedule); `timeoutMs` is the tier-aware wall-clock budget. */
export interface TierParams {
  workflow: string;
  steps?: number;
  timeoutMs: number;
}

/** ADR-0029 tiers. `standard` is byte-identical to pre-0029 (the same base template,
 * re-set to its own 25 steps). `fast` only lowers the step count. `high` swaps in the
 * base→refiner ensemble template and raises the budget for the extra pass + the
 * base→refiner model swap. ComfyUI on the reference RTX 5070 does a base SDXL image in
 * ~7.5s warm / ~10s cold; 120s leaves generous headroom for a cold load or busy queue,
 * and 300s covers `high`'s second model load + longer schedule. */
export const TIER_CONFIG: Record<ImageQuality, TierParams> = {
  fast: { workflow: BASE_WORKFLOW, steps: 15, timeoutMs: 120_000 },
  standard: { workflow: BASE_WORKFLOW, steps: 25, timeoutMs: 120_000 },
  high: { workflow: REFINER_WORKFLOW, timeoutMs: 300_000 },
};

/** Resolve a quality tier to its params, defaulting to `standard` for an
 * absent/unknown tier so a stale value can never leave the backend without a graph.
 * Exported for tests. */
export function resolveTier(quality?: ImageQuality): TierParams {
  return TIER_CONFIG[quality ?? "standard"] ?? TIER_CONFIG.standard;
}

/** ADR-0032: the tier to actually render at once a LoRA recipe is active. This slice
 * only LoRA-wires the base chain (nodes 4/6/7/3), so a recipe must never run on the
 * refiner workflow — the LoRA would apply to the base pass and be silently dropped by
 * the refiner pass. So whenever a recipe is active and the resolved tier is the refiner
 * (quality=high), swap to a base high-steps tier (40 steps, keeping high's raised
 * budget). This honors `noRefiner` and is the safe default for ANY recipe; a future
 * non-noRefiner recipe additionally warns that refiner-aware LoRA injection is TODO.
 * Exported for tests. */
export function resolveEffectiveTier(quality: ImageQuality | undefined, recipe: StyleLora): TierParams {
  const tier = resolveTier(quality);
  if (tier.workflow !== REFINER_WORKFLOW) return tier;
  if (!recipe.noRefiner) {
    console.error(
      `[image-generator] local LoRA "${recipe.loraFile}" requested at quality=high, but refiner-aware LoRA injection isn't implemented — rendering base high-steps instead`
    );
  }
  return { workflow: BASE_WORKFLOW, steps: 40, timeoutMs: tier.timeoutMs };
}

const POLL_INTERVAL_MS = 500;
const REQUEST_TIMEOUT_MS = 30_000;

/** Set a node's prompt text if that node exists (base and, in the refiner template,
 * the refiner's own CLIP-encode node — ADR-0029). No-op when the node is absent. */
function setNodeText(graph: Record<string, any>, id: string, text: string): void {
  if (graph[id]) graph[id].inputs.text = text;
}

/** Append to a node's existing (template) negative text if the node exists. */
function appendNodeText(graph: Record<string, any>, id: string, extra: string): void {
  const node = graph[id];
  if (node) node.inputs.text = `${node.inputs.text}, ${extra}`;
}

/** Write the seed into a sampler node, using whichever key it exposes — `seed` for
 * KSampler (base template), `noise_seed` for KSamplerAdvanced (refiner template). */
function setNodeSeed(graph: Record<string, any>, id: string, seed: number): void {
  const node = graph[id];
  if (!node) return;
  if ("noise_seed" in node.inputs) node.inputs.noise_seed = seed;
  else node.inputs.seed = seed;
}

/** ADR-0032: insert a LoraLoader (node "20", unused in both templates) into the cloned
 * base-chain graph and repoint the checkpoint's model/clip consumers through it, so the
 * LoRA affects the sampler (node 3) and both CLIP encoders (6 positive, 7 negative).
 * `["4",0]`/`["4",1]` are the checkpoint's only model/clip consumers (the VAE is a
 * separate VAELoader), so these are the complete set of edges. Base chain only — a
 * recipe never reaches the refiner workflow (see resolveEffectiveTier). */
function applyLora(graph: Record<string, any>, recipe: StyleLora): void {
  graph["20"] = {
    class_type: "LoraLoader",
    inputs: {
      lora_name: recipe.loraFile,
      strength_model: recipe.strength,
      strength_clip: recipe.strength,
      model: ["4", 0],
      clip: ["4", 1],
    },
  };
  if (graph["6"]) graph["6"].inputs.clip = ["20", 1];
  if (graph["7"]) graph["7"].inputs.clip = ["20", 1];
  if (graph["3"]) graph["3"].inputs.model = ["20", 0];
}

/** ADR-0032: ensure the LoRA's trigger token is present in the positive prompt,
 * prepending it (case-insensitive) if absent. Runs AFTER sanitizeImagePrompt's 500-char
 * cap, so it only lengthens the string and never displaces the grounding budget
 * (ADR-0031). For the proof styles trigger === artStyle, so the leading style clause
 * already contains it and this is a no-op. Exported for tests. */
export function ensureTrigger(prompt: string, trigger: string): string {
  if (prompt.toLowerCase().includes(trigger.toLowerCase())) return prompt;
  return `${trigger}. ${prompt}`;
}

/** ADR-0032: ask ComfyUI what LoRA files IT can load — its own filesystem, which may
 * differ from this process's when ComfyUI is remote — and whether `loraFile` is among
 * them. The `/object_info/LoraLoader` response shape is
 * `{ LoraLoader: { input: { required: { lora_name: [ [file, ...], ... ] } } } }`.
 * Returns false on any non-200 or parse failure; may throw on a network error — the
 * caller degrades to prompt-only either way. Uses the injected fetchFn (test-driven). */
async function loraAvailable(base: string, fetchFn: FetchFn, loraFile: string): Promise<boolean> {
  const res = await fetchFn(`${base}/object_info/LoraLoader`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) return false;
  const info = (await res.json().catch(() => ({}))) as Record<string, any>;
  const names = info?.LoraLoader?.input?.required?.lora_name?.[0];
  return Array.isArray(names) && names.includes(loraFile);
}

/** Issue #154: ask ComfyUI which SDXL checkpoints IT can load (its own filesystem,
 * which may differ from this process's when ComfyUI is remote), for the model picker.
 * Same `/object_info` shape as loraAvailable:
 * `{ CheckpointLoaderSimple: { input: { required: { ckpt_name: [ [file, ...], ... ] } } } }`.
 * Returns `[]` on any non-200 / parse / network failure so the UI simply hides the
 * picker rather than erroring. Uses the injected fetchFn (test-driven). */
export async function listLocalCheckpoints(fetchFn: FetchFn = fetch): Promise<string[]> {
  const base = comfyBase();
  try {
    const res = await fetchFn(`${base}/object_info/CheckpointLoaderSimple`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const info = (await res.json().catch(() => ({}))) as Record<string, any>;
    const names = info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
    return Array.isArray(names) ? names.filter((n): n is string => typeof n === "string") : [];
  } catch {
    return [];
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface OutImage {
  filename: string;
  subfolder: string;
  type: string;
}

function comfyBase(): string {
  return (config.comfyui.url || "http://localhost:8188").replace(/\/$/, "");
}

function fail(name: string, error: string): ImageGenResult {
  console.error(`[image-generator] local ComfyUI generation failed for "${name}": ${error}`);
  return { ok: false, error };
}

const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ADR-0036 (img2img) / ADR-0037 (IP-Adapter) constants, ported from imagegen-service.
const DENOISE_DEFAULT = 0.65;
const IPADAPTER_FILE = "ip-adapter-plus-face_sdxl_vit-h.safetensors";
const CLIP_VISION_FILE = "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors";
const REFERENCE_WEIGHT = 0.5;
const REFERENCE_START = 0.3;
const PREP_NODE = "PrepImageForClipVision";

/** Upload a local still to ComfyUI's input/ dir; returns the stored filename for a
 * LoadImage node. A unique name per upload avoids clobbering on overlap. Throws on
 * failure — the caller decides whether that fails the render (img2img) or degrades
 * to prompt-only (IP-Adapter). */
async function uploadImageToComfy(base: string, fetchFn: FetchFn, absPath: string): Promise<string> {
  const bytes = fs.readFileSync(absPath);
  const ext = (path.extname(absPath) || ".png").toLowerCase();
  const type = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
  const filename = `chronicle-src-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 8)}${ext}`;
  const form = new FormData();
  form.append("image", new Blob([bytes], { type }), filename);
  form.append("overwrite", "true");
  const res = await fetchFn(`${base}/upload/image`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ComfyUI /upload/image returned ${res.status}`);
  const j = (await res.json().catch(() => ({}))) as { name?: string; subfolder?: string };
  if (!j.name) throw new Error("ComfyUI /upload/image returned no name");
  return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
}

/** ADR-0036: rewire the base graph for img2img — add LoadImage("30") → VAEEncode("31",
 * using the template's own VAELoader "10") and point the base sampler's `latent_image`
 * at it, at `denoise` strength (lower = closer to the init image). Exported for tests. */
export function applyImg2Img(graph: Record<string, any>, imageName: string, denoise: number): void {
  graph["30"] = { class_type: "LoadImage", inputs: { image: imageName } };
  graph["31"] = { class_type: "VAEEncode", inputs: { pixels: ["30", 0], vae: ["10", 0] } };
  if (graph["3"]) {
    graph["3"].inputs.latent_image = ["31", 0];
    graph["3"].inputs.denoise = denoise;
  }
}

/** Is a ComfyUI node class installed on the host? False on any error. */
async function nodeAvailable(base: string, fetchFn: FetchFn, cls: string): Promise<boolean> {
  try {
    const res = await fetchFn(`${base}/object_info/${cls}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) return false;
    const info = (await res.json().catch(() => ({}))) as Record<string, any>;
    return Boolean(info?.[cls]);
  } catch {
    return false;
  }
}

/** ADR-0037: is IP-Adapter usable — the custom node present AND the face model
 * installed (both verified via the one /object_info combo). False on any error, so
 * the caller degrades to prompt-only. Same `[0]` combo shape as loraAvailable. */
async function ipAdapterAvailable(base: string, fetchFn: FetchFn): Promise<boolean> {
  try {
    const res = await fetchFn(`${base}/object_info/IPAdapterModelLoader`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const info = (await res.json().catch(() => ({}))) as Record<string, any>;
    const files = info?.IPAdapterModelLoader?.input?.required?.ipadapter_file?.[0];
    return Array.isArray(files) && files.includes(IPADAPTER_FILE);
  } catch {
    return false;
  }
}

/** ADR-0037: inject the IP-Adapter chain (LoadImage "21", IPAdapterModelLoader "22",
 * CLIPVisionLoader "23", optional PrepImageForClipVision "25", IPAdapterAdvanced "24")
 * and repoint the base sampler's `model` through it. `modelSource` is the LoRA node
 * ("20") when a recipe is active, else the checkpoint ("4"), so IP-Adapter composes
 * AFTER a style LoRA. Exported for tests. */
export function applyIPAdapter(
  graph: Record<string, any>,
  imageName: string,
  weight: number,
  startAt: number,
  faceCrop: boolean
): void {
  const modelSource: [string, number] = graph["20"] ? ["20", 0] : ["4", 0];
  graph["21"] = { class_type: "LoadImage", inputs: { image: imageName } };
  graph["22"] = { class_type: "IPAdapterModelLoader", inputs: { ipadapter_file: IPADAPTER_FILE } };
  graph["23"] = { class_type: "CLIPVisionLoader", inputs: { clip_name: CLIP_VISION_FILE } };
  let imageSource: [string, number] = ["21", 0];
  if (faceCrop) {
    graph["25"] = {
      class_type: PREP_NODE,
      inputs: { image: ["21", 0], interpolation: "LANCZOS", crop_position: "top", sharpening: 0.0 },
    };
    imageSource = ["25", 0];
  }
  graph["24"] = {
    class_type: "IPAdapterAdvanced",
    inputs: {
      model: modelSource,
      ipadapter: ["22", 0],
      image: imageSource,
      clip_vision: ["23", 0],
      weight,
      weight_type: "ease in-out",
      combine_embeds: "concat",
      start_at: startAt,
      end_at: 1.0,
      embeds_scaling: "V only",
    },
  };
  if (graph["3"]) graph["3"].inputs.model = ["24", 0];
}

/** Submit the SDXL graph to ComfyUI, wait for the image, and save it into the
 * campaign images/ dir. `fetchFn` is injectable (default = global fetch) so tests
 * drive the whole HTTP dance with a stub — no GPU and no running ComfyUI —
 * mirroring the execFn DI in the grok backend. Never throws. */
export async function generateLocalImage(
  args: ImageBackendArgs,
  fetchFn: FetchFn = fetch
): Promise<ImageGenResult> {
  const { campaignDir, entityType, name, description, settings } = args;
  const base = comfyBase();
  // ADR-0028: pass the entity type so scene/location prompts get the weighted style
  // clause; character-class prompts are built exactly as before.
  const prompt = sanitizeImagePrompt(description, settings, { entityType });
  // ADR-0029: pick the tier's workflow + step count + timeout. Absent tier → standard.
  let tier = resolveTier(args.imageQuality);

  // ADR-0032: a configured style may ALSO load a specialized SDXL LoRA. The whole path
  // here is self-contained — any failure (file not loadable, /object_info error, a
  // thrown fetch) drops back to prompt-only and STILL generates; it must never reach the
  // outer catch, which would fail the image. Unmapped styles skip this block entirely
  // and submit a byte-identical graph to today.
  let recipe: StyleLora | undefined = lookupStyleLora(settings.artStyle);
  let positivePrompt = prompt;
  if (recipe) {
    try {
      // Only the base chain is LoRA-wired, so force the base workflow for any recipe.
      tier = resolveEffectiveTier(args.imageQuality, recipe);
      // Confirm ComfyUI can actually load the file (its filesystem, via /object_info);
      // otherwise fall back to prompt-only at the originally resolved tier.
      if (await loraAvailable(base, fetchFn, recipe.loraFile)) {
        positivePrompt = ensureTrigger(prompt, recipe.trigger);
      } else {
        console.error(
          `[image-generator] local LoRA "${recipe.loraFile}" for style "${settings.artStyle}" is not loadable by ComfyUI — falling back to prompt-only`
        );
        recipe = undefined;
        tier = resolveTier(args.imageQuality);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(
        `[image-generator] local LoRA setup failed for style "${settings.artStyle}" — falling back to prompt-only: ${reason}`
      );
      recipe = undefined;
      tier = resolveTier(args.imageQuality);
      positivePrompt = prompt;
    }
  }

  // ADR-0038: the editor's "edit the full prompt" replaces the assembled positive
  // prompt VERBATIM — after the art-style clause and LoRA trigger, so it wins outright.
  // The recipe stays resolved above, so its LoRA node + extra negatives still wire in;
  // only the positive TEXT is the user's. (Overriding the grounded appearance tags can
  // reintroduce character drift — that trade-off is the user's to make here.)
  if (args.promptOverride?.trim()) {
    positivePrompt = args.promptOverride.trim().slice(0, MAX_PROMPT_OVERRIDE_CHARS);
  }

  // ADR-0038: preview — return the effective positive prompt WITHOUT rendering, so the
  // editor can prefill its full-prompt box with exactly what would be used. No ComfyUI
  // call, no file written. Placed after the override so a preview reflects it too.
  if (args.preview) {
    return { ok: true, previewPrompt: positivePrompt };
  }

  // ADR-0036/0037: img2img and IP-Adapter wire only the BASE chain (nodes 3/4/10/20),
  // so — like a LoRA recipe — they must never run on the refiner template. Force a base
  // high-steps tier when either is active and the resolved tier is the refiner.
  const img2img = !!args.initImageAbsPath;
  const wantsReference = !!args.referenceImageAbsPath;
  if ((img2img || wantsReference) && tier.workflow === REFINER_WORKFLOW) {
    tier = { workflow: BASE_WORKFLOW, steps: 40, timeoutMs: tier.timeoutMs };
  }

  // #174: High quality runs the base→refiner ensemble; its refiner (node "11") loads a
  // fixed checkpoint. If that checkpoint isn't installed on ComfyUI — e.g. the host
  // reorganized checkpoints into a subfolder, so the bare "sd_xl_refiner_1.0.safetensors"
  // no longer resolves — ComfyUI 400s the WHOLE prompt (prompt_outputs_failed_validation).
  // Degrade to base high-steps instead of hard-failing, matching the LoRA/IP-Adapter
  // "an enhancement, never a blocker" rule. Only degrade when we can actually see the
  // checkpoint list (empty = ComfyUI unreachable → let the normal path surface that).
  if (tier.workflow === REFINER_WORKFLOW) {
    const refinerCkpt = config.defaults.imageRefinerModel?.trim() || REFINER_CKPT_DEFAULT;
    const installed = await listLocalCheckpoints(fetchFn);
    if (installed.length > 0 && !installed.includes(refinerCkpt)) {
      console.error(
        `[image-generator] refiner checkpoint "${refinerCkpt}" is not installed on ComfyUI — ` +
          `falling back to base high-steps (set defaults.imageRefinerModel to its actual path to use the refiner)`
      );
      tier = { workflow: BASE_WORKFLOW, steps: 40, timeoutMs: tier.timeoutMs };
    }
  }

  try {
    // Build the graph from the tier's checked-in template (fresh clone per call).
    const graph = JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, tier.workflow), "utf8")) as Record<
      string,
      any
    >;
    // ADR-0029: inject into the base nodes and, when present (the refiner template),
    // the refiner's own encode/sample nodes — so ADR-0028's style clause, anti-drift
    // negatives, and per-campaign seed apply IDENTICALLY at every quality tier.
    const extraNeg = sceneStyleNegatives(settings, entityType);
    // #154: honor a user seed override, else the deterministic per-entity seed.
    const seed = resolveImageSeed(campaignDir, name, settings.imageSeed);
    for (const id of ["6", "12"]) setNodeText(graph, id, positivePrompt);
    if (extraNeg) for (const id of ["7", "13"]) appendNodeText(graph, id, extraNeg);
    // ADR-0032 (Slice 2): a recipe's per-style extra negatives, appended alongside the
    // ADR-0028 anti-drift set. Only when the recipe survived availability (still set).
    if (recipe?.extraNegatives) for (const id of ["7", "13"]) appendNodeText(graph, id, recipe.extraNegatives);
    // #154: the user's own "things to avoid", appended last so it's additive to both
    // the anti-drift and recipe negatives (never replaces them).
    if (settings.negativePrompt?.trim()) {
      for (const id of ["7", "13"]) appendNodeText(graph, id, settings.negativePrompt.trim());
    }
    // #154/#178: the BASE checkpoint (node "4") — the campaign's pinned model wins, else
    // the host's configured default (config.defaults.imageModel), else the template's
    // baked default. The config fallback lets a host that relocated the default SDXL base
    // into a subfolder (e.g. "s/sd_xl_base_1.0.safetensors") render EXISTING games that
    // never pinned a model — not just newly-created ones (config defaults only seed new
    // campaigns at create time). No-op when neither is set.
    const baseCkpt = resolveBaseCheckpoint(settings);
    if (baseCkpt && graph["4"]?.inputs) {
      graph["4"].inputs.ckpt_name = baseCkpt;
    }
    // #174: point the refiner checkpoint (node "11", refiner template only) at the
    // configured file when set, so High quality works on hosts that relocated it (the
    // degrade above already ran, so if we're still on the refiner tier it's installed).
    if (config.defaults.imageRefinerModel?.trim() && graph["11"]?.inputs) {
      graph["11"].inputs.ckpt_name = config.defaults.imageRefinerModel.trim();
    }
    for (const id of ["3", "14"]) setNodeSeed(graph, id, seed);
    // Base-workflow step override (fast/standard); the refiner template bakes its own.
    if (tier.steps != null && graph["3"]?.inputs && "steps" in graph["3"].inputs) {
      graph["3"].inputs.steps = tier.steps;
    }
    // ADR-0032: a surviving LoRA recipe injects the LoraLoader node and rewires the
    // base chain through it. Absent recipe → today's graph, untouched.
    if (recipe) applyLora(graph, recipe);

    // ADR-0036: img2img — upload the init frame and repoint the sampler's latent. A
    // failed upload FAILS the request (the image is the whole point of img2img).
    if (img2img) {
      let initName: string;
      try {
        initName = await uploadImageToComfy(base, fetchFn, args.initImageAbsPath!);
      } catch (err) {
        return fail(name, `img2img init upload failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      applyImg2Img(graph, initName, clampNum(args.denoise ?? DENOISE_DEFAULT, 0.01, 1));
    }

    // ADR-0037: IP-Adapter reference likeness — DEGRADES to prompt-only when the node
    // or model isn't installed, or on an upload error (a reference is an enhancement,
    // never a blocker). Runs after applyLora so it reads the LoRA node as its model
    // source. Self-contained: never reaches the outer catch.
    if (wantsReference) {
      try {
        if (await ipAdapterAvailable(base, fetchFn)) {
          const refName = await uploadImageToComfy(base, fetchFn, args.referenceImageAbsPath!);
          const faceCrop = await nodeAvailable(base, fetchFn, PREP_NODE);
          applyIPAdapter(
            graph,
            refName,
            clampNum(args.likenessStrength ?? REFERENCE_WEIGHT, 0.01, 1.5),
            clampNum(args.likenessStart ?? REFERENCE_START, 0, 0.5),
            faceCrop
          );
        } else {
          console.error(
            `[image-generator] IP-Adapter not available on the ComfyUI host — rendering "${name}" without reference`
          );
        }
      } catch (err) {
        console.error(
          `[image-generator] IP-Adapter setup failed for "${name}" — rendering without reference: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    const clientId = `chronicle-${entityType}-${Date.now()}`;
    const res = await fetchFn(`${base}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: graph, client_id: clientId }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return fail(name, `ComfyUI /prompt returned ${res.status} ${body.slice(0, 200)}`);
    }
    const submit = (await res.json()) as { prompt_id?: string; node_errors?: Record<string, unknown> };
    if (submit.node_errors && Object.keys(submit.node_errors).length) {
      return fail(name, `ComfyUI rejected the workflow: ${JSON.stringify(submit.node_errors).slice(0, 300)}`);
    }
    if (!submit.prompt_id) return fail(name, "ComfyUI /prompt returned no prompt_id");
    const promptId = submit.prompt_id;

    // Poll /history until this prompt yields an output image (or we time out).
    const deadline = Date.now() + tier.timeoutMs;
    let image: OutImage | undefined;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const h = await fetchFn(`${base}/history/${promptId}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }).catch(() => null);
      if (!h || !h.ok) continue;
      const hist = (await h.json().catch(() => ({}))) as Record<string, any>;
      const entry = hist[promptId];
      if (!entry) continue;
      if (entry.status?.status_str === "error") {
        return fail(name, `ComfyUI execution error: ${JSON.stringify(entry.status).slice(0, 300)}`);
      }
      for (const node of Object.values(entry.outputs ?? {}) as any[]) {
        const first = (node.images ?? [])[0] as OutImage | undefined;
        if (first) {
          image = first;
          break;
        }
      }
      if (image) break;
    }
    if (!image) return fail(name, `ComfyUI produced no image within ${tier.timeoutMs}ms`);

    // Fetch the PNG bytes and save into the campaign images/ dir.
    const q = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder, type: image.type });
    const view = await fetchFn(`${base}/view?${q}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!view.ok) return fail(name, `ComfyUI /view returned ${view.status}`);
    const bytes = Buffer.from(await view.arrayBuffer());
    return saveGeneratedImage(campaignDir, entityType, name, bytes, ".png");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return fail(name, `ComfyUI request failed: ${reason}`);
  }
}

export const localImageBackend: ImageBackend = {
  provider: "local",
  generate: (args) => generateLocalImage(args),
};
