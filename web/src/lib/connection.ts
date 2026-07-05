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

export function serverOrigin(connection: Connection): string {
  return connection.serverAddress.trim().replace(/\/$/, "");
}
