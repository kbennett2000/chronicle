/** Issue #46: the DM engine narrates its own file-bookkeeping between tool
 * calls ("Let me update state.", "Back to the story:"), and runTurn concatenates
 * every assistant text block verbatim with no separator, so that meta-chatter
 * leaks into player-facing narration (often glued to real prose:
 * "...update state.Back to the story:There's firelight ahead...").
 *
 * stripMetaChatter removes those bookkeeping segues. It is deliberately
 * CONSERVATIVE — it only strips a sentence when a bookkeeping verb
 * (update/record/save/write/log) is paired with a state/file object, plus the
 * specific "back to the story" segue. Ordinary prose that merely mentions
 * "state" ("the state of the kingdom", "let me see the state room") is left
 * untouched because it lacks that verb+object pairing. The prompt is the first
 * line of defense (it tells the model not to emit this at all); this is the
 * safety net for when it does anyway. */

/** Signals that text before a `---` divider is backstage reasoning, not fiction. */
const BACKSTAGE_SIGNAL =
  /(?:campaign directory|working directory|character sheet shows|initialize the (?:character|campaign)|dm tools|not available through|restricted to the active campaign|set up .{0,60}character sheet|set up the world-state|dice tool directly|seed-tables tool|roll_seed|listed as deferred|adjudicate the outcome directly)/i;

const META_PATTERNS: RegExp[] = [
  // "Let me / I'll / I need to — update|record|save|write|log ... state|files|sheet|roster|quest log|inventory ..."
  /\b(?:let me|i['’]ll|i will|i need to|now,?\s*(?:let me|i['’]ll)|first,?\s*let me)\b[^.!?\n]*?\b(?:update|record|save|writ(?:e|ing)|log|jot|note)\b[^.!?\n]*?\b(?:state|files?|character[-\s]?sheet|the sheet|world[-\s]?state|quest[-\s]?log|npc[-\s]?roster|inventory|hp)\b[^.!?\n]*?[.!?:]/gi,
  // Bare gerund bookkeeping: "Updating the character sheet now." / "Saving state."
  /\b(?:updating|saving|recording|writing|logging)\b[^.!?\n]*?\b(?:state|files?|character[-\s]?sheet|the sheet|world[-\s]?state|quest[-\s]?log|npc[-\s]?roster)\b[^.!?\n]*?[.!?:]/gi,
  // Segues back into fiction.
  /\b(?:now\s+)?back to (?:the )?(?:story|action|game|narration|scene)\b[.!?:]?/gi,
  // Campaign-directory / tool-access / initialization meta (issue #46 extension).
  /\b(?:let me|i need to|i['’]ll)\b[^.!?\n]*?\b(?:locate|search for|check|read from)\b[^.!?\n]*?\b(?:campaign|current campaign|working directory|campaign directory|campaign files?)\b[^.!?\n]*?[.!?:]/gi,
  /\bi(?:'m| am) restricted to\b[^.!?\n]*?[.!?:]/gi,
  /\bthe campaign (?:must be initialized|hasn't started yet|has not started yet)\b[^.!?\n]*?[.!?:]/gi,
  /\b(?:let me|i need to|now,? let me)\b[^.!?\n]*?\b(?:set up|initialize)\b[^.!?\n]*?\b(?:character|world[-\s]?state|vex|campaign)\b[^.!?\n]*?[.!?:]/gi,
  /\b(?:let me|i need to|now,? let me)\b[^.!?\n]*?\b(?:call|invoke|fetch|try calling)\b[^.!?\n]*?\b(?:seed[-\s]?tables?|roll_seed|dice)\b[^.!?\n]*?[.!?:]/gi,
  /\b(?:they(?:'re| are)|tools? (?:are|is))\b[^.!?\n]*?\b(?:listed as )?deferred\b[^.!?\n]*?[.!?:]/gi,
  /\b(?:let me|i['’]ll)\b[^.!?\n]*?\b(?:craft|create)\b[^.!?\n]*?\bopening scene\b[^.!?\n]*?[.!?:]/gi,
  /\b(?:the )?dm tools?\b[^.!?\n]*?\bnot available\b[^.!?\n]*?[.!?:]/gi,
  /\blet me narrate the scene and adjudicate\b[^.!?\n]*?[.!?:]/gi,
  // Inline rules math the model emits while setting up state.
  /\ba level \d+ [^.!?\n]*?\bshould have hp\b[^.!?\n]*?[.!?:]/gi,
  /\bwith (?:con|dex|str|int|wis|cha) \d+,? that'?s\b[^.!?\n]*?[.!?:]/gi,
];

/** Issue #44: backstage "let me roll for stealth" chatter only when the engine
 * rolls (auto-roll ON). With auto-roll OFF the DM must *ask the player* to roll,
 * and a phrasing like "I'll have you roll for a Stealth check" is legitimate,
 * player-facing text — stripping it here is exactly why the player "never gets
 * asked" their roll value. So this pattern is applied only when auto-roll is on. */
const DICE_META_PATTERN =
  /\b(?:let me|i['’]ll|now i['’]ll)\b[^.!?\n]*?\b(?:roll for|call the|adjudicate)\b[^.!?\n]*?\b(?:stealth|dice|check|contested)\b[^.!?\n]*?[.!?:]/gi;

function stripBackstagePreamble(text: string): string {
  const divider = text.indexOf("\n---\n");
  if (divider === -1) return text;
  const preamble = text.slice(0, divider);
  if (!BACKSTAGE_SIGNAL.test(preamble)) return text;
  return text.slice(divider + 5).trimStart();
}

function tidyWhitespace(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stripMetaChatter(text: string, opts: { autoRoll?: boolean } = {}): string {
  if (!text) return text;
  // Repair the run-together join first: textParts.join("") glues a sentence's
  // end punctuation to the next block's capital ("state.Back"), which both
  // reads badly and can hide a boundary from the patterns below.
  let out = text.replace(/([.!?:])(?=[A-Z"'“‘])/g, "$1 ");
  out = stripBackstagePreamble(out);
  for (const re of META_PATTERNS) out = out.replace(re, "");
  // Only scrub "let me roll for stealth" backstage chatter when the engine rolls
  // (issue #44). With auto-roll off, that phrasing is the DM asking the player.
  if (opts.autoRoll !== false) out = out.replace(DICE_META_PATTERN, "");
  return tidyWhitespace(out);
}