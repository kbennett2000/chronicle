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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = path.resolve(__dirname, "../workflows");
const BASE_WORKFLOW = "sdxl-txt2img.json";
const REFINER_WORKFLOW = "sdxl-refiner.json";

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface OutImage {
  filename: string;
  subfolder: string;
  type: string;
}

function comfyBase(): string {
  return (process.env.COMFYUI_URL ?? "http://localhost:8188").replace(/\/$/, "");
}

function fail(name: string, error: string): ImageGenResult {
  console.error(`[image-generator] local ComfyUI generation failed for "${name}": ${error}`);
  return { ok: false, error };
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
    const seed = deriveCampaignSeed(campaignDir, name);
    for (const id of ["6", "12"]) setNodeText(graph, id, positivePrompt);
    if (extraNeg) for (const id of ["7", "13"]) appendNodeText(graph, id, extraNeg);
    // ADR-0032 (Slice 2): a recipe's per-style extra negatives, appended alongside the
    // ADR-0028 anti-drift set. Only when the recipe survived availability (still set).
    if (recipe?.extraNegatives) for (const id of ["7", "13"]) appendNodeText(graph, id, recipe.extraNegatives);
    for (const id of ["3", "14"]) setNodeSeed(graph, id, seed);
    // Base-workflow step override (fast/standard); the refiner template bakes its own.
    if (tier.steps != null && graph["3"]?.inputs && "steps" in graph["3"].inputs) {
      graph["3"].inputs.steps = tier.steps;
    }
    // ADR-0032: a surviving LoRA recipe injects the LoraLoader node and rewires the
    // base chain through it. Absent recipe → today's graph, untouched.
    if (recipe) applyLora(graph, recipe);

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
