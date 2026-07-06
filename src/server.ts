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
import { runTurn, openingDirective, modelsMatch } from "./dm-engine.js";
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
  readCampaignModel,
  persistCampaignModel,
  readCampaignSettings,
  persistCampaignSettings,
  newGameDefaultSettings,
  scaffoldCampaign,
  deleteCampaign,
  listCampaigns,
  CAMPAIGNS_ROOT,
  CONTENT_INTENSITIES,
  RESPONSE_LENGTHS,
  isValidModelId,
  MODEL_OPTIONS,
  InvalidCampaignIdError,
  CampaignNotFoundError,
  CampaignExistsError,
  CampaignProtectedError,
  type ContentIntensity,
  type ResponseLength,
  type CampaignSettings,
} from "./campaign-store.js";
import { generateImage } from "./image-generator.js";
import {
  buildCharacterSheet,
  deriveCampaignId,
  CharacterValidationError,
  MAX_APPEARANCE_CHARS,
} from "./character-gen.js";

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

// Required, not optional: once the server can be bound to a LAN interface,
// shipping without a secret configured would silently serve the API to
// the whole household network with no auth at all.
const SHARED_SECRET = process.env.CHRONICLE_SHARED_SECRET;
if (!SHARED_SECRET) {
  console.error(
    "CHRONICLE_SHARED_SECRET is not set. Refusing to start — see .env.example / SETUP.md."
  );
  process.exit(1);
}
const AUTH_HEADER = "x-chronicle-token";

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
  // Per issue #31: single-flight marker. Two turns submitted concurrently
  // for the same campaign (two tabs, a cross-tab double-submit the in-page
  // `sending` guard can't see) would otherwise both run `runTurn` in
  // parallel and race on the same state files, silently clobbering one
  // turn's edits. Set true for the duration of a turn, cleared in a finally.
  busy?: boolean;
}

// In-memory only: which campaign's Agent SDK session/log is "active" for
// this server process. Single process, single shared secret (ADR-0003) —
// still a single-household trust boundary, not a multi-user one.
const activeSessions = new Map<string, ActiveSession>();

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

const ROUTES: Array<{
  method: string;
  pattern: RegExp;
  handler: (req: IncomingMessage, res: ServerResponse, params: string[]) => Promise<void>;
}> = [
  {
    method: "GET",
    pattern: /^\/models$/,
    async handler(_req, res) {
      sendJson(res, 200, { models: MODEL_OPTIONS, default: "claude-sonnet-5" });
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
    async handler(_req, res) {
      sendJson(res, 200, { settings: newGameDefaultSettings() });
    },
  },
  {
    // ADR-0010: list every campaign for Home's chronicle picker.
    method: "GET",
    pattern: /^\/campaigns$/,
    async handler(_req, res) {
      sendJson(res, 200, { campaigns: listCampaigns() });
    },
  },
  {
    // ADR-0010: create a new campaign from a character-creation form. The
    // character sheet is derived server-side (buildCharacterSheet) so HP/AC
    // are authoritative, not trusted from the client.
    method: "POST",
    pattern: /^\/campaigns$/,
    async handler(req, res) {
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
        fs.existsSync(path.join(CAMPAIGNS_ROOT, id))
      );
      const dir = scaffoldCampaign(campaignId, sheet);
      // Model is persisted via persistCampaignModel (it's excluded from the
      // POST /settings update type); the world fields go through
      // persistCampaignSettings. Split them out so both are seeded at create.
      const { model: creationModel, ...worldSettings } = creationSettings;
      if (creationModel) {
        persistCampaignModel(dir, creationModel);
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
    async handler(_req, res, [campaignId]) {
      deleteCampaign(campaignId);
      activeSessions.delete(campaignId);
      sendJson(res, 200, { deleted: campaignId });
    },
  },
  {
    method: "POST",
    pattern: /^\/campaigns\/([^/]+)\/session\/start$/,
    async handler(req, res, [campaignId]) {
      const campaignDir = resolveCampaignDir(campaignId);

      const body = await readJsonBody(req);
      const requestedModel = (body as { model?: unknown }).model;
      // The model the campaign was running under before this call — i.e. the
      // model any persisted SDK session was created with (issue #57).
      const priorModel = readCampaignModel(campaignDir);
      let model: string;
      if (requestedModel !== undefined) {
        if (typeof requestedModel !== "string" || !isValidModelId(requestedModel)) {
          sendJson(res, 400, {
            error: `invalid model — must be one of ${MODEL_OPTIONS.map((m) => m.id).join(", ")}`,
          });
          return;
        }
        persistCampaignModel(campaignDir, requestedModel);
        model = requestedModel;
      } else {
        model = priorModel;
      }

      const persisted = readPersistedSessionId(campaignDir);
      const sessionLogPath = resolveSessionLog(campaignDir, Boolean(persisted));
      // sessionModel = the model the persisted session ran under. If the player
      // just switched models, this differs from `model`, so the first turn will
      // start a fresh SDK session rather than resume the old-model one (#57).
      activeSessions.set(campaignId, { sessionId: persisted, sessionLogPath, model, sessionModel: priorModel });
      sendJson(res, 200, {
        campaignId,
        sessionId: persisted ?? null,
        resumed: Boolean(persisted),
        sessionLogPath,
        model,
      });
    },
  },
  {
    method: "POST",
    pattern: /^\/campaigns\/([^/]+)\/turns$/,
    async handler(req, res, [campaignId]) {
      const campaignDir = resolveCampaignDir(campaignId);
      const active = activeSessions.get(campaignId);
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
        const settings = readCampaignSettings(campaignDir);
        // Issue #57: only resume the SDK session when it was created under the
        // same model. If the player switched models mid-campaign, resuming would
        // keep running the old model, so we drop `resume` and start fresh.
        const resumeSessionId =
          active.sessionId && active.sessionModel === active.model ? active.sessionId : undefined;
        const result = await runTurn(
          campaignDir,
          active.sessionLogPath,
          message,
          resumeSessionId,
          active.model,
          settings,
          () => {}
        );

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
    async handler(_req, res, [campaignId]) {
      const campaignDir = resolveCampaignDir(campaignId);
      const active = activeSessions.get(campaignId);
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
        const settings = readCampaignSettings(campaignDir);
        const result = await runTurn(
          campaignDir,
          active.sessionLogPath,
          openingDirective(campaignDir),
          active.sessionModel === active.model ? active.sessionId : undefined,
          active.model,
          settings,
          () => {}
        );

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
    method: "GET",
    pattern: /^\/campaigns\/([^/]+)\/state$/,
    async handler(_req, res, [campaignId]) {
      const campaignDir = resolveCampaignDir(campaignId);
      const active = activeSessions.get(campaignId);
      const snapshot = readStateSnapshot(campaignDir, active?.sessionLogPath);
      sendJson(res, 200, snapshot);
    },
  },
  {
    method: "GET",
    pattern: /^\/campaigns\/([^/]+)\/settings$/,
    async handler(_req, res, [campaignId]) {
      const campaignDir = resolveCampaignDir(campaignId);
      sendJson(res, 200, readCampaignSettings(campaignDir));
    },
  },
  {
    method: "POST",
    pattern: /^\/campaigns\/([^/]+)\/settings$/,
    async handler(req, res, [campaignId]) {
      const campaignDir = resolveCampaignDir(campaignId);
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
    async handler(req, res, [campaignId]) {
      const campaignDir = resolveCampaignDir(campaignId);
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
    async handler(req, res, [campaignId]) {
      const campaignDir = resolveCampaignDir(campaignId);
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
        const active = activeSessions.get(campaignId);
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
    async handler(_req, res, [campaignId, filename]) {
      const campaignDir = resolveCampaignDir(campaignId);
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

    // Static assets (the SPA shell) are intentionally not gated on the
    // header below — a browser's initial navigation to "/" can't attach a
    // custom header, so the page has to load unauthenticated before the
    // user can enter the passphrase into Settings. Only the API routes,
    // which the SPA calls via fetch() with the header attached, are
    // secret-gated.
    if (req.headers[AUTH_HEADER] !== SHARED_SECRET) {
      sendJson(res, 401, { error: "missing or invalid auth token" });
      return;
    }

    const params = route.pattern.exec(url.pathname)!.slice(1);
    await route.handler(req, res, params);
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
