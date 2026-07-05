import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { CampaignSettings } from "./campaign-store.js";
import { buildImagePrompt } from "./image-prompt.js";

const execFileAsync = promisify(execFile);

/** Generous but bounded — image generation observed at ~4-6s in testing,
 * this leaves headroom for a slow/loaded host without hanging a turn
 * indefinitely if Grok Build wedges. */
const GROK_TIMEOUT_MS = 90_000;

export type ImageEntityType = "character" | "npc" | "location" | "item" | "boss";

export interface ImageGenResult {
  ok: boolean;
  /** Path relative to campaignDir, e.g. "images/npc-barrow.jpg" */
  relPath?: string;
  error?: string;
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

/** Shells out to `grok -p "/imagine ..."` headlessly (design doc §2.2),
 * locates the resulting image file, and copies it into this campaign's own
 * images/ directory. Never throws — every failure mode (Grok Build not
 * installed/authenticated, timeout, unparseable output, no locatable image
 * file) is caught and returned as a clear failure result, since an image is
 * best-effort per §8 and must never block a turn from completing. */
export async function generateImage(
  campaignDir: string,
  entityType: ImageEntityType,
  name: string,
  description: string,
  settings: CampaignSettings
): Promise<ImageGenResult> {
  const prompt = buildImagePrompt(description, settings);
  const slug = slugify(name);

  let stdout: string;
  try {
    const result = await execFileAsync(
      "grok",
      ["--cwd", campaignDir, "-p", `/imagine ${prompt}`, "--output-format", "json"],
      { timeout: GROK_TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: 10 * 1024 * 1024 }
    );
    stdout = result.stdout;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { killed?: boolean; stderr?: string };
    const reason = e.killed
      ? `timed out after ${GROK_TIMEOUT_MS}ms`
      : e.code === "ENOENT"
        ? "grok CLI not found on PATH"
        : e.stderr?.trim() || e.message || String(err);
    console.error(`[image-generator] grok invocation failed for "${name}": ${reason}`);
    return { ok: false, error: `Grok Build invocation failed: ${reason}` };
  }

  let sessionId: string;
  try {
    const parsed = JSON.parse(stdout);
    if (typeof parsed.sessionId !== "string") {
      throw new Error("response had no sessionId");
    }
    sessionId = parsed.sessionId;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[image-generator] could not parse grok output for "${name}": ${reason}`);
    return { ok: false, error: `Grok Build returned unparseable output: ${reason}` };
  }

  const sourcePath = findGeneratedImagePath(campaignDir, sessionId);
  if (!sourcePath) {
    console.error(`[image-generator] no image file located for session ${sessionId} ("${name}")`);
    return { ok: false, error: "Grok Build did not produce a locatable image file" };
  }

  const ext = path.extname(sourcePath) || ".jpg";
  const imagesDir = path.join(campaignDir, "images");
  const filename = `${entityType}-${slug}${ext}`;
  const destPath = path.join(imagesDir, filename);
  try {
    fs.mkdirSync(imagesDir, { recursive: true });
    fs.copyFileSync(sourcePath, destPath);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[image-generator] failed to save image for "${name}": ${reason}`);
    return { ok: false, error: `Failed to save generated image: ${reason}` };
  }

  return { ok: true, relPath: path.join("images", filename) };
}

export const GENERATE_IMAGE_TOOL_NAME = "mcp__image-tools__generate_image";

/** Built per-turn, same pattern as createSeedMcpServer — campaignDir and
 * settings (art style) are baked in per call rather than read from shared
 * module state, so one campaign's in-flight turn can't pick up another's
 * cwd or style. Only wired into a turn's mcpServers/allowedTools when
 * settings.generateImages is true (see dm-engine.ts). */
export function createImageMcpServer(campaignDir: string, settings: CampaignSettings) {
  const generateImageTool = tool(
    "generate_image",
    `Generate and save a portrait/scene image for a NEWLY created entity. Call
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
image is best-effort, never a blocker.`,
    {
      entityType: z
        .enum(["character", "npc", "location", "item", "boss"])
        .describe("Which kind of entity this image is for."),
      name: z.string().describe("The entity's name — used to build the saved filename."),
      description: z
        .string()
        .describe(
          "The entity's already-established visual description, drawn from your narration/state files, not invented fresh here."
        ),
    },
    async ({ entityType, name, description }) => {
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
  );

  return createSdkMcpServer({ name: "image-tools", tools: [generateImageTool] });
}
