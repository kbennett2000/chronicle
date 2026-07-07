import { type Connection, serverOrigin } from "./connection";

export class AuthError extends Error {
  constructor() {
    super("Your session has expired — please log in again.");
  }
}

export class ApiError extends Error {
  /** HTTP status of the failed response, when known — lets callers tell e.g. a
   * 404 (resource absent) apart from a 500 without string-matching (#96). */
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

/** Issue #55: a rejected `fetch()` surfaces as the browser's raw
 * `TypeError: Failed to fetch` (or "Load failed" on Safari / "NetworkError" on
 * Firefox) — an opaque, unactionable string that got painted straight into the
 * turn as its error narration when the home server was killed mid-turn. Map
 * those network failures to one clear, actionable message instead. Domain
 * results (a 502 turn body, a 401) never reach here — only a genuinely dropped
 * connection does. */
const CONNECTION_LOST_MESSAGE =
  "Lost the connection to your home server — it may have restarted or stopped. Check that it's running, then try again.";

function connectionError(err: unknown): ApiError {
  const raw = err instanceof Error ? err.message : "";
  // The exact text differs per browser; any of these means the request never
  // completed a round trip, which for this app means the LAN server is gone.
  if (/failed to fetch|load failed|networkerror|network request failed/i.test(raw) || raw === "") {
    return new ApiError(CONNECTION_LOST_MESSAGE);
  }
  return new ApiError(raw);
}

/** Lowest-level call: attaches the auth header (every route but static
 * asset serving requires it, per ADR-0003) and surfaces network failures
 * / a 401 as thrown errors, but returns any other status as-is. Most
 * callers want apiFetch below, which also throws on other non-2xx
 * responses — this exists for routes like POST /turns, where a non-2xx
 * (502, "isError": true) is a normal domain response the caller needs to
 * render, not a fetch failure. */
export async function apiFetchRaw(
  connection: Connection,
  path: string,
  options?: RequestInit
): Promise<{ status: number; body: unknown }> {
  let res: Response;
  try {
    res = await fetch(`${serverOrigin(connection)}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Chronicle-Token": connection.token,
        ...options?.headers,
      },
    });
  } catch (err) {
    throw connectionError(err);
  }

  if (res.status === 401) throw new AuthError();

  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/** For binary routes (currently just GET /campaigns/:id/images/:filename)
 * — same auth header as every other route (server.ts's comment on that
 * route: images are "always fetched by app.js, which already has the
 * token," never a bare <img src>, since there's no way to attach a
 * custom header to an <img> tag's own request). Throws on any failure
 * (401, 404, network) — callers treat "couldn't get this image" as the
 * same no-image-yet case as portraitImage being absent in the first
 * place, per the backend contract's "design the no-image case as normal,
 * not an error." */
export async function fetchImageBlob(connection: Connection, path: string): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(`${serverOrigin(connection)}${path}`, {
      headers: { "X-Chronicle-Token": connection.token },
    });
  } catch (err) {
    throw connectionError(err);
  }
  if (res.status === 401) throw new AuthError();
  if (!res.ok) throw new ApiError(`request failed (${res.status})`, res.status);
  return res.blob();
}

export async function apiFetch(connection: Connection, path: string, options?: RequestInit): Promise<unknown> {
  const { status, body } = await apiFetchRaw(connection, path, options);
  if (status < 200 || status >= 300) {
    throw new ApiError((body as { error?: string }).error ?? `request failed (${status})`, status);
  }
  return body;
}

export type ConnectionStatus =
  | "unchecked"
  | "checking"
  | "connected"
  | "unauthorized"
  | "unreachable"
  | "origin-mismatch";

/** GET /models is the cheapest authenticated route to confirm the stored
 * address+passphrase actually reach this server — used for both the
 * Settings "Test" button and the boot-time connection check. */
export async function checkConnection(connection: Connection): Promise<ConnectionStatus> {
  try {
    await apiFetch(connection, "/models");
    return "connected";
  } catch (err) {
    if (err instanceof AuthError) return "unauthorized";
    // fetch() deliberately can't tell page JS *why* a cross-origin request
    // failed — a CORS block and a genuine network failure both surface as
    // the exact same opaque error, by design (browsers won't leak whether
    // the response even arrived). But the fix is different either way:
    // "reload from the address you configured" vs. "check the IP/
    // firewall" — and *that* distinction we can make client-side, since it
    // only depends on comparing the configured address against the origin
    // this page actually loaded from, not on inspecting the failed
    // request itself (see issue #34).
    if (typeof window !== "undefined" && serverOrigin(connection) !== window.location.origin) {
      return "origin-mismatch";
    }
    return "unreachable";
  }
}
