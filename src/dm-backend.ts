import type { CampaignSettings, ProviderId } from "./campaign-store.js";
import type { TurnResult } from "./dm-engine.js";

/** Which engine runs the DM (ADR-0018). Defined in campaign-store (where model
 * lives); re-exported here for backends that only import the engine seam. */
export type { ProviderId };

/** Everything a single turn needs, independent of which backend runs it. The
 * positional `runTurn(...)` in dm-engine.ts is wrapped by the Claude backend to
 * this shape so `src/server.ts` can stay provider-agnostic (ADR-0018). */
export interface RunTurnArgs {
  campaignDir: string;
  sessionLogPath: string;
  userInput: string;
  resumeSessionId: string | undefined;
  model: string;
  settings: CampaignSettings;
  onText: (chunk: string) => void;
}

/** A DM engine backend. Both Claude (Agent SDK) and Grok (headless CLI)
 * implement this and return the identical `TurnResult`, so the server dispatches
 * through one line and everything downstream (transcript, session persistence,
 * model-mismatch logging, response shape) is unchanged across providers. */
export interface DmBackend {
  readonly provider: ProviderId;
  runTurn(args: RunTurnArgs): Promise<TurnResult>;
}
