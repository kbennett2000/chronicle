import { apiFetch, apiFetchRaw } from "./api";
import type { Connection } from "./connection";

/** No "list campaigns" endpoint exists (per the Slice 14 plan) — the old
 * bare-JS UI took the campaign id from a ?campaign= query param,
 * defaulting to the one fixture that exists today. Same convention here. */
export function getCampaignId(): string {
  return new URLSearchParams(window.location.search).get("campaign") || "test-campaign";
}

/** Subset of character-sheet.json actually used by the Home screen today
 * — see docs/design/handoff-2026-07/backend-contract.md §4 for the full
 * shape (inventory, conditions, spell slots, currency, etc.), which later
 * slices' Self panel will need in full. */
export interface CharacterSheet {
  name: string;
  race: string;
  class: string;
  level: number;
  portraitImage?: string;
}

export interface StateSnapshot {
  characterSheet: CharacterSheet;
  worldState: string;
  npcRoster: string;
  questLog: string;
  model: string;
  currentSessionLog?: { path: string; content: string };
}

export interface SessionStartResult {
  campaignId: string;
  sessionId: string | null;
  resumed: boolean;
  sessionLogPath: string;
  model: string;
}

export async function getState(connection: Connection, campaignId: string): Promise<StateSnapshot> {
  return (await apiFetch(connection, `/campaigns/${encodeURIComponent(campaignId)}/state`)) as StateSnapshot;
}

export async function startSession(
  connection: Connection,
  campaignId: string,
  model?: string
): Promise<SessionStartResult> {
  return (await apiFetch(connection, `/campaigns/${encodeURIComponent(campaignId)}/session/start`, {
    method: "POST",
    body: JSON.stringify(model ? { model } : {}),
  })) as SessionStartResult;
}

export interface TurnResult {
  narration: string;
  sessionId: string | null;
  model: string;
  isError: boolean;
}

/** No sessionId is sent here, and none is required — the active Agent SDK
 * session (if any) is tracked server-side per campaign, keyed off the
 * POST /session/start call Home already makes before entering Play. A
 * fresh campaign's first turn works with no prior sessionId at all: the
 * server lazily assigns one once the engine actually runs (confirmed in
 * Slice 16 and again by tests/e2e/turn.spec.ts here).
 *
 * Uses apiFetchRaw, not apiFetch: a failed turn comes back as HTTP 502
 * with a valid { narration, isError: true } body (see server.ts) — that's
 * a domain result to render, not a fetch failure to throw on. */
export async function sendTurn(connection: Connection, campaignId: string, message: string): Promise<TurnResult> {
  const { body } = await apiFetchRaw(connection, `/campaigns/${encodeURIComponent(campaignId)}/turns`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
  return body as TurnResult;
}
