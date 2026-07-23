import type { PlayerState } from "../state/PlayerState";
import {
  HUNTRESS_SKILLS,
  type HuntressSkill,
} from "./HuntressSkills";
import { BEAST_MASTER_SUMMONS } from "./BeastMasterSummons";
import { BEAST_MASTER_TRANSFORMATIONS } from "./BeastMasterTransformations";

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
  | "movement"
  | "summon"
  | "utility";

export type ClassSkillTarget = "enemy" | "self" | "ground";

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
  /** Optional EF_WTYPE gate evaluated before mana/cooldown, as in SkillUse. */
  readonly requiredWeaponType?: number;
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
  {
    slot: 8,
    classicIndex: 11,
    name: "Assalto",
    shortName: "Assalto",
    mana: 47,
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
    affectType: 13,
    affectValue: 7,
    affectTimeSeconds: 12,
    runtimeDurationSeconds: CLASS_BUFF_DURATION_SECONDS,
    aggressive: 0,
    party: 0,
    action1: [19, 0, 0, 24, 0, 0, 0, 0],
    action2: [20, 0, 0, 24, 0, 0, 0, 0],
    // SkillData carries no damage payload. The future server owns the exact
    // attack-speed/stat interpretation of AffectType 13.
    damageCoefficient: 0,
    radius: 0,
    color: 0x994444,
    effectKey: "tk-assault",
  },
  {
    slot: 9,
    classicIndex: 13,
    name: "Possuído",
    shortName: "Possuído",
    mana: 25,
    cooldownSeconds: 1,
    range: 5,
    kind: "buff",
    target: "self",
    classicTargetType: 0,
    maxTargets: 1,
    instanceType: 0,
    instanceValue: 0,
    tickType: 0,
    tickValue: 0,
    affectType: 24,
    affectValue: 0,
    affectTimeSeconds: 12,
    runtimeDurationSeconds: CLASS_BUFF_DURATION_SECONDS,
    aggressive: 0,
    party: 0,
    action1: [7, 0, 0, 8, 0, 0, 0, 0],
    action2: [6, 0, 0, 8, 0, 0, 0, 0],
    // Critical-damage/stat math remains server-authoritative. The client
    // faithfully exposes AffectType 24 and its visual state only.
    damageCoefficient: 0,
    radius: 0,
    color: 0x999999,
    effectKey: "tk-possessed",
  },
  {
    // The classic bottom bar has nine visible keys; this tenth runtime record
    // remains castable from the K catalog, matching the existing extended
    // class-loadout route without stealing a configured hotkey.
    slot: 10,
    classicIndex: 12,
    name: "Espada da Fênix",
    shortName: "Fênix",
    mana: 33,
    cooldownSeconds: 15,
    range: 1,
    kind: "direct",
    target: "enemy",
    classicTargetType: 1,
    maxTargets: 2,
    instanceType: 1,
    instanceValue: 60,
    tickType: 0,
    tickValue: 0,
    affectType: 0,
    affectValue: 0,
    affectTimeSeconds: 0,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [7, 0, 0, 5, 0, 0, 0, 0],
    action2: [7, 0, 0, 5, 0, 0, 0, 0],
    damageCoefficient: 1,
    radius: 0,
    color: 0xff0000,
    effectKey: "tk-phoenix-sword",
  },
  {
    slot: 11,
    classicIndex: 8,
    name: "Carga",
    shortName: "Carga",
    mana: 12,
    cooldownSeconds: 15,
    range: 1,
    kind: "direct",
    target: "enemy",
    classicTargetType: 1,
    maxTargets: 1,
    instanceType: 1,
    instanceValue: 15,
    tickType: 0,
    tickValue: 0,
    affectType: 0,
    affectValue: 0,
    affectTimeSeconds: 0,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [8, 0, 0, 7, 0, 0, 0, 0],
    action2: [8, 0, 0, 7, 0, 0, 0, 0],
    damageCoefficient: 1,
    radius: 0,
    color: 0xffffff,
    effectKey: "tk-earthquake-hit",
  },
  {
    slot: 12,
    classicIndex: 10,
    name: "Golpe Mortal",
    shortName: "Mortal",
    mana: 20,
    cooldownSeconds: 15,
    range: 1,
    kind: "direct",
    target: "enemy",
    classicTargetType: 1,
    maxTargets: 2,
    instanceType: 1,
    instanceValue: 40,
    tickType: 0,
    tickValue: 0,
    affectType: 0,
    affectValue: 0,
    affectTimeSeconds: 0,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [8, 0, 0, 7, 0, 0, 0, 0],
    action2: [8, 0, 0, 7, 0, 0, 0, 0],
    damageCoefficient: 1,
    radius: 0,
    color: 0xffffff,
    effectKey: "tk-earthquake-hit",
  },
  {
    slot: 13,
    classicIndex: 18,
    name: "Contra Ataque",
    shortName: "Contra",
    mana: 17,
    cooldownSeconds: 2,
    range: 4,
    kind: "direct",
    target: "enemy",
    classicTargetType: 1,
    maxTargets: 2,
    instanceType: 1,
    instanceValue: 35,
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
    color: 0xffffff,
    effectKey: "tk-earthquake-hit",
  },
  {
    slot: 14,
    classicIndex: 21,
    name: "Punhalada Venenosa",
    shortName: "Veneno",
    mana: 50,
    cooldownSeconds: 3,
    range: 4,
    kind: "direct",
    target: "enemy",
    classicTargetType: 1,
    maxTargets: 1,
    instanceType: 1,
    instanceValue: 80,
    tickType: 20,
    tickValue: 10,
    affectType: 0,
    affectValue: 0,
    affectTimeSeconds: 3,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [9, 0, 0, 5, 0, 0, 0, 0],
    action2: [9, 0, 0, 5, 0, 0, 0, 0],
    // TickType 20 is preserved as metadata. Periodic damage remains a server
    // rule; the offline impact keeps the existing neutral direct coefficient.
    damageCoefficient: 1,
    radius: 0,
    color: 0x33ff66,
    effectKey: "tk-poison-stab",
  },
  {
    slot: 15,
    classicIndex: 6,
    name: "Fúria Divina",
    shortName: "Divina",
    mana: 75,
    cooldownSeconds: 3,
    range: 8,
    kind: "direct",
    target: "enemy",
    classicTargetType: 1,
    maxTargets: 1,
    instanceType: 0,
    instanceValue: 0,
    tickType: 0,
    tickValue: 0,
    affectType: 40,
    affectValue: 0,
    affectTimeSeconds: 0,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [10, 0, 0, 24, 0, 0, 0, 0],
    action2: [10, 0, 0, 24, 0, 0, 0, 0],
    // The attack result is packet-owned in the original. This neutral
    // coefficient only keeps the explicitly offline combat mock playable.
    damageCoefficient: 1,
    radius: 0,
    color: 0x5555ff,
    effectKey: "tk-divine-fury",
  },
  {
    slot: 16,
    classicIndex: 7,
    name: "Destino",
    shortName: "Destino",
    mana: 100,
    cooldownSeconds: 6,
    range: 6,
    kind: "area",
    target: "enemy",
    classicTargetType: 3,
    maxTargets: 8,
    instanceType: 4,
    instanceValue: 250,
    tickType: 0,
    tickValue: 0,
    affectType: 0,
    affectValue: 0,
    affectTimeSeconds: 0,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [24, 0, 0, 24, 0, 0, 0, 0],
    action2: [24, 0, 0, 5, 0, 0, 0, 0],
    damageCoefficient: 1,
    radius: 1,
    color: 0x7777ff,
    effectKey: "tk-destiny",
  },
  {
    slot: 17,
    classicIndex: 17,
    name: "Espada Flamejante",
    shortName: "Flamejante",
    mana: 13,
    cooldownSeconds: 2,
    range: 5,
    kind: "area",
    target: "enemy",
    classicTargetType: 6,
    maxTargets: 5,
    instanceType: 2,
    instanceValue: 25,
    tickType: 0,
    tickValue: 0,
    affectType: 0,
    affectValue: 0,
    affectTimeSeconds: 0,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [8, 0, 0, 5, 0, 0, 0, 0],
    action2: [8, 0, 0, 7, 0, 0, 0, 0],
    damageCoefficient: 1,
    radius: 1,
    color: 0x0055ff,
    effectKey: "tk-flaming-sword",
  },
  {
    slot: 18,
    classicIndex: 4,
    name: "Fanatismo",
    shortName: "Fanatismo",
    mana: 30,
    cooldownSeconds: 1,
    range: 5,
    kind: "direct",
    target: "enemy",
    classicTargetType: 1,
    maxTargets: 1,
    instanceType: 4,
    instanceValue: 120,
    tickType: 0,
    tickValue: 0,
    affectType: 5,
    affectValue: 0,
    affectTimeSeconds: 1,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [9, 0, 0, 9, 0, 0, 0, 0],
    action2: [9, 0, 0, 9, 0, 0, 0, 0],
    damageCoefficient: 1,
    radius: 0,
    color: 0x808080,
    effectKey: "tk-fanaticism",
  },
  {
    slot: 19,
    classicIndex: 20,
    name: "Ataque da Alma",
    shortName: "Alma",
    mana: 30,
    cooldownSeconds: 3,
    range: 4,
    kind: "direct",
    target: "enemy",
    classicTargetType: 1,
    maxTargets: 1,
    instanceType: 1,
    instanceValue: 65,
    tickType: 20,
    tickValue: 2,
    affectType: 0,
    affectValue: 0,
    affectTimeSeconds: 1,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [9, 0, 0, 5, 0, 0, 0, 0],
    action2: [9, 0, 0, 5, 0, 0, 0, 0],
    damageCoefficient: 1,
    radius: 0,
    color: 0x808080,
    effectKey: "tk-soul-attack",
  },
  {
    slot: 20,
    classicIndex: 16,
    name: "Perseguição",
    shortName: "Perseguição",
    mana: 25,
    cooldownSeconds: 2,
    range: 5,
    kind: "area",
    target: "enemy",
    classicTargetType: 3,
    // SkillData announces 13, but TMFieldScene sends the primary target and
    // at most one actor in the exact cell immediately behind it.
    maxTargets: 2,
    instanceType: 0,
    instanceValue: 0,
    tickType: 0,
    tickValue: 0,
    affectType: 3,
    affectValue: 50,
    affectTimeSeconds: 1,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [6, 0, 0, 24, 0, 0, 0, 0],
    action2: [24, 0, 0, 24, 0, 0, 0, 0],
    // Damage and SlowSlash are packet-owned. The neutral coefficient keeps the
    // local combat mock playable without inventing the server formula.
    damageCoefficient: 1,
    radius: 0,
    color: 0xffffff,
    effectKey: "tk-pursuit",
  },
  {
    slot: 21,
    classicIndex: 22,
    name: "Exterminar",
    shortName: "Exterminar",
    mana: 0,
    cooldownSeconds: 15,
    range: 2,
    kind: "direct",
    target: "enemy",
    classicTargetType: 1,
    maxTargets: 1,
    instanceType: 2,
    instanceValue: 2000,
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
    // InstanceValue 2000 is server formula input, not a client multiplier.
    damageCoefficient: 1,
    radius: 0,
    color: 0xffaa44,
    effectKey: "tk-bash",
  },
  {
    slot: 22,
    classicIndex: 200,
    name: "Proteção Divina",
    shortName: "Proteção",
    mana: 300,
    cooldownSeconds: 300,
    range: 0,
    kind: "buff",
    target: "self",
    classicTargetType: 0,
    maxTargets: 1,
    instanceType: 0,
    instanceValue: 0,
    tickType: 0,
    tickValue: 0,
    affectType: 6,
    affectValue: 0,
    affectTimeSeconds: 1,
    runtimeDurationSeconds: CLASS_BUFF_DURATION_SECONDS,
    aggressive: 0,
    party: 0,
    action1: [24, 0, 0, 24, 0, 0, 0, 0],
    action2: [24, 0, 0, 24, 0, 0, 0, 0],
    damageCoefficient: 0,
    radius: 0,
    color: 0xaaaaff,
    effectKey: "tk-divine-protection",
  },
]);

/**
 * Runtime-enabled Foema records. The original catalog still exposes all
 * #24-#47; entries are promoted here only after their cast/target/VFX route is
 * implemented rather than silently falling through to a generic effect.
 */
export const FOEMA_SKILLS = defineLoadout("foema", [
  {
    slot: 9,
    classicIndex: 24,
    name: "Flecha Mágica",
    shortName: "Mágica",
    mana: 5,
    cooldownSeconds: 2,
    range: 6,
    kind: "direct",
    target: "enemy",
    classicTargetType: 1,
    maxTargets: 1,
    instanceType: 4,
    instanceValue: 15,
    tickType: 0,
    tickValue: 0,
    affectType: 0,
    affectValue: 0,
    affectTimeSeconds: 0,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [7, 0, 0, 7, 0, 0, 0, 0],
    action2: [5, 0, 0, 7, 0, 0, 0, 0],
    damageCoefficient: 1,
    radius: 0,
    color: 0xaa88ff,
    effectKey: "foema-magic-arrow",
  },
  {
    slot: 17,
    classicIndex: 28,
    name: "Choque Divino",
    shortName: "Choque",
    mana: 30,
    cooldownSeconds: 3,
    range: 5,
    kind: "direct",
    target: "enemy",
    classicTargetType: 1,
    maxTargets: 2,
    instanceType: 4,
    instanceValue: 155,
    tickType: 0,
    tickValue: 0,
    affectType: 0,
    affectValue: 0,
    affectTimeSeconds: 0,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [5, 0, 0, 5, 0, 0, 0, 0],
    action2: [5, 0, 0, 5, 0, 0, 0, 0],
    damageCoefficient: 1,
    radius: 0,
    color: 0x55eeff,
    effectKey: "foema-divine-shock",
  },
  {
    slot: 18,
    classicIndex: 26,
    name: "Flash",
    shortName: "Flash",
    mana: 40,
    cooldownSeconds: 15,
    range: 0,
    kind: "area",
    target: "self",
    classicTargetType: 4,
    maxTargets: 13,
    instanceType: 0,
    instanceValue: 0,
    tickType: 0,
    tickValue: 0,
    affectType: 41,
    affectValue: 20,
    affectTimeSeconds: 1,
    runtimeDurationSeconds: 0,
    aggressive: 0,
    party: 0,
    action1: [24, 0, 0, 6, 0, 0, 0, 0],
    action2: [6, 0, 0, 8, 0, 0, 0, 0],
    // The retail payload blinds hostile players; it never deals direct damage.
    damageCoefficient: 0,
    radius: 4,
    color: 0xffff9c,
    effectKey: "foema-flash",
  },
  {
    slot: 19,
    classicIndex: 29,
    name: "Recuperar",
    shortName: "Recuperar",
    mana: 30,
    cooldownSeconds: 3,
    range: 6,
    kind: "area",
    target: "self",
    classicTargetType: 0,
    maxTargets: 13,
    instanceType: 6,
    instanceValue: 150,
    tickType: 0,
    tickValue: 0,
    affectType: 0,
    affectValue: 0,
    affectTimeSeconds: 0,
    runtimeDurationSeconds: 0,
    aggressive: 0,
    party: 1,
    action1: [7, 0, 0, 24, 0, 0, 0, 0],
    action2: [6, 0, 0, 8, 0, 0, 0, 0],
    // Offline, the exact InstanceValue is applied to the local party member.
    damageCoefficient: 0,
    radius: 6,
    color: 0x77aaff,
    effectKey: "foema-recover",
  },
  {
    slot: 20,
    classicIndex: 30,
    name: "Julgamento Divino",
    shortName: "Julgamento",
    mana: 150,
    cooldownSeconds: 10,
    range: 1,
    kind: "area",
    target: "self",
    classicTargetType: 4,
    maxTargets: 5,
    instanceType: 4,
    instanceValue: 200,
    tickType: 0,
    tickValue: 0,
    affectType: 0,
    affectValue: 0,
    affectTimeSeconds: 0,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [24, 0, 0, 8, 0, 0, 0, 0],
    action2: [19, 0, 0, 8, 0, 0, 0, 0],
    damageCoefficient: 1,
    radius: 1,
    color: 0x333355,
    effectKey: "foema-divine-judgement",
  },
  {
    slot: 21,
    classicIndex: 27,
    name: "Cura",
    shortName: "Cura",
    mana: 15,
    cooldownSeconds: 2,
    range: 6,
    kind: "area",
    target: "self",
    classicTargetType: 2,
    maxTargets: 1,
    instanceType: 6,
    instanceValue: 100,
    tickType: 0,
    tickValue: 0,
    affectType: 0,
    affectValue: 0,
    affectTimeSeconds: 0,
    runtimeDurationSeconds: 0,
    aggressive: 0,
    party: 0,
    action1: [7, 0, 0, 24, 0, 0, 0, 0],
    action2: [24, 0, 0, 8, 0, 0, 0, 0],
    // TargetType 2 accepts self; remote ally selection remains server/UI work.
    damageCoefficient: 0,
    radius: 0,
    color: 0x77aaff,
    effectKey: "foema-heal",
  },
  {
    slot: 22,
    classicIndex: 25,
    name: "Desintoxicar",
    shortName: "Desintox.",
    mana: 12,
    cooldownSeconds: 3,
    range: 6,
    kind: "area",
    target: "self",
    classicTargetType: 2,
    maxTargets: 1,
    instanceType: 8,
    instanceValue: 0,
    tickType: 0,
    tickValue: 0,
    affectType: 0,
    affectValue: 0,
    affectTimeSeconds: 0,
    runtimeDurationSeconds: 0,
    aggressive: 0,
    party: 0,
    action1: [6, 0, 0, 24, 0, 0, 0, 0],
    action2: [24, 0, 0, 6, 0, 0, 0, 0],
    // TargetType 2 accepts self; negative-affect authority remains server-side.
    damageCoefficient: 0,
    radius: 0,
    color: 0xffffff,
    effectKey: "foema-cure",
  },
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
  {
    slot: 10,
    classicIndex: 35,
    name: "Tempestade de Meteoro",
    shortName: "Meteoro",
    mana: 25,
    cooldownSeconds: 3,
    range: 6,
    kind: "area",
    target: "enemy",
    classicTargetType: 4,
    maxTargets: 13,
    instanceType: 2,
    instanceValue: 55,
    tickType: 0,
    tickValue: 0,
    affectType: 0,
    affectValue: 0,
    affectTimeSeconds: 0,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [9, 0, 0, 7, 0, 0, 0, 0],
    action2: [7, 0, 0, 7, 0, 0, 0, 0],
    damageCoefficient: 1,
    radius: 2,
    color: 0xff7711,
    effectKey: "foema-meteor-storm",
  },
  {
    slot: 11,
    classicIndex: 39,
    name: "Inferno",
    shortName: "Inferno",
    mana: 90,
    cooldownSeconds: 5,
    range: 6,
    kind: "area",
    target: "enemy",
    classicTargetType: 6,
    maxTargets: 13,
    instanceType: 2,
    instanceValue: 400,
    tickType: 0,
    tickValue: 0,
    affectType: 0,
    affectValue: 0,
    affectTimeSeconds: 0,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [9, 0, 0, 7, 0, 0, 0, 0],
    action2: [7, 0, 0, 7, 0, 0, 0, 0],
    damageCoefficient: 1,
    radius: 3,
    color: 0xff7711,
    effectKey: "foema-inferno",
  },
  {
    slot: 12,
    classicIndex: 36,
    name: "Nevasca",
    shortName: "Nevasca",
    mana: 35,
    cooldownSeconds: 4,
    range: 6,
    kind: "direct",
    target: "enemy",
    classicTargetType: 1,
    maxTargets: 1,
    instanceType: 3,
    instanceValue: 200,
    tickType: 0,
    tickValue: 0,
    affectType: 1,
    affectValue: 2,
    affectTimeSeconds: 2,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [6, 0, 0, 7, 0, 0, 0, 0],
    action2: [6, 0, 0, 7, 0, 0, 0, 0],
    damageCoefficient: 1,
    radius: 0,
    color: 0x3366ff,
    effectKey: "foema-blizzard",
  },
  {
    slot: 13,
    classicIndex: 43,
    name: "Escudo Mágico",
    shortName: "Escudo",
    mana: 52,
    cooldownSeconds: 1,
    range: 6,
    kind: "buff",
    // SkillData target type 2 accepts self or an allied human. Party/network
    // are out of scope, so the local runtime deliberately selects self.
    target: "self",
    classicTargetType: 2,
    maxTargets: 1,
    instanceType: 0,
    instanceValue: 0,
    tickType: 0,
    tickValue: 0,
    affectType: 11,
    affectValue: 15,
    affectTimeSeconds: 15,
    runtimeDurationSeconds: CLASS_BUFF_DURATION_SECONDS,
    aggressive: 0,
    party: 0,
    action1: [24, 0, 0, 24, 0, 0, 0, 0],
    action2: [9, 0, 0, 6, 0, 0, 0, 0],
    damageCoefficient: 0,
    radius: 0,
    color: 0xff33ff,
    effectKey: "foema-magic-shield",
  },
  {
    slot: 14,
    classicIndex: 45,
    name: "Toque da Athena",
    shortName: "Athena",
    mana: 98,
    cooldownSeconds: 4,
    range: 6,
    kind: "buff",
    // Target type 2 is self/ally; self is the only honest offline target.
    target: "self",
    classicTargetType: 2,
    maxTargets: 1,
    instanceType: 0,
    instanceValue: 0,
    tickType: 0,
    tickValue: 0,
    affectType: 15,
    affectValue: 7,
    affectTimeSeconds: 15,
    runtimeDurationSeconds: CLASS_BUFF_DURATION_SECONDS,
    aggressive: 0,
    party: 0,
    action1: [19, 0, 0, 24, 0, 0, 0, 0],
    action2: [19, 0, 0, 8, 0, 0, 0, 0],
    damageCoefficient: 0,
    radius: 0,
    color: 0xffffff,
    effectKey: "foema-athena-touch",
  },
  {
    slot: 15,
    classicIndex: 46,
    name: "Controle de Mana",
    shortName: "Mana",
    mana: 130,
    cooldownSeconds: 1,
    range: 0,
    kind: "buff",
    target: "self",
    classicTargetType: 0,
    maxTargets: 1,
    instanceType: 0,
    instanceValue: 0,
    tickType: 0,
    tickValue: 0,
    affectType: 18,
    affectValue: 0,
    affectTimeSeconds: 10,
    runtimeDurationSeconds: CLASS_BUFF_DURATION_SECONDS,
    aggressive: 0,
    party: 0,
    action1: [20, 0, 0, 24, 0, 0, 0, 0],
    action2: [20, 0, 0, 8, 0, 0, 0, 0],
    damageCoefficient: 0,
    radius: 0,
    color: 0xff6633,
    effectKey: "foema-mana-control",
  },
  {
    slot: 16,
    classicIndex: 47,
    name: "Cancelamento",
    shortName: "Cancelar",
    mana: 34,
    cooldownSeconds: 15,
    range: 5,
    kind: "direct",
    target: "enemy",
    classicTargetType: 1,
    maxTargets: 1,
    instanceType: 0,
    instanceValue: 0,
    tickType: 0,
    tickValue: 0,
    affectType: 32,
    affectValue: 0,
    affectTimeSeconds: 1,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [24, 0, 0, 24, 0, 0, 0, 0],
    action2: [24, 0, 0, 24, 0, 0, 0, 0],
    // PvP cancellation has no direct-damage payload in SkillData.
    damageCoefficient: 0,
    radius: 0,
    color: 0xff2222,
    effectKey: "foema-cancellation",
  },
  {
    slot: 23,
    classicIndex: 213,
    name: "Proteção Absoluta",
    shortName: "Proteção",
    mana: 400,
    cooldownSeconds: 300,
    range: 0,
    kind: "buff",
    target: "self",
    classicTargetType: 0,
    maxTargets: 1,
    instanceType: 0,
    instanceValue: 0,
    tickType: 0,
    tickValue: 0,
    affectType: 6,
    affectValue: 0,
    affectTimeSeconds: 2,
    runtimeDurationSeconds: CLASS_BUFF_DURATION_SECONDS,
    aggressive: 0,
    party: 0,
    action1: [24, 0, 0, 24, 0, 0, 0, 0],
    action2: [24, 0, 0, 24, 0, 0, 0, 0],
    damageCoefficient: 0,
    radius: 0,
    color: 0xaaaaff,
    effectKey: "foema-absolute-protection",
  },
  {
    slot: 24,
    classicIndex: 216,
    name: "Magia Misteriosa",
    shortName: "Misteriosa",
    mana: 125,
    cooldownSeconds: 150,
    range: 0,
    kind: "buff",
    target: "self",
    classicTargetType: 0,
    maxTargets: 1,
    instanceType: 0,
    instanceValue: 0,
    tickType: 0,
    tickValue: 0,
    affectType: 42,
    affectValue: 0,
    affectTimeSeconds: 12,
    runtimeDurationSeconds: CLASS_BUFF_DURATION_SECONDS,
    aggressive: 0,
    party: 0,
    action1: [24, 0, 0, 24, 0, 0, 0, 0],
    action2: [24, 0, 0, 24, 0, 0, 0, 0],
    damageCoefficient: 0,
    radius: 0,
    color: 0xaa66ff,
    effectKey: "foema-mysterious-magic",
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
const BEASTMASTER_TRANSFORMATION_ACTIONS: Readonly<
  Record<number, readonly [ClassicActionSequence, ClassicActionSequence]>
> = {
  64: [[8, 0, 0, 8, 0, 0, 0, 0], [8, 0, 0, 8, 0, 0, 0, 0]],
  66: [[8, 0, 0, 8, 0, 0, 0, 0], [8, 0, 0, 8, 0, 0, 0, 0]],
  68: [[24, 0, 0, 8, 0, 0, 0, 0], [8, 0, 0, 8, 0, 0, 0, 0]],
  70: [[24, 0, 0, 8, 0, 0, 0, 0], [8, 0, 0, 8, 0, 0, 0, 0]],
  71: [[8, 0, 0, 2, 0, 0, 0, 0], [8, 0, 0, 2, 0, 0, 0, 0]],
};

/** BeastMaster active records #48-#55 plus nature summons #56-#63. */
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
    // Kept in the K catalog so the established summon hotkeys, notably the
    // requested Great Tiger on 9, do not move while the loadout grows.
    slot: 14,
    classicIndex: 51,
    name: "Enfraquecer",
    shortName: "Enfraq.",
    mana: 35,
    cooldownSeconds: 2,
    range: 6,
    kind: "area",
    target: "enemy",
    classicTargetType: 3,
    maxTargets: 8,
    instanceType: 0,
    instanceValue: 0,
    tickType: 0,
    tickValue: 0,
    affectType: 10,
    affectValue: 10,
    affectTimeSeconds: 5,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [6, 0, 0, 8, 0, 0, 0, 0],
    action2: [10, 0, 0, 8, 0, 0, 0, 0],
    damageCoefficient: 0,
    radius: 1,
    color: 0x5599aa,
    effectKey: "beastmaster-weaken",
  },
  {
    slot: 15,
    classicIndex: 52,
    name: "Fúria de Gaia",
    shortName: "Gaia",
    mana: 25,
    cooldownSeconds: 3,
    range: 4,
    kind: "direct",
    target: "enemy",
    classicTargetType: 1,
    maxTargets: 1,
    instanceType: 4,
    instanceValue: 220,
    tickType: 0,
    tickValue: 0,
    affectType: 0,
    affectValue: 0,
    affectTimeSeconds: 0,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [5, 7, 0, 8, 0, 0, 0, 0],
    action2: [5, 7, 0, 8, 0, 0, 0, 0],
    damageCoefficient: 1,
    radius: 0,
    color: 0xaaaaaa,
    effectKey: "beastmaster-gaia-fury",
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
  {
    slot: 16,
    classicIndex: 55,
    name: "Espírito Vingador",
    shortName: "Vingador",
    mana: 50,
    cooldownSeconds: 4,
    range: 6,
    kind: "area",
    target: "enemy",
    classicTargetType: 4,
    maxTargets: 5,
    instanceType: 4,
    instanceValue: 220,
    tickType: 0,
    tickValue: 0,
    affectType: 0,
    affectValue: 0,
    affectTimeSeconds: 0,
    runtimeDurationSeconds: 0,
    aggressive: 1,
    party: 0,
    action1: [5, 7, 0, 8, 0, 0, 0, 0],
    action2: [5, 7, 0, 8, 0, 0, 0, 0],
    damageCoefficient: 1,
    radius: 2,
    color: 0x3333ff,
    effectKey: "beastmaster-vengeful-spirit",
  },
  {
    slot: 17,
    classicIndex: 224,
    name: "Anti Magia",
    shortName: "Anti Magia",
    mana: 255,
    cooldownSeconds: 150,
    range: 0,
    kind: "buff",
    target: "self",
    classicTargetType: 0,
    maxTargets: 1,
    instanceType: 0,
    instanceValue: 0,
    tickType: 0,
    tickValue: 0,
    affectType: 43,
    affectValue: 0,
    affectTimeSeconds: 1,
    runtimeDurationSeconds: CLASS_BUFF_DURATION_SECONDS,
    aggressive: 0,
    party: 0,
    action1: [24, 0, 0, 24, 0, 0, 0, 0],
    action2: [24, 0, 0, 24, 0, 0, 0, 0],
    damageCoefficient: 0,
    radius: 0,
    color: 0x6688aa,
    effectKey: "beastmaster-anti-magic",
  },
  {
    slot: 18,
    classicIndex: 225,
    name: "Chama Resistente",
    shortName: "Chama",
    mana: 600,
    cooldownSeconds: 10,
    range: 0,
    kind: "buff",
    target: "self",
    classicTargetType: 0,
    maxTargets: 1,
    instanceType: 0,
    instanceValue: 0,
    tickType: 46,
    tickValue: 100,
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
    color: 0xff6633,
    effectKey: "beastmaster-resistant-flame",
  },
  {
    slot: 19,
    classicIndex: 235,
    name: "Last Resistance",
    shortName: "Resistência",
    mana: 500,
    cooldownSeconds: 300,
    range: 0,
    kind: "buff",
    target: "self",
    classicTargetType: 0,
    maxTargets: 1,
    instanceType: 0,
    instanceValue: 0,
    tickType: 0,
    tickValue: 0,
    affectType: 48,
    affectValue: 15,
    affectTimeSeconds: 1,
    runtimeDurationSeconds: CLASS_BUFF_DURATION_SECONDS,
    aggressive: 0,
    party: 0,
    action1: [24, 0, 0, 24, 0, 0, 0, 0],
    action2: [24, 0, 0, 24, 0, 0, 0, 0],
    damageCoefficient: 0,
    radius: 0,
    color: 0xaa8866,
    effectKey: "beastmaster-last-resistance",
  },
  ...BEAST_MASTER_TRANSFORMATIONS.map((transformation, index): ClassSkillDefinition => {
    const [action1, action2] = BEASTMASTER_TRANSFORMATION_ACTIONS[transformation.classicIndex]!;
    return {
      slot: 20 + index,
      classicIndex: transformation.classicIndex,
      name: transformation.name,
      shortName: transformation.name,
      mana: transformation.mana,
      cooldownSeconds: transformation.cooldownSeconds,
      range: 0,
      kind: "buff",
      target: "self",
      classicTargetType: 0,
      maxTargets: 1,
      instanceType: 0,
      instanceValue: 0,
      tickType: 0,
      tickValue: 0,
      affectType: transformation.affectType,
      affectValue: transformation.affectValue,
      affectTimeSeconds: transformation.affectTimeSeconds,
      runtimeDurationSeconds: CLASS_BUFF_DURATION_SECONDS,
      aggressive: 0,
      party: 0,
      action1,
      action2,
      damageCoefficient: 0,
      radius: 0,
      color: transformation.classicIndex === 70 ? 0xd6a358 : 0x9a6649,
      effectKey: `beastmaster-transformation-${transformation.key}`,
    };
  }),
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
  73: classicRecord(0, 0, 0, 0, 0, 0, 0, 0, [16, 0, 0, 8, 0, 0, 0, 0], [10, 0, 0, 8, 0, 0, 0, 0], 0, 1, 0),
  75: classicRecord(0, 0, 0, 0, 0, 27, 1, 12, [8, 0, 0, 7, 0, 0, 0, 0], [9, 0, 0, 7, 0, 0, 0, 0], 0, 1, 0),
  76: classicRecord(0, 0, 0, 0, 0, 19, 15, 12, [20, 0, 0, 9, 0, 0, 0, 0], [19, 0, 0, 8, 0, 0, 0, 0], 0, 1, 0),
  77: classicRecord(0, 0, 0, 0, 0, 21, 10, 12, [20, 0, 0, 9, 0, 0, 0, 0], [20, 0, 0, 8, 0, 0, 0, 0], 0, 1, 0),
  79: classicRecord(6, 1, 750, 0, 0, 0, 0, 0, [7, 0, 0, 9, 0, 0, 0, 0], [9, 0, 0, 8, 0, 0, 0, 0], 1, 6, 0),
  80: classicRecord(1, 1, 30, 0, 0, 0, 0, 0, [9, 0, 0, 7, 0, 0, 0, 0], [8, 0, 0, 7, 0, 0, 0, 0], 1, 1, 0),
  81: classicRecord(0, 0, 0, 0, 0, 37, 0, 14, [8, 0, 0, 7, 0, 0, 0, 0], [9, 0, 0, 7, 0, 0, 0, 0], 0, 1, 0),
  83: classicRecord(0, 0, 0, 0, 0, 0, 0, 0, [10, 0, 0, 16, 0, 0, 0, 0], [14, 0, 0, 8, 0, 0, 0, 0], 0, 1, 0),
  84: classicRecord(0, 0, 0, 0, 0, 0, 0, 0, [10, 0, 0, 16, 0, 0, 0, 0], [14, 0, 0, 8, 0, 0, 0, 0], 0, 1, 0),
  85: classicRecord(0, 0, 0, 0, 0, 31, 150, 30, [20, 0, 0, 24, 0, 0, 0, 0], [20, 0, 0, 8, 0, 0, 0, 0], 0, 1, 0),
  86: classicRecord(5, 1, 50, 0, 0, 0, 0, 0, [7, 0, 0, 9, 0, 0, 0, 0], [9, 0, 0, 8, 0, 0, 0, 0], 1, 13, 0),
  87: classicRecord(0, 0, 160, 0, 0, 38, 0, 14, [8, 0, 0, 7, 0, 0, 0, 0], [9, 0, 0, 7, 0, 0, 0, 0], 0, 1, 0),
  88: classicRecord(1, 1, 30, 0, 0, 0, 0, 0, [9, 0, 0, 7, 0, 0, 0, 0], [24, 0, 0, 7, 0, 0, 0, 0], 1, 1, 0),
  89: classicRecord(0, 0, 0, 0, 0, 26, 1, 12, [8, 0, 0, 7, 0, 0, 0, 0], [9, 0, 0, 7, 0, 0, 0, 0], 0, 1, 0),
  92: classicRecord(0, 0, 0, 0, 0, 36, 1, 12, [8, 0, 0, 7, 0, 0, 0, 0], [9, 0, 0, 7, 0, 0, 0, 0], 0, 1, 0),
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
  readonly instanceType: number;
  readonly instanceValue: number;
  readonly tickType: number;
  readonly tickValue: number;
  readonly affectType: number;
  readonly affectValue: number;
  readonly durationSeconds: number;
  readonly remainingSeconds: number;
  /** Renderer dispatch key when a faithful implementation already exists. */
  readonly effectKey: string | null;
}

/**
 * Complete client-side metadata required to grant a buff outside the active
 * class loadout (NPCs, packets or a later server bridge). The effect fields
 * preserve SkillData semantics; this type intentionally does not define any
 * stat formula or VFX fallback.
 */
export interface ExternalClassBuffGrant {
  readonly classKey: ClassicClassKey;
  readonly classicIndex: number;
  readonly name: string;
  readonly iconIndex: number;
  readonly instanceType: number;
  readonly instanceValue: number;
  readonly tickType: number;
  readonly tickValue: number;
  readonly affectType: number;
  readonly affectValue: number;
  readonly durationSeconds: number;
  readonly effectKey?: string | null;
}

interface MutableClassBuffState {
  readonly buff: Readonly<ExternalClassBuffGrant>;
  remainingSeconds: number;
}

export type ClassSkillStartResult =
  | { readonly ok: true; readonly skill: ClassSkill }
  | {
    readonly ok: false;
    readonly skill: ClassSkill | null;
    readonly reason: "invalid" | "cooldown" | "mana";
  };

/** Shared cooldown plus native and externally granted buff state. */
export class ClassSkillSystem {
  readonly classKey: ClassicClassKey;
  readonly skills: readonly ClassSkill[];
  readonly #bySlot = new Map<number, ClassSkill>();
  readonly #remaining = new Map<number, number>();
  readonly #buffs = new Map<number, MutableClassBuffState>();

  constructor(
    classKey: ClassicClassKey = "huntress",
    inheritedBuffs: readonly ActiveClassBuff[] = [],
  ) {
    this.classKey = classKey;
    this.skills = CLASS_SKILL_LOADOUTS[classKey];
    for (const skill of this.skills) this.#bySlot.set(skill.slot, skill);
    this.importBuffs(inheritedBuffs);
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
    if (
      loadoutSkill !== skill
      || skill.kind !== "buff"
      || !Number.isFinite(skill.runtimeDurationSeconds)
      || skill.runtimeDurationSeconds <= 0
    ) return null;
    return this.grantExternalBuff({
      classKey: skill.classKey,
      classicIndex: skill.classicIndex,
      name: skill.name,
      iconIndex: skill.classicIndex,
      instanceType: skill.instanceType,
      instanceValue: skill.instanceValue,
      tickType: skill.tickType,
      tickValue: skill.tickValue,
      affectType: skill.affectType,
      affectValue: skill.affectValue,
      durationSeconds: skill.runtimeDurationSeconds,
      effectKey: skill.effectKey,
    });
  }

  /** Grants or refreshes one externally described buff at its full duration. */
  grantExternalBuff(grant: ExternalClassBuffGrant): ActiveClassBuff | null {
    return this.storeExternalBuff(grant, grant.durationSeconds);
  }

  /** Grants a batch while retaining the deterministic input order. */
  grantExternalBuffs(grants: readonly ExternalClassBuffGrant[]): readonly ActiveClassBuff[] {
    const activated: ActiveClassBuff[] = [];
    for (const grant of grants) {
      const buff = this.grantExternalBuff(grant);
      if (buff) activated.push(buff);
    }
    return activated;
  }

  /** Immutable transfer snapshot used when the playable class is replaced. */
  exportBuffs(): readonly ActiveClassBuff[] {
    return this.activeBuffs();
  }

  /**
   * Restores buffs with their remaining time. Existing entries with the same
   * classic index are replaced; unrelated entries remain active.
   */
  importBuffs(buffs: readonly ActiveClassBuff[]): readonly ActiveClassBuff[] {
    const imported: ActiveClassBuff[] = [];
    for (const buff of buffs) {
      const restored = this.storeExternalBuff(buff, buff.remainingSeconds);
      if (restored) imported.push(restored);
    }
    return imported;
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

  private storeExternalBuff(
    grant: ExternalClassBuffGrant,
    remainingSeconds: number,
  ): ActiveClassBuff | null {
    if (!isValidExternalBuff(grant) || !Number.isFinite(remainingSeconds) || remainingSeconds <= 0) {
      return null;
    }
    const existing = this.#buffs.get(grant.classicIndex);
    // A native 180-second recast must not shorten the same buff granted by an
    // external source for longer (for example Mestre Carb's 900 seconds).
    // It may still refresh a nearly expired long buff up to its native time.
    const durationSeconds = Math.max(
      0,
      grant.durationSeconds,
      existing?.buff.durationSeconds ?? 0,
    );
    const normalizedRemaining = Math.min(
      durationSeconds,
      Math.max(0, remainingSeconds, existing?.remainingSeconds ?? 0),
    );
    const normalized: Readonly<ExternalClassBuffGrant> = Object.freeze({
      classKey: grant.classKey,
      classicIndex: Math.trunc(grant.classicIndex),
      name: grant.name.trim(),
      iconIndex: Math.trunc(grant.iconIndex),
      instanceType: Math.trunc(grant.instanceType),
      instanceValue: grant.instanceValue,
      tickType: Math.trunc(grant.tickType),
      tickValue: grant.tickValue,
      affectType: Math.trunc(grant.affectType),
      affectValue: grant.affectValue,
      durationSeconds,
      effectKey: grant.effectKey ?? existing?.buff.effectKey ?? null,
    });
    this.#buffs.set(normalized.classicIndex, {
      buff: normalized,
      remainingSeconds: normalizedRemaining,
    });
    return this.buff(normalized.classicIndex);
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
    classKey: state.buff.classKey,
    classicIndex: state.buff.classicIndex,
    name: state.buff.name,
    iconIndex: state.buff.iconIndex,
    instanceType: state.buff.instanceType,
    instanceValue: state.buff.instanceValue,
    tickType: state.buff.tickType,
    tickValue: state.buff.tickValue,
    affectType: state.buff.affectType,
    affectValue: state.buff.affectValue,
    durationSeconds: state.buff.durationSeconds,
    remainingSeconds: state.remainingSeconds,
    effectKey: state.buff.effectKey ?? null,
  };
}

function isValidExternalBuff(grant: ExternalClassBuffGrant): boolean {
  return (
    (grant.classKey === "transknight"
      || grant.classKey === "foema"
      || grant.classKey === "beastmaster"
      || grant.classKey === "huntress")
    && Number.isInteger(grant.classicIndex)
    && grant.classicIndex >= 0
    && typeof grant.name === "string"
    && grant.name.trim().length > 0
    && Number.isInteger(grant.iconIndex)
    && grant.iconIndex >= 0
    && Number.isFinite(grant.instanceType)
    && Number.isFinite(grant.instanceValue)
    && Number.isFinite(grant.tickType)
    && Number.isFinite(grant.tickValue)
    && Number.isFinite(grant.affectType)
    && Number.isFinite(grant.affectValue)
    && Number.isFinite(grant.durationSeconds)
    && grant.durationSeconds > 0
  );
}
