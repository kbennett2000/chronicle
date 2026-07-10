# SETUP — installing and LAN hosting

Chronicle's DM engine runs as a local HTTP server on one machine (the "host")
on your home network; phones and other devices play through a browser pointed
at it. This doc covers installing and running the host on **Ubuntu, macOS, or
Windows**, then the LAN networking steps.

Per [ADR-0003](docs/adr/0003-lan-exposure-auth.md) this is a
single-household-LAN posture — no HTTPS. Auth is **per-user accounts**
([ADR-0019](docs/adr/0019-multi-user-accounts.md)): each person registers a
username + password in the app and logs in from any device (open signup on your
LAN). Deployment/packaging rationale (and why not Docker) is in
[ADR-0017](docs/adr/0017-deployment-and-packaging.md).

---

## Part A — Install & run the host

### A1. Prerequisites

- **Node.js 22+.** The repo pins this via `.nvmrc` / `engines`. Install:
  - **Ubuntu:** `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs`
    (a system Node also makes the systemd service simpler — see
    [`deploy/README.md`](deploy/README.md)).
  - **macOS:** `brew install node@22` — or [nvm](https://github.com/nvm-sh/nvm)
    then `nvm install` (reads `.nvmrc`).
  - **Windows:** the installer from [nodejs.org](https://nodejs.org/) (LTS 22),
    or `winget install OpenJS.NodeJS.LTS`.

- **A Claude login for the DM engine.** Chronicle uses your **Claude
  subscription** by default. Log in once with the Claude CLI (Claude Code) so
  the credentials sit under `~/.claude` — the engine's Agent SDK picks them up
  automatically:
  ```
  claude       # then complete the login prompt
  ```
  **Leave `ANTHROPIC_API_KEY` unset** — if it's set, the engine bills the
  per-token API instead of your subscription. (See ADR-0017 for the caveat that
  subscription use of the SDK is an undocumented reliance.)

- **(Optional) images.** Scene art and portraits are **not** required to play.
  They come from a pluggable backend — the **Grok Build** `grok` CLI (default)
  or a **local ComfyUI/SDXL** engine on the host GPU. The simplest is `grok`:
  install and log in on the host (auth under `~/.grok`), so it's on the host
  user's `PATH`. Both options (and optional video) are covered in Part C.

### A2. Install dependencies & build the UI

From the repo root, one command installs both packages and builds the mobile UI:

```
npm run setup
```

(Under the hood: `npm ci` for the backend, `npm ci` for `web/`, then the Vite
build into `public/`, which the server serves.)

### A3. Configure `config.json` and `secrets.json`

Chronicle reads settings from two JSON files at the repo root (ADR-0033). A fresh
checkout boots from the committed `config.example.json` with no setup; copy the
templates when you want to change something:

```
cp config.example.json config.json      # non-secret settings
cp secrets.example.json secrets.json     # passwords
```

In `config.json`, set at least the server host so other devices can reach it:

```jsonc
{
  "server": {
    "host": "192.168.1.42",   // the host's LAN IP, or "0.0.0.0" for all interfaces
    "port": 4317               // optional; the listening port
  }
}
```

In `secrets.json`, set the "bootstrap" account that will own any campaigns that
already exist (test-campaign, and any you were already playing) — you'll log in
with these, and the migration in A3.5 creates the account:

```json
{ "bootstrap": { "username": "kris", "password": "pick-a-real-password" } }
```

`config.json` and `secrets.json` are gitignored — they never get committed. There
is **no shared passphrase anymore**; each person makes their own account in the app.
`server.host` defaults to `127.0.0.1` (this machine only); set it to the LAN IP (or
`0.0.0.0`) to reach the host from other devices. See
[`docs/configuration.md`](docs/configuration.md) for every setting, including the
optional `defaults.*` a brand-new account inherits.

### A3.5. Migrate existing campaigns to multi-user (one-time)

If this host already has campaigns from before multi-user (`test-campaign`, or
real games), move them under your bootstrap account:

```
npm run migrate:multi-user
```

This creates the bootstrap-username account and nests existing campaigns under
it (`campaigns/<user>/<campaign>/`). It's idempotent and refuses to run if the
tracked `test-campaign` fixture has uncommitted changes. A brand-new install
with no campaigns can skip this — just register in the app.

### A4. Start the server

```
npm start
```

You should see:

```
Chronicle DM engine HTTP API listening on http://<your HOST value>:4317
```

For the always-on Ubuntu host, run it under **systemd** instead so it survives
reboots and crashes — see [`deploy/README.md`](deploy/README.md).

---

## Part B — LAN networking

### B1. Reserve a stable address for the host

Devices need a consistent way to reach the host. Pick one:

- **Static LAN IP (recommended, simplest):** in your router's admin page, find
  DHCP reservations (a.k.a. "address reservation" / "static lease") and reserve
  an IP for the host's MAC address. Find the host's current IP/MAC with
  `ip addr show` (Linux), `ifconfig` (macOS), or `ipconfig /all` (Windows).
- **mDNS hostname:** if your router can't reserve, use `<hostname>.local`
  (built in on macOS/Windows; on Ubuntu `sudo apt install avahi-daemon`). Then
  use `http://<hostname>.local:4317` everywhere below.

### B2. Open the port in the firewall

Default port is `4317` (override with `server.port` in `config.json`).

- **Ubuntu (ufw):**
  ```
  sudo ufw allow 4317/tcp
  sudo ufw reload
  sudo ufw status
  ```
- **macOS / Windows:** allow inbound TCP on the port if the OS firewall prompts
  (Windows Defender Firewall usually prompts on first bind — allow it on
  Private networks).

### B3. Point the mobile UI at the host and log in

From a phone or second PC on the same LAN, open:

```
http://<HOST / hostname from B1>:4317
```

You'll land on the **login screen**. Set:

- **Server address:** `<HOST from B1>:4317` (the page pre-fills this from the
  address you loaded it from).
- **Username / Password:** your account. Tap **Create account** the first time
  (or, on the host that ran the A3.5 migration, log in as your
  `secrets.bootstrap.username`). Each person on the household gets their own account and
  sees only their own chronicles.

The app stores your session token in that device's local storage and stays
logged in until you log out (Settings → The Hearth → Log out).

### B4. Validate

From the second device:

- Confirm you can register/log in and reach your chronicles, and that the Story
  tab starts/resumes a session and you can send a turn.
- Confirm a wrong password is rejected at login with an error.
- Confirm isolation: a second account sees only its own characters, not the
  first account's.
- (Optional, host machine) If you enabled Grok as a DM engine (Part C), you can
  sanity-check parity with `npm run verify:grok-parity` — it plays a throwaway
  scratch campaign on Grok end-to-end (opening, turns, image, resume, and a
  Grok→Claude switch), self-cleans, and never touches your real campaigns. Each
  real DM turn takes minutes, so this is a manual check, not part of the tests.

---

## Part C — (Optional) Enable images, video, and/or Grok as the DM engine

**None of this is required to play** — the default DM engine is Claude, and
images are off by default. There are three independent optional features here:

- **Scene art & portraits** — a **pluggable image backend** (ADR-0027):
  **Grok Build** (default, zero infrastructure) *or* a **local ComfyUI/SDXL**
  engine on the host's own GPU (no per-image cost). Pick per campaign in the UI.
- **Video clips ("Animate")** — short on-demand clips via **Grok Imagine**
  (ADR-0026).
- **Grok as the DM engine** — run a campaign's DM on Grok instead of Claude,
  chosen per campaign (ADR-0018). To switch: open **Settings → The Engine** (or
  the New Chronicle screen) and change the engine toggle from **Claude** to
  **Grok**, then pick a Grok model. Provider and model are per-campaign, and
  switching either resets that campaign's DM session.

### C1. Grok Build — the zero-infra image/video default

1. Install and authenticate `grok` on the host machine, so it's on the host
   user's `PATH` and logged in to an account with Grok Build / image access. If
   the CLI is authenticated interactively (`~/.grok`), no `XAI_API_KEY` is
   needed. (When running under systemd, the service `User` must be the
   same account that ran `grok login` — see `deploy/README.md`.)
2. In the app, open **Settings → The Look** and turn on **Generate scene art**
   (optionally pick an art style). Grok is the default image provider, so
   nothing else is needed.

If `grok` isn't installed/authenticated, the app shows the exact error (e.g.
"grok CLI not found on PATH") instead of silently doing nothing.

### C2. Local ComfyUI/SDXL — draw on your own GPU (optional alternative)

Instead of Grok, images can be drawn locally by a **ComfyUI** service running
SDXL on the host GPU — no per-image cost and no external dependency (ADR-0027).
This needs suitable hardware (~12GB VRAM handles SDXL base+refiner by swapping).

1. Run **ComfyUI** as an always-on local service on the host (bound to
   `localhost:8188`), with **SDXL base + refiner** checkpoints installed under
   its `models/checkpoints/`. Chronicle reaches it at `comfyui.url` in
   `config.json` (default `http://localhost:8188`; set it only if you moved it,
   e.g. to a remote GPU host). ComfyUI is
   unauthenticated by design and must stay on `localhost` / the trusted LAN
   (ADR-0027) — never expose it.
2. For **LoRA-backed art styles** (pixel art, claymation, ukiyo-e, etc. —
   ADR-0032), drop the style LoRA files into ComfyUI's `models/loras/`; the
   recipes are declared in `src/image-backends/style-loras.ts` (no server change
   to add one). ComfyUI rescans LoRAs live.
3. In the app, set the **image provider** to **Local** for the campaign
   (Settings → The Look). Provider is per-campaign and freely switchable
   mid-game — flipping it just changes who draws the *next* image. Quality tier
   (fast/standard/high, ADR-0029) and scene-style adherence (ADR-0028) apply on
   this backend.

Sanity-check the local backend on the host with `npx tsx scripts/verify-comfyui.ts`
(draws one real image) and `npx tsx scripts/verify-lora-styles.ts`.

### C3. Illustrating & animating in play

With an image provider configured, illustrations are available two ways:

- **Views** tab → any un-illustrated tile has a **✎ Draw this** button.
- Under any DM response → **⟢ Illustrate this moment**.

The DM may also generate an image on its own when a new character, NPC, or
location first appears. To enable **video**, turn on **Generate video clips** in
Settings (needs Grok Build per C1); an **Animate** affordance then appears on
scene art and entity portraits (video is always on-demand — never auto).

---

## Part D — (Optional) Music (ADR-0020)

Background music is off by default. Turn it on per account in **Settings → The
Music**, then pick a source. When music is on, a mute button appears in Active
Play. Two sources:

- **Local files** — drop `.mp3/.wav/.ogg/.flac/.m4a` into a `music/` folder at
  the repo root (any sub-folder layout). `music/` is gitignored — it's your own
  media. The app shuffles and plays them.
- **Navidrome** — stream a playlist from a [Navidrome](https://navidrome.org)
  server on your LAN, proxied through this server (the browser never sees the
  Navidrome credentials). Put the non-secret URL/playlist in `config.json`:
  ```json
  { "navidrome": { "url": "http://192.168.1.214:4533", "playlist": "chronicle" } }
  ```
  and the credentials in `secrets.json`:
  ```json
  { "navidrome": { "username": "your-navidrome-username", "password": "your-navidrome-password" } }
  ```
  A user can override the URL and playlist in Settings; the credentials stay on
  the host. Restart the server after changing config.

You can seed a default for new accounts with `defaults.musicEnabled` /
`defaults.musicSource` in `config.json` (see
[`docs/configuration.md`](docs/configuration.md)).

---

## Notes

- This setup is for one trusted household LAN. Don't port-forward `4317` on your
  router or otherwise expose it to the public internet — explicitly out of scope
  (ADR-0003).
- No hot-reload: the server runs your checked-out `src/` as-is. After a
  `git pull` that changes code, restart the server (or `npm run setup` first if
  dependencies or the UI changed).
- If you switch networks (host moved, router replaced), redo the DHCP
  reservation and update the mobile UI's Server address.
