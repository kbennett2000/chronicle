import { ApiError, apiFetch, apiFetchRaw } from "./api";
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
  /** ADR-0009: a user-illustrated moment records its scene image's relative
   * path here; absent on turns never illustrated. */
  image?: string;
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

/** Mirrors src/campaign-store.ts's CampaignSettings. `model` is included
 * in GET's response (readCampaignSettings always reads/returns it) but
 * per the backend contract §5 it can never be changed via POST here —
 * server.ts's POST /settings handler never even reads a `model` field
 * off the request body. The only way to change it is
 * POST /campaigns/:id/session/start (see startSession above) — that
 * split is real, not a frontend simplification, so CampaignSettingsPatch
 * below deliberately excludes it rather than silently no-opping it. */
export interface CampaignSettings {
  model: string;
  artStyle?: string;
  worldSetting?: string;
  toneWhimsy?: number;
  contentIntensity?: "standard" | "low";
  generateImages?: boolean;
  /** Issue #44: absent === on. When explicitly false, the player supplies
   * their own dice values instead of the engine rolling. */
  autoRollDice?: boolean;
}

export type CampaignSettingsPatch = Partial<Omit<CampaignSettings, "model">>;

export interface ModelOption {
  id: string;
  label: string;
}

export async function getCampaignSettings(connection: Connection, campaignId: string): Promise<CampaignSettings> {
  return (await apiFetch(connection, `/campaigns/${encodeURIComponent(campaignId)}/settings`)) as CampaignSettings;
}

export async function updateCampaignSettings(
  connection: Connection,
  campaignId: string,
  patch: CampaignSettingsPatch
): Promise<CampaignSettings> {
  return (await apiFetch(connection, `/campaigns/${encodeURIComponent(campaignId)}/settings`, {
    method: "POST",
    body: JSON.stringify(patch),
  })) as CampaignSettings;
}

export async function getModels(connection: Connection): Promise<{ models: ModelOption[]; default: string }> {
  return (await apiFetch(connection, "/models")) as { models: ModelOption[]; default: string };
}

/** Mirrors src/campaign-store.ts's CampaignSummary — the Home chronicle list
 * (ADR-0010). */
export interface CampaignSummary {
  id: string;
  name: string;
  race: string;
  class: string;
  level: number;
  situation: string;
}

export async function listCampaigns(connection: Connection): Promise<CampaignSummary[]> {
  const result = (await apiFetch(connection, "/campaigns")) as { campaigns: CampaignSummary[] };
  return result.campaigns;
}

export interface CharacterCreationInput {
  name: string;
  race: string;
  class: string;
  abilityScores: Record<"strength" | "dexterity" | "constitution" | "intelligence" | "wisdom" | "charisma", number>;
}

/** Optional world/tone fields the player can set at creation time (issue #48).
 * Omitted fields keep the standard-fantasy defaults and stay editable later in
 * Settings. */
export interface CampaignCreationSettings {
  worldSetting?: string;
  toneWhimsy?: number;
  contentIntensity?: "standard" | "low";
}

/** Creates a new campaign from a character-creation form (ADR-0010); the
 * server derives the authoritative sheet and returns the new campaign id. */
export async function createCampaign(
  connection: Connection,
  character: CharacterCreationInput,
  settings?: CampaignCreationSettings
): Promise<string> {
  const result = (await apiFetch(connection, "/campaigns", {
    method: "POST",
    body: JSON.stringify(settings ? { character, settings } : { character }),
  })) as { campaignId: string };
  return result.campaignId;
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
  const { status, body } = await apiFetchRaw(connection, `/campaigns/${encodeURIComponent(campaignId)}/turns`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
  // 200 (success) and 502 (engine error) are domain turn results with a
  // { narration, isError } body to render. Any other status — notably the
  // 409 single-flight rejection (issue #31) or a 400 validation error —
  // carries only { error } and is not a turn result; throw it so Play's
  // catch renders the optimistic turn as an error with the server's message.
  if (status !== 200 && status !== 502) {
    throw new ApiError((body as { error?: string }).error ?? `request failed (${status})`);
  }
  return body as TurnResult;
}

/** ADR-0009 on-demand illustration. `ok:false` is a domain result carrying the
 * exact Grok failure reason (returned at HTTP 200), not an exception — so the
 * UI can show *why* nothing was drawn instead of failing silently. */
export interface IllustrateResult {
  ok: boolean;
  relPath?: string;
  error?: string;
  turnIndex?: number;
}

export async function illustrateEntity(
  connection: Connection,
  campaignId: string,
  entityType: "character" | "npc" | "location",
  name: string,
  description: string
): Promise<IllustrateResult> {
  return (await apiFetch(connection, `/campaigns/${encodeURIComponent(campaignId)}/illustrate`, {
    method: "POST",
    body: JSON.stringify({ kind: "entity", entityType, name, description }),
  })) as IllustrateResult;
}

export async function illustrateMoment(
  connection: Connection,
  campaignId: string,
  turnIndex: number
): Promise<IllustrateResult> {
  return (await apiFetch(connection, `/campaigns/${encodeURIComponent(campaignId)}/illustrate`, {
    method: "POST",
    body: JSON.stringify({ kind: "moment", turnIndex }),
  })) as IllustrateResult;
}
