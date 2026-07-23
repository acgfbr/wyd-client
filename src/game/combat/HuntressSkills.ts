import type { PlayerState } from "../state/PlayerState";

export type HuntressSkillKind = "direct" | "volley" | "cone" | "shadow" | "buff" | "movement";

export interface HuntressSkill {
  readonly slot: number;
  /** Logical record in the retail SkillData.bin (Huntress block 72..95). */
  readonly classicIndex: number;
  readonly name: string;
  readonly shortName: string;
  readonly mana: number;
  readonly cooldownSeconds: number;
  readonly range: number;
  readonly kind: HuntressSkillKind;
  readonly target: "enemy" | "self" | "ground";
  readonly maxTargets: number;
  readonly affectType: number;
  readonly affectValue: number;
  /** Duration from SkillData.bin, retained for source fidelity. */
  readonly affectTimeSeconds: number;
  /** Offline gameplay override requested while the server is out of scope. */
  readonly runtimeDurationSeconds: number;
  /** Offline-only damage overlay; the authoritative server formula is not in scope yet. */
  readonly damageCoefficient: number;
  /** Geometry used by the original target selection, in WYD tiles. */
  readonly radius: number;
  /** Presentation fallback while the skill-specific classic effect is being ported. */
  readonly color: number;
}

/**
 * Bow-compatible Huntress loadout. Binary fields below are copied from the
 * decoded retail SkillData.bin; only damageCoefficient is an offline overlay.
 * Toxina de Serpente (#92) is intentionally absent because the client accepts
 * it only with WTYPE 41 claws, while this character equips a WTYPE 101 bow.
 */
export const HUNTRESS_SKILLS: readonly HuntressSkill[] = [
  { slot: 1, classicIndex: 72, name: "Ataque Fatal", shortName: "Fatal", mana: 15, cooldownSeconds: 15, range: 2, kind: "direct", target: "enemy", maxTargets: 1, affectType: 0, affectValue: 0, affectTimeSeconds: 0, runtimeDurationSeconds: 0, damageCoefficient: 1.3, radius: 0, color: 0xffaa55 },
  { slot: 2, classicIndex: 79, name: "Tempestade de Raios", shortName: "Raios", mana: 75, cooldownSeconds: 11, range: 6, kind: "volley", target: "enemy", maxTargets: 6, affectType: 0, affectValue: 0, affectTimeSeconds: 0, runtimeDurationSeconds: 0, damageCoefficient: 1.75, radius: 3, color: 0xaedbff },
  { slot: 3, classicIndex: 80, name: "Golpe Felino", shortName: "Felino", mana: 10, cooldownSeconds: 15, range: 2, kind: "direct", target: "enemy", maxTargets: 1, affectType: 0, affectValue: 0, affectTimeSeconds: 0, runtimeDurationSeconds: 0, damageCoefficient: 1.3, radius: 0, color: 0xff5555 },
  { slot: 4, classicIndex: 86, name: "Explosão Etérea", shortName: "Etérea", mana: 25, cooldownSeconds: 3, range: 6, kind: "cone", target: "enemy", maxTargets: 13, affectType: 0, affectValue: 0, affectTimeSeconds: 0, runtimeDurationSeconds: 0, damageCoefficient: 1.5, radius: 6, color: 0xd292ff },
  { slot: 5, classicIndex: 88, name: "Lâmina das Sombras", shortName: "Sombras", mana: 15, cooldownSeconds: 15, range: 3, kind: "shadow", target: "enemy", maxTargets: 1, affectType: 0, affectValue: 0, affectTimeSeconds: 0, runtimeDurationSeconds: 0, damageCoefficient: 1.3, radius: 0, color: 0x996655 },
  { slot: 6, classicIndex: 75, name: "Encantar Gelo", shortName: "Gelo", mana: 30, cooldownSeconds: 6, range: 0, kind: "buff", target: "self", maxTargets: 1, affectType: 27, affectValue: 1, affectTimeSeconds: 12, runtimeDurationSeconds: 180, damageCoefficient: 0, radius: 0, color: 0x55aaff },
  { slot: 7, classicIndex: 76, name: "Imunidade", shortName: "Imune", mana: 42, cooldownSeconds: 6, range: 0, kind: "buff", target: "self", maxTargets: 1, affectType: 19, affectValue: 15, affectTimeSeconds: 12, runtimeDurationSeconds: 180, damageCoefficient: 0, radius: 0, color: 0x99bbff },
  { slot: 8, classicIndex: 95, name: "Invisibilidade", shortName: "Invis.", mana: 200, cooldownSeconds: 13, range: 0, kind: "buff", target: "self", maxTargets: 1, affectType: 28, affectValue: 1, affectTimeSeconds: 3, runtimeDurationSeconds: 180, damageCoefficient: 0, radius: 0, color: 0x661122 },
  { slot: 9, classicIndex: 81, name: "Ligação Espectral", shortName: "Ligação", mana: 108, cooldownSeconds: 6, range: 0, kind: "buff", target: "self", maxTargets: 1, affectType: 37, affectValue: 0, affectTimeSeconds: 14, runtimeDurationSeconds: 180, damageCoefficient: 0, radius: 0, color: 0x999999 },
  { slot: 10, classicIndex: 77, name: "Meditação", shortName: "Meditação", mana: 90, cooldownSeconds: 6, range: 0, kind: "buff", target: "self", maxTargets: 1, affectType: 21, affectValue: 10, affectTimeSeconds: 12, runtimeDurationSeconds: 180, damageCoefficient: 0, radius: 0, color: 0x5500ff },
  { slot: 11, classicIndex: 85, name: "Escudo Dourado", shortName: "Escudo", mana: 120, cooldownSeconds: 5, range: 0, kind: "buff", target: "self", maxTargets: 1, affectType: 31, affectValue: 150, affectTimeSeconds: 30, runtimeDurationSeconds: 180, damageCoefficient: 0, radius: 0, color: 0xffff55 },
  { slot: 12, classicIndex: 89, name: "Evasão Aprimorada", shortName: "Evasão", mana: 24, cooldownSeconds: 6, range: 0, kind: "buff", target: "self", maxTargets: 1, affectType: 26, affectValue: 1, affectTimeSeconds: 12, runtimeDurationSeconds: 180, damageCoefficient: 0, radius: 0, color: 0x4d4d4d },
  { slot: 13, classicIndex: 87, name: "Troca de Espírito", shortName: "Espírito", mana: 90, cooldownSeconds: 10, range: 0, kind: "buff", target: "self", maxTargets: 1, affectType: 38, affectValue: 0, affectTimeSeconds: 14, runtimeDurationSeconds: 180, damageCoefficient: 0, radius: 0, color: 0xff7777 },
  { slot: 14, classicIndex: 73, name: "Ilusão", shortName: "Ilusão", mana: 45, cooldownSeconds: 3, range: 0, kind: "movement", target: "ground", maxTargets: 1, affectType: 0, affectValue: 0, affectTimeSeconds: 0, runtimeDurationSeconds: 0, damageCoefficient: 0, radius: 0, color: 0x0055ff },
] as const;

export interface ActiveHuntressBuff {
  readonly classicIndex: number;
  readonly name: string;
  readonly iconIndex: number;
  readonly affectType: number;
  readonly affectValue: number;
  readonly durationSeconds: number;
  readonly remainingSeconds: number;
}

interface MutableBuffState {
  readonly skill: HuntressSkill;
  remainingSeconds: number;
}

export type SkillStartResult =
  | { readonly ok: true; readonly skill: HuntressSkill }
  | { readonly ok: false; readonly skill: HuntressSkill | null; readonly reason: "invalid" | "cooldown" | "mana" };

export class HuntressSkillSystem {
  readonly #remaining = new Map<number, number>();
  readonly #buffs = new Map<number, MutableBuffState>();

  update(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    for (const [slot, remaining] of this.#remaining) {
      const next = Math.max(0, remaining - deltaSeconds);
      if (next === 0) this.#remaining.delete(slot);
      else this.#remaining.set(slot, next);
    }
    for (const [classicIndex, state] of this.#buffs) {
      state.remainingSeconds = Math.max(0, state.remainingSeconds - deltaSeconds);
      if (state.remainingSeconds === 0) this.#buffs.delete(classicIndex);
    }
  }

  start(slot: number, player: PlayerState): SkillStartResult {
    const skill = HUNTRESS_SKILLS.find((candidate) => candidate.slot === slot) ?? null;
    if (!skill) return { ok: false, skill, reason: "invalid" };
    if (this.remaining(slot) > 0) return { ok: false, skill, reason: "cooldown" };
    if (!player.spendMana(skill.mana)) return { ok: false, skill, reason: "mana" };
    this.#remaining.set(slot, skill.cooldownSeconds);
    return { ok: true, skill };
  }

  activateBuff(skill: HuntressSkill): ActiveHuntressBuff | null {
    if (skill.kind !== "buff" || skill.runtimeDurationSeconds <= 0) return null;
    this.#buffs.set(skill.classicIndex, {
      skill,
      remainingSeconds: skill.runtimeDurationSeconds,
    });
    return this.buff(skill.classicIndex);
  }

  removeBuff(classicIndex: number): boolean {
    return this.#buffs.delete(classicIndex);
  }

  clearBuffs(): void {
    this.#buffs.clear();
  }

  hasBuff(classicIndex: number): boolean {
    return this.#buffs.has(classicIndex);
  }

  buff(classicIndex: number): ActiveHuntressBuff | null {
    const state = this.#buffs.get(classicIndex);
    return state ? snapshotBuff(state) : null;
  }

  activeBuffs(): readonly ActiveHuntressBuff[] {
    return [...this.#buffs.values()]
      .map(snapshotBuff)
      .sort((left, right) => left.classicIndex - right.classicIndex);
  }

  remaining(slot: number): number {
    return this.#remaining.get(slot) ?? 0;
  }

  ratio(slot: number): number {
    const skill = HUNTRESS_SKILLS.find((candidate) => candidate.slot === slot);
    return skill ? Math.max(0, Math.min(1, this.remaining(slot) / skill.cooldownSeconds)) : 0;
  }
}

function snapshotBuff(state: MutableBuffState): ActiveHuntressBuff {
  return {
    classicIndex: state.skill.classicIndex,
    name: state.skill.name,
    iconIndex: state.skill.classicIndex,
    affectType: state.skill.affectType,
    affectValue: state.skill.affectValue,
    durationSeconds: state.skill.runtimeDurationSeconds,
    remainingSeconds: state.remainingSeconds,
  };
}
