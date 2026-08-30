import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readPersistedSessionId,
  persistSessionId,
  clearPersistedSessionId,
} from "../src/campaign-store.js";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "chronicle-sessionid-"));
}

test("persist → read → clear round-trip (ADR-0040)", () => {
  const dir = tempDir();
  try {
    assert.equal(readPersistedSessionId(dir), undefined);
    persistSessionId(dir, "abc-123");
    assert.equal(readPersistedSessionId(dir), "abc-123");
    // Rotation: clearing drops the id so the next turn starts a fresh session.
    clearPersistedSessionId(dir);
    assert.equal(readPersistedSessionId(dir), undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("clearPersistedSessionId on a campaign with no session id is a no-op", () => {
  const dir = tempDir();
  try {
    assert.doesNotThrow(() => clearPersistedSessionId(dir));
    assert.equal(readPersistedSessionId(dir), undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
