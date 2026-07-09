import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { CampaignSettings } from "./campaign-store.js";
import { readCharacterIdentity } from "./campaign-store.js";
import { buildImagePrompt } from "./image-prompt.js";
import { stripMetaChatter } from "./narration.js";
import type { ImageEntityType, ImageGenResult } from "./image-backends/types.js";
import { getImageBackend, resolveImageProviderForCampaign } from "./image-backends/index.js";

// Re-exports so existing importers keep their paths after the ADR-0027 split:
// video-generator.ts imports the type; tests/image-salvage.test.ts imports the
// salvage helper; server.ts uses the ImageGenResult shape.
export type { ImageEntityType, ImageGenResult } from "./image-backends/types.js";
export { newestImageUnder } from "./image-backends/grok.js";

/** Hard cap on the /imagine prompt length. A scene description is at most a few
 * sentences; anything longer is almost certainly leaked context, and a shorter
 * prompt also keeps the generator focused on generating rather than "understanding". */
const MAX_IMAGE_PROMPT_CHARS = 500;

/** A saved image below this many bytes is treated as a truncated/partial write
 * (e.g. a generator killed mid-write on timeout) and not used. */
const MIN_IMAGE_BYTES = 1024;

/** Turns a raw entity/scene description into the image prompt. Sanitizes first:
 * leaked DM planning chatter must never reach the generator — it makes a nonsense
 * image and, with Grok, reads as a coding instruction (see grok backend). Strips
 * recognized meta-chatter, hard-caps length, falls back to the raw description
 * (then a generic scene) if stripping leaves nothing, and appends the art style.
 * Provider-agnostic — used by both backends. Note this is one layer: the grok
 * backend's temp-dir isolation + `--deny` tool restrictions are what make even an
 * imperfectly-stripped prompt harmless there. */
export function sanitizeImagePrompt(description: string, settings: CampaignSettings): string {
  const cleaned =
    stripMetaChatter(description).trim().slice(0, MAX_IMAGE_PROMPT_CHARS) ||
    description.trim().slice(0, MAX_IMAGE_PROMPT_CHARS) ||
    "a scene from the story";
  return buildImagePrompt(cleaned, settings);
}

/** Slug for an image filename. Exported so both backends build the identical
 * `<entityType>-<slug><ext>` name via saveGeneratedImage. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug || "entity";
}

/** Save a freshly generated image into the campaign's own images/ dir under the
 * canonical `<entityType>-<slug><ext>` name, guarding against a truncated write.
 * `source` is either a path (the grok backend copies the file it located) or raw
 * bytes (the local backend writes the PNG it fetched). Shared by both backends
 * (ADR-0027) so the save convention — and thus every downstream consumer — is
 * identical regardless of provider. Never throws. */
export function saveGeneratedImage(
  campaignDir: string,
  entityType: ImageEntityType,
  name: string,
  source: string | Buffer,
  ext: string
): ImageGenResult {
  const imagesDir = path.join(campaignDir, "images");
  const filename = `${entityType}-${slugify(name)}${ext}`;
  const destPath = path.join(imagesDir, filename);
  try {
    fs.mkdirSync(imagesDir, { recursive: true });
    if (typeof source === "string") fs.copyFileSync(source, destPath);
    else fs.writeFileSync(destPath, source);
    // Guard against a truncated file if the generator was killed mid-write.
    if (fs.statSync(destPath).size < MIN_IMAGE_BYTES) {
      fs.rmSync(destPath, { force: true });
      return { ok: false, error: "generated image file was incomplete" };
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[image-generator] failed to save image for "${name}": ${reason}`);
    return { ok: false, error: `Failed to save generated image: ${reason}` };
  }
  return { ok: true, relPath: path.join("images", filename) };
}

/** Generate and save an image for an entity/scene. ADR-0027: this is now a thin
 * dispatcher — it resolves the campaign's image provider (campaign → user → .env
 * → "grok") and delegates to the chosen backend (grok CLI or local ComfyUI). Its
 * signature is unchanged, so every call site (the in-turn MCP tool, the stdio MCP
 * server, and both /illustrate branches) is untouched. Never throws — the backends
 * catch every failure and return `{ ok: false, error }`, since an image is
 * best-effort per §8 and must never block a turn. */
export async function generateImage(
  campaignDir: string,
  entityType: ImageEntityType,
  name: string,
  description: string,
  settings: CampaignSettings
): Promise<ImageGenResult> {
  const provider = resolveImageProviderForCampaign(campaignDir, settings);
  return getImageBackend(provider).generate({ campaignDir, entityType, name, description, settings });
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
 * (issue #71) isn't guaranteed to reach the generator — portraits come out "close
 * but not matching". For the `character` entity type only, anchor the prompt with
 * the stored appearance: prepend it (so it survives the 500-char cap) unless the
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
