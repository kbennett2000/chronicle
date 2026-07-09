import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateLocalImage } from "../src/image-backends/local.js";
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

test("generateLocalImage: injects the sanitized prompt (art style leads) and a numeric seed into the graph", async () => {
  await withCampaignDir(async (dir) => {
    let submitted: any;
    const fetchFn = (async (url: string, init?: any) => {
      if (url.includes("/prompt")) {
        submitted = JSON.parse(init.body);
        return jsonRes(200, { prompt_id: PROMPT_ID });
      }
      if (url.includes("/history/")) {
        return jsonRes(200, {
          [PROMPT_ID]: { status: { status_str: "success" }, outputs: { "9": { images: [{ filename: "x.png", subfolder: "", type: "output" }] } } },
        });
      }
      return bytesRes(200);
    }) as unknown as typeof fetch;

    await generateLocalImage(
      { campaignDir: dir, entityType: "location", name: "The Forge", description: "a glowing forge", settings: SETTINGS },
      fetchFn
    );
    // buildImagePrompt leads with the art style (#104), injected at node "6".
    assert.equal(submitted.prompt["6"].inputs.text, "ink wash. a glowing forge");
    assert.equal(typeof submitted.prompt["3"].inputs.seed, "number");
    assert.ok(submitted.client_id.startsWith("chronicle-location-"));
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
