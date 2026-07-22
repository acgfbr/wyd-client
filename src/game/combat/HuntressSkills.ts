import type { PlayerState } from "../state/PlayerState";

export type HuntressSkillKind = "projectile" | "area" | "poison" | "defense";

export interface HuntressSkill {
  readonly slot: number;
  /** Index in the Huntress block (72..95) of the original SkillData.bin. */
  readonly classicIndex: number;
  readonly name: string;
  readonly shortName: string;
  readonly mana: number;
  readonly cooldownSeconds: number;
  readonly range: number;
  readonly power: number;
  readonly kind: HuntressSkillKind;
  readonly radius: number;
  readonly color: number;
}

/** Values are based on the decoded Huntress block from the retail client. */
export const HUNTRESS_SKILLS: readonly HuntressSkill[] = [
  { slot: 1, classicIndex: 72, name: "Ataque Fatal", shortName: "Fatal", mana: 15, cooldownSeconds: 1.5, range: 14, power: 1.45, kind: "projectile", radius: 0, color: 0xffdb78 },
  { slot: 2, classicIndex: 79, name: "Tempestade de Raios", shortName: "Raios", mana: 75, cooldownSeconds: 11, range: 13, power: 2.2, kind: "area", radius: 4.2, color: 0xaedbff },
  { slot: 3, classicIndex: 80, name: "Golpe Felino", shortName: "Felino", mana: 10, cooldownSeconds: 1.5, range: 11, power: 1.3, kind: "projectile", radius: 0, color: 0xff9a52 },
  { slot: 4, classicIndex: 86, name: "Explosão Etérea", shortName: "Etérea", mana: 25, cooldownSeconds: 3, range: 12, power: 1.65, kind: "area", radius: 3.1, color: 0xd292ff },
  { slot: 5, classicIndex: 88, name: "Lâmina das Sombras", shortName: "Sombras", mana: 15, cooldownSeconds: 4, range: 14, power: 1.8, kind: "projectile", radius: 0, color: 0x7b8cff },
  { slot: 6, classicIndex: 92, name: "Toxina de Serpente", shortName: "Toxina", mana: 50, cooldownSeconds: 6, range: 12, power: 1.55, kind: "poison", radius: 2.2, color: 0x82e84f },
  { slot: 7, classicIndex: 93, name: "Lâmina Aérea", shortName: "Aérea", mana: 0, cooldownSeconds: 2, range: 15, power: 1.35, kind: "area", radius: 2.5, color: 0xe8f7ff },
  { slot: 8, classicIndex: 95, name: "Invisibilidade", shortName: "Invisível", mana: 200, cooldownSeconds: 13, range: 0, power: 0, kind: "defense", radius: 0, color: 0xb9c8ff },
] as const;

export type SkillStartResult =
  | { readonly ok: true; readonly skill: HuntressSkill }
  | { readonly ok: false; readonly skill: HuntressSkill | null; readonly reason: "invalid" | "cooldown" | "mana" };

export class HuntressSkillSystem {
  readonly #remaining = new Map<number, number>();

  update(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    for (const [slot, remaining] of this.#remaining) {
      const next = Math.max(0, remaining - deltaSeconds);
      if (next === 0) this.#remaining.delete(slot);
      else this.#remaining.set(slot, next);
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

  remaining(slot: number): number {
    return this.#remaining.get(slot) ?? 0;
  }

  ratio(slot: number): number {
    const skill = HUNTRESS_SKILLS.find((candidate) => candidate.slot === slot);
    return skill ? Math.max(0, Math.min(1, this.remaining(slot) / skill.cooldownSeconds)) : 0;
  }
}
