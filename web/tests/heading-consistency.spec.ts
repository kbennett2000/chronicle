import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CURRENT_SITUATION_HEADING,
  QUEST_ACTIVE_HEADING,
  QUEST_COMPLETED_HEADING,
  NPC_DESCRIPTION_FIELD,
  NPC_DISPOSITION_FIELD,
  NPC_KNOWS_FIELD,
  NPC_PORTRAIT_FIELD,
} from "../src/lib/state-headings";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

/** Cheap string-containment checks, not a full schema — but they turn a
 * silent parser miss (see lib/markdown.ts's console.warn) into a build-
 * time failure if the backend's heading text ever drifts from what the
 * frontend looks for. No browser needed for these. */
test.describe("markdown heading consistency (frontend parser vs. backend source of truth)", () => {
  test("dm-engine.ts's system prompt still instructs the exact 'Current Situation' heading", () => {
    const dmEngine = fs.readFileSync(path.join(REPO_ROOT, "src/dm-engine.ts"), "utf8");
    expect(dmEngine).toContain(`"${CURRENT_SITUATION_HEADING}"`);
  });

  test("scratch-campaign.ts's quest-log template still uses the Active/Completed headings", () => {
    const scratch = fs.readFileSync(path.join(REPO_ROOT, "scripts/scratch-campaign.ts"), "utf8");
    expect(scratch).toContain(`## ${QUEST_ACTIVE_HEADING}`);
    expect(scratch).toContain(`## ${QUEST_COMPLETED_HEADING}`);
  });

  test("scratch-campaign.ts's npc-roster template still uses the Description/Disposition/Knows/Portrait bullet names", () => {
    const scratch = fs.readFileSync(path.join(REPO_ROOT, "scripts/scratch-campaign.ts"), "utf8");
    expect(scratch).toContain(`**${NPC_DESCRIPTION_FIELD}:**`);
    expect(scratch).toContain(`**${NPC_DISPOSITION_FIELD}:**`);
    expect(scratch).toContain(`**${NPC_KNOWS_FIELD}:**`);
    expect(scratch).toContain(`**${NPC_PORTRAIT_FIELD}:**`);
  });

  test("image-generator.ts's tool instructions still tell the model to record the image path in the 'Portrait asset ID' field", () => {
    const imageGenerator = fs.readFileSync(path.join(REPO_ROOT, "src/image-generator.ts"), "utf8");
    expect(imageGenerator).toContain(`"${NPC_PORTRAIT_FIELD}"`);
  });
});
