import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runRollDiceTool } from "../src/dice.js";
import { runRollSeedTool } from "../src/seed-selector.js";
import { runRollTextureTool } from "../src/texture-selector.js";
import { scaffoldCampaign } from "../src/campaign-store.js";

// ADR-0018 Slice 3: the provider-neutral tool bodies shared by the in-process
// Claude tools and the standalone stdio MCP servers. The underlying roll fns
// have their own tests; these lock in the MCP content-shape wrappers.

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
  const dir = scaffoldCampaign(uniqueId(), { name: "S", race: "Human", class: "Bard", level: 1 });
  try {
    const res = runRollSeedTool({ category: "npc" }, undefined, dir);
    assert.equal(res.content[0].type, "text");
    assert.match(res.content[0].text, /^Seed \(/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runRollTextureTool returns a labeled texture beat for a real campaign dir", () => {
  const dir = scaffoldCampaign(uniqueId(), { name: "T", race: "Elf", class: "Cleric", level: 1 });
  try {
    const res = runRollTextureTool({ category: "rumor" }, dir);
    assert.equal(res.content[0].type, "text");
    assert.match(res.content[0].text, /^Texture \(rumor\): /);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
