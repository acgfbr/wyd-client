import type { MonsterVisualFamily } from "../npcs/MonsterCatalog";

export type BeastMasterTransformationSkillIndex = 64 | 66 | 68 | 70 | 71;
export type BeastMasterTransformationKey =
  | "lobisomem"
  | "homem-urso"
  | "astaroth"
  | "tita"
  | "eden";

export interface BeastMasterTransformationDefinition {
  readonly key: BeastMasterTransformationKey;
  readonly name: string;
  readonly classicIndex: BeastMasterTransformationSkillIndex;
  readonly skillItemIndex: number;
  readonly mana: number;
  readonly cooldownSeconds: number;
  readonly affectType: 16 | 21;
  readonly affectValue: number;
  readonly affectTimeSeconds: number;
  readonly itemClass: number;
  readonly skin: 44 | 45 | 47 | 53 | 54;
  readonly scale: number;
  readonly family: MonsterVisualFamily;
  readonly parts: readonly {
    readonly part: number;
    readonly name: string;
    readonly mesh: string;
    readonly texture: string | null;
    readonly alpha: "A" | "C" | "N";
  }[];
  readonly source: string;
}

export const BEAST_MASTER_TRANSFORMATION_ACTIONS = Object.freeze([
  "STAND01", "STAND02", "WALK", "RUN",
  "ATTACK1", "ATTACK2", "ATTACK3",
  "SKILL01", "SKILL02", "SKILL03",
  "STRIKE", "DIE", "DEAD", "LEVELUP",
] as const);

type ClassicActionTable = Readonly<Record<string, readonly [clip: number, quarterStepMs: number, sound: number]>>;

const BALROG_ACTIONS = actions({
  STAND01: [0, 30, 0], STAND02: [0, 30, 0], WALK: [1, 15, 0], RUN: [1, 40, 0],
  ATTACK1: [2, 15, 292], ATTACK2: [2, 15, 292], ATTACK3: [2, 15, 292],
  SKILL01: [2, 15, 292], SKILL02: [2, 15, 292], SKILL03: [2, 15, 292],
  STRIKE: [2, 15, 310], DIE: [3, 30, 293], DEAD: [0, 15, 0], LEVELUP: [0, 15, 294],
});
const LEGEND_BERIEL_ACTIONS = actions({
  STAND01: [0, 15, 0], STAND02: [0, 15, 0], WALK: [1, 5, 0], RUN: [1, 5, 0],
  ATTACK1: [2, 13, 292], ATTACK2: [3, 13, 292], ATTACK3: [2, 13, 292],
  SKILL01: [4, 13, 292], SKILL02: [4, 13, 292], SKILL03: [4, 13, 292],
  STRIKE: [5, 15, 310], DIE: [6, 20, 293], DEAD: [7, 30, 0], LEVELUP: [0, 15, 294],
});
const GA_REA_DDOK_ACTIONS = actions({
  STAND01: [0, 7, 0], STAND02: [0, 7, 0], WALK: [0, 7, 0], RUN: [0, 7, 0],
  ATTACK1: [1, 4, 292], ATTACK2: [2, 7, 292], ATTACK3: [1, 4, 292],
  SKILL01: [1, 4, 292], SKILL02: [2, 7, 292], SKILL03: [1, 4, 292],
  STRIKE: [3, 7, 310], DIE: [4, 9, 293], DEAD: [5, 9, 0], LEVELUP: [0, 15, 294],
});
const SCORPION_ACTIONS = actions({
  STAND01: [0, 10, 0], STAND02: [0, 10, 0], WALK: [1, 10, 0], RUN: [1, 10, 0],
  ATTACK1: [3, 20, 201], ATTACK2: [3, 20, 202], ATTACK3: [3, 20, 202],
  SKILL01: [0, 20, 0], SKILL02: [0, 20, 0], SKILL03: [0, 20, 0],
  STRIKE: [2, 20, 200], DIE: [4, 20, 75], DEAD: [5, 20, 0], LEVELUP: [5, 20, 0],
});
const MURMY_ACTIONS = actions({
  STAND01: [0, 10, 0], STAND02: [0, 10, 0], WALK: [1, 10, 0], RUN: [1, 10, 0],
  ATTACK1: [4, 20, 201], ATTACK2: [3, 20, 202], ATTACK3: [3, 20, 202],
  SKILL01: [0, 20, 0], SKILL02: [0, 20, 0], SKILL03: [0, 20, 0],
  STRIKE: [2, 20, 200], DIE: [4, 20, 75], DEAD: [5, 20, 0], LEVELUP: [5, 20, 0],
});

/**
 * SkillData + BASE_DefineSkinMeshType + BoneAni4 + ValidIndex + AniSound4.
 * These are player form rigs: they are intentionally independent from the
 * NPC generator catalog, where none of the five skins is guaranteed to occur.
 */
export const BEAST_MASTER_TRANSFORMATIONS: readonly BeastMasterTransformationDefinition[] = Object.freeze([
  transformation({
    key: "lobisomem", name: "Lobisomem", classicIndex: 64, mana: 72,
    affectType: 21, affectValue: 1, affectTimeSeconds: 13,
    itemClass: 64, skin: 44, scale: 0.9,
    family: family("bl01", "BALROG", 4, 4, BALROG_ACTIONS),
    parts: sharedTextureParts("bl01", 4, "bl010101", "N"),
  }),
  transformation({
    key: "homem-urso", name: "Homem Urso", classicIndex: 66, mana: 144,
    affectType: 16, affectValue: 2, affectTimeSeconds: 11,
    itemClass: 66, skin: 45, scale: 0.9,
    family: family("lb01", "LEGEND_BERIEL", 3, 8, LEGEND_BERIEL_ACTIONS),
    // LB010301 has no WYS/WYT entry in the retail package or MeshTextureList.
    // The third sanction piece is therefore intentionally material-only.
    parts: [
      ...individualTextureParts("lb01", 2, "C"),
      part("lb01", 3, null, "C"),
    ],
  }),
  transformation({
    key: "astaroth", name: "Astaroth", classicIndex: 68, mana: 260,
    affectType: 16, affectValue: 3, affectTimeSeconds: 13,
    itemClass: 68, skin: 47, scale: 0.9,
    family: family("dd01", "GA_REA_DDOK", 1, 6, GA_REA_DDOK_ACTIONS),
    parts: individualTextureParts("dd01", 1, "A"),
  }),
  transformation({
    key: "tita", name: "Titã", classicIndex: 70, mana: 390,
    affectType: 16, affectValue: 4, affectTimeSeconds: 13,
    itemClass: 70, skin: 53, scale: 2,
    family: family("sp02", "SCORPION", 3, 6, SCORPION_ACTIONS),
    parts: individualTextureParts("sp02", 3, "C"),
  }),
  transformation({
    key: "eden", name: "Éden", classicIndex: 71, mana: 390,
    affectType: 16, affectValue: 5, affectTimeSeconds: 13,
    itemClass: 71, skin: 54, scale: 0.9,
    family: family("mm01", "MURMY", 3, 6, MURMY_ACTIONS),
    parts: individualTextureParts("mm01", 3, "A"),
  }),
]);

const transformationBySkill = new Map(
  BEAST_MASTER_TRANSFORMATIONS.map((definition) => [definition.classicIndex, definition]),
);

export function beastMasterTransformationForSkill(
  classicIndex: number,
): BeastMasterTransformationDefinition | null {
  return transformationBySkill.get(classicIndex as BeastMasterTransformationSkillIndex) ?? null;
}

interface TransformationInput extends Omit<
  BeastMasterTransformationDefinition,
  "skillItemIndex" | "cooldownSeconds" | "source"
> {}

function transformation(input: TransformationInput): BeastMasterTransformationDefinition {
  return Object.freeze({
    ...input,
    skillItemIndex: 5000 + input.classicIndex,
    cooldownSeconds: 20,
    source: `SkillData ${input.classicIndex}; EFFECT_CLASS ${input.itemClass}; skin ${input.skin}`,
  });
}

function family(
  base: string,
  actionSet: string,
  partCount: number,
  animationCount: number,
  actionTable: ClassicActionTable,
): MonsterVisualFamily {
  const root = `player/transformations/${base}`;
  return Object.freeze({
    base,
    declaredParts: partCount,
    meshParts: Array.from({ length: partCount }, (_, index) => index + 1),
    skeleton: `${root}/${base}.bon`,
    clips: Array.from(
      { length: animationCount },
      (_, index) => `${root}/${base}${String(101 + index).padStart(4, "0")}.ani`,
    ),
    actionSet,
    actions: actionTable,
  });
}

function sharedTextureParts(
  base: string,
  count: number,
  textureStem: string,
  alpha: "A" | "C" | "N",
): BeastMasterTransformationDefinition["parts"] {
  return Array.from({ length: count }, (_, index) => part(
    base,
    index + 1,
    textureStem,
    alpha,
  ));
}

function individualTextureParts(
  base: string,
  count: number,
  alpha: "A" | "C" | "N",
): BeastMasterTransformationDefinition["parts"] {
  return Array.from({ length: count }, (_, index) => {
    const stem = `${base}${String(index + 1).padStart(2, "0")}01`;
    return part(base, index + 1, stem, alpha);
  });
}

function part(
  base: string,
  partIndex: number,
  textureStem: string | null,
  alpha: "A" | "C" | "N",
): BeastMasterTransformationDefinition["parts"][number] {
  const stem = `${base}${String(partIndex).padStart(2, "0")}01`;
  const root = `player/transformations/${base}`;
  return Object.freeze({
    part: partIndex,
    name: `parte-${partIndex}`,
    mesh: `${root}/${stem}.msh`,
    texture: textureStem ? `${root}/${textureStem}.dds` : null,
    alpha,
  });
}

function actions<const T extends ClassicActionTable>(table: T): T {
  return Object.freeze(table);
}
