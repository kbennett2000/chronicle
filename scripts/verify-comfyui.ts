/** Slice 0 (#120) — empirical check of a LOCAL ComfyUI image-gen service.
 *
 * Chronicle currently generates assets via the headless Grok Build worker. This
 * spike stands up ComfyUI + SDXL on the local RTX 5070 as an alternative, and this
 * script proves the HTTP API end-to-end: it POSTs a minimal SDXL txt2img graph to
 * ComfyUI's /prompt endpoint, waits for completion, and saves the resulting PNG.
 *
 * It exercises ONLY the ComfyUI service (node's global fetch, node v22); its one
 * app-side import is the config loader, so it targets the SAME `comfyui.url` the
 * app uses (ADR-0033) and can double as a check of that setting.
 *
 * Requires the `comfyui` service reachable at config.comfyui.url (default
 * localhost:8188; override inline with COMFYUI_URL=...) with
 * sd_xl_base_1.0.safetensors in models/checkpoints and sdxl_vae.safetensors in
 * models/vae. Nothing here touches test-campaign or real games.
 *
 * Usage:
 *   npx tsx scripts/verify-comfyui.ts
 *   COMFYUI_URL=http://otherhost:8188 npx tsx scripts/verify-comfyui.ts
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../src/config.js";

const BASE = process.env.COMFYUI_URL ?? config.comfyui.url;
const CKPT = "sd_xl_base_1.0.safetensors";
const VAE = "sdxl_vae.safetensors";
const POS =
  "a weathered dwarven blacksmith at a glowing forge, fantasy illustration";
const NEG = "blurry, lowres, deformed, text, watermark";
const clientId = `verify-comfyui-${process.pid}`;

/** Minimal SDXL txt2img graph in ComfyUI API format. */
function buildWorkflow(seed: number): Record<string, unknown> {
  return {
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: CKPT } },
    "10": { class_type: "VAELoader", inputs: { vae_name: VAE } },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: { width: 1024, height: 1024, batch_size: 1 },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { text: POS, clip: ["4", 1] },
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: { text: NEG, clip: ["4", 1] },
    },
    "3": {
      class_type: "KSampler",
      inputs: {
        seed,
        steps: 25,
        cfg: 7,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: { samples: ["3", 0], vae: ["10", 0] },
    },
    "9": {
      class_type: "SaveImage",
      inputs: { filename_prefix: "verify-comfyui", images: ["8", 0] },
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface OutImage {
  filename: string;
  subfolder: string;
  type: string;
}

/** Submit one workflow, wait for it to finish, return elapsed ms + output images. */
async function generate(seed: number): Promise<{ ms: number; images: OutImage[] }> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: buildWorkflow(seed), client_id: clientId }),
  });
  if (!res.ok) {
    throw new Error(`/prompt failed: ${res.status} ${await res.text()}`);
  }
  const { prompt_id, node_errors } = (await res.json()) as {
    prompt_id: string;
    node_errors?: Record<string, unknown>;
  };
  if (node_errors && Object.keys(node_errors).length) {
    throw new Error(`node_errors: ${JSON.stringify(node_errors)}`);
  }

  // Poll /history until this prompt_id has outputs (or a hard timeout).
  for (let i = 0; i < 600; i++) {
    await sleep(500);
    const h = await fetch(`${BASE}/history/${prompt_id}`);
    if (!h.ok) continue;
    const hist = (await h.json()) as Record<string, any>;
    const entry = hist[prompt_id];
    if (!entry) continue;
    const status = entry.status?.status_str;
    if (status === "error") {
      throw new Error(`execution error: ${JSON.stringify(entry.status)}`);
    }
    const images: OutImage[] = [];
    for (const node of Object.values(entry.outputs ?? {}) as any[]) {
      for (const img of node.images ?? []) images.push(img as OutImage);
    }
    if (images.length) return { ms: Date.now() - t0, images };
  }
  throw new Error("timed out waiting for image (>5min)");
}

/** Poll nvidia-smi in the background; resolve() returns the peak MiB seen. */
function startVramSampler(): () => number {
  let peak = 0;
  const proc = spawn("nvidia-smi", [
    "--query-gpu=memory.used",
    "--format=csv,noheader,nounits",
    "-lms",
    "250",
  ]);
  proc.stdout.on("data", (b: Buffer) => {
    for (const line of b.toString().trim().split("\n")) {
      const v = parseInt(line.trim(), 10);
      if (!Number.isNaN(v)) peak = Math.max(peak, v);
    }
  });
  proc.on("error", () => {}); // nvidia-smi absent → just report 0
  return () => {
    proc.kill();
    return peak;
  };
}

async function main() {
  // Fail fast if the service isn't up.
  const stats = await fetch(`${BASE}/system_stats`).catch(() => null);
  if (!stats?.ok) {
    console.error(`ComfyUI not reachable at ${BASE}. Is the comfyui service running?`);
    process.exit(1);
  }
  console.log(`ComfyUI reachable at ${BASE}. Prompt: "${POS}"`);

  const stopVram = startVramSampler();
  try {
    // First run pays the cold cost (checkpoint load into VRAM); second is warm.
    console.log("\nRun 1 (cold — includes model load into VRAM)…");
    const cold = await generate(1234567);
    console.log(`  done in ${(cold.ms / 1000).toFixed(1)}s`);

    console.log("Run 2 (warm — steady-state per-image time)…");
    const warm = await generate(7654321);
    console.log(`  done in ${(warm.ms / 1000).toFixed(1)}s`);

    // Save the warm run's PNG to a temp path.
    const img = warm.images[0];
    const q = new URLSearchParams({
      filename: img.filename,
      subfolder: img.subfolder,
      type: img.type,
    });
    const view = await fetch(`${BASE}/view?${q}`);
    if (!view.ok) throw new Error(`/view failed: ${view.status}`);
    const bytes = Buffer.from(await view.arrayBuffer());
    const outPath = path.join(os.tmpdir(), `comfyui-verify-${process.pid}.png`);
    fs.writeFileSync(outPath, bytes);

    const peakVram = stopVram();
    console.log("\n=== RESULT ===");
    console.log(`saved:            ${outPath} (${(bytes.length / 1024).toFixed(0)} KiB)`);
    console.log(`cold gen time:    ${(cold.ms / 1000).toFixed(1)}s (incl. model load)`);
    console.log(`warm gen time:    ${(warm.ms / 1000).toFixed(1)}s per image`);
    console.log(`peak VRAM used:   ${peakVram} MiB`);
    console.log("Open the PNG to confirm a real fantasy image was produced.");
  } finally {
    stopVram();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
