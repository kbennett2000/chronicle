import { test } from "node:test";
import assert from "node:assert/strict";
import { isEngineChangeLocked } from "../src/campaign-store.js";

// Issue #114: the engine (provider) and model are set-once — locked once a
// game has started, so a mid-campaign switch can't leave a stale `.session-id`
// for the wrong backend to resume (the grok→claude crash; ADR-0018, #57). These
// tests pin the exact conditions under which POST /session/start rejects a
// change, and — just as importantly — the ones under which it must NOT.

const base = {
  started: true,
  requestedProvider: false,
  resolvedProvider: "claude" as const,
  priorProvider: "claude" as const,
  requestedModel: false,
  resolvedModel: "claude-sonnet-5" as const,
  priorModel: "claude-sonnet-5" as const,
};

test("no-arg session/start is always allowed (entry-flow re-start)", () => {
  // continue / new-game create re-start the session with no provider/model —
  // even mid-game this must succeed, or you couldn't resume your own campaign.
  assert.equal(isEngineChangeLocked({ ...base, started: true }), false);
});

test("changing the provider mid-game is locked", () => {
  assert.equal(
    isEngineChangeLocked({ ...base, requestedProvider: true, resolvedProvider: "grok" }),
    true
  );
});

test("changing the model mid-game is locked", () => {
  assert.equal(
    isEngineChangeLocked({ ...base, requestedModel: true, resolvedModel: "claude-opus-4-8" }),
    true
  );
});

test("before the game has started, any change is allowed", () => {
  // The new-game form window: no session persisted yet, so the engine is still
  // free to pick.
  assert.equal(
    isEngineChangeLocked({
      ...base,
      started: false,
      requestedProvider: true,
      resolvedProvider: "grok",
    }),
    false
  );
});

test("explicitly re-selecting the SAME provider/model mid-game is allowed (no-op)", () => {
  // The frontend may echo the current pair; only an actual diff is a change.
  assert.equal(
    isEngineChangeLocked({
      ...base,
      requestedProvider: true,
      resolvedProvider: "claude",
      requestedModel: true,
      resolvedModel: "claude-sonnet-5",
    }),
    false
  );
});
