import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decidePermission } from "../src/dm-engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Mirror the real layout: SRD lives at <repo>/reference/srd, campaigns live
// under <repo>/campaigns/<id> — both resolved the same way dm-engine does.
const SRD_DIR = path.resolve(__dirname, "../reference/srd");
const campaignDir = path.resolve(__dirname, "../campaigns/scratch-unit-fixture");

function allowed(toolName: string, input: Record<string, unknown>, generateImages = false): boolean {
  return decidePermission(toolName, input, campaignDir, generateImages).behavior === "allow";
}

test("campaign-relative file ops are allowed", () => {
  assert.ok(allowed("Read", { file_path: "character-sheet.json" }));
  assert.ok(allowed("Write", { file_path: "quest-log.md" }));
  assert.ok(allowed("Edit", { file_path: "world-state.md" }));
  assert.ok(allowed("Glob", { pattern: "**/*.md" }));
  assert.ok(allowed("Read", { file_path: path.join(campaignDir, "session-log/turn.md") }));
});

test("SRD reference reads are allowed; SRD writes are not", () => {
  assert.ok(allowed("Read", { file_path: path.join(SRD_DIR, "combat-resolution.md") }));
  assert.ok(!allowed("Write", { file_path: path.join(SRD_DIR, "combat-resolution.md") }));
  assert.ok(!allowed("Edit", { file_path: path.join(SRD_DIR, "conditions.md") }));
});

test("out-of-tree paths are denied", () => {
  assert.ok(!allowed("Read", { file_path: "/etc/passwd" }));
  assert.ok(!allowed("Write", { file_path: "../other-campaign/quest-log.md" }));
  assert.ok(!allowed("Read", { file_path: path.join(campaignDir, "../../secrets.json") }));
  assert.ok(!allowed("Glob", { pattern: "**", path: "/etc" }));
});

test("Bash and unknown tools are denied", () => {
  const bash = decidePermission("Bash", { command: "ls" }, campaignDir, false);
  assert.equal(bash.behavior, "deny");
  assert.ok(!allowed("WebFetch", { url: "https://example.com" }));
});

test("host MCP tools are allowed by server segment", () => {
  assert.ok(allowed("mcp__seed-tables__roll_seed", {}));
  assert.ok(allowed("mcp__texture-tables__roll_texture", {}));
  assert.ok(allowed("mcp__dice__roll_dice", { notation: "1d20+2" }));
});

test("image MCP tool is gated on generateImages", () => {
  assert.ok(!allowed("mcp__image-tools__generate_image", {}, false));
  assert.ok(allowed("mcp__image-tools__generate_image", {}, true));
});
