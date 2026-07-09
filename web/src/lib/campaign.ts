import { ApiError, apiFetch, apiFetchRaw } from "./api";
import type { Connection } from "./connection";
import type { MusicOverride } from "./music";
import type { VideoOverride } from "./video";

/** The active campaign id from a ?campaign= query param (kept for shareable
 * links and the e2e harness), or `null` when absent. Issue #97: this used to
 * fall back to the `test-campaign` fixture, which real multi-user accounts don't
 * own — so a fresh load 404'd every campaign-scoped fetch (state, settings). The
 * app now resolves the user's own campaign from GET /campaigns instead (App.tsx),
 * and shows a first-run empty state when they have none. */
export function getCampaignId(): string | null {
  return new URLSearchParams(window.location.search).get("campaign");
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
  /** Issue #118: an on-demand "Animate" clip of the portrait. Distinct from
   * portraitImage so a clip never replaces the still. */
  portraitVideo?: string;
  /** Issue #71: free-text physical description (sex, build, hair, marks). Feeds
   * the character's image prompt so a portrait matches the player's intent. */
  appearance?: string;
  /** Issue #67 (ADR-0015): full-sheet fields. All optional and degrade
   * gracefully — old sheets and DM writes may omit any of them. Derived numbers
   * (proficiency bonus, saves, skills, passive perception, initiative) are NOT
   * stored; compute them via lib/character-derive.ts. */
  speed?: number;
  savingThrowProficiencies?: string[];
  skillProficiencies?: string[];
  expertise?: string[];
  languages?: string[];
  otherProficiencies?: string[];
  featuresAndTraits?: Array<{ name: string; description?: string; source?: string }>;
  background?: string;
  alignment?: string;
  personality?: { traits?: string; ideals?: string; bonds?: string; flaws?: string };
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
  /** Issue #118: an "Animate" action records the moment's clip relative path
   * here; absent on turns never animated. */
  video?: string;
  /** ADR-0030 (#128/#130): the DM-emitted scene caption that drives this
   * moment's image. Read-only on the client — surfaced (#132) so the
   * regenerate box can pre-fill the description that made the current image.
   * Absent on old, pre-caption turns. */
  sceneCaption?: string;
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
  /** ADR-0018: which engine the (re)started session runs on. The server may
   * have auto-corrected the model to fit the provider, so trust this pair. */
  provider: string;
}

/** Mirrors src/campaign-store.ts's CampaignSettings. `model` is included
 * in GET's response (readCampaignSettings always reads/returns it) but
 * per the backend contract §5 it can never be changed via POST here —
 * server.ts's POST /settings handler never even reads a `model` field
 * off the request body. The only way to change it is
 * POST /campaigns/:id/session/start (see startSession above) — that
 * split is real, not a frontend simplification, so CampaignSettingsPatch
 * below deliberately excludes it rather than silently no-opping it.
 * `provider` (ADR-0018) is the peer of `model`: readable here, changeable
 * only via POST /session/start, so it's excluded from the patch type too. */
/** Issue #69: narration length/detail. Absent is treated as "detailed" by the
 * server, so the UI shows "detailed" as the effective value when unset. */
export type ResponseLength = "concise" | "standard" | "detailed";


export interface CampaignSettings {
  model: string;
  /** ADR-0018: which engine runs the DM ("claude" | "grok"). Always present in
   * GET's response; never settable via POST /settings (see startSession). */
  provider: string;
  artStyle?: string;
  worldSetting?: string;
  toneWhimsy?: number;
  contentIntensity?: "standard" | "low";
  responseLength?: ResponseLength;
  generateImages?: boolean;
  /** ADR-0027: which engine draws this game's images ("grok" | "local"). Absent
   * === tracks the account default (→ `.env` → "grok"). Unlike `provider` (the DM
   * engine), it is freely switchable mid-game — no session reset. */
  imageProvider?: "grok" | "local";
  /** ADR-0029: the LOCAL engine's quality tier ("fast" | "standard" | "high") —
   * time-for-quality at a fixed resolution. Absent === tracks the account default
   * (→ `.env` → "standard"). Freely switchable mid-game, like imageProvider. */
  imageQuality?: "fast" | "standard" | "high";
  /** Issue #44: absent === on. When explicitly false, the player supplies
   * their own dice values instead of the engine rolling. */
  autoRollDice?: boolean;
  /** Issue #56: absent === off. When on, the app illustrates every DM response
   * automatically. Only meaningful when generateImages is on. */
  autoIllustrateTurns?: boolean;
  /** Issue #109: a per-game music override. Absent === this game tracks the
   * user's account default (which itself falls back to `.env`). Only the
   * client-safe fields are stored — never Navidrome credentials. */
  music?: MusicOverride;
  /** Issue #118: opt-in toggle that reveals the on-demand "Animate" actions.
   * Absent === off (needs Grok Build configured, like generateImages). */
  generateVideos?: boolean;
  /** Issue #118: a per-game video-params override. Absent === this game tracks
   * the account default (→ `.env` → code default), same model as music. */
  video?: VideoOverride;
}

export type CampaignSettingsPatch = Partial<Omit<CampaignSettings, "model" | "provider">>;

export interface ModelOption {
  id: string;
  label: string;
}

/** ADR-0018: one entry per DM engine, each carrying its own model list + default,
 * as returned by GET /models `providers`. */
export interface ProviderOption {
  id: string;
  label: string;
  models: readonly ModelOption[];
  default: string;
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

/** Issue #71: set (or clear, with "") the player character's free-text
 * appearance on an existing sheet. Returns the stored value (null when cleared). */
export async function setCharacterAppearance(
  connection: Connection,
  campaignId: string,
  appearance: string
): Promise<string | null> {
  const result = (await apiFetch(connection, `/campaigns/${encodeURIComponent(campaignId)}/character/appearance`, {
    method: "POST",
    body: JSON.stringify({ appearance }),
  })) as { appearance: string | null };
  return result.appearance;
}

export async function getModels(
  connection: Connection
): Promise<{ models: ModelOption[]; default: string; providers: ProviderOption[]; defaultProvider: string }> {
  return (await apiFetch(connection, "/models")) as {
    models: ModelOption[];
    default: string;
    providers: ProviderOption[];
    defaultProvider: string;
  };
}

/** Issue #64: the look/play/model settings a new game should pre-fill from —
 * copied server-side from the most recently played campaign. `worldSetting` is
 * never included (each game's premise is typed fresh). Empty object when there's
 * no prior campaign, so the New Chronicle screen falls back to neutral defaults. */
export async function getNewGameDefaults(connection: Connection): Promise<Partial<CampaignSettings>> {
  const result = (await apiFetch(connection, "/new-game-defaults")) as { settings: Partial<CampaignSettings> };
  return result.settings;
}

/** ADR-0019: the signed-in user's *default* settings — the per-user baseline
 * every new campaign inherits (seeded from .env at registration, editable here).
 * Unlike a campaign patch, this accepts model/provider too. */
export async function getUserDefaults(connection: Connection): Promise<Partial<CampaignSettings>> {
  return (await apiFetch(connection, "/me/settings")) as Partial<CampaignSettings>;
}

export async function saveUserDefaults(
  connection: Connection,
  settings: Partial<CampaignSettings>
): Promise<Partial<CampaignSettings>> {
  return (await apiFetch(connection, "/me/settings", {
    method: "POST",
    body: JSON.stringify(settings),
  })) as Partial<CampaignSettings>;
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

/** Issue #105: references to every image across this user's own campaigns, for
 * the new-game loading slideshow. `exclude` skips a campaign (the one being
 * started). Each ref is loaded via the existing per-campaign image route. */
export interface PastImageRef {
  campaignId: string;
  filename: string;
}

export async function listPastImages(connection: Connection, exclude?: string): Promise<PastImageRef[]> {
  const query = exclude ? `?exclude=${encodeURIComponent(exclude)}` : "";
  const result = (await apiFetch(connection, `/past-images${query}`)) as { images: PastImageRef[] };
  return result.images;
}

export interface CharacterCreationInput {
  name: string;
  race: string;
  class: string;
  abilityScores: Record<"strength" | "dexterity" | "constitution" | "intelligence" | "wisdom" | "charisma", number>;
  /** Issue #71: optional free-text physical description captured at creation
   * and fed to the character's image prompt. */
  appearance?: string;
  /** Issue #67 (ADR-0015): class skill picks (exactly the class's choose-count),
   * optional expertise (subset of picks), and authored identity fields. */
  skillProficiencies?: string[];
  expertise?: string[];
  background?: string;
  alignment?: string;
  personality?: { traits?: string; ideals?: string; bonds?: string; flaws?: string };
}

/** Optional world/tone fields the player can set at creation time (issue #48).
 * Omitted fields keep the standard-fantasy defaults and stay editable later in
 * Settings. */
export interface CampaignCreationSettings {
  worldSetting?: string;
  toneWhimsy?: number;
  contentIntensity?: "standard" | "low";
  /** Issue #69: how long/detailed the DM's replies run. Omitted → server
   * default ("detailed"). Inherited from the last game via new-game-defaults. */
  responseLength?: ResponseLength;
  /** Issue #57: the model the new campaign should start on. Omitted keeps the
   * server default (Sonnet). */
  model?: string;
  /** ADR-0018: the DM engine the new campaign should start on ("claude" |
   * "grok"). Omitted keeps the server default (Claude). The server validates
   * that any given `model` belongs to this provider. */
  provider?: string;
  /** Issue #64: look/play defaults, pre-filled on the New Chronicle screen from
   * the most recently played campaign (GET /new-game-defaults) so a new game
   * doesn't revert to images-off. The create screen sends these explicitly;
   * omitted fields keep the server defaults. */
  generateImages?: boolean;
  artStyle?: string;
  autoIllustrateTurns?: boolean;
  autoRollDice?: boolean;
  /** Issue #118: copy-on-create like generateImages (the video *params* are
   * live-tracked from account defaults, so they are not sent here). */
  generateVideos?: boolean;
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

/** Permanently deletes a chronicle (issue #50). The server refuses the tracked
 * test fixture with a 403, which surfaces here as a thrown error. */
export async function deleteCampaign(connection: Connection, campaignId: string): Promise<void> {
  await apiFetch(connection, `/campaigns/${encodeURIComponent(campaignId)}`, { method: "DELETE" });
}

export async function getState(connection: Connection, campaignId: string): Promise<StateSnapshot> {
  return (await apiFetch(connection, `/campaigns/${encodeURIComponent(campaignId)}/state`)) as StateSnapshot;
}

export async function startSession(
  connection: Connection,
  campaignId: string,
  model?: string,
  provider?: string
): Promise<SessionStartResult> {
  const body: { model?: string; provider?: string } = {};
  if (model) body.model = model;
  if (provider) body.provider = provider;
  return (await apiFetch(connection, `/campaigns/${encodeURIComponent(campaignId)}/session/start`, {
    method: "POST",
    body: JSON.stringify(body),
  })) as SessionStartResult;
}

export interface TurnResult {
  narration: string;
  sessionId: string | null;
  model: string;
  isError: boolean;
  /** ADR-0030 (#132): the turn's scene caption when the DM emitted it inline,
   * so a same-session regenerate can pre-fill it without a reload. Absent when
   * the DM omitted it (a later free retry may still backfill it on disk, which
   * the transcript hydration then picks up). */
  sceneCaption?: string;
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

export interface EditTurnResult extends TurnResult {
  turnIndex: number;
  discardedCount: number;
}

/** Issue #68 (ADR-0016): edit a past player message and re-run from there,
 * discarding every turn after it. Like sendTurn, 200/502 are domain results;
 * a 409 (busy, or a turn played before snapshots existed) or 400 throws. For a
 * turn-zero opening pass an empty `message` — the server re-runs the opening. */
export async function editTurn(
  connection: Connection,
  campaignId: string,
  turnIndex: number,
  message: string
): Promise<EditTurnResult> {
  const { status, body } = await apiFetchRaw(
    connection,
    `/campaigns/${encodeURIComponent(campaignId)}/turns/${turnIndex}/edit`,
    { method: "POST", body: JSON.stringify({ message }) }
  );
  if (status !== 200 && status !== 502) {
    throw new ApiError((body as { error?: string }).error ?? `request failed (${status})`);
  }
  return body as EditTurnResult;
}

/** ADR-0013 opening scene (turn-zero). Generates the DM-initiated first beat of
 * a brand-new campaign. Like sendTurn, a 502 engine error comes back as a valid
 * { narration, isError:true } body (a domain result to render), so this uses
 * apiFetchRaw and treats 200/502 as results rather than throwing. `alreadyStarted`
 * is true when the campaign already had an opening (the server is idempotent). */
export interface OpeningResult {
  narration: string;
  sessionId: string | null;
  model: string;
  isError: boolean;
  alreadyStarted?: boolean;
  /** ADR-0030 (#132): the opening scene's caption, when emitted inline. */
  sceneCaption?: string;
}

export async function generateOpening(connection: Connection, campaignId: string): Promise<OpeningResult> {
  const { status, body } = await apiFetchRaw(connection, `/campaigns/${encodeURIComponent(campaignId)}/opening`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  // 200 (success / already-started) and 502 (engine error) both carry a
  // { narration, isError } body to render. Anything else (409 no active
  // session, etc.) is not a domain result — throw so Play shows the fallback.
  if (status !== 200 && status !== 502) {
    throw new ApiError((body as { error?: string }).error ?? `request failed (${status})`);
  }
  return body as OpeningResult;
}

/** ADR-0009 on-demand illustration. `ok:false` is a domain result carrying the
 * exact Grok failure reason (returned at HTTP 200), not an exception — so the
 * UI can show *why* nothing was drawn instead of failing silently. */
export interface IllustrateResult {
  ok: boolean;
  relPath?: string;
  error?: string;
  turnIndex?: number;
  // Issue #142: the DM caption that made this moment's image, echoed back for a
  // "moment" illustrate. Lets the client prefill the regenerate box on a fresh
  // turn whose original response was captionless (the DM omitted [SCENE:] and
  // the server backfilled it after responding). Absent → the box stays blank.
  sceneCaption?: string;
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
  turnIndex: number,
  // Issue #66: an optional prompt override for regenerating a moment's image
  // (e.g. "the same scene, but at dusk"). Omitted → the turn's narration is used.
  description?: string
): Promise<IllustrateResult> {
  return (await apiFetch(connection, `/campaigns/${encodeURIComponent(campaignId)}/illustrate`, {
    method: "POST",
    body: JSON.stringify(description?.trim() ? { kind: "moment", turnIndex, description: description.trim() } : { kind: "moment", turnIndex }),
  })) as IllustrateResult;
}

/** Issue #118: animate a known entity's portrait into a clip. `baseImage` is the
 * entity's current still (from the gallery) — the server feeds it to
 * /imagine-video for consistency; omit for a pure text-to-video clip. */
export async function animateEntity(
  connection: Connection,
  campaignId: string,
  entityType: "character" | "npc" | "location",
  name: string,
  description: string,
  baseImage?: string
): Promise<IllustrateResult> {
  return (await apiFetch(connection, `/campaigns/${encodeURIComponent(campaignId)}/animate`, {
    method: "POST",
    body: JSON.stringify({ kind: "entity", entityType, name, description, baseImage }),
  })) as IllustrateResult;
}

/** Issue #118: animate a specific DM response into a clip. The server uses the
 * moment's own still (if illustrated) as the base; an optional `description`
 * refines the motion prompt (e.g. "slow push in, rain falling"). */
export async function animateMoment(
  connection: Connection,
  campaignId: string,
  turnIndex: number,
  description?: string
): Promise<IllustrateResult> {
  return (await apiFetch(connection, `/campaigns/${encodeURIComponent(campaignId)}/animate`, {
    method: "POST",
    body: JSON.stringify(
      description?.trim() ? { kind: "moment", turnIndex, description: description.trim() } : { kind: "moment", turnIndex }
    ),
  })) as IllustrateResult;
}
