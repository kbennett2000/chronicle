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
  readCampaignModel,
  persistCampaignModel,
  isValidModelId,
  MODEL_OPTIONS,
  InvalidCampaignIdError,
  CampaignNotFoundError,
} from "./campaign-store.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 4317;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROOT = path.resolve(__dirname, "../public");

interface ActiveSession {
  sessionId: string | undefined;
  sessionLogPath: string;
  model: string;
}

// In-memory only: which campaign's Agent SDK session/log is "active" for
// this server process. Local-only prototype, single process, no auth —
// per ADR-0002 this is still a local trust boundary, not a multi-user one.
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

      console.log(`[${campaignId}] turn on model ${active.model}`);
      const result = await runTurn(
        campaignDir,
        active.sessionLogPath,
        message,
        active.sessionId,
        active.model,
        () => {}
      );

      if (result.sessionId) {
        active.sessionId = result.sessionId;
        persistSessionId(campaignDir, result.sessionId);
      }

      sendJson(res, result.isError ? 502 : 200, {
        narration: result.text,
        sessionId: result.sessionId ?? null,
        model: result.model,
        isError: result.isError,
      });
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
];

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

server.listen(PORT, () => {
  console.log(`Chronicle DM engine HTTP API listening on http://localhost:${PORT}`);
});
