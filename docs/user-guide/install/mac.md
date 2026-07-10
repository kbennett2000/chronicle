# Mac Setup Guide

You only have to do these steps **once**. After this, starting Chronicle is just a couple of clicks.

Take your time — every step includes “what you should see” notes so you always know you’re on track.

---

## Step 1: Download Chronicle

1. Download the `chronicle` folder (or zip file) and save it somewhere easy to find, like your Desktop or Documents folder.
2. If it came as a zip, double-click it to extract. Then open the `chronicle` folder.

You should now see files including `package.json`, a `src` folder, and a `public` folder inside `chronicle`.

---

## Step 2: Install the Storyteller Engine (Node.js)

Chronicle needs a free helper called the **Storyteller Engine**.

### Easiest method (recommended):

1. Open Safari or any browser and go to:  
   **https://nodejs.org**

2. Click the big green **LTS** button on the left (Long Term Support). *(Chronicle needs version 22 or newer — the LTS button gives you that.)*

3. Double-click the downloaded `.pkg` file and follow the installer:
   - Click **Continue**
   - Click **Install** (you may need to enter your Mac password)
   - Click **Close** when finished.

### Alternative (if you already use Homebrew):

Open Terminal and run:

```bash
brew install node@22
```

**What you should see:** Node.js is now installed. You can close the installer.

---

## Step 3: Give the Storyteller Its Brain (Sign in to Claude)

The storyteller thinks and remembers using **Claude**. You give it permission by
signing in once with your own Claude account. Most people use a **Claude Pro or
Max subscription** — the same login you’d use at claude.ai.

1. Open the **Terminal** app (press `Command + Space`, type “Terminal”, press Return).

2. Install the Claude sign-in helper by typing this and pressing Return:

   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

   (This uses the Node.js you just installed. It takes a minute.)

3. Now type this and press Return:

   ```bash
   claude
   ```

4. Follow the on-screen prompt to **log in with your Claude account** in the
   browser window it opens. When it’s done, your sign-in is saved safely on this
   Mac — you won’t have to do it again.

5. That’s the brain sorted. 🧠

**Good to know:** You do **not** need to paste any keys or codes. Chronicle uses
the Claude subscription you just signed in with. (Don’t set an `ANTHROPIC_API_KEY`
environment variable — leaving it unset keeps billing on your subscription.)

---

## Step 4: Create Your Settings File

Chronicle keeps its settings in a small file called `config.json`. For now we only
need to tell it your Mac’s address on your home network — we’ll fill that in a
moment.

1. Open your `chronicle` folder in Finder.

2. Find the file named `config.example.json`.

3. Press `Command + C` to copy it, then `Command + V` to paste a copy in the same folder.

4. Rename the copy to exactly `config.json`.

5. Right-click the new `config.json` file → **Open With** → **TextEdit**.

6. Find the line that says:

   ```json
       "host": "127.0.0.1",
   ```

   (It’s inside the `"server"` section near the top.) Leave it for now — we’ll
   change it to your real address in the next step. Everything else in the file
   can stay exactly as it is. (There’s no secret code or key to add.)

7. Save the file (`Command + S`) and keep TextEdit handy — we’ll come right back.

---

## Step 5: Find Your Mac’s Address on the Home Network

Your phone needs to know where to find the storyteller.

1. Click the Apple menu () → **System Settings** → **Network**.

2. Select your active connection (Wi-Fi or Ethernet).

3. Click **Details…** next to it.

4. Look for **IP address** (it will look like `192.168.1.42` or similar).  
   Write it down or take a screenshot.

5. Go back to your `config.json` file in TextEdit and change the value inside the
   `"host"` line to your actual address — keep the quotes and comma exactly as
   they are:

   ```json
       "host": "192.168.1.42",
   ```

6. Save the file.

**Tip:** If your IP address ever changes, just repeat this step and update the `"host"` line.

---

## Step 6: Install Chronicle’s Helper Files

1. Open your `chronicle` folder in Finder.

2. Right-click the folder and choose **Services** → **New Terminal at Folder**.  
   A Terminal window should open already inside the `chronicle` folder.

   (Alternative: Open Terminal, type `cd `, then drag your `chronicle` folder into the Terminal window and press Return.)

3. In Terminal, type exactly this and press Return:

```bash
npm run setup
```

This installs everything Chronicle needs and builds the app. It may take a
couple of minutes the first time. Lots of text will scroll by — that’s completely normal.

**What success looks like:** the scrolling stops and the prompt returns.

---

## Step 7: Start Your Storyteller

In the same Terminal window, type:

```bash
npm start
```

Then press Return.

You should see a message that ends with:

```
Chronicle DM engine HTTP API listening on http://192.168.1.42:4317
```

**Write down or photograph the full address** (`http://192.168.1.42:4317` — use your real number). You’ll need it on your phone.

Your storyteller is now running! You can leave this Terminal window open (or minimize it). Closing it stops the storyteller until you run `npm start` again.

---

## Step 8: Allow Chronicle Through the Firewall (if prompted)

macOS may ask:

> “Do you want the application “node” to accept incoming network connections?”

Click **Allow**.

This is normal and safe — it only lets devices on your own home Wi-Fi talk to your storyteller.

---

## You Did It! 🎉

Your personal Dungeon Master is now ready on your Mac.

**Next step:**  
On your **phone or iPad**, open Safari (or any browser) and type the address you noted earlier.

The very first time, you’ll **create your own account** — just pick a username
and password right there in the app. No secret codes. After that you simply log
in, and the beautiful leather journal interface appears, ready to greet you.

Continue to: **[Starting Your First Adventure](../first-adventure.md)**

---

**Need help?**  
The most common hiccups are:
- Wrong IP address in the `"host"` line of `config.json`
- Forgetting to save `config.json` after editing (or a stray missing quote/comma)
- Closing the Terminal window too early
- Skipping the `claude` sign-in in Step 3

Go back to the step that felt uncertain — you’re very close.  
If you’re still stuck, a quick screenshot of any message will let us help you right away. See also **[Help & Troubleshooting](../help-and-troubleshooting.md)**.
