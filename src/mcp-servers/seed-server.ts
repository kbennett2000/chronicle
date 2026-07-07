/**
 * Standalone stdio MCP server exposing `roll_seed` to the Grok DM backend
 * (ADR-0018). Reuses the shared spec + body from src/seed-selector.ts. Reads the
 * campaign's live `toneWhimsy` per call (so a settings change is honored).
 *
 * This server only ever runs inside a Grok turn, which is confined by
 * `--sandbox workspace` to campaignDir. The shared global registry
 * (campaigns/_registry/) is a SIBLING outside that sandbox, so we pass
 * localRegistry=true to route reads/writes to <campaignDir>/content-registry.md
 * instead — a Grok campaign dedups against its own history (ADR-0018 Slice 5).
 * The Claude in-process path keeps the global registry.
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
      return runRollSeedTool(args, toneWhimsy, campaignDir, true);
    }
  );
});
