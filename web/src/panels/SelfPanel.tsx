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
  formatMod,
  isSkillProficient,
  hasExpertise,
  type AbilityKey,
} from "../lib/character-derive";

// Mirrors MAX_APPEARANCE_CHARS in src/character-gen.ts (server is authoritative).
const MAX_APPEARANCE_CHARS = 600;

interface SelfPanelProps {
  connection: Connection;
  campaignId: string;
  sheet: CharacterSheet;
  /** Issue #71: called after the appearance is saved, so the parent refetches
   * state and the new value flows back into the panels and image prompts. */
  onUpdated?: () => void;
}

const ABILITIES: Array<{ key: keyof NonNullable<CharacterSheet["abilityScores"]>; label: string }> = [
  { key: "strength", label: "STR" },
  { key: "dexterity", label: "DEX" },
  { key: "constitution", label: "CON" },
  { key: "intelligence", label: "INT" },
  { key: "wisdom", label: "WIS" },
  { key: "charisma", label: "CHA" },
];

const COIN_ORDER: Array<{ key: "pp" | "gp" | "ep" | "sp" | "cp"; label: string }> = [
  { key: "pp", label: "pp" },
  { key: "gp", label: "gp" },
  { key: "ep", label: "ep" },
  { key: "sp", label: "sp" },
  { key: "cp", label: "cp" },
];

// Absent on a character sheet predating issue #4's currency migration —
// render as all-zero rather than erroring, per the backend contract's
// "design the missing-field case as normal, not an error."
const ZERO_CURRENCY = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };

function modifier(score: number): string {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ flex: 1, textAlign: "center", padding: "11px 4px", borderRadius: 4, background: "rgba(20,12,6,.35)", border: "1px solid rgba(109,90,56,.3)" }}>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, color: color ?? "var(--ink)" }}>{value}</div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 9, letterSpacing: 1.5, color: "var(--ink-faint)", marginTop: 3 }}>{label}</div>
    </div>
  );
}

// Issue #67: a proficiency dot — hollow (none), filled (proficient), or ringed
// (expertise, doubled proficiency).
function ProfDot({ level }: { level: "none" | "proficient" | "expertise" }) {
  const filled = level !== "none";
  return (
    <span
      style={{
        width: 11,
        height: 11,
        borderRadius: "50%",
        flexShrink: 0,
        border: level === "expertise" ? "2px solid var(--arcane)" : "1.5px solid var(--arcane)",
        background: filled ? "var(--arcane)" : "transparent",
        boxShadow: level === "expertise" ? "0 0 0 2px rgba(20,12,6,1), 0 0 0 3px var(--arcane)" : "none",
      }}
    />
  );
}

// Issue #67: collapsible sheet section for mobile — the full official sheet is
// a lot for a phone, so only combat + abilities open by default.
function Collapsible({ title, defaultOpen, testId, children }: { title: string; defaultOpen?: boolean; testId?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div style={{ marginTop: 18 }}>
      <button
        data-testid={testId}
        onClick={() => setOpen((o) => !o)}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", background: "none", border: "none", padding: 0, cursor: "pointer" }}
      >
        <span style={{ fontFamily: "var(--font-display)", fontSize: 10, letterSpacing: 1.5, color: "var(--brass-dim)" }}>{title}</span>
        <span style={{ fontSize: 11, color: "var(--ink-faint)", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
      </button>
      {open && <div style={{ marginTop: 8 }}>{children}</div>}
    </div>
  );
}

export function SelfPanel({ connection, campaignId, sheet, onUpdated }: SelfPanelProps) {
  // Issue #71: appearance is editable in place so a character created before the
  // field existed (or with a portrait that came out wrong) can be corrected.
  const [editingLook, setEditingLook] = useState(false);
  const [lookDraft, setLookDraft] = useState(sheet.appearance ?? "");
  const [savingLook, setSavingLook] = useState(false);
  const [lookError, setLookError] = useState<string | null>(null);
  // Re-sync the draft when the sheet changes underneath us (a refetch after
  // save, or a different campaign), but only while not mid-edit.
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

  const currency = sheet.currency ?? ZERO_CURRENCY;
  const conditions = sheet.conditions ?? [];
  const inventory = sheet.inventory ?? [];
  const spellSlotEntries = Object.entries(sheet.spellSlots ?? {}).filter(([, slot]) => typeof slot?.total === "number" && slot.total > 0);
  const abilityScores = sheet.abilityScores;

  // Issue #67: derived combat/skill numbers (never stored — see ADR-0015).
  const pb = proficiencyBonus(sheet.level);
  const features = sheet.featuresAndTraits ?? [];
  const languages = sheet.languages ?? [];
  const otherProficiencies = sheet.otherProficiencies ?? [];
  const personality = sheet.personality ?? {};
  const hasPersonality = Boolean(personality.traits || personality.ideals || personality.bonds || personality.flaws);
  const identityLine = [sheet.background, sheet.alignment].filter(Boolean).join(" · ");

  return (
    <div>
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <EntityPortrait
          connection={connection}
          campaignId={campaignId}
          filename={sheet.portraitImage}
          width={76}
          height={88}
          imageTestId="self-portrait-image"
          emptyTestId="self-portrait-none"
        />
        <div style={{ minWidth: 0 }}>
          <div data-testid="self-name" style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 21, letterSpacing: 0.6, color: "var(--ink)" }}>
            {sheet.name}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-dim)" }}>
            {sheet.race} {sheet.class} · Level {sheet.level}
          </div>
          {identityLine && (
            <div data-testid="self-identity" style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 2 }}>
              {identityLine}
            </div>
          )}
          {typeof sheet.xp === "number" && (
            <div data-testid="self-xp" style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 8 }}>
              {sheet.xp.toLocaleString()} xp
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        {sheet.hp && (
          <StatBox label="VITALITY" value={`${sheet.hp.current}/${sheet.hp.max}`} color="var(--ember)" />
        )}
        {typeof sheet.armorClass === "number" && <StatBox label="ARMOUR" value={String(sheet.armorClass)} />}
      </div>

      {/* Issue #67: derived combat line — proficiency bonus, initiative, speed,
          passive perception. INIT/PASSIVE need scores; SPEED needs the field. */}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <StatBox label="PROF" value={formatMod(pb)} />
        {abilityScores && <StatBox label="INIT" value={formatMod(initiative(sheet))} />}
        {typeof sheet.speed === "number" && <StatBox label="SPEED" value={String(sheet.speed)} />}
        {abilityScores && <StatBox label="PASSIVE" value={String(passivePerception(sheet))} />}
      </div>

      {conditions.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-display)", fontSize: 10, letterSpacing: 1.5, color: "var(--ink-faint)" }}>CONDITIONS</span>
          {conditions.map((c) => (
            <span
              key={c}
              data-testid="self-condition"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 12,
                color: "var(--ember)",
                background: "rgba(124,61,32,.28)",
                border: "1px solid rgba(211,112,60,.4)",
                padding: "3px 10px",
                borderRadius: 20,
              }}
            >
              {c}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 18 }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 10, letterSpacing: 1.5, color: "var(--brass-dim)" }}>APPEARANCE</div>
        {!editingLook && (
          <button
            data-testid="self-appearance-edit"
            onClick={() => { setLookDraft(sheet.appearance ?? ""); setEditingLook(true); }}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "var(--ember)", padding: 0 }}
          >
            {sheet.appearance ? "✎ Edit" : "✎ Add"}
          </button>
        )}
      </div>
      {editingLook ? (
        <div style={{ marginTop: 6 }}>
          <textarea
            value={lookDraft}
            onChange={(e) => setLookDraft(e.target.value)}
            data-testid="self-appearance-input"
            rows={3}
            maxLength={MAX_APPEARANCE_CHARS}
            placeholder="e.g. A tall female goliath with grey skin, dark braided hair, and pale eyes"
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: "rgba(12,8,5,.5)",
              border: "1px solid rgba(109,90,56,.4)",
              borderRadius: 4,
              padding: "9px 12px",
              color: "var(--ink)",
              fontFamily: "var(--font-body)",
              fontSize: 13.5,
              resize: "vertical",
              outline: "none",
            }}
          />
          <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginTop: 3, lineHeight: 1.35 }}>
            Used to generate portraits and scenes that look like you.
          </div>
          {lookError && <div data-testid="self-appearance-error" style={{ fontSize: 11.5, color: "var(--ember)", marginTop: 4 }}>{lookError}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              data-testid="self-appearance-save"
              onClick={saveLook}
              disabled={savingLook}
              style={{ cursor: savingLook ? "default" : "pointer", padding: "7px 16px", borderRadius: 3, border: "none", background: "linear-gradient(180deg,#d8743e,#a8511f)", color: "#1c120a", fontFamily: "var(--font-display)", fontSize: 12, opacity: savingLook ? 0.6 : 1 }}
            >
              {savingLook ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => { setEditingLook(false); setLookError(null); }}
              disabled={savingLook}
              style={{ cursor: "pointer", padding: "7px 16px", borderRadius: 3, border: "1px solid rgba(109,90,56,.4)", background: "transparent", color: "var(--ink-dim)", fontFamily: "var(--font-display)", fontSize: 12 }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p data-testid="self-appearance" style={{ marginTop: 6, fontSize: 13.5, lineHeight: 1.5, color: sheet.appearance ? "var(--ink)" : "var(--ink-faint)", fontStyle: sheet.appearance ? "normal" : "italic" }}>
          {sheet.appearance || "No description yet — add one so portraits match your character."}
        </p>
      )}

      {abilityScores && (
        <>
          <div style={{ marginTop: 18, fontFamily: "var(--font-display)", fontSize: 10, letterSpacing: 1.5, color: "var(--brass-dim)" }}>ABILITIES</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 7, marginTop: 8 }}>
            {ABILITIES.filter((a) => typeof abilityScores[a.key] === "number").map((a) => {
              const score = abilityScores[a.key] as number;
              return (
                <div key={a.key} style={{ textAlign: "center", padding: "9px 4px", borderRadius: 4, background: "rgba(20,12,6,.3)", border: "1px solid rgba(109,90,56,.25)" }}>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 9, letterSpacing: 1, color: "var(--ink-faint)" }}>{a.label}</div>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, color: "var(--ink)", lineHeight: 1.1 }}>{score}</div>
                  <div style={{ fontSize: 11, color: "var(--arcane)" }}>{modifier(score)}</div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Issue #67: saving throws (6) — derived from scores + class proficiency. */}
      {abilityScores && (
        <Collapsible title="SAVING THROWS" testId="self-saves-toggle">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 16px" }}>
            {ABILITY_LABELS.filter((a) => typeof abilityScores[a.key] === "number").map((a) => {
              const proficient = (sheet.savingThrowProficiencies ?? []).includes(a.key as AbilityKey);
              return (
                <div key={a.key} data-testid="self-save-row" style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
                  <ProfDot level={proficient ? "proficient" : "none"} />
                  <span style={{ flex: 1, fontSize: 12.5, color: "var(--ink-dim)" }}>{a.label}</span>
                  <span style={{ fontFamily: "var(--font-display)", fontSize: 13, color: "var(--ink)" }}>{formatMod(savingThrowMod(sheet, a.key as AbilityKey))}</span>
                </div>
              );
            })}
          </div>
        </Collapsible>
      )}

      {/* Issue #67: the 18 skills — modifier folds in proficiency/expertise. */}
      {abilityScores && (
        <Collapsible title="SKILLS" testId="self-skills-toggle">
          {SKILLS.map((skill) => {
            const level = hasExpertise(sheet, skill.key) ? "expertise" : isSkillProficient(sheet, skill.key) ? "proficient" : "none";
            return (
              <div key={skill.key} data-testid="self-skill-row" style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: "1px solid rgba(109,90,56,.14)" }}>
                <ProfDot level={level} />
                <span style={{ flex: 1, fontSize: 12.5, color: level === "none" ? "var(--ink-dim)" : "var(--ink)" }}>{skill.label}</span>
                <span style={{ fontSize: 9.5, color: "var(--ink-faint)", letterSpacing: 0.5, width: 26, textAlign: "right" }}>{skill.ability.slice(0, 3).toUpperCase()}</span>
                <span style={{ fontFamily: "var(--font-display)", fontSize: 13, color: "var(--ink)", width: 30, textAlign: "right" }}>{formatMod(skillMod(sheet, skill))}</span>
              </div>
            );
          })}
        </Collapsible>
      )}

      {spellSlotEntries.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {spellSlotEntries.map(([level, slot]) => {
            const used = Math.min(Math.max(slot.used ?? 0, 0), slot.total);
            return (
              <div key={level} style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }} data-testid="self-spell-slot-row">
                <span style={{ fontFamily: "var(--font-display)", fontSize: 10, letterSpacing: 1.5, color: "var(--brass-dim)" }}>
                  SPELL SLOTS · {level.toUpperCase()}
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  {Array.from({ length: slot.total }, (_, i) => (
                    <span
                      key={i}
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        border: "1.5px solid var(--arcane)",
                        background: i < slot.total - used ? "var(--arcane)" : "transparent",
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 18, fontFamily: "var(--font-display)", fontSize: 10, letterSpacing: 1.5, color: "var(--brass-dim)" }}>PURSE</div>
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        {COIN_ORDER.map((coin) => (
          <div key={coin.key} data-testid={`self-coin-${coin.key}`} style={{ textAlign: "center" }}>
            <div style={{ width: 26, height: 26, margin: "0 auto", borderRadius: "50%", background: `var(--coin-${coin.key})`, boxShadow: "inset 0 -2px 3px rgba(0,0,0,.4), inset 0 2px 2px rgba(255,255,255,.25)" }} />
            <div style={{ fontFamily: "var(--font-display)", fontSize: 12, color: "var(--ink)", marginTop: 4 }}>{currency[coin.key]}</div>
            <div style={{ fontSize: 9, color: "var(--ink-faint)", letterSpacing: 1 }}>{coin.label}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 18, fontFamily: "var(--font-display)", fontSize: 10, letterSpacing: 1.5, color: "var(--brass-dim)" }}>CARRIED</div>
      <div style={{ marginTop: 6 }}>
        {inventory.length === 0 && (
          <p style={{ fontStyle: "italic", fontSize: 13, color: "var(--ink-faint)" }}>Carrying nothing yet.</p>
        )}
        {inventory.map((entry, i) => (
          <div
            key={`${entry.item}-${i}`}
            data-testid="self-inventory-item"
            style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid rgba(109,90,56,.2)" }}
          >
            <span style={{ fontSize: 14, color: "var(--ink)" }}>{entry.item}</span>
            {entry.quantity > 1 && <span style={{ fontSize: 11.5, color: "var(--ink-faint)", fontStyle: "italic" }}>×{entry.quantity}</span>}
          </div>
        ))}
      </div>

      {/* Issue #67: features & traits, proficiencies/languages, personality. */}
      {features.length > 0 && (
        <Collapsible title="FEATURES & TRAITS" testId="self-features-toggle" defaultOpen>
          {features.map((f, i) => (
            <div key={`${f.name}-${i}`} data-testid="self-feature" style={{ padding: "6px 0", borderBottom: "1px solid rgba(109,90,56,.14)" }}>
              <div style={{ fontSize: 13.5, color: "var(--ink)" }}>
                {f.name}
                {f.source && <span style={{ fontSize: 10.5, color: "var(--ink-faint)", marginLeft: 6 }}>· {f.source}</span>}
              </div>
              {f.description && <div style={{ fontSize: 12, color: "var(--ink-dim)", lineHeight: 1.45, marginTop: 2 }}>{f.description}</div>}
            </div>
          ))}
        </Collapsible>
      )}

      {(languages.length > 0 || otherProficiencies.length > 0) && (
        <Collapsible title="PROFICIENCIES & LANGUAGES" testId="self-proficiencies-toggle">
          {[...otherProficiencies, ...languages].length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {otherProficiencies.map((p) => (
                <span key={`prof-${p}`} data-testid="self-proficiency" style={{ fontSize: 12, color: "var(--ink)", background: "rgba(28,20,12,.6)", border: "1px solid rgba(109,90,56,.35)", padding: "3px 10px", borderRadius: 20 }}>{p}</span>
              ))}
              {languages.map((l) => (
                <span key={`lang-${l}`} data-testid="self-language" style={{ fontSize: 12, color: "var(--arcane)", background: "rgba(60,70,110,.18)", border: "1px solid rgba(120,140,200,.3)", padding: "3px 10px", borderRadius: 20 }}>{l}</span>
              ))}
            </div>
          )}
        </Collapsible>
      )}

      {hasPersonality && (
        <Collapsible title="PERSONALITY" testId="self-personality-toggle">
          {([
            ["Traits", personality.traits],
            ["Ideals", personality.ideals],
            ["Bonds", personality.bonds],
            ["Flaws", personality.flaws],
          ] as const).filter(([, v]) => v).map(([label, value]) => (
            <div key={label} style={{ marginBottom: 8 }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 9.5, letterSpacing: 1, color: "var(--brass-dim)" }}>{label.toUpperCase()}</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-dim)", lineHeight: 1.45, marginTop: 2 }}>{value}</div>
            </div>
          ))}
        </Collapsible>
      )}
    </div>
  );
}
