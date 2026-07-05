import { createInterface } from "node:readline";
import { runTurn } from "./dm-engine.js";
import {
  resolveCampaignDir,
  readPersistedSessionId,
  persistSessionId,
  resolveSessionLog,
  readCampaignModel,
} from "./campaign-store.js";

const campaignDir = resolveCampaignDir("test-campaign");
const model = readCampaignModel(campaignDir);

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
      (chunk) => process.stdout.write(chunk)
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
