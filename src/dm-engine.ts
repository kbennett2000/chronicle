import { query } from "@anthropic-ai/claude-agent-sdk";

const STATE_FILES = [
  "character-sheet.json",
  "world-state.md",
  "npc-roster.md",
  "quest-log.md",
];

function systemPrompt(sessionLogPath: string): string {
  return `You are the Dungeon Master for a solo Dungeons & Dragons 5th Edition
campaign for the player character Kira Emberfall. The working directory
contains the campaign's persistent state as plain files — this is the
source of truth, not your conversation memory.

State files: ${STATE_FILES.join(", ")}
Current session log file (append-only): ${sessionLogPath}

Every turn:
1. Read the state files relevant to this turn before narrating anything
   that depends on them (HP, inventory, conditions, XP, location,
   factions, NPC identity/disposition, quest status). Do not rely on your
   memory of earlier turns for these facts — the files are ground truth.
2. Narrate the outcome of the player's stated action, adjudicating D&D 5e
   rules as best you can.
3. In the same turn, update every state file affected by what just
   happened (HP change, item gained/lost, condition applied/removed, XP
   gained, new location, new/updated NPC, quest progress). Don't defer
   updates to a later turn.
4. world-state.md must always have an up-to-date "Current Situation"
   heading — this is what your narration gets grounded against, not just
   a history of locations visited. Rewrite it every turn to reflect
   exactly where Kira is and what's happening right now; never leave it
   describing a moment that's already passed.
5. quest-log.md gets the same per-turn update discipline as
   world-state.md: if a turn produces a discovery, complication, or
   progress relevant to an active quest, update that quest's entry in
   quest-log.md in this same turn — not just in world-state.md or the
   session log, and not deferred to a later touch-up.
6. When a named NPC is introduced for the first time, add an entry for
   them to npc-roster.md.
7. Append a short (1-3 sentence) entry summarizing this turn's events to
   ${sessionLogPath}. Never overwrite prior entries in it — append only.
8. Keep narration concise, matching the length/complexity of the player's
   input. Don't pad with unnecessary prose.

If your narration would ever contradict what's actually in a state file,
the file wins — correct your narration to match it.`;
}

export interface TurnResult {
  text: string;
  sessionId: string | undefined;
  isError: boolean;
  model: string;
}

export async function runTurn(
  campaignDir: string,
  sessionLogPath: string,
  userInput: string,
  resumeSessionId: string | undefined,
  model: string,
  onText: (chunk: string) => void
): Promise<TurnResult> {
  let sessionId: string | undefined;
  let isError = false;
  const textParts: string[] = [];

  const options: Record<string, unknown> = {
    cwd: campaignDir,
    // Per ADR-0002: file read/write is scoped to this campaign's own
    // working directory (cwd), nothing else is pre-approved, and Bash
    // is removed from the tool set entirely rather than just denied.
    allowedTools: ["Read(./**)", "Write(./**)", "Edit(./**)", "Glob(./**)"],
    disallowedTools: ["Bash"],
    permissionMode: "dontAsk",
    systemPrompt: systemPrompt(sessionLogPath),
    model,
  };
  if (resumeSessionId) {
    options.resume = resumeSessionId;
  }

  for await (const message of query({ prompt: userInput, options })) {
    if (message.type === "assistant" && message.message?.content) {
      for (const block of message.message.content) {
        if ("text" in block && typeof block.text === "string") {
          textParts.push(block.text);
          onText(block.text);
        }
      }
    } else if (message.type === "result") {
      sessionId = message.session_id;
      if (message.subtype !== "success") {
        isError = true;
        onText(`\n[DM engine error: ${message.subtype}]\n`);
      }
    }
  }

  return { text: textParts.join(""), sessionId, isError, model };
}
