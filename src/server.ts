// Side-effecting import, deliberately first: module-graph evaluation order
// runs an import's own top-level code before the importing module's code,
// so this must load .env before dm-engine.js -> seed-selector.js reads
// process.env.SEED_WILDCARD_CHANCE at its own module scope. A later
// loadDotenv() call in this file's body would run too late for that.
import "dotenv/config";
import { config as loadDotenv } from "dotenv";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openingDirective, modelsMatch } from "./dm-engine.js";
import { getBackend } from "./backends/index.js";
import {
  resolveCampaignDir,
  readPersistedSessionId,
  persistSessionId,
  resolveSessionLog,
  readStateSnapshot,
  appendTurnTranscript,
  readTurnTranscript,
  setTranscriptRecordImage,
  recordEntityImage,
  setCharacterAppearance,
  writePreTurnSnapshot,
  hasPreTurnSnapshot,
  restorePreTurnSnapshot,
  truncateTranscript,
  pruneSnapshotsAfter,
  readCampaignModel,
  persistCampaignModel,
  readCampaignProvider,
  persistCampaignProvider,
  readCampaignSettings,
  persistCampaignSettings,
  newGameDefaultSettings,
  scaffoldCampaign,
  deleteCampaign,
  listCampaigns,
  userCampaignsRoot,
  CONTENT_INTENSITIES,
  RESPONSE_LENGTHS,
  isValidModelId,
  isValidProviderId,
  isModelValidForProvider,
  defaultModelForProvider,
  MODEL_OPTIONS,
  PROVIDERS,
  DEFAULT_MODEL,
  InvalidCampaignIdError,
  CampaignNotFoundError,
  CampaignExistsError,
  CampaignProtectedError,
  type ContentIntensity,
  type ResponseLength,
  type CampaignSettings,
  type ProviderId,
  type ModelId,
} from "./campaign-store.js";
import { generateImage } from "./image-generator.js";
import {
  buildCharacterSheet,
  deriveCampaignId,
  CharacterValidationError,
  MAX_APPEARANCE_CHARS,
} from "./character-gen.js";
import {
  createUser,
  verifyLogin,
  createSession,
  resolveSession,
  deleteSession,
  readAccount,
  readUserSettings,
  writeUserSettings,
  InvalidUsernameError,
  UsernameTakenError,
  InvalidCredentialsError,
} from "./user-store.js";
import { Readable } from "node:stream";
import {
  listLocalTracks,
  resolveLocalTrack,
  resolveMusicConfig,
  navidromeCreds,
  navidromePlaylistTracks,
  navidromeStreamUrl,
  MUSIC_CONTENT_TYPES,
  type UserMusic,
  type MusicSource,
} from "./music-store.js";

const dotenvResult = loadDotenv();
if (dotenvResult.error) {
  console.log("No .env file found — reading config from shell environment only.");
} else {
  console.log(`Loaded .env from ${process.cwd()} (${Object.keys(dotenvResult.parsed ?? {}).length} vars).`);
}

const PORT = process.env.PORT ? Number(process.env.PORT) : 4317;
// Per ADR-0003: default stays localhost-only. Set HOST to the machine's
// LAN IP (or 0.0.0.0 to bind all interfaces) to serve other LAN devices —
// this is a deliberate opt-in, not automatic, since it changes the trust
// boundary from "this machine only" to "this household's network."
const HOST = process.env.HOST ?? "127.0.0.1";

// ADR-0019: auth is now per-user accounts, not one household secret. The same
// `X-Chronicle-Token` header now carries a per-user *session token* (issued by
// POST /auth/login|register), which the dispatcher resolves to a user id. The
// header name is unchanged so CORS and the client transport didn't have to move.
const AUTH_HEADER = "x-chronicle-token";

/** ADR-0019: the default settings a brand-new user's account inherits, read
 * from `.env` (see .env.example). Only well-formed values are included; anything
 * unset or invalid is simply omitted, so the user falls back to the same code
 * defaults an absent field always had. These seed the user's settings.json at
 * registration and, through it, every campaign they create. */
function newUserDefaultSettings(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const model = process.env.DEFAULT_MODEL;
  if (model && isValidModelId(model)) out.model = model;
  const provider = process.env.DEFAULT_PROVIDER;
  if (provider && isValidProviderId(provider)) out.provider = provider;
  const artStyle = process.env.DEFAULT_ART_STYLE?.trim();
  if (artStyle) out.artStyle = artStyle;
  const worldSetting = process.env.DEFAULT_WORLD_SETTING?.trim();
  if (worldSetting) out.worldSetting = worldSetting;
  const tone = process.env.DEFAULT_TONE_WHIMSY;
  if (tone !== undefined && tone !== "") {
    const n = Number(tone);
    if (Number.isFinite(n) && n >= 0 && n <= 1) out.toneWhimsy = n;
  }
  const intensity = process.env.DEFAULT_CONTENT_INTENSITY;
  if (intensity && CONTENT_INTENSITIES.includes(intensity as ContentIntensity)) {
    out.contentIntensity = intensity;
  }
  const length = process.env.DEFAULT_RESPONSE_LENGTH;
  if (length && RESPONSE_LENGTHS.includes(length as ResponseLength)) {
    out.responseLength = length;
  }
  const boolEnv = (v: string | undefined): boolean | undefined =>
    v === "true" ? true : v === "false" ? false : undefined;
  const genImages = boolEnv(process.env.DEFAULT_GENERATE_IMAGES);
  if (genImages !== undefined) out.generateImages = genImages;
  const autoRoll = boolEnv(process.env.DEFAULT_AUTO_ROLL_DICE);
  if (autoRoll !== undefined) out.autoRollDice = autoRoll;
  const autoIllustrate = boolEnv(process.env.DEFAULT_AUTO_ILLUSTRATE);
  if (autoIllustrate !== undefined) out.autoIllustrateTurns = autoIllustrate;
  return out;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROOT = path.resolve(__dirname, "../public");

interface ActiveSession {
  sessionId: string | undefined;
  sessionLogPath: string;
  model: string;
  // Issue #57: the model the current Agent SDK `sessionId` was created under.
  // When it diverges from `model` (the player switched models mid-campaign),
  // resuming that SDK session would keep running the *original* model — the SDK
  // pins a resumed session to its own model. So when they differ we start a
  // fresh SDK session instead of resuming, which is safe here because Chronicle
  // is file-backed by design (ADR-0001): campaign state lives in files, not the
  // SDK's conversation history, so dropping the session loses nothing that
  // matters and is the correct trade for honoring the model choice.
  sessionModel?: string;
  // ADR-0018: which engine runs this campaign's DM (Claude vs Grok), and the
  // provider the persisted session was created under. A Claude session id is
  // meaningless to Grok and vice-versa, so a provider switch — like a model
  // switch (#57) — must start a fresh session rather than resume.
  provider: ProviderId;
  sessionProvider?: ProviderId;
  // Per issue #31: single-flight marker. Two turns submitted concurrently
  // for the same campaign (two tabs, a cross-tab double-submit the in-page
  // `sending` guard can't see) would otherwise both run `runTurn` in
  // parallel and race on the same state files, silently clobbering one
  // turn's edits. Set true for the duration of a turn, cleared in a finally.
  busy?: boolean;
}

// In-memory only: which campaign's Agent SDK session/log is "active" for
// this server process. ADR-0019: keyed by `${userId}/${campaignId}` so two
// users whose campaigns share an id can't collide on the same active session.
const activeSessions = new Map<string, ActiveSession>();

/** The activeSessions key for a user's campaign (ADR-0019). */
function sessionKey(userId: string, campaignId: string): string {
  return `${userId}/${campaignId}`;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/** ADR-0019: validate a user's *default* settings patch (POST /me/settings).
 * Unlike a campaign's POST /settings, this accepts `model` and `provider` too,
 * because a user's defaults seed a new campaign's model/provider. Returns the
 * validated subset, or an error string. Only provided fields are validated. */
function parseDefaultSettings(
  body: Record<string, unknown>
): { value: Record<string, unknown> } | { error: string } {
  const out: Record<string, unknown> = {};
  if (body.model !== undefined) {
    if (typeof body.model !== "string" || !isValidModelId(body.model)) {
      return { error: `invalid model — must be one of ${MODEL_OPTIONS.map((m) => m.id).join(", ")}` };
    }
    out.model = body.model;
  }
  if (body.provider !== undefined) {
    if (typeof body.provider !== "string" || !isValidProviderId(body.provider)) {
      return { error: `invalid provider — must be one of ${PROVIDERS.map((p) => p.id).join(", ")}` };
    }
    out.provider = body.provider;
  }
  if (out.provider && out.model && !isModelValidForProvider(out.provider as ProviderId, out.model as string)) {
    return { error: `model '${out.model}' is not a ${out.provider} model` };
  }
  if (body.artStyle !== undefined) {
    if (typeof body.artStyle !== "string") return { error: "artStyle must be a string" };
    out.artStyle = body.artStyle;
  }
  if (body.worldSetting !== undefined) {
    if (typeof body.worldSetting !== "string") return { error: "worldSetting must be a string" };
    out.worldSetting = body.worldSetting;
  }
  if (body.toneWhimsy !== undefined) {
    if (typeof body.toneWhimsy !== "number" || body.toneWhimsy < 0 || body.toneWhimsy > 1) {
      return { error: "toneWhimsy must be a number between 0 and 1" };
    }
    out.toneWhimsy = body.toneWhimsy;
  }
  if (body.contentIntensity !== undefined) {
    if (
      typeof body.contentIntensity !== "string" ||
      !CONTENT_INTENSITIES.includes(body.contentIntensity as ContentIntensity)
    ) {
      return { error: `contentIntensity must be one of ${CONTENT_INTENSITIES.join(", ")}` };
    }
    out.contentIntensity = body.contentIntensity;
  }
  if (body.responseLength !== undefined) {
    if (
      typeof body.responseLength !== "string" ||
      !RESPONSE_LENGTHS.includes(body.responseLength as ResponseLength)
    ) {
      return { error: `responseLength must be one of ${RESPONSE_LENGTHS.join(", ")}` };
    }
    out.responseLength = body.responseLength;
  }
  for (const key of ["generateImages", "autoRollDice", "autoIllustrateTurns"] as const) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== "boolean") return { error: `${key} must be a boolean` };
      out[key] = body[key];
    }
  }
  // ADR-0020: music is a per-user preference stored under a `music` key. The
  // Navidrome credentials are deliberately NOT accepted here — they stay
  // server-side in .env; a user may only override the URL/playlist.
  if (body.music !== undefined) {
    if (typeof body.music !== "object" || body.music === null) return { error: "music must be an object" };
    const m = body.music as Record<string, unknown>;
    const music: UserMusic = {};
    if (m.enabled !== undefined) {
      if (typeof m.enabled !== "boolean") return { error: "music.enabled must be a boolean" };
      music.enabled = m.enabled;
    }
    if (m.source !== undefined) {
      if (m.source !== "local" && m.source !== "navidrome") return { error: "music.source must be 'local' or 'navidrome'" };
      music.source = m.source as MusicSource;
    }
    if (m.navidromeUrl !== undefined) {
      if (typeof m.navidromeUrl !== "string") return { error: "music.navidromeUrl must be a string" };
      music.navidromeUrl = m.navidromeUrl;
    }
    if (m.navidromePlaylist !== undefined) {
      if (typeof m.navidromePlaylist !== "string") return { error: "music.navidromePlaylist must be a string" };
      music.navidromePlaylist = m.navidromePlaylist;
    }
    out.music = music;
  }
  return { value: out };
}

/** Read a user's stored music override off their account settings. */
function userMusic(userId: string): UserMusic {
  const m = readUserSettings(userId).music;
  return m && typeof m === "object" ? (m as UserMusic) : {};
}

/** Stream a local file with HTTP Range support (seeking). Mirrors the campaign
 * image route's content-type discipline, plus 206/Content-Range for audio. */
function streamLocalFile(req: IncomingMessage, res: ServerResponse, absPath: string): void {
  const stat = fs.statSync(absPath);
  const type = MUSIC_CONTENT_TYPES[path.extname(absPath).toLowerCase()] ?? "application/octet-stream";
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (start <= end && end < stat.size) {
        res.writeHead(206, {
          "Content-Type": type,
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": end - start + 1,
        });
        fs.createReadStream(absPath, { start, end }).pipe(res);
        return;
      }
    }
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": stat.size, "Accept-Ranges": "bytes" });
  fs.createReadStream(absPath).pipe(res);
}

const ROUTES: Array<{
  method: string;
  pattern: RegExp;
  /** ADR-0019: when true, this route is reachable without a valid session token
   * (registration + login, which issue tokens). Every other route requires one,
   * and the dispatcher passes the resolved user id to the handler. */
  public?: boolean;
  handler: (
    req: IncomingMessage,
    res: ServerResponse,
    params: string[],
    userId: string
  ) => Promise<void>;
}> = [
  // ── ADR-0019: auth ──────────────────────────────────────────────────────
  {
    method: "POST",
    pattern: /^\/auth\/register$/,
    public: true,
    async handler(req, res) {
      const body = (await readJsonBody(req)) as { username?: unknown; password?: unknown };
      if (typeof body.username !== "string" || typeof body.password !== "string") {
        sendJson(res, 400, { error: "username and password are required" });
        return;
      }
      try {
        const user = createUser(body.username, body.password, newUserDefaultSettings());
        const token = createSession(user.id);
        sendJson(res, 201, { token, username: user.username });
      } catch (err) {
        if (err instanceof UsernameTakenError) {
          sendJson(res, 409, { error: err.message });
        } else if (err instanceof InvalidUsernameError || err instanceof InvalidCredentialsError) {
          sendJson(res, 400, { error: err.message });
        } else {
          throw err;
        }
      }
    },
  },
  {
    method: "POST",
    pattern: /^\/auth\/login$/,
    public: true,
    async handler(req, res) {
      const body = (await readJsonBody(req)) as { username?: unknown; password?: unknown };
      if (typeof body.username !== "string" || typeof body.password !== "string") {
        sendJson(res, 400, { error: "username and password are required" });
        return;
      }
      const user = verifyLogin(body.username, body.password);
      if (!user) {
        sendJson(res, 401, { error: "incorrect username or password" });
        return;
      }
      const token = createSession(user.id);
      sendJson(res, 200, { token, username: user.username });
    },
  },
  {
    method: "POST",
    pattern: /^\/auth\/logout$/,
    async handler(req, res) {
      deleteSession(req.headers[AUTH_HEADER] as string | undefined);
      sendJson(res, 200, { ok: true });
    },
  },
  {
    method: "GET",
    pattern: /^\/auth\/me$/,
    async handler(_req, res, _params, userId) {
      const account = readAccount(userId);
      sendJson(res, 200, { username: account?.username ?? userId });
    },
  },
  {
    // ADR-0019: the user's *default* settings — the seed for every new campaign
    // (per-user defaults, overridable per game). Same field family as a
    // campaign's settings.
    method: "GET",
    pattern: /^\/me\/settings$/,
    async handler(_req, res, _params, userId) {
      sendJson(res, 200, readUserSettings(userId));
    },
  },
  {
    method: "POST",
    pattern: /^\/me\/settings$/,
    async handler(req, res, _params, userId) {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const parsed = parseDefaultSettings(body);
      if ("error" in parsed) {
        sendJson(res, 400, { error: parsed.error });
        return;
      }
      sendJson(res, 200, writeUserSettings(userId, parsed.value));
    },
  },
  // ── ADR-0020: music ─────────────────────────────────────────────────────
  {
    // The user's effective music config (no credentials) + whether local files
    // are present, so the client knows what it can play.
    method: "GET",
    pattern: /^\/music\/config$/,
    async handler(_req, res, _params, userId) {
      const config = resolveMusicConfig(userMusic(userId));
      sendJson(res, 200, { ...config, localTrackCount: listLocalTracks().length });
    },
  },
  {
    method: "GET",
    pattern: /^\/music\/local\/tracks$/,
    async handler(_req, res) {
      sendJson(res, 200, { tracks: listLocalTracks() });
    },
  },
  {
    // Streams one local file (auth via ?token= so an <audio> tag can load it).
    method: "GET",
    pattern: /^\/music\/local\/track$/,
    async handler(req, res) {
      const rel = new URL(req.url ?? "", `http://localhost:${PORT}`).searchParams.get("path") ?? "";
      const abs = resolveLocalTrack(rel);
      if (!abs) {
        sendJson(res, 404, { error: "track not found" });
        return;
      }
      streamLocalFile(req, res, abs);
    },
  },
  {
    method: "GET",
    pattern: /^\/music\/navidrome\/playlist$/,
    async handler(_req, res, _params, userId) {
      const creds = navidromeCreds(resolveMusicConfig(userMusic(userId)));
      if (!creds) {
        sendJson(res, 400, { error: "Navidrome is not configured — set NAVIDROME_URL/USER/PASSWORD in .env" });
        return;
      }
      try {
        sendJson(res, 200, { tracks: await navidromePlaylistTracks(creds) });
      } catch (err) {
        sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
      }
    },
  },
  {
    // Proxies one Navidrome track stream (auth via ?token=). Creds never reach
    // the browser; the Range header is forwarded so seeking works.
    method: "GET",
    pattern: /^\/music\/navidrome\/stream$/,
    async handler(req, res, _params, userId) {
      const songId = new URL(req.url ?? "", `http://localhost:${PORT}`).searchParams.get("id") ?? "";
      const creds = navidromeCreds(resolveMusicConfig(userMusic(userId)));
      if (!creds || !songId) {
        sendJson(res, 400, { error: "Navidrome not configured, or missing track id" });
        return;
      }
      try {
        const upstream = await fetch(navidromeStreamUrl(creds, songId), {
          headers: req.headers.range ? { Range: req.headers.range } : {},
        });
        if (!upstream.ok || !upstream.body) {
          sendJson(res, 502, { error: `Navidrome stream failed (${upstream.status})` });
          return;
        }
        const headers: Record<string, string> = {
          "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg",
          "Accept-Ranges": "bytes",
        };
        for (const h of ["content-length", "content-range"]) {
          const v = upstream.headers.get(h);
          if (v) headers[h] = v;
        }
        res.writeHead(upstream.status, headers);
        Readable.fromWeb(upstream.body as any).pipe(res);
      } catch (err) {
        sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
      }
    },
  },
  {
    method: "GET",
    pattern: /^\/models$/,
    async handler(_req, res) {
      // ADR-0018: `providers` carries the per-provider model lists + defaults for
      // the provider toggle. `models`/`default` kept flat for backward compat.
      sendJson(res, 200, {
        models: MODEL_OPTIONS,
        default: "claude-sonnet-5",
        providers: PROVIDERS,
        defaultProvider: "claude",
      });
    },
  },
  {
    // Issue #64: the look/play/model defaults a NEW game should start from —
    // copied server-side from the most recently played campaign so the New
    // Chronicle screen pre-fills to the player's usual settings instead of the
    // raw scaffold defaults. Top-level path (not /campaigns/...) so it can't be
    // shadowed by the /campaigns/:id matcher below. `{}` when no campaign exists.
    method: "GET",
    pattern: /^\/new-game-defaults$/,
    async handler(_req, res, _params, userId) {
      // ADR-0019: base is the user's account defaults (seeded from .env at
      // registration); the most recently played campaign's settings overlay them
      // (ADR-0014) so an active player's latest tweaks carry into the next game.
      const settings = { ...readUserSettings(userId), ...newGameDefaultSettings(userId) };
      sendJson(res, 200, { settings });
    },
  },
  {
    // ADR-0010 / ADR-0019: list this user's own campaigns for Home's picker.
    method: "GET",
    pattern: /^\/campaigns$/,
    async handler(_req, res, _params, userId) {
      sendJson(res, 200, { campaigns: listCampaigns(userId) });
    },
  },
  {
    // ADR-0010: create a new campaign from a character-creation form. The
    // character sheet is derived server-side (buildCharacterSheet) so HP/AC
    // are authoritative, not trusted from the client.
    method: "POST",
    pattern: /^\/campaigns$/,
    async handler(req, res, _params, userId) {
      const body = (await readJsonBody(req)) as { character?: unknown; settings?: unknown };
      let sheet: Record<string, unknown>;
      try {
        sheet = buildCharacterSheet(body.character as never);
      } catch (err) {
        if (err instanceof CharacterValidationError) {
          sendJson(res, 400, { error: err.message });
          return;
        }
        throw err;
      }

      // Issue #48: the world can now be described at creation, not only later
      // in Settings. Same fields and validation as POST /settings; anything
      // omitted keeps the standard-fantasy defaults.
      const creation = (body.settings ?? {}) as Record<string, unknown>;
      const creationSettings: Partial<CampaignSettings> = {};
      // Issue #57: a new game can carry the player's chosen model, so it starts
      // on that model instead of always defaulting to Sonnet. (POST /settings
      // still can't change model on an existing campaign — that path is
      // session/start; this is only the create-time seed.)
      if (creation.model !== undefined) {
        if (typeof creation.model !== "string" || !isValidModelId(creation.model)) {
          sendJson(res, 400, {
            error: `invalid model — must be one of ${MODEL_OPTIONS.map((m) => m.id).join(", ")}`,
          });
          return;
        }
        creationSettings.model = creation.model;
      }
      // ADR-0018: a new game can pick its DM engine (Claude/Grok). Validate the
      // provider, and if a model is also given, that it belongs to that provider.
      if (creation.provider !== undefined) {
        if (typeof creation.provider !== "string" || !isValidProviderId(creation.provider)) {
          sendJson(res, 400, {
            error: `invalid provider — must be one of ${PROVIDERS.map((p) => p.id).join(", ")}`,
          });
          return;
        }
        if (creationSettings.model && !isModelValidForProvider(creation.provider, creationSettings.model)) {
          sendJson(res, 400, {
            error: `model '${creationSettings.model}' is not a ${creation.provider} model`,
          });
          return;
        }
        creationSettings.provider = creation.provider;
      }
      if (creation.worldSetting !== undefined) {
        if (typeof creation.worldSetting !== "string") {
          sendJson(res, 400, { error: "worldSetting must be a string" });
          return;
        }
        creationSettings.worldSetting = creation.worldSetting;
      }
      if (creation.toneWhimsy !== undefined) {
        if (typeof creation.toneWhimsy !== "number" || creation.toneWhimsy < 0 || creation.toneWhimsy > 1) {
          sendJson(res, 400, { error: "toneWhimsy must be a number between 0 and 1" });
          return;
        }
        creationSettings.toneWhimsy = creation.toneWhimsy;
      }
      if (creation.contentIntensity !== undefined) {
        if (
          typeof creation.contentIntensity !== "string" ||
          !CONTENT_INTENSITIES.includes(creation.contentIntensity as ContentIntensity)
        ) {
          sendJson(res, 400, { error: `contentIntensity must be one of ${CONTENT_INTENSITIES.join(", ")}` });
          return;
        }
        creationSettings.contentIntensity = creation.contentIntensity as ContentIntensity;
      }
      if (creation.responseLength !== undefined) {
        if (
          typeof creation.responseLength !== "string" ||
          !RESPONSE_LENGTHS.includes(creation.responseLength as ResponseLength)
        ) {
          sendJson(res, 400, { error: `responseLength must be one of ${RESPONSE_LENGTHS.join(", ")}` });
          return;
        }
        creationSettings.responseLength = creation.responseLength as ResponseLength;
      }
      // Issue #60: a new game also carries the player's remembered look/play
      // defaults (generateImages/artStyle/autoIllustrateTurns/autoRollDice) so
      // it doesn't revert to images-off. Same validation as POST /settings;
      // these merge via persistCampaignSettings below.
      if (creation.generateImages !== undefined) {
        if (typeof creation.generateImages !== "boolean") {
          sendJson(res, 400, { error: "generateImages must be a boolean" });
          return;
        }
        creationSettings.generateImages = creation.generateImages;
      }
      if (creation.artStyle !== undefined) {
        if (typeof creation.artStyle !== "string") {
          sendJson(res, 400, { error: "artStyle must be a string" });
          return;
        }
        creationSettings.artStyle = creation.artStyle;
      }
      if (creation.autoIllustrateTurns !== undefined) {
        if (typeof creation.autoIllustrateTurns !== "boolean") {
          sendJson(res, 400, { error: "autoIllustrateTurns must be a boolean" });
          return;
        }
        creationSettings.autoIllustrateTurns = creation.autoIllustrateTurns;
      }
      if (creation.autoRollDice !== undefined) {
        if (typeof creation.autoRollDice !== "boolean") {
          sendJson(res, 400, { error: "autoRollDice must be a boolean" });
          return;
        }
        creationSettings.autoRollDice = creation.autoRollDice;
      }

      const campaignId = deriveCampaignId(String(sheet.name), (id) =>
        fs.existsSync(path.join(userCampaignsRoot(userId), id))
      );
      // ADR-0019: seed the new campaign from the user's account defaults, then
      // let the explicit create-form settings (below) override. The client's
      // form is itself pre-filled from those defaults, so this is the robust
      // floor even if the form omits a field.
      const dir = scaffoldCampaign(userId, campaignId, sheet, {
        model: DEFAULT_MODEL,
        autoRollDice: true,
        ...readUserSettings(userId),
      });
      // Model and provider are persisted via their own merge-writes (both are
      // excluded from the POST /settings update type); the world fields go
      // through persistCampaignSettings. Split them out so all are seeded at
      // create.
      const { model: creationModel, provider: creationProvider, ...worldSettings } = creationSettings;
      if (creationModel) {
        persistCampaignModel(dir, creationModel);
      }
      if (creationProvider) {
        persistCampaignProvider(dir, creationProvider);
      }
      if (Object.keys(worldSettings).length > 0) {
        persistCampaignSettings(dir, worldSettings);
      }
      sendJson(res, 201, { campaignId });
    },
  },
  {
    // Issue #50: permanently delete a chronicle. deleteCampaign guards the id
    // (must resolve inside campaigns/) and refuses the tracked fixtures; drop
    // any in-memory session so a later request can't resurrect it.
    method: "DELETE",
    pattern: /^\/campaigns\/([^/]+)$/,
    async handler(_req, res, [campaignId], userId) {
      deleteCampaign(userId, campaignId);
      activeSessions.delete(sessionKey(userId, campaignId));
      sendJson(res, 200, { deleted: campaignId });
    },
  },
  {
    method: "POST",
    pattern: /^\/campaigns\/([^/]+)\/session\/start$/,
    async handler(req, res, [campaignId], userId) {
      const campaignDir = resolveCampaignDir(userId, campaignId);

      const body = await readJsonBody(req);
      const requestedModel = (body as { model?: unknown }).model;
      const requestedProvider = (body as { provider?: unknown }).provider;
      // What the campaign was running under before this call — i.e. what any
      // persisted session was created with (#57, ADR-0018).
      const priorModel = readCampaignModel(campaignDir);
      const priorProvider = readCampaignProvider(campaignDir);

      // Resolve the provider first — it constrains which models are valid.
      let provider: ProviderId;
      if (requestedProvider !== undefined) {
        if (typeof requestedProvider !== "string" || !isValidProviderId(requestedProvider)) {
          sendJson(res, 400, {
            error: `invalid provider — must be one of ${PROVIDERS.map((p) => p.id).join(", ")}`,
          });
          return;
        }
        provider = requestedProvider;
      } else {
        provider = priorProvider;
      }

      let model: ModelId;
      if (requestedModel !== undefined) {
        if (typeof requestedModel !== "string" || !isValidModelId(requestedModel)) {
          sendJson(res, 400, {
            error: `invalid model — must be one of ${MODEL_OPTIONS.map((m) => m.id).join(", ")}`,
          });
          return;
        }
        if (!isModelValidForProvider(provider, requestedModel)) {
          sendJson(res, 400, { error: `model '${requestedModel}' is not a ${provider} model` });
          return;
        }
        model = requestedModel;
      } else if (isModelValidForProvider(provider, priorModel)) {
        // Keep the stored model when it belongs to the (possibly newly chosen)
        // provider.
        model = priorModel;
      } else {
        // Provider switched and the stored model belongs to the old provider —
        // fall back to the new provider's default rather than run an invalid pair.
        model = defaultModelForProvider(provider);
      }

      if (model !== priorModel) persistCampaignModel(campaignDir, model);
      if (provider !== priorProvider) persistCampaignProvider(campaignDir, provider);

      const persisted = readPersistedSessionId(campaignDir);
      const sessionLogPath = resolveSessionLog(campaignDir, Boolean(persisted));
      // sessionModel/sessionProvider = what the persisted session ran under. If
      // the player switched either, the first turn starts a fresh session rather
      // than resume the old one (#57, ADR-0018).
      activeSessions.set(sessionKey(userId, campaignId), {
        sessionId: persisted,
        sessionLogPath,
        model,
        sessionModel: priorModel,
        provider,
        sessionProvider: priorProvider,
      });
      sendJson(res, 200, {
        campaignId,
        sessionId: persisted ?? null,
        resumed: Boolean(persisted),
        sessionLogPath,
        model,
        provider,
      });
    },
  },
  {
    method: "POST",
    pattern: /^\/campaigns\/([^/]+)\/turns$/,
    async handler(req, res, [campaignId], userId) {
      const campaignDir = resolveCampaignDir(userId, campaignId);
      const active = activeSessions.get(sessionKey(userId, campaignId));
      if (!active) {
        sendJson(res, 409, {
          error: `no active session for campaign '${campaignId}' — call POST /campaigns/${campaignId}/session/start first`,
        });
        return;
      }

      const body = await readJsonBody(req);
      const message = (body as { message?: unknown }).message;
      if (typeof message !== "string" || message.trim() === "") {
        sendJson(res, 400, { error: "request body must include a non-empty string 'message'" });
        return;
      }

      // Per issue #31: reject a second turn while one is already in flight
      // for this campaign, rather than letting two `runTurn` calls race on
      // the same state files. Same 409 + { error } convention as above.
      if (active.busy) {
        sendJson(res, 409, {
          error: `a turn is already in progress for campaign '${campaignId}' — wait for it to finish before submitting another`,
        });
        return;
      }
      active.busy = true;

      try {
        console.log(`[${campaignId}] turn on model ${active.model}`);
        // Issue #68 (ADR-0016): snapshot state BEFORE this turn runs, so it can
        // later be edited and re-run from exactly this point.
        writePreTurnSnapshot(
          campaignDir,
          active.sessionLogPath,
          readTurnTranscript(campaignDir, active.sessionLogPath).length
        );
        const settings = readCampaignSettings(campaignDir);
        // Issue #57: only resume the SDK session when it was created under the
        // same model. If the player switched models mid-campaign, resuming would
        // keep running the old model, so we drop `resume` and start fresh.
        // Resume only when BOTH the model and the provider still match what the
        // persisted session was created under (#57, ADR-0018) — a session id is
        // not portable across providers or models.
        const resumeSessionId =
          active.sessionId &&
          active.sessionModel === active.model &&
          active.sessionProvider === active.provider
            ? active.sessionId
            : undefined;
        // ADR-0018: dispatch through the campaign's chosen provider backend.
        const result = await getBackend(active.provider).runTurn({
          campaignDir,
          sessionLogPath: active.sessionLogPath,
          userInput: message,
          resumeSessionId,
          model: active.model,
          settings,
          onText: () => {},
        });

        if (result.sessionId) {
          active.sessionId = result.sessionId;
          active.sessionModel = active.model;
          persistSessionId(campaignDir, result.sessionId);
        }
        if (!modelsMatch(result.requestedModel, result.model)) {
          console.warn(
            `[${campaignId}] model NOT obeyed: requested ${result.requestedModel}, ran ${result.model}`
          );
        }

        // Per ADR-0007: the deterministic speaker-attribution record, written
        // here (not inferred from prose afterward) at the one point both
        // strings are already in hand — for every turn, error or not.
        appendTurnTranscript(campaignDir, active.sessionLogPath, message, result.text);

        sendJson(res, result.isError ? 502 : 200, {
          narration: result.text,
          sessionId: result.sessionId ?? null,
          model: result.model,
          isError: result.isError,
        });
      } finally {
        // Always clear the single-flight lock — on success, on a 502 engine
        // error, and on a thrown exception (which propagates to the top-level
        // catch → 500). The lock must never stick.
        active.busy = false;
      }
    },
  },
  {
    // ADR-0013: generate a new campaign's opening scene (turn-zero). This is
    // DM-initiated — no player message — so it has its own route rather than
    // going through /turns (whose non-empty-message guard would reject it).
    // Idempotent: if the campaign already has any turns, it returns the latest
    // one with { alreadyStarted: true } instead of writing a second opening,
    // so a page reload or double client fire can't duplicate it.
    method: "POST",
    pattern: /^\/campaigns\/([^/]+)\/opening$/,
    async handler(_req, res, [campaignId], userId) {
      const campaignDir = resolveCampaignDir(userId, campaignId);
      const active = activeSessions.get(sessionKey(userId, campaignId));
      if (!active) {
        sendJson(res, 409, {
          error: `no active session for campaign '${campaignId}' — call POST /campaigns/${campaignId}/session/start first`,
        });
        return;
      }

      // Already started? Hand back the existing opening instead of generating
      // another. Reuse the same log the turns/state paths use so the count is
      // consistent with what Play renders.
      const existing = readTurnTranscript(campaignDir, active.sessionLogPath);
      if (existing.length > 0) {
        sendJson(res, 200, {
          narration: existing[0].narration,
          sessionId: active.sessionId ?? null,
          model: active.model,
          isError: false,
          alreadyStarted: true,
        });
        return;
      }

      if (active.busy) {
        sendJson(res, 409, {
          error: `a turn is already in progress for campaign '${campaignId}' — wait for it to finish before submitting another`,
        });
        return;
      }
      active.busy = true;

      try {
        console.log(`[${campaignId}] opening scene on model ${active.model}`);
        // Issue #68 (ADR-0016): snapshot the blank pre-opening state (turn 0).
        writePreTurnSnapshot(campaignDir, active.sessionLogPath, 0);
        const settings = readCampaignSettings(campaignDir);
        const result = await getBackend(active.provider).runTurn({
          campaignDir,
          sessionLogPath: active.sessionLogPath,
          userInput: openingDirective(campaignDir),
          resumeSessionId:
            active.sessionModel === active.model && active.sessionProvider === active.provider
              ? active.sessionId
              : undefined,
          model: active.model,
          settings,
          onText: () => {},
        });

        if (result.sessionId) {
          active.sessionId = result.sessionId;
          active.sessionModel = active.model;
          persistSessionId(campaignDir, result.sessionId);
        }

        // Turn-zero: empty playerMessage marks a DM-initiated turn (ADR-0013).
        // On an engine error, don't persist a broken opening — leave the
        // campaign at zero turns so the next enter-Play retries it cleanly.
        if (!result.isError) {
          appendTurnTranscript(campaignDir, active.sessionLogPath, "", result.text);
        }

        sendJson(res, result.isError ? 502 : 200, {
          narration: result.text,
          sessionId: result.sessionId ?? null,
          model: result.model,
          isError: result.isError,
        });
      } finally {
        active.busy = false;
      }
    },
  },
  {
    // Issue #68 (ADR-0016): edit a past player message and re-run from there,
    // discarding every turn after it. Restores the pre-turn snapshot (rewinding
    // the state files + prose log), truncates the transcript, and re-runs on a
    // FRESH SDK session — the SDK conversation is linear and files are the
    // source of truth (ADR-0001), so a fresh session loses no state.
    method: "POST",
    pattern: /^\/campaigns\/([^/]+)\/turns\/(\d+)\/edit$/,
    async handler(req, res, [campaignId, turnIndexStr], userId) {
      const campaignDir = resolveCampaignDir(userId, campaignId);
      const active = activeSessions.get(sessionKey(userId, campaignId));
      if (!active) {
        sendJson(res, 409, {
          error: `no active session for campaign '${campaignId}' — start one before editing a turn`,
        });
        return;
      }

      const turnIndex = Number(turnIndexStr);
      const transcript = readTurnTranscript(campaignDir, active.sessionLogPath);
      if (!Number.isInteger(turnIndex) || turnIndex < 0 || turnIndex >= transcript.length) {
        sendJson(res, 400, { error: `turnIndex must be an integer in [0, ${transcript.length - 1}]` });
        return;
      }
      // Turn-zero opening has an empty playerMessage (ADR-0013) — re-run the
      // opening directive rather than requiring a player message.
      const isOpening = turnIndex === 0 && transcript[0].playerMessage === "";
      const body = (await readJsonBody(req)) as { message?: unknown };
      const message = body.message;
      if (!isOpening && (typeof message !== "string" || message.trim() === "")) {
        sendJson(res, 400, { error: "request body must include a non-empty string 'message'" });
        return;
      }

      if (active.busy) {
        sendJson(res, 409, {
          error: `a turn is already in progress for campaign '${campaignId}' — wait for it to finish`,
        });
        return;
      }
      // Snapshots only exist for turns played after this feature shipped.
      if (!hasPreTurnSnapshot(campaignDir, active.sessionLogPath, turnIndex)) {
        sendJson(res, 409, {
          error: "this turn can't be rewound — it was played before editable history was enabled",
        });
        return;
      }
      active.busy = true;

      try {
        const discardedCount = transcript.length - 1 - turnIndex;
        console.log(`[${campaignId}] editing turn ${turnIndex} (discarding ${discardedCount}) on model ${active.model}`);
        // Rewind state to just before this turn, drop it and everything after,
        // and invalidate the now-orphaned later snapshots.
        restorePreTurnSnapshot(campaignDir, active.sessionLogPath, turnIndex);
        truncateTranscript(campaignDir, active.sessionLogPath, turnIndex);
        pruneSnapshotsAfter(campaignDir, active.sessionLogPath, turnIndex);

        // Fresh SDK session: the rewound files are the truth, so we don't (and
        // can't) resume the old linear conversation. This also means the re-run
        // always honors the current model choice.
        active.sessionId = undefined;
        const settings = readCampaignSettings(campaignDir);
        const userInput = isOpening ? openingDirective(campaignDir) : (message as string);
        // ADR-0018: dispatch through the campaign's DM backend (Claude/Grok),
        // like /turns and /opening — never the raw dm-engine runTurn.
        const result = await getBackend(active.provider).runTurn({
          campaignDir,
          sessionLogPath: active.sessionLogPath,
          userInput,
          resumeSessionId: undefined,
          model: active.model,
          settings,
          onText: () => {},
        });

        if (result.sessionId) {
          active.sessionId = result.sessionId;
          active.sessionModel = active.model;
          persistSessionId(campaignDir, result.sessionId);
        }

        // Persist the re-run record at index `turnIndex` (transcript was
        // truncated to that length). Match /opening: don't persist a broken
        // opening; a broken normal turn is still recorded (as /turns does).
        if (!result.isError || !isOpening) {
          appendTurnTranscript(campaignDir, active.sessionLogPath, isOpening ? "" : (message as string), result.text);
        }

        sendJson(res, result.isError ? 502 : 200, {
          narration: result.text,
          sessionId: result.sessionId ?? null,
          model: result.model,
          isError: result.isError,
          turnIndex,
          discardedCount,
        });
      } finally {
        active.busy = false;
      }
    },
  },
  {
    method: "GET",
    pattern: /^\/campaigns\/([^/]+)\/state$/,
    async handler(_req, res, [campaignId], userId) {
      const campaignDir = resolveCampaignDir(userId, campaignId);
      const active = activeSessions.get(sessionKey(userId, campaignId));
      const snapshot = readStateSnapshot(campaignDir, active?.sessionLogPath);
      sendJson(res, 200, snapshot);
    },
  },
  {
    method: "GET",
    pattern: /^\/campaigns\/([^/]+)\/settings$/,
    async handler(_req, res, [campaignId], userId) {
      const campaignDir = resolveCampaignDir(userId, campaignId);
      sendJson(res, 200, readCampaignSettings(campaignDir));
    },
  },
  {
    method: "POST",
    pattern: /^\/campaigns\/([^/]+)\/settings$/,
    async handler(req, res, [campaignId], userId) {
      const campaignDir = resolveCampaignDir(userId, campaignId);
      const body = (await readJsonBody(req)) as Record<string, unknown>;

      const updates: {
        artStyle?: string;
        worldSetting?: string;
        toneWhimsy?: number;
        contentIntensity?: ContentIntensity;
        responseLength?: ResponseLength;
        generateImages?: boolean;
        autoRollDice?: boolean;
        autoIllustrateTurns?: boolean;
      } = {};

      if (body.artStyle !== undefined) {
        if (typeof body.artStyle !== "string") {
          sendJson(res, 400, { error: "artStyle must be a string" });
          return;
        }
        updates.artStyle = body.artStyle;
      }
      if (body.worldSetting !== undefined) {
        if (typeof body.worldSetting !== "string") {
          sendJson(res, 400, { error: "worldSetting must be a string" });
          return;
        }
        updates.worldSetting = body.worldSetting;
      }
      if (body.toneWhimsy !== undefined) {
        if (typeof body.toneWhimsy !== "number" || body.toneWhimsy < 0 || body.toneWhimsy > 1) {
          sendJson(res, 400, { error: "toneWhimsy must be a number between 0 and 1" });
          return;
        }
        updates.toneWhimsy = body.toneWhimsy;
      }
      if (body.contentIntensity !== undefined) {
        if (
          typeof body.contentIntensity !== "string" ||
          !CONTENT_INTENSITIES.includes(body.contentIntensity as ContentIntensity)
        ) {
          sendJson(res, 400, {
            error: `contentIntensity must be one of ${CONTENT_INTENSITIES.join(", ")}`,
          });
          return;
        }
        updates.contentIntensity = body.contentIntensity as ContentIntensity;
      }
      if (body.responseLength !== undefined) {
        if (
          typeof body.responseLength !== "string" ||
          !RESPONSE_LENGTHS.includes(body.responseLength as ResponseLength)
        ) {
          sendJson(res, 400, {
            error: `responseLength must be one of ${RESPONSE_LENGTHS.join(", ")}`,
          });
          return;
        }
        updates.responseLength = body.responseLength as ResponseLength;
      }
      if (body.generateImages !== undefined) {
        if (typeof body.generateImages !== "boolean") {
          sendJson(res, 400, { error: "generateImages must be a boolean" });
          return;
        }
        updates.generateImages = body.generateImages;
      }
      if (body.autoRollDice !== undefined) {
        if (typeof body.autoRollDice !== "boolean") {
          sendJson(res, 400, { error: "autoRollDice must be a boolean" });
          return;
        }
        updates.autoRollDice = body.autoRollDice;
      }
      if (body.autoIllustrateTurns !== undefined) {
        if (typeof body.autoIllustrateTurns !== "boolean") {
          sendJson(res, 400, { error: "autoIllustrateTurns must be a boolean" });
          return;
        }
        updates.autoIllustrateTurns = body.autoIllustrateTurns;
      }

      sendJson(res, 200, persistCampaignSettings(campaignDir, updates));
    },
  },
  {
    // Issue #71: set/clear the player character's free-text appearance on an
    // existing sheet, so a character created before this field existed (or one
    // whose portrait came out wrong) can be fixed without remaking the campaign.
    method: "POST",
    pattern: /^\/campaigns\/([^/]+)\/character\/appearance$/,
    async handler(req, res, [campaignId], userId) {
      const campaignDir = resolveCampaignDir(userId, campaignId);
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      if (typeof body.appearance !== "string") {
        sendJson(res, 400, { error: "appearance must be a string" });
        return;
      }
      if (body.appearance.trim().length > MAX_APPEARANCE_CHARS) {
        sendJson(res, 400, { error: `appearance must be ${MAX_APPEARANCE_CHARS} characters or fewer` });
        return;
      }
      const appearance = setCharacterAppearance(campaignDir, body.appearance);
      sendJson(res, 200, { appearance: appearance ?? null });
    },
  },
  {
    // Per ADR-0009: user-triggered on-demand image generation, outside a turn
    // and independent of the generateImages auto-toggle. Reuses generateImage
    // directly (no model round-trip); returns its { ok, relPath?, error? }
    // verbatim at HTTP 200 so the client can show the exact failure reason
    // instead of a silent no-op.
    method: "POST",
    pattern: /^\/campaigns\/([^/]+)\/illustrate$/,
    async handler(req, res, [campaignId], userId) {
      const campaignDir = resolveCampaignDir(userId, campaignId);
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const settings = readCampaignSettings(campaignDir);

      if (body.kind === "entity") {
        const entityType = body.entityType;
        if (entityType !== "character" && entityType !== "npc" && entityType !== "location") {
          sendJson(res, 400, { error: "entityType must be one of character, npc, location" });
          return;
        }
        if (typeof body.name !== "string" || body.name.trim() === "") {
          sendJson(res, 400, { error: "name must be a non-empty string" });
          return;
        }
        const description =
          typeof body.description === "string" && body.description.trim() ? body.description.trim() : body.name.trim();

        const result = await generateImage(campaignDir, entityType, body.name.trim(), description, settings);
        if (result.ok && result.relPath) {
          recordEntityImage(campaignDir, entityType, body.name.trim(), result.relPath);
        }
        sendJson(res, 200, result);
        return;
      }

      if (body.kind === "moment") {
        const active = activeSessions.get(sessionKey(userId, campaignId));
        if (!active) {
          sendJson(res, 409, {
            error: `no active session for campaign '${campaignId}' — start one before illustrating a moment`,
          });
          return;
        }
        if (typeof body.turnIndex !== "number" || !Number.isInteger(body.turnIndex) || body.turnIndex < 0) {
          sendJson(res, 400, { error: "turnIndex must be a non-negative integer" });
          return;
        }
        const record = readTurnTranscript(campaignDir, active.sessionLogPath).find(
          (r) => r.turnIndex === body.turnIndex
        );
        if (!record) {
          sendJson(res, 404, { error: `no turn ${body.turnIndex} in the active session` });
          return;
        }
        // The narration is the scene description by default; keep the /imagine
        // prompt sane. Issue #66: a regenerate can pass an explicit `description`
        // to refine the prompt (e.g. "the same scene, but at night").
        const override = typeof body.description === "string" && body.description.trim() ? body.description.trim() : "";
        const description = (override || record.narration.trim()).slice(0, 500) || "a scene from the story";
        const sessionBase = path.basename(active.sessionLogPath).replace(/\.md$/, "");
        const name = `${sessionBase}-turn-${body.turnIndex}`;

        const result = await generateImage(campaignDir, "scene", name, description, settings);
        if (result.ok && result.relPath) {
          setTranscriptRecordImage(campaignDir, active.sessionLogPath, body.turnIndex, result.relPath);
        }
        sendJson(res, 200, { ...result, turnIndex: body.turnIndex });
        return;
      }

      sendJson(res, 400, { error: "body.kind must be 'entity' or 'moment'" });
    },
  },
  {
    method: "GET",
    pattern: /^\/campaigns\/([^/]+)\/images\/([^/]+)$/,
    async handler(_req, res, [campaignId, filename], userId) {
      const campaignDir = resolveCampaignDir(userId, campaignId);
      const imagesDir = path.join(campaignDir, "images");
      const resolved = path.resolve(imagesDir, filename);
      // Same guard shape as resolveCampaignDir/serveStatic: the filename
      // param must resolve to a plain file directly under this campaign's
      // own images/ dir, no path traversal. Authenticated like every other
      // route here — deliberately not folded into serveStatic's
      // unauthenticated exception (that exception exists only because the
      // SPA shell can't attach a header on first navigation; these images
      // are always fetched by app.js, which already has the token).
      if (
        path.dirname(resolved) !== imagesDir ||
        !fs.existsSync(resolved) ||
        !fs.statSync(resolved).isFile()
      ) {
        sendJson(res, 404, { error: "image not found" });
        return;
      }
      const ext = path.extname(resolved).toLowerCase();
      res.writeHead(200, { "Content-Type": IMAGE_CONTENT_TYPES[ext] ?? "application/octet-stream" });
      res.end(fs.readFileSync(resolved));
    },
  },
];

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const STATIC_CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  // Issue #53: the ambient bed is served from here. Without an audio MIME type
  // it fell through to application/octet-stream, which can hurt playback/seek.
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
};

/** Serves the static mobile-first UI from public/. Falls through to
 * index.html for any GET that isn't a known API route or an existing
 * file, so the single-page app owns client-side navigation. Resolved
 * paths are checked to stay under PUBLIC_ROOT (same guard shape as
 * resolveCampaignDir, for the same reason: this is a network boundary). */
function serveStatic(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== "GET") return false;

  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const resolved = path.resolve(PUBLIC_ROOT, `.${requestedPath}`);
  const target =
    resolved.startsWith(PUBLIC_ROOT + path.sep) && fs.existsSync(resolved) && fs.statSync(resolved).isFile()
      ? resolved
      : path.join(PUBLIC_ROOT, "index.html");

  const ext = path.extname(target);
  const headers: Record<string, string> = {
    "Content-Type": STATIC_CONTENT_TYPES[ext] ?? "application/octet-stream",
  };
  // Issue #53: two non-content-hashed things can otherwise be served stale from
  // the browser cache forever — the app shell (index.html) and the ambient audio
  // (fixed filename). Send `no-cache` (revalidate every load) for both, so a new
  // bundle hash or a re-recorded audio file actually reaches the player. The
  // content-hashed /assets/* (their names change on every build) stay cacheable.
  // Note: a shell already cached *before* this header existed still needs one
  // hard-refresh; after that it self-updates.
  if (ext === ".ogg" || ext === ".mp3" || ext === ".html") {
    headers["Cache-Control"] = "no-cache";
  }
  res.writeHead(200, headers);
  res.end(fs.readFileSync(target));
  return true;
}

// Per issue #34: the phone's own page can legitimately be loaded from one
// address (e.g. a hostname, or localhost while testing) and configured in
// Settings -> Hearth to talk to the *same* server via a different address
// (e.g. its LAN IP) — the browser treats those as different origins and
// blocks the cross-origin fetch entirely without CORS headers. Reflecting
// the request's own Origin back (rather than a fixed allowlist, which
// would need to somehow already know every address this server might be
// reached by) is what makes that legitimate case work. This does not
// weaken the auth model: CORS only controls whether a browser lets page
// JS *read* a cross-origin response — it never replaces the secret-token
// check below, which every non-static route still enforces regardless of
// Origin. A page on a different origin still gets 401 without the right
// token; it just no longer gets silently blocked before even trying.
function applyCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Chronicle-Token");
  res.setHeader("Access-Control-Max-Age", "600");
}

const server = createServer(async (req, res) => {
  applyCorsHeaders(req, res);

  // Preflight: browsers send this ahead of any cross-origin request that
  // carries a custom header (X-Chronicle-Token) or a non-simple method,
  // and it can never carry that header itself — so it can't be gated on
  // the auth check below. No route needs its own explicit OPTIONS entry;
  // this handles every one of them in one place.
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const route = ROUTES.find(
      (r) => r.method === req.method && r.pattern.test(url.pathname)
    );
    if (!route) {
      if (serveStatic(req, res)) return;
      sendJson(res, 404, { error: "not found" });
      return;
    }

    const params = route.pattern.exec(url.pathname)!.slice(1);

    // Public routes (register/login) issue tokens and so run unauthenticated;
    // static assets (the SPA shell) also load ungated — a browser's initial
    // navigation to "/" can't attach a header, so the page has to load before
    // the user can log in. ADR-0019: every other API route resolves the
    // X-Chronicle-Token header to a user id (via the session index) and 401s
    // if it's missing/unknown. The user id is then passed to the handler, which
    // uses it to scope every campaign operation — it never comes from the URL.
    if (route.public) {
      await route.handler(req, res, params, "");
      return;
    }
    // ADR-0020: an <audio> element can't attach the X-Chronicle-Token header, so
    // the music stream routes pass the session token as ?token= instead. Accept
    // either — same session token, same auth, just a different carrier.
    const headerToken = req.headers[AUTH_HEADER] as string | undefined;
    const userId = resolveSession(headerToken ?? url.searchParams.get("token") ?? undefined);
    if (!userId) {
      sendJson(res, 401, { error: "missing or invalid auth token" });
      return;
    }
    await route.handler(req, res, params, userId);
  } catch (err) {
    if (err instanceof InvalidCampaignIdError) {
      sendJson(res, 400, { error: err.message });
    } else if (err instanceof CampaignNotFoundError) {
      sendJson(res, 404, { error: err.message });
    } else if (err instanceof CampaignExistsError) {
      sendJson(res, 409, { error: err.message });
    } else if (err instanceof CampaignProtectedError) {
      sendJson(res, 403, { error: err.message });
    } else {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: message });
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Chronicle DM engine HTTP API listening on http://${HOST}:${PORT}`);
});

// Issue #55: a turn holds one HTTP connection open for the whole (minutes-long)
// Agent-SDK run. Before this the process had no lifecycle handling at all, so a
// SIGTERM (`Terminated npm run serve`), an OOM kill, or a stray async rejection
// tore the socket down mid-turn and the browser painted the raw
// "Failed to fetch" into the turn. These guards make the server drain in-flight
// requests on a clean signal and survive a background rejection instead of
// silently dying, so the client sees a real result far more often.
let shuttingDown = false;
function gracefulShutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received — draining in-flight requests before exit`);
  server.close(() => {
    console.log("[server] closed cleanly");
    process.exit(0);
  });
  // Don't hang forever if a turn is genuinely stuck; give it a grace window.
  setTimeout(() => {
    console.warn("[server] drain timed out — forcing exit");
    process.exit(0);
  }, 30_000).unref();
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// A rejection or throw escaping the Agent-SDK loop must not take the whole
// server down mid-turn — log it loudly and keep serving. (The per-request
// try/catch already maps awaited throws to a 500; this is the backstop for
// anything that escapes the awaited path.)
process.on("unhandledRejection", (reason) => {
  console.error("[server] unhandledRejection (kept alive):", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[server] uncaughtException (kept alive):", err);
});
