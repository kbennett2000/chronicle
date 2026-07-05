import { randomInt } from "node:crypto";
import { z } from "zod";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";

/** Issues #44/#45: a real, host-side dice roller so the DM stops asking the
 * player "what did you roll?" and stops inventing numbers in prose. Covers the
 * full 5e die set — d4, d6, d8, d10, d12, d20, d100 (and the d% percentile
 * spelling) — plus multiple dice (2d6), flat modifiers (1d20+5), and
 * advantage/disadvantage on a d20.
 *
 * RULES-REVIEW FLAG (for Kris, per CLAUDE.md): the mechanical reading below is
 * mine, cite against the SRD before trusting it —
 *   - advantage/disadvantage rolls the *whole* notation twice and keeps the
 *     higher/lower TOTAL (for the canonical single d20 this is exactly "roll
 *     two d20, take the higher"); on multi-die pools this is an interpretation.
 *   - a natural 20 / natural 1 is surfaced as a flag on a single-d20 roll so
 *     the model can adjudicate crits, but crit *damage* is left to the model.
 *   - modifiers are applied once to the kept total, not per die. */

export const STANDARD_DICE = [4, 6, 8, 10, 12, 20, 100] as const;
const MAX_DICE = 100;

export type RollMode = "normal" | "advantage" | "disadvantage";

export interface DiceRoll {
  /** Echo of what was rolled, normalized, e.g. "2d6+1" or "1d20 (advantage)". */
  notation: string;
  /** The individual die faces of the KEPT roll set. */
  rolls: number[];
  /** For advantage/disadvantage: the discarded roll set's faces. */
  discarded?: number[];
  modifier: number;
  total: number;
  mode: RollMode;
  /** True only for a single d20 whose kept die is a natural 20 / natural 1. */
  natural20?: boolean;
  natural1?: boolean;
  /** A one-line human/model-readable summary. */
  detail: string;
}

export class DiceNotationError extends Error {}

const NOTATION_RE = /^\s*(\d*)\s*d\s*(\d+|%)\s*$/i;

/** Parses "NdM" (count optional, `%` = 100) into {count, sides}; throws
 * DiceNotationError on anything malformed or out of bounds. Modifiers are
 * parsed separately by rollDice so "+5"/"-1" can trail the dice term. */
function parseDice(term: string): { count: number; sides: number } {
  const m = NOTATION_RE.exec(term);
  if (!m) throw new DiceNotationError(`unrecognized dice term: "${term}"`);
  const count = m[1] === "" ? 1 : Number(m[1]);
  const sides = m[2] === "%" ? 100 : Number(m[2]);
  if (!Number.isInteger(count) || count < 1 || count > MAX_DICE) {
    throw new DiceNotationError(`dice count must be 1–${MAX_DICE}, got ${count}`);
  }
  if (!Number.isInteger(sides) || sides < 2 || sides > 1000) {
    throw new DiceNotationError(`die must have 2–1000 sides, got ${sides}`);
  }
  return { count, sides };
}

function rollSet(count: number, sides: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(randomInt(1, sides + 1)); // unbiased, inclusive
  return out;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Rolls dice notation like "1d20+5", "2d6", "d100", "d%". `mode` applies
 * advantage/disadvantage (roll the whole thing twice, keep higher/lower total).
 * Pure except for the RNG — unit-tested with the modifier/mode branches. */
export function rollDice(notation: string, mode: RollMode = "normal"): DiceRoll {
  const raw = notation.trim().toLowerCase().replace(/\s+/g, "");
  // Split off a trailing flat modifier, e.g. "1d20+5" / "2d6-1".
  const modMatch = /([+-]\d+)$/.exec(raw);
  const modifier = modMatch ? Number(modMatch[1]) : 0;
  const diceTerm = modMatch ? raw.slice(0, modMatch.index) : raw;
  const { count, sides } = parseDice(diceTerm);

  const modeLabel = mode === "normal" ? "" : ` (${mode})`;
  const normNotation = `${count}d${sides}${modifier ? (modifier > 0 ? `+${modifier}` : modifier) : ""}${modeLabel}`;

  let kept: number[];
  let discarded: number[] | undefined;
  if (mode === "advantage" || mode === "disadvantage") {
    const a = rollSet(count, sides);
    const b = rollSet(count, sides);
    const keepA = mode === "advantage" ? sum(a) >= sum(b) : sum(a) <= sum(b);
    kept = keepA ? a : b;
    discarded = keepA ? b : a;
  } else {
    kept = rollSet(count, sides);
  }

  const total = sum(kept) + modifier;
  const isSingleD20 = count === 1 && sides === 20;
  const natural20 = isSingleD20 && kept[0] === 20 ? true : undefined;
  const natural1 = isSingleD20 && kept[0] === 1 ? true : undefined;

  const facesStr = `[${kept.join(", ")}]`;
  const discStr = discarded ? ` (dropped [${discarded.join(", ")}])` : "";
  const modStr = modifier ? ` ${modifier > 0 ? "+" : "−"} ${Math.abs(modifier)}` : "";
  const natStr = natural20 ? " — natural 20!" : natural1 ? " — natural 1!" : "";
  const detail = `Rolled ${normNotation}: ${facesStr}${discStr}${modStr} = ${total}${natStr}`;

  return { notation: normNotation, rolls: kept, discarded, modifier, total, mode, natural20, natural1, detail };
}

export const DICE_TOOL_NAME = "mcp__dice__roll_dice";

/** Built per-turn like the seed/texture servers. Only wired into a turn when
 * the campaign's autoRollDice setting is on (see dm-engine.ts) — when off, the
 * system prompt tells the model to ask the player for the value instead. */
export function createDiceMcpServer() {
  const rollDiceTool = tool(
    "roll_dice",
    `Roll actual dice for any d20 test (ability check, attack roll, saving
throw), damage roll, or other random resolution, then narrate the real
result — never invent the number yourself and never ask the player what they
rolled. Supports the full set: d4, d6, d8, d10, d12, d20, d100 (percentile,
also spelled d%), multiple dice (e.g. 2d6), and a flat modifier baked into the
notation (e.g. 1d20+5). Use the mode argument for advantage/disadvantage on a
d20. Call this once per roll the rules call for; use the returned total (and
the natural-20/natural-1 flags for crits) as the authoritative outcome.`,
    {
      notation: z
        .string()
        .describe('Dice to roll, e.g. "1d20+5", "2d6", "d100", "d%". Count and a +/- modifier are optional.'),
      mode: z
        .enum(["normal", "advantage", "disadvantage"])
        .optional()
        .describe("Advantage/disadvantage (rolls twice, keeps higher/lower). Defaults to normal."),
      reason: z
        .string()
        .optional()
        .describe('Optional short label for what this roll is, e.g. "Stealth check" — for your own narration.'),
    },
    async ({ notation, mode, reason }) => {
      try {
        const result = rollDice(notation, mode ?? "normal");
        const prefix = reason ? `${reason}: ` : "";
        return { content: [{ type: "text" as const, text: `${prefix}${result.detail}` }] };
      } catch (err) {
        const msg = err instanceof DiceNotationError ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Could not roll "${notation}" (${msg}). Use standard notation like 1d20+5, 2d6, or d100.`,
            },
          ],
        };
      }
    }
  );

  return createSdkMcpServer({ name: "dice", tools: [rollDiceTool] });
}
