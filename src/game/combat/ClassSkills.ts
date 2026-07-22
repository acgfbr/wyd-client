import type { PlayerState } from "../state/PlayerState";
import {
  HUNTRESS_SKILLS,
  type HuntressSkill,
} from "./HuntressSkills";
import { BEAST_MASTER_SUMMONS } from "./BeastMasterSummons";

export { HUNTRESS_SKILLS };

export const CLASS_BUFF_DURATION_SECONDS = 180;

export type ClassicClassKey = "transknight" | "foema" | "beastmaster" | "huntress";

export type ClassSkillKind =
  | "direct"
  | "area"
  | "volley"
  | "cone"
  | "shadow"
  | "buff"
  | "summon";

export type ClassSkillTarget = "enemy" | "self";

export type ClassicActionSequence = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/**
 * Runtime-ready view of one retail SkillData.bin record.
 *
 * `affectTimeSeconds` preserves the classic binary value. Buffs deliberately
 * use the separate 180-second `runtimeDurationSeconds` while the server is out
 * of scope. `damageCoefficient` is likewise only an offline presentation
 * value; the authoritative damage formula belongs to the future server.
 */
export interface ClassSkill {
  readonly classKey: ClassicClassKey;
  readonly slot: number;
  readonly classicIndex: number;
  readonly name: string;
  readonly shortName: string;
  readonly mana: number;
  readonly cooldownSeconds: number;
  readonly range: number;
  readonly kind: ClassSkillKind;
  readonly target: ClassSkillTarget;
  readonly classicTargetType: number;
  readonly maxTargets: number;
  readonly instanceType: number;
  readonly instanceValue: number;
  readonly tickType: number;
  readonly tickValue: number;
  readonly affectType: number;
  readonly affectValue: number;
  readonly affectTimeSeconds: number;
  readonly runtimeDurationSeconds: number;
  readonly aggressive: 0 | 1;
  readonly party: 0 | 1;
  readonly action1: ClassicActionSequence;
  readonly action2: ClassicActionSequence;
  /** Neutral client-side overlay until the server owns combat balance. */
  readonly damageCoefficient: number;
  /** Area geometry in WYD tiles; zero means a single target or self cast. */
  readonly radius: number;
  /** Three.js fallback tint; the classic effect renderer remains authoritative. */
  readonly color: number;
  /** Stable dispatch key for the class-specific classic effect renderer. */
  readonly effectKey: string;
}

type ClassSkillDefinition = Omit<ClassSkill, "classKey">;

/** Runtime-enabled TransKnight records; VFX/target routes gate promotion here. */
export const TRANSKNIGHT_SKILLS = defineLoadout("transknight", [
  {
    slot: 1,
    classicIndex: 2,
    name: "Golpe Duplo",
    shortName: "Duplo",
    mana: 10,
    cooldownSeconds: 3,
    range: 4,
    kind: "direct",
    target: "enemy",
    classicTargetType: 1,
    maxTargets: 2,
    instanceType: 1,
    instanceValue: 13,
    tickType: 0,
    tickValue: 0,
    affectType: 0,
    affectValue: 0,
    affectTimeSeconds: 0,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [7, 0, 0, 7, 0, 0, 0, 0],
    action2: [7, 0, 0, 7, 0, 0, 0, 0],
    damageCoefficient: 1,
    radius: 0,
    color: 0xaaffee,
    effectKey: "tk-double-swing",
  },
  {
    slot: 2,
    classicIndex: 19,
    name: "Lâmina Congelada",
    shortName: "Lâmina",
    mana: 22,
    cooldownSeconds: 3,
    range: 4,
    kind: "direct",
    target: "enemy",
    classicTargetType: 1,
    maxTargets: 1,
    instanceType: 3,
    instanceValue: 50,
    tickType: 0,
    tickValue: 0,
    affectType: 7,
    affectValue: 1,
    affectTimeSeconds: 2,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [8, 0, 0, 7, 0, 0, 0, 0],
    action2: [8, 0, 0, 7, 0, 0, 0, 0],
    damageCoefficient: 1,
    radius: 0,
    color: 0xaaeeff,
    effectKey: "tk-freeze-blade",
  },
  {
    slot: 3,
    classicIndex: 23,
    name: "Tempestade de Gelo",
    shortName: "Tempestade",
    mana: 150,
    cooldownSeconds: 6,
    range: 6,
    kind: "area",
    target: "enemy",
    classicTargetType: 3,
    maxTargets: 8,
    instanceType: 3,
    instanceValue: 210,
    tickType: 0,
    tickValue: 0,
    affectType: 1,
    affectValue: 2,
    affectTimeSeconds: 3,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [8, 0, 0, 7, 0, 0, 0, 0],
    action2: [8, 0, 0, 7, 0, 0, 0, 0],
    damageCoefficient: 1,
    radius: 1,
    color: 0xaaeeff,
    effectKey: "tk-ice-storm",
  },
  {
    slot: 4,
    classicIndex: 3,
    name: "Samaritano",
    shortName: "Samaritano",
    mana: 105,
    cooldownSeconds: 0,
    range: 0,
    kind: "buff",
    target: "self",
    classicTargetType: 0,
    maxTargets: 1,
    instanceType: 0,
    instanceValue: 0,
    tickType: 0,
    tickValue: 0,
    affectType: 14,
    affectValue: 10,
    affectTimeSeconds: 15,
    runtimeDurationSeconds: CLASS_BUFF_DURATION_SECONDS,
    aggressive: 0,
    party: 0,
    action1: [24, 0, 0, 24, 0, 0, 0, 0],
    action2: [24, 0, 0, 24, 0, 0, 0, 0],
    damageCoefficient: 0,
    radius: 0,
    color: 0xffeeff,
    effectKey: "tk-samaritan",
  },
  {
    slot: 5,
    classicIndex: 5,
    name: "Aura da Vida",
    shortName: "Aura",
    mana: 53,
    cooldownSeconds: 0,
    range: 0,
    kind: "buff",
    target: "self",
    classicTargetType: 0,
    maxTargets: 1,
    instanceType: 0,
    instanceValue: 0,
    tickType: 17,
    tickValue: 75,
    affectType: 0,
    affectValue: 0,
    affectTimeSeconds: 12,
    runtimeDurationSeconds: CLASS_BUFF_DURATION_SECONDS,
    aggressive: 0,
    party: 0,
    action1: [24, 0, 0, 24, 0, 0, 0, 0],
    action2: [24, 0, 0, 24, 0, 0, 0, 0],
    damageCoefficient: 0,
    radius: 0,
    color: 0xffffff,
    effectKey: "tk-life-aura",
  },
  {
    slot: 6,
    classicIndex: 0,
    name: "Giro da Fúria",
    shortName: "Fúria",
    mana: 15,
    cooldownSeconds: 4,
    range: 4,
    kind: "area",
    target: "enemy",
    classicTargetType: 3,
    // TMFieldScene caps TargetType 3 at eight even though SkillData says 13.
    maxTargets: 8,
    instanceType: 4,
    instanceValue: 10,
    tickType: 0,
    tickValue: 0,
    affectType: 0,
    affectValue: 0,
    affectTimeSeconds: 0,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [10, 0, 0, 10, 0, 0, 0, 0],
    action2: [10, 0, 0, 10, 0, 0, 0, 0],
    damageCoefficient: 1,
    radius: 1,
    color: 0xaaeeff,
    effectKey: "tk-heavens-dust",
  },
  {
    slot: 7,
    classicIndex: 1,
    name: "Toque Sagrado",
    shortName: "Sagrado",
    mana: 20,
    cooldownSeconds: 3,
    range: 0,
    kind: "area",
    target: "self",
    classicTargetType: 4,
    maxTargets: 13,
    instanceType: 0,
    instanceValue: 0,
    tickType: 0,
    tickValue: 0,
    affectType: 1,
    affectValue: 2,
    affectTimeSeconds: 3,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [10, 0, 0, 10, 0, 0, 0, 0],
    action2: [10, 0, 0, 10, 0, 0, 0, 0],
    damageCoefficient: 1,
    radius: 2,
    color: 0xaaaaff,
    effectKey: "tk-holy-touch",
  },
]);

/**
 * Runtime-enabled Foema records. The original catalog still exposes all
 * #24-#47; entries are promoted here only after their cast/target/VFX route is
 * implemented rather than silently falling through to a generic effect.
 */
export const FOEMA_SKILLS = defineLoadout("foema", [
  {
    slot: 1,
    classicIndex: 32,
    name: "Ataque de Fogo",
    shortName: "Fogo",
    mana: 7,
    cooldownSeconds: 2,
    range: 5,
    kind: "direct",
    target: "enemy",
    classicTargetType: 1,
    maxTargets: 1,
    instanceType: 2,
    instanceValue: 20,
    tickType: 0,
    tickValue: 0,
    affectType: 0,
    affectValue: 0,
    affectTimeSeconds: 0,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [5, 0, 0, 7, 0, 0, 0, 0],
    action2: [5, 0, 0, 5, 0, 0, 0, 0],
    damageCoefficient: 1,
    radius: 0,
    color: 0xffffff,
    effectKey: "foema-fire-attack",
  },
  {
    slot: 2,
    classicIndex: 34,
    name: "Lança de Gelo",
    shortName: "Lança",
    mana: 15,
    cooldownSeconds: 3,
    range: 6,
    kind: "direct",
    target: "enemy",
    classicTargetType: 1,
    maxTargets: 1,
    instanceType: 3,
    instanceValue: 95,
    tickType: 0,
    tickValue: 0,
    affectType: 1,
    affectValue: 2,
    affectTimeSeconds: 1,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [5, 0, 0, 7, 0, 0, 0, 0],
    action2: [5, 0, 0, 7, 0, 0, 0, 0],
    damageCoefficient: 1,
    radius: 0,
    color: 0xffffff,
    effectKey: "foema-ice-spear",
  },
  {
    slot: 3,
    classicIndex: 38,
    name: "Fênix de Fogo",
    shortName: "Fênix",
    mana: 85,
    cooldownSeconds: 7,
    range: 6,
    kind: "direct",
    target: "enemy",
    classicTargetType: 1,
    maxTargets: 1,
    instanceType: 2,
    instanceValue: 380,
    tickType: 0,
    tickValue: 0,
    affectType: 0,
    affectValue: 0,
    affectTimeSeconds: 0,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [9, 0, 0, 7, 0, 0, 0, 0],
    action2: [9, 0, 0, 7, 0, 0, 0, 0],
    damageCoefficient: 1,
    radius: 0,
    color: 0xdd4400,
    effectKey: "foema-fire-phoenix",
  },
  {
    slot: 4,
    classicIndex: 41,
    name: "Velocidade",
    shortName: "Velocidade",
    mana: 52,
    cooldownSeconds: 3,
    range: 5,
    kind: "buff",
    target: "self",
    classicTargetType: 0,
    maxTargets: 13,
    instanceType: 0,
    instanceValue: 0,
    tickType: 0,
    tickValue: 0,
    affectType: 2,
    affectValue: 1,
    affectTimeSeconds: 15,
    runtimeDurationSeconds: CLASS_BUFF_DURATION_SECONDS,
    aggressive: 0,
    party: 1,
    action1: [10, 0, 0, 24, 0, 0, 0, 0],
    action2: [9, 0, 0, 8, 0, 0, 0, 0],
    damageCoefficient: 0,
    radius: 0,
    color: 0xff0000,
    effectKey: "foema-haste",
  },
  {
    slot: 5,
    classicIndex: 44,
    name: "Arma Mágica",
    shortName: "Arma",
    mana: 78,
    cooldownSeconds: 3,
    range: 5,
    kind: "buff",
    target: "self",
    classicTargetType: 0,
    maxTargets: 13,
    instanceType: 0,
    instanceValue: 0,
    tickType: 0,
    tickValue: 0,
    affectType: 9,
    affectValue: 90,
    affectTimeSeconds: 15,
    runtimeDurationSeconds: CLASS_BUFF_DURATION_SECONDS,
    aggressive: 0,
    party: 1,
    action1: [10, 0, 0, 24, 0, 0, 0, 0],
    action2: [10, 0, 0, 8, 0, 0, 0, 0],
    damageCoefficient: 0,
    radius: 0,
    color: 0x550088,
    effectKey: "foema-magic-weapon",
  },
  {
    slot: 6,
    classicIndex: 33,
    name: "Relâmpago",
    shortName: "Relâmpago",
    mana: 10,
    cooldownSeconds: 3,
    range: 6,
    kind: "direct",
    target: "enemy",
    classicTargetType: 1,
    maxTargets: 1,
    instanceType: 5,
    instanceValue: 65,
    tickType: 0,
    tickValue: 0,
    affectType: 0,
    affectValue: 0,
    affectTimeSeconds: 0,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [5, 0, 0, 7, 0, 0, 0, 0],
    action2: [5, 0, 0, 7, 0, 0, 0, 0],
    damageCoefficient: 1,
    radius: 0,
    color: 0xaaddff,
    effectKey: "foema-thunder-bolt",
  },
  {
    slot: 7,
    classicIndex: 37,
    name: "Trovão",
    shortName: "Trovão",
    mana: 75,
    cooldownSeconds: 0,
    range: 0,
    kind: "buff",
    target: "self",
    classicTargetType: 0,
    maxTargets: 1,
    instanceType: 0,
    instanceValue: 0,
    tickType: 22,
    tickValue: 100,
    affectType: 0,
    affectValue: 0,
    affectTimeSeconds: 12,
    runtimeDurationSeconds: CLASS_BUFF_DURATION_SECONDS,
    aggressive: 0,
    party: 1,
    action1: [24, 0, 0, 24, 0, 0, 0, 0],
    action2: [19, 0, 0, 8, 0, 0, 0, 0],
    damageCoefficient: 0,
    radius: 0,
    color: 0xaaddff,
    effectKey: "foema-thunder",
  },
  {
    slot: 8,
    classicIndex: 40,
    name: "Névoa Venenosa",
    shortName: "Veneno",
    mana: 60,
    cooldownSeconds: 2,
    range: 6,
    kind: "direct",
    target: "enemy",
    classicTargetType: 1,
    maxTargets: 1,
    instanceType: 1,
    instanceValue: 200,
    tickType: 20,
    tickValue: 10,
    affectType: 0,
    affectValue: 0,
    affectTimeSeconds: 3,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [10, 0, 0, 9, 0, 0, 0, 0],
    action2: [10, 0, 0, 9, 0, 0, 0, 0],
    damageCoefficient: 1,
    radius: 0,
    color: 0x33ff66,
    effectKey: "foema-poison-mist",
  },
]);

const BEASTMASTER_SUMMON_ACTIONS: Readonly<Record<number, readonly [ClassicActionSequence, ClassicActionSequence]>> = {
  56: [[9, 0, 0, 6, 0, 0, 0, 0], [8, 0, 0, 7, 0, 0, 0, 0]],
  57: [[8, 0, 0, 6, 0, 0, 0, 0], [9, 0, 0, 7, 0, 0, 0, 0]],
  58: [[8, 0, 0, 6, 0, 0, 0, 0], [8, 0, 0, 7, 0, 0, 0, 0]],
  59: [[9, 0, 0, 6, 0, 0, 0, 0], [8, 0, 0, 7, 0, 0, 0, 0]],
  60: [[8, 0, 0, 6, 0, 0, 0, 0], [9, 0, 0, 7, 0, 0, 0, 0]],
  61: [[8, 0, 0, 6, 0, 0, 0, 0], [8, 0, 0, 7, 0, 0, 0, 0]],
  62: [[9, 0, 0, 6, 0, 0, 0, 0], [8, 0, 0, 7, 0, 0, 0, 0]],
  63: [[8, 0, 0, 6, 0, 0, 0, 0], [8, 0, 0, 6, 0, 0, 0, 0]],
};
const BEASTMASTER_SUMMON_HOTBAR_ORDER = [56, 57, 58, 60, 59, 61, 62, 63] as const;

/** BeastMaster records #48/#49/#50/#53/#54 and nature summons #56-#63. */
export const BEASTMASTER_SKILLS = defineLoadout("beastmaster", [
  {
    slot: 1,
    classicIndex: 48,
    name: "Fera Flamejante",
    shortName: "Fera",
    mana: 8,
    cooldownSeconds: 2,
    range: 6,
    kind: "direct",
    target: "enemy",
    classicTargetType: 1,
    maxTargets: 1,
    instanceType: 2,
    instanceValue: 60,
    tickType: 0,
    tickValue: 0,
    affectType: 0,
    affectValue: 0,
    affectTimeSeconds: 0,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [5, 0, 0, 8, 0, 0, 0, 0],
    action2: [9, 0, 0, 5, 0, 0, 0, 0],
    damageCoefficient: 1,
    radius: 0,
    color: 0x3333ff,
    effectKey: "beastmaster-flaming-beast",
  },
  {
    slot: 2,
    classicIndex: 49,
    name: "Chamas Etéreas",
    shortName: "Chamas",
    mana: 35,
    cooldownSeconds: 10,
    range: 6,
    kind: "direct",
    target: "enemy",
    classicTargetType: 1,
    maxTargets: 1,
    instanceType: 12,
    instanceValue: 0,
    tickType: 0,
    tickValue: 0,
    affectType: 0,
    affectValue: 0,
    affectTimeSeconds: 0,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [8, 0, 0, 6, 0, 0, 0, 0],
    action2: [8, 0, 0, 8, 0, 0, 0, 0],
    damageCoefficient: 1,
    radius: 0,
    color: 0x3333ff,
    effectKey: "beastmaster-ethereal-flames",
  },
  {
    slot: 3,
    classicIndex: 50,
    name: "Som das Fadas",
    shortName: "Fadas",
    mana: 20,
    cooldownSeconds: 2,
    range: 6,
    kind: "direct",
    target: "enemy",
    classicTargetType: 1,
    maxTargets: 1,
    instanceType: 4,
    instanceValue: 160,
    tickType: 0,
    tickValue: 0,
    affectType: 0,
    affectValue: 0,
    affectTimeSeconds: 0,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [7, 0, 0, 8, 0, 0, 0, 0],
    action2: [9, 0, 0, 6, 0, 0, 0, 0],
    damageCoefficient: 1,
    radius: 0,
    color: 0xffffff,
    effectKey: "beastmaster-fairy-sound",
  },
  {
    slot: 4,
    classicIndex: 53,
    name: "Proteção Elemental",
    shortName: "Proteção",
    mana: 105,
    cooldownSeconds: 15,
    range: 0,
    kind: "buff",
    target: "self",
    classicTargetType: 0,
    maxTargets: 1,
    instanceType: 0,
    instanceValue: 0,
    tickType: 0,
    tickValue: 0,
    affectType: 25,
    affectValue: 10,
    affectTimeSeconds: 10,
    runtimeDurationSeconds: CLASS_BUFF_DURATION_SECONDS,
    aggressive: 0,
    party: 0,
    action1: [9, 0, 0, 8, 0, 0, 0, 0],
    action2: [9, 0, 0, 8, 0, 0, 0, 0],
    damageCoefficient: 0,
    radius: 0,
    color: 0xffffff,
    effectKey: "beastmaster-elemental-protection",
  },
  {
    slot: 5,
    classicIndex: 54,
    name: "Força Elemental",
    shortName: "Força",
    mana: 128,
    cooldownSeconds: 0,
    range: 0,
    kind: "buff",
    target: "self",
    classicTargetType: 0,
    maxTargets: 1,
    instanceType: 0,
    instanceValue: 0,
    tickType: 23,
    tickValue: 160,
    affectType: 0,
    affectValue: 0,
    affectTimeSeconds: 12,
    runtimeDurationSeconds: CLASS_BUFF_DURATION_SECONDS,
    aggressive: 0,
    party: 0,
    action1: [24, 0, 0, 9, 0, 0, 0, 0],
    action2: [24, 0, 0, 8, 0, 0, 0, 0],
    damageCoefficient: 0,
    radius: 0,
    color: 0xffeeff,
    effectKey: "beastmaster-elemental-strength",
  },
  ...BEAST_MASTER_SUMMONS.map((summon): ClassSkillDefinition => {
    const [action1, action2] = BEASTMASTER_SUMMON_ACTIONS[summon.skill.classicIndex]!;
    return {
      // The four visible summon slots keep Grande Tigre on key 9. The other
      // invocations remain directly castable from the classic skill window.
      slot: 6 + BEASTMASTER_SUMMON_HOTBAR_ORDER.indexOf(summon.skill.classicIndex),
      classicIndex: summon.skill.classicIndex,
      name: `Evocar ${summon.name}`,
      shortName: summon.name.replace(" Selvagem", "").replace(" Gigante", ""),
      mana: summon.skill.mana,
      cooldownSeconds: summon.skill.cooldownSeconds,
      range: 0,
      kind: "summon",
      target: "self",
      classicTargetType: summon.skill.targetType,
      maxTargets: summon.skill.maxTarget,
      instanceType: summon.skill.instanceType,
      instanceValue: summon.skill.instanceValue,
      tickType: 0,
      tickValue: 0,
      affectType: 0,
      affectValue: 0,
      affectTimeSeconds: 0,
      runtimeDurationSeconds: 0,
      aggressive: 0,
      party: 0,
      action1,
      action2,
      damageCoefficient: 0,
      radius: 0,
      color: summon.skill.classicIndex === 62 ? 0x7653ff : 0x89e4a2,
      effectKey: `beastmaster-summon-${summon.key}`,
    };
  }),
]);

const HUNTRESS_CLASSIC_RECORDS: Readonly<Record<number, ClassicRecordFields>> = Object.freeze({
  72: classicRecord(1, 1, 30, 0, 0, 0, 0, 0, [9, 0, 0, 7, 0, 0, 0, 0], [8, 0, 0, 7, 0, 0, 0, 0], 1, 1, 0),
  75: classicRecord(0, 0, 0, 0, 0, 27, 1, 12, [8, 0, 0, 7, 0, 0, 0, 0], [9, 0, 0, 7, 0, 0, 0, 0], 0, 1, 0),
  76: classicRecord(0, 0, 0, 0, 0, 19, 15, 12, [20, 0, 0, 9, 0, 0, 0, 0], [19, 0, 0, 8, 0, 0, 0, 0], 0, 1, 0),
  79: classicRecord(6, 1, 750, 0, 0, 0, 0, 0, [7, 0, 0, 9, 0, 0, 0, 0], [9, 0, 0, 8, 0, 0, 0, 0], 1, 6, 0),
  80: classicRecord(1, 1, 30, 0, 0, 0, 0, 0, [9, 0, 0, 7, 0, 0, 0, 0], [8, 0, 0, 7, 0, 0, 0, 0], 1, 1, 0),
  81: classicRecord(0, 0, 0, 0, 0, 37, 0, 14, [8, 0, 0, 7, 0, 0, 0, 0], [9, 0, 0, 7, 0, 0, 0, 0], 0, 1, 0),
  86: classicRecord(5, 1, 50, 0, 0, 0, 0, 0, [7, 0, 0, 9, 0, 0, 0, 0], [9, 0, 0, 8, 0, 0, 0, 0], 1, 13, 0),
  88: classicRecord(1, 1, 30, 0, 0, 0, 0, 0, [9, 0, 0, 7, 0, 0, 0, 0], [24, 0, 0, 7, 0, 0, 0, 0], 1, 1, 0),
  95: classicRecord(0, 0, 0, 0, 0, 28, 1, 3, [19, 0, 0, 8, 0, 0, 0, 0], [10, 0, 0, 8, 0, 0, 0, 0], 0, 1, 0),
});

/** Huntress keeps the already playable loadout and gains the shared metadata. */
export const HUNTRESS_CLASS_SKILLS: readonly ClassSkill[] = Object.freeze(
  HUNTRESS_SKILLS.map((skill) => mapHuntressSkill(skill)),
);

export const CLASS_SKILL_LOADOUTS: Readonly<Record<ClassicClassKey, readonly ClassSkill[]>> = Object.freeze({
  transknight: TRANSKNIGHT_SKILLS,
  foema: FOEMA_SKILLS,
  beastmaster: BEASTMASTER_SKILLS,
  huntress: HUNTRESS_CLASS_SKILLS,
});

export interface ActiveClassBuff {
  readonly classKey: ClassicClassKey;
  readonly classicIndex: number;
  readonly name: string;
  readonly iconIndex: number;
  readonly affectType: number;
  readonly affectValue: number;
  readonly durationSeconds: number;
  readonly remainingSeconds: number;
}

interface MutableClassBuffState {
  readonly skill: ClassSkill;
  remainingSeconds: number;
}

export type ClassSkillStartResult =
  | { readonly ok: true; readonly skill: ClassSkill }
  | {
    readonly ok: false;
    readonly skill: ClassSkill | null;
    readonly reason: "invalid" | "cooldown" | "mana";
  };

/** Shared cooldown and 180-second buff state for every playable class. */
export class ClassSkillSystem {
  readonly classKey: ClassicClassKey;
  readonly skills: readonly ClassSkill[];
  readonly #bySlot = new Map<number, ClassSkill>();
  readonly #remaining = new Map<number, number>();
  readonly #buffs = new Map<number, MutableClassBuffState>();

  constructor(classKey: ClassicClassKey = "huntress") {
    this.classKey = classKey;
    this.skills = CLASS_SKILL_LOADOUTS[classKey];
    for (const skill of this.skills) this.#bySlot.set(skill.slot, skill);
  }

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

  skill(slot: number): ClassSkill | null {
    return this.#bySlot.get(slot) ?? null;
  }

  start(slot: number, player: PlayerState): ClassSkillStartResult {
    const skill = this.skill(slot);
    if (!skill) return { ok: false, skill, reason: "invalid" };
    if (this.remaining(slot) > 0) return { ok: false, skill, reason: "cooldown" };
    if (!player.spendMana(skill.mana)) return { ok: false, skill, reason: "mana" };
    if (skill.cooldownSeconds > 0) this.#remaining.set(slot, skill.cooldownSeconds);
    return { ok: true, skill };
  }

  activateBuff(skill: ClassSkill): ActiveClassBuff | null {
    const loadoutSkill = this.#bySlot.get(skill.slot);
    if (loadoutSkill !== skill || skill.kind !== "buff") return null;
    this.#buffs.set(skill.classicIndex, {
      skill,
      remainingSeconds: CLASS_BUFF_DURATION_SECONDS,
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

  buff(classicIndex: number): ActiveClassBuff | null {
    const state = this.#buffs.get(classicIndex);
    return state ? snapshotClassBuff(state) : null;
  }

  activeBuffs(): readonly ActiveClassBuff[] {
    return [...this.#buffs.values()]
      .map(snapshotClassBuff)
      .sort((left, right) => left.classicIndex - right.classicIndex);
  }

  remaining(slot: number): number {
    return this.#remaining.get(slot) ?? 0;
  }

  ratio(slot: number): number {
    const skill = this.#bySlot.get(slot);
    if (!skill || skill.cooldownSeconds <= 0) return 0;
    return Math.max(0, Math.min(1, this.remaining(slot) / skill.cooldownSeconds));
  }

  clear(): void {
    this.#remaining.clear();
    this.#buffs.clear();
  }
}

interface ClassicRecordFields {
  readonly classicTargetType: number;
  readonly instanceType: number;
  readonly instanceValue: number;
  readonly tickType: number;
  readonly tickValue: number;
  readonly affectType: number;
  readonly affectValue: number;
  readonly affectTimeSeconds: number;
  readonly action1: ClassicActionSequence;
  readonly action2: ClassicActionSequence;
  readonly aggressive: 0 | 1;
  readonly maxTargets: number;
  readonly party: 0 | 1;
}

function defineLoadout(
  classKey: ClassicClassKey,
  definitions: readonly ClassSkillDefinition[],
): readonly ClassSkill[] {
  const slots = new Set<number>();
  const classicIndices = new Set<number>();
  const skills = definitions.map((definition) => {
    if (slots.has(definition.slot)) throw new Error(`${classKey}: slot duplicado ${definition.slot}`);
    if (classicIndices.has(definition.classicIndex)) {
      throw new Error(`${classKey}: skill clássica duplicada ${definition.classicIndex}`);
    }
    slots.add(definition.slot);
    classicIndices.add(definition.classicIndex);
    return Object.freeze({ classKey, ...definition });
  });
  return Object.freeze(skills);
}

function mapHuntressSkill(skill: HuntressSkill): ClassSkill {
  const record = HUNTRESS_CLASSIC_RECORDS[skill.classicIndex];
  if (!record) throw new Error(`Huntress: metadados ausentes para #${skill.classicIndex}`);
  return Object.freeze({
    ...skill,
    classKey: "huntress",
    classicTargetType: record.classicTargetType,
    instanceType: record.instanceType,
    instanceValue: record.instanceValue,
    tickType: record.tickType,
    tickValue: record.tickValue,
    aggressive: record.aggressive,
    party: record.party,
    action1: record.action1,
    action2: record.action2,
    effectKey: `huntress-${skill.classicIndex}`,
  });
}

function classicRecord(
  classicTargetType: number,
  instanceType: number,
  instanceValue: number,
  tickType: number,
  tickValue: number,
  affectType: number,
  affectValue: number,
  affectTimeSeconds: number,
  action1: ClassicActionSequence,
  action2: ClassicActionSequence,
  aggressive: 0 | 1,
  maxTargets: number,
  party: 0 | 1,
): ClassicRecordFields {
  return Object.freeze({
    classicTargetType,
    instanceType,
    instanceValue,
    tickType,
    tickValue,
    affectType,
    affectValue,
    affectTimeSeconds,
    action1,
    action2,
    aggressive,
    maxTargets,
    party,
  });
}

function snapshotClassBuff(state: MutableClassBuffState): ActiveClassBuff {
  return {
    classKey: state.skill.classKey,
    classicIndex: state.skill.classicIndex,
    name: state.skill.name,
    iconIndex: state.skill.classicIndex,
    affectType: state.skill.affectType,
    affectValue: state.skill.affectValue,
    durationSeconds: CLASS_BUFF_DURATION_SECONDS,
    remainingSeconds: state.remainingSeconds,
  };
}
