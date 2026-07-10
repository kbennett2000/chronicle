/** Ad-hoc live verification for ADR-0032 (LoRA-backed art styles, local backend).
 * Drives generateLocalImage directly against the real ComfyUI service across the whole
 * style roster, so the operator can eyeball whether each LoRA visibly applies and whether
 * a grounded character survives the heavy styles. NOT a unit test — needs a GPU + ComfyUI +
 * the LoRA files. Usage: npx tsx scripts/verify-lora-styles.ts <campaignDir> [styleFilter]
 */
import path from "node:path";
import fs from "node:fs";
import { generateLocalImage } from "../src/image-backends/local.js";
import type { CampaignSettings } from "../src/campaign-store.js";

const campaignDir = path.resolve(process.argv[2] ?? "");
const filter = process.argv[3]; // optional substring to render a subset
if (!campaignDir || !fs.existsSync(campaignDir)) {
  console.error("usage: npx tsx scripts/verify-lora-styles.ts <campaignDir> [styleFilter]");
  process.exit(1);
}

const SCENE = "a lone knight stands on a windswept cliff at dawn, a ruined tower behind";
// A "grounded" NPC description (as ADR-0031 grounding would prepend) to check heavy LoRAs
// at their strengths don't steamroll canonical features.
const GROUNDED_NPC =
  "a stern half-elf woman with a long silver braid, a jagged scar across her left cheek, and worn green leather armor, standing in a torchlit hall";

// Every mapped style + the two prompt-only controls (noir preset, free-text).
const SCENE_STYLES = [
  "comic book", "Lego-style", "pencil sketch", "watercolour", "anime", "pixel art", "oil painting",
  "storybook", "3d", "cyberpunk", "ukiyo-e", "claymation",
  "ghibli",          // prompt-only preset (no SDXL LoRA)
  "noir",            // prompt-only preset
  "stained glass",   // free-text, unmapped
];
// Grounded-NPC coexistence check in the heaviest styles.
const NPC_STYLES = ["Lego-style", "claymation", "oil painting", "3d"];

function settings(artStyle: string): CampaignSettings {
  return { model: "claude-sonnet-5", provider: "claude", artStyle } as unknown as CampaignSettings;
}

const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

async function run(label: string, entityType: "scene" | "npc", name: string, description: string, artStyle: string) {
  process.stdout.write(`[${label}] style="${artStyle}" … `);
  const t = Date.now();
  const res = await generateLocalImage({ campaignDir, entityType, name, description, settings: settings(artStyle) });
  const secs = ((Date.now() - t) / 1000).toFixed(1);
  console.log(res.ok ? `OK ${res.relPath} (${secs}s)` : `FAIL ${res.error} (${secs}s)`);
}

async function main() {
  for (const s of SCENE_STYLES) {
    if (filter && !s.includes(filter)) continue;
    await run(`scene:${slug(s)}`, "scene", `Cliff ${slug(s)}`, SCENE, s);
  }
  for (const s of NPC_STYLES) {
    if (filter && !s.includes(filter)) continue;
    await run(`npc:${slug(s)}`, "npc", `Marta ${slug(s)}`, GROUNDED_NPC, s);
  }
  console.log(`\nImages under ${path.join(campaignDir, "images")}`);
}

main().catch((e) => {
  console.error("verify crashed:", e);
  process.exit(1);
});
