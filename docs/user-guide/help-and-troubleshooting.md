# Help & Troubleshooting

Things don’t always go perfectly the first time — that’s normal. This page has calm, step-by-step fixes for the situations people encounter most often.

You’re not doing anything wrong. We’ll get it sorted together.

---

## My phone can’t connect to the storyteller

**Most common cause:** The `HOST` address in your `.env` file is wrong or your phone and computer are not on the same Wi-Fi.

**What to try:**

1. Double-check the address you’re typing on your phone. It must match exactly what the terminal said when you started Chronicle (`http://YOUR-IP:4317`).

2. Make sure both devices are on the **same home Wi-Fi** (not a guest network or VPN).

3. On the computer running Chronicle, re-check your IP address:
   - Windows: Open Command Prompt and type `ipconfig`
   - Mac: System Settings → Network → Details
   - Linux: `hostname -I`

4. Update the `HOST=` line in your `.env` file with the correct address, save it, then restart the storyteller (`Ctrl + C` then `npm start` again).

5. Still no luck? Try temporarily setting `HOST=0.0.0.0` in `.env` (this makes it listen on all interfaces). Remember to change it back to your specific IP later for better security.

---

## I can’t log in / it won’t accept my account

Chronicle uses a simple username and password that **you** create — there’s no
secret code or key to type.

- **First time on a device?** Tap **Create account** and pick a username and
  password. After that, use **Log in** with the same details.
- **“Username already taken”?** That account already exists — tap **Log in**
  instead of Create account.
- **Wrong password?** Double-check for stray capital letters or spaces. Each
  person’s chronicles are tied to their own account, so make sure you’re logging
  into the right one.
- Your login is remembered on each device until you log out
  (**Settings → The Hearth → Log out**).

---

## I closed the terminal / black window and now it won’t start

This is very common.

**Fix:**

1. Open your `chronicle` folder again.
2. Open Terminal / Command Prompt / PowerShell **inside** that folder.
3. Run `npm start` again.

The storyteller will start right back up. You can minimize the window while you play.

**Pro tip:** Use `screen` or `tmux` (see the Linux guide) so you can close the terminal and keep it running in the background.

---

## The stories feel too silly / too serious

Easy fix!

1. Open the **Settings** tab on your phone.
2. Adjust the **Whimsy** slider.
   - Left = more serious and grounded
   - Right = more whimsical and surprising
3. You can also change **World Setting** to something that better matches the tone you want.

Changes take effect immediately on the next turn.

---

## Pictures aren’t appearing even though I turned them on

A few things to check:

1. Make sure you actually completed the Grok CLI setup and authentication on the computer running Chronicle.
2. Check that **Generate scene art** is toggled **On** in Settings → The Look.
3. Pictures only generate the **first time** a new major character or location appears. Try starting a fresh campaign or meeting someone new.
4. The first picture can take 20–60 seconds. The storyteller will usually tell you it’s drawing.

If it still doesn’t work, check the terminal window on the computer for any error messages about Grok or image generation.

---

## I changed the port but my phone still can’t connect

Remember to do **both** steps:

1. Change `PORT=xxxx` in your `.env` file and save it.
2. Allow the **new port** in your firewall:

   ```bash
   sudo ufw allow NEWPORT/tcp
   sudo ufw reload
   ```

3. Restart the storyteller.
4. Use the **new port** in the address on your phone (`http://your-ip:NEWPORT`).

---

## Everything was working and now it suddenly stopped

Quick checklist:

- Is the computer still on and connected to Wi-Fi?
- Is the terminal window / Command Prompt still open with the storyteller running?
- Did your computer’s IP address change? (Common on some home networks — re-run the IP check and update `.env` if needed)
- Did you recently restart the computer? You’ll need to start the storyteller again.

---

## I want to start over with a completely fresh campaign

Just create a new campaign from the main screen. Your old campaigns are saved and you can switch between them anytime.

If you really want to delete everything and begin completely fresh, you can delete the `campaigns/` folder inside your Chronicle directory (but only do this if you’re sure — there’s no undo).

---

## Still stuck?

You’re very close — most issues are small configuration details.

Take a clear screenshot or photo of:
- The error message (if any)
- What the terminal says when you try to start Chronicle
- The address you’re typing on your phone

Then reach out with that information. We’ll walk through it together until it’s working.

You’ve already done the hardest part by getting this far. We’ve got you. 🕯️

---

**Thank you for playing Chronicle.**

Your personal Dungeon Master is waiting whenever you’re ready.