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

test("strips seed-tables / deferred-tool planning from opening turns (pete-the-orc leak)", () => {
  const raw =
    "I need to identify the active campaign directory first. Let me call the seed-tables tool for a compelling opening scenario. They're listed as deferred but should be available now.\n\n---\n\nThe midday sun hangs low over Thornhaven.";
  assert.equal(stripMetaChatter(raw), "The midday sun hangs low over Thornhaven.");
});

test("strips backstage preamble when the model glues the --- onto the last sentence (#103)", () => {
  // The reported Bob-the-Guy leak: a long block of setup babble that ends
  // "...gets them into action immediately.---" with the dashes fused to the
  // sentence (no clean "\n---\n"), then the real opening prose.
  const raw =
    "I'll read the campaign state files first to establish what's already been set up for Bob the Guy. Now I'll seed the opening location and scene with the seed-tables tool to ensure it's grounded in the campaign's world: Let me load the seed-tables tool directly: I understand—these tools are available directly. Let me seed the opening location and call for an image of Bob the Guy: Let me correct the image generation call: Perfect. Based on the seed (a mystical well showing death and how to avoid it), I'll craft an opening that grounds Bob the Guy's appearance and gets them into action immediately.---\n\nThe moss squelches under your enormous feet as you descend toward the well.";
  assert.equal(
    stripMetaChatter(raw),
    "The moss squelches under your enormous feet as you descend toward the well."
  );
});

test("strips the same opening-setup babble even without any --- divider (#103)", () => {
  const raw =
    "I'll read the campaign state files first for Bob the Guy. Now I'll seed the opening location with the seed-tables tool. I understand—these tools are available directly. Let me correct the image generation call. Based on the seed, I'll craft an opening. The moss squelches under your enormous feet.";
  assert.equal(stripMetaChatter(raw), "The moss squelches under your enormous feet.");
});

test("keeps a legitimate --- scene break in ordinary prose (no backstage tokens) (#103 guard)", () => {
  // A real mid-scene divider with no backstage signal in the preamble must
  // survive — the loosened divider match is gated on BACKSTAGE_SIGNAL.
  const raw =
    "The gate crashes shut behind you.\n\n---\n\nHours later, you wake to torchlight and the smell of pitch.";
  assert.equal(stripMetaChatter(raw), raw);
});

test("strips a second opening-setup variant: hallucinated tool + colon-glued --- (#103 reopen)", () => {
  // The reopened-#103 leak: a *different* wording than the Bob-the-Guy case —
  // a hallucinated "texture-tables tool", "append the opening to the session
  // log", and the dashes glued onto a COLON ("...session log:---"), none of
  // which the first fix's punctuation-only divider or exact-tool-name signal
  // caught. Only the prose after the divider must survive.
  const raw =
    "I don't have access to the texture-tables tool in this context. Now I'll append the opening to the session log:---\n\nThe cave is cold and close, stone pressing in from above and behind. Your enormous slug body glistens with moisture in the dying firelight.";
  assert.equal(
    stripMetaChatter(raw),
    "The cave is cold and close, stone pressing in from above and behind. Your enormous slug body glistens with moisture in the dying firelight."
  );
});

test("keeps first-person NPC dialogue before a --- scene break (#103 reopen guard)", () => {
  // "I don't have access to..." is legitimate fiction in an NPC's mouth. The
  // signal is plumbing-only vocabulary (no generic "access"/"context"), so a
  // real scene break after such dialogue must be preserved verbatim.
  const raw =
    "\"I don't have access to the vault,\" the guard mutters, turning away.\n\n---\n\nYou step into the corridor, the torchlight guttering behind you.";
  assert.equal(stripMetaChatter(raw), raw);
});

test("strips directory and tool-access meta without a divider", () => {
  const raw =
    "I'm restricted to the active campaign's own directory. The DM tools are not available through direct tool calls. The corridor is dark ahead.";
  assert.equal(stripMetaChatter(raw), "The corridor is dark ahead.");
});

test("strips the post-turn 'updated session log' bookkeeping leak (#62)", () => {
  // The screenshot leak: a past-tense, asterisk-wrapped bookkeeping note glued
  // after the real narration. Both the emphasis and the sentence must go.
  assert.equal(
    stripMetaChatter("The gate groans open. *Updated session log with this turn's action.*"),
    "The gate groans open."
  );
  assert.equal(
    stripMetaChatter("Recorded this turn's action. You press deeper into the mist."),
    "You press deeper into the mist."
  );
  // False-positive guard: ordinary prose using these words as fiction survives.
  const prose = "She updated her grip and noted the exits before stepping inside.";
  assert.equal(stripMetaChatter(prose), prose);
});

test("strips a mid-play SESSION END epilogue and its divider (#72)", () => {
  // The reported leak: real narration, then a `---` divider, then a bold
  // SESSION END marker and a retrospective wrap-up — while the player is
  // still going. Everything from the divider onward must be cut.
  const raw =
    "For the first time since you arrived, you feel something like freedom.\n\n---\n\n**SESSION END**\n\nYou've traveled from Phoenix to the open ocean in a single night. The question that remains is: what now?";
  assert.equal(
    stripMetaChatter(raw),
    "For the first time since you arrived, you feel something like freedom."
  );
});

test("strips assorted end-of-session markers, keeps prior narration (#72)", () => {
  assert.equal(
    stripMetaChatter("The door closes behind you.\n\n**End of the First Session**\n\nWhat a journey it has been."),
    "The door closes behind you."
  );
  assert.equal(
    stripMetaChatter("Rain hammers the deck.\n\n**To be continued...**"),
    "Rain hammers the deck."
  );
});

test("leaves ordinary prose mentioning 'the end' untouched — needs the bold marker (#72)", () => {
  // No bold end-of-session marker: nothing is stripped.
  const prose = "You reach the end of the corridor. A door waits at the far side.";
  assert.equal(stripMetaChatter(prose), prose);
  // A bold marker sitting at the very top with no narration before it would
  // blank the reply, so the original is kept instead.
  const onlyMarker = "**The End**";
  assert.equal(stripMetaChatter(onlyMarker), onlyMarker);
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
