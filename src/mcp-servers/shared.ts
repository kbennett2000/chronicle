import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

/** Standalone stdio MCP servers (ADR-0018) that expose Chronicle's host tools to
 * the Grok DM backend. Grok launches each as a subprocess declared in a
 * per-turn `<campaignDir>/.grok/config.toml`, passing the campaign directory via
 * this env var. The servers read the campaign's `campaign-settings.json` live at
 * call time, so a mid-life settings change is honored without rebuilding config —
 * and each server takes `campaignDir` explicitly, re-establishing ADR-0004's
 * "no cross-campaign state bleed" for the out-of-process case. */
export const CAMPAIGN_DIR_ENV = "CHRONICLE_CAMPAIGN_DIR";

/** The campaign directory this server is scoped to, or throws a clear error so a
 * misconfigured config.toml fails loudly instead of silently touching the wrong
 * (or no) campaign. */
export function requireCampaignDir(): string {
  const dir = process.env[CAMPAIGN_DIR_ENV];
  if (!dir || !dir.trim()) {
    throw new Error(
      `${CAMPAIGN_DIR_ENV} is not set — this MCP server must be launched by Chronicle's Grok backend with the campaign dir in its env`
    );
  }
  return dir;
}

/** Boilerplate: build a one-tool stdio MCP server and start it on stdio. `name`
 * must match the `[mcp_servers.<name>]` key Chronicle writes into config.toml so
 * Grok namespaces the tool as `<name>__<tool>`. */
export async function serveSingleTool(
  serverName: string,
  register: (server: McpServer) => void
): Promise<void> {
  const server = new McpServer({ name: serverName, version: "1.0.0" });
  register(server);
  await server.connect(new StdioServerTransport());
}
