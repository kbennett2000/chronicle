/**
 * Documentation media capture (issue #84).
 *
 * Seeds a FICTIONAL demo campaign ("The Hollow Lantern") — no real or current
 * campaign data ever touches this — boots a real Chronicle backend against it,
 * and drives the built UI with Playwright to capture the screenshots + animated
 * GIFs used in the README and user guide. Scene art and portraits are generated
 * with the real Grok pipeline (src/image-generator.ts) in several art styles so
 * the docs show genuine variety.
 *
 * Output → docs/assets/. Everything is disposable: the demo campaign is created
 * under a throwaway `demo` user and deleted at the end (per CLAUDE.md test-data
 * hygiene — test-campaign and real games are never touched).
 *
 * Requirements on the host: `grok` logged in (images), `claude` logged in
 * (the send-a-turn GIF fires one real Haiku turn), ffmpeg (webm → gif), and a
 * built UI (`npm run build:web`). Run: `npx tsx scripts/capture-docs-media.ts`.
 */
import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { generateImage } from "../src/image-generator.js";
import { scaffoldCampaign, userCampaignsRoot } from "../src/campaign-store.js";
import { userIdForUsername } from "../src/user-store.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
// Playwright lives in web/'s node_modules, not the backend's — load it by path.
const { chromium } = require(path.join(REPO_ROOT, "web/node_modules/@playwright/test"));

const ASSETS = path.join(REPO_ROOT, "docs", "assets");
const DEMO_USER = "demo";
const DEMO_PASS = "demo-pass-1234";
const DEMO_USER_ID = userIdForUsername(DEMO_USER);
const CAMPAIGN_ID = "scratch-hollow-lantern";
const CAMPAIGN_DIR = path.join(userCampaignsRoot(DEMO_USER_ID), CAMPAIGN_ID);
const MODEL = "claude-haiku-4-5"; // fast/cheap for the one live turn in the GIF

const log = (m: string) => console.log(`[capture] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Grok output is expensive; cache generated entity art between runs so only the
// first run pays for it (gitignored). Cache key mirrors generateImage's on-disk
// filename convention so a hit is byte-identical to a fresh generation.
const CACHE = path.join(REPO_ROOT, ".docs-media-cache");
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
async function cachedEntity(
  campaignDir: string, type: "character" | "npc" | "location",
  name: string, desc: string, style: string
): Promise<string | null> {
  const basename = `${type}-${slugify(name)}.jpg`;
  const cacheFile = path.join(CACHE, basename);
  const destRel = path.posix.join("images", basename);
  const destFile = path.join(campaignDir, "images", basename);
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  if (fs.existsSync(cacheFile)) { fs.copyFileSync(cacheFile, destFile); return destRel; }
  const res = await generateImage(campaignDir, type, name, desc, { artStyle: style, generateImages: true } as any);
  if (!res.ok) { log(`  ✗ ${name}: ${res.error}`); return null; }
  fs.mkdirSync(CACHE, { recursive: true });
  fs.copyFileSync(path.join(campaignDir, res.relPath), cacheFile);
  return res.relPath;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Fictional demo content (nothing here is real campaign data)
// ─────────────────────────────────────────────────────────────────────────────
const CHARACTER = {
  name: "Wren Ashdown",
  race: "Half-Elf",
  class: "Ranger",
  level: 3,
  hp: { current: 22, max: 27 },
  armorClass: 15,
  abilityScores: {
    strength: 12, dexterity: 16, constitution: 14,
    intelligence: 10, wisdom: 15, charisma: 11,
  },
  conditions: ["Inspired"],
  inventory: [
    { item: "Longbow", quantity: 1 },
    { item: "Shortsword", quantity: 2 },
    { item: "Explorer's Pack", quantity: 1 },
    { item: "Potion of Healing", quantity: 2 },
    { item: "Hooded Lantern", quantity: 1 },
  ],
  currency: { cp: 40, sp: 12, ep: 0, gp: 63, pp: 1 },
  xp: 1200,
  spellSlots: { "1": { total: 3, used: 1 } },
  speed: 30,
  background: "Outlander",
  alignment: "Chaotic Good",
  appearance:
    "A wiry half-elf in a weather-stained green cloak, dark hair tied back, " +
    "a silver oak-leaf clasp at the throat, and watchful hazel eyes.",
  skillProficiencies: ["Survival", "Perception", "Stealth", "Nature"],
  savingThrowProficiencies: ["strength", "dexterity"],
  languages: ["Common", "Elvish", "Sylvan"],
  personality: {
    traits: "Speaks little, notices everything.",
    ideals: "The wild places must have a keeper.",
    bonds: "Sworn to find who snuffed the old waystone lanterns.",
    flaws: "Trusts animals more readily than people.",
  },
  featuresAndTraits: [
    { name: "Favored Enemy", description: "Advantage to track and recall lore about fey." },
    { name: "Natural Explorer", description: "Forests hold no secrets from Wren." },
  ],
  portraitImage: "images/character-wren-ashdown.jpg",
};

// entity images to generate, each with a distinct art style (proves variety)
const IMAGES: Array<{
  type: "character" | "npc" | "location";
  name: string;
  desc: string;
  style: string;
}> = [
  { type: "character", name: "Wren Ashdown", style: "oil painting",
    desc: "A wiry half-elf ranger in a weather-stained green cloak, dark hair tied back, a silver oak-leaf clasp, watchful hazel eyes, forest behind, character portrait." },
  { type: "npc", name: "Mabel Thornwick", style: "watercolor",
    desc: "A warm, round-cheeked human innkeeper in her sixties, grey bun, flour-dusted apron, kind crinkled eyes, holding a lantern, portrait." },
  { type: "npc", name: "Sir Caddoc Vane", style: "comic book",
    desc: "A weary human knight in dented plate armor, grey stubble, a long scar across one cheek, tired but resolute, portrait." },
  { type: "npc", name: "The Ashen Widow", style: "noir",
    desc: "A pale, elegant woman shrouded in a grey veil and ash-coloured mourning dress, cold eyes, candle smoke curling around her, ominous portrait." },
  { type: "location", name: "Lanternwood Crossroads", style: "watercolor",
    desc: "A misty forest crossroads at dusk, a single iron lantern glowing on a wooden post, tall pines, a worn signpost, atmospheric fantasy landscape." },
  { type: "location", name: "The Hollow Lantern Inn", style: "comic book",
    desc: "A cozy timber-framed fantasy tavern glowing with warm light at night, a hanging iron lantern sign, snow on the eaves, inviting." },
];

// same scene, three styles → composited into art-styles.png for the docs
const ART_STYLE_SCENE =
  "A lone traveler on a misty forest road at dusk approaching a glowing iron lantern on a signpost, tall pines, fantasy landscape.";
const ART_STYLES = ["watercolor", "comic book", "film noir"];

function writeStateFiles(images: Record<string, string>): void {
  fs.writeFileSync(
    path.join(CAMPAIGN_DIR, "character-sheet.json"),
    JSON.stringify(CHARACTER, null, 2) + "\n"
  );

  fs.writeFileSync(
    path.join(CAMPAIGN_DIR, "world-state.md"),
    `# World State

## Current Situation
Night is falling over the Lanternwood, and one by one the old waystone lanterns
have gone dark. Wren has reached the crossroads inn to ask what the townsfolk
have seen.

## Locations Visited
- **Lanternwood Crossroads** — A fog-wrapped meeting of three forest roads, marked by a single iron lantern that still burns.
  - Image: ${images["Lanternwood Crossroads"] ?? "images/location-lanternwood-crossroads.jpg"}
- **The Hollow Lantern Inn** — A warm timber tavern where travelers trade rumors over spiced cider.
  - Image: ${images["The Hollow Lantern Inn"] ?? "images/location-the-hollow-lantern-inn.jpg"}

## Factions
- **The Lampwrights' Guild** — Keepers of the waystone lanterns; fearful and secretive of late.
`
  );

  fs.writeFileSync(
    path.join(CAMPAIGN_DIR, "npc-roster.md"),
    `# NPC Roster

## Mabel Thornwick
- **Description:** The warm-hearted keeper of the Hollow Lantern Inn.
- **Disposition:** Fond of Wren; worried for her regulars.
- **Knows:** Which travelers passed through before the lanterns failed.
- **Portrait asset ID:** ${images["Mabel Thornwick"] ?? "images/npc-mabel-thornwick.jpg"}

## Sir Caddoc Vane
- **Description:** A weary knight who has hunted the dark along these roads for years.
- **Disposition:** Gruff but honorable; sizing Wren up.
- **Knows:** That the lantern-snuffing began the night the Ashen Widow returned.
- **Portrait asset ID:** ${images["Sir Caddoc Vane"] ?? "images/npc-sir-caddoc-vane.jpg"}

## The Ashen Widow
- **Description:** A veiled figure of ash and mourning, rumored to drink the light.
- **Disposition:** Unknown, and colder for it.
- **Knows:** Why the waystones must go dark.
- **Portrait asset ID:** ${images["The Ashen Widow"] ?? "images/npc-the-ashen-widow.jpg"}

## Old Tom the Ferryman
- **Description:** A stooped, silent boatman who works the black river at the wood's edge.
- **Disposition:** Wary of strangers; owes Mabel a favor.
- **Knows:** A hidden crossing the Widow's people do not watch.
`
  );

  fs.writeFileSync(
    path.join(CAMPAIGN_DIR, "quest-log.md"),
    `# Quest Log

## Active
- **The Failing Lanterns** — Discover who is snuffing the waystone lanterns of the Lanternwood.
  - Reached the crossroads inn and spoke with Mabel Thornwick.
  - Learned the darkenings began the night the Ashen Widow returned.
- **A Knight's Warning** — Decide whether to trust Sir Caddoc Vane's offer to ride together.

## Completed
- **The Cider Run** — Escorted Mabel's cider cart safely through the wood.
  - Drove off a pair of ambushing goblins; earned the innkeeper's trust.
`
  );

  // A short seeded session so Play reads as an ongoing story (ADR-0007/0013).
  const logDir = path.join(CAMPAIGN_DIR, "session-log");
  fs.mkdirSync(logDir, { recursive: true });
  const base = "session-2026-05-02t20-15-00-000z";
  fs.writeFileSync(path.join(logDir, `${base}.md`), `# ${base}\n\nWren arrives at the Lanternwood Crossroads.\n`);
  const sceneImg = images["Lanternwood Crossroads"] ?? "images/location-lanternwood-crossroads.jpg";
  const turns = [
    {
      turnIndex: 0, timestamp: "2026-05-02T20:15:05.000Z", playerMessage: "",
      narration:
        "Dusk pools in the Lanternwood like spilled ink. Where a dozen waystone " +
        "lanterns should be blooming to life along the crossroads, only one still " +
        "burns — a lonely iron flame swinging on its post. From the timbered inn " +
        "ahead, warm light and the smell of spiced cider spill across the mud. A " +
        "sign creaks overhead: THE HOLLOW LANTERN.",
      image: sceneImg,
    },
    {
      turnIndex: 1, timestamp: "2026-05-02T20:17:40.000Z",
      playerMessage: "I push open the inn door and look for whoever's in charge.",
      narration:
        "The door swings in on a room of low golden light and a handful of hushed " +
        "travelers. Behind the bar, a round-cheeked woman with a flour-dusted apron " +
        "looks up — and her worried face breaks into relief. \"Wren,\" Mabel " +
        "Thornwick breathes. \"Thank every star. Sit. There's something wrong in the " +
        "wood, and you're the only one I'd trust to hear it.\"",
    },
  ];
  fs.writeFileSync(
    path.join(logDir, `${base}.transcript.jsonl`),
    turns.map((t) => JSON.stringify(t)).join("\n") + "\n"
  );

  fs.writeFileSync(
    path.join(CAMPAIGN_DIR, "campaign-settings.json"),
    JSON.stringify({ model: MODEL, artStyle: "watercolor", generateImages: true, autoRollDice: true }, null, 2) + "\n"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Server boot (mirrors web/tests/e2e/harness.ts)
// ─────────────────────────────────────────────────────────────────────────────
function killTree(proc: ChildProcess): void {
  if (!proc.pid) return void proc.kill();
  try { process.kill(-proc.pid, "SIGTERM"); } catch { /* gone */ }
}

async function waitForReady(baseURL: string, timeoutMs = 25000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${baseURL}/`)).status === 200) return; } catch { /* not yet */ }
    await sleep(250);
  }
  throw new Error(`server at ${baseURL} not ready in time`);
}

async function registerDemoUser(baseURL: string): Promise<void> {
  const body = JSON.stringify({ username: DEMO_USER, password: DEMO_PASS });
  const headers = { "Content-Type": "application/json" };
  const reg = await fetch(`${baseURL}/auth/register`, { method: "POST", headers, body });
  if (reg.status === 201 || reg.status === 409) return; // created, or already exists
  const login = await fetch(`${baseURL}/auth/login`, { method: "POST", headers, body });
  if (login.status !== 200) throw new Error(`demo user auth failed: ${reg.status}/${login.status}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. GIF helper (webm → gif via ffmpeg, two-pass palette for quality)
// ─────────────────────────────────────────────────────────────────────────────
function webmToGif(webm: string, out: string, speed = 2.2, width = 300, fps = 10, colors = 128): void {
  // GIF is a heavy format for photographic app frames, so keep it small: speed
  // up the idle waiting, modest width/fps, and a diff-optimized 128-colour
  // palette. Single pass from the pristine webm (no stacked re-encodes).
  execFileSync("ffmpeg", [
    "-y", "-i", webm,
    "-vf",
    `setpts=PTS/${speed},fps=${fps},scale=${width}:-1:flags=lanczos,` +
      `split[s0][s1];[s0]palettegen=max_colors=${colors}:stats_mode=diff[p];` +
      `[s1][p]paletteuse=dither=bayer:bayer_scale=2`,
    "-loop", "0", out,
  ], { stdio: "ignore" });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  fs.mkdirSync(ASSETS, { recursive: true });
  // fresh demo campaign dir every run
  fs.rmSync(CAMPAIGN_DIR, { recursive: true, force: true });
  scaffoldCampaign(DEMO_USER_ID, CAMPAIGN_ID, CHARACTER, { model: MODEL });

  // 3a. Generate entity art (real Grok), several art styles
  log(`generating ${IMAGES.length} entity images with Grok…`);
  const rel: Record<string, string> = {};
  for (const spec of IMAGES) {
    const t0 = Date.now();
    const r = await cachedEntity(CAMPAIGN_DIR, spec.type, spec.name, spec.desc, spec.style);
    if (r) { rel[spec.name] = r; log(`  ✓ ${spec.name} (${spec.style}) ${Date.now() - t0}ms`); }
  }

  // 3b. Art-style comparison strip (same scene, 3 styles) — skip if already made
  if (fs.existsSync(path.join(ASSETS, "art-styles.png"))) { log("art-styles.png present, skipping"); }
  else {
  log("generating art-style comparison…");
  const styleDir = fs.mkdtempSync(path.join(os.tmpdir(), "artstyles-"));
  const stylePaths: string[] = [];
  for (const style of ART_STYLES) {
    const res = await generateImage(styleDir, "location", `style ${style}`, ART_STYLE_SCENE, {
      artStyle: style, generateImages: true,
    } as any);
    if (res.ok) stylePaths.push(path.join(styleDir, res.relPath));
    else log(`  ✗ art-style ${style}: ${res.error}`);
  }
  if (stylePaths.length >= 2) {
    execFileSync("ffmpeg", [
      "-y", ...stylePaths.flatMap((p) => ["-i", p]),
      "-filter_complex",
      `${stylePaths.map((_, i) => `[${i}:v]scale=440:247:force_original_aspect_ratio=increase,crop=440:247[v${i}]`).join(";")};` +
      `${stylePaths.map((_, i) => `[v${i}]`).join("")}hstack=inputs=${stylePaths.length}`,
      path.join(ASSETS, "art-styles.png"),
    ], { stdio: "ignore" });
    log("  ✓ art-styles.png");
  }
  }

  // 3c. Banner (wide crop of a Grok hero image) — skip if already made
  if (fs.existsSync(path.join(ASSETS, "banner.png"))) { log("banner.png present, skipping"); }
  else {
    log("generating banner…");
    const bannerDir = fs.mkdtempSync(path.join(os.tmpdir(), "banner-"));
    const bannerRes = await generateImage(bannerDir, "location", "chronicle banner",
      "An open leather-bound journal on a candlelit oak table, warm parchment pages, scattered polished dice, an inkwell and quill, an iron lantern glowing, a rolled map, cozy fantasy tavern atmosphere, wide cinematic banner, no text.",
      { artStyle: "oil painting", generateImages: true } as any);
    if (bannerRes.ok) {
      execFileSync("ffmpeg", ["-y", "-i", path.join(bannerDir, bannerRes.relPath),
        "-vf", "scale=1280:-1,crop=1280:440", path.join(ASSETS, "banner.png")], { stdio: "ignore" });
      log("  ✓ banner.png");
    } else log(`  ✗ banner: ${bannerRes.error}`);
  }

  // 3d. Now write the state files that reference the entity art
  writeStateFiles(rel);

  // 4. Boot the backend against the demo campaign
  const port = 4600 + Math.floor(Math.random() * 300);
  const baseURL = `http://127.0.0.1:${port}`;
  log(`booting server on ${baseURL}…`);
  const server = spawn("npx", ["tsx", "src/server.ts"], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DEFAULT_MUSIC_ENABLED: "true", DEFAULT_MUSIC_SOURCE: "local" },
    stdio: "pipe", detached: true,
  });
  server.stderr?.on("data", (c) => process.env.DEBUG_CAPTURE && process.stderr.write(c));

  const browser = await chromium.launch();
  try {
    await waitForReady(baseURL);
    await registerDemoUser(baseURL);

    // ?campaign= selects the active campaign (web/src/lib/campaign.ts) so Home
    // shows the Continue button, exactly as the e2e specs do.
    const appURL = `${baseURL}/?campaign=${CAMPAIGN_ID}`;

    // login helper reused by every context
    const doLogin = async (page: any) => {
      await page.goto(appURL);
      await page.getByTestId("auth-username").fill(DEMO_USER);
      await page.getByTestId("auth-password").fill(DEMO_PASS);
      await page.getByTestId("auth-submit").click();
      await page.getByTestId("continue-button").waitFor({ timeout: 15000 });
    };
    const openPlay = async (page: any) => {
      await page.getByTestId("continue-button").click();
      await page.getByTestId("narration").first().waitFor({ timeout: 20000 });
      await sleep(800);
    };

    // ── 4a. Mobile screenshots ────────────────────────────────────────────
    log("capturing mobile screenshots…");
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    {
      const page = await mobile.newPage();
      await page.goto(appURL);
      await page.getByTestId("auth-submit").waitFor();
      await page.screenshot({ path: path.join(ASSETS, "screenshot-auth.png") });

      await page.getByTestId("auth-username").fill(DEMO_USER);
      await page.getByTestId("auth-password").fill(DEMO_PASS);
      await page.getByTestId("auth-submit").click();
      await page.getByTestId("continue-button").waitFor({ timeout: 15000 });
      await sleep(500);
      await page.screenshot({ path: path.join(ASSETS, "screenshot-home.png") });

      await openPlay(page);
      await page.screenshot({ path: path.join(ASSETS, "screenshot-play.png") });

      // On mobile each tab opens a BottomSheet drawer; close it (the ✕) before
      // opening the next, or its scrim intercepts the tab click.
      const closeSheet = async () => {
        await page.getByTestId("sheet-close").click().catch(() => {});
        await sleep(400);
      };

      await page.getByTestId("tab-self").click(); await sleep(600);
      await page.screenshot({ path: path.join(ASSETS, "screenshot-self.png") });
      await closeSheet();

      await page.getByTestId("tab-folk").click(); await sleep(600);
      await page.screenshot({ path: path.join(ASSETS, "screenshot-folk.png") });
      await closeSheet();

      await page.getByTestId("tab-quest").click(); await sleep(600);
      await page.screenshot({ path: path.join(ASSETS, "screenshot-quest.png") });
      await closeSheet();

      await page.getByTestId("tab-views").click(); await sleep(700);
      await page.screenshot({ path: path.join(ASSETS, "screenshot-gallery.png") });
      await page.close();
    }
    await mobile.close();

    // ── 4b. Desktop screenshot (full character sheet) ─────────────────────
    log("capturing desktop screenshot…");
    const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    {
      const page = await desktop.newPage();
      await doLogin(page);
      await openPlay(page);
      await page.getByTestId("tab-self").click(); await sleep(700);
      await page.screenshot({ path: path.join(ASSETS, "screenshot-character-sheet.png") });
      await page.close();
    }
    await desktop.close();

    // ── 4c. GIF: sending a turn (one real Haiku turn) ─────────────────────
    log("recording send-a-turn GIF (live DM turn)…");
    try {
      const vidDir = fs.mkdtempSync(path.join(os.tmpdir(), "gif-turn-"));
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, recordVideo: { dir: vidDir, size: { width: 390, height: 844 } } });
      const page = await ctx.newPage();
      await doLogin(page);
      await openPlay(page);
      const before = await page.getByTestId("narration").count();
      await page.getByTestId("turn-input").fill("I lift the iron lantern from the post and step out into the fog.");
      await sleep(600);
      await page.getByTestId("send-button").click();
      // wait for the new narration block (live claude-haiku)
      for (let i = 0; i < 60 && (await page.getByTestId("narration").count()) <= before; i++) await sleep(1000);
      await sleep(1500);
      await page.close();
      await ctx.close();
      const webm = fs.readdirSync(vidDir).find((f) => f.endsWith(".webm"));
      if (webm) { webmToGif(path.join(vidDir, webm), path.join(ASSETS, "gif-send-turn.gif"), 2.8); log("  ✓ gif-send-turn.gif"); }
    } catch (e) { log(`  ✗ send-turn GIF failed: ${(e as Error).message}`); }

    // ── 4d. GIF: "Draw this" illustrating an un-illustrated NPC (live Grok) ─
    log("recording draw-this GIF (live Grok illustration)…");
    try {
      const vidDir = fs.mkdtempSync(path.join(os.tmpdir(), "gif-draw-"));
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, recordVideo: { dir: vidDir, size: { width: 390, height: 844 } } });
      const page = await ctx.newPage();
      await doLogin(page);
      await openPlay(page);
      await page.getByTestId("tab-views").click(); await sleep(800);
      const before = await page.getByTestId("gallery-image").count();
      await page.getByTestId("gallery-draw").first().click();
      for (let i = 0; i < 90 && (await page.getByTestId("gallery-image").count()) <= before; i++) await sleep(1000);
      await sleep(1500);
      await page.close();
      await ctx.close();
      const webm = fs.readdirSync(vidDir).find((f) => f.endsWith(".webm"));
      if (webm) { webmToGif(path.join(vidDir, webm), path.join(ASSETS, "gif-draw-this.gif"), 1.8); log("  ✓ gif-draw-this.gif"); }
    } catch (e) { log(`  ✗ draw-this GIF failed: ${(e as Error).message}`); }
  } finally {
    await browser.close();
    killTree(server);
    // hygiene: remove the disposable demo campaign
    fs.rmSync(CAMPAIGN_DIR, { recursive: true, force: true });
    log("done — assets in docs/assets/, demo campaign removed.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
