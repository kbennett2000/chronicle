import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  generateLocalImage,
  deriveCampaignSeed,
  resolveTier,
  resolveEffectiveTier,
  ensureTrigger,
  TIER_CONFIG,
} from "../src/image-backends/local.js";
import { STYLE_LORAS } from "../src/image-backends/style-loras.js";
import type { CampaignSettings } from "../src/campaign-store.js";

// ADR-0027: the local ComfyUI backend talks to ComfyUI's HTTP API (POST /prompt,
// poll /history/<id>, GET /view). It takes an injectable fetchFn so the whole
// dance is exercised with a stub — NO GPU, NO running ComfyUI — mirroring the
// execFn DI in the grok backend (tests/grok-backend-retry.test.ts).

const PROMPT_ID = "test-prompt-123";
const SETTINGS = { model: "claude-sonnet-5", provider: "claude", artStyle: "ink wash" } as unknown as CampaignSettings;

function jsonRes(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** A >MIN_IMAGE_BYTES PNG-ish blob so saveGeneratedImage accepts it. */
function bytesRes(status: number, size = 2048): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => new Uint8Array(size).fill(1).buffer,
  } as unknown as Response;
}

/** Build a fetchFn that routes by URL to the given canned responses. */
function makeFetch(routes: { prompt: Response; history?: Response; view?: Response }): typeof fetch {
  return (async (url: string) => {
    if (url.includes("/prompt")) return routes.prompt;
    if (url.includes("/history/")) return routes.history ?? jsonRes(200, {});
    if (url.includes("/view")) return routes.view ?? bytesRes(200);
    throw new Error(`unexpected url ${url}`);
  }) as unknown as typeof fetch;
}

function withCampaignDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chronicle-local-test-"));
  return fn(dir).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

test("generateLocalImage: submits the graph, polls history, fetches the PNG, and saves it", async () => {
  await withCampaignDir(async (dir) => {
    const history = jsonRes(200, {
      [PROMPT_ID]: {
        status: { status_str: "success" },
        outputs: { "9": { images: [{ filename: "chronicle_00001_.png", subfolder: "", type: "output" }] } },
      },
    });
    const result = await generateLocalImage(
      { campaignDir: dir, entityType: "npc", name: "Barrow the Smith", description: "a weathered dwarf", settings: SETTINGS },
      makeFetch({ prompt: jsonRes(200, { prompt_id: PROMPT_ID }), history, view: bytesRes(200) })
    );
    assert.equal(result.ok, true);
    assert.equal(result.relPath, path.join("images", "npc-barrow-the-smith.png"));
    // The file actually lands in the campaign's images/ dir.
    assert.ok(fs.existsSync(path.join(dir, "images", "npc-barrow-the-smith.png")));
    assert.ok(fs.statSync(path.join(dir, "images", "npc-barrow-the-smith.png")).size >= 1024);
  });
});

/** A fetchFn that captures the submitted graph body and always resolves to a saved
 * image, so a test can inspect exactly what was posted to ComfyUI. */
function capturingFetch(capture: { submitted?: any }): typeof fetch {
  return (async (url: string, init?: any) => {
    if (url.includes("/prompt")) {
      capture.submitted = JSON.parse(init.body);
      return jsonRes(200, { prompt_id: PROMPT_ID });
    }
    if (url.includes("/history/")) {
      return jsonRes(200, {
        [PROMPT_ID]: { status: { status_str: "success" }, outputs: { "9": { images: [{ filename: "x.png", subfolder: "", type: "output" }] } } },
      });
    }
    return bytesRes(200);
  }) as unknown as typeof fetch;
}

test("generateLocalImage: a scene weights the leading style clause and uses a deterministic seed (ADR-0028)", async () => {
  await withCampaignDir(async (dir) => {
    const cap: { submitted?: any } = {};
    await generateLocalImage(
      { campaignDir: dir, entityType: "location", name: "The Forge", description: "a glowing forge", settings: SETTINGS },
      capturingFetch(cap)
    );
    // Scene-class prompt gets SDXL weighting on the leading style clause (#104 + ADR-0028).
    assert.equal(cap.submitted.prompt["6"].inputs.text, "(ink wash:1.3). a glowing forge");
    // Seed is the per-campaign derivation, not a random roll.
    assert.equal(cap.submitted.prompt["3"].inputs.seed, deriveCampaignSeed(dir, "The Forge"));
    // "ink wash" is itself a monochrome style, so no anti-drift negatives are added.
    assert.equal(cap.submitted.prompt["7"].inputs.text, "blurry, lowres, deformed, text, watermark");
    assert.ok(cap.submitted.client_id.startsWith("chronicle-location-"));
  });
});

test("generateLocalImage: a color-forward scene appends anti-drift negatives (ADR-0028)", async () => {
  await withCampaignDir(async (dir) => {
    const cap: { submitted?: any } = {};
    const lego = { model: "claude-sonnet-5", provider: "claude", artStyle: "Lego-style" } as unknown as CampaignSettings;
    await generateLocalImage(
      { campaignDir: dir, entityType: "scene", name: "Throne Room", description: "a vast hall", settings: lego },
      capturingFetch(cap)
    );
    assert.equal(cap.submitted.prompt["6"].inputs.text, "(Lego-style:1.3). a vast hall");
    // The template's base negative is preserved and the drift steer is appended.
    assert.match(cap.submitted.prompt["7"].inputs.text, /^blurry, lowres, deformed, text, watermark, /);
    assert.match(cap.submitted.prompt["7"].inputs.text, /monochrome/);
    assert.match(cap.submitted.prompt["7"].inputs.text, /graphite/);
  });
});

test("generateLocalImage: a character keeps the unweighted style and no extra negatives (ADR-0028)", async () => {
  await withCampaignDir(async (dir) => {
    const cap: { submitted?: any } = {};
    const lego = { model: "claude-sonnet-5", provider: "claude", artStyle: "Lego-style" } as unknown as CampaignSettings;
    await generateLocalImage(
      { campaignDir: dir, entityType: "npc", name: "Barrow", description: "a weathered dwarf", settings: lego },
      capturingFetch(cap)
    );
    assert.equal(cap.submitted.prompt["6"].inputs.text, "Lego-style. a weathered dwarf");
    assert.equal(cap.submitted.prompt["7"].inputs.text, "blurry, lowres, deformed, text, watermark");
  });
});

test("deriveCampaignSeed: stable per (campaign, entity), varies by campaign, distinct per entity (ADR-0028)", () => {
  const a = "/home/kb/campaigns/kris/emberfall";
  const b = "/home/kb/campaigns/kris/duskwater";
  // Deterministic: same inputs → same seed.
  assert.equal(deriveCampaignSeed(a, "The Forge"), deriveCampaignSeed(a, "The Forge"));
  // Trailing slash doesn't change the campaign id.
  assert.equal(deriveCampaignSeed(a, "The Forge"), deriveCampaignSeed(a + "/", "The Forge"));
  // Different campaign → different anchor.
  assert.notEqual(deriveCampaignSeed(a, "The Forge"), deriveCampaignSeed(b, "The Forge"));
  // Different entity in the same campaign → distinct seed, but within the 1024 band
  // (measured circularly, since the uint32 add can wrap around 0xffffffff).
  const s1 = deriveCampaignSeed(a, "The Forge");
  const s2 = deriveCampaignSeed(a, "The Docks");
  assert.notEqual(s1, s2);
  const d = Math.abs(s1 - s2);
  const circ = Math.min(d, 0x100000000 - d);
  assert.ok(circ < 1024, `seeds should share the campaign band, got ${circ}`);
  // A valid uint32.
  assert.ok(Number.isInteger(s1) && s1 >= 0 && s1 <= 0xffffffff);
});

// --- ADR-0029: per-tier image quality (fast / standard / high) ---

const LEGO = { model: "claude-sonnet-5", provider: "claude", artStyle: "Lego-style" } as unknown as CampaignSettings;

test("resolveTier / TIER_CONFIG: high → refiner template + raised timeout; standard is today's exact params (ADR-0029)", () => {
  assert.equal(resolveTier("standard").workflow, "sdxl-txt2img.json");
  assert.equal(resolveTier("standard").steps, 25);
  assert.equal(resolveTier("standard").timeoutMs, 120_000);
  assert.equal(resolveTier("fast").workflow, "sdxl-txt2img.json");
  assert.equal(resolveTier("fast").steps, 15);
  assert.equal(resolveTier("high").workflow, "sdxl-refiner.json");
  assert.equal(resolveTier("high").steps, undefined); // refiner bakes its own schedule
  assert.ok(resolveTier("high").timeoutMs > resolveTier("standard").timeoutMs);
  // Absent/unknown tier defaults to standard so a stale value still gets a graph.
  assert.equal(resolveTier(undefined).workflow, TIER_CONFIG.standard.workflow);
  assert.equal(resolveTier(undefined).steps, 25);
});

test("generateLocalImage: unset quality submits today's base graph — steps 25, no refiner nodes (ADR-0029)", async () => {
  await withCampaignDir(async (dir) => {
    const cap: { submitted?: any } = {};
    await generateLocalImage(
      { campaignDir: dir, entityType: "npc", name: "X", description: "y", settings: SETTINGS },
      capturingFetch(cap)
    );
    const g = cap.submitted.prompt;
    assert.equal(g["3"].class_type, "KSampler");
    assert.equal(g["3"].inputs.steps, 25);
    assert.equal(g["4"].inputs.ckpt_name, "sd_xl_base_1.0.safetensors");
    // The base template has no refiner checkpoint or second sampler.
    assert.equal(g["11"], undefined);
    assert.equal(g["14"], undefined);
  });
});

test("generateLocalImage: fast quality lowers the base step count to 15 (ADR-0029)", async () => {
  await withCampaignDir(async (dir) => {
    const cap: { submitted?: any } = {};
    await generateLocalImage(
      { campaignDir: dir, entityType: "npc", name: "X", description: "y", settings: SETTINGS, imageQuality: "fast" },
      capturingFetch(cap)
    );
    const g = cap.submitted.prompt;
    assert.equal(g["3"].inputs.steps, 15);
    assert.equal(g["11"], undefined); // still the base template
  });
});

test("generateLocalImage: high quality submits the refiner ensemble with prompt+seed on BOTH passes (ADR-0029)", async () => {
  await withCampaignDir(async (dir) => {
    const cap: { submitted?: any } = {};
    await generateLocalImage(
      { campaignDir: dir, entityType: "location", name: "The Hall", description: "a vast hall", settings: LEGO, imageQuality: "high" },
      capturingFetch(cap)
    );
    const g = cap.submitted.prompt;
    // The refiner checkpoint is present (proves the refiner template was selected).
    assert.equal(g["11"].inputs.ckpt_name, "sd_xl_refiner_1.0.safetensors");
    // ADR-0028 style clause is injected into BOTH the base and refiner encode nodes.
    assert.equal(g["6"].inputs.text, "(Lego-style:1.3). a vast hall");
    assert.equal(g["12"].inputs.text, "(Lego-style:1.3). a vast hall");
    // ADR-0028 anti-drift negatives are appended to BOTH negative encodes.
    assert.match(g["7"].inputs.text, /graphite/);
    assert.match(g["13"].inputs.text, /graphite/);
    // ADR-0028 per-campaign seed lands on BOTH KSamplerAdvanced passes (noise_seed).
    const seed = deriveCampaignSeed(dir, "The Hall");
    assert.equal(g["3"].inputs.noise_seed, seed);
    assert.equal(g["14"].inputs.noise_seed, seed);
  });
});

test("generateLocalImage: a non-200 from /prompt returns { ok: false } and never throws", async () => {
  await withCampaignDir(async (dir) => {
    const result = await generateLocalImage(
      { campaignDir: dir, entityType: "npc", name: "X", description: "y", settings: SETTINGS },
      makeFetch({ prompt: jsonRes(500, { error: "boom" }) })
    );
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /500/);
  });
});

test("generateLocalImage: node_errors in the /prompt response is a failure", async () => {
  await withCampaignDir(async (dir) => {
    const result = await generateLocalImage(
      { campaignDir: dir, entityType: "npc", name: "X", description: "y", settings: SETTINGS },
      makeFetch({ prompt: jsonRes(200, { prompt_id: PROMPT_ID, node_errors: { "3": { message: "bad" } } }) })
    );
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /rejected the workflow/);
  });
});

test("generateLocalImage: an execution error status from /history is a failure", async () => {
  await withCampaignDir(async (dir) => {
    const result = await generateLocalImage(
      { campaignDir: dir, entityType: "npc", name: "X", description: "y", settings: SETTINGS },
      makeFetch({
        prompt: jsonRes(200, { prompt_id: PROMPT_ID }),
        history: jsonRes(200, { [PROMPT_ID]: { status: { status_str: "error", messages: [["boom"]] } } }),
      })
    );
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /execution error/);
  });
});

test("generateLocalImage: a non-200 from /view is a failure (not a saved empty file)", async () => {
  await withCampaignDir(async (dir) => {
    const result = await generateLocalImage(
      { campaignDir: dir, entityType: "npc", name: "X", description: "y", settings: SETTINGS },
      makeFetch({
        prompt: jsonRes(200, { prompt_id: PROMPT_ID }),
        history: jsonRes(200, {
          [PROMPT_ID]: { status: { status_str: "success" }, outputs: { "9": { images: [{ filename: "x.png", subfolder: "", type: "output" }] } } },
        }),
        view: jsonRes(404, {}),
      })
    );
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /\/view returned 404/);
    assert.equal(fs.existsSync(path.join(dir, "images")), false);
  });
});

// --- ADR-0032: LoRA-backed art styles (local backend) ---

const PIXEL = { model: "claude-sonnet-5", provider: "claude", artStyle: "pixel art" } as unknown as CampaignSettings;
const OIL = { model: "claude-sonnet-5", provider: "claude", artStyle: "oil painting" } as unknown as CampaignSettings;

/** ComfyUI's /object_info/LoraLoader shape, reporting `loraNames` as the loadable
 * lora_name enum (element [0]; element [1] is the widget config object). */
function objectInfoRes(loraNames: string[]): Response {
  return jsonRes(200, { LoraLoader: { input: { required: { lora_name: [loraNames, {}] } } } });
}

/** capturingFetch + an /object_info/LoraLoader route. `loraNames` = what ComfyUI can
 * load; `throwObjectInfo` simulates a network error on that call. */
function capturingFetchLoras(
  cap: { submitted?: any },
  opts: { loraNames?: string[]; throwObjectInfo?: boolean } = {}
): typeof fetch {
  const { loraNames = [], throwObjectInfo = false } = opts;
  return (async (url: string, init?: any) => {
    if (url.includes("/object_info")) {
      if (throwObjectInfo) throw new Error("connection refused");
      return objectInfoRes(loraNames);
    }
    if (url.includes("/prompt")) {
      cap.submitted = JSON.parse(init.body);
      return jsonRes(200, { prompt_id: PROMPT_ID });
    }
    if (url.includes("/history/")) {
      return jsonRes(200, {
        [PROMPT_ID]: { status: { status_str: "success" }, outputs: { "9": { images: [{ filename: "x.png", subfolder: "", type: "output" }] } } },
      });
    }
    return bytesRes(200);
  }) as unknown as typeof fetch;
}

test("resolveEffectiveTier: an active recipe forces the base workflow, swapping high off the refiner (ADR-0032)", () => {
  const pixel = STYLE_LORAS["pixel art"];
  const high = resolveEffectiveTier("high", pixel);
  assert.equal(high.workflow, "sdxl-txt2img.json");
  assert.equal(high.steps, 40);
  assert.ok(high.timeoutMs >= resolveTier("standard").timeoutMs);
  // fast/standard already use the base workflow → unchanged.
  assert.deepEqual(resolveEffectiveTier("standard", pixel), resolveTier("standard"));
  assert.deepEqual(resolveEffectiveTier("fast", pixel), resolveTier("fast"));
});

test("ensureTrigger: prepends when absent, skips (case-insensitively) when already present (ADR-0032)", () => {
  assert.equal(ensureTrigger("a weathered dwarf", "pixel art"), "pixel art. a weathered dwarf");
  assert.equal(ensureTrigger("Pixel Art. a dwarf", "pixel art"), "Pixel Art. a dwarf");
  assert.equal(ensureTrigger("(pixel art:1.3). a hall", "pixel art"), "(pixel art:1.3). a hall");
});

test("generateLocalImage: a mapped style with the LoRA available injects a LoraLoader and rewires the base chain (ADR-0032)", async () => {
  await withCampaignDir(async (dir) => {
    const cap: { submitted?: any } = {};
    await generateLocalImage(
      { campaignDir: dir, entityType: "npc", name: "Barrow", description: "a weathered dwarf", settings: PIXEL },
      capturingFetchLoras(cap, { loraNames: ["pixel-art-xl.safetensors", "other.safetensors"] })
    );
    const g = cap.submitted.prompt;
    const recipe = STYLE_LORAS["pixel art"];
    assert.equal(g["20"].class_type, "LoraLoader");
    assert.equal(g["20"].inputs.lora_name, recipe.loraFile);
    assert.equal(g["20"].inputs.strength_model, recipe.strength);
    assert.equal(g["20"].inputs.strength_clip, recipe.strength);
    assert.equal(typeof g["20"].inputs.strength_model, "number");
    // LoRA takes model/clip from the checkpoint; the base chain is repointed through it.
    assert.deepEqual(g["20"].inputs.model, ["4", 0]);
    assert.deepEqual(g["20"].inputs.clip, ["4", 1]);
    assert.deepEqual(g["6"].inputs.clip, ["20", 1]);
    assert.deepEqual(g["7"].inputs.clip, ["20", 1]);
    assert.deepEqual(g["3"].inputs.model, ["20", 0]);
    // Trigger already present via the leading style clause — not duplicated.
    assert.equal(g["6"].inputs.text, "pixel art. a weathered dwarf");
  });
});

test("generateLocalImage: an unmapped style injects no LoraLoader and leaves the base chain on the checkpoint (ADR-0032)", async () => {
  await withCampaignDir(async (dir) => {
    const cap: { submitted?: any } = {};
    await generateLocalImage(
      { campaignDir: dir, entityType: "npc", name: "X", description: "y", settings: SETTINGS },
      capturingFetchLoras(cap, { loraNames: ["pixel-art-xl.safetensors"] })
    );
    const g = cap.submitted.prompt;
    assert.equal(g["20"], undefined);
    assert.deepEqual(g["6"].inputs.clip, ["4", 1]);
    assert.deepEqual(g["7"].inputs.clip, ["4", 1]);
    assert.deepEqual(g["3"].inputs.model, ["4", 0]);
  });
});

test("generateLocalImage: a mapped style whose LoRA ComfyUI cannot load falls back to prompt-only and still succeeds (ADR-0032)", async () => {
  await withCampaignDir(async (dir) => {
    const cap: { submitted?: any } = {};
    const result = await generateLocalImage(
      { campaignDir: dir, entityType: "npc", name: "X", description: "y", settings: PIXEL },
      capturingFetchLoras(cap, { loraNames: ["something-else.safetensors"] }) // pixel-art-xl NOT listed
    );
    assert.equal(result.ok, true);
    const g = cap.submitted.prompt;
    assert.equal(g["20"], undefined);
    assert.deepEqual(g["3"].inputs.model, ["4", 0]);
  });
});

test("generateLocalImage: a thrown /object_info degrades to prompt-only and never fails the image (ADR-0032)", async () => {
  await withCampaignDir(async (dir) => {
    const cap: { submitted?: any } = {};
    const result = await generateLocalImage(
      { campaignDir: dir, entityType: "npc", name: "X", description: "y", settings: OIL },
      capturingFetchLoras(cap, { throwObjectInfo: true })
    );
    assert.equal(result.ok, true);
    assert.equal(cap.submitted.prompt["20"], undefined);
  });
});

test("generateLocalImage: a noRefiner LoRA style at quality=high renders base high-steps, not the refiner ensemble (ADR-0032)", async () => {
  await withCampaignDir(async (dir) => {
    const cap: { submitted?: any } = {};
    await generateLocalImage(
      { campaignDir: dir, entityType: "location", name: "The Hall", description: "a vast hall", settings: OIL, imageQuality: "high" },
      capturingFetchLoras(cap, { loraNames: ["ClassipeintXL2.1.safetensors"] })
    );
    const g = cap.submitted.prompt;
    // Base workflow, NOT the base→refiner ensemble.
    assert.equal(g["11"], undefined);
    assert.equal(g["14"], undefined);
    assert.equal(g["3"].class_type, "KSampler");
    assert.equal(g["3"].inputs.steps, 40);
    // LoRA injected into the base chain.
    assert.equal(g["20"].class_type, "LoraLoader");
    assert.equal(g["20"].inputs.lora_name, "ClassipeintXL2.1.safetensors");
    assert.deepEqual(g["3"].inputs.model, ["20", 0]);
    // The per-campaign seed still lands on the base KSampler's `seed` key.
    assert.equal(g["3"].inputs.seed, deriveCampaignSeed(dir, "The Hall"));
  });
});

test("generateLocalImage: a scene at a mapped color-forward style keeps ADR-0028 weighting + drift negatives alongside the LoRA (ADR-0032)", async () => {
  await withCampaignDir(async (dir) => {
    const cap: { submitted?: any } = {};
    await generateLocalImage(
      { campaignDir: dir, entityType: "scene", name: "Market", description: "a busy market", settings: OIL, imageQuality: "high" },
      capturingFetchLoras(cap, { loraNames: ["ClassipeintXL2.1.safetensors"] })
    );
    const g = cap.submitted.prompt;
    // ADR-0028 weighted style clause on the base positive encode; trigger already present.
    assert.equal(g["6"].inputs.text, "(oil painting:1.3). a busy market");
    // ADR-0028 anti-drift negatives still appended ("oil painting" is color-forward).
    assert.match(g["7"].inputs.text, /graphite/);
    // ADR-0032 LoRA present.
    assert.equal(g["20"].inputs.lora_name, "ClassipeintXL2.1.safetensors");
  });
});
