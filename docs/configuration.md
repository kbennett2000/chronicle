# Configuring Chronicle

Chronicle reads all its settings from two plain JSON files at the repository root.
There is no `.env` and no environment-variable configuration (see
[ADR-0033](adr/0033-file-based-config.md)).

## Quick start

```bash
cp config.example.json config.json      # non-secret settings
cp secrets.example.json secrets.json     # passwords (optional)
```

Then edit `config.json` / `secrets.json` and start the server. **You don't have to do
anything to boot** — if `config.json` is missing, Chronicle falls back to the committed
`config.example.json`, so a fresh checkout runs out of the box with sensible defaults.
Copy the files when you want to change something.

## The two files, and why there are two

| File | In git? | What it holds |
|------|---------|---------------|
| `config.json` | **no** (git-ignored) | your real non-secret settings |
| `config.example.json` | yes | the real defaults + inline docs; also the fallback when `config.json` is absent |
| `secrets.json` | **no** (git-ignored) | passwords only |
| `secrets.example.json` | yes | empty placeholders showing the shape |

The split exists so that **secrets never end up in git**. `config.json` and
`secrets.json` are both listed in `.gitignore`; only the `*.example.json` templates are
committed. Keeping credentials in their own file means the settings file can be shared,
diffed, and copied freely without ever risking a password leak.

JSON has no comment syntax, so the example files document themselves with `_comment`
fields. Those are ignored by the loader — you can delete them from your real files or
leave them, either works.

### Graceful degradation

Missing optional values never crash the app — they just turn a feature off, exactly as
an unset environment variable used to:

- No `secrets.json` (or an empty bootstrap password) → the bootstrap user is simply not
  created.
- No Navidrome credentials → the Navidrome music source is unavailable (local music
  still works).
- A malformed JSON file → a warning is logged and the defaults are used, rather than a
  hard crash.

## `config.json` — non-secret settings

```jsonc
{
  "server":   { "host": "127.0.0.1", "port": 4317 },
  "comfyui":  { "url": "http://localhost:8188" },
  "navidrome":{ "url": "", "playlist": "" },
  "defaults": { ... }
}
```

### `server`

| Key | Default | Meaning |
|-----|---------|---------|
| `server.host` | `"127.0.0.1"` | Interface to bind. The default is **localhost-only** ([ADR-0003](adr/0003-lan-exposure-auth.md)). To let other devices on your network reach Chronicle, set this to your machine's LAN IP (e.g. `"192.168.1.20"`) or `"0.0.0.0"` to bind all interfaces. This is a deliberate opt-in — it widens the trust boundary from "this machine" to "this network." |
| `server.port` | `4317` | HTTP/API/UI port. |

### `comfyui`

| Key | Default | Meaning |
|-----|---------|---------|
| `comfyui.url` | `"http://localhost:8188"` | Base URL of the ComfyUI server used by the **local** image backend. |

**Remote GPU host (the host-split use case):** if ComfyUI runs on a different machine
than Chronicle — e.g. a headless GPU box — point this at it:

```json
{ "comfyui": { "url": "http://192.168.1.50:8188" } }
```

Chronicle will send all local-backend image generation to that host. You can verify the
setting end-to-end with `npx tsx scripts/verify-comfyui.ts`, which targets the same
`comfyui.url`.

### `navidrome`

| Key | Default | Meaning |
|-----|---------|---------|
| `navidrome.url` | `""` | Base URL of your Navidrome server (Subsonic API). Leave empty to keep the Navidrome source off. |
| `navidrome.playlist` | `""` | Name of the playlist to stream. |

The Navidrome **username/password** are secrets and live in `secrets.json`, not here.

### `defaults`

The settings a brand-new user's account inherits. Every one is overridable per-user and
per-campaign; these are the last-resort fallback. Empty string / `null` means "no forced
default" (the field stays unset for new users, and the engine's own default applies).

| Key | Default | Meaning |
|-----|---------|---------|
| `provider` | `"claude"` | DM backend provider. |
| `model` | `"claude-sonnet-5"` | DM model. |
| `imageProvider` | `"grok"` | Image backend (`grok` or `local`). |
| `imageQuality` | `"standard"` | Local-backend quality tier (`fast`/`standard`/`high`). |
| `artStyle` | `""` | Default art style (empty = engine default). |
| `worldSetting` | `""` | Default world/setting seed (empty = none). |
| `contentIntensity` | `""` | Default content intensity (empty = engine default). |
| `responseLength` | `"detailed"` | DM narration length. |
| `toneWhimsy` | `null` | Wildcard/whimsy bias 0–1 (null = use `seedWildcardChance`). |
| `autoIllustrate` | `false` | Auto-illustrate turns by default. |
| `generateImages` | `false` | Image generation on by default. |
| `generateVideos` | `false` | Video generation on by default. |
| `autoRollDice` | `true` | Auto-roll dice by default. |
| `musicEnabled` | `false` | Music on by default. |
| `musicSource` | `"local"` | `local` or `navidrome`. |
| `videoDuration` | `5` | Clip length in seconds (1–15). |
| `videoResolution` | `"480p"` | `480p` or `720p`. |
| `videoAspect` | `"square"` | `square`, `16:9`, or `9:16`. |
| `seedWildcardChance` | `0.175` | Process-wide chance a seed roll draws from a wildcard pool (~15–20%). |

## `secrets.json` — passwords only

```json
{
  "bootstrap": { "username": "", "password": "" },
  "navidrome": { "username": "", "password": "" }
}
```

| Key | Meaning |
|-----|---------|
| `bootstrap.username` | Username of the account created automatically on first server start. Defaults to `kris` if empty. |
| `bootstrap.password` | Its password. Must be **at least 6 characters**, or the account is skipped (no bootstrap user is created). |
| `navidrome.username` | Navidrome login used server-side to stream music. |
| `navidrome.password` | Navidrome password. |

Both real files are git-ignored — double-check `git status` never shows `config.json` or
`secrets.json` before you commit.
