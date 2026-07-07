import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  writeUserSettings,
  readUserSettings,
  USERS_ROOT,
} from "../src/user-store.js";

// #95: a partial patch to the nested `music` object must merge, not replace.
// Clicking NAVIDROME sends { music: { source: "navidrome" } }; a shallow
// top-level spread dropped the stored { music: { enabled: true } }, so music
// re-defaulted to off. writeUserSettings now deep-merges nested plain objects.

function uniqueUser(suffix: string): string {
  return `zz-usersettings-${suffix}-${process.pid}-${process.hrtime.bigint()}`;
}

function cleanup(userId: string): void {
  fs.rmSync(path.join(USERS_ROOT, userId), { recursive: true, force: true });
}

test("nested music patch preserves sibling fields (#95)", () => {
  const user = uniqueUser("music");
  try {
    writeUserSettings(user, { music: { enabled: true, source: "local" } });

    // Selecting Navidrome sends only { source } — enabled must survive.
    const afterSource = writeUserSettings(user, { music: { source: "navidrome" } });
    assert.deepEqual(afterSource.music, { enabled: true, source: "navidrome" });

    // Editing the Navidrome URL likewise keeps enabled + source.
    const afterUrl = writeUserSettings(user, { music: { navidromeUrl: "http://nas:4533" } });
    assert.deepEqual(afterUrl.music, {
      enabled: true,
      source: "navidrome",
      navidromeUrl: "http://nas:4533",
    });

    // And it's actually persisted, not just returned.
    assert.deepEqual(readUserSettings(user).music, afterUrl.music);
  } finally {
    cleanup(user);
  }
});

test("top-level sibling fields are still preserved across patches (#95)", () => {
  const user = uniqueUser("toplevel");
  try {
    writeUserSettings(user, { model: "claude-sonnet-5", music: { enabled: true, source: "local" } });
    const merged = writeUserSettings(user, { music: { source: "navidrome" } });
    // The unrelated top-level `model` must not be clobbered by a music patch.
    assert.equal(merged.model, "claude-sonnet-5");
    assert.deepEqual(merged.music, { enabled: true, source: "navidrome" });
  } finally {
    cleanup(user);
  }
});

test("a non-object value still replaces (no accidental deep-merge) (#95)", () => {
  const user = uniqueUser("replace");
  try {
    writeUserSettings(user, { model: "claude-sonnet-5" });
    const merged = writeUserSettings(user, { model: "claude-opus-4-8" });
    assert.equal(merged.model, "claude-opus-4-8");
  } finally {
    cleanup(user);
  }
});
