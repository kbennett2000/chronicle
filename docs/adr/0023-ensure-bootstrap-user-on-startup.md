# ADR-0023: Ensure the bootstrap user on server startup

## Status
Accepted

## Context
ADR-0019 replaced the shared passphrase with per-user accounts. The `.env`
`BOOTSTRAP_USERNAME` / `BOOTSTRAP_PASSWORD` pair configures a "bootstrap" account
that owns the campaigns which existed before the multi-user migration, and the
`.env` comment tells the operator *"you'll log in with these."*

But nothing made that promise true on a fresh install. The bootstrap account is
created **only** by `npm run migrate:multi-user` (or by an explicit `/auth/register`
in the app) — the server never reads `BOOTSTRAP_*`. Login authenticates purely
against `users/<id>/account.json` via `verifyLogin`. So an operator who set
`admin`/`password` in `.env` and started the server with `tsx` (the documented run
command) got a `401 "incorrect username or password"` for `admin`/`password`,
because `users/admin/` did not exist. This is issue #94 — a confusing first-run
failure, especially for a new user with no pre-existing campaigns to migrate, who
has no reason to run a "migration" at all.

## Decision
The server **ensures the bootstrap account exists on startup**. A shared
`ensureBootstrapUser()` helper in `src/user-store.ts` is called from the
`server.listen` callback with the same `newUserDefaultSettings()` a registered user
receives.

Guarantees:
- **Idempotent, never destructive.** If the account already exists it is left
  exactly as-is — the helper never overwrites or downgrades a password. (So editing
  `BOOTSTRAP_PASSWORD` after the account exists still has no effect; changing an
  existing user's password remains out of scope.)
- **Never crashes the server.** For the predictable misconfigurations — an unset or
  under-6-char `BOOTSTRAP_PASSWORD`, or a `BOOTSTRAP_USERNAME` that slugs to an
  empty id — it returns a `"skipped"` result and the server logs a one-line notice
  and continues (open registration still works).
- **One source of truth.** `npm run migrate:multi-user` now calls the same helper,
  so the "create the bootstrap user if missing" rule lives in one place. The
  migration keeps its stricter stance: a `"skipped"` result is a hard failure there,
  because it needs the user to exist to own the campaigns it is about to move.

## Consequences
- `admin`/`password` (or whatever `.env` says) works immediately after the first
  `tsx src/server.ts`, matching what the `.env` comment already promised. The
  migration is once again *only* about relocating pre-existing flat campaigns.
- The bootstrap account is auto-provisioned from `.env`. This does not change the
  trust model: ADR-0019 already made signup open on the LAN, so anyone who can
  reach the server could always create an account. The bootstrap user is created
  *only when missing* and only from credentials the operator themselves put in
  `.env`. Operators on an untrusted network should firewall the port (per SETUP)
  and choose a real password — the same guidance as before.
- No schema or API change; login, registration, and session handling are untouched.
