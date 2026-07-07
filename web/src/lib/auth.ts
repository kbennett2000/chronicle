// ADR-0019: login / register / logout against the server's /auth/* routes.
// These are the only calls made before a session token exists, so they take a
// raw server address (not a full Connection) and return the issued token.
import { serverOrigin, type Connection } from "./connection";

export interface AuthResult {
  token: string;
  username: string;
}

async function authRequest(
  serverAddress: string,
  path: string,
  body: { username: string; password: string }
): Promise<AuthResult> {
  const origin = serverOrigin({ serverAddress, token: "", username: "" });
  let res: Response;
  try {
    res = await fetch(`${origin}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      "Couldn't reach the home server — check the address and that it's running."
    );
  }
  const data = (await res.json().catch(() => ({}))) as { token?: string; username?: string; error?: string };
  if (!res.ok || !data.token) {
    throw new Error(data.error ?? `request failed (${res.status})`);
  }
  return { token: data.token, username: data.username ?? body.username };
}

export function login(serverAddress: string, username: string, password: string): Promise<AuthResult> {
  return authRequest(serverAddress, "/auth/login", { username, password });
}

export function register(serverAddress: string, username: string, password: string): Promise<AuthResult> {
  return authRequest(serverAddress, "/auth/register", { username, password });
}

/** Best-effort server-side session invalidation; a failure here still lets the
 * client drop its local token, so logout always "works" from the user's view. */
export async function logout(connection: Connection): Promise<void> {
  try {
    await fetch(`${serverOrigin(connection)}/auth/logout`, {
      method: "POST",
      headers: { "X-Chronicle-Token": connection.token },
    });
  } catch {
    /* ignore — local token is cleared regardless */
  }
}
