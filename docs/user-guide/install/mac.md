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

2. Click the big green **LTS** button on the left (Long Term Support).

3. Double-click the downloaded `.pkg` file and follow the installer:
   - Click **Continue**
   - Click **Install** (you may need to enter your Mac password)
   - Click **Close** when finished.

### Alternative (if you already use Homebrew):

Open Terminal and run:

```bash
brew install node
```

**What you should see:** Node.js is now installed. You can close the installer.

---

## Step 3: Get Your Private Magic Key

The storyteller needs a “brain.” We get this from a free service called Anthropic.

1. Go to **https://console.anthropic.com** in your browser.

2. Sign up or log in (free account is fine).

3. In the left menu, click **API Keys**.

4. Click **Create Key**.

5. Name it something like `Chronicle` and click **Create Key**.

6. Copy the long key that starts with `sk-ant-`.  
   Paste it somewhere safe (Notes app is fine) for the next step.  
   Keep this page open for now.

---

## Step 4: Tell Chronicle Your Secret Handshake Code and Magic Key

1. Open your `chronicle` folder in Finder.

2. Find the file named `.env.example`.

3. Press `Command + C` to copy it, then `Command + V` to paste a copy in the same folder.

4. Rename the copy to exactly `.env` (it must start with a dot).

   **To see hidden files:** Press `Command + Shift + .` (period) in Finder. The `.env` file should now be visible. Press the same keys again to hide them later if you want.

5. Right-click the new `.env` file → **Open With** → **TextEdit** (or any text editor).

6. You’ll see text that looks like this:

```
CHRONICLE_SHARED_SECRET=my-secret
HOST=127.0.0.1
PORT=4317
ANTHROPIC_API_KEY=
```

7. Edit it to look like this (use your own memorable phrase):

```
CHRONICLE_SHARED_SECRET=my-favorite-dragon-is-red-and-gold
HOST=192.168.1.42          ← We’ll update this next
PORT=4317
ANTHROPIC_API_KEY=sk-ant-api03-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

   - Change the secret code to something **you** will remember.
   - Paste your magic key from Step 3 on the last line.
   - We’ll fill in the correct `HOST` address in the next step.

8. Save the file (`Command + S`) and close TextEdit.

---

## Step 5: Find Your Mac’s Address on the Home Network

Your phone needs to know where to find the storyteller.

1. Click the Apple menu () → **System Settings** → **Network**.

2. Select your active connection (Wi-Fi or Ethernet).

3. Click **Details…** next to it.

4. Look for **IP address** (it will look like `192.168.1.42` or similar).  
   Write it down or take a screenshot.

5. Go back to your `.env` file and change the `HOST` line to your actual address:

   ```
   HOST=192.168.1.42
   ```

6. Save the file.

**Tip:** If your IP address ever changes, just repeat this step and update the `HOST` line.

---

## Step 6: Install Chronicle’s Helper Files

1. Open your `chronicle` folder in Finder.

2. Right-click the folder (or use the toolbar) and choose **Services** → **New Terminal at Folder**.  
   A Terminal window should open already inside the `chronicle` folder.

   (Alternative: Open Terminal, type `cd `, then drag your `chronicle` folder into the Terminal window and press Enter.)

3. In Terminal, type exactly this and press Return:

```bash
npm install
```

This may take 1–2 minutes the first time. Lots of text will scroll by — that’s completely normal.

**What success looks like:** You’ll see a line that says something like “added X packages” and the prompt returns.

---

## Step 7: Start Your Storyteller

In the same Terminal window, type:

```bash
npm run serve
```

Then press Return.

You should see a message that ends with:

```
Chronicle DM engine HTTP API listening on http://192.168.1.42:4317
```

**Write down or photograph the full address** (`http://192.168.1.42:4317` — use your real number). You’ll need it on your phone.

Your storyteller is now running! You can leave this Terminal window open (or minimize it). Closing it stops the storyteller until you run the command again.

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

Enter your **secret handshake code** (the phrase you chose for `CHRONICLE_SHARED_SECRET`).

The beautiful leather journal interface will appear and your storyteller will greet you.

Continue to: **[Starting Your First Adventure](../first-adventure.md)**

---

**Need help?**  
The most common hiccups are:
- Wrong IP address in the `HOST` line of `.env`
- Forgetting to save `.env` after editing
- Closing the Terminal window too early

Go back to the step that felt uncertain — you’re very close.  
If you’re still stuck, a quick screenshot of any message will let us help you right away.