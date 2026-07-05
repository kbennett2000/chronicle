// Per ADR-0003: server address + shared-secret passphrase, entered once in
// Settings -> The Hearth, stored client-side only (never sent anywhere but
// this configured server).
const CONNECTION_KEY = "chronicle.connection";

export interface Connection {
  serverAddress: string;
  passphrase: string;
}

const EMPTY_CONNECTION: Connection = { serverAddress: "", passphrase: "" };

export function loadConnection(): Connection {
  try {
    const raw = localStorage.getItem(CONNECTION_KEY);
    if (!raw) return EMPTY_CONNECTION;
    const parsed = JSON.parse(raw);
    return {
      serverAddress: typeof parsed.serverAddress === "string" ? parsed.serverAddress : "",
      passphrase: typeof parsed.passphrase === "string" ? parsed.passphrase : "",
    };
  } catch {
    return EMPTY_CONNECTION;
  }
}

export function saveConnection(connection: Connection): void {
  localStorage.setItem(CONNECTION_KEY, JSON.stringify(connection));
}

export function hasConnection(connection: Connection): boolean {
  return connection.passphrase.trim() !== "";
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
