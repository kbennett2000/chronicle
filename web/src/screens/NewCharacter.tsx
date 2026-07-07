import { useEffect, useMemo, useState } from "react";
import type { Connection } from "../lib/connection";
import {
  createCampaign,
  startSession,
  getModels,
  getNewGameDefaults,
  type CharacterCreationInput,
  type CampaignCreationSettings,
  type ModelOption,
  type ProviderOption,
  type ResponseLength,
} from "../lib/campaign";
import { ToggleRow, ArtStylePicker } from "../components/LookControls";
import { SKILLS } from "../lib/character-derive";

interface NewCharacterProps {
  connection: Connection;
  onCreated: (campaignId: string) => void;
  onCancel: () => void;
}

// Client copy of the server's char-gen data (src/character-gen.ts). The server
// is authoritative on submit; these drive the live preview only.
const RACES = ["Human", "Elf", "Dwarf", "Halfling", "Dragonborn", "Gnome", "Half-Elf", "Half-Orc", "Tiefling", "Orc", "Aasimar", "Goliath"];
const CLASS_HIT_DICE: Record<string, number> = {
  Barbarian: 12, Fighter: 10, Paladin: 10, Ranger: 10,
  Bard: 8, Cleric: 8, Druid: 8, Monk: 8, Rogue: 8, Warlock: 8,
  Sorcerer: 6, Wizard: 6,
};
const CLASSES = Object.keys(CLASS_HIT_DICE);
// Mirrors MAX_APPEARANCE_CHARS in src/character-gen.ts (server is authoritative).
const MAX_APPEARANCE_CHARS = 600;

// Mirrors src/character-gen.ts CLASS_SKILL_CHOICES / CLASS_SAVE_PROFICIENCIES
// (ADR-0015). Server validates on submit; these drive the picker + preview.
const CLASS_SKILL_CHOICES: Record<string, { list: string[]; choose: number }> = {
  Barbarian: { list: ["animalHandling", "athletics", "intimidation", "nature", "perception", "survival"], choose: 2 },
  Bard: { list: SKILLS.map((s) => s.key), choose: 3 },
  Cleric: { list: ["history", "insight", "medicine", "persuasion", "religion"], choose: 2 },
  Druid: { list: ["arcana", "animalHandling", "insight", "medicine", "nature", "perception", "religion", "survival"], choose: 2 },
  Fighter: { list: ["acrobatics", "animalHandling", "athletics", "history", "insight", "intimidation", "perception", "survival"], choose: 2 },
  Monk: { list: ["acrobatics", "athletics", "history", "insight", "religion", "stealth"], choose: 2 },
  Paladin: { list: ["athletics", "insight", "intimidation", "medicine", "persuasion", "religion"], choose: 2 },
  Ranger: { list: ["animalHandling", "athletics", "insight", "investigation", "nature", "perception", "stealth", "survival"], choose: 3 },
  Rogue: { list: ["acrobatics", "athletics", "deception", "insight", "intimidation", "investigation", "perception", "performance", "persuasion", "sleightOfHand", "stealth"], choose: 4 },
  Sorcerer: { list: ["arcana", "deception", "insight", "intimidation", "persuasion", "religion"], choose: 2 },
  Warlock: { list: ["arcana", "deception", "history", "intimidation", "investigation", "nature", "religion"], choose: 2 },
  Wizard: { list: ["arcana", "history", "insight", "investigation", "medicine", "religion"], choose: 2 },
};
const CLASS_SAVE_PROFICIENCIES: Record<string, string[]> = {
  Barbarian: ["STR", "CON"], Bard: ["DEX", "CHA"], Cleric: ["WIS", "CHA"], Druid: ["INT", "WIS"],
  Fighter: ["STR", "CON"], Monk: ["STR", "DEX"], Paladin: ["WIS", "CHA"], Ranger: ["STR", "DEX"],
  Rogue: ["DEX", "INT"], Sorcerer: ["CON", "CHA"], Warlock: ["WIS", "CHA"], Wizard: ["INT", "WIS"],
};
// Rogue gets 2 expertise picks at level 1; others 0 (ADR-0015 rules-review item 11).
const EXPERTISE_COUNT: Record<string, number> = { Rogue: 2 };
const skillLabel = (key: string) => SKILLS.find((s) => s.key === key)?.label ?? key;

type Ability = "strength" | "dexterity" | "constitution" | "intelligence" | "wisdom" | "charisma";
const ABILITIES: Array<{ key: Ability; label: string }> = [
  { key: "strength", label: "STR" },
  { key: "dexterity", label: "DEX" },
  { key: "constitution", label: "CON" },
  { key: "intelligence", label: "INT" },
  { key: "wisdom", label: "WIS" },
  { key: "charisma", label: "CHA" },
];

// Standard 5e point-buy: 27 points, scores 8–15.
const POINT_BUY_BUDGET = 27;
const POINT_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const MIN_SCORE = 8;
const MAX_SCORE = 15;

const modifier = (score: number) => Math.floor((score - 10) / 2);
const fmtMod = (m: number) => (m >= 0 ? `+${m}` : `${m}`);

const inputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  background: "rgba(12,8,5,.5)",
  border: "1px solid rgba(109,90,56,.4)",
  borderRadius: 4,
  padding: "10px 13px",
  color: "var(--ink)",
  fontFamily: "var(--font-body)",
  fontSize: 14,
  outline: "none",
};

const labelStyle = { fontSize: 11, color: "var(--ink-dim)", margin: "16px 0 4px", letterSpacing: 0.5 } as const;

// Same vocabulary as the Settings screen so a world described here reads the
// same once you edit it later (issue #48).
const INTENSITY_OPTIONS: Array<{ id: "standard" | "low"; label: string; note: string }> = [
  { id: "standard", label: "Standard", note: "Full range of humour and description." },
  { id: "low", label: "Low", note: "No crude humour; violence stays non-graphic." },
];

// Issue #69: how long/detailed the DM's replies run. Absent === "detailed".
const LENGTH_OPTIONS: Array<{ id: ResponseLength; label: string; note: string }> = [
  { id: "concise", label: "Concise", note: "Short replies that mirror your input." },
  { id: "standard", label: "Standard", note: "A paragraph or two per scene." },
  { id: "detailed", label: "Detailed", note: "Rich, immersive narration." },
];

export function NewCharacter({ connection, onCreated, onCancel }: NewCharacterProps) {
  const [name, setName] = useState("");
  const [race, setRace] = useState(RACES[0]);
  const [klass, setKlass] = useState("Rogue");
  const [scores, setScores] = useState<Record<Ability, number>>({
    strength: 8, dexterity: 8, constitution: 8, intelligence: 8, wisdom: 8, charisma: 8,
  });
  // Issue #71: free-text look, fed to the character's portrait prompt.
  const [appearance, setAppearance] = useState("");
  // Issue #67 (ADR-0015): class skill picks, optional expertise, identity.
  const [skillProficiencies, setSkillProficiencies] = useState<string[]>([]);
  const [expertise, setExpertise] = useState<string[]>([]);
  const [background, setBackground] = useState("");
  const [alignment, setAlignment] = useState("");
  const [personality, setPersonality] = useState({ traits: "", ideals: "", bonds: "", flaws: "" });
  const [worldSetting, setWorldSetting] = useState("");
  const [toneWhimsy, setToneWhimsy] = useState(0);
  const [contentIntensity, setContentIntensity] = useState<"standard" | "low">("standard");
  // Issue #69: reply length, pre-filled from the last game; default detailed.
  const [responseLength, setResponseLength] = useState<ResponseLength>("detailed");
  // Issue #64: look/play dials, surfaced here and pre-filled from the last game
  // (GET /new-game-defaults) so a new game starts like the one you already play,
  // instead of reverting to images-off / auto-roll-on and forcing a reconfigure.
  const [generateImages, setGenerateImages] = useState(false);
  const [autoIllustrateTurns, setAutoIllustrateTurns] = useState(false);
  const [artStyle, setArtStyle] = useState("");
  const [autoRollDice, setAutoRollDice] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Issue #57/#64: pick the model at new-game time, pre-filled from the last
  // game — so a new game doesn't silently start on Sonnet after you set Haiku.
  const [models, setModels] = useState<ModelOption[]>([]);
  const [model, setModel] = useState<string | null>(null);
  // ADR-0018: pick the DM engine (Claude/Grok) up front, seeded from the last
  // game's provider. The model list below is filtered to this provider.
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [provider, setProvider] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getModels(connection), getNewGameDefaults(connection)])
      .then(([modelsResult, defaults]) => {
        if (cancelled) return;
        setModels(modelsResult.models);
        setProviders(modelsResult.providers);
        // Pre-fill every dial from the last game's settings, falling back to the
        // neutral scaffold defaults when a field — or the whole last game — is
        // absent (a fresh install with no prior campaign).
        // Resolve the provider first (last game's or the server default), then
        // reconcile the model against it: keep the last model only if it belongs
        // to that provider, else fall back to the provider's default. This keeps
        // the {provider, model} pair valid, which the server enforces on create.
        const nextProvider = defaults.provider ?? modelsResult.defaultProvider;
        setProvider(nextProvider);
        const p = modelsResult.providers.find((x) => x.id === nextProvider);
        const wantModel = defaults.model;
        const modelValid = !!wantModel && !!p && p.models.some((m) => m.id === wantModel);
        setModel(modelValid ? wantModel! : p?.default ?? modelsResult.default);
        setGenerateImages(defaults.generateImages ?? false);
        setAutoIllustrateTurns(defaults.autoIllustrateTurns ?? false);
        setArtStyle(defaults.artStyle ?? "");
        setAutoRollDice(defaults.autoRollDice ?? true);
        if (defaults.contentIntensity) setContentIntensity(defaults.contentIntensity);
        if (defaults.responseLength) setResponseLength(defaults.responseLength);
        if (defaults.toneWhimsy !== undefined) setToneWhimsy(defaults.toneWhimsy);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [connection]);

  /** Switch engine: reset the selected model to the new provider's default
   * unless the current one already belongs to it. */
  function pickProvider(providerId: string) {
    setProvider(providerId);
    const p = providers.find((x) => x.id === providerId);
    if (p && (!model || !p.models.some((m) => m.id === model))) setModel(p.default);
  }

  const providerModels = providers.find((p) => p.id === provider)?.models ?? models;

  const spent = useMemo(() => ABILITIES.reduce((sum, a) => sum + POINT_COST[scores[a.key]], 0), [scores]);
  const remaining = POINT_BUY_BUDGET - spent;

  // Issue #67: skills depend on class; changing class clears prior picks.
  const skillChoice = CLASS_SKILL_CHOICES[klass];
  const expertiseCount = EXPERTISE_COUNT[klass] ?? 0;
  function selectClass(next: string) {
    setKlass(next);
    setSkillProficiencies([]);
    setExpertise([]);
  }
  function toggleSkill(key: string) {
    setSkillProficiencies((prev) => {
      if (prev.includes(key)) {
        setExpertise((ex) => ex.filter((k) => k !== key)); // expertise can't outlive its proficiency
        return prev.filter((k) => k !== key);
      }
      if (prev.length >= skillChoice.choose) return prev; // at the cap; ignore
      return [...prev, key];
    });
  }
  function toggleExpertise(key: string) {
    setExpertise((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (prev.length >= expertiseCount) return prev;
      return [...prev, key];
    });
  }
  const skillsComplete = skillProficiencies.length === skillChoice.choose;
  const expertiseComplete = expertise.length === expertiseCount;

  function adjust(ability: Ability, delta: number) {
    setScores((prev) => {
      const next = prev[ability] + delta;
      if (next < MIN_SCORE || next > MAX_SCORE) return prev;
      const wouldSpend = spent - POINT_COST[prev[ability]] + POINT_COST[next];
      if (wouldSpend > POINT_BUY_BUDGET) return prev;
      return { ...prev, [ability]: next };
    });
  }

  const maxHp = Math.max(1, CLASS_HIT_DICE[klass] + modifier(scores.constitution));
  const armorClass = 10 + modifier(scores.dexterity);
  // Issue #67 derived preview (all flagged for rules review, see ADR-0015).
  const raceSpeed: Record<string, number> = { Goliath: 35 };
  const speed = raceSpeed[race] ?? 30;
  const initiativeMod = modifier(scores.dexterity);
  const perceptionProficient = skillProficiencies.includes("perception");
  const passivePerception = 10 + modifier(scores.wisdom) + (perceptionProficient ? 2 : 0);
  const canCreate = name.trim().length > 0 && remaining >= 0 && skillsComplete && expertiseComplete && !creating;

  async function submit() {
    if (!canCreate) return;
    setCreating(true);
    setError(null);
    const character: CharacterCreationInput = { name: name.trim(), race, class: klass, abilityScores: scores };
    if (appearance.trim()) character.appearance = appearance.trim();
    // Issue #67: send the class skill picks (+ any expertise) and identity.
    character.skillProficiencies = skillProficiencies;
    if (expertise.length) character.expertise = expertise;
    if (background.trim()) character.background = background.trim();
    if (alignment.trim()) character.alignment = alignment.trim();
    const perso = {
      traits: personality.traits.trim(),
      ideals: personality.ideals.trim(),
      bonds: personality.bonds.trim(),
      flaws: personality.flaws.trim(),
    };
    if (Object.values(perso).some(Boolean)) character.personality = perso;
    // Issue #64: send every dial explicitly from the form so the new game stores
    // its own complete copy of look/play/model (no reliance on a per-device
    // cache, and no seed-then-override asymmetry that once let a stale
    // contentIntensity beat the visible picker). worldSetting/artStyle are the
    // only ones omitted when blank, keeping the standard-fantasy default.
    const settings: CampaignCreationSettings = {
      generateImages,
      autoIllustrateTurns,
      autoRollDice,
      contentIntensity,
      responseLength,
      toneWhimsy,
    };
    if (artStyle.trim()) settings.artStyle = artStyle.trim();
    if (worldSetting.trim()) settings.worldSetting = worldSetting.trim();
    // ADR-0018: seed the new campaign with the chosen engine + model. The server
    // validates that model belongs to provider.
    if (provider) settings.provider = provider;
    if (model) settings.model = model;
    try {
      const campaignId = await createCampaign(connection, character, settings);
      await startSession(connection, campaignId);
      onCreated(campaignId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  }

  return (
    <div className="screen leather-ground">
      <div
        style={{
          flexShrink: 0,
          padding: "54px 16px 12px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderBottom: "1px solid rgba(109,90,56,.3)",
        }}
      >
        <button className="icon-button" data-testid="newchar-back" onClick={onCancel}>
          <span className="back-chevron" />
        </button>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, letterSpacing: 2, color: "var(--ink)" }}>
          NEW CHRONICLE
        </div>
      </div>

      <div className="cx-scroll" style={{ flex: 1, overflowY: "auto", padding: "18px 18px 40px" }}>
        <div style={labelStyle}>Name</div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Kira Emberfall"
          data-testid="newchar-name"
          style={inputStyle}
        />

        <div style={labelStyle}>Ancestry</div>
        <select value={race} onChange={(e) => setRace(e.target.value)} data-testid="newchar-race" style={inputStyle}>
          {RACES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>

        <div style={labelStyle}>Calling</div>
        <select value={klass} onChange={(e) => selectClass(e.target.value)} data-testid="newchar-class" style={inputStyle}>
          {CLASSES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <div style={labelStyle}>Appearance</div>
        <textarea
          value={appearance}
          onChange={(e) => setAppearance(e.target.value)}
          placeholder="e.g. A tall female goliath with grey skin, dark braided hair, and pale eyes"
          data-testid="newchar-appearance"
          rows={3}
          maxLength={MAX_APPEARANCE_CHARS}
          style={{ ...inputStyle, resize: "vertical", fontFamily: "var(--font-body)" }}
        />
        <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginTop: 3, lineHeight: 1.35 }}>
          Used to generate portraits and scenes that look like your character. You can edit this later.
        </div>

        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "22px 0 6px" }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 11, letterSpacing: 2, color: "var(--brass)" }}>ABILITIES</div>
          <div data-testid="newchar-points" style={{ fontSize: 11.5, color: remaining === 0 ? "var(--ink-faint)" : "var(--ember)" }}>
            {remaining} points to spend
          </div>
        </div>

        {ABILITIES.map(({ key, label }) => (
          <div
            key={key}
            style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 0", borderBottom: "1px solid rgba(109,90,56,.18)" }}
          >
            <div style={{ width: 34, fontFamily: "var(--font-display)", fontSize: 11, letterSpacing: 1, color: "var(--ink-dim)" }}>{label}</div>
            <button
              onClick={() => adjust(key, -1)}
              data-testid={`newchar-${key}-dec`}
              disabled={scores[key] <= MIN_SCORE}
              style={stepStyle(scores[key] <= MIN_SCORE)}
            >
              −
            </button>
            <div data-testid={`newchar-${key}-score`} style={{ width: 22, textAlign: "center", fontFamily: "var(--font-display)", fontSize: 16, color: "var(--ink)" }}>
              {scores[key]}
            </div>
            <button
              onClick={() => adjust(key, 1)}
              data-testid={`newchar-${key}-inc`}
              disabled={scores[key] >= MAX_SCORE || POINT_COST[scores[key] + 1] - POINT_COST[scores[key]] > remaining}
              style={stepStyle(scores[key] >= MAX_SCORE || POINT_COST[scores[key] + 1] - POINT_COST[scores[key]] > remaining)}
            >
              +
            </button>
            <div style={{ width: 34, textAlign: "right", fontSize: 12, color: "var(--arcane)" }}>{fmtMod(modifier(scores[key]))}</div>
          </div>
        ))}

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <div style={derivedTileStyle}>
            <div style={derivedNumStyle} data-testid="newchar-hp">{maxHp}</div>
            <div style={derivedLabelStyle}>VITALITY</div>
          </div>
          <div style={derivedTileStyle}>
            <div style={derivedNumStyle} data-testid="newchar-ac">{armorClass}</div>
            <div style={derivedLabelStyle}>ARMOUR</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <div style={derivedTileStyle}><div style={derivedNumStyle}>+2</div><div style={derivedLabelStyle}>PROF</div></div>
          <div style={derivedTileStyle}><div style={derivedNumStyle}>{fmtMod(initiativeMod)}</div><div style={derivedLabelStyle}>INIT</div></div>
          <div style={derivedTileStyle}><div style={derivedNumStyle}>{speed}</div><div style={derivedLabelStyle}>SPEED</div></div>
          <div style={derivedTileStyle}><div style={derivedNumStyle} data-testid="newchar-passive">{passivePerception}</div><div style={derivedLabelStyle}>PASSIVE</div></div>
        </div>
        <div style={{ fontSize: 10.5, color: "var(--ink-faint)", fontStyle: "italic", marginTop: 8, lineHeight: 1.4 }}>
          Starting at level 1. HP, armour, and these totals are derived from your class and scores;
          gear is established as your tale opens.
        </div>

        {/* Issue #67: class saving throws (derived) and skill picks (chosen). */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "26px 0 4px" }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 11, letterSpacing: 2, color: "var(--brass)" }}>SKILLS</div>
          <div data-testid="newchar-skills-remaining" style={{ fontSize: 11.5, color: skillsComplete ? "var(--ink-faint)" : "var(--ember)" }}>
            choose {skillChoice.choose - skillProficiencies.length} more
          </div>
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-faint)", marginBottom: 8 }}>
          Saving throws: <span style={{ color: "var(--arcane)" }}>{(CLASS_SAVE_PROFICIENCIES[klass] ?? []).join(" · ")}</span> (from your calling)
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {skillChoice.list.map((key) => {
            const selected = skillProficiencies.includes(key);
            const atCap = !selected && skillProficiencies.length >= skillChoice.choose;
            return (
              <button
                key={key}
                data-testid="newchar-skill"
                data-selected={selected}
                onClick={() => toggleSkill(key)}
                disabled={atCap}
                style={{
                  cursor: atCap ? "default" : "pointer",
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: 4,
                  fontSize: 12.5,
                  color: selected ? "#efe6d2" : atCap ? "var(--ink-faint)" : "var(--ink-dim)",
                  background: selected ? "rgba(124,61,32,.24)" : "rgba(28,20,12,.5)",
                  border: `1px solid ${selected ? "rgba(211,112,60,.55)" : "rgba(109,90,56,.32)"}`,
                }}
              >
                {selected ? "◆ " : "◇ "}{skillLabel(key)}
              </button>
            );
          })}
        </div>

        {expertiseCount > 0 && (
          <>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "18px 0 4px" }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 11, letterSpacing: 2, color: "var(--brass)" }}>EXPERTISE</div>
              <div style={{ fontSize: 11.5, color: expertiseComplete ? "var(--ink-faint)" : "var(--ember)" }}>
                choose {expertiseCount - expertise.length} more
              </div>
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-faint)", marginBottom: 8 }}>Double your proficiency in two chosen skills.</div>
            {skillProficiencies.length === 0 ? (
              <div style={{ fontSize: 12, fontStyle: "italic", color: "var(--ink-faint)" }}>Pick skills above first.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {skillProficiencies.map((key) => {
                  const selected = expertise.includes(key);
                  const atCap = !selected && expertise.length >= expertiseCount;
                  return (
                    <button
                      key={key}
                      data-testid="newchar-expertise"
                      data-selected={selected}
                      onClick={() => toggleExpertise(key)}
                      disabled={atCap}
                      style={{
                        cursor: atCap ? "default" : "pointer",
                        textAlign: "left",
                        padding: "8px 10px",
                        borderRadius: 4,
                        fontSize: 12.5,
                        color: selected ? "#efe6d2" : atCap ? "var(--ink-faint)" : "var(--ink-dim)",
                        background: selected ? "rgba(124,61,32,.24)" : "rgba(28,20,12,.5)",
                        border: `1px solid ${selected ? "rgba(211,112,60,.55)" : "rgba(109,90,56,.32)"}`,
                      }}
                    >
                      {selected ? "★ " : "☆ "}{skillLabel(key)}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Issue #67: optional roleplay identity — all can be left blank. */}
        <div style={{ fontFamily: "var(--font-display)", fontSize: 11, letterSpacing: 2, color: "var(--brass)", margin: "26px 0 6px" }}>
          THE CHARACTER <span style={{ fontSize: 10, letterSpacing: 0, color: "var(--ink-faint)" }}>· optional</span>
        </div>
        <div style={labelStyle}>Background</div>
        <input value={background} onChange={(e) => setBackground(e.target.value)} placeholder="e.g. Soldier, Outlander, Sage" data-testid="newchar-background" maxLength={120} style={inputStyle} />
        <div style={labelStyle}>Alignment</div>
        <input value={alignment} onChange={(e) => setAlignment(e.target.value)} placeholder="e.g. Chaotic Good" data-testid="newchar-alignment" maxLength={40} style={inputStyle} />
        {(["traits", "ideals", "bonds", "flaws"] as const).map((field) => (
          <div key={field}>
            <div style={labelStyle}>{field[0].toUpperCase() + field.slice(1)}</div>
            <textarea
              value={personality[field]}
              onChange={(e) => setPersonality((p) => ({ ...p, [field]: e.target.value }))}
              data-testid={`newchar-${field}`}
              rows={2}
              maxLength={400}
              style={{ ...inputStyle, resize: "vertical", fontFamily: "var(--font-body)" }}
            />
          </div>
        ))}

        {/* Issue #57: choose the model for this game up front. Defaults to the
            last-chosen model so it doesn't silently revert to Sonnet. */}
        {models.length > 0 && (
          <>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 11, letterSpacing: 2, color: "var(--brass)", margin: "26px 0 6px" }}>
              THE ENGINE
            </div>
            {providers.length > 0 && (
              <div style={{ display: "flex", gap: 7, marginBottom: 10 }}>
                {providers.map((p) => {
                  const active = provider === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      data-testid="newchar-provider-option"
                      data-selected={active}
                      title={p.label}
                      onClick={() => pickProvider(p.id)}
                      style={{
                        flex: 1,
                        cursor: "pointer",
                        padding: "9px 12px",
                        borderRadius: 4,
                        fontFamily: "var(--font-display)",
                        fontWeight: 600,
                        fontSize: 13,
                        color: active ? "var(--ink)" : "var(--ink-faint)",
                        background: active ? "rgba(124,61,32,.24)" : "rgba(28,20,12,.5)",
                        border: `1px solid ${active ? "rgba(211,112,60,.55)" : "rgba(109,90,56,.32)"}`,
                      }}
                    >
                      {p.label.split("—")[0].trim()}
                    </button>
                  );
                })}
              </div>
            )}
            {providerModels.map((option) => {
              const selected = model === option.id;
              return (
                <button
                  key={option.id}
                  data-testid="newchar-model-option"
                  data-selected={selected}
                  onClick={() => setModel(option.id)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    cursor: "pointer",
                    marginBottom: 7,
                    padding: "12px 14px",
                    borderRadius: 4,
                    background: selected ? "rgba(124,61,32,.24)" : "rgba(28,20,12,.5)",
                    border: `1px solid ${selected ? "rgba(211,112,60,.55)" : "rgba(109,90,56,.32)"}`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>
                      {option.label}
                    </span>
                    <span
                      style={{
                        width: 15,
                        height: 15,
                        borderRadius: "50%",
                        border: `1.5px solid ${selected ? "#d3703c" : "#6d5a38"}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: selected ? "#d3703c" : "transparent" }} />
                    </span>
                  </div>
                </button>
              );
            })}
          </>
        )}

        {/* Issue #64: THE LOOK — surfaced at creation and pre-filled from the
            last game, so images/art/dice are visible and adjustable up front
            instead of discovered (and reverted) after the game begins. */}
        <div style={{ fontFamily: "var(--font-display)", fontSize: 11, letterSpacing: 2, color: "var(--brass)", margin: "26px 0 6px" }}>
          THE LOOK
        </div>
        <ToggleRow
          testId="newchar-images-toggle"
          title="Generate scene art"
          description="Off by default · needs Grok Build configured"
          checked={generateImages}
          onChange={setGenerateImages}
        />
        {generateImages && (
          <ToggleRow
            testId="newchar-auto-illustrate-toggle"
            title="Auto-illustrate each turn"
            description="Draws every DM reply · the image appears a moment after the text"
            checked={autoIllustrateTurns}
            onChange={setAutoIllustrateTurns}
            containerStyle={{ marginTop: 8 }}
          />
        )}
        <ArtStylePicker artStyle={artStyle} onChange={setArtStyle} />
        <ToggleRow
          testId="newchar-dice-toggle"
          title="Auto-roll dice"
          description="On: the DM rolls for you · Off: you supply your own roll values"
          checked={autoRollDice}
          onChange={setAutoRollDice}
          containerStyle={{ marginTop: 12 }}
        />

        {/* Issue #48: describe the world at creation, not only later in Settings. */}
        <div style={{ fontFamily: "var(--font-display)", fontSize: 11, letterSpacing: 2, color: "var(--brass)", margin: "26px 0 2px" }}>
          THE WORLD
        </div>
        <div style={{ fontSize: 10.5, color: "var(--ink-faint)", fontStyle: "italic", marginBottom: 4 }}>
          Optional — you can change any of this later in Settings.
        </div>

        <div style={labelStyle}>Setting <span style={{ color: "var(--ink-faint)" }}>— empty keeps standard fantasy</span></div>
        <input
          value={worldSetting}
          onChange={(e) => setWorldSetting(e.target.value)}
          placeholder="e.g. Outer space, future, sci-fi"
          data-testid="newchar-setting"
          style={inputStyle}
        />

        <div style={labelStyle}>Tone &amp; whimsy</div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={toneWhimsy}
          onChange={(e) => setToneWhimsy(Number(e.target.value))}
          data-testid="newchar-tone"
          style={{ width: "100%", accentColor: "var(--ember)" }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--ink-faint)", marginTop: 2 }}>
          <span>grounded</span>
          <span>deeply strange</span>
        </div>

        <div style={labelStyle}>Content intensity</div>
        <div style={{ display: "flex", gap: 7 }}>
          {INTENSITY_OPTIONS.map((option) => {
            const selected = contentIntensity === option.id;
            return (
              <button
                key={option.id}
                data-testid="newchar-intensity"
                data-selected={selected}
                onClick={() => setContentIntensity(option.id)}
                style={{
                  flex: 1,
                  cursor: "pointer",
                  textAlign: "left",
                  padding: "11px 13px",
                  borderRadius: 4,
                  background: selected ? "rgba(124,61,32,.24)" : "rgba(28,20,12,.5)",
                  border: `1px solid ${selected ? "rgba(211,112,60,.55)" : "rgba(109,90,56,.32)"}`,
                }}
              >
                <div style={{ fontFamily: "var(--font-display)", fontSize: 13, color: selected ? "#efe6d2" : "var(--ink-dim)" }}>
                  {option.label}
                </div>
                <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginTop: 3, lineHeight: 1.35 }}>{option.note}</div>
              </button>
            );
          })}
        </div>

        <div style={labelStyle}>Reply length</div>
        <div style={{ display: "flex", gap: 7 }}>
          {LENGTH_OPTIONS.map((option) => {
            const selected = responseLength === option.id;
            return (
              <button
                key={option.id}
                data-testid="newchar-length"
                data-selected={selected}
                onClick={() => setResponseLength(option.id)}
                style={{
                  flex: 1,
                  cursor: "pointer",
                  textAlign: "left",
                  padding: "11px 13px",
                  borderRadius: 4,
                  background: selected ? "rgba(124,61,32,.24)" : "rgba(28,20,12,.5)",
                  border: `1px solid ${selected ? "rgba(211,112,60,.55)" : "rgba(109,90,56,.32)"}`,
                }}
              >
                <div style={{ fontFamily: "var(--font-display)", fontSize: 13, color: selected ? "#efe6d2" : "var(--ink-dim)" }}>
                  {option.label}
                </div>
                <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginTop: 3, lineHeight: 1.35 }}>{option.note}</div>
              </button>
            );
          })}
        </div>

        <button
          onClick={submit}
          disabled={!canCreate}
          data-testid="newchar-create"
          style={{
            marginTop: 22,
            width: "100%",
            cursor: canCreate ? "pointer" : "default",
            opacity: canCreate ? 1 : 0.55,
            padding: 13,
            borderRadius: 3,
            background: "linear-gradient(180deg,#d8743e,#a8511f)",
            border: "none",
            color: "#faf0e2",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 14,
            letterSpacing: 2,
          }}
        >
          {creating ? "BEGINNING…" : "BEGIN THE TALE"}
        </button>
        {error && (
          <div data-testid="newchar-error" style={{ marginTop: 10, fontSize: 12, color: "var(--ember)", textAlign: "center" }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function stepStyle(disabled: boolean) {
  return {
    width: 30,
    height: 30,
    borderRadius: "50%",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.4 : 1,
    background: "rgba(28,20,12,.6)",
    border: "1px solid var(--brass-dim)",
    color: "var(--ink)",
    fontSize: 18,
    lineHeight: 1,
  } as const;
}

const derivedTileStyle = {
  flex: 1,
  textAlign: "center" as const,
  padding: "12px 0",
  borderRadius: 4,
  background: "rgba(28,20,12,.5)",
  border: "1px solid rgba(109,90,56,.32)",
};
const derivedNumStyle = { fontFamily: "var(--font-display)", fontSize: 22, color: "var(--ember)" } as const;
const derivedLabelStyle = { fontFamily: "var(--font-display)", fontSize: 9, letterSpacing: 1.5, color: "var(--ink-faint)", marginTop: 2 } as const;
