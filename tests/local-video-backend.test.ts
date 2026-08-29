import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  generateLocalVideo,
  videoDims,
  videoModelsMissing,
} from "../src/video-backends/local.js";
import {
  renderWanWorkflow,
  normalizeFrames,
  normalizeDimension,
  DEFAULT_WIDTH,
} from "../src/video-backends/wan-workflow.js";
import { renderLtxvWorkflow, normalizeLtxvFrames } from "../src/video-backends/ltxv-workflow.js";
import { resolveVideoProvider, resolveVideoModel } from "../src/video-backends/index.js";
import { getVideoModel, DEFAULT_ANIMATE_MODEL } from "../src/video-backends/video-models.js";
import type { VideoBackendArgs } from "../src/video-backends/types.js";
import type { CampaignSettings } from "../src/campaign-store.js";
import type { VideoConfig } from "../src/video-store.js";

const SETTINGS = { model: "claude-sonnet-5", provider: "claude", artStyle: "ink wash" } as unknown as CampaignSettings;
const VIDEO: VideoConfig = { durationSeconds: 5, resolution: "480p", aspectRatio: "square" };

// --- renderers: pure graph mutation, no network ---

test("renderWanWorkflow: injects prompt, seed, image, and snapped dims/frames by node id", () => {
  const g = renderWanWorkflow({ prompt: "a knight", seed: 42, width: 800, height: 500, frames: 120, imageName: "in.png" });
  assert.equal(g["6"].inputs.text, "a knight");
  assert.equal(g["3"].inputs.seed, 42);
  assert.equal(g["52"].inputs.image, "in.png");
  // 800→snapped /32 = 800; 500→512; frames 120→ nearest 4k+1 ≤121 = 121.
  assert.equal(g["53"].inputs.width, 800);
  assert.equal(g["55"].inputs.height, 512);
  assert.equal(g["55"].inputs.length, 121);
});

test("renderWanWorkflow: appends the caller negative to the template baseline, never replacing it", () => {
  const baseline = JSON.parse(
    fs.readFileSync(path.resolve("src/workflows/wan22-ti2v-5b-i2v.json"), "utf8")
  )["7"].inputs.text as string;
  const g = renderWanWorkflow({ prompt: "x", negativePrompt: "extra limbs", imageName: "in.png" });
  assert.equal(g["7"].inputs.text, `${baseline}, extra limbs`);
});

test("normalizeFrames: snaps to Wan's 4k+1 grid and caps at 121", () => {
  assert.equal(normalizeFrames(1), 1);
  assert.equal(normalizeFrames(120), 121);
  assert.equal(normalizeFrames(1000), 121);
  assert.equal(normalizeFrames(50), 49); // nearest 4k+1
});

test("normalizeDimension: snaps to /32 with a floor, defaults when absent", () => {
  assert.equal(normalizeDimension(undefined, DEFAULT_WIDTH), DEFAULT_WIDTH);
  assert.equal(normalizeDimension(500, DEFAULT_WIDTH), 512);
  assert.equal(normalizeDimension(1, DEFAULT_WIDTH), 32);
});

test("renderLtxvWorkflow: injects prompt, noise_seed, image, and 8n+1 length", () => {
  const g = renderLtxvWorkflow({ prompt: "a market", seed: 7, frames: 100, imageName: "in.png" });
  assert.equal(g["6"].inputs.text, "a market");
  assert.equal(g["72"].inputs.noise_seed, 7);
  assert.equal(g["78"].inputs.image, "in.png");
  assert.equal(g["77"].inputs.length, normalizeLtxvFrames(100));
});

test("normalizeLtxvFrames: snaps to the 8n+1 grid", () => {
  assert.equal(normalizeLtxvFrames(97), 97); // 8*12+1
  assert.equal(normalizeLtxvFrames(100), 97);
  assert.equal(normalizeLtxvFrames(1), 1);
});

// --- VideoConfig → dims mapping ---

test("videoDims: maps resolution/aspect to width/height and duration to frames", () => {
  assert.deepEqual(videoDims({ durationSeconds: 5, resolution: "480p", aspectRatio: "square" }), {
    width: 480,
    height: 480,
    frames: 120,
  });
  const wide = videoDims({ durationSeconds: 3, resolution: "720p", aspectRatio: "16:9" });
  assert.equal(wide.height, 704);
  assert.ok(wide.width > wide.height); // landscape
  const tall = videoDims({ durationSeconds: 3, resolution: "480p", aspectRatio: "9:16" });
  assert.ok(tall.height > tall.width); // portrait
});

// --- resolver precedence ---

test("resolveVideoProvider: campaign → user → config default → 'grok'", () => {
  assert.equal(resolveVideoProvider(undefined, "local", "grok"), "local");
  assert.equal(resolveVideoProvider("local", undefined, "grok"), "local");
  assert.equal(resolveVideoProvider(undefined, undefined, "local"), "local");
  assert.equal(resolveVideoProvider(undefined, undefined, "nonsense"), "grok");
  // Campaign wins over user.
  assert.equal(resolveVideoProvider("grok", "local", "grok"), "local");
});

test("resolveVideoModel: campaign → user → config default → DEFAULT_ANIMATE_MODEL", () => {
  assert.equal(resolveVideoModel(undefined, "wan-5b", "ltxv"), "wan-5b");
  assert.equal(resolveVideoModel("wan-5b", undefined, "ltxv"), "wan-5b");
  assert.equal(resolveVideoModel(undefined, undefined, "ltxv"), "ltxv");
  assert.equal(resolveVideoModel(undefined, undefined, "bogus"), DEFAULT_ANIMATE_MODEL);
});

// --- transport: stubbed fetch, no GPU / no ComfyUI ---

function jsonRes(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}
function bytesRes(status: number, size = 8192): Response {
  return { ok: status >= 200 && status < 300, status, arrayBuffer: async () => new Uint8Array(size).fill(1).buffer } as unknown as Response;
}

/** /object_info reply that reports every requested loader combo as containing the model files. */
function objectInfoReady(model: "wan-5b" | "ltxv"): Record<string, unknown> {
  const spec = getVideoModel(model);
  const out: Record<string, any> = {};
  for (const f of spec.files) {
    out[f.loaderClass] = { input: { required: { [f.inputName]: [[f.file]] } } };
  }
  return out;
}

function withCampaignDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chronicle-vid-test-"));
  return fn(dir).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

const PROMPT_ID = "vid-1";

test("generateLocalVideo: fails cleanly with no base image (local i2v needs a source frame)", async () => {
  await withCampaignDir(async (dir) => {
    const args: VideoBackendArgs = { campaignDir: dir, entityType: "npc", name: "Barrow", description: "a dwarf", settings: SETTINGS, video: VIDEO, videoModel: "ltxv" };
    const result = await generateLocalVideo(args, (async () => jsonRes(200, {})) as unknown as typeof fetch);
    assert.equal(result.ok, false);
    assert.match(result.error!, /needs a base image/);
  });
});

test("generateLocalVideo: fails cleanly when the model files are not installed", async () => {
  await withCampaignDir(async (dir) => {
    fs.mkdirSync(path.join(dir, "images"), { recursive: true });
    fs.writeFileSync(path.join(dir, "images", "npc-barrow.png"), Buffer.alloc(2048, 1));
    const args: VideoBackendArgs = { campaignDir: dir, entityType: "npc", name: "Barrow", description: "a dwarf", settings: SETTINGS, video: VIDEO, videoModel: "ltxv", baseImageRelPath: "images/npc-barrow.png" };
    // /object_info returns nothing → all files missing.
    const result = await generateLocalVideo(args, (async () => jsonRes(200, {})) as unknown as typeof fetch);
    assert.equal(result.ok, false);
    assert.match(result.error!, /model files not installed/);
  });
});

test("generateLocalVideo: happy path uploads, submits, polls, and saves the mp4", async () => {
  await withCampaignDir(async (dir) => {
    fs.mkdirSync(path.join(dir, "images"), { recursive: true });
    fs.writeFileSync(path.join(dir, "images", "npc-barrow.png"), Buffer.alloc(2048, 1));
    let submitted: any;
    const fetchFn = (async (url: string, init?: any) => {
      const u = String(url);
      if (u.includes("/object_info/")) {
        const cls = u.split("/object_info/")[1];
        return jsonRes(200, objectInfoReady("ltxv")[cls] ? { [cls]: objectInfoReady("ltxv")[cls] } : {});
      }
      if (u.includes("/upload/image")) return jsonRes(200, { name: "chronicle-base.png" });
      if (u.includes("/prompt")) {
        submitted = JSON.parse(init.body);
        return jsonRes(200, { prompt_id: PROMPT_ID });
      }
      if (u.includes("/history/")) {
        return jsonRes(200, { [PROMPT_ID]: { status: { status_str: "success" }, outputs: { "81": { videos: [{ filename: "out.mp4", subfolder: "", type: "output" }] } } } });
      }
      if (u.includes("/view")) return bytesRes(200);
      throw new Error(`unexpected url ${u}`);
    }) as unknown as typeof fetch;

    const args: VideoBackendArgs = { campaignDir: dir, entityType: "npc", name: "Barrow", description: "a dwarf", settings: SETTINGS, video: VIDEO, videoModel: "ltxv", baseImageRelPath: "images/npc-barrow.png" };
    const result = await generateLocalVideo(args, fetchFn);
    assert.equal(result.ok, true);
    assert.equal(result.relPath, path.join("videos", "npc-barrow.mp4"));
    assert.ok(fs.existsSync(path.join(dir, "videos", "npc-barrow.mp4")));
    // The submitted graph is the LTXV graph with the uploaded image wired in.
    assert.equal(submitted.prompt["78"].inputs.image, "chronicle-base.png");
    assert.ok(submitted.client_id.startsWith("chronicle-vid-npc-"));
  });
});

test("videoModelsMissing: reports files whose /object_info combo lacks them", async () => {
  const spec = getVideoModel("ltxv");
  // First file present, second missing.
  const fetchFn = (async (url: string) => {
    const cls = String(url).split("/object_info/")[1];
    if (cls === spec.files[0].loaderClass) {
      return jsonRes(200, { [cls]: { input: { required: { [spec.files[0].inputName]: [[spec.files[0].file]] } } } });
    }
    return jsonRes(200, { [cls]: { input: { required: { [spec.files[1].inputName]: [[]] } } } });
  }) as unknown as typeof fetch;
  const missing = await videoModelsMissing("http://x", fetchFn, spec.files);
  assert.deepEqual(missing, [`${spec.files[1].subdir}/${spec.files[1].file}`]);
});
