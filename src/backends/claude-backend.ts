import type { DmBackend, RunTurnArgs } from "../dm-backend.js";
import { runTurn, type TurnResult } from "../dm-engine.js";

/** The existing Claude Agent SDK path (ADR-0001/0018), wrapped behind the
 * `DmBackend` interface with ZERO behavior change — it just unpacks `RunTurnArgs`
 * into the original positional `runTurn(...)`, whose tool/hook/session/mismatch
 * logic is untouched. */
export const claudeBackend: DmBackend = {
  provider: "claude",
  runTurn(args: RunTurnArgs): Promise<TurnResult> {
    return runTurn(
      args.campaignDir,
      args.sessionLogPath,
      args.userInput,
      args.resumeSessionId,
      args.model,
      args.settings,
      args.onText
    );
  },
};
