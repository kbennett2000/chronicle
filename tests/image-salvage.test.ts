import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { newestImageUnder } from "../src/image-generator.js";

/** Builds a fake ~/.grok/sessions/<cwd>/ tree with session dirs each holding an
 * images/ subdir, mirroring where Grok Build writes generated files (#52). */
function sessionsTree(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "chronicle-grok-sessions-"));
}

function writeImage(base: string, sessionId: string, name: string, mtimeSec: number): string {
  const dir = path.join(base, sessionId, "images");
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, name);
  fs.writeFileSync(full, "x".repeat(4096));
  fs.utimesSync(full, mtimeSec, mtimeSec);
  return full;
}

test("newestImageUnder salvages the newest image written during this call (#52)", () => {
  const base = sessionsTree();
  try {
    const since = 10_000 * 1000; // 10,000s since epoch, in ms
    writeImage(base, "sess-a", "1.jpg", 9_000); // before `since` — ignored
    const newer = writeImage(base, "sess-b", "1.jpg", 10_050); // after — candidate
    const newest = writeImage(base, "sess-b", "2.jpg", 10_090); // newest — winner
    void newer;
    assert.equal(newestImageUnder(base, since), newest);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("newestImageUnder ignores images written before the call started", () => {
  const base = sessionsTree();
  try {
    writeImage(base, "old-session", "1.jpg", 5_000);
    // sinceMs well after the only file's mtime (+1s slack still excludes it).
    assert.equal(newestImageUnder(base, 8_000 * 1000), undefined);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("newestImageUnder returns undefined when the sessions tree doesn't exist", () => {
  assert.equal(newestImageUnder("/nonexistent/grok/sessions/whatever", 0), undefined);
});
