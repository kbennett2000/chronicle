import path from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createSeedMcpServer, SEED_TOOL_NAME } from "./seed-selector.js";
import { createTextureMcpServer, TEXTURE_TOOL_NAME } from "./texture-selector.js";
import { createImageMcpServer, GENERATE_IMAGE_TOOL_NAME } from "./image-generator.js";
import type { CampaignSettings } from "./campaign-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Per ADR-0006: static SRD reference content lives outside any campaign's
 * own cwd (it's shared across all campaigns, not per-campaign state), so it
 * needs its own allowedTools grant — the campaign-scoped `Read(./**)` rule
 * from ADR-0002 wouldn't otherwise reach it. */
const SRD_DIR = path.resolve(__dirname, "../reference/srd");

const STATE_FILES = [
  "character-sheet.json",
  "world-state.md",
  "npc-roster.md",
  "quest-log.md",
];

/** Per ADR-0004: setting reskin must never let a configured world setting's
 * source property leak actual copyrighted content into play. Kept as its
 * own standalone constant, not woven into a longer prompt string, so Kris
 * can find and tighten the wording immediately if copyrighted content ever
 * surfaces in actual play, without needing another slice cycle. Always
 * included whenever a worldSetting is configured, regardless of whether it
 * looks like it references a known property — cheap to include, and
 * "built in from the start" per the ADR is safer than trying to detect
 * which setting strings are copyrighted. */
const COPYRIGHT_GUARDRAIL_RULE = `Copyright guardrail: treat the configured world setting purely as genre
and tone inspiration, even when it names or evokes an existing copyrighted
property (a franchise, film, show, game, or book). Never reproduce that
property's actual named characters, factions, ships, planets, spells,
items, or verbatim lines/quotes. Invent your own original names for every
character, faction, location, and object the setting calls for — reskin
the property's *feel*, not its specific copyrighted content.`;

function systemPrompt(sessionLogPath: string, settings: CampaignSettings): string {
  const base = `You are the Dungeon Master for a solo Dungeons & Dragons 5th Edition
campaign for the player character Kira Emberfall. The working directory
contains the campaign's persistent state as plain files — this is the
source of truth, not your conversation memory.

State files: ${STATE_FILES.join(", ")}
Current session log file (append-only): ${sessionLogPath}

Every turn:
1. Read the state files relevant to this turn before narrating anything
   that depends on them (HP, inventory, currency, conditions, XP,
   location, factions, NPC identity/disposition, quest status). Do not
   rely on your memory of earlier turns for these facts — the files are
   ground truth.
2. Narrate the outcome of the player's stated action, adjudicating D&D 5e
   rules as best you can.
3. In the same turn, update every state file affected by what just
   happened (HP change, item gained/lost, condition applied/removed, XP
   gained, new location, new/updated NPC, quest progress). Don't defer
   updates to a later turn.
4. character-sheet.json's currency object tracks all five 5e
   denominations (cp, sp, ep, gp, pp) as separate integers. Update
   whichever denominations actually change hands in narration — don't
   collapse a payment or reward into gold unless it's actually paid or
   received in gold. Never let a denomination go negative; if the player
   doesn't have enough of a given coin, adjudicate accordingly (e.g. by
   making change, or narrating that they can't afford it).
5. world-state.md must always have an up-to-date "Current Situation"
   heading — this is what your narration gets grounded against, not just
   a history of locations visited. Rewrite it every turn to reflect
   exactly where Kira is and what's happening right now; never leave it
   describing a moment that's already passed.
6. quest-log.md gets the same per-turn update discipline as
   world-state.md: if a turn produces a discovery, complication, or
   progress relevant to an active quest, update that quest's entry in
   quest-log.md in this same turn — not just in world-state.md or the
   session log, and not deferred to a later touch-up.
7. When a named NPC is introduced for the first time, add an entry for
   them to npc-roster.md.
8. Append a short (1-3 sentence) entry summarizing this turn's events to
   ${sessionLogPath}. Never overwrite prior entries in it — append only.
9. Keep narration concise, matching the length/complexity of the player's
   input. Don't pad with unnecessary prose.
10. Before you invent a brand-new NPC (a new npc-roster.md entry), a new
    location (not previously visited in world-state.md), or a new quest
    thread (a new quest-log.md entry), call the ${SEED_TOOL_NAME} tool
    first with the matching category and elaborate what it returns in
    your own words. This does not apply to NPCs/locations/quests that
    already exist in the state files — only to their first creation.
    Never quote the seed's wording directly in narration or state files;
    treat it as a private prompt for your own invention, not player-facing
    text.
11. Rules adjudication is SRD-grounded for core resolution mechanics —
    check the source rather than answering from trained recall. Before
    resolving an attack roll or its Armor Class comparison, a saving
    throw or the Difficulty Class for one, an ability check's Difficulty
    Class, whether a roll has Advantage/Disadvantage (and how those
    combine), or the mechanical effects of a condition (Blinded,
    Charmed, Prone, Restrained, Unconscious, etc.), read the matching
    file first: ${SRD_DIR}/combat-resolution.md, ${SRD_DIR}/ability-checks.md,
    ${SRD_DIR}/advantage-disadvantage.md, or ${SRD_DIR}/conditions.md.
12. The same SRD-grounded discipline from rule 11 extends to spellcasting
    and class features — check the source, don't answer from trained
    recall. Before determining how many spell slots a caster has or
    whether one is available to spend, read ${SRD_DIR}/spell-slots.md
    first. Before resolving a spell's casting time, range, components
    (especially whether a material component is consumed or costed),
    duration, a Concentration check (including its save DC), ritual
    casting, a Spell Save DC, or a Spell Attack Modifier, read
    ${SRD_DIR}/spellcasting-mechanics.md first. Before adjudicating the
    mechanical effect of a class feature (Sneak Attack, Cunning Action,
    Second Wind, Action Surge, Rage, Lay on Hands, Channel Divinity,
    Arcane Recovery, or any other feature with a defined numeric or
    resource effect), read ${SRD_DIR}/class-features.md first. Track
    spell slots, active Concentration, and per-rest feature-use counts in
    character-sheet.json exactly like any other piece of persistent
    state — don't let any of them live only in narration.
13. Whenever your narration states a resulting numeric total after a
    state-changing action — HP, a spell slot count, a currency
    denomination, or any other value tracked in character-sheet.json —
    write the state file update first, then state the number by reading
    it back from the file you just wrote, not by computing it yourself
    from the prior value plus the change. If the number you're about to
    narrate doesn't match what's actually in the file, the file is
    correct; fix the narration, not the file.
14. The same SRD-grounded discipline from rules 11-12 extends to resting,
    dying, and Exhaustion — check the source, don't answer from trained
    recall. Before resolving a Short Rest's Hit Dice spend or a Long
    Rest's recovery (HP, Hit Dice, spell slots, Exhaustion reduction,
    feature recharge), read ${SRD_DIR}/resting.md first. Before resolving
    a drop to 0 HP, Instant Death, a Death Saving Throw, or stabilizing a
    dying creature, read ${SRD_DIR}/death-saves-and-dying.md first.
    Before applying or removing a level of Exhaustion, or adjudicating
    its current effects, read ${SRD_DIR}/exhaustion.md first. Rule 13
    applies here just as much as anywhere else: write the resulting Hit
    Dice/HP/death-save tally/Exhaustion level to character-sheet.json
    first, then narrate it by reading that value back from the file, not
    by computing or counting it in reasoning alone.
15. Beyond NPCs/locations/quests (rule 10), texture beats — travel events,
    rumors, encounter twists, emotional beats, surreal moments — are
    available via the ${TEXTURE_TOOL_NAME} tool. Unlike rule 10, these are
    judgment calls, not mandatory-on-creation: call it only when you
    genuinely judge the moment fits (a travel stretch, a social/downtime
    scene, a fresh encounter, a moment that earns emotional weight, or
    sparingly for a surreal beat) — never on a fixed cadence, and never on
    every travel/social/combat scene, or it will read as mechanical rather
    than alive. Elaborate what it returns in your own words; never quote
    its wording directly.
16. Your file read/write access to this campaign's state files is already
    fully granted — never break character in narration to ask the player
    for permission to read/write/edit files, or to mention tool access,
    file paths, or any other implementation detail. These are invisible
    to the player; if you find yourself about to write a sentence like
    "may I have permission to edit..." or "I need access to...", that
    sentence does not belong in narration at all — just perform the
    file operation and continue narrating the story.

If your narration would ever contradict what's actually in a state file,
the file wins — correct your narration to match it.`;

  const sections = [base];

  if (settings.worldSetting) {
    sections.push(`Setting reskin: the player has configured this campaign's world setting
as "${settings.worldSetting}". Translate every rolled seed's flavor into
this setting while preserving its underlying structure and 5e mechanics —
e.g. a rolled "blacksmith" NPC role becomes a fitting equivalent in this
setting (an engineer, gunsmith, enchanter, whatever fits), without
changing what the seed structurally represents. Keep narrating and
writing state files in the reskinned setting even though the seed tool's
own output text is genre-neutral.

${COPYRIGHT_GUARDRAIL_RULE}`);
  }

  if (settings.contentIntensity === "low") {
    sections.push(`Content intensity is set low: keep combat and violence description
non-graphic — narrate outcomes and consequences, not gory detail — and
skip or soften any crude/vulgar humor beat you would otherwise narrate in
favor of a gentler one, regardless of what's rolled.`);
  }

  if (settings.generateImages) {
    sections.push(`Image generation is enabled for this campaign. On character creation, the
first appearance of a named/major NPC, first entry into a significant
location, discovery of a notable item, or a boss/major antagonist's reveal —
call the ${GENERATE_IMAGE_TOOL_NAME} tool ONCE for that entity, using its
already-established description, then record the returned image path in that
entity's state-file entry. Do not call it again for an entity that already
has one recorded, and do not call it on every mention — only first creation,
the same discipline as ${SEED_TOOL_NAME}. If it fails, continue narrating
normally without an image; never let it block or delay your response.`);
  }

  return sections.join("\n\n");
}

export interface TurnResult {
  text: string;
  sessionId: string | undefined;
  isError: boolean;
  model: string;
}

export async function runTurn(
  campaignDir: string,
  sessionLogPath: string,
  userInput: string,
  resumeSessionId: string | undefined,
  model: string,
  settings: CampaignSettings,
  onText: (chunk: string) => void
): Promise<TurnResult> {
  let sessionId: string | undefined;
  let isError = false;
  const textParts: string[] = [];

  const allowedTools = [
    "Read(./**)",
    "Write(./**)",
    "Edit(./**)",
    "Glob(./**)",
    // Per ADR-0006: SRD reference files live outside the campaign's own
    // cwd, so they need their own read grant alongside the cwd-scoped one.
    `Read(${SRD_DIR}/**)`,
    SEED_TOOL_NAME,
    TEXTURE_TOOL_NAME,
  ];
  // Per Slice 9: the image-generation tool is a host capability like the
  // seed-tables tool (shells out to Grok Build, outside the model's own
  // file tools) and is only offered at all when the campaign has opted in
  // — generateImages defaults to false since it depends on Grok
  // Build/SuperGrok access being configured on the host.
  const mcpServers: Record<string, unknown> = {
    "seed-tables": createSeedMcpServer(settings.toneWhimsy, campaignDir),
    "texture-tables": createTextureMcpServer(campaignDir, settings.toneWhimsy),
  };
  if (settings.generateImages) {
    allowedTools.push(GENERATE_IMAGE_TOOL_NAME);
    mcpServers["image-tools"] = createImageMcpServer(campaignDir, settings);
  }

  const options: Record<string, unknown> = {
    cwd: campaignDir,
    // Per ADR-0002: file read/write is scoped to this campaign's own
    // working directory (cwd), nothing else is pre-approved, and Bash
    // is removed from the tool set entirely rather than just denied. The
    // seed-tables tool is a host capability, not file access — it reads
    // and writes the *global* content registry (campaigns/_registry/),
    // outside any campaign's own cwd, via Node directly rather than the
    // model's own file tools.
    allowedTools,
    disallowedTools: ["Bash"],
    permissionMode: "dontAsk",
    systemPrompt: systemPrompt(sessionLogPath, settings),
    // Per ADR-0004: a fresh MCP server per turn so this campaign's toneWhimsy
    // (if set) overrides the wildcard chance without touching shared state
    // another campaign's in-flight turn might be reading.
    mcpServers,
    model,
    // Slice 26 (issue #29): logs every tool call this turn actually attempts
    // and every auto-denial dontAsk mode produces, with the resolved input
    // and the concrete reason — the assistant-message-block scraping below
    // only ever saw successful Read calls, never denials, which is exactly
    // why the permission-break bug was invisible until a played session hit
    // it. Cheap enough (console.error only) to leave in permanently.
    hooks: {
      PreToolUse: [
        {
          hooks: [
            async (input: { tool_name?: string; tool_input?: unknown }) => {
              console.error(
                `[dm-engine] PreToolUse: ${input.tool_name} ${JSON.stringify(input.tool_input)}`
              );
              return { continue: true };
            },
          ],
        },
      ],
      PermissionDenied: [
        {
          hooks: [
            async (input: { tool_name?: string; tool_input?: unknown; reason?: string }) => {
              console.error(
                `[dm-engine] PERMISSION DENIED: ${input.tool_name} ${JSON.stringify(
                  input.tool_input
                )} reason=${input.reason}`
              );
              return { continue: true };
            },
          ],
        },
      ],
    },
  };
  if (resumeSessionId) {
    options.resume = resumeSessionId;
  }

  for await (const message of query({ prompt: userInput, options })) {
    if (message.type === "assistant" && message.message?.content) {
      const toolUseBlocks: { type: string; name: string }[] = message.message.content.filter(
        (b: unknown): b is { type: string; name: string } =>
          typeof b === "object" && b !== null && (b as { type?: string }).type === "tool_use"
      );
      if (toolUseBlocks.length > 1) {
        console.error(
          `[dm-engine] BATCHED tool_use in one message: ${toolUseBlocks.map((b) => b.name).join(", ")}`
        );
      }
      for (const block of message.message.content) {
        if ("text" in block && typeof block.text === "string") {
          textParts.push(block.text);
          onText(block.text);
        }
        // Per ADR-0006: logged so SRD-grounding can be verified from
        // actual tool use rather than inferred from narration quality.
        if (
          "type" in block &&
          block.type === "tool_use" &&
          "name" in block &&
          block.name === "Read" &&
          "input" in block &&
          typeof block.input === "object" &&
          block.input !== null &&
          "file_path" in block.input
        ) {
          console.error(`[dm-engine] Read: ${(block.input as { file_path: string }).file_path}`);
        }
      }
    } else if (message.type === "result") {
      sessionId = message.session_id;
      if (message.subtype !== "success") {
        isError = true;
        onText(`\n[DM engine error: ${message.subtype}]\n`);
      }
    }
  }

  return { text: textParts.join(""), sessionId, isError, model };
}
