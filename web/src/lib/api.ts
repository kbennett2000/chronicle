import { type Connection, serverOrigin } from "./connection";

export class AuthError extends Error {
  constructor() {
    super("Not authorized — check the server address and passphrase in Settings.");
  }
}

export class ApiError extends Error {}

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
        "X-Chronicle-Token": connection.passphrase,
        ...options?.headers,
      },
    });
  } catch (err) {
    throw new ApiError(err instanceof Error ? err.message : "could not reach the server");
  }

  if (res.status === 401) throw new AuthError();

  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

export async function apiFetch(connection: Connection, path: string, options?: RequestInit): Promise<unknown> {
  const { status, body } = await apiFetchRaw(connection, path, options);
  if (status < 200 || status >= 300) {
    throw new ApiError((body as { error?: string }).error ?? `request failed (${status})`);
  }
  return body;
}

export type ConnectionStatus = "unchecked" | "checking" | "connected" | "unauthorized" | "unreachable";

/** GET /models is the cheapest authenticated route to confirm the stored
 * address+passphrase actually reach this server — used for both the
 * Settings "Test" button and the boot-time connection check. */
export async function checkConnection(connection: Connection): Promise<ConnectionStatus> {
  try {
    await apiFetch(connection, "/models");
    return "connected";
  } catch (err) {
    if (err instanceof AuthError) return "unauthorized";
    return "unreachable";
  }
}
