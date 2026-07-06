/**
 * Standalone stdio MCP server exposing `roll_seed` to the Grok DM backend
 * (ADR-0018). Reuses the shared spec + body from src/seed-selector.ts. Reads the
 * campaign's live `toneWhimsy` per call (so a settings change is honored) and
 * passes the campaign dir through so cross-campaign dedup against the global
 * content registry — and scratch-campaign registry isolation — is preserved.
 */
import { ROLL_SEED_DESCRIPTION, ROLL_SEED_INPUT_SHAPE, runRollSeedTool } from "../seed-selector.js";
import { readCampaignSettings } from "../campaign-store.js";
import { requireCampaignDir, serveSingleTool } from "./shared.js";

const campaignDir = requireCampaignDir();

await serveSingleTool("seed-tables", (server) => {
  server.registerTool(
    "roll_seed",
    { description: ROLL_SEED_DESCRIPTION, inputSchema: ROLL_SEED_INPUT_SHAPE },
    async (args) => {
      const { toneWhimsy } = readCampaignSettings(campaignDir);
      return runRollSeedTool(args, toneWhimsy, campaignDir);
    }
  );
});
