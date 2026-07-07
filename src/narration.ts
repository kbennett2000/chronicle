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
  /(?:campaign directory|working directory|campaign state files?|character sheet shows|initialize the (?:character|campaign)|dm tools|not available through|restricted to the active campaign|set up .{0,60}character sheet|set up the world-state|dice tool directly|seed-tables tool|seed the opening|roll_seed|listed as deferred|these tools are available|image generation call|adjudicate the outcome directly)/i;

/** A `---` scene-divider, tolerant of the model gluing the dashes onto the end
 * of the preceding sentence (issue #103: "...into action immediately.---\n\n")
 * rather than emitting the clean "\n---\n" the older split assumed. Requires a
 * newline or end-of-text after the dashes so an inline "word --- word" em-dash
 * usage never counts. This only ever fires when the preamble also matches
 * BACKSTAGE_SIGNAL, so a legitimate mid-scene "\n---\n" break in real fiction
 * (no backstage tokens) is left untouched. */
const BACKSTAGE_DIVIDER = /(?:^|\n|[ \t.!?…])[ \t]*-{3,}[ \t]*(?:\n|$)/;

const META_PATTERNS: RegExp[] = [
  // "Let me / I'll / I need to — update|record|save|write|log ... state|files|sheet|roster|quest log|inventory ..."
  /\b(?:let me|i['’]ll|i will|i need to|now,?\s*(?:let me|i['’]ll)|first,?\s*let me)\b[^.!?\n]*?\b(?:update|record|save|writ(?:e|ing)|log|jot|note)\b[^.!?\n]*?\b(?:state|files?|character[-\s]?sheet|the sheet|world[-\s]?state|quest[-\s]?log|session[-\s]?log|npc[-\s]?roster|inventory|hp)\b[^.!?\n]*?[.!?:]/gi,
  // Bare gerund bookkeeping: "Updating the character sheet now." / "Saving state."
  /\b(?:updating|saving|recording|writing|logging)\b[^.!?\n]*?\b(?:state|files?|character[-\s]?sheet|the sheet|world[-\s]?state|quest[-\s]?log|session[-\s]?log|npc[-\s]?roster)\b[^.!?\n]*?[.!?:]/gi,
  // Past-tense / asterisk-wrapped bookkeeping the model emits AFTER writing state
  // (issue #62): "*Updated session log with this turn's action.*", "Recorded this
  // turn's action.". Strips any surrounding markdown emphasis too.
  /\*{0,2}\s*\b(?:updated?|saved|recorded|logged|wrote|noted|jotted)\b[^.!?\n]*?\b(?:session[-\s]?log|turn['’]s action|the log|state[-\s]?files?|world[-\s]?state|character[-\s]?sheet)\b[^.!?\n]*?[.!?]\s*\*{0,2}/gi,
  // Segues back into fiction.
  /\b(?:now\s+)?back to (?:the )?(?:story|action|game|narration|scene)\b[.!?:]?/gi,
  // Campaign-directory / tool-access / initialization meta (issue #46 extension).
  /\b(?:let me|i need to|i['’]ll)\b[^.!?\n]*?\b(?:locate|search for|check|read from)\b[^.!?\n]*?\b(?:campaign|current campaign|working directory|campaign directory|campaign files?)\b[^.!?\n]*?[.!?:]/gi,
  /\bi(?:'m| am) restricted to\b[^.!?\n]*?[.!?:]/gi,
  /\bthe campaign (?:must be initialized|hasn't started yet|has not started yet)\b[^.!?\n]*?[.!?:]/gi,
  /\b(?:let me|i need to|now,? let me)\b[^.!?\n]*?\b(?:set up|initialize)\b[^.!?\n]*?\b(?:character|world[-\s]?state|vex|campaign)\b[^.!?\n]*?[.!?:]/gi,
  /\b(?:let me|i need to|now,?\s*(?:let me|i['’]ll))\b[^.!?\n]*?\b(?:call|invoke|fetch|load|try calling)\b[^.!?\n]*?\b(?:seed[-\s]?tables?|roll_seed|dice)\b[^.!?\n]*?[.!?:]/gi,
  /\b(?:they(?:'re| are)|tools? (?:are|is))\b[^.!?\n]*?\b(?:listed as )?deferred\b[^.!?\n]*?[.!?:]/gi,
  /\b(?:let me|i['’]ll)\b[^.!?\n]*?\b(?:craft|create)\b[^.!?\n]*?\bopening(?:\s+scene)?\b[^.!?\n]*?[.!?:]/gi,
  /\b(?:the )?dm tools?\b[^.!?\n]*?\bnot available\b[^.!?\n]*?[.!?:]/gi,
  /\blet me narrate the scene and adjudicate\b[^.!?\n]*?[.!?:]/gi,
  // Issue #103: opening-turn setup babble the model sometimes emits with no
  // `---` divider — "I'll read the campaign state files first...", "Now I'll
  // seed the opening location...", "Let me correct the image generation
  // call:", "these tools are available directly.", "Based on the seed (...)".
  /\b(?:let me|i['’]ll|i will|i need to|now,?\s*(?:let me|i['’]ll))\b[^.!?\n]*?\bread\b[^.!?\n]*?\bcampaign (?:state )?files?\b[^.!?\n]*?[.!?:]/gi,
  /\b(?:let me|i['’]ll|i will|i need to|now,?\s*(?:let me|i['’]ll))\b[^.!?\n]*?\bseed\b[^.!?\n]*?\b(?:opening|location|scene)\b[^.!?\n]*?[.!?:]/gi,
  /\b(?:let me|i['’]ll|i need to)\b[^.!?\n]*?\b(?:correct|fix|retry|redo)\b[^.!?\n]*?\bimage[-\s]?generation\b[^.!?\n]*?[.!?:]/gi,
  /\b(?:i understand|understood)\b[^.!?\n]*?\btools?\b[^.!?\n]*?\bavailable\b[^.!?\n]*?[.!?:]/gi,
  // Strip only the "Based on the seed (…)," connective lead-in — never a whole
  // clause, so it can't run into real prose once a neighbouring pattern removes
  // the sentence that used to follow it.
  /\bbased on (?:the )?(?:seed|roll_seed|seed[-\s]?tables?)\b\s*(?:\([^)\n]*\))?\s*[,:]?\s*/gi,
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
  const match = BACKSTAGE_DIVIDER.exec(text);
  if (!match) return text;
  const preamble = text.slice(0, match.index);
  if (!BACKSTAGE_SIGNAL.test(preamble)) return text;
  return text.slice(match.index + match[0].length).trimStart();
}

/** Issue #72: the model sometimes declares the session over mid-play — a bold
 * `**SESSION END**` / `**End of the First Session**` marker followed by a
 * retrospective epilogue — even though the player is still going. Rule 19 of
 * the system prompt tells it not to; this is the safety net for when it does.
 * Deliberately CONSERVATIVE: it only fires on an explicit BOLD end-of-session
 * marker (ordinary prose that merely says "the end of the session" is left
 * alone), then drops that marker, any `---` divider immediately preceding it,
 * and everything after it. If a match would blank the whole reply (the marker
 * sits at the very top with no narration before it), the original text is kept
 * — better a stray epilogue than an empty turn. */
const SESSION_END_MARKER =
  /\*\*\s*(?:session\s+end(?:ed|s)?|end\s+of\s+(?:the\s+|our\s+|this\s+|your\s+|first\s+|second\s+|third\s+|fourth\s+|fifth\s+)*session|the\s+end|to\s+be\s+continued|fin)[\s.!?…]*\*\*/i;

function stripSessionEndEpilogue(text: string): string {
  const marker = SESSION_END_MARKER.exec(text);
  if (!marker) return text;
  let cut = marker.index;
  // Also swallow a `---`/`***` scene-break divider (and any blank lines) sitting
  // immediately before the marker, so the reply doesn't end on a dangling rule.
  const dividerBefore = /\n[ \t]*(?:-{3,}|\*{3,})[ \t]*\n\s*$/.exec(text.slice(0, cut));
  if (dividerBefore) cut = dividerBefore.index;
  const kept = text.slice(0, cut).trimEnd();
  return kept.trim() ? kept : text;
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
  // Issue #72: drop any "session over" epilogue the model tacked on mid-play.
  out = stripSessionEndEpilogue(out);
  for (const re of META_PATTERNS) out = out.replace(re, "");
  // Only scrub "let me roll for stealth" backstage chatter when the engine rolls
  // (issue #44). With auto-roll off, that phrasing is the DM asking the player.
  if (opts.autoRoll !== false) out = out.replace(DICE_META_PATTERN, "");
  return tidyWhitespace(out);
}