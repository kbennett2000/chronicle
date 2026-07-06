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
   This is the stable, recommended version.

3. The download should start automatically. When it finishes, double-click the downloaded file (it will be named something like `node-v22.x.x-x64.msi`).

4. The installer window opens.  
   - Click **Next**  
   - Accept the license and click **Next**  
   - Keep all the default options and keep clicking **Next** until you reach **Install**  
   - Click **Install**, then **Finish** when it’s done.

**What you should see:** A message that Node.js was installed successfully. You can close the installer.

---

## Step 3: Get Your Private Magic Key

The storyteller needs a “brain” to think and remember your campaign. This comes from a free service called Anthropic.

1. Open your browser and go to:  
   **https://console.anthropic.com**

2. Sign up for a free account (or log in if you already have one).  
   You only need an email address.

3. Once you’re logged in, look in the left menu for **API Keys** and click it.

4. Click the big button **Create Key**.

5. Give it a name like `Chronicle` so you remember what it’s for, then click **Create Key**.

6. **Important:** A long key starting with `sk-ant-` will appear.  
   Click the **copy** icon next to it.  
   Paste it somewhere safe for a minute (Notepad is fine).  
   **Do not close this page yet** — we’ll use the key in the next step.

You now have your private magic key. Keep it secret like a powerful spell component.

---

## Step 4: Tell Chronicle Your Secret Handshake Code and Magic Key

We need to give Chronicle two pieces of information:

- A **secret handshake code** (so only you and your devices can talk to the storyteller)
- Your **private magic key** (the brain we just created)

1. Inside your `chronicle` folder, find the file named `.env.example`.

2. Right-click it and choose **Copy**.

3. Right-click in the same folder and choose **Paste**.  
   You now have a new file called `.env.example - Copy`.

4. Rename the copy to exactly `.env` (remove the “- Copy” part).  
   *If you don’t see the `.env` file after renaming, that’s okay — Windows sometimes hides files that start with a dot. We’ll open it directly in the next step.*

5. Right-click the new `.env` file and choose **Open with** → **Notepad** (or any text editor you like).

6. You will see lines that look like this:

```
CHRONICLE_SHARED_SECRET=my-secret
HOST=127.0.0.1
PORT=4317
ANTHROPIC_API_KEY=
```

7. Change them to look like this (use your own words for the secret code):

```
CHRONICLE_SHARED_SECRET=my-favorite-dragon-is-red-and-gold
HOST=192.168.1.42          ← We’ll fill this in the next step
PORT=4317
ANTHROPIC_API_KEY=sk-ant-api03-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

   - Replace `my-favorite-dragon-is-red-and-gold` with something **you** will remember (longer is better and more secure).
   - Replace the `sk-ant-...` line with the magic key you copied in Step 3.
   - We’ll fill in the `HOST` line in the next step.

8. Save the file (File → Save) and close Notepad.

---

## Step 5: Find Your Computer’s Address on the Home Network

Your phone needs to know where to find the storyteller on your Wi-Fi.

1. Press the Windows key on your keyboard and type **Command Prompt**, then open it.

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

5. Go back to your `.env` file (open it again with Notepad) and replace the `HOST=127.0.0.1` line with your actual address:

   ```
   HOST=192.168.1.42
   ```

6. Save the file and close Notepad.

**Tip for the future:** If your Wi-Fi ever gives your computer a different address, just repeat this step and update the `HOST` line.

---

## Step 6: Install Chronicle’s Helper Files

1. Open File Explorer and go to your `chronicle` folder.

2. In the address bar at the top, click once so the path is highlighted, then type `cmd` and press Enter.  
   A black Command Prompt window should open *inside* your chronicle folder.  
   (You can also Shift + Right-click inside the folder and choose “Open PowerShell window here” or “Open in Terminal”.)

3. In the black window, type exactly this and press Enter:

```
npm install
```

This may take a minute or two the first time. You’ll see lots of text scrolling by — that’s normal.

**What you should see when it finishes:** A message that says something like “added X packages” and the command prompt returns (a new line with a `>` or folder name).

If you see any red error messages, take a screenshot and we’ll help you fix it.

---

## Step 7: Start Your Storyteller for the First Time

In the same black window that’s still open in your `chronicle` folder, type:

```
npm run serve
```

Then press Enter.

You should see a friendly message that ends with something like:

```
Chronicle DM engine HTTP API listening on http://192.168.1.42:4317
```

**Write down or take a photo of that full address** (`http://192.168.1.42:4317`). You will need it on your phone.

Your storyteller is now running!

You can leave this black window open while you play (or minimize it). If you close it, the storyteller stops until you run the command again.

---

## Step 8: Allow Chronicle Through Windows Firewall (if asked)

Windows may pop up a window asking:

> “Windows Defender Firewall has blocked some features of this app.  
> Do you want to allow Chronicle to communicate on these networks?”

Check the boxes for **Private networks** (and Public if you want, though it’s not necessary) and click **Allow access**.

This is completely normal and safe — it’s only letting your own phone on your home Wi-Fi talk to the storyteller.

---

## You Did It! 🎉

Your personal Dungeon Master is now alive on your computer.

**Next step:**  
Open the browser on your **phone or tablet** (Chrome, Safari, Firefox — any modern browser works) and type the address you wrote down earlier (`http://192.168.1.42:4317` — use **your** number).

You’ll be asked for your **secret handshake code** (the phrase you put in `CHRONICLE_SHARED_SECRET`).

Once you enter it, the beautiful leather journal interface will appear and your storyteller will be ready to begin your first adventure.

Head to the next guide: **[Starting Your First Adventure](../first-adventure.md)**

---

**Having trouble?**  
The most common issues at this stage are:
- Wrong IP address in the `HOST` line
- Forgot to save the `.env` file after editing
- The black window was closed

Just go back to the step that felt uncertain and double-check. You’re very close.

If you’re still stuck, take a clear screenshot of any error message and reach out — we’ll walk through it together.