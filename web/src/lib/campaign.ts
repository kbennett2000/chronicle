import { apiFetch, apiFetchRaw } from "./api";
import type { Connection } from "./connection";

/** No "list campaigns" endpoint exists (per the Slice 14 plan) — the old
 * bare-JS UI took the campaign id from a ?campaign= query param,
 * defaulting to the one fixture that exists today. Same convention here. */
export function getCampaignId(): string {
  return new URLSearchParams(window.location.search).get("campaign") || "test-campaign";
}

/** character-sheet.json's shape per docs/design/handoff-2026-07/
 * backend-contract.md §4. Everything past name/race/class/level is
 * optional on purpose: this is plain JSON the DM engine writes, not a
 * schema-validated record, and per the backend contract "an NPC met
 * before image generation was enabled...simply won't have an image
 * reference" — the same "field may just not be there yet" reasoning
 * applies to a character sheet predating a later schema addition (e.g.
 * `currency`, added by issue #4). Every consumer of these optional
 * fields must degrade gracefully, not throw. */
export interface CharacterSheet {
  name: string;
  race: string;
  class: string;
  level: number;
  hp?: { current: number; max: number };
  armorClass?: number;
  abilityScores?: Partial<Record<"strength" | "dexterity" | "constitution" | "intelligence" | "wisdom" | "charisma", number>>;
  conditions?: string[];
  inventory?: Array<{ item: string; quantity: number }>;
  xp?: number;
  spellSlots?: Record<string, { total: number; used: number }>;
  currency?: { cp: number; sp: number; ep: number; gp: number; pp: number };
  portraitImage?: string;
}

/** Per ADR-0007: the server's own deterministic record of who said what
 * this session, written at the moment both strings are already in hand —
 * never inferred from currentSessionLog.content's prose. Use this for
 * turn-by-turn player-action/narration attribution instead of parsing
 * the prose log (see lib/session-log.ts, which still owns chapter/
 * story-event framing from that prose — a legitimate literary device,
 * just not the mechanical speaker attribution). */
export interface TurnTranscriptRecord {
  turnIndex: number;
  timestamp: string;
  playerMessage: string;
  narration: string;
}

export interface StateSnapshot {
  characterSheet: CharacterSheet;
  worldState: string;
  npcRoster: string;
  questLog: string;
  model: string;
  currentSessionLog?: { path: string; content: string; transcript: TurnTranscriptRecord[] };
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
