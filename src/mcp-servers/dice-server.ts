/**
 * Standalone stdio MCP server exposing `roll_dice` to the Grok DM backend
 * (ADR-0018). Reuses the shared spec + body from src/dice.ts, so Grok gets the
 * exact same tool guidance and host-side crypto RNG as the Claude path. Needs no
 * campaign context — a dice roll is stateless.
 */
import { ROLL_DICE_DESCRIPTION, ROLL_DICE_INPUT_SHAPE, runRollDiceTool } from "../dice.js";
import { serveSingleTool } from "./shared.js";

await serveSingleTool("dice", (server) => {
  server.registerTool(
    "roll_dice",
    { description: ROLL_DICE_DESCRIPTION, inputSchema: ROLL_DICE_INPUT_SHAPE },
    async (args) => runRollDiceTool(args)
  );
});
