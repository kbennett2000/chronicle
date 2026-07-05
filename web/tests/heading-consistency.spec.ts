import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CURRENT_SITUATION_HEADING,
  LOCATIONS_VISITED_HEADING,
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

  test("campaign-store.ts's world-state template still uses the Locations Visited heading", () => {
    // The blank state-file templates moved from scratch-campaign.ts into
    // campaign-store.ts's scaffoldCampaign primitive (ADR-0010); both scratch
    // and real character-creation campaigns are scaffolded from them now.
    const store = fs.readFileSync(path.join(REPO_ROOT, "src/campaign-store.ts"), "utf8");
    expect(store).toContain(`## ${LOCATIONS_VISITED_HEADING}`);
  });

  test("image-generator.ts's tool instructions still tell the model to record a location's image as an 'Image' line", () => {
    const imageGenerator = fs.readFileSync(path.join(REPO_ROOT, "src/image-generator.ts"), "utf8").replace(/\s+/g, " ");
    expect(imageGenerator).toContain(`an "Image" line under the location's world-state.md bullet`);
  });

  test("campaign-store.ts's quest-log template still uses the Active/Completed headings", () => {
    const store = fs.readFileSync(path.join(REPO_ROOT, "src/campaign-store.ts"), "utf8");
    expect(store).toContain(`## ${QUEST_ACTIVE_HEADING}`);
    expect(store).toContain(`## ${QUEST_COMPLETED_HEADING}`);
  });

  test("campaign-store.ts's npc-roster template still uses the Description/Disposition/Knows/Portrait bullet names", () => {
    const store = fs.readFileSync(path.join(REPO_ROOT, "src/campaign-store.ts"), "utf8");
    expect(store).toContain(`**${NPC_DESCRIPTION_FIELD}:**`);
    expect(store).toContain(`**${NPC_DISPOSITION_FIELD}:**`);
    expect(store).toContain(`**${NPC_KNOWS_FIELD}:**`);
    expect(store).toContain(`**${NPC_PORTRAIT_FIELD}:**`);
  });

  test("image-generator.ts's tool instructions still tell the model to record the image path in the 'Portrait asset ID' field", () => {
    const imageGenerator = fs.readFileSync(path.join(REPO_ROOT, "src/image-generator.ts"), "utf8");
    expect(imageGenerator).toContain(`"${NPC_PORTRAIT_FIELD}"`);
  });
});
