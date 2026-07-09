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
import { sanitizeImagePrompt, saveGeneratedImage } from "../image-generator.js";
import type { ImageBackend, ImageBackendArgs, ImageGenResult } from "./types.js";

export type FetchFn = typeof fetch;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** The checked-in SDXL txt2img graph; loaded fresh per call and injected with
 * the positive prompt (node "6") and a random seed (node "3"). */
const WORKFLOW_PATH = path.resolve(__dirname, "../workflows/sdxl-txt2img.json");

/** Total wall-clock budget for one generation (submit + polling). ComfyUI on the
 * reference RTX 5070 does SDXL in ~7.5s warm / ~10s cold; 120s leaves generous
 * headroom for a cold model load or a busy queue, after which we give up and
 * return a failure so a DM turn never hangs. */
const GEN_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 500;
const REQUEST_TIMEOUT_MS = 30_000;

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
  const prompt = sanitizeImagePrompt(description, settings);

  try {
    // Build the graph from the checked-in template (fresh clone per call).
    const graph = JSON.parse(fs.readFileSync(WORKFLOW_PATH, "utf8")) as Record<string, any>;
    graph["6"].inputs.text = prompt;
    graph["3"].inputs.seed = Math.floor(Math.random() * 0xffffffff);

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
    const deadline = Date.now() + GEN_TIMEOUT_MS;
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
    if (!image) return fail(name, `ComfyUI produced no image within ${GEN_TIMEOUT_MS}ms`);

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
