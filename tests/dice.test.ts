import { test } from "node:test";
import assert from "node:assert/strict";
import { rollDice, DiceNotationError, STANDARD_DICE } from "../src/dice.js";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

test("rollDice covers the full standard die set within range (#45)", () => {
  for (const sides of STANDARD_DICE) {
    for (let i = 0; i < 50; i++) {
      const r = rollDice(`d${sides}`);
      assert.equal(r.rolls.length, 1);
      assert.ok(r.rolls[0] >= 1 && r.rolls[0] <= sides, `d${sides} out of range: ${r.rolls[0]}`);
      assert.equal(r.total, r.rolls[0]);
    }
  }
});

test("percentile spellings d100 and d% both roll 1–100", () => {
  for (const term of ["d100", "d%", "D%"]) {
    for (let i = 0; i < 50; i++) {
      const r = rollDice(term);
      assert.ok(r.rolls[0] >= 1 && r.rolls[0] <= 100);
    }
  }
});

test("multiple dice and flat modifiers combine correctly", () => {
  for (let i = 0; i < 50; i++) {
    const r = rollDice("2d6+1");
    assert.equal(r.rolls.length, 2);
    assert.equal(r.modifier, 1);
    assert.equal(r.total, sum(r.rolls) + 1);
    assert.ok(r.total >= 3 && r.total <= 13);
  }
  const neg = rollDice("1d20-2");
  assert.equal(neg.modifier, -2);
  assert.equal(neg.total, neg.rolls[0] - 2);
});

test("advantage keeps the higher set, disadvantage the lower (#44)", () => {
  for (let i = 0; i < 100; i++) {
    const adv = rollDice("1d20", "advantage");
    assert.ok(adv.discarded, "advantage should record a discarded roll");
    assert.ok(sum(adv.rolls) >= sum(adv.discarded!), "advantage kept a lower set");

    const dis = rollDice("1d20", "disadvantage");
    assert.ok(sum(dis.rolls) <= sum(dis.discarded!), "disadvantage kept a higher set");
  }
});

test("natural 20 / natural 1 flags only fire on a single d20", () => {
  // Statistically both faces show up across enough rolls.
  let saw20 = false;
  let saw1 = false;
  for (let i = 0; i < 2000 && !(saw20 && saw1); i++) {
    const r = rollDice("1d20");
    if (r.rolls[0] === 20) {
      assert.equal(r.natural20, true);
      saw20 = true;
    }
    if (r.rolls[0] === 1) {
      assert.equal(r.natural1, true);
      saw1 = true;
    }
  }
  assert.ok(saw20 && saw1, "expected to observe both a natural 20 and a natural 1");
  // A d6 max is never a "natural 20".
  for (let i = 0; i < 50; i++) assert.equal(rollDice("d6").natural20, undefined);
});

test("malformed or out-of-bounds notation throws DiceNotationError", () => {
  for (const bad of ["", "d", "20", "1d0", "0d6", "101d6", "1d1001", "3dX", "d20+"]) {
    assert.throws(() => rollDice(bad), DiceNotationError, `expected throw for "${bad}"`);
  }
});
