# Windows Setup Guide

You only have to do these steps **once**. After this, starting Chronicle takes just a few clicks.

Take your time. Every step has a clear “what you should see” note so you always know you’re on the right track.

---

## Step 1: Download Chronicle

1. Go to the Chronicle releases page (link will be added here once we have a packaged release — for now you can download the folder from GitHub or ask the person who shared this with you for the zip).
2. Download the `chronicle` folder (or zip) and put it somewhere easy to find, like your Desktop or Documents folder.
3. If it’s a zip file, right-click it and choose **Extract All**, then open the extracted `chronicle` folder.

You should now have a folder called `chronicle` that contains files like `package.json`, a `src` folder, and a `public` folder.

---

## Step 2: Install the Storyteller Engine (Node.js)

Chronicle needs a free helper program called the **Storyteller Engine** so it can create rich stories for you.

1. Open your web browser and go to:  
   **https://nodejs.org**

2. You will see two big green buttons.  
   Click the one on the **left** that says **LTS** (Long Term Support).  
   This is the stable, recommended version. *(Chronicle needs version 22 or newer — the LTS button gives you that.)*

3. The download should start automatically. When it finishes, double-click the downloaded file (it will be named something like `node-v22.x.x-x64.msi`).

4. The installer window opens.  
   - Click **Next**  
   - Accept the license and click **Next**  
   - Keep all the default options and keep clicking **Next** until you reach **Install**  
   - Click **Install**, then **Finish** when it’s done.

**What you should see:** A message that Node.js was installed successfully. You can close the installer.

---

## Step 3: Give the Storyteller Its Brain (Sign in to Claude)

The storyteller thinks and remembers using **Claude**. You give it permission by
signing in once with your own Claude account. Most people use a **Claude Pro or
Max subscription** — the same login you’d use at claude.ai.

1. Press the Windows key, type **PowerShell**, and open it.

2. Install the Claude sign-in helper by typing this and pressing Enter:

   ```
   npm install -g @anthropic-ai/claude-code
   ```

   (This uses the Node.js you just installed. It takes a minute.)

3. Now type this and press Enter:

   ```
   claude
   ```

4. Follow the on-screen prompt to **log in with your Claude account** in the
   browser window it opens. When it’s done, your sign-in is saved safely on this
   computer — you won’t have to do it again.

5. You can close this window. That’s the brain sorted. 🧠

**Good to know:** You do **not** need to paste any keys or codes. Chronicle uses
the Claude subscription you just signed in with. (Don’t set an `ANTHROPIC_API_KEY`
environment variable — leaving it unset keeps billing on your subscription.)

---

## Step 4: Create Your Settings File

Chronicle keeps its settings in a small file called `config.json`. For now we only
need to tell it your computer’s address on your home network — we’ll fill that in
a moment.

1. Inside your `chronicle` folder, find the file named `config.example.json`.

2. Right-click it and choose **Copy**, then right-click in the same folder and
   choose **Paste**. You now have `config.example.json - Copy`.

3. Rename the copy to exactly `config.json` (remove the “ - Copy” part; the name
   should end in `.json`).

4. Right-click the new `config.json` file and choose **Open with** → **Notepad**.

5. Find the line that says:

   ```json
       "host": "127.0.0.1",
   ```

   (It’s inside the `"server"` section near the top.) Leave it for now — we’ll
   change it to your real address in the next step. Everything else in the file
   can stay exactly as it is. (There’s no secret code or key to add.)

6. Save the file (File → Save) and keep Notepad handy — we’ll come right back.

---

## Step 5: Find Your Computer’s Address on the Home Network

Your phone needs to know where to find the storyteller on your Wi-Fi.

1. Press the Windows key and type **Command Prompt**, then open it.

2. In the black window that appears, type exactly this and press Enter:

   ```
   ipconfig
   ```

3. Look for the section that says **Wireless LAN adapter Wi-Fi** (or **Ethernet adapter** if you’re plugged in with a cable).

4. Find the line that says **IPv4 Address** and write down (or take a photo of) the number next to it.  
   It will look something like `192.168.1.42` or `10.0.0.15`.

   **Example:**
   ```
   IPv4 Address. . . . . . . . . . . : 192.168.1.42
   ```

5. Go back to your `config.json` file in Notepad and change the value inside the
   `"host"` line to your actual address — keep the quotes and the comma exactly as
   they are:

   ```json
       "host": "192.168.1.42",
   ```

6. Save the file and close Notepad.

**Tip for the future:** If your Wi-Fi ever gives your computer a different address, just repeat this step and update the `"host"` line.

---

## Step 6: Install Chronicle’s Helper Files

1. Open File Explorer and go to your `chronicle` folder.

2. In the address bar at the top, click once so the path is highlighted, then type `cmd` and press Enter.  
   A black Command Prompt window should open *inside* your chronicle folder.  
   (You can also Shift + Right-click inside the folder and choose “Open in Terminal”.)

3. In the black window, type exactly this and press Enter:

   ```
   npm run setup
   ```

This installs everything Chronicle needs and builds the app. It may take a
couple of minutes the first time. You’ll see lots of text scrolling by — that’s normal.

**What you should see when it finishes:** the scrolling stops and the command prompt returns (a new line with a `>` or folder name).

If you see any red error messages, take a screenshot and we’ll help you fix it.

---

## Step 7: Start Your Storyteller for the First Time

In the same black window that’s still open in your `chronicle` folder, type:

```
npm start
```

Then press Enter.

You should see a friendly message that ends with something like:

```
Chronicle DM engine HTTP API listening on http://192.168.1.42:4317
```

**Write down or take a photo of that full address** (`http://192.168.1.42:4317`). You will need it on your phone.

Your storyteller is now running!

You can leave this black window open while you play (or minimize it). If you close it, the storyteller stops until you run `npm start` again.

---

## Step 8: Allow Chronicle Through Windows Firewall (if asked)

Windows may pop up a window asking:

> “Windows Defender Firewall has blocked some features of this app.  
> Do you want to allow it to communicate on these networks?”

Check the box for **Private networks** and click **Allow access**.

This is completely normal and safe — it’s only letting your own phone on your home Wi-Fi talk to the storyteller.

---

## You Did It! 🎉

Your personal Dungeon Master is now alive on your computer.

**Next step:**  
Open the browser on your **phone or tablet** (Chrome, Safari, Firefox — any modern browser works) and type the address you wrote down earlier (`http://192.168.1.42:4317` — use **your** number).

The very first time, you’ll **create your own account** — just pick a username
and password right there in the app. No secret codes. After that you simply log
in, and the beautiful leather journal interface appears, ready for your first adventure.

Head to the next guide: **[Starting Your First Adventure](../first-adventure.md)**

---

**Having trouble?**  
The most common issues at this stage are:
- Wrong IP address in the `"host"` line of `config.json`
- Forgot to save the `config.json` file after editing (or a stray missing quote/comma)
- The black window was closed
- Skipped the `claude` sign-in in Step 3

Just go back to the step that felt uncertain and double-check. You’re very close.

If you’re still stuck, take a clear screenshot of any error message and reach out — we’ll walk through it together. See also **[Help & Troubleshooting](../help-and-troubleshooting.md)**.
