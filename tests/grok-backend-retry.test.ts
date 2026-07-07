import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runGrokTurn, type GrokExec } from "../src/backends/grok-backend.js";
import type { RunTurnArgs } from "../src/dm-backend.js";
import type { CampaignSettings } from "../src/campaign-store.js";

/** A minimal on-disk campaign: the state files systemPrompt/readCharacterIdentity
 * touch, plus a session-log/ dir. writeGrokConfig only writes .grok/config.toml
 * here — nothing is spawned, since the grok exec is stubbed. */
function tempCampaign(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chronicle-grok-"));
  fs.writeFileSync(
    path.join(dir, "character-sheet.json"),
    JSON.stringify({ name: "Kira", race: "Elf", class: "Ranger", level: 1 })
  );
  fs.writeFileSync(path.join(dir, "world-state.md"), "## Current Situation\n\nAt the inn.\n");
  fs.writeFileSync(path.join(dir, "npc-roster.md"), "# NPCs\n");
  fs.writeFileSync(path.join(dir, "quest-log.md"), "# Quests\n");
  fs.mkdirSync(path.join(dir, "session-log"));
  return dir;
}

function baseArgs(dir: string): RunTurnArgs {
  return {
    campaignDir: dir,
    sessionLogPath: path.join(dir, "session-log", "s.md"),
    userInput: "Begin the campaign.",
    resumeSessionId: undefined,
    model: "grok-build",
    settings: {
      provider: "grok",
      model: "grok-build",
      autoRollDice: true,
      generateImages: false,
    } as CampaignSettings,
    onText: () => {},
  };
}

/** A stubbed grok exec that returns queued responses in order and records the
 * argv of every call so tests can assert resume/nudge behavior. */
function stubExec(
  responses: Array<{ stdout?: string; throw?: unknown }>
): { fn: GrokExec; calls: string[][] } {
  const calls: string[][] = [];
  let i = 0;
  const fn: GrokExec = async (_file, args) => {
    calls.push([...args]);
    const r = responses[i++] ?? responses[responses.length - 1];
    if (r.throw) throw r.throw;
    return { stdout: r.stdout ?? "", stderr: "" };
  };
  return { fn, calls };
}

const grokJson = (text: string, sessionId = "sess-1", stopReason = "EndTurn") =>
  JSON.stringify({ text, sessionId, stopReason });

test("a silent first Grok turn is retried once and the retry's narration wins (#100)", async () => {
  const dir = tempCampaign();
  try {
    const { fn, calls } = stubExec([
      { stdout: grokJson("") }, // grok-build finished via tool edits, no prose
      { stdout: grokJson("You stand at the gates of Thornwick.") },
    ]);
    const res = await runGrokTurn(baseArgs(dir), fn);

    assert.equal(res.isError, false);
    assert.match(res.text, /Thornwick/);
    assert.equal(calls.length, 2, "should invoke grok exactly twice (attempt + one retry)");

    // First attempt opens a fresh session; the retry resumes that same session.
    assert.ok(calls[0].includes("--session-id"), "first attempt uses --session-id");
    assert.ok(calls[1].includes("--resume"), "retry uses --resume");
    assert.ok(calls[1].includes("sess-1"), "retry resumes the session grok created");

    // The retry input carries the prose-forcing nudge.
    const pIdx = calls[1].indexOf("-p");
    assert.match(calls[1][pIdx + 1], /narrated prose in your reply text/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a Grok turn still silent after the retry is a hard error (#100)", async () => {
  const dir = tempCampaign();
  try {
    const { fn, calls } = stubExec([{ stdout: grokJson("") }, { stdout: grokJson("") }]);
    const res = await runGrokTurn(baseArgs(dir), fn);

    assert.equal(res.isError, true);
    assert.match(res.text, /no narration/);
    assert.equal(calls.length, 2, "retries once, then gives up");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a narrated first Grok turn is used as-is with no retry (#100)", async () => {
  const dir = tempCampaign();
  try {
    const { fn, calls } = stubExec([{ stdout: grokJson("A raven caws overhead.", "sess-9") }]);
    const res = await runGrokTurn(baseArgs(dir), fn);

    assert.equal(res.isError, false);
    assert.equal(res.sessionId, "sess-9");
    assert.equal(calls.length, 1, "a good turn must not spend a retry");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a terminal grok exec failure is not retried (#100)", async () => {
  const dir = tempCampaign();
  try {
    const { fn, calls } = stubExec([
      { throw: Object.assign(new Error("boom"), { stderr: "unknown flag" }) },
    ]);
    const res = await runGrokTurn(baseArgs(dir), fn);

    assert.equal(res.isError, true);
    assert.equal(calls.length, 1, "a spawn/non-zero failure is terminal, not retryable");
    assert.match(res.text, /unknown flag/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
