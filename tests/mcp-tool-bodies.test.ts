import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runRollDiceTool } from "../src/dice.js";
import { runRollSeedTool } from "../src/seed-selector.js";
import { runRollTextureTool } from "../src/texture-selector.js";
import { scaffoldCampaign } from "../src/campaign-store.js";

// ADR-0018 Slice 3: the provider-neutral tool bodies shared by the in-process
// Claude tools and the standalone stdio MCP servers. The underlying roll fns
// have their own tests; these lock in the MCP content-shape wrappers.

// ADR-0019: campaigns nest under a user dir; a throwaway user isolates fixtures.
const TEST_USER = "zz-mcpbody-test-user";
function uniqueId(): string {
  return `zz-mcpbody-test-${process.pid}-${process.hrtime.bigint()}`;
}

test("runRollDiceTool returns MCP text content with the reason prefix", () => {
  const res = runRollDiceTool({ notation: "2d6", reason: "Test roll" });
  assert.equal(res.content.length, 1);
  assert.equal(res.content[0].type, "text");
  assert.match(res.content[0].text, /^Test roll: /);
  assert.match(res.content[0].text, /2d6/);
});

test("runRollDiceTool returns a helpful error string for bad notation (never throws)", () => {
  const res = runRollDiceTool({ notation: "not-dice" });
  assert.match(res.content[0].text, /Could not roll/);
  assert.match(res.content[0].text, /standard notation/);
});

test("runRollSeedTool returns a labeled seed for a real campaign dir", () => {
  // localRegistry:true keeps this roll inside the temp campaign dir (deleted in
  // finally) instead of appending to the tracked global registry — the Grok
  // seed-server path (ADR-0018 Slice 5), and the hygienic default for a test.
  const dir = scaffoldCampaign(TEST_USER, uniqueId(), { name: "S", race: "Human", class: "Bard", level: 1 });
  try {
    const res = runRollSeedTool({ category: "npc" }, undefined, dir, true);
    assert.equal(res.content[0].type, "text");
    assert.match(res.content[0].text, /^Seed \(/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runRollSeedTool with localRegistry writes the per-campaign registry, not the global one", () => {
  // ADR-0018 Slice 5: under Grok's --sandbox workspace the global
  // campaigns/_registry/ is unreachable, so the seed server passes
  // localRegistry=true to route the registry inside campaignDir.
  const dir = scaffoldCampaign(TEST_USER, uniqueId(), { name: "L", race: "Dwarf", class: "Fighter", level: 1 });
  try {
    const res = runRollSeedTool({ category: "location" }, undefined, dir, true);
    const seedValue = res.content[0].text.replace(/^Seed \([^)]*\): /, "").split("\n")[0];

    const localRegistry = path.join(dir, "content-registry.md");
    assert.ok(fs.existsSync(localRegistry), "per-campaign registry file should exist inside campaignDir");
    assert.match(fs.readFileSync(localRegistry, "utf8"), new RegExp(seedValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runRollTextureTool returns a labeled texture beat for a real campaign dir", () => {
  const dir = scaffoldCampaign(TEST_USER, uniqueId(), { name: "T", race: "Elf", class: "Cleric", level: 1 });
  try {
    const res = runRollTextureTool({ category: "rumor" }, dir);
    assert.equal(res.content[0].type, "text");
    assert.match(res.content[0].text, /^Texture \(rumor\): /);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
