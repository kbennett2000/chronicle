import { type Connection, serverOrigin } from "./connection";

export class AuthError extends Error {
  constructor() {
    super("Not authorized — check the server address and passphrase in Settings.");
  }
}

export class ApiError extends Error {}

/** Every route but static asset serving requires this header (ADR-0003). */
export async function apiFetch(
  connection: Connection,
  path: string,
  options?: RequestInit
): Promise<unknown> {
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
  if (!res.ok) {
    throw new ApiError((body as { error?: string }).error ?? `request failed (${res.status})`);
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
