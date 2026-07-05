import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { runTurn } from "./dm-engine.js";
import {
  resolveCampaignDir,
  readPersistedSessionId,
  persistSessionId,
  startSessionLog,
  readStateSnapshot,
  InvalidCampaignIdError,
  CampaignNotFoundError,
} from "./campaign-store.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 4317;

interface ActiveSession {
  sessionId: string | undefined;
  sessionLogPath: string;
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
    method: "POST",
    pattern: /^\/campaigns\/([^/]+)\/session\/start$/,
    async handler(_req, res, [campaignId]) {
      const campaignDir = resolveCampaignDir(campaignId);
      const persisted = readPersistedSessionId(campaignDir);
      const sessionLogPath = startSessionLog(campaignDir);
      activeSessions.set(campaignId, { sessionId: persisted, sessionLogPath });
      sendJson(res, 200, {
        campaignId,
        sessionId: persisted ?? null,
        resumed: Boolean(persisted),
        sessionLogPath,
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

      const result = await runTurn(
        campaignDir,
        active.sessionLogPath,
        message,
        active.sessionId,
        () => {}
      );

      if (result.sessionId) {
        active.sessionId = result.sessionId;
        persistSessionId(campaignDir, result.sessionId);
      }

      sendJson(res, result.isError ? 502 : 200, {
        narration: result.text,
        sessionId: result.sessionId ?? null,
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

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const route = ROUTES.find(
      (r) => r.method === req.method && r.pattern.test(url.pathname)
    );
    if (!route) {
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
