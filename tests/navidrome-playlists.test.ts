import { test } from "node:test";
import assert from "node:assert/strict";
import { navidromePlaylists, type NavidromeCreds } from "../src/music-store.js";

// #110: navidromePlaylists returns only the chronicle-tagged playlist NAMES from
// the shared Navidrome server (description/`comment` contains "chronicle",
// case-insensitive), de-duped and in order. This is the one piece of #110 logic
// that's deterministically testable without a live server — we stub global.fetch
// with a Subsonic getPlaylists payload.

const CREDS: NavidromeCreds = { url: "http://navi.test", user: "u", password: "p", playlist: "" };

function stubGetPlaylists(playlists: Array<{ name?: string; comment?: string }>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      ok: true,
      json: async () => ({
        "subsonic-response": { status: "ok", playlists: { playlist: playlists } },
      }),
    }) as unknown as Response) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("navidromePlaylists: keeps only description-tagged names, mixed case, trimmed", async () => {
  const restore = stubGetPlaylists([
    { name: "Tavern Nights", comment: "chronicle ambience" },
    { name: "Workout", comment: "gym pump" },
    { name: "Dungeon Depths", comment: "Chronicle — dark and low" }, // mixed case
    { name: "No Comment Playlist" }, // no comment → excluded
    { name: "  Spaced  ", comment: "made for chronicle" }, // trimmed
  ]);
  try {
    const names = await navidromePlaylists(CREDS);
    assert.deepEqual(names, ["Tavern Nights", "Dungeon Depths", "Spaced"]);
  } finally {
    restore();
  }
});

test("navidromePlaylists: de-dupes by name (case-insensitive), preserving first-seen order", async () => {
  const restore = stubGetPlaylists([
    { name: "Battle", comment: "chronicle combat" },
    { name: "Calm", comment: "chronicle rest" },
    { name: "battle", comment: "chronicle again" }, // dup of "Battle"
  ]);
  try {
    const names = await navidromePlaylists(CREDS);
    assert.deepEqual(names, ["Battle", "Calm"]);
  } finally {
    restore();
  }
});

test("navidromePlaylists: no tagged playlists yields an empty list", async () => {
  const restore = stubGetPlaylists([
    { name: "Pop", comment: "top 40" },
    { name: "Focus" },
  ]);
  try {
    assert.deepEqual(await navidromePlaylists(CREDS), []);
  } finally {
    restore();
  }
});
