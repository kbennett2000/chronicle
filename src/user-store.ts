import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { secrets } from "./config.js";

// ADR-0019: per-user accounts. Users live under a gitignored `users/` root,
// one directory per user, keyed by a slug of the username. Passwords are hashed
// with Node's built-in scrypt (no new dependency). Session tokens live in one
// global index file so the per-request lookup is a single read, not a scan.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const USERS_ROOT = path.resolve(__dirname, "../users");

/** Same shape as a campaign id: lowercase, starts alphanumeric. Deliberately
 * excludes anything starting with `_` so index files (`_sessions.json`) can
 * never collide with a real user dir. */
export const USER_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export class InvalidUsernameError extends Error {}
export class UsernameTakenError extends Error {}
export class InvalidCredentialsError extends Error {}

export interface UserAccount {
  id: string;
  username: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
}

export interface PublicUser {
  id: string;
  username: string;
}

/** Derive a filesystem-safe user id from a username: lowercase, runs of
 * non-alphanumerics collapse to a single hyphen, trimmed of leading/trailing
 * hyphens. Two usernames that slug to the same id are the same account
 * (case-insensitive uniqueness). */
export function userIdForUsername(username: string): string {
  return username
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function userDir(userId: string): string {
  return path.join(USERS_ROOT, userId);
}

function accountFile(userId: string): string {
  return path.join(userDir(userId), "account.json");
}

function userSettingsFile(userId: string): string {
  return path.join(userDir(userId), "settings.json");
}

const SESSIONS_FILE = path.join(USERS_ROOT, "_sessions.json");

function ensureUsersRoot(): void {
  fs.mkdirSync(USERS_ROOT, { recursive: true });
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

export function userExists(userId: string): boolean {
  return USER_ID_PATTERN.test(userId) && fs.existsSync(accountFile(userId));
}

export function readAccount(userId: string): UserAccount | null {
  if (!userExists(userId)) return null;
  try {
    return JSON.parse(fs.readFileSync(accountFile(userId), "utf8")) as UserAccount;
  } catch {
    return null;
  }
}

/** Create a new account. Rejects a blank/invalid username or a username whose
 * slug already exists. `defaults` seeds the user's default settings.json
 * (ADR-0019: seeded from `.env` at registration). Returns the public user. */
export function createUser(
  username: string,
  password: string,
  defaults: Record<string, unknown> = {}
): PublicUser {
  const trimmed = username.trim();
  const id = userIdForUsername(trimmed);
  if (!trimmed || !USER_ID_PATTERN.test(id)) {
    throw new InvalidUsernameError(
      "username must contain at least one letter or number"
    );
  }
  if (!password || password.length < 6) {
    throw new InvalidCredentialsError("password must be at least 6 characters");
  }
  ensureUsersRoot();
  if (fs.existsSync(userDir(id))) {
    throw new UsernameTakenError(`username '${trimmed}' is already taken`);
  }
  fs.mkdirSync(userDir(id), { recursive: true });
  const salt = crypto.randomBytes(16).toString("hex");
  const account: UserAccount = {
    id,
    username: trimmed,
    passwordHash: hashPassword(password, salt),
    passwordSalt: salt,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(accountFile(id), JSON.stringify(account, null, 2) + "\n");
  fs.writeFileSync(userSettingsFile(id), JSON.stringify(defaults, null, 2) + "\n");
  return { id, username: trimmed };
}

/** Outcome of ensureBootstrapUser — lets callers log/handle each case. */
export type BootstrapResult =
  | { status: "created"; username: string; userId: string }
  | { status: "exists"; username: string; userId: string }
  | { status: "skipped"; username: string; userId: string; reason: string };

/** Idempotently ensure the bootstrap account (secrets.bootstrap.username, default
 * "kris"; secrets.bootstrap.password) exists (issue #94, ADR-0033). Shared by the
 * server (called on startup so the account works out of the box) and the one-time
 * migration. Never overwrites or downgrades an existing account, and never throws
 * for the predictable config cases (missing/short password, empty username slug) —
 * it returns a "skipped" result so a caller can log and carry on (the server) or
 * hard-fail (the migration). */
export function ensureBootstrapUser(
  defaults: Record<string, unknown> = {}
): BootstrapResult {
  const username = secrets.bootstrap.username || "kris";
  const userId = userIdForUsername(username);
  if (!USER_ID_PATTERN.test(userId)) {
    return {
      status: "skipped",
      username,
      userId,
      reason: `bootstrap username "${username}" has no letters or numbers`,
    };
  }
  if (userExists(userId)) return { status: "exists", username, userId };
  const password = secrets.bootstrap.password;
  if (!password || password.length < 6) {
    return {
      status: "skipped",
      username,
      userId,
      reason: "bootstrap password is unset or shorter than 6 characters",
    };
  }
  createUser(username, password, defaults);
  return { status: "created", username, userId };
}

/** Verify a username + password. Returns the public user on success, null on
 * any failure (unknown user or wrong password) — callers must not distinguish
 * the two to the client. */
export function verifyLogin(username: string, password: string): PublicUser | null {
  const id = userIdForUsername(username);
  const account = readAccount(id);
  if (!account) {
    // Still spend ~a hash so a missing user isn't obviously faster than a
    // wrong password. Best-effort timing hygiene, not a hard guarantee.
    hashPassword(password, "0".repeat(32));
    return null;
  }
  const candidate = Buffer.from(hashPassword(password, account.passwordSalt), "hex");
  const stored = Buffer.from(account.passwordHash, "hex");
  if (candidate.length !== stored.length || !crypto.timingSafeEqual(candidate, stored)) {
    return null;
  }
  return { id: account.id, username: account.username };
}

// ── Session tokens ──────────────────────────────────────────────────────────

interface SessionRecord {
  userId: string;
  createdAt: string;
  lastSeenMs: number;
}

function readSessions(): Record<string, SessionRecord> {
  if (!fs.existsSync(SESSIONS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8")) as Record<string, SessionRecord>;
  } catch {
    return {};
  }
}

function writeSessions(sessions: Record<string, SessionRecord>): void {
  ensureUsersRoot();
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2) + "\n");
}

/** Mint a new opaque session token for a user and persist it. */
export function createSession(userId: string): string {
  const token = crypto.randomBytes(32).toString("hex");
  const sessions = readSessions();
  sessions[token] = { userId, createdAt: new Date().toISOString(), lastSeenMs: Date.now() };
  writeSessions(sessions);
  return token;
}

/** Resolve a session token to its user id, or null if unknown. Updates the
 * token's lastSeen lazily (best-effort; a write failure never blocks auth). */
export function resolveSession(token: string | undefined): string | null {
  if (!token) return null;
  const sessions = readSessions();
  const record = sessions[token];
  if (!record || !userExists(record.userId)) return null;
  try {
    record.lastSeenMs = Date.now();
    writeSessions(sessions);
  } catch {
    // lastSeen is a nicety, not required for auth
  }
  return record.userId;
}

/** Invalidate a single session token (logout). No-op if unknown. */
export function deleteSession(token: string | undefined): void {
  if (!token) return;
  const sessions = readSessions();
  if (sessions[token]) {
    delete sessions[token];
    writeSessions(sessions);
  }
}

// ── Per-user default settings ────────────────────────────────────────────────

/** A user's default settings (the seed for every new campaign). Stored as a
 * loose record so it can carry the CampaignSettings family plus future
 * additions (e.g. music) without this module importing campaign-store. */
export function readUserSettings(userId: string): Record<string, unknown> {
  const file = userSettingsFile(userId);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Merge-write, like campaign settings: never clobber sibling fields. Nested
 * plain-object values (e.g. `music`) are merged one level deep, so a partial
 * patch like `{ music: { source } }` keeps the stored `{ music: { enabled } }`
 * — issue #95: a shallow top-level spread replaced the whole `music` object,
 * dropping `enabled`, which then re-defaulted to false and switched music off
 * the moment the user changed the source or Navidrome URL. An empty-string
 * artStyle/worldSetting clears that field back to absent. */
export function writeUserSettings(
  userId: string,
  updates: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...readUserSettings(userId) };
  for (const [key, value] of Object.entries(updates)) {
    const prev = merged[key];
    merged[key] =
      isPlainObject(prev) && isPlainObject(value) ? { ...prev, ...value } : value;
  }
  if (merged.artStyle === "") delete merged.artStyle;
  if (merged.worldSetting === "") delete merged.worldSetting;
  fs.mkdirSync(userDir(userId), { recursive: true });
  fs.writeFileSync(userSettingsFile(userId), JSON.stringify(merged, null, 2) + "\n");
  return merged;
}
