import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CampaignSettings } from "./campaign-store.js";
import { sanitizeImagePrompt, mergeCharacterAppearance, type ImageEntityType } from "./image-generator.js";
import { aspectPhrase, type VideoConfig } from "./video-store.js";

const execFileAsync = promisify(execFile);

/** Video generation is markedly slower than a still (issue #118 notes: longer =
 * more expensive + slower, up to ~15s clips). Give generous headroom over the
 * 180s image ceiling; a timeout no longer discards a finished clip — the salvage
 * scan harvests whatever Grok wrote before it was killed (same as images). */
const GROK_VIDEO_TIMEOUT_MS = 420_000;

/** A copied-in video below this many bytes is treated as a truncated/partial
 * write (e.g. Grok killed mid-write on timeout) and not used. */
const MIN_VIDEO_BYTES = 4096;

/** File extensions Grok Imagine may emit for a clip. Verified empirically
 * (see the scratch script) — the layout, like the image one, is undocumented. */
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov"]);

/** Grok may write clips under either a `videos/` or the same `images/` session
 * subdir it uses for stills — scan both (undocumented, confirmed by observation). */
const VIDEO_SESSION_SUBDIRS = ["videos", "images"];

export interface VideoGenResult {
  ok: boolean;
  /** Path relative to campaignDir, e.g. "videos/npc-barrow.mp4" */
  relPath?: string;
  error?: string;
}

export interface GenerateVideoOptions {
  /** When set, the two-step workflow (issue #118): the existing still at this
   * campaign-relative path is copied into the isolated workDir and referenced by
   * filename in the prompt, so Grok animates that exact image rather than
   * inventing a fresh composition. Session context ("the image I just
   * generated") is NOT relied on — each call runs in a fresh temp dir/session. */
  baseImageRelPath?: string;
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug || "entity";
}

/** Turns a scene/entity description + resolved params into the `/imagine-video`
 * prompt. Reuses the image pipeline for the styled, sanitized, length-capped
 * description (so a video prompt is sanitized against leaked DM chatter exactly
 * like an image one), then appends a prompt-driven parameter clause and, when
 * animating an existing still, prepends the base image's filename (Option B in
 * the issue notes). Exported for unit testing without a live Grok. */
export function buildVideoPrompt(
  description: string,
  settings: CampaignSettings,
  video: VideoConfig,
  baseImageFilename?: string
): string {
  const styled = sanitizeImagePrompt(description, settings);
  const params = `${video.durationSeconds} second video, ${video.resolution} resolution, ${aspectPhrase(
    video.aspectRatio
  )}`;
  const body = `${styled}, ${params}`;
  // The base image goes first so Grok reads it as the source frame to animate.
  return baseImageFilename ? `${baseImageFilename} ${body}` : body;
}

/** Grok Build records the generated file's path in the per-session
 * chat_history.jsonl under ~/.grok/sessions/<encodeURIComponent(cwd)>/<sessionId>/,
 * as a tool_result whose JSON content has a "path" field (same layout the image
 * generator relies on). Here we keep only paths with a video extension — an
 * /imagine-video call may also leave an intermediate still. Last match wins. */
function findGeneratedVideoPath(workDir: string, sessionId: string): string | undefined {
  const chatHistoryPath = path.join(
    os.homedir(),
    ".grok",
    "sessions",
    encodeURIComponent(workDir),
    sessionId,
    "chat_history.jsonl"
  );
  if (!fs.existsSync(chatHistoryPath)) return undefined;

  let found: string | undefined;
  for (const line of fs.readFileSync(chatHistoryPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      typeof entry !== "object" ||
      entry === null ||
      (entry as { type?: unknown }).type !== "tool_result" ||
      typeof (entry as { content?: unknown }).content !== "string"
    ) {
      continue;
    }
    try {
      const parsed = JSON.parse((entry as { content: string }).content);
      if (
        typeof parsed.path === "string" &&
        VIDEO_EXTS.has(path.extname(parsed.path).toLowerCase()) &&
        fs.existsSync(parsed.path)
      ) {
        found = parsed.path;
      }
    } catch {
      continue;
    }
  }
  return found;
}

/** Timeout/fallback salvage (mirrors the image path): the newest video file
 * written at/after `sinceMs` under any of this cwd's session subdirs, or
 * undefined. Split out and exported so the salvage logic is unit-testable
 * without a real ~/.grok tree. */
export function newestVideoUnder(sessionsBase: string, sinceMs: number): string | undefined {
  if (!fs.existsSync(sessionsBase)) return undefined;
  let best: string | undefined;
  let bestMtime = -1;
  for (const sessionId of fs.readdirSync(sessionsBase)) {
    for (const sub of VIDEO_SESSION_SUBDIRS) {
      const dir = path.join(sessionsBase, sessionId, sub);
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        if (!VIDEO_EXTS.has(path.extname(name).toLowerCase())) continue;
        const full = path.join(dir, name);
        let stat: fs.Stats;
        try {
          stat = fs.statSync(full);
        } catch {
          continue;
        }
        // 1s slack for coarse filesystem mtime resolution vs. Date.now().
        if (!stat.isFile() || stat.mtimeMs + 1000 < sinceMs) continue;
        if (stat.mtimeMs > bestMtime) {
          bestMtime = stat.mtimeMs;
          best = full;
        }
      }
    }
  }
  return best;
}

function findLatestGeneratedVideo(workDir: string, sinceMs: number): string | undefined {
  const base = path.join(os.homedir(), ".grok", "sessions", encodeURIComponent(workDir));
  return newestVideoUnder(base, sinceMs);
}

/** Shells out to `grok -p "/imagine-video ..."` headlessly and copies the
 * resulting clip into this campaign's own videos/ directory. A direct analog of
 * generateImage (same isolated-temp-dir + `--deny` safety model from issue #60,
 * same never-throw contract): every failure mode returns a clear
 * { ok: false, error } rather than throwing, since a clip is best-effort and
 * must never block the UI. Do NOT restore `--cwd campaignDir` and do NOT add
 * `--effort` — see the generateImage comment for why. */
export async function generateVideo(
  campaignDir: string,
  entityType: ImageEntityType,
  name: string,
  description: string,
  settings: CampaignSettings,
  video: VideoConfig,
  opts: GenerateVideoOptions = {}
): Promise<VideoGenResult> {
  const effectiveDescription =
    entityType === "character" ? mergeCharacterAppearance(campaignDir, description) : description;
  const slug = slugify(name);

  // Isolated, empty, non-repo working directory (issue #60): Grok is keyed to
  // this cwd for both its tool sandbox and where it records the session/clip.
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "chronicle-vid-"));
  const startedAt = Date.now();
  try {
    // Two-step workflow: stage the existing still inside workDir so the prompt
    // can reference it by a plain filename (cwd IS workDir; Read is not denied).
    let baseImageFilename: string | undefined;
    if (opts.baseImageRelPath) {
      const srcPath = path.join(campaignDir, opts.baseImageRelPath);
      if (fs.existsSync(srcPath)) {
        baseImageFilename = `base${path.extname(srcPath) || ".jpg"}`;
        try {
          fs.copyFileSync(srcPath, path.join(workDir, baseImageFilename));
        } catch {
          // If staging fails, fall back to a pure text-to-video prompt.
          baseImageFilename = undefined;
        }
      }
    }

    const prompt = buildVideoPrompt(effectiveDescription, settings, video, baseImageFilename);

    let stdout: string | undefined;
    let timedOut = false;
    try {
      const result = await execFileAsync(
        "grok",
        [
          "--cwd",
          workDir,
          "-p",
          `/imagine-video ${prompt}`,
          "--output-format",
          "json",
          "--no-plan",
          "--no-subagents",
          "--disable-web-search",
          // Defense-in-depth (same as images): forbid the tools Grok would use
          // to explore/mutate a filesystem or repo, so it can only generate.
          // Read is intentionally NOT denied so it can load the staged base image.
          "--deny",
          "Bash",
          "--deny",
          "Shell",
          "--deny",
          "Terminal",
          "--deny",
          "Edit",
          "--deny",
          "Write",
        ],
        { timeout: GROK_VIDEO_TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: 10 * 1024 * 1024 }
      );
      stdout = result.stdout;
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { killed?: boolean; stderr?: string };
      if (e.code === "ENOENT") {
        console.error(`[video-generator] grok CLI not found on PATH for "${name}"`);
        return { ok: false, error: "Grok Build invocation failed: grok CLI not found on PATH" };
      }
      if (e.killed) {
        timedOut = true;
        console.error(
          `[video-generator] grok timed out after ${GROK_VIDEO_TIMEOUT_MS}ms for "${name}" — attempting to salvage`
        );
      } else {
        const reason = e.stderr?.trim() || e.message || String(err);
        console.error(`[video-generator] grok invocation failed for "${name}": ${reason}`);
        return { ok: false, error: `Grok Build invocation failed: ${reason}` };
      }
    }

    let sourcePath: string | undefined;
    if (stdout) {
      try {
        const parsed = JSON.parse(stdout);
        if (typeof parsed.sessionId === "string") {
          sourcePath = findGeneratedVideoPath(workDir, parsed.sessionId);
        }
      } catch {
        // Unparseable stdout just means we lean on the salvage scan below.
      }
    }
    if (!sourcePath) {
      sourcePath = findLatestGeneratedVideo(workDir, startedAt);
    }
    if (!sourcePath) {
      console.error(`[video-generator] no video file located for "${name}"${timedOut ? " (timed out)" : ""}`);
      return {
        ok: false,
        error: timedOut
          ? `Grok Build timed out after ${GROK_VIDEO_TIMEOUT_MS}ms and produced no video`
          : "Grok Build did not produce a locatable video file",
      };
    }

    const ext = path.extname(sourcePath) || ".mp4";
    const videosDir = path.join(campaignDir, "videos");
    const filename = `${entityType}-${slug}${ext}`;
    const destPath = path.join(videosDir, filename);
    try {
      fs.mkdirSync(videosDir, { recursive: true });
      fs.copyFileSync(sourcePath, destPath);
      if (fs.statSync(destPath).size < MIN_VIDEO_BYTES) {
        fs.rmSync(destPath, { force: true });
        return { ok: false, error: "Grok Build produced an incomplete video file" };
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[video-generator] failed to save video for "${name}": ${reason}`);
      return { ok: false, error: `Failed to save generated video: ${reason}` };
    }

    return { ok: true, relPath: path.join("videos", filename) };
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
