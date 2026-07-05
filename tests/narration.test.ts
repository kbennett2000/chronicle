import { test } from "node:test";
import assert from "node:assert/strict";
import { stripMetaChatter } from "../src/narration.js";

test("strips the reported run-together bookkeeping leak (#46)", () => {
  const raw = "Let me update state.Back to the story:There's firelight ahead, maybe a quarter-mile off.";
  assert.equal(stripMetaChatter(raw), "There's firelight ahead, maybe a quarter-mile off.");
});

test("strips common bookkeeping segues in their own right", () => {
  assert.equal(
    stripMetaChatter("I'll update the character sheet now. The blade bites deep."),
    "The blade bites deep."
  );
  assert.equal(
    stripMetaChatter("Saving state. You stagger back, bleeding."),
    "You stagger back, bleeding."
  );
  assert.equal(
    stripMetaChatter("The door slams. Now back to the action. Kira draws her dagger."),
    "The door slams. Kira draws her dagger."
  );
});

test("leaves ordinary prose that merely mentions 'state' untouched (false-positive guard)", () => {
  const prose = "The state of the kingdom was dire. She saved the child and slipped into the room.";
  assert.equal(stripMetaChatter(prose), prose);

  const prose2 = "\"Let me see the state room,\" Kira said, eyeing the guard.";
  assert.equal(stripMetaChatter(prose2), prose2);

  const prose3 = "You update your grip on the sword and record your oath in memory.";
  // "update ... the sword" and "record your oath" have no state/file object.
  assert.equal(stripMetaChatter(prose3), prose3);
});

test("is a no-op on clean narration", () => {
  const clean = "The tavern hushes as you enter. Barrow looks up, wary.";
  assert.equal(stripMetaChatter(clean), clean);
  assert.equal(stripMetaChatter(""), "");
});

test("strips backstage preamble before a --- divider (#46 extension)", () => {
  const raw =
    "I need to locate the active campaign directory first. The campaign hasn't started yet — character sheet shows 0 HP.\n\n---\n\nYour leather armor creaks as you move.";
  assert.equal(
    stripMetaChatter(raw),
    "Your leather armor creaks as you move."
  );
});

test("strips directory and tool-access meta without a divider", () => {
  const raw =
    "I'm restricted to the active campaign's own directory. The DM tools are not available through direct tool calls. The corridor is dark ahead.";
  assert.equal(stripMetaChatter(raw), "The corridor is dark ahead.");
});

test("keeps the player-facing roll request when auto-roll is OFF (#44)", () => {
  // With auto-roll off the DM asks the player to roll — that phrasing must NOT
  // be stripped, or the player never gets asked for their value.
  const raw = "The guard's eyes narrow. I'll have you roll for a Stealth check. Tell me the total.";
  assert.equal(stripMetaChatter(raw, { autoRoll: false }), raw);
  // But with auto-roll on (default), the same "I'll roll for stealth" backstage
  // chatter is still scrubbed.
  assert.equal(
    stripMetaChatter("I'll roll for Stealth now. You slip into the shadows."),
    "You slip into the shadows."
  );
});
