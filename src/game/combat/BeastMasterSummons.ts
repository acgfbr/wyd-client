import type { MonsterVisualFamily } from "../npcs/MonsterCatalog";

export type BeastMasterSummonSkillIndex = 56 | 57 | 58 | 59 | 60 | 61 | 62 | 63;
export type BeastMasterSummonKey =
  | "condor"
  | "javali-selvagem"
  | "lobo-selvagem"
  | "urso-selvagem"
  | "grande-tigre"
  | "gorila-gigante"
  | "dragao-negro"
  | "succubus";
export type BeastMasterSummonAlphaMode = "A" | "C" | "N";

export interface BeastMasterSummonSkillDefinition {
  readonly classicIndex: BeastMasterSummonSkillIndex;
  readonly itemIndex: number;
  readonly mastery: 2;
  readonly masterySlot: number;
  readonly requiredSkillPoints: number;
  readonly mana: number;
  readonly cooldownSeconds: number;
  readonly targetType: 0;
  readonly instanceType: 11;
  readonly instanceValue: number;
  readonly maxTarget: 1;
  readonly aggressive: false;
  /** SkillData stores zero here; the authoritative lifetime belongs to the server. */
  readonly durationSeconds: null;
}

export interface BeastMasterSummonPartDefinition {
  readonly part: number;
  readonly name: string;
  readonly meshStem: string;
  readonly textureStem: string;
  readonly alpha: BeastMasterSummonAlphaMode;
  readonly mesh: string;
  readonly texture: string;
}

export interface BeastMasterSummonFamilyDefinition {
  readonly base: string;
  readonly actionSet: string;
  readonly declaredParts: number;
  readonly meshParts: readonly number[];
  readonly skeletonStem: string;
  /** ValidIndex order, not a guessed contiguous filename range. */
  readonly animationStems: readonly string[];
  readonly visual: MonsterVisualFamily;
}

export interface BeastMasterSummonDefinition {
  readonly key: BeastMasterSummonKey;
  readonly name: string;
  readonly skill: BeastMasterSummonSkillDefinition;
  /** ItemList entry equipped in LOOK_INFO to build the summoned creature. */
  readonly visualItemIndex: number;
  /** ItemList EFFECT_CLASS and BASE_DefineSkinMeshType input/output. */
  readonly itemClass: number;
  readonly skin: number;
  readonly meshIndex: number;
  readonly textureIndex: number;
  readonly pickSize: readonly [radius: number, height: number];
  readonly family: BeastMasterSummonFamilyDefinition;
  readonly parts: readonly BeastMasterSummonPartDefinition[];
  readonly source: string;
}

type ClassicActionTable = Readonly<Record<string, readonly [clip: number, fps: number, sound: number]>>;

export const BEAST_MASTER_SUMMON_ACTIONS = Object.freeze([
  "STAND01", "STAND02", "WALK", "RUN",
  "ATTACK1", "ATTACK2", "ATTACK3",
  "SKILL01", "SKILL02", "SKILL03",
  "STRIKE", "DIE", "DEAD", "LEVELUP",
] as const);

const EAGLE_ACTIONS = actions({
  STAND01: [2, 20, 0], STAND02: [2, 20, 0], WALK: [1, 15, 0], RUN: [2, 20, 0],
  ATTACK1: [0, 20, 205], ATTACK2: [5, 20, 206], ATTACK3: [5, 20, 206],
  SKILL01: [0, 20, 0], SKILL02: [5, 20, 0], SKILL03: [5, 20, 0],
  STRIKE: [1, 20, 204], DIE: [3, 20, 207], DEAD: [4, 20, 0], LEVELUP: [0, 20, 0],
});
const BOAR_ACTIONS = actions({
  STAND01: [0, 30, 0], STAND02: [0, 30, 0], WALK: [1, 15, 0], RUN: [1, 10, 0],
  ATTACK1: [2, 20, 201], ATTACK2: [2, 20, 202], ATTACK3: [2, 20, 202],
  SKILL01: [2, 20, 0], SKILL02: [2, 20, 0], SKILL03: [2, 20, 0],
  STRIKE: [0, 20, 200], DIE: [3, 20, 203], DEAD: [4, 20, 0], LEVELUP: [0, 20, 0],
});
const WOLF_ACTIONS = actions({
  STAND01: [0, 30, 0], STAND02: [0, 30, 0], WALK: [1, 15, 0], RUN: [1, 5, 0],
  ATTACK1: [2, 20, 245], ATTACK2: [2, 20, 245], ATTACK3: [2, 20, 245],
  SKILL01: [2, 20, 245], SKILL02: [2, 20, 245], SKILL03: [2, 20, 245],
  STRIKE: [3, 20, 247], DIE: [4, 20, 248], DEAD: [5, 20, 0], LEVELUP: [0, 20, 249],
});
const BEAR_ACTIONS = actions({
  STAND01: [0, 30, 0], STAND02: [0, 30, 0], WALK: [1, 15, 0], RUN: [8, 10, 0],
  ATTACK1: [2, 20, 250], ATTACK2: [3, 20, 251], ATTACK3: [4, 20, 251],
  SKILL01: [2, 20, 250], SKILL02: [3, 20, 251], SKILL03: [4, 20, 251],
  STRIKE: [5, 20, 252], DIE: [6, 20, 253], DEAD: [7, 20, 0], LEVELUP: [0, 20, 274],
});
const MONKEY_ACTIONS = actions({
  STAND01: [0, 30, 0], STAND02: [0, 30, 0], WALK: [1, 20, 0], RUN: [1, 10, 0],
  ATTACK1: [2, 20, 0], ATTACK2: [3, 20, 143], ATTACK3: [3, 20, 143],
  SKILL01: [2, 20, 142], SKILL02: [3, 20, 143], SKILL03: [3, 20, 143],
  STRIKE: [4, 20, 145], DIE: [5, 20, 144], DEAD: [6, 20, 0], LEVELUP: [0, 20, 0],
});
const DRAGON_ACTIONS = actions({
  STAND01: [0, 30, 0], STAND02: [0, 30, 79], WALK: [1, 17, 0], RUN: [2, 20, 76],
  ATTACK1: [3, 22, 78], ATTACK2: [4, 30, 78], ATTACK3: [4, 30, 78],
  SKILL01: [4, 30, 0], SKILL02: [4, 30, 0], SKILL03: [4, 30, 0],
  STRIKE: [5, 22, 0], DIE: [6, 30, 80], DEAD: [7, 15, 0], LEVELUP: [0, 25, 0],
});
const SNOW_QUEEN_ACTIONS = actions({
  STAND01: [0, 20, 0], STAND02: [0, 20, 0], WALK: [1, 20, 0], RUN: [2, 20, 0],
  ATTACK1: [4, 17, 359], ATTACK2: [5, 17, 359], ATTACK3: [3, 17, 359],
  SKILL01: [6, 17, 362], SKILL02: [6, 17, 362], SKILL03: [7, 17, 362],
  STRIKE: [8, 15, 360], DIE: [9, 22, 361], DEAD: [10, 15, 0], LEVELUP: [7, 25, 362],
});

const EAGLE = family("bd01", "eagle", 1, [1], contiguousAnimations("bd01", 6), EAGLE_ACTIONS);
const BOAR = family("bo01", "boar", 2, [1, 2], contiguousAnimations("bo01", 5), BOAR_ACTIONS);
const WOLF = family("wf01", "wolf", 2, [1, 2], contiguousAnimations("wf01", 6), WOLF_ACTIONS);
const BEAR = family("be01", "bear", 2, [1, 2], contiguousAnimations("be01", 9), BEAR_ACTIONS);
const MONKEY = family("mo01", "monkey", 8, [1, 2], contiguousAnimations("mo01", 7), MONKEY_ACTIONS);
const DRAGON = family("dr01", "Dragon", 2, [1, 2], contiguousAnimations("dr01", 8), DRAGON_ACTIONS);
const SNOW_QUEEN = family(
  "sq01",
  "snowqueen",
  8,
  [1, 2],
  [
    ...contiguousAnimations("sq01", 11, 100),
    ...contiguousAnimations("sq01", 11, 200),
  ],
  SNOW_QUEEN_ACTIONS,
);

/**
 * The eight nature summons reconstructed from SkillData.bin, ItemList.bin,
 * BASE_DefineSkinMeshType, BoneAni4, ValidIndex and AniSound4. No lifetime is
 * invented here: the classic client treats them as server-owned TMHuman nodes.
 */
export const BEAST_MASTER_SUMMONS: readonly BeastMasterSummonDefinition[] = Object.freeze([
  summon({
    key: "condor", name: "Condor", classicIndex: 56, itemIndex: 206,
    masterySlot: 1, requiredSkillPoints: 33, mana: 30, cooldownSeconds: 6,
    instanceValue: 1, itemClass: 20, skin: 24, meshIndex: 0, textureIndex: 0,
    pickSize: [0.4, 1], family: EAGLE,
    parts: [part("bd01", 1, "corpo", "bd010101", "bd010101", "A")],
  }),
  summon({
    key: "javali-selvagem", name: "Javali Selvagem", classicIndex: 57, itemIndex: 216,
    masterySlot: 2, requiredSkillPoints: 51, mana: 55, cooldownSeconds: 6,
    instanceValue: 2, itemClass: 22, skin: 25, meshIndex: 0, textureIndex: 0,
    pickSize: [0.7, 1], family: BOAR,
    parts: sharedTwoParts("bo01", "01", "bo010101", "N"),
  }),
  summon({
    key: "lobo-selvagem", name: "Lobo Selvagem", classicIndex: 58, itemIndex: 226,
    masterySlot: 3, requiredSkillPoints: 72, mana: 75, cooldownSeconds: 5,
    instanceValue: 3, itemClass: 27, skin: 28, meshIndex: 0, textureIndex: 0,
    pickSize: [0.7, 1], family: WOLF,
    parts: sharedTwoParts("wf01", "01", "wf010101", "N"),
  }),
  summon({
    key: "urso-selvagem", name: "Urso Selvagem", classicIndex: 59, itemIndex: 227,
    masterySlot: 4, requiredSkillPoints: 72, mana: 90, cooldownSeconds: 6,
    instanceValue: 4, itemClass: 28, skin: 29, meshIndex: 0, textureIndex: 0,
    pickSize: [0.7, 1], family: BEAR,
    parts: sharedTwoParts("be01", "01", "be010101", "N"),
  }),
  summon({
    key: "grande-tigre", name: "Grande Tigre", classicIndex: 60, itemIndex: 244,
    masterySlot: 5, requiredSkillPoints: 84, mana: 120, cooldownSeconds: 15,
    instanceValue: 5, itemClass: 35, skin: 29, meshIndex: 1, textureIndex: 0,
    pickSize: [0.7, 1], family: BEAR,
    parts: sharedTwoParts("be01", "02", "be010102", "N"),
  }),
  summon({
    key: "gorila-gigante", name: "Gorila Gigante", classicIndex: 61, itemIndex: 245,
    masterySlot: 6, requiredSkillPoints: 93, mana: 130, cooldownSeconds: 20,
    instanceValue: 6, itemClass: 32, skin: 7, meshIndex: 0, textureIndex: 0,
    pickSize: [1, 2], family: MONKEY,
    parts: sharedTwoParts("mo01", "01", "mo010101", "N"),
  }),
  summon({
    key: "dragao-negro", name: "Dragão Negro", classicIndex: 62, itemIndex: 307,
    masterySlot: 7, requiredSkillPoints: 102, mana: 155, cooldownSeconds: 18,
    instanceValue: 7, itemClass: 16, skin: 20, meshIndex: 0, textureIndex: 1,
    pickSize: [1.2, 2.2], family: DRAGON,
    parts: sharedTwoParts("dr01", "01", "dr010102", "N"),
  }),
  summon({
    key: "succubus", name: "Succubus", classicIndex: 63, itemIndex: 396,
    masterySlot: 8, requiredSkillPoints: 220, mana: 240, cooldownSeconds: 23,
    instanceValue: 8, itemClass: 62, skin: 5, meshIndex: 2, textureIndex: 0,
    pickSize: [0.4, 2.5], family: SNOW_QUEEN,
    parts: [
      part("sq01", 1, "corpo", "sq010103", "sq010103", "C"),
      part("sq01", 2, "acessórios", "sq010203", "sq010203", "C"),
    ],
  }),
]);

const summonBySkill = new Map(BEAST_MASTER_SUMMONS.map((definition) => [definition.skill.classicIndex, definition]));

export function beastMasterSummonForSkill(classicIndex: number): BeastMasterSummonDefinition | null {
  return summonBySkill.get(classicIndex as BeastMasterSummonSkillIndex) ?? null;
}

interface SummonInput {
  readonly key: BeastMasterSummonKey;
  readonly name: string;
  readonly classicIndex: BeastMasterSummonSkillIndex;
  readonly itemIndex: number;
  readonly masterySlot: number;
  readonly requiredSkillPoints: number;
  readonly mana: number;
  readonly cooldownSeconds: number;
  readonly instanceValue: number;
  readonly itemClass: number;
  readonly skin: number;
  readonly meshIndex: number;
  readonly textureIndex: number;
  readonly pickSize: readonly [number, number];
  readonly family: BeastMasterSummonFamilyDefinition;
  readonly parts: readonly BeastMasterSummonPartDefinition[];
}

function summon(input: SummonInput): BeastMasterSummonDefinition {
  return Object.freeze({
    key: input.key,
    name: input.name,
    skill: Object.freeze({
      classicIndex: input.classicIndex,
      itemIndex: 5000 + input.classicIndex,
      mastery: 2,
      masterySlot: input.masterySlot,
      requiredSkillPoints: input.requiredSkillPoints,
      mana: input.mana,
      cooldownSeconds: input.cooldownSeconds,
      targetType: 0,
      instanceType: 11,
      instanceValue: input.instanceValue,
      maxTarget: 1,
      aggressive: false,
      durationSeconds: null,
    }),
    visualItemIndex: input.itemIndex,
    itemClass: input.itemClass,
    skin: input.skin,
    meshIndex: input.meshIndex,
    textureIndex: input.textureIndex,
    pickSize: input.pickSize,
    family: input.family,
    parts: Object.freeze(input.parts),
    source: `SkillData ${input.classicIndex}; ItemList ${input.itemIndex}; skin ${input.skin}`,
  });
}

function family(
  base: string,
  actionSet: string,
  declaredParts: number,
  meshParts: readonly number[],
  animationStems: readonly string[],
  actionTable: ClassicActionTable,
): BeastMasterSummonFamilyDefinition {
  const root = `player/summons/${base}`;
  return Object.freeze({
    base,
    actionSet,
    declaredParts,
    meshParts,
    skeletonStem: base,
    animationStems,
    visual: Object.freeze({
      base,
      declaredParts,
      meshParts,
      skeleton: `${root}/${base}.bon`,
      clips: animationStems.map((stem) => `${root}/${stem}.ani`),
      actionSet,
      actions: actionTable,
    }),
  });
}

function actions<const T extends ClassicActionTable>(table: T): T {
  return Object.freeze(table);
}

function contiguousAnimations(base: string, count: number, hundred = 100): readonly string[] {
  return Object.freeze(Array.from(
    { length: count },
    (_, index) => `${base}${String(hundred + index + 1).padStart(4, "0")}`,
  ));
}

function sharedTwoParts(
  base: string,
  meshVariant: string,
  textureStem: string,
  alpha: BeastMasterSummonAlphaMode,
): readonly BeastMasterSummonPartDefinition[] {
  return [
    part(base, 1, "corpo", `${base}01${meshVariant}`, textureStem, alpha),
    part(base, 2, "membros", `${base}02${meshVariant}`, textureStem, alpha),
  ];
}

function part(
  base: string,
  partIndex: number,
  name: string,
  meshStem: string,
  textureStem: string,
  alpha: BeastMasterSummonAlphaMode,
): BeastMasterSummonPartDefinition {
  const root = `player/summons/${base}`;
  return Object.freeze({
    part: partIndex,
    name,
    meshStem,
    textureStem,
    alpha,
    mesh: `${root}/${meshStem}.msh`,
    texture: `${root}/${textureStem}.dds`,
  });
}
