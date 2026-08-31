# Running Chronicle as a service (Ubuntu host)

For the always-on home-LAN host, run the DM engine under **systemd** so it
starts on boot and restarts if it crashes — instead of leaving `npm start`
running in a terminal. This is only for the machine that *hosts* Chronicle;
phones and other devices just point a browser at it (see [`../SETUP.md`](../SETUP.md)).

Prerequisites: you've completed the one-time setup in `SETUP.md` (Node 22
installed, `npm run setup` run, a completed `claude` login, plus optionally a
`grok` login for images). **Configuration lives in `config.json` / `secrets.json`
— NOT environment variables** (ADR-0033: the config loader ignores env). Set the
listen address in `config.json`:

```json
"server": { "host": "0.0.0.0", "port": 9999 }
```

`host: "0.0.0.0"` makes it reachable from other devices on your LAN (the
mobile-first UI, played from a phone); the default `127.0.0.1` is the host only.
Users register their own accounts in the app; there is no shared secret (ADR-0019).
If a host firewall (`ufw`) is active, allow the port on the LAN interface
(e.g. `sudo ufw allow 9999/tcp`).

## Recommended: systemd **user** service (no sudo except linger)

Runs as your login user, so the nvm node, `~/.claude` / `~/.grok` credentials,
and home-directory campaign data all resolve without the system-unit's
node-invisibility and permission caveats. Template:
[`chronicle.user.service`](chronicle.user.service).

```
mkdir -p ~/.config/systemd/user
cp deploy/chronicle.user.service ~/.config/systemd/user/chronicle.service
# edit WorkingDirectory to your checkout's absolute path
systemctl --user daemon-reload
systemctl --user enable --now chronicle
sudo loginctl enable-linger "$USER"   # start at boot without an interactive login
```

`ExecStart=/bin/bash -lc 'npm start'` uses a login shell so nvm's node/npm is on
PATH (robust against the nvm node version changing). `npm start` runs
`tsx src/server.ts` directly, so a **restart always runs the latest `src/`** —
no build step. The web UI is served from the committed `public/` bundle.

### Everyday commands (user service)

```
systemctl --user status chronicle       # is it running?
journalctl --user -u chronicle -f       # live logs (turns, permission decisions)
systemctl --user restart chronicle      # after a `git pull` that changes src/
systemctl --user stop chronicle         # take it down
```

You should see `active (running)` and the log line
`Chronicle DM engine HTTP API listening on http://<HOST>:<PORT>`.

There is no hot-reload — the server runs your checked-out `src/` as-is, so
**after pulling code changes, restart the service** or you'll keep running the
old code. If you changed front-end code, rebuild + commit the bundle first
(`npm run build:web`); the service serves `public/` and does not rebuild on start.

## Alternative: system unit (needs sudo)

If you must run it as a system service, use [`chronicle.service`](chronicle.service).
Fill in `User`, `WorkingDirectory`, and confirm `ExecStart` is an **absolute** npm
path (`which npm`) — systemd ignores your login PATH and **nvm node is invisible
to it**. If npm lives under `~/.nvm`, hard-code that path or install a system Node
so `/usr/bin/npm` exists:

```
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo cp deploy/chronicle.service /etc/systemd/system/chronicle.service
sudo nano /etc/systemd/system/chronicle.service
sudo systemctl daemon-reload
sudo systemctl enable --now chronicle
```

There is **no `EnvironmentFile`** — host/port come from `config.json`, not `.env`.

## Updating

```
cd <repo>
git pull
npm run setup                       # reinstall deps + rebuild the UI into public/
systemctl --user restart chronicle  # (or: sudo systemctl restart chronicle)
```

## Validate a unit before installing

```
systemd-analyze verify deploy/chronicle.user.service
```

(Reports missing directives; the `<PLACEHOLDER>` values read as literal paths
until you fill them in.)
