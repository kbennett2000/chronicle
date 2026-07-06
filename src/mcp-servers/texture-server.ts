/**
 * Standalone stdio MCP server exposing `roll_texture` to the Grok DM backend
 * (ADR-0018). Reuses the shared spec + body from src/texture-selector.ts. Reads
 * the campaign's live `toneWhimsy` per call and dedups against this campaign's
 * own texture registry (via campaignDir).
 */
import { ROLL_TEXTURE_DESCRIPTION, ROLL_TEXTURE_INPUT_SHAPE, runRollTextureTool } from "../texture-selector.js";
import { readCampaignSettings } from "../campaign-store.js";
import { requireCampaignDir, serveSingleTool } from "./shared.js";

const campaignDir = requireCampaignDir();

await serveSingleTool("texture-tables", (server) => {
  server.registerTool(
    "roll_texture",
    { description: ROLL_TEXTURE_DESCRIPTION, inputSchema: ROLL_TEXTURE_INPUT_SHAPE },
    async (args) => {
      const { toneWhimsy } = readCampaignSettings(campaignDir);
      return runRollTextureTool(args, campaignDir, toneWhimsy);
    }
  );
});
