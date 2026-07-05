import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { runTurn } from "./dm-engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const campaignDir = path.resolve(__dirname, "../campaigns/test-campaign");
const sessionIdFile = path.join(campaignDir, ".session-id");

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const sessionLogRelPath = `session-log/session-${timestamp}.md`;
const sessionLogAbsPath = path.join(campaignDir, sessionLogRelPath);
fs.writeFileSync(
  sessionLogAbsPath,
  `# Session ${timestamp}\n\n`
);

let resumeSessionId: string | undefined = fs.existsSync(sessionIdFile)
  ? fs.readFileSync(sessionIdFile, "utf8").trim()
  : undefined;

console.log("Chronicle DM engine — Slice 1 harness");
console.log(`Campaign dir: ${campaignDir}`);
console.log(`Session log: ${sessionLogRelPath}`);
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
      (chunk) => process.stdout.write(chunk)
    );
    process.stdout.write("\n\n");

    if (result.sessionId) {
      resumeSessionId = result.sessionId;
      fs.writeFileSync(sessionIdFile, resumeSessionId);
    }

    rl.prompt();
  }
}

promptLoop().then(() => {
  console.log("\nSession ended.");
  process.exit(0);
});
