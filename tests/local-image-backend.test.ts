import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateLocalImage, deriveCampaignSeed } from "../src/image-backends/local.js";
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
