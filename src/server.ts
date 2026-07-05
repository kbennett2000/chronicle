import { createServer, IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTurn } from "./dm-engine.js";
import {
  resolveCampaignDir,
  readPersistedSessionId,
  persistSessionId,
  resolveSessionLog,
  readStateSnapshot,
  appendTurnTranscript,
  readCampaignModel,
  persistCampaignModel,
  readCampaignSettings,
  persistCampaignSettings,
  CONTENT_INTENSITIES,
  isValidModelId,
  MODEL_OPTIONS,
  InvalidCampaignIdError,
  CampaignNotFoundError,
  type ContentIntensity,
} from "./campaign-store.js";

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
    method: "POST",
    pattern: /^\/campaigns\/([^/]+)\/session\/start$/,
    async handler(req, res, [campaignId]) {
      const campaignDir = resolveCampaignDir(campaignId);

      const body = await readJsonBody(req);
      const requestedModel = (body as { model?: unknown }).model;
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
        model = readCampaignModel(campaignDir);
      }

      const persisted = readPersistedSessionId(campaignDir);
      const sessionLogPath = resolveSessionLog(campaignDir, Boolean(persisted));
      activeSessions.set(campaignId, { sessionId: persisted, sessionLogPath, model });
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
        const result = await runTurn(
          campaignDir,
          active.sessionLogPath,
          message,
          active.sessionId,
          active.model,
          settings,
          () => {}
        );

        if (result.sessionId) {
          active.sessionId = result.sessionId;
          persistSessionId(campaignDir, result.sessionId);
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
        generateImages?: boolean;
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
      if (body.generateImages !== undefined) {
        if (typeof body.generateImages !== "boolean") {
          sendJson(res, 400, { error: "generateImages must be a boolean" });
          return;
        }
        updates.generateImages = body.generateImages;
      }

      sendJson(res, 200, persistCampaignSettings(campaignDir, updates));
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
  res.writeHead(200, { "Content-Type": STATIC_CONTENT_TYPES[ext] ?? "application/octet-stream" });
  res.end(fs.readFileSync(target));
  return true;
}

const server = createServer(async (req, res) => {
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
    } else {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: message });
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Chronicle DM engine HTTP API listening on http://${HOST}:${PORT}`);
});
