# Linux Setup Guide

You only have to do these steps **once**. After this, starting your storyteller is a single command.

This guide covers general Linux desktops and includes a dedicated section for **Ubuntu Server** (headless).

Take your time — every major step has a “what success looks like” note.

---

## Step 1: Download Chronicle

Download the `chronicle` folder (or zip) and place it somewhere easy to reach, such as your home folder (`~/chronicle`).

If it’s a zip, extract it:

```bash
unzip chronicle.zip -d ~
```

Then move into the folder:

```bash
cd ~/chronicle
```

---

## Step 2: Install the Storyteller Engine (Node.js)

Chronicle needs **Node.js version 22 or newer**.

### Recommended for most users (Ubuntu, Debian, Pop!_OS, Mint, etc.)

Run these commands one by one:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Fedora / Rocky / AlmaLinux

```bash
sudo dnf install -y nodejs
```

### Arch / Manjaro

```bash
sudo pacman -S nodejs npm
```

**What success looks like:** Type `node --version` and you should see a version number of **v22 or higher**.

---

## Step 3: Give the Storyteller Its Brain (Sign in to Claude)

The storyteller thinks and remembers using **Claude**. You give it permission by
signing in once with your own Claude account. Most people use a **Claude Pro or
Max subscription** — the same login you’d use at claude.ai.

1. Install the Claude sign-in helper (this uses the Node.js you just installed):

   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

2. Run it:

   ```bash
   claude
   ```

3. Follow the on-screen prompt to **log in with your Claude account**. When it’s
   done, your sign-in is saved safely under your home folder (`~/.claude`) — you
   won’t have to do it again.

**Good to know:** You do **not** need to paste any keys or codes. Chronicle uses
the Claude subscription you just signed in with. Don’t set an `ANTHROPIC_API_KEY`
environment variable — leaving it unset keeps billing on your subscription
instead of the per-token API.

> On a **headless server**, the `claude` login prints a URL to open in a browser
> on any device; paste the resulting code back into the terminal.

---

## Step 4: Create Your Settings File

Chronicle keeps its settings in a small file called `config.json`. For now we only
need to tell it your computer’s address on your home network — we’ll set that in
the next step.

1. Make sure you’re inside the `chronicle` folder:

   ```bash
   cd ~/chronicle
   ```

2. Copy the example settings file:

   ```bash
   cp config.example.json config.json
   ```

   (Chronicle will run without this — it falls back to the built-in defaults — but
   you’ll want your own `config.json` so you can set your network address.)

3. Open it with a text editor (`nano` is easiest on servers):

   ```bash
   nano config.json
   ```

4. Find the line that says `"host": "127.0.0.1",` (it’s inside the `"server"`
   section near the top). Leave it for now — we’ll change it to your real address
   in the next step. Everything else can stay exactly as it is. (There’s no secret
   code or key to add.)

5. Save and exit for now: `Ctrl` + `O` → Enter → `Ctrl` + `X`.

---

## Step 5: Find Your Computer’s Address on the Home Network

Your phone needs to know where to find the storyteller.

Run this command:

```bash
hostname -I
```

You’ll see one or more addresses. Look for the one that starts with `192.168.` or `10.` (this is your local network address). Example:

```
192.168.1.42
```

Write it down.

Now edit your `config.json` file again and set the correct address:

```bash
nano config.json
```

Change the value inside the `"host"` line to your actual address, keeping the
quotes and the comma exactly as they are — for example:

```json
    "host": "192.168.1.42",
```

Save and exit (`Ctrl` + `O` → Enter → `Ctrl` + `X`).

---

## Step 6: Install Chronicle’s Helper Files

While still in the `chronicle` folder, run:

```bash
npm run setup
```

This installs everything Chronicle needs and builds the app. It may take a
couple of minutes the first time. You’ll see a lot of text — that’s normal.

**What success looks like:** the scrolling stops and the prompt returns.

---

## Step 7: Start Your Storyteller

Run:

```bash
npm start
```

You should see a message that ends with:

```
Chronicle DM engine HTTP API listening on http://192.168.1.42:4317
```

**Write down or photograph the full address.** This is what you type on your phone.

Your storyteller is now running!

**Tip for keeping it running easily:**
If you want to close the terminal but keep the storyteller alive, install `screen` (or `tmux`) and run it inside:

```bash
sudo apt install screen          # Ubuntu/Debian
screen -S chronicle
npm start
```

Then press `Ctrl` + `A` then `D` to detach. Re-attach later with `screen -r chronicle`.

(For an always-on server, a `systemd` service is even better — see the
[deploy guide](../../../deploy/README.md).)

---

## Step 8: Allow the Port Through Your Firewall (Important on Servers)

On Ubuntu and many other distros that use `ufw`:

```bash
sudo ufw allow 4317/tcp
sudo ufw reload
```

Check status with:

```bash
sudo ufw status
```

You should see port 4317 allowed.

On other firewalls (firewalld, etc.) the command is slightly different — let us know your distro if you need help.

---

## Ubuntu Server Specific Notes

Ubuntu Server is perfect for running Chronicle because it uses very little resources and can stay on 24/7.

### Recommended extra steps for a clean server setup:

1. **Create a dedicated user** (optional but tidy):

   ```bash
   sudo adduser chronicle
   sudo usermod -aG sudo chronicle
   su - chronicle
   cd ~
   # then download/extract chronicle here, and do the `claude` sign-in as THIS user
   ```

   > Whichever user runs the server must be the same user that ran the `claude`
   > sign-in in Step 3 (the login lives in that user’s home folder).

2. **Make the storyteller start automatically on boot** (recommended for a
   server): use the ready-made `systemd` service in the
   [deploy guide](../../../deploy/README.md) so it survives reboots and crashes.

3. **Change the port number** (see section below).

4. After setup, you can usually close the SSH session and the storyteller will keep running (especially with a systemd service or `screen`).

---

## How to Change the Port Number

By default Chronicle uses port **4317**. You can change it to anything you like (for example 8080, 3000, or 9876).

### Steps:

1. Edit your `config.json` file:

   ```bash
   nano config.json
   ```

2. Find the `"port"` line inside the `"server"` section and change the number
   (keep the quotes-free number and the surrounding structure as they are):

   ```json
    "port": 9876
   ```

3. Save and exit.

4. **Important:** Also allow the new port in your firewall:

   ```bash
   sudo ufw allow 9876/tcp
   sudo ufw reload
   ```

5. Restart the storyteller (stop it with `Ctrl` + `C` in the terminal, then run `npm start` again).

6. Use the **new port** in the address you type on your phone:

   ```
   http://192.168.1.42:9876
   ```

That’s all — the storyteller will now listen on your chosen port.

---

## You Did It! 🎉

Your personal Dungeon Master is now running on Linux.

**Next step:**  
On your phone or tablet, open any browser and type the address you wrote down (including the correct port).

The very first time, you’ll **create your own account** — just pick a username
and password right there in the app. No secret codes. After that you simply log
in, and the beautiful leather journal interface will appear.

Continue to: **[Starting Your First Adventure](../first-adventure.md)**

---

**Need help?**  
Common things to double-check:
- Correct `host` IP address in `config.json`
- Correct port allowed in `ufw`
- `npm run setup` completed without red errors
- The `claude` sign-in in Step 3 was done (as the same user that runs the server)
- `config.json` was saved after editing (and is still valid JSON — commas and quotes intact)

You’re very close. A screenshot of any error message makes it easy for us to help you. See also **[Help & Troubleshooting](../help-and-troubleshooting.md)**.
