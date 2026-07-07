import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { CampaignSettings } from "./campaign-store.js";
import { readCharacterIdentity } from "./campaign-store.js";
import { buildImagePrompt } from "./image-prompt.js";
import { stripMetaChatter } from "./narration.js";

/** Hard cap on the /imagine prompt length. A scene description is at most a few
 * sentences; anything longer is almost certainly leaked context, and a shorter
 * prompt also keeps Grok focused on generating rather than "understanding". */
const MAX_IMAGE_PROMPT_CHARS = 500;

const execFileAsync = promisify(execFile);

/** Generous but bounded. Early testing saw ~4-6s, but real generations under
 * load exceed the old 90s ceiling (issue #52), so this is raised — and, more
 * importantly, a timeout no longer discards a finished image: the salvage step
 * in generateImage harvests whatever Grok actually wrote before it was killed. */
const GROK_TIMEOUT_MS = 180_000;

/** A copied-in image below this many bytes is treated as a truncated/partial
 * write (e.g. Grok killed mid-write on timeout) and not used. */
const MIN_IMAGE_BYTES = 1024;

export type ImageEntityType = "character" | "npc" | "location" | "item" | "boss" | "scene";

export interface ImageGenResult {
  ok: boolean;
  /** Path relative to campaignDir, e.g. "images/npc-barrow.jpg" */
  relPath?: string;
  error?: string;
}

/** Turns a raw entity/scene description into the `/imagine` prompt. Sanitizes
 * first: leaked DM planning chatter must never reach Grok — it makes a nonsense
 * image and, worse, reads as a coding instruction (see generateImage). Strips
 * recognized meta-chatter, hard-caps length, falls back to the raw description
 * (then a generic scene) if stripping leaves nothing, and appends the art style.
 * Exported for unit testing without a live Grok. Note this is one layer: the
 * temp-dir isolation + `--deny` tool restrictions in generateImage are what make
 * even an imperfectly-stripped prompt harmless. */
export function sanitizeImagePrompt(description: string, settings: CampaignSettings): string {
  const cleaned =
    stripMetaChatter(description).trim().slice(0, MAX_IMAGE_PROMPT_CHARS) ||
    description.trim().slice(0, MAX_IMAGE_PROMPT_CHARS) ||
    "a scene from the story";
  return buildImagePrompt(cleaned, settings);
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug || "entity";
}

/** Grok Build doesn't print the generated file's path to stdout — it only
 * appears in the per-session chat_history.jsonl it writes under
 * ~/.grok/sessions/<encodeURIComponent(cwd)>/<sessionId>/, as a GenerateImage
 * tool_result whose JSON content has a "path" field. Confirmed empirically
 * (see Slice 9 validation) rather than documented anywhere, so this is the
 * one place that assumption lives if Grok Build's session layout changes. */
function findGeneratedImagePath(campaignDir: string, sessionId: string): string | undefined {
  const chatHistoryPath = path.join(
    os.homedir(),
    ".grok",
    "sessions",
    encodeURIComponent(campaignDir),
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
      if (typeof parsed.path === "string" && fs.existsSync(parsed.path)) {
        // Last match wins — if this call somehow triggered more than one
        // image, keep the most recent.
        found = parsed.path;
      }
    } catch {
      continue;
    }
  }
  return found;
}

/** Timeout/fallback salvage (issue #52): Grok Build writes each generated image
 * under ~/.grok/sessions/<encodeURIComponent(cwd)>/<sessionId>/images/, and on
 * a timeout we no longer have the stdout sessionId — but the file may already
 * exist. Scan every session dir for this campaign's cwd and return the newest
 * image file written at/after `sinceMs` (this invocation), so a run that
 * finished just after we killed it still yields its image instead of a hard
 * failure. The `sinceMs` floor keeps us from resurrecting a stale image from an
 * earlier call. */
function findLatestGeneratedImage(campaignDir: string, sinceMs: number): string | undefined {
  const base = path.join(os.homedir(), ".grok", "sessions", encodeURIComponent(campaignDir));
  return newestImageUnder(base, sinceMs);
}

/** Newest image file under `<sessionsBase>/<sessionId>/images/`, written at or
 * after `sinceMs`, or undefined if none. Split out (and exported) so the
 * salvage logic is unit-testable without a real ~/.grok tree. */
export function newestImageUnder(sessionsBase: string, sinceMs: number): string | undefined {
  if (!fs.existsSync(sessionsBase)) return undefined;
  let best: string | undefined;
  let bestMtime = -1;
  for (const sessionId of fs.readdirSync(sessionsBase)) {
    const imagesDir = path.join(sessionsBase, sessionId, "images");
    if (!fs.existsSync(imagesDir)) continue;
    for (const name of fs.readdirSync(imagesDir)) {
      const full = path.join(imagesDir, name);
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
  return best;
}

/** Shells out to `grok -p "/imagine ..."` headlessly (design doc §2.2),
 * locates the resulting image file, and copies it into this campaign's own
 * images/ directory. Never throws — every failure mode (Grok Build not
 * installed/authenticated, timeout, unparseable output, no locatable image
 * file) is caught and returned as a clear failure result, since an image is
 * best-effort per §8 and must never block a turn from completing.
 *
 * Issue #60 (the real fix): Grok Build is a full agentic *coding* assistant,
 * not a bare image endpoint. Run before with `--cwd <campaignDir>` — which
 * lives INSIDE this git repo — it would read a stray prompt (e.g. leaked DM
 * planning chatter like "let me read the campaign files") as a coding task,
 * explore src/, edit files, and even `git commit`/`git push` to master on its
 * own (that is how rogue commit 0982eb6 landed). The prompt was also polluted
 * with that same meta-chatter instead of a scene description. So we now:
 *   1. run Grok in a throwaway temp dir with NO repo to touch (isolation is the
 *      real safety boundary — Grok can't wreck a repo that isn't there);
 *   2. `--deny` the mutating tools as defense-in-depth;
 *   3. strip meta-chatter from the description so the prompt is a scene, not an
 *      instruction — which also cuts latency (issue #58): a clean prompt in an
 *      empty dir generates in ~15-20s vs. minutes spent "exploring" the repo.
 * Do NOT restore `--cwd campaignDir`, and do NOT add `--effort` (it maps to
 * reasoningEffort, which grok-composer-2.5-fast rejects with a 400). */
export async function generateImage(
  campaignDir: string,
  entityType: ImageEntityType,
  name: string,
  description: string,
  settings: CampaignSettings
): Promise<ImageGenResult> {
  const prompt = sanitizeImagePrompt(description, settings);
  const slug = slugify(name);

  // Isolated, empty, non-repo working directory: Grok is keyed to this cwd for
  // both its tool sandbox and where it records the session/image, so locating
  // the result below uses `workDir`, not `campaignDir`.
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "chronicle-img-"));
  // Marks which images belong to THIS call for the timeout-salvage path below.
  const startedAt = Date.now();
  try {
    let stdout: string | undefined;
    let timedOut = false;
    try {
      const result = await execFileAsync(
        "grok",
        [
          "--cwd",
          workDir,
          "-p",
          `/imagine ${prompt}`,
          "--output-format",
          "json",
          // Trim the agentic scaffolding a one-shot image call doesn't need.
          "--no-plan",
          "--no-subagents",
          "--disable-web-search",
          // Defense-in-depth: even in the temp dir, forbid the tools Grok would
          // use to explore/mutate a filesystem or repo, so it can only generate.
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
        { timeout: GROK_TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: 10 * 1024 * 1024 }
      );
      stdout = result.stdout;
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { killed?: boolean; stderr?: string };
      if (e.code === "ENOENT") {
        console.error(`[image-generator] grok CLI not found on PATH for "${name}"`);
        return { ok: false, error: "Grok Build invocation failed: grok CLI not found on PATH" };
      }
      // A timeout (killed) is NOT terminal: Grok may have already written the
      // image before we killed it (issue #52). Fall through to the salvage scan.
      if (e.killed) {
        timedOut = true;
        console.error(`[image-generator] grok timed out after ${GROK_TIMEOUT_MS}ms for "${name}" — attempting to salvage`);
      } else {
        const reason = e.stderr?.trim() || e.message || String(err);
        console.error(`[image-generator] grok invocation failed for "${name}": ${reason}`);
        return { ok: false, error: `Grok Build invocation failed: ${reason}` };
      }
    }

    // Preferred: the exact path Grok recorded in this session's chat history.
    // Fallback/salvage: the newest image file written during this call (works
    // even when we have no sessionId because Grok was killed on timeout). Both
    // are keyed to workDir, the cwd Grok actually ran under.
    let sourcePath: string | undefined;
    if (stdout) {
      try {
        const parsed = JSON.parse(stdout);
        if (typeof parsed.sessionId === "string") {
          sourcePath = findGeneratedImagePath(workDir, parsed.sessionId);
        }
      } catch {
        // Unparseable stdout just means we lean on the salvage scan below.
      }
    }
    if (!sourcePath) {
      sourcePath = findLatestGeneratedImage(workDir, startedAt);
    }
    if (!sourcePath) {
      console.error(`[image-generator] no image file located for "${name}"${timedOut ? " (timed out)" : ""}`);
      return {
        ok: false,
        error: timedOut
          ? `Grok Build timed out after ${GROK_TIMEOUT_MS}ms and produced no image`
          : "Grok Build did not produce a locatable image file",
      };
    }

    const ext = path.extname(sourcePath) || ".jpg";
    const imagesDir = path.join(campaignDir, "images");
    const filename = `${entityType}-${slug}${ext}`;
    const destPath = path.join(imagesDir, filename);
    try {
      fs.mkdirSync(imagesDir, { recursive: true });
      fs.copyFileSync(sourcePath, destPath);
      // Guard against a truncated file if Grok was killed mid-write.
      if (fs.statSync(destPath).size < MIN_IMAGE_BYTES) {
        fs.rmSync(destPath, { force: true });
        return { ok: false, error: "Grok Build produced an incomplete image file" };
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[image-generator] failed to save image for "${name}": ${reason}`);
      return { ok: false, error: `Failed to save generated image: ${reason}` };
    }

    return { ok: true, relPath: path.join("images", filename) };
  } finally {
    // Best-effort cleanup — the image is already copied into the campaign, and
    // Grok's own copy persists under ~/.grok/sessions, so removing the empty
    // cwd is safe and never affects the result.
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

export const GENERATE_IMAGE_TOOL_NAME = "mcp__image-tools__generate_image";

/** Built per-turn, same pattern as createSeedMcpServer — campaignDir and
 * settings (art style) are baked in per call rather than read from shared
 * module state, so one campaign's in-flight turn can't pick up another's
 * cwd or style. Only wired into a turn's mcpServers/allowedTools when
 * settings.generateImages is true (see dm-engine.ts). */
/** Shared tool metadata (ADR-0018): one source of truth for the in-process
 * Claude tool and the stdio MCP server (src/mcp-servers/image-server.ts). */
export const GENERATE_IMAGE_DESCRIPTION = `Generate and save a portrait/scene image for a NEWLY created entity. Call
this ONCE, only on first creation, for one of the five trigger points: character
creation, first appearance of a named/major NPC, first entry into a significant
location, discovery of a notable item (magic/legendary gear, quest-critical
object), or a boss/major antagonist's reveal. Do not call it again for an
entity that already has an image recorded in its state-file entry, and do not
call it for routine mentions. Use the entity's already-established
description (what you just narrated or wrote to its state-file entry) as the
description argument — never invent new visual details here that aren't
already established elsewhere. On success, record the returned relative image
path in that entity's state-file entry (npc-roster.md's "Portrait asset ID"
field for NPCs/bosses, an "Image" line under the location's world-state.md
bullet, an "Image" note on the item/quest entry, a portraitImage field on
character-sheet.json) so it is never regenerated on a later mention. On
failure, note nothing in the state file and continue narrating normally — an
image is best-effort, never a blocker.`;

export const GENERATE_IMAGE_INPUT_SHAPE = {
  entityType: z
    .enum(["character", "npc", "location", "item", "boss"])
    .describe("Which kind of entity this image is for."),
  name: z.string().describe("The entity's name — used to build the saved filename."),
  description: z
    .string()
    .describe(
      "The entity's already-established visual description, drawn from your narration/state files, not invented fresh here."
    ),
};

/** Issue #104: the DM model free-writes the `description` it passes for a
 * character portrait, so the canonical appearance recorded on character-sheet.json
 * (issue #71) isn't guaranteed to reach Grok — portraits come out "close but not
 * matching". For the `character` entity type only, anchor the prompt with the
 * stored appearance: prepend it (so it survives the 500-char cap) unless the
 * model's description already restates it, avoiding pointless duplication. */
export function mergeCharacterAppearance(campaignDir: string, description: string): string {
  const { appearance } = readCharacterIdentity(campaignDir);
  if (!appearance) return description;
  const desc = description.trim();
  if (!desc) return appearance;
  if (desc.toLowerCase().includes(appearance.toLowerCase())) return desc;
  return `${appearance} ${desc}`;
}

/** Provider-neutral tool body. `campaignDir`/`settings` come from the caller:
 * a per-turn closure in-process, or env + the campaign's live settings in the
 * stdio server. */
export async function runGenerateImageTool(
  args: { entityType: "character" | "npc" | "location" | "item" | "boss"; name: string; description: string },
  campaignDir: string,
  settings: CampaignSettings
): Promise<{ content: { type: "text"; text: string }[] }> {
  const { entityType, name } = args;
  const description =
    entityType === "character" ? mergeCharacterAppearance(campaignDir, args.description) : args.description;
  const result = await generateImage(campaignDir, entityType, name, description, settings);
  return {
    content: [
      {
        type: "text" as const,
        text: result.ok
          ? `Image generated and saved at ${result.relPath}. Record this path in ${name}'s state-file entry now.`
          : `Image generation failed (${result.error}). Continue narrating normally without an image for ${name} — do not retry this turn.`,
      },
    ],
  };
}

export function createImageMcpServer(campaignDir: string, settings: CampaignSettings) {
  const generateImageTool = tool(
    "generate_image",
    GENERATE_IMAGE_DESCRIPTION,
    GENERATE_IMAGE_INPUT_SHAPE,
    async (args) => runGenerateImageTool(args, campaignDir, settings)
  );

  return createSdkMcpServer({ name: "image-tools", tools: [generateImageTool] });
}
