// ADR-0035: the "local" VideoBackend — self-hosted ComfyUI image-to-video (Wan 2.2
// TI2V 5B or LTX-Video 2B), ported from imagegen-service's /animate transport. Like
// the local IMAGE backend (ADR-0027): plain HTTP, no agent, no sandbox — upload the
// still, submit a graph, poll, save the mp4. Keeps the never-throw discipline: a clip
// is best-effort, so every failure returns { ok: false, error }, never throws.
//
// Local i2v differs from grok in two ways worth stating: it REQUIRES a base still
// (there is no text-to-video path — a missing base image is a clean failure), and it
// preflights the model files HARD (animation can't degrade to "prompt-only"). Video is
// minutes, not seconds, and the first job after an image↔video switch pays a model-load
// pause, so the poll budget is 20 minutes.
import fs from "node:fs";
import path from "node:path";
import { sanitizeImagePrompt, mergeCharacterAppearance } from "../image-generator.js";
import { config } from "../config.js";
import type { VideoConfig } from "../video-store.js";
import type { VideoBackend, VideoBackendArgs, VideoGenResult } from "./types.js";
import {
  ANIMATE_MODELS,
  getVideoModel,
  type AnimateModel,
  type VideoModelFile,
  type VideoRenderParams,
} from "./video-models.js";

export type FetchFn = typeof fetch;

const REQUEST_TIMEOUT_MS = 30_000;
const VIEW_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 1_000;
/** Video is minutes, not seconds; the first job after a model swap also pays a load
 * pause (ADR-0035). 20 minutes leaves generous headroom on a busy 12 GB host. */
const ANIMATE_TIMEOUT_MS = 20 * 60_000;
/** A saved clip below this many bytes is treated as truncated and rejected. */
const MIN_VIDEO_BYTES = 4096;

function comfyBase(): string {
  return (config.comfyui.url || "http://localhost:8188").replace(/\/$/, "");
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug || "entity";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ComfyUI's /object_info combo shape — names either at [0] (legacy) or under the
 * trailing meta object's `options`. Mirrors imagegen-service's comboOptions. */
function comboOptions(def: unknown): string[] {
  if (!Array.isArray(def)) return [];
  if (Array.isArray(def[0])) return def[0] as string[];
  const meta = def[def.length - 1];
  if (meta && typeof meta === "object" && Array.isArray((meta as Record<string, unknown>).options)) {
    return (meta as Record<string, unknown>).options as string[];
  }
  return [];
}

async function objectInfoOptions(base: string, fetchFn: FetchFn, cls: string, input: string): Promise<string[]> {
  try {
    const res = await fetchFn(`${base}/object_info/${cls}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) return [];
    const info = (await res.json().catch(() => ({}))) as Record<string, any>;
    return comboOptions(info?.[cls]?.input?.required?.[input]);
  } catch {
    return [];
  }
}

/** Which of a model's files ComfyUI can't currently load (by its own /object_info) —
 * as "subdir/file" strings for the actionable "not installed" message. Empty = all present. */
export async function videoModelsMissing(
  base: string,
  fetchFn: FetchFn,
  files: readonly VideoModelFile[]
): Promise<string[]> {
  const checks = await Promise.all(
    files.map(async (f) => ({
      f,
      present: (await objectInfoOptions(base, fetchFn, f.loaderClass, f.inputName)).includes(f.file),
    }))
  );
  return checks.filter((c) => !c.present).map((c) => `${c.f.subdir}/${c.f.file}`);
}

/** Upload a local still to ComfyUI's input/ dir; returns the stored filename for a
 * LoadImage node. A unique name per upload avoids clobbering on overlap. Throws on
 * failure (the caller turns it into a clean result). */
async function uploadStill(base: string, fetchFn: FetchFn, absPath: string): Promise<string> {
  const bytes = fs.readFileSync(absPath);
  const ext = (path.extname(absPath) || ".png").toLowerCase();
  const type = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
  const filename = `chronicle-base-${Date.now().toString(16)}${ext}`;
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
  // A subfolder (rare) must be prefixed so LoadImage finds it.
  return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
}

/** #158 (Slice F): which local video models the ComfyUI host can actually run right
 * now (all their files installed), for the model picker. Probes each model's files via
 * /object_info. On an unreachable host every model reports `ready: false`. */
export async function videoModelsAvailability(
  fetchFn: FetchFn = fetch
): Promise<Array<{ model: AnimateModel; label: string; ready: boolean }>> {
  const base = comfyBase();
  return Promise.all(
    ANIMATE_MODELS.map(async (id) => {
      const spec = getVideoModel(id);
      let ready = false;
      try {
        ready = (await videoModelsMissing(base, fetchFn, spec.files)).length === 0;
      } catch {
        ready = false;
      }
      return { model: id, label: spec.label, ready };
    })
  );
}

interface OutFile {
  filename: string;
  subfolder: string;
  type: string;
}

/** Scan a /history entry's outputs for the first produced file. SaveVideo's output key
 * varies by ComfyUI build (images/gifs/videos), so take the first output array whose
 * first element carries a `filename`. */
function findOutputFile(entry: any): OutFile | undefined {
  for (const nodeOut of Object.values(entry?.outputs ?? {}) as any[]) {
    for (const val of Object.values(nodeOut ?? {})) {
      if (Array.isArray(val)) {
        const first = val.find((x) => x && typeof x === "object" && "filename" in x);
        if (first) return first as OutFile;
      }
    }
  }
  return undefined;
}

/** Map Chronicle's coarse VideoConfig (duration/resolution/aspect) onto the renderers'
 * width/height/frames. fps is left to each model's native default. The renderers snap
 * dims to /32 and frames to their own lattice, and cap frames (~5s), so a duration
 * beyond a model's max is clamped rather than rejected. Exported for tests. */
export function videoDims(video: VideoConfig): { width: number; height: number; frames: number } {
  const short = video.resolution === "720p" ? 704 : 480;
  const longSide = Math.round((short * 16) / 9);
  let width = short;
  let height = short;
  if (video.aspectRatio === "16:9") width = longSide;
  else if (video.aspectRatio === "9:16") height = longSide;
  // Native fps is ~24 on both models; frames follow the requested duration.
  const frames = Math.max(1, Math.round(video.durationSeconds * 24));
  return { width, height, frames };
}

function fail(name: string, error: string): VideoGenResult {
  console.error(`[video-generator] local ComfyUI animation failed for "${name}": ${error}`);
  return { ok: false, error };
}

/** Animate a still into a clip on local ComfyUI. `fetchFn` is injectable so tests
 * drive the whole HTTP dance with a stub — no GPU, no running ComfyUI. Never throws. */
export async function generateLocalVideo(args: VideoBackendArgs, fetchFn: FetchFn = fetch): Promise<VideoGenResult> {
  const { campaignDir, entityType, name, description, settings, video } = args;
  const base = comfyBase();
  const spec = getVideoModel(args.videoModel);

  // Local i2v needs a source frame — there is no text-to-video path.
  if (!args.baseImageRelPath) {
    return fail(name, `local video (${spec.label}) needs a base image to animate — none was provided`);
  }
  const srcPath = path.join(campaignDir, args.baseImageRelPath);
  if (!fs.existsSync(srcPath)) {
    return fail(name, `base image not found at ${args.baseImageRelPath}`);
  }

  try {
    // Preflight: the model's files must be installed — animation can't degrade.
    const missing = await videoModelsMissing(base, fetchFn, spec.files);
    if (missing.length) {
      return fail(
        name,
        `${spec.label} model files not installed on the ComfyUI host: ${missing.join(", ")} — run ${spec.fetchHint}, then restart ComfyUI`
      );
    }

    let imageName: string;
    try {
      imageName = await uploadStill(base, fetchFn, srcPath);
    } catch (err) {
      return fail(name, `input image upload failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const effectiveDescription =
      entityType === "character" ? mergeCharacterAppearance(campaignDir, description) : description;
    const prompt = sanitizeImagePrompt(effectiveDescription, settings);
    const { width, height, frames } = videoDims(video);
    const renderParams: VideoRenderParams = { prompt, width, height, frames, imageName };
    const graph = spec.render(renderParams);

    const clientId = `chronicle-vid-${entityType}-${Date.now()}`;
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

    const deadline = Date.now() + ANIMATE_TIMEOUT_MS;
    let out: OutFile | undefined;
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
      out = findOutputFile(entry);
      if (out) break;
    }
    if (!out) return fail(name, `ComfyUI produced no video within ${ANIMATE_TIMEOUT_MS}ms`);

    const q = new URLSearchParams({ filename: out.filename, subfolder: out.subfolder, type: out.type });
    const view = await fetchFn(`${base}/view?${q}`, { signal: AbortSignal.timeout(VIEW_TIMEOUT_MS) });
    if (!view.ok) return fail(name, `ComfyUI /view returned ${view.status}`);
    const bytes = Buffer.from(await view.arrayBuffer());

    const ext = path.extname(out.filename).toLowerCase() || ".mp4";
    const videosDir = path.join(campaignDir, "videos");
    const filename = `${entityType}-${slugify(name)}${ext}`;
    const destPath = path.join(videosDir, filename);
    try {
      fs.mkdirSync(videosDir, { recursive: true });
      fs.writeFileSync(destPath, bytes);
      if (fs.statSync(destPath).size < MIN_VIDEO_BYTES) {
        fs.rmSync(destPath, { force: true });
        return fail(name, "ComfyUI produced an incomplete video file");
      }
    } catch (err) {
      return fail(name, `Failed to save generated video: ${err instanceof Error ? err.message : String(err)}`);
    }

    return { ok: true, relPath: path.join("videos", filename) };
  } catch (err) {
    return fail(name, `ComfyUI request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export const localVideoBackend: VideoBackend = {
  provider: "local",
  generate: (args) => generateLocalVideo(args),
};
