# Adding Pictures (Optional Extra Magic)

Your storyteller works wonderfully without any pictures. Many people play that way and love it.

However, if you’d like the world to come alive visually — with portraits of NPCs, scenes of locations, and illustrations of important moments — you can turn on picture generation.

This is completely optional and takes about 5 extra minutes to set up.

---

## What Pictures Do

When picture generation is on, the storyteller will automatically create an illustration the **first time** a new major character, important NPC, or significant location appears in the story.

After that, the picture is saved and appears whenever you look at that character or place.

Pictures are generated using Grok’s image system and appear in a beautiful style you choose in Settings.

---

## Requirements

To use pictures you need:

1. A free Grok account (from xAI)
2. The `grok` command-line tool installed on the computer running Chronicle
3. Your Grok API key (or you can log in interactively)

If any of this feels like too much, just leave pictures turned off. The storytelling experience is still excellent.

---

## Step-by-Step Setup

### 1. Create a free Grok account

Go to **https://grok.x.ai** or **https://x.ai** and sign up (you can use your X/Twitter account or email).

### 2. Install the `grok` command line tool

On your computer (the one running Chronicle), open a terminal and run the official install command from xAI (check their current instructions at grok.x.ai or x.ai for the latest one-liner).

### 3. Log in / authenticate

After installing, run:

```bash
grok auth
```

or follow the instructions the tool gives you. You can either log in interactively or set an `XAI_API_KEY` environment variable.

### 4. Turn pictures on in Chronicle

On your phone, go to **Settings → The Look** and toggle **Generate scene art** to **On**.

You can also choose your preferred art style here.

### 5. (Optional but recommended) Add your key to `.env`

If you prefer not to use interactive login, you can add your key to the `.env` file:

```
XAI_API_KEY=your-key-here
```

Then restart the storyteller.

---

## How Pictures Appear

- The first time you meet an important NPC or enter a notable location, the storyteller may generate an image.
- You’ll see a small “✎ Draw this” button on tiles that don’t have art yet.
- Under DM narration you may also see a “⟢ Illustrate this moment” option.
- Once generated, the image stays with that character or place forever.

Generation can take a few seconds to a minute the first time — the storyteller will let you know it’s thinking/drawing.

---

## A Note on Cost

Image generation uses a small amount of your Grok usage. For normal solo play this is very modest (usually just pennies per session even with many pictures).

You only pay for what you use.

---

## You Can Turn It Off Anytime

If you decide pictures aren’t for you (or you want to save usage), just flip the toggle back to **Off** in Settings. No harm done.

---

**That’s it!**  
Pictures are a lovely enhancement, not a requirement. Many wonderful campaigns are played with the text-only experience.

Enjoy the story however feels best to you. 🕯️