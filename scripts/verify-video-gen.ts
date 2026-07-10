/** Issue #118 — empirical check of Grok Imagine video generation.
 *
 * The image path/salvage logic depends on an UNDOCUMENTED Grok session output
 * layout (see image-generator.ts). Video output is likewise undocumented, so
 * this script drives generateVideo() against the real `grok` CLI in a
 * disposable scratch campaign and reports (a) whether a clip was produced,
 * (b) where it landed under <campaign>/videos/, and (c) the raw session tree
 * so we can confirm the subdir/extension the salvage scan targets.
 *
 * Requires the `grok` CLI installed + authenticated on this host. Video is slow
 * (minutes) — be patient. Nothing here touches test-campaign or real games.
 *
 * Usage:
 *   npx tsx scripts/verify-video-gen.ts
 *   npx tsx scripts/verify-video-gen.ts --animate    # also test the base-image path
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scaffoldCampaign, userCampaignsRoot, readCampaignSettings } from "../src/campaign-store.js";
import { userIdForUsername } from "../src/user-store.js";
import { generateImage } from "../src/image-generator.js";
import { generateVideo } from "../src/video-generator.js";
import { DEFAULT_VIDEO } from "../src/video-store.js";
import { secrets } from "../src/config.js";

const userId = userIdForUsername(secrets.bootstrap.username || "kris");
const id = `scratch-video-${process.pid}`;
const dir = scaffoldCampaign(userId, id, { name: "Vid Test", race: "Human", class: "Fighter", level: 1 });
const settings = readCampaignSettings(dir);

function dumpTree(label: string): void {
  console.log(`\n[${label}] ${dir}/videos:`);
  const vdir = path.join(dir, "videos");
  console.log(fs.existsSync(vdir) ? fs.readdirSync(vdir).join(", ") || "(empty)" : "(no videos dir)");
}

try {
  const wantAnimate = process.argv.includes("--animate");
  let baseImageRelPath: string | undefined;

  if (wantAnimate) {
    console.log("Generating a base still first (/imagine)…");
    const img = await generateImage(dir, "scene", "base", "a lone lighthouse on a rocky cliff at dusk", settings);
    console.log("image result:", img);
    if (img.ok) baseImageRelPath = img.relPath;
  }

  console.log("\nGenerating video (/imagine-video)… this can take minutes.");
  const result = await generateVideo(
    dir,
    "scene",
    "test-clip",
    "gentle waves and drifting clouds, slow cinematic camera push",
    settings,
    DEFAULT_VIDEO,
    { baseImageRelPath }
  );
  console.log("\nvideo result:", result);
  dumpTree("saved");

  // Show the raw Grok session tree so we can confirm the real subdir/extension.
  const sessionsRoot = path.join(os.homedir(), ".grok", "sessions");
  console.log(`\nGrok sessions root: ${sessionsRoot} (inspect for videos/ vs images/ + extension)`);
} finally {
  fs.rmSync(path.join(userCampaignsRoot(userId), id), { recursive: true, force: true });
  console.log(`\nCleaned up scratch campaign ${id}.`);
}
