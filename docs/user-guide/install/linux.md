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

Most Linux distributions need Node.js installed.

### Recommended for most users (Ubuntu, Debian, Pop!_OS, Mint, etc.)

Run these commands one by one:

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
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

**What success looks like:** Type `node --version` and you should see a version number (v20 or higher is perfect).

---

## Step 3: Get Your Private Magic Key

1. Go to **https://console.anthropic.com** in any browser.

2. Sign up or log in (free account works great for solo play).

3. In the left menu click **API Keys** → **Create Key**.

4. Name it `Chronicle` and create it.

5. Copy the long key that starts with `sk-ant-`. Keep it somewhere safe for the next step.

---

## Step 4: Tell Chronicle Your Secret Handshake Code and Magic Key

1. Make sure you’re inside the `chronicle` folder:

   ```bash
   cd ~/chronicle
   ```

2. Copy the example file:

   ```bash
   cp .env.example .env
   ```

3. Open the file with a text editor. On servers and most terminals, `nano` is easiest:

   ```bash
   nano .env
   ```

4. You will see something like:

   ```
   CHRONICLE_SHARED_SECRET=my-secret
   HOST=127.0.0.1
   PORT=4317
   ANTHROPIC_API_KEY=
   ```

5. Edit it to look like this (use your own memorable phrase):

   ```
   CHRONICLE_SHARED_SECRET=my-favorite-dragon-is-red-and-gold
   HOST=192.168.1.42
   PORT=4317
   ANTHROPIC_API_KEY=sk-ant-api03-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   ```

   - Replace the secret code with something **you** will remember.
   - Paste your magic key from Step 3.
   - We’ll update the `HOST` address in the next step.

6. Save and exit:
   - In **nano**: Press `Ctrl` + `O` → Enter → `Ctrl` + `X`

---

## Step 5: Find Your Computer’s Address on the Home Network

Your phone needs to know where to find the storyteller.

Run this command:

```bash
ip addr show | grep "inet "
```

Or the simpler version:

```bash
hostname -I
```

You’ll see one or more addresses. Look for the one that starts with `192.168.` or `10.` (this is your local network address).  
Example output:

```
192.168.1.42
```

Write it down.

Now edit your `.env` file again and set the correct `HOST`:

```bash
nano .env
```

Change the `HOST` line to your actual address, for example:

```
HOST=192.168.1.42
```

Save and exit (`Ctrl` + `O` → Enter → `Ctrl` + `X`).

---

## Step 6: Install Chronicle’s Helper Files

While still in the `chronicle` folder, run:

```bash
npm install
```

This may take 1–2 minutes the first time. You’ll see a lot of text — that’s normal.

**What success looks like:** You’ll eventually see a line that says something like “added X packages” and the prompt returns.

---

## Step 7: Start Your Storyteller

Run:

```bash
npm run serve
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
npm run serve
```

Then press `Ctrl` + `A` then `D` to detach. Re-attach later with `screen -r chronicle`.

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
   # then download/extract chronicle here
   ```

2. **Make the storyteller start automatically on boot** (optional but nice):

   You can create a simple `systemd` service. Ask if you want the exact steps — it’s only a few lines.

3. **Change the port number** (see section below).

4. After setup, you can usually close the SSH session and the storyteller will keep running (especially if using `screen` or a systemd service).

---

## How to Change the Port Number

By default Chronicle uses port **4317**. You can change it to anything you like (for example 8080, 3000, or 9876).

### Steps:

1. Edit your `.env` file:

   ```bash
   nano .env
   ```

2. Change the `PORT` line to your desired number:

   ```
   PORT=9876
   ```

3. Save and exit.

4. **Important:** Also allow the new port in your firewall:

   ```bash
   sudo ufw allow 9876/tcp
   sudo ufw reload
   ```

5. Restart the storyteller (stop it with `Ctrl` + `C` in the terminal, then run `npm run serve` again).

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

Enter your **secret handshake code** and the beautiful leather journal interface will appear.

Continue to: **[Starting Your First Adventure](../first-adventure.md)**

---

**Need help?**  
Common things to double-check:
- Correct `HOST` IP address in `.env`
- Correct port allowed in `ufw`
- `npm install` completed without red errors
- `.env` file was saved after editing

You’re very close. A screenshot of any error message makes it easy for us to help you.