import type { DmBackend, RunTurnArgs } from "../dm-backend.js";
import type { TurnResult } from "../dm-engine.js";

/** Grok DM backend (ADR-0018). Stubbed in Slice 2 — provider is selectable in
 * data so the settings plumbing can be built and tested, but running a Grok
 * turn is implemented in Slice 4. Throwing here (rather than silently falling
 * back to Claude) makes a premature selection loud instead of misleading. */
export const grokBackend: DmBackend = {
  provider: "grok",
  runTurn(_args: RunTurnArgs): Promise<TurnResult> {
    throw new Error(
      "the Grok DM backend is not yet implemented (ADR-0018, Slice 4) — select Claude for now"
    );
  },
};
