/**
 * Standalone stdio MCP server exposing `generate_image` to the Grok DM backend
 * (ADR-0018). Reuses the shared spec + body from src/image-generator.ts, which
 * shells out to the `grok` CLI's /imagine in an isolated temp dir (issue #60).
 * Reads the campaign's live settings per call for artStyle. Chronicle only wires
 * this server into config.toml when the campaign has generateImages enabled.
 */
import { GENERATE_IMAGE_DESCRIPTION, GENERATE_IMAGE_INPUT_SHAPE, runGenerateImageTool } from "../image-generator.js";
import { readCampaignSettings } from "../campaign-store.js";
import { requireCampaignDir, serveSingleTool } from "./shared.js";

const campaignDir = requireCampaignDir();

await serveSingleTool("image-tools", (server) => {
  server.registerTool(
    "generate_image",
    { description: GENERATE_IMAGE_DESCRIPTION, inputSchema: GENERATE_IMAGE_INPUT_SHAPE },
    async (args) => {
      const settings = readCampaignSettings(campaignDir);
      return runGenerateImageTool(args, campaignDir, settings);
    }
  );
});
