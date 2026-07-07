# Running Chronicle as a service (Ubuntu host)

For the always-on home-LAN host, run the DM engine under **systemd** so it
starts on boot and restarts if it crashes — instead of leaving `npm run serve`
running in a terminal. This is only for the machine that *hosts* Chronicle;
phones and other devices just point a browser at it (see [`../SETUP.md`](../SETUP.md)).

Prerequisites: you've completed the one-time setup in `SETUP.md` (Node 22
installed, `npm run setup` run, `.env` filled in with `CHRONICLE_SHARED_SECRET`
and `HOST`, and — for a Claude subscription — a completed `claude` login, plus
optionally a `grok` login for images).

## Install

1. Copy the template and fill in the three `<PLACEHOLDER>` values
   (`User`, `WorkingDirectory`, `EnvironmentFile`, and confirm `ExecStart`):

   ```
   sudo cp deploy/chronicle.service /etc/systemd/system/chronicle.service
   sudo nano /etc/systemd/system/chronicle.service
   ```

   - `User` — the account that owns the checkout **and** ran `claude` / `grok`
     login (its `~/.claude` and `~/.grok` hold the credentials the engine uses).
   - `WorkingDirectory` / `EnvironmentFile` — absolute path to the repo.
   - `ExecStart` — must be an absolute npm path (`which npm`). systemd ignores
     your login PATH, and **nvm-installed node is invisible to it**. If your npm
     lives under `~/.nvm`, either hard-code that absolute path or install a
     system Node so `/usr/bin/npm` exists:
     ```
     curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
     sudo apt install -y nodejs
     ```

2. Enable and start it:

   ```
   sudo systemctl daemon-reload
   sudo systemctl enable --now chronicle
   ```

3. Confirm it's up:

   ```
   systemctl status chronicle
   ```

   You should see `active (running)` and the log line
   `Chronicle DM engine HTTP API listening on http://<HOST>:<PORT>`.

## Everyday commands

```
systemctl status chronicle          # is it running?
journalctl -u chronicle -f          # live logs (turns, permission decisions)
sudo systemctl restart chronicle    # after a `git pull` that changes src/
sudo systemctl stop chronicle       # take it down
```

There is no hot-reload — the server runs your checked-out `src/` as-is, so
**after pulling code changes, restart the service** or you'll keep running the
old code.

## Updating

```
cd <repo>
git pull
npm run setup        # reinstall deps + rebuild the UI into public/
sudo systemctl restart chronicle
```

## Validate the unit before installing

```
systemd-analyze verify deploy/chronicle.service
```

(Reports missing directives; the `<PLACEHOLDER>` values will read as literal
paths until you fill them in.)

## User-service alternative (no sudo)

If you can't use a system unit, run it as a user service instead: put the same
file (with `WantedBy=default.target`) in `~/.config/systemd/user/chronicle.service`,
then `systemctl --user enable --now chronicle`. To keep it running when you're
not logged in, enable lingering once: `sudo loginctl enable-linger <user>`.
