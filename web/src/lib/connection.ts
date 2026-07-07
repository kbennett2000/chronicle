// ADR-0019: the client "connection" is now a server address plus a per-user
// session token and the username it belongs to (was: a shared passphrase).
// Stored client-side only, obtained by logging in / registering on the Auth
// screen. The token is sent as the X-Chronicle-Token header on every request.
// Key is bumped (.v2) so a device that still has an old {serverAddress,
// passphrase} blob starts clean at the login screen instead of half-migrated.
const CONNECTION_KEY = "chronicle.connection.v2";

export interface Connection {
  serverAddress: string;
  token: string;
  username: string;
}

const EMPTY_CONNECTION: Connection = { serverAddress: "", token: "", username: "" };

export function loadConnection(): Connection {
  try {
    const raw = localStorage.getItem(CONNECTION_KEY);
    if (!raw) return EMPTY_CONNECTION;
    const parsed = JSON.parse(raw);
    return {
      serverAddress: typeof parsed.serverAddress === "string" ? parsed.serverAddress : "",
      token: typeof parsed.token === "string" ? parsed.token : "",
      username: typeof parsed.username === "string" ? parsed.username : "",
    };
  } catch {
    return EMPTY_CONNECTION;
  }
}

export function saveConnection(connection: Connection): void {
  localStorage.setItem(CONNECTION_KEY, JSON.stringify(connection));
}

export function clearConnection(): void {
  // Keep the server address so the next login pre-fills it; drop the token.
  const { serverAddress } = loadConnection();
  saveConnection({ serverAddress, token: "", username: "" });
}

/** Authenticated when a session token is present. */
export function hasConnection(connection: Connection): boolean {
  return connection.token.trim() !== "";
}

/** The address field's own placeholder ("192.168.1.24:4317") is bare
 * host:port, no scheme — and a scheme-less string here isn't just cosmetic:
 * fetch() only recognizes a leading alpha scheme (`^[a-zA-Z][a-zA-Z0-9+.-]*:`),
 * so a leading digit like "192" fails that check and the whole string gets
 * treated as a *relative* path against the page's own origin instead of an
 * absolute target. That silently sends every request to the wrong origin's
 * SPA-fallback route (200 + index.html) instead of a real API response or a
 * loud connection failure — see issue #33. */
export function serverOrigin(connection: Connection): string {
  const trimmed = connection.serverAddress.trim().replace(/\/$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}
