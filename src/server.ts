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
  setTranscriptRecordVideo,
  setTranscriptRecordSceneCaption,
  recordEntityVideo,
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
  isEngineChangeLocked,
  readCampaignSettings,
  persistCampaignSettings,
  newGameDefaultSettings,
  scaffoldCampaign,
  deleteCampaign,
  listCampaigns,
  listCampaignImages,
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
import {
  extractMomentTags,
  resolveMomentDescription,
  retrySceneCaption,
  SCENE_CAPTION_RETRY_PROMPT,
} from "./narration.js";
import { generateImage, groundSceneDescription } from "./image-generator.js";
import {
  IMAGE_PROVIDERS,
  isValidImageProvider,
  IMAGE_QUALITIES,
  isValidImageQuality,
  type ImageProvider,
  type ImageQuality,
} from "./image-backends/types.js";
import { generateVideo } from "./video-generator.js";
import { parseVideoBlock, resolveVideoConfig, type UserVideo } from "./video-store.js";
import {
  buildCharacterSheet,
  deriveCampaignId,
  CharacterValidationError,
  MAX_APPEARANCE_CHARS,
} from "./character-gen.js";
import {
  createUser,
  ensureBootstrapUser,
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
  parseMusicBlock,
  navidromeCreds,
  navidromePlaylistTracks,
  navidromePlaylists,
  navidromeStreamUrl,
  MUSIC_CONTENT_TYPES,
  type UserMusic,
} from "./music-store.js";
import { config, configSources } from "./config.js";

console.log(
  `Config: settings from ${configSources.config}, secrets from ${configSources.secrets} (ADR-0033; see docs/configuration.md).`
);

const PORT = config.server.port;
// Per ADR-0003: default stays localhost-only. Set server.host in config.json to
// the machine's LAN IP (or 0.0.0.0 to bind all interfaces) to serve other LAN
// devices — a deliberate opt-in, since it changes the trust boundary from "this
// machine only" to "this household's network."
const HOST = config.server.host;

// ADR-0019: auth is now per-user accounts, not one household secret. The same
// `X-Chronicle-Token` header now carries a per-user *session token* (issued by
// POST /auth/login|register), which the dispatcher resolves to a user id. The
// header name is unchanged so CORS and the client transport didn't have to move.
const AUTH_HEADER = "x-chronicle-token";

/** ADR-0019: the default settings a brand-new user's account inherits, read from
 * `config.defaults` (ADR-0033; see config.example.json). Only well-formed values are
 * included; anything empty/null/invalid is omitted, so the user falls back to the
 * same code defaults an absent field always had. These seed the user's settings.json
 * at registration and, through it, every campaign they create. */
function newUserDefaultSettings(): Record<string, unknown> {
  const d = config.defaults;
  const out: Record<string, unknown> = {};
  if (d.model && isValidModelId(d.model)) out.model = d.model;
  if (d.provider && isValidProviderId(d.provider)) out.provider = d.provider;
  const artStyle = d.artStyle?.trim();
  if (artStyle) out.artStyle = artStyle;
  const worldSetting = d.worldSetting?.trim();
  if (worldSetting) out.worldSetting = worldSetting;
  if (d.toneWhimsy !== null && d.toneWhimsy !== undefined) {
    const n = Number(d.toneWhimsy);
    if (Number.isFinite(n) && n >= 0 && n <= 1) out.toneWhimsy = n;
  }
  if (d.contentIntensity && CONTENT_INTENSITIES.includes(d.contentIntensity as ContentIntensity)) {
    out.contentIntensity = d.contentIntensity;
  }
  if (d.responseLength && RESPONSE_LENGTHS.includes(d.responseLength as ResponseLength)) {
    out.responseLength = d.responseLength;
  }
  if (typeof d.generateImages === "boolean") out.generateImages = d.generateImages;
  if (typeof d.autoRollDice === "boolean") out.autoRollDice = d.autoRollDice;
  if (typeof d.autoIllustrate === "boolean") out.autoIllustrateTurns = d.autoIllustrate;
  // #118: generateVideos is a copy-on-create boolean like generateImages. The
  // video *params* (duration/resolution/aspect) are not seeded here — like music,
  // they resolve from config.defaults at read time (resolveVideoConfig).
  if (typeof d.generateVideos === "boolean") out.generateVideos = d.generateVideos;
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
  // Issue #142: pending for the whole `busy` window of the current turn —
  // including the after-response scene-caption backfill (ADR-0030). The
  // auto-illustrate seam (`/illustrate` moment) awaits this so it reads the
  // freshly-backfilled caption instead of racing it and falling back to
  // narration. Undefined between turns. Created before the turn runs and
  // resolved in the same finally that clears `busy`, so it can never stick.
  settling?: Promise<void>;
}

// In-memory only: which campaign's Agent SDK session/log is "active" for
// this server process. ADR-0019: keyed by `${userId}/${campaignId}` so two
// users whose campaigns share an id can't collide on the same active session.
const activeSessions = new Map<string, ActiveSession>();

/** The activeSessions key for a user's campaign (ADR-0019). */
function sessionKey(userId: string, campaignId: string): string {
  return `${userId}/${campaignId}`;
}

/** ADR-0030 (Issue #130): when a turn produced no [SCENE:] caption, backfill one
 * via a single follow-up request to the SAME DM session — same engine, same
 * subscription, no new API/key — and patch it onto the just-appended record.
 *
 * Call this AFTER the narration response is already sent, so it never blocks or
 * gates the player seeing/storing narration; the caller still holds the `busy`
 * single-flight lock across it, so the resume can't race a concurrent player
 * turn. Best-effort: `retrySceneCaption` swallows any engine error/empty reply
 * and returns undefined, leaving the record captionless so the moment seams fall
 * back to narration (today's behavior) — a turn never hangs or breaks.
 *
 * Deliberately does NOT touch `active.sessionId`: the throwaway caption exchange
 * resumes from the turn's own session but its resulting session id is discarded,
 * so the next narrative turn resumes from the turn itself and the caption Q&A
 * never enters the ongoing story thread. One retry only — no loop. */
async function backfillSceneCaption(
  active: ActiveSession,
  campaignDir: string,
  settings: CampaignSettings,
  turnSessionId: string | undefined,
  turnIndex: number
): Promise<void> {
  const caption = await retrySceneCaption(() =>
    getBackend(active.provider)
      .runTurn({
        campaignDir,
        sessionLogPath: active.sessionLogPath,
        userInput: SCENE_CAPTION_RETRY_PROMPT,
        resumeSessionId: turnSessionId,
        model: active.model,
        settings,
        onText: () => {},
      })
      .then((r) => ({ text: r.text, isError: r.isError }))
  );
  if (!caption) {
    console.error(`[dm-engine] scene caption retry yielded nothing for turn ${turnIndex} — falling back to narration`);
    return;
  }
  try {
    setTranscriptRecordSceneCaption(campaignDir, active.sessionLogPath, turnIndex, caption);
    console.error(`[dm-engine] scene caption backfilled via retry for turn ${turnIndex}`);
  } catch (e) {
    console.error(`[dm-engine] scene caption backfill patch failed for turn ${turnIndex}: ${(e as Error).message}`);
  }
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
  for (const key of ["generateImages", "autoRollDice", "autoIllustrateTurns", "generateVideos"] as const) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== "boolean") return { error: `${key} must be a boolean` };
      out[key] = body[key];
    }
  }
  // ADR-0027: which image engine this account defaults to (grok | local),
  // live-resolved (never copy-on-create), same as it flows on a campaign.
  if (body.imageProvider !== undefined) {
    if (!isValidImageProvider(body.imageProvider)) {
      return { error: `imageProvider must be one of ${IMAGE_PROVIDERS.join(", ")}` };
    }
    out.imageProvider = body.imageProvider;
  }
  // ADR-0029: which local quality tier this account defaults to (fast|standard|high),
  // live-resolved (never copy-on-create), same as it flows on a campaign.
  if (body.imageQuality !== undefined) {
    if (!isValidImageQuality(body.imageQuality)) {
      return { error: `imageQuality must be one of ${IMAGE_QUALITIES.join(", ")}` };
    }
    out.imageQuality = body.imageQuality;
  }
  // ADR-0020: music is stored under a `music` key. The Navidrome credentials are
  // deliberately NOT accepted here — they stay server-side in .env; a user may
  // only override enabled/source/URL/playlist (validated by parseMusicBlock,
  // shared with the per-campaign settings route, #109).
  if (body.music !== undefined) {
    const parsed = parseMusicBlock(body.music);
    if ("error" in parsed) return { error: parsed.error };
    out.music = parsed.value;
  }
  // #118: video params override, stored under a `video` key (validated by
  // parseVideoBlock, shared with the per-campaign settings route).
  if (body.video !== undefined) {
    const parsed = parseVideoBlock(body.video);
    if ("error" in parsed) return { error: parsed.error };
    out.video = parsed.value;
  }
  return { value: out };
}

/** Read a user's stored music override off their account settings. */
function userMusic(userId: string): UserMusic {
  const m = readUserSettings(userId).music;
  return m && typeof m === "object" ? (m as UserMusic) : {};
}

/** #118: read a user's stored video-params override off their account settings,
 * validated (parseVideoBlock drops any bad field) — mirrors userMusic. */
function userVideo(userId: string): UserVideo {
  const parsed = parseVideoBlock(readUserSettings(userId).video ?? {});
  return "value" in parsed ? parsed.value : {};
}

/** #118: read a campaign's per-game video-params override, or {} when there's
 * no campaign in scope / it's invalid — mirrors campaignMusic. */
function campaignVideo(userId: string, campaignId: string | null): UserVideo {
  if (!campaignId) return {};
  try {
    return readCampaignSettings(resolveCampaignDir(userId, campaignId)).video ?? {};
  } catch {
    return {};
  }
}

/** #109: read a campaign's per-game music override, or {} when there's no
 * campaign in scope / it's invalid / it has none — so music routes degrade to
 * the user-level config rather than erroring. */
function campaignMusic(userId: string, campaignId: string | null): UserMusic {
  if (!campaignId) return {};
  try {
    return readCampaignSettings(resolveCampaignDir(userId, campaignId)).music ?? {};
  } catch {
    return {};
  }
}

/** The `campaignId` query param on the music routes (null when absent). */
function musicCampaignId(req: IncomingMessage): string | null {
  return new URL(req.url ?? "", `http://localhost:${PORT}`).searchParams.get("campaignId");
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
    async handler(req, res, _params, userId) {
      const config = resolveMusicConfig(userMusic(userId), campaignMusic(userId, musicCampaignId(req)));
      sendJson(res, 200, { ...config, localTrackCount: listLocalTracks().length });
    },
  },
  {
    // #118: the effective video params (campaign → user → .env → default), so
    // the settings UI can show what a clip will actually use. Mirrors /music/config.
    method: "GET",
    pattern: /^\/video\/config$/,
    async handler(req, res, _params, userId) {
      sendJson(res, 200, resolveVideoConfig(userVideo(userId), campaignVideo(userId, musicCampaignId(req))));
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
    async handler(req, res, _params, userId) {
      const creds = navidromeCreds(
        resolveMusicConfig(userMusic(userId), campaignMusic(userId, musicCampaignId(req)))
      );
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
    // #110: the chronicle-tagged playlist NAMES on the shared server, for the
    // picker dropdown. Same guard as the singular /playlist route above; threads
    // ?campaignId= so a per-game Navidrome URL override resolves the right server.
    method: "GET",
    pattern: /^\/music\/navidrome\/playlists$/,
    async handler(req, res, _params, userId) {
      const creds = navidromeCreds(
        resolveMusicConfig(userMusic(userId), campaignMusic(userId, musicCampaignId(req)))
      );
      if (!creds) {
        sendJson(res, 400, { error: "Navidrome is not configured — set NAVIDROME_URL/USER/PASSWORD in .env" });
        return;
      }
      try {
        sendJson(res, 200, { playlists: await navidromePlaylists(creds) });
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
      const creds = navidromeCreds(
        resolveMusicConfig(userMusic(userId), campaignMusic(userId, musicCampaignId(req)))
      );
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
    // Issue #105: every image across this user's own campaigns, for the
    // new-game loading slideshow. `?exclude=<campaignId>` skips the campaign
    // being started (which has no images yet anyway). Each ref is fetched
    // through GET /campaigns/:id/images/:filename, so no bytes are served here.
    method: "GET",
    pattern: /^\/past-images$/,
    async handler(req, res, _params, userId) {
      const exclude = new URL(req.url ?? "", `http://localhost:${PORT}`).searchParams.get("exclude") ?? undefined;
      sendJson(res, 200, { images: listCampaignImages(userId, exclude) });
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
      // #118: generateVideos is a copy-on-create boolean like generateImages.
      if (creation.generateVideos !== undefined) {
        if (typeof creation.generateVideos !== "boolean") {
          sendJson(res, 400, { error: "generateVideos must be a boolean" });
          return;
        }
        creationSettings.generateVideos = creation.generateVideos;
      }

      const campaignId = deriveCampaignId(String(sheet.name), (id) =>
        fs.existsSync(path.join(userCampaignsRoot(userId), id))
      );
      // ADR-0019: seed the new campaign from the user's account defaults, then
      // let the explicit create-form settings (below) override. The client's
      // form is itself pre-filled from those defaults, so this is the robust
      // floor even if the form omits a field.
      // #109: deliberately EXCLUDE `music` from the seed — a new game stores no
      // music override and so tracks the user's *live* account default until the
      // player explicitly overrides it for that game (ADR-0020 amended). This
      // diverges from the copy-on-create the other settings use, by design.
      // #118: `video` (the params override) follows the same live-tracking model
      // as `music`, so exclude it here too. `generateVideos` is NOT excluded — it
      // is a copy-on-create boolean like generateImages.
      const { music: _seedMusic, video: _seedVideo, ...userDefaults } = readUserSettings(userId);
      const dir = scaffoldCampaign(userId, campaignId, sheet, {
        model: DEFAULT_MODEL,
        autoRollDice: true,
        ...userDefaults,
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

      // Issue #114: the engine and model are set-once — locked once the game
      // has started. Switching provider/model mid-campaign left a stale,
      // provider-agnostic `.session-id` that later got handed to the wrong
      // backend's resume (the Claude SDK's `query({ resume })` on a Grok UUID →
      // 502/500 crash; ADR-0018, #57). Rather than reconcile session identity
      // across engines, we forbid the change once play has begun. A no-arg
      // session/start (the entry-flow re-start on Home "continue" / new-game
      // create) is always allowed — only an EXPLICIT, DIFFERING provider/model
      // is rejected. Before the opening/first turn (no persisted session yet)
      // changes flow through freely, so the new-game form can pick the engine.
      const engineLocked = isEngineChangeLocked({
        started: readPersistedSessionId(campaignDir) !== undefined,
        requestedProvider: requestedProvider !== undefined,
        resolvedProvider: provider,
        priorProvider,
        requestedModel: requestedModel !== undefined,
        resolvedModel: model,
        priorModel,
      });
      if (engineLocked) {
        sendJson(res, 409, {
          error:
            "the engine and model are locked once a game has started — they can only be chosen when creating a new chronicle",
        });
        return;
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
      // Issue #142: signal that a turn (and its after-response caption backfill)
      // is settling, so the auto-illustrate seam can wait it out.
      let settle!: () => void;
      active.settling = new Promise<void>((r) => { settle = r; });

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

        // ADR-0030/0031: pull the DM-emitted [SCENE: ...] caption and optional
        // [PRESENT: ...] entity list off the turn text, stripping both from the
        // player-facing narration. Error turns keep their raw un-stripped text.
        const { narration, sceneCaption, presentEntities } = result.isError
          ? { narration: result.text, sceneCaption: undefined, presentEntities: [] as string[] }
          : extractMomentTags(result.text);

        // Per ADR-0007: the deterministic speaker-attribution record, written
        // here (not inferred from prose afterward) at the one point both
        // strings are already in hand — for every turn, error or not.
        const record = appendTurnTranscript(
          campaignDir,
          active.sessionLogPath,
          message,
          narration,
          sceneCaption,
          presentEntities
        );

        sendJson(res, result.isError ? 502 : 200, {
          narration,
          sessionId: result.sessionId ?? null,
          model: result.model,
          isError: result.isError,
          // #132: surface the caption so a same-session regenerate can pre-fill
          // it (undefined when the DM omitted it — the client falls back to
          // blank, and the transcript carries it after any later backfill).
          sceneCaption,
        });

        // ADR-0030 (Issue #130): the DM often omits the [SCENE:] line in live
        // play. When it did, backfill the caption via one same-session retry —
        // AFTER the response above, so the player never waits on it. The `busy`
        // lock (cleared in finally) is still held, so this can't race the next
        // player turn.
        if (!result.isError && !sceneCaption) {
          await backfillSceneCaption(active, campaignDir, settings, result.sessionId, record.turnIndex);
        }
      } finally {
        // Always clear the single-flight lock — on success, on a 502 engine
        // error, and on a thrown exception (which propagates to the top-level
        // catch → 500). The lock must never stick.
        active.busy = false;
        // Issue #142: release the auto-illustrate seam — the turn and any
        // caption backfill are done; the record now carries its final caption.
        active.settling = undefined;
        settle();
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
          sceneCaption: existing[0].sceneCaption, // #132: prefill on re-entry
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
      // Issue #142: signal that a turn (and its after-response caption backfill)
      // is settling, so the auto-illustrate seam can wait it out.
      let settle!: () => void;
      active.settling = new Promise<void>((r) => { settle = r; });

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

        // ADR-0030/0031: strip the DM-emitted [SCENE: ...] caption and optional
        // [PRESENT: ...] list off the opening narration and cache them. Error
        // openings keep their raw text and aren't persisted.
        const { narration, sceneCaption, presentEntities } = result.isError
          ? { narration: result.text, sceneCaption: undefined, presentEntities: [] as string[] }
          : extractMomentTags(result.text);

        // Turn-zero: empty playerMessage marks a DM-initiated turn (ADR-0013).
        // On an engine error, don't persist a broken opening — leave the
        // campaign at zero turns so the next enter-Play retries it cleanly.
        const record = result.isError
          ? undefined
          : appendTurnTranscript(campaignDir, active.sessionLogPath, "", narration, sceneCaption, presentEntities);

        sendJson(res, result.isError ? 502 : 200, {
          narration,
          sessionId: result.sessionId ?? null,
          model: result.model,
          isError: result.isError,
          sceneCaption, // #132: prefill the opening's regenerate box
        });

        // ADR-0030 (Issue #130): backfill a missing opening caption via one
        // same-session retry, after the response (never blocks the player).
        if (record && !sceneCaption) {
          await backfillSceneCaption(active, campaignDir, settings, result.sessionId, record.turnIndex);
        }
      } finally {
        active.busy = false;
        // Issue #142: release the auto-illustrate seam — the turn and any
        // caption backfill are done; the record now carries its final caption.
        active.settling = undefined;
        settle();
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
      // Issue #142: signal that a turn (and its after-response caption backfill)
      // is settling, so the auto-illustrate seam can wait it out.
      let settle!: () => void;
      active.settling = new Promise<void>((r) => { settle = r; });

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

        // ADR-0030/0031: strip and cache the DM-emitted [SCENE: ...] caption and
        // optional [PRESENT: ...] list; error turns keep their raw text.
        const { narration, sceneCaption, presentEntities } = result.isError
          ? { narration: result.text, sceneCaption: undefined, presentEntities: [] as string[] }
          : extractMomentTags(result.text);

        // Persist the re-run record at index `turnIndex` (transcript was
        // truncated to that length). Match /opening: don't persist a broken
        // opening; a broken normal turn is still recorded (as /turns does).
        const record =
          !result.isError || !isOpening
            ? appendTurnTranscript(
                campaignDir,
                active.sessionLogPath,
                isOpening ? "" : (message as string),
                narration,
                sceneCaption,
                presentEntities
              )
            : undefined;

        sendJson(res, result.isError ? 502 : 200, {
          narration,
          sessionId: result.sessionId ?? null,
          model: result.model,
          isError: result.isError,
          turnIndex,
          discardedCount,
          sceneCaption, // #132: prefill the re-run turn's regenerate box
        });

        // ADR-0030 (Issue #130): backfill a missing caption on the re-run via
        // one same-session retry, after the response (never blocks the player).
        if (record && !result.isError && !sceneCaption) {
          await backfillSceneCaption(active, campaignDir, settings, result.sessionId, record.turnIndex);
        }
      } finally {
        active.busy = false;
        // Issue #142: release the auto-illustrate seam — the turn and any
        // caption backfill are done; the record now carries its final caption.
        active.settling = undefined;
        settle();
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
        generateVideos?: boolean;
        music?: UserMusic | null;
        video?: UserVideo | null;
        imageProvider?: ImageProvider | null;
        imageQuality?: ImageQuality | null;
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
      if (body.generateVideos !== undefined) {
        if (typeof body.generateVideos !== "boolean") {
          sendJson(res, 400, { error: "generateVideos must be a boolean" });
          return;
        }
        updates.generateVideos = body.generateVideos;
      }
      // ADR-0027: per-game image engine override. `null` resets to the account
      // default (freely switchable mid-campaign — no session reset like the DM
      // engine's `provider`).
      if (body.imageProvider === null) {
        updates.imageProvider = null;
      } else if (body.imageProvider !== undefined) {
        if (!isValidImageProvider(body.imageProvider)) {
          sendJson(res, 400, { error: `imageProvider must be one of ${IMAGE_PROVIDERS.join(", ")}` });
          return;
        }
        updates.imageProvider = body.imageProvider;
      }
      // ADR-0029: per-game quality tier override. `null` resets to the account
      // default (freely switchable mid-campaign, like imageProvider).
      if (body.imageQuality === null) {
        updates.imageQuality = null;
      } else if (body.imageQuality !== undefined) {
        if (!isValidImageQuality(body.imageQuality)) {
          sendJson(res, 400, { error: `imageQuality must be one of ${IMAGE_QUALITIES.join(", ")}` });
          return;
        }
        updates.imageQuality = body.imageQuality;
      }
      // #109: an optional per-game music override (same shape/validation as the
      // user default). Empty subfields clear that field back to the user default;
      // an explicit `null` drops the whole override (reset to account default).
      if (body.music === null) {
        updates.music = null;
      } else if (body.music !== undefined) {
        const parsed = parseMusicBlock(body.music);
        if ("error" in parsed) {
          sendJson(res, 400, { error: parsed.error });
          return;
        }
        updates.music = parsed.value;
      }
      // #118: an optional per-game video-params override, same two-level model
      // as music — `null` resets to the account default, else validate the block.
      if (body.video === null) {
        updates.video = null;
      } else if (body.video !== undefined) {
        const parsed = parseVideoBlock(body.video);
        if ("error" in parsed) {
          sendJson(res, 400, { error: parsed.error });
          return;
        }
        updates.video = parsed.value;
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
        let record = readTurnTranscript(campaignDir, active.sessionLogPath).find(
          (r) => r.turnIndex === body.turnIndex
        );
        if (!record) {
          sendJson(res, 404, { error: `no turn ${body.turnIndex} in the active session` });
          return;
        }
        // ADR-0030: the DM-emitted [SCENE: ...] caption for this turn is the
        // scene description — a concentrated visual of the moment, not the prose
        // slab. Issue #66: a regenerate can pass an explicit `description` to
        // refine the prompt (e.g. "the same scene, but at night"), which takes
        // precedence. ADR-0031: ground KNOWN entities the DM flagged present
        // ([PRESENT:]) in their canonical appearance before the cap.
        //
        // ADR-0030 race amendment (#146): the reply-first AUTO trigger sends
        // `auto: true`. In auto mode `resolveMomentDescription` returns undefined
        // when there's no override and no cached caption — the DM omitted the
        // [SCENE:] line inline and the post-response backfill hasn't landed yet.
        // A caption-less auto image is always off-moment, so SKIP rather than
        // scavenge narration; the client shows the manual "Illustrate" affordance,
        // and by the time the user reaches for it the backfill has patched the
        // caption in. The MANUAL path (no `auto`) keeps the narration fallback —
        // the user explicitly asked, so draw something.
        const auto = body.auto === true;
        const override = typeof body.description === "string" && body.description.trim() ? body.description.trim() : "";
        const resolved = resolveMomentDescription(override, record, { auto });
        if (resolved === undefined) {
          sendJson(res, 200, { ok: false, skipped: true, turnIndex: body.turnIndex });
          return;
        }
        const base = groundSceneDescription(campaignDir, resolved, record.presentEntities);
        const description = base.trim().slice(0, 500) || "a scene from the story";
        const sessionBase = path.basename(active.sessionLogPath).replace(/\.md$/, "");
        const name = `${sessionBase}-turn-${body.turnIndex}`;

        const result = await generateImage(campaignDir, "scene", name, description, settings);
        if (result.ok && result.relPath) {
          setTranscriptRecordImage(campaignDir, active.sessionLogPath, body.turnIndex, result.relPath);
        }
        // Return the caption used (if any) so the client can prefill the
        // regenerate box even when the turn payload predated the caption.
        sendJson(res, 200, { ...result, turnIndex: body.turnIndex, sceneCaption: record.sceneCaption });
        return;
      }

      sendJson(res, 400, { error: "body.kind must be 'entity' or 'moment'" });
    },
  },
  {
    // Issue #118 (ADR-0026): user-triggered on-demand video generation — the
    // "Animate" action. Analog of /illustrate: never on the turn path, returns
    // generateVideo's { ok, relPath?, error? } verbatim at HTTP 200. Params are
    // resolved campaign → user → .env → default; when the still exists it's fed
    // to /imagine-video as the base image (two-step workflow) for consistency.
    method: "POST",
    pattern: /^\/campaigns\/([^/]+)\/animate$/,
    async handler(req, res, [campaignId], userId) {
      const campaignDir = resolveCampaignDir(userId, campaignId);
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const settings = readCampaignSettings(campaignDir);
      const video = resolveVideoConfig(userVideo(userId), settings.video);

      // A client-supplied base still (from the gallery/moment it already knows)
      // must resolve to a plain file under this campaign's own images/ dir — the
      // same traversal guard as the images route, since generateVideo stages it.
      const safeBaseImage = (rel: unknown): string | undefined => {
        if (typeof rel !== "string" || !rel.trim()) return undefined;
        const basename = rel.split("/").pop() || rel;
        const resolved = path.resolve(path.join(campaignDir, "images"), basename);
        if (path.dirname(resolved) !== path.join(campaignDir, "images") || !fs.existsSync(resolved)) {
          return undefined;
        }
        return path.join("images", basename);
      };

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
        const result = await generateVideo(campaignDir, entityType, body.name.trim(), description, settings, video, {
          baseImageRelPath: safeBaseImage(body.baseImage),
        });
        if (result.ok && result.relPath) {
          recordEntityVideo(campaignDir, entityType, body.name.trim(), result.relPath);
        }
        sendJson(res, 200, result);
        return;
      }

      if (body.kind === "moment") {
        const active = activeSessions.get(sessionKey(userId, campaignId));
        if (!active) {
          sendJson(res, 409, {
            error: `no active session for campaign '${campaignId}' — start one before animating a moment`,
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
        // ADR-0030: same caption-first description source as /illustrate, so the
        // moment's still and its animation share one caption (both read
        // record.sceneCaption); explicit override still wins. ADR-0031: same
        // entity grounding as /illustrate, so the clip renders entities on-model.
        // Animate is user-triggered only (never the reply-first auto path), so it
        // stays on the manual seam — no `auto`, narration fallback intact. The
        // `?? record.narration` is a type-only guard: without `auto`,
        // resolveMomentDescription never returns undefined.
        const override = typeof body.description === "string" && body.description.trim() ? body.description.trim() : "";
        const base = groundSceneDescription(
          campaignDir,
          resolveMomentDescription(override, record) ?? record.narration,
          record.presentEntities
        );
        const description = base.trim().slice(0, 500) || "a scene from the story";
        const sessionBase = path.basename(active.sessionLogPath).replace(/\.md$/, "");
        const name = `${sessionBase}-turn-${body.turnIndex}`;
        // Animate the moment's own still if it has one (recorded via /illustrate).
        const result = await generateVideo(campaignDir, "scene", name, description, settings, video, {
          baseImageRelPath: safeBaseImage(record.image),
        });
        if (result.ok && result.relPath) {
          setTranscriptRecordVideo(campaignDir, active.sessionLogPath, body.turnIndex, result.relPath);
        }
        sendJson(res, 200, { ...result, turnIndex: body.turnIndex });
        return;
      }

      sendJson(res, 400, { error: "body.kind must be 'entity' or 'moment'" });
    },
  },
  {
    method: "GET",
    pattern: /^\/campaigns\/([^/]+)\/videos\/([^/]+)$/,
    async handler(_req, res, [campaignId, filename], userId) {
      const campaignDir = resolveCampaignDir(userId, campaignId);
      const videosDir = path.join(campaignDir, "videos");
      const resolved = path.resolve(videosDir, filename);
      // Same traversal guard as the images route.
      if (
        path.dirname(resolved) !== videosDir ||
        !fs.existsSync(resolved) ||
        !fs.statSync(resolved).isFile()
      ) {
        sendJson(res, 404, { error: "video not found" });
        return;
      }
      const ext = path.extname(resolved).toLowerCase();
      res.writeHead(200, { "Content-Type": VIDEO_CONTENT_TYPES[ext] ?? "application/octet-stream" });
      res.end(fs.readFileSync(resolved));
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

const VIDEO_CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
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
  // Issue #94: guarantee the `.env` bootstrap account exists so `admin`/`password`
  // works on a fresh install without a separate `npm run migrate:multi-user` step
  // (the migration is only needed to move pre-existing flat campaigns). Idempotent
  // and never overwrites an existing account; seeds the same DEFAULT_* settings a
  // registered user gets.
  const bootstrap = ensureBootstrapUser(newUserDefaultSettings());
  if (bootstrap.status === "created") {
    console.log(`Bootstrap user "${bootstrap.username}" created from .env — you can log in with it now.`);
  } else if (bootstrap.status === "skipped") {
    console.log(`Bootstrap user not created: ${bootstrap.reason}. Register in the app, or set BOOTSTRAP_* in .env and restart.`);
  }
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
