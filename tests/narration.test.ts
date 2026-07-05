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
