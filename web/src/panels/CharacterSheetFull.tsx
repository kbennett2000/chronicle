import { useEffect, useState } from "react";
import type { Connection } from "../lib/connection";
import { setCharacterAppearance, type CharacterSheet } from "../lib/campaign";
import { EntityPortrait } from "../components/EntityPortrait";
import {
  SKILLS,
  ABILITY_LABELS,
  proficiencyBonus,
  initiative,
  passivePerception,
  savingThrowMod,
  skillMod,
  abilityMod,
  formatMod,
  isSkillProficient,
  hasExpertise,
  type AbilityKey,
} from "../lib/character-derive";

// ADR-0022: the full, recognizable official D&D 5e sheet, rendered on desktop in
// the Play side panel's Self tab (mobile keeps the compact SelfPanel). Driven
// entirely by the existing CharacterSheet + character-derive.ts — no new data.
// Official-sheet regions the engine doesn't track yet (attacks & spellcasting,
// death saves, hit dice, temporary HP, inspiration) render as empty labelled
// boxes, faithful to a blank printed sheet. Every region is presence-guarded so
// an old/partial sheet renders cleanly and never throws.

// Mirrors MAX_APPEARANCE_CHARS in src/character-gen.ts (server is authoritative).
const MAX_APPEARANCE_CHARS = 600;

const COIN_ORDER: Array<{ key: "pp" | "gp" | "ep" | "sp" | "cp"; label: string }> = [
  { key: "pp", label: "pp" },
  { key: "gp", label: "gp" },
  { key: "ep", label: "ep" },
  { key: "sp", label: "sp" },
  { key: "cp", label: "cp" },
];
const ZERO_CURRENCY = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };

interface CharacterSheetFullProps {
  connection: Connection;
  campaignId: string;
  sheet: CharacterSheet;
  /** Called after the appearance is saved so the parent refetches state. */
  onUpdated?: () => void;
}

// A proficiency dot — hollow (none), filled (proficient), ringed (expertise).
function ProfDot({ level }: { level: "none" | "proficient" | "expertise" }) {
  const filled = level !== "none";
  return (
    <span
      style={{
        width: 11,
        height: 11,
        borderRadius: "50%",
        flexShrink: 0,
        border: "1.5px solid var(--arcane)",
        background: filled ? "var(--arcane)" : "transparent",
        boxShadow: level === "expertise" ? "0 0 0 2px rgba(20,12,6,1), 0 0 0 3px var(--arcane)" : "none",
      }}
    />
  );
}

// A labelled, bordered box — the sheet's basic unit. Label sits at the bottom in
// small caps, like the official form.
function SheetBox({
  label,
  children,
  testId,
  minHeight,
}: {
  label: string;
  children: React.ReactNode;
  testId?: string;
  minHeight?: number;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        border: "1px solid rgba(109,90,56,.4)",
        borderRadius: 6,
        background: "rgba(20,12,6,.32)",
        padding: "10px 12px 8px",
        display: "flex",
        flexDirection: "column",
        minHeight,
      }}
    >
      <div style={{ flex: 1 }}>{children}</div>
      <div
        style={{
          textAlign: "center",
          marginTop: 8,
          fontFamily: "var(--font-display)",
          fontSize: 8.5,
          letterSpacing: 1.4,
          color: "var(--brass-dim)",
        }}
      >
        {label}
      </div>
    </div>
  );
}

// A small stat box with the value on top and a caption below (AC / INIT / SPEED).
function MiniStat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div
      data-testid={testId}
      style={{
        flex: 1,
        textAlign: "center",
        border: "1px solid rgba(109,90,56,.4)",
        borderRadius: 6,
        background: "rgba(20,12,6,.32)",
        padding: "9px 4px 6px",
      }}
    >
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 20, color: "var(--ink)", lineHeight: 1 }}>{value}</div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 8.5, letterSpacing: 1.2, color: "var(--brass-dim)", marginTop: 5 }}>{label}</div>
    </div>
  );
}

// A row of empty bubbles for boxes the engine doesn't populate yet (death saves).
function Bubbles({ count }: { count: number }) {
  return (
    <div style={{ display: "flex", gap: 5 }}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} style={{ width: 11, height: 11, borderRadius: "50%", border: "1.5px solid rgba(140,124,98,.6)" }} />
      ))}
    </div>
  );
}

const sectionLabel = (text: string): React.CSSProperties => ({
  fontFamily: "var(--font-display)",
  fontSize: 9.5,
  letterSpacing: 1.5,
  color: "var(--brass-dim)",
  marginBottom: 6,
});

const columnStyle: React.CSSProperties = {
  flex: "1 1 240px",
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

export function CharacterSheetFull({ connection, campaignId, sheet, onUpdated }: CharacterSheetFullProps) {
  // Appearance is editable in place, mirroring SelfPanel (issue #71).
  const [editingLook, setEditingLook] = useState(false);
  const [lookDraft, setLookDraft] = useState(sheet.appearance ?? "");
  const [savingLook, setSavingLook] = useState(false);
  const [lookError, setLookError] = useState<string | null>(null);
  useEffect(() => {
    if (!editingLook) setLookDraft(sheet.appearance ?? "");
  }, [sheet.appearance, editingLook]);

  async function saveLook() {
    setSavingLook(true);
    setLookError(null);
    try {
      await setCharacterAppearance(connection, campaignId, lookDraft);
      setEditingLook(false);
      onUpdated?.();
    } catch (err) {
      setLookError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingLook(false);
    }
  }

  const abilityScores = sheet.abilityScores;
  const pb = proficiencyBonus(sheet.level);
  const currency = sheet.currency ?? ZERO_CURRENCY;
  const inventory = sheet.inventory ?? [];
  const conditions = sheet.conditions ?? [];
  const features = sheet.featuresAndTraits ?? [];
  const languages = sheet.languages ?? [];
  const otherProficiencies = sheet.otherProficiencies ?? [];
  const personality = sheet.personality ?? {};
  const hasPersonality = Boolean(personality.traits || personality.ideals || personality.bonds || personality.flaws);
  const spellSlotEntries = Object.entries(sheet.spellSlots ?? {}).filter(
    ([, slot]) => typeof slot?.total === "number" && slot.total > 0
  );

  return (
    <div data-testid="sheet-full">
      {/* Header band: portrait + identity grid, like the official sheet's top. */}
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 14 }}>
        <EntityPortrait
          connection={connection}
          campaignId={campaignId}
          filename={sheet.portraitImage}
          width={72}
          height={84}
          imageTestId="sheet-portrait-image"
          emptyTestId="sheet-portrait-none"
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div data-testid="sheet-name" style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 22, letterSpacing: 0.5, color: "var(--ink)" }}>
            {sheet.name}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "4px 12px",
              marginTop: 8,
              fontSize: 11.5,
            }}
          >
            <IdentityCell label="CLASS & LEVEL" value={`${sheet.class} ${sheet.level}`} />
            <IdentityCell label="BACKGROUND" value={sheet.background} />
            <IdentityCell label="RACE" value={sheet.race} />
            <IdentityCell label="ALIGNMENT" value={sheet.alignment} />
            <IdentityCell label="EXPERIENCE" value={typeof sheet.xp === "number" ? sheet.xp.toLocaleString() : undefined} />
          </div>
        </div>
      </div>

      {conditions.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <span style={{ ...sectionLabel(""), marginBottom: 0 }}>CONDITIONS</span>
          {conditions.map((c) => (
            <span
              key={c}
              data-testid="sheet-condition"
              style={{ fontSize: 12, color: "var(--ember)", background: "rgba(124,61,32,.28)", border: "1px solid rgba(211,112,60,.4)", padding: "2px 9px", borderRadius: 20 }}
            >
              {c}
            </span>
          ))}
        </div>
      )}

      {/* Three responsive columns matching the official sheet's arrangement. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
        {/* LEFT: abilities, inspiration, proficiency bonus, saves, skills, passive, proficiencies. */}
        <div style={columnStyle}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {ABILITY_LABELS.map((a) => {
              const score = abilityScores?.[a.key];
              return (
                <div
                  key={a.key}
                  data-testid={`sheet-ability-${a.key}`}
                  style={{
                    flex: "1 1 62px",
                    textAlign: "center",
                    border: "1px solid rgba(109,90,56,.4)",
                    borderRadius: 6,
                    background: "rgba(20,12,6,.32)",
                    padding: "7px 4px 5px",
                  }}
                >
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 8.5, letterSpacing: 1, color: "var(--brass-dim)" }}>{a.label}</div>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 20, color: "var(--arcane)", lineHeight: 1.1 }}>
                    {typeof score === "number" ? formatMod(abilityMod(score)) : "—"}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ink)" }}>{typeof score === "number" ? score : "—"}</div>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <SheetBox label="INSPIRATION" testId="sheet-inspiration">
              <div style={{ textAlign: "center", fontSize: 15, color: "var(--ink-faint)", minHeight: 18 }} />
            </SheetBox>
            <SheetBox label="PROFICIENCY BONUS" testId="sheet-prof-bonus">
              <div style={{ textAlign: "center", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17, color: "var(--ink)" }}>{formatMod(pb)}</div>
            </SheetBox>
          </div>

          <SheetBox label="SAVING THROWS">
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {ABILITY_LABELS.map((a) => {
                const proficient = (sheet.savingThrowProficiencies ?? []).includes(a.key as AbilityKey);
                return (
                  <div key={a.key} data-testid="sheet-save-row" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <ProfDot level={proficient ? "proficient" : "none"} />
                    <span style={{ flex: 1, fontSize: 12, color: "var(--ink-dim)" }}>{a.label}</span>
                    <span style={{ fontFamily: "var(--font-display)", fontSize: 12.5, color: "var(--ink)" }}>
                      {abilityScores ? formatMod(savingThrowMod(sheet, a.key as AbilityKey)) : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          </SheetBox>

          <SheetBox label="SKILLS">
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {SKILLS.map((skill) => {
                const level = hasExpertise(sheet, skill.key) ? "expertise" : isSkillProficient(sheet, skill.key) ? "proficient" : "none";
                return (
                  <div key={skill.key} data-testid="sheet-skill-row" style={{ display: "flex", alignItems: "center", gap: 8, padding: "1px 0" }}>
                    <ProfDot level={level} />
                    <span style={{ flex: 1, fontSize: 12, color: level === "none" ? "var(--ink-dim)" : "var(--ink)" }}>{skill.label}</span>
                    <span style={{ fontSize: 8.5, color: "var(--ink-faint)", letterSpacing: 0.5, width: 24, textAlign: "right" }}>{skill.ability.slice(0, 3).toUpperCase()}</span>
                    <span style={{ fontFamily: "var(--font-display)", fontSize: 12.5, color: "var(--ink)", width: 28, textAlign: "right" }}>
                      {abilityScores ? formatMod(skillMod(sheet, skill)) : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          </SheetBox>

          <SheetBox label="PASSIVE WISDOM (PERCEPTION)" testId="sheet-passive">
            <div style={{ textAlign: "center", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17, color: "var(--ink)" }}>
              {abilityScores ? passivePerception(sheet) : "—"}
            </div>
          </SheetBox>

          <SheetBox label="OTHER PROFICIENCIES & LANGUAGES" minHeight={70}>
            {otherProficiencies.length === 0 && languages.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--ink-faint)", fontStyle: "italic" }}>None recorded yet.</div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {otherProficiencies.map((p) => (
                  <span key={`prof-${p}`} data-testid="sheet-proficiency" style={{ fontSize: 11.5, color: "var(--ink)", background: "rgba(28,20,12,.6)", border: "1px solid rgba(109,90,56,.35)", padding: "2px 9px", borderRadius: 20 }}>{p}</span>
                ))}
                {languages.map((l) => (
                  <span key={`lang-${l}`} data-testid="sheet-language" style={{ fontSize: 11.5, color: "var(--arcane)", background: "rgba(60,70,110,.18)", border: "1px solid rgba(120,140,200,.3)", padding: "2px 9px", borderRadius: 20 }}>{l}</span>
                ))}
              </div>
            )}
          </SheetBox>
        </div>

        {/* CENTER: combat block, attacks & spellcasting, equipment. */}
        <div style={columnStyle}>
          <div style={{ display: "flex", gap: 8 }}>
            <MiniStat label="ARMOR CLASS" value={typeof sheet.armorClass === "number" ? String(sheet.armorClass) : "—"} testId="sheet-ac" />
            <MiniStat label="INITIATIVE" value={abilityScores ? formatMod(initiative(sheet)) : "—"} testId="sheet-initiative" />
            <MiniStat label="SPEED" value={typeof sheet.speed === "number" ? String(sheet.speed) : "—"} testId="sheet-speed" />
          </div>

          <SheetBox label="HIT POINTS" testId="sheet-hp">
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 22, color: "var(--ember)", lineHeight: 1.1 }}>
                {sheet.hp ? `${sheet.hp.current} / ${sheet.hp.max}` : "—"}
              </div>
              <div style={{ fontSize: 9, color: "var(--ink-faint)", letterSpacing: 1, marginTop: 2 }}>CURRENT / MAX</div>
            </div>
          </SheetBox>

          <div style={{ display: "flex", gap: 8 }}>
            <SheetBox label="TEMP HP" testId="sheet-temp-hp">
              <div style={{ textAlign: "center", fontSize: 15, color: "var(--ink-faint)", minHeight: 20 }} />
            </SheetBox>
            <SheetBox label="HIT DICE" testId="sheet-hit-dice">
              <div style={{ textAlign: "center", fontSize: 12, color: "var(--ink-faint)", minHeight: 20 }}>
                {/* Total = level; the die size isn't stored client-side. */}
                {typeof sheet.level === "number" ? `${sheet.level}d—` : ""}
              </div>
            </SheetBox>
            <SheetBox label="DEATH SAVES" testId="sheet-death-saves">
              <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "center", minHeight: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 8.5, color: "var(--ink-faint)", width: 26 }}>SUCC</span>
                  <Bubbles count={3} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 8.5, color: "var(--ink-faint)", width: 26 }}>FAIL</span>
                  <Bubbles count={3} />
                </div>
              </div>
            </SheetBox>
          </div>

          <SheetBox label="ATTACKS & SPELLCASTING" testId="sheet-attacks" minHeight={128}>
            <div style={{ display: "flex", fontSize: 8.5, letterSpacing: 0.5, color: "var(--ink-faint)", paddingBottom: 4, borderBottom: "1px solid rgba(109,90,56,.3)" }}>
              <span style={{ flex: 1 }}>NAME</span>
              <span style={{ width: 42, textAlign: "right" }}>ATK</span>
              <span style={{ width: 66, textAlign: "right" }}>DAMAGE</span>
            </div>
            {/* The engine doesn't track structured attacks yet (ADR-0022) — ruled
                empty rows, like a blank sheet. */}
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} style={{ height: 22, borderBottom: "1px solid rgba(109,90,56,.16)" }} />
            ))}
            {spellSlotEntries.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {spellSlotEntries.map(([lvl, slot]) => {
                  const used = Math.min(Math.max(slot.used ?? 0, 0), slot.total);
                  return (
                    <div key={lvl} data-testid="sheet-spell-slot-row" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                      <span style={{ fontFamily: "var(--font-display)", fontSize: 9, letterSpacing: 1, color: "var(--brass-dim)" }}>SLOTS · {lvl.toUpperCase()}</span>
                      <div style={{ display: "flex", gap: 5 }}>
                        {Array.from({ length: slot.total }, (_, i) => (
                          <span key={i} style={{ width: 11, height: 11, borderRadius: "50%", border: "1.5px solid var(--arcane)", background: i < slot.total - used ? "var(--arcane)" : "transparent" }} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SheetBox>

          <SheetBox label="EQUIPMENT" minHeight={100}>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              {COIN_ORDER.map((coin) => (
                <div key={coin.key} data-testid={`sheet-coin-${coin.key}`} style={{ textAlign: "center" }}>
                  <div style={{ width: 20, height: 20, margin: "0 auto", borderRadius: "50%", background: `var(--coin-${coin.key})`, boxShadow: "inset 0 -2px 3px rgba(0,0,0,.4), inset 0 2px 2px rgba(255,255,255,.25)" }} />
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 11, color: "var(--ink)", marginTop: 3 }}>{currency[coin.key]}</div>
                  <div style={{ fontSize: 8, color: "var(--ink-faint)", letterSpacing: 1 }}>{coin.label}</div>
                </div>
              ))}
            </div>
            {inventory.length === 0 ? (
              <p style={{ fontStyle: "italic", fontSize: 12, color: "var(--ink-faint)" }}>Carrying nothing yet.</p>
            ) : (
              inventory.map((entry, i) => (
                <div key={`${entry.item}-${i}`} data-testid="sheet-inventory-item" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid rgba(109,90,56,.16)" }}>
                  <span style={{ fontSize: 13, color: "var(--ink)" }}>{entry.item}</span>
                  {entry.quantity > 1 && <span style={{ fontSize: 11, color: "var(--ink-faint)", fontStyle: "italic" }}>×{entry.quantity}</span>}
                </div>
              ))
            )}
          </SheetBox>
        </div>

        {/* RIGHT: personality, features & traits, appearance. */}
        <div style={columnStyle}>
          <SheetBox label="PERSONALITY TRAITS" minHeight={54}>
            <PersonalityText value={personality.traits} />
          </SheetBox>
          <SheetBox label="IDEALS" minHeight={44}>
            <PersonalityText value={personality.ideals} />
          </SheetBox>
          <SheetBox label="BONDS" minHeight={44}>
            <PersonalityText value={personality.bonds} />
          </SheetBox>
          <SheetBox label="FLAWS" minHeight={44}>
            <PersonalityText value={personality.flaws} />
          </SheetBox>

          <SheetBox label="FEATURES & TRAITS" minHeight={120}>
            {features.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--ink-faint)", fontStyle: "italic" }}>None recorded yet.</div>
            ) : (
              features.map((f, i) => (
                <div key={`${f.name}-${i}`} data-testid="sheet-feature" style={{ padding: "5px 0", borderBottom: "1px solid rgba(109,90,56,.14)" }}>
                  <div style={{ fontSize: 13, color: "var(--ink)" }}>
                    {f.name}
                    {f.source && <span style={{ fontSize: 10, color: "var(--ink-faint)", marginLeft: 6 }}>· {f.source}</span>}
                  </div>
                  {f.description && <div style={{ fontSize: 11.5, color: "var(--ink-dim)", lineHeight: 1.4, marginTop: 2 }}>{f.description}</div>}
                </div>
              ))
            )}
          </SheetBox>

          {/* Appearance isn't on the paper sheet, but it's authored data worth
              surfacing (and editing) here since it drives portraits. */}
          <SheetBox label="APPEARANCE" minHeight={54}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 2 }}>
              {!editingLook && (
                <button
                  data-testid="sheet-appearance-edit"
                  onClick={() => { setLookDraft(sheet.appearance ?? ""); setEditingLook(true); }}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10.5, color: "var(--ember)", padding: 0 }}
                >
                  {sheet.appearance ? "✎ Edit" : "✎ Add"}
                </button>
              )}
            </div>
            {editingLook ? (
              <div>
                <textarea
                  value={lookDraft}
                  onChange={(e) => setLookDraft(e.target.value)}
                  data-testid="sheet-appearance-input"
                  rows={3}
                  maxLength={MAX_APPEARANCE_CHARS}
                  style={{ width: "100%", boxSizing: "border-box", background: "rgba(12,8,5,.5)", border: "1px solid rgba(109,90,56,.4)", borderRadius: 4, padding: "7px 10px", color: "var(--ink)", fontFamily: "var(--font-body)", fontSize: 12.5, resize: "vertical", outline: "none" }}
                />
                {lookError && <div style={{ fontSize: 11, color: "var(--ember)", marginTop: 4 }}>{lookError}</div>}
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <button data-testid="sheet-appearance-save" onClick={saveLook} disabled={savingLook} style={{ cursor: savingLook ? "default" : "pointer", padding: "5px 13px", borderRadius: 3, border: "none", background: "linear-gradient(180deg,#d8743e,#a8511f)", color: "#1c120a", fontFamily: "var(--font-display)", fontSize: 11.5, opacity: savingLook ? 0.6 : 1 }}>
                    {savingLook ? "Saving…" : "Save"}
                  </button>
                  <button onClick={() => { setEditingLook(false); setLookError(null); }} disabled={savingLook} style={{ cursor: "pointer", padding: "5px 13px", borderRadius: 3, border: "1px solid rgba(109,90,56,.4)", background: "transparent", color: "var(--ink-dim)", fontFamily: "var(--font-display)", fontSize: 11.5 }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <p style={{ fontSize: 12.5, lineHeight: 1.45, color: sheet.appearance ? "var(--ink)" : "var(--ink-faint)", fontStyle: sheet.appearance ? "normal" : "italic", margin: 0 }}>
                {sheet.appearance || "No description yet — add one so portraits match your character."}
              </p>
            )}
          </SheetBox>
        </div>
      </div>
    </div>
  );
}

function IdentityCell({ label, value }: { label: string; value?: string }) {
  return (
    <div style={{ borderBottom: "1px solid rgba(109,90,56,.3)", paddingBottom: 2 }}>
      <div style={{ color: "var(--ink)", fontSize: 12.5, minHeight: 15 }}>{value || "—"}</div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 8, letterSpacing: 1, color: "var(--brass-dim)" }}>{label}</div>
    </div>
  );
}

function PersonalityText({ value }: { value?: string }) {
  return (
    <div style={{ fontSize: 12, lineHeight: 1.4, color: value ? "var(--ink-dim)" : "var(--ink-faint)", fontStyle: value ? "normal" : "italic" }}>
      {value || "—"}
    </div>
  );
}
