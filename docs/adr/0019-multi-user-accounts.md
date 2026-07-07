# ADR-0019: Multi-User Accounts

## Status
Accepted and implemented

## Context
Every prior slice assumed a single household of one trust level: one shared
passphrase (`CHRONICLE_SHARED_SECRET`) gated every request (ADR-0003),
campaigns lived flat under `campaigns/<id>/`, and "settings" existed only
per-campaign. ADR-0003 explicitly deferred multi-user as "a new decision when
that day comes." Issue #83 is that day: real people want their own accounts,
signed in from multiple devices, each seeing only their own characters, with
settings that act as **per-user defaults** overridable **per game**.

This is a state-file/data-model reshape, which ADR-0001 says is
architecturally significant enough to warrant its own ADR.

## Decision
1. **Full replace of the shared secret with per-user accounts.** The
   `CHRONICLE_SHARED_SECRET` gate is removed. Anyone who can reach the server
   can **register** a username + password (open signup — appropriate for a home
   LAN, and the server is still not internet-exposed per ADR-0003). Login issues
   an **opaque per-user session token**; that token — not a household passphrase
   — is sent on every request (reusing the existing `X-Chronicle-Token` header,
   so CORS and the client transport are unchanged).

2. **Passwords hashed with Node's built-in `crypto.scrypt`.** No new
   dependency — consistent with the raw-`node:http`, minimal-deps posture. Each
   account carries a random per-user salt; verification uses
   `timingSafeEqual`. Plaintext passwords are never stored or logged.

3. **Users live under a gitignored `users/` root**, one dir per user:
   - `account.json` — `{ id, username, passwordHash, passwordSalt, createdAt }`
   - `settings.json` — the user's **default** settings (the `CampaignSettings`
     family), seeded at registration from `.env` (see 5).
   - Session tokens are held in a single `users/_sessions.json` index
     (`token → { userId, createdAt, lastSeenMs }`) so the per-request
     `resolveSession` is one file read, not a scan of every user.

4. **Campaigns nest per user: `campaigns/<userId>/<campaignId>/`.** The user
   scoping is minimal because most of `campaign-store.ts` already operates on an
   absolute `campaignDir`; only the id→dir functions (`resolveCampaignDir`,
   `scaffoldCampaign`, `deleteCampaign`, `listCampaigns`,
   `newGameDefaultSettings`) take a `userId`. **`userId` always comes from the
   session, never the URL**, so a user is structurally unable to address another
   user's campaigns. The in-memory `activeSessions` map is keyed
   `${userId}/${campaignId}`. The shared `campaigns/_registry/` anti-repetition
   log stays top-level and cross-user (it is genre-neutral dedup, not player
   data).

5. **New users inherit default settings from `.env`.** `DEFAULT_MODEL`,
   `DEFAULT_PROVIDER`, `DEFAULT_ART_STYLE`, `DEFAULT_WORLD_SETTING`,
   `DEFAULT_TONE_WHIMSY`, `DEFAULT_CONTENT_INTENSITY`, `DEFAULT_RESPONSE_LENGTH`,
   `DEFAULT_GENERATE_IMAGES`, `DEFAULT_AUTO_ROLL_DICE`,
   `DEFAULT_AUTO_ILLUSTRATE` seed a new user's `settings.json`. A new campaign is
   then seeded from that user's defaults (and, secondarily, their most recently
   played game — ADR-0014's inheritance still applies within a user). Per-game
   overrides remain authoritative in each campaign's `campaign-settings.json`.

6. **One-time migration.** Existing flat campaigns (`test-campaign`, any real
   ones) move under a bootstrap user configured from `.env`
   (`BOOTSTRAP_USERNAME`/`BOOTSTRAP_PASSWORD`). The tracked `test-campaign`
   fixture is `git mv`-ed to preserve history and the `.gitignore` allowlist is
   updated to its nested path.

## Consequences
- Playtesting by multiple real people becomes possible, each isolated.
- Registration is open on the LAN; this is acceptable for a home network and
  documented, but is not an internet-facing posture (ADR-0003 still governs
  exposure; HTTPS remains out of scope).
- `users/` holds password hashes and must never enter git — a new `.gitignore`
  rule covers it, alongside the ADR-0005 campaign rules.
- The client's "connection" is now `{ serverAddress, token, username }` instead
  of `{ serverAddress, passphrase }`; the first screen is login/register.
- Backup/recovery of user + campaign data remains out of git's remit
  (ADR-0005) — a local backup strategy, decided separately.
