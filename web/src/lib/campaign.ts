import { apiFetch } from "./api";
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

export async function startSession(connection: Connection, campaignId: string): Promise<SessionStartResult> {
  return (await apiFetch(connection, `/campaigns/${encodeURIComponent(campaignId)}/session/start`, {
    method: "POST",
    body: JSON.stringify({}),
  })) as SessionStartResult;
}
