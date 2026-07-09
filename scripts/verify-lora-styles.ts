/** Ad-hoc live verification for ADR-0032 (LoRA-backed art styles, local backend).
 * Drives generateLocalImage directly against the real ComfyUI service for the same
 * scene at several styles, so the operator can eyeball whether the LoRA visibly
 * applies. NOT a unit test — needs a GPU + ComfyUI + the two LoRA files. Deleted with
 * the scratch campaign after the slice. Usage: npx tsx scripts/verify-lora-styles.ts <campaignDir>
 */
import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import { generateLocalImage } from "../src/image-backends/local.js";
import type { CampaignSettings } from "../src/campaign-store.js";
import type { ImageQuality } from "../src/image-backends/types.js";

const campaignDir = path.resolve(process.argv[2] ?? "");
if (!campaignDir || !fs.existsSync(campaignDir)) {
  console.error("usage: npx tsx scripts/verify-lora-styles.ts <campaignDir>");
  process.exit(1);
}

const SCENE = "a lone knight stands on a windswept cliff at dawn, a ruined tower behind";
// A "grounded" NPC description — the canonical appearance grounding (ADR-0031) would
// prepend — to check the oil LoRA at 0.8 doesn't steamroll a described character.
const GROUNDED_NPC =
  "a stern half-elf woman with a long silver braid, a jagged scar across her left cheek, and worn green leather armor, standing in a torchlit hall";

function settings(artStyle: string): CampaignSettings {
  return { model: "claude-sonnet-5", provider: "claude", artStyle } as unknown as CampaignSettings;
}

interface Job {
  label: string;
  entityType: "scene" | "npc";
  name: string;
  description: string;
  artStyle: string;
  quality?: ImageQuality;
}

const jobs: Job[] = [
  { label: "pixel-art", entityType: "scene", name: "Cliff Pixel", description: SCENE, artStyle: "pixel art" },
  { label: "oil-painting", entityType: "scene", name: "Cliff Oil", description: SCENE, artStyle: "oil painting" },
  { label: "unmapped-watercolour", entityType: "scene", name: "Cliff Watercolour", description: SCENE, artStyle: "watercolour" },
  { label: "grounded-npc-oil", entityType: "npc", name: "Marta Oil", description: GROUNDED_NPC, artStyle: "oil painting" },
];

async function main() {
  for (const j of jobs) {
    process.stdout.write(`\n[${j.label}] style="${j.artStyle}" entity=${j.entityType} … `);
    const t = Date.now();
    const res = await generateLocalImage({
      campaignDir,
      entityType: j.entityType,
      name: j.name,
      description: j.description,
      settings: settings(j.artStyle),
      imageQuality: j.quality,
    });
    const secs = ((Date.now() - t) / 1000).toFixed(1);
    if (res.ok) console.log(`OK ${res.relPath} (${secs}s)`);
    else console.log(`FAIL ${res.error} (${secs}s)`);
  }
  console.log(`\nImages saved under ${path.join(campaignDir, "images")}`);
}

main().catch((e) => {
  console.error("verify crashed:", e);
  process.exit(1);
});
