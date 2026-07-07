import "dotenv/config";
import { createInterface } from "node:readline";
import { runTurn } from "./dm-engine.js";
import {
  resolveCampaignDir,
  readPersistedSessionId,
  persistSessionId,
  resolveSessionLog,
  readCampaignModel,
  readCampaignSettings,
} from "./campaign-store.js";
import { userIdForUsername } from "./user-store.js";

// ADR-0019: campaigns nest under a user dir now. The CLI harness plays the
// tracked test-campaign, owned by the bootstrap user (BOOTSTRAP_USERNAME in
// .env, default "kris") after the multi-user migration.
const bootstrapUserId = userIdForUsername(process.env.BOOTSTRAP_USERNAME ?? "kris");
const campaignDir = resolveCampaignDir(bootstrapUserId, "test-campaign");
const model = readCampaignModel(campaignDir);
const settings = readCampaignSettings(campaignDir);

let resumeSessionId = readPersistedSessionId(campaignDir);
const sessionLogRelPath = resolveSessionLog(campaignDir, Boolean(resumeSessionId));

console.log("Chronicle DM engine — CLI harness");
console.log(`Campaign dir: ${campaignDir}`);
console.log(`Session log: ${sessionLogRelPath}`);
console.log(`Model: ${model}`);
if (resumeSessionId) {
  console.log(`Resuming prior session: ${resumeSessionId}`);
}
console.log("Type your action and press enter. Ctrl+D to quit.\n");

const rl = createInterface({ input: process.stdin, output: process.stdout });

async function promptLoop() {
  rl.setPrompt("> ");
  rl.prompt();

  for await (const line of rl) {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      continue;
    }

    process.stdout.write("\nDM: ");
    const result = await runTurn(
      campaignDir,
      sessionLogRelPath,
      input,
      resumeSessionId,
      model,
      settings,
      (chunk: string) => process.stdout.write(chunk)
    );
    process.stdout.write("\n\n");

    if (result.sessionId) {
      resumeSessionId = result.sessionId;
      persistSessionId(campaignDir, resumeSessionId);
    }

    rl.prompt();
  }
}

promptLoop().then(() => {
  console.log("\nSession ended.");
  process.exit(0);
});
