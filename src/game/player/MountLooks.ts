import type { ClassicBaseAttachmentTransform } from "../../render/characters/ClassicSkinnedModel";
import type { MonsterVisualFamily } from "../npcs/MonsterCatalog";

export type ClassicMountAlphaMode = "A" | "C" | "N";

export interface ClassicMountPartDefinition {
  readonly name: string;
  readonly meshStem: string;
  readonly textureStem: string;
  readonly alpha: ClassicMountAlphaMode;
}

export interface ClassicMountFamilyDefinition {
  readonly base: string;
  readonly clipCount: number;
  readonly visual: MonsterVisualFamily;
}

export interface ClassicMountLookDefinition {
  readonly key: string;
  readonly name: string;
  readonly itemIndex: number;
  readonly visualItemIndex: number;
  /** Current LOOK_INFO Mesh0 after TMHuman's mount-specific overrides. */
  readonly meshIndex: number;
  readonly textureIndex: number;
  readonly skin: number;
  readonly level: 120;
  readonly source: string;
  readonly family: ClassicMountFamilyDefinition;
  readonly parts: readonly ClassicMountPartDefinition[];
  /** Zero-based MSH part indices receiving nMountSanc=12/effect 452. */
  readonly refinementParts: readonly number[];
  readonly mountScale: number;
  readonly seatBone: number;
  readonly riderAttachment: ClassicBaseAttachmentTransform;
}

const DRAGON = mountFamily("dr01", 2, 8, "Dragon", {
  STAND01: [0, 30, 0], WALK: [1, 17, 0], RUN: [2, 20, 76],
  ATTACK1: [3, 22, 78], ATTACK2: [4, 30, 78], SKILL01: [4, 30, 0],
  STRIKE: [5, 22, 0], DIE: [6, 30, 80], DEAD: [7, 15, 0], LEVELUP: [0, 25, 0],
});
const BOAR = mountFamily("bo01", 2, 5, "boar", {
  STAND01: [0, 30, 0], WALK: [1, 15, 0], RUN: [1, 10, 0],
  ATTACK1: [2, 20, 201], ATTACK2: [2, 20, 202], SKILL01: [2, 20, 0],
  STRIKE: [0, 20, 200], DIE: [3, 20, 203], DEAD: [4, 20, 0], LEVELUP: [0, 20, 0],
});
const WOLF = mountFamily("wf01", 2, 6, "wolf", {
  STAND01: [0, 30, 0], WALK: [1, 15, 0], RUN: [1, 5, 0],
  ATTACK1: [2, 20, 245], ATTACK2: [2, 20, 245], SKILL01: [2, 20, 245],
  STRIKE: [3, 20, 247], DIE: [4, 20, 248], DEAD: [5, 20, 0], LEVELUP: [0, 20, 249],
});
const BEAR = mountFamily("be01", 2, 9, "bear", {
  STAND01: [0, 30, 0], WALK: [1, 15, 0], RUN: [8, 10, 0],
  ATTACK1: [2, 20, 250], ATTACK2: [3, 20, 251], SKILL01: [2, 20, 250],
  STRIKE: [5, 20, 252], DIE: [6, 20, 253], DEAD: [7, 20, 0], LEVELUP: [0, 20, 274],
});
const TWOLF = mountFamily("tw01", 2, 7, "twolf", {
  STAND01: [0, 34, 0], WALK: [1, 20, 0], RUN: [1, 15, 0],
  ATTACK1: [2, 20, 301], ATTACK2: [2, 20, 301], SKILL01: [2, 20, 250],
  STRIKE: [3, 20, 252], DIE: [4, 20, 253], DEAD: [5, 20, 0], LEVELUP: [0, 20, 0],
});
const HORSE = mountFamily("hs01", 3, 10, "horse", {
  STAND01: [0, 34, 0], WALK: [1, 20, 0], RUN: [2, 15, 0],
  ATTACK1: [3, 20, 279], ATTACK2: [4, 20, 279], SKILL01: [5, 20, 279],
  STRIKE: [6, 10, 280], DIE: [7, 30, 281], DEAD: [8, 20, 0], LEVELUP: [9, 22, 279],
});
const TIGER = mountFamily("tg01", 2, 7, "tiger", {
  STAND01: [0, 34, 0], WALK: [1, 30, 0], RUN: [1, 25, 0],
  ATTACK1: [2, 20, 301], ATTACK2: [2, 20, 301], SKILL01: [2, 20, 250],
  STRIKE: [4, 20, 252], DIE: [5, 20, 253], DEAD: [6, 20, 0], LEVELUP: [0, 20, 0],
});
const RED_DRAGON = mountFamily("dr02", 3, 7, "Dragon2", {
  STAND01: [0, 35, 0], WALK: [1, 20, 0], RUN: [6, 20, 76],
  ATTACK1: [2, 22, 78], ATTACK2: [2, 30, 78], SKILL01: [2, 30, 0],
  STRIKE: [3, 22, 0], DIE: [4, 30, 80], DEAD: [5, 15, 0], LEVELUP: [0, 25, 0],
});
const GRIFFIN = mountFamily("bd02", 3, 8, "gripon", {
  STAND01: [0, 20, 0], WALK: [1, 20, 76], RUN: [2, 20, 76],
  ATTACK1: [3, 15, 205], ATTACK2: [3, 15, 206], SKILL01: [3, 15, 0],
  STRIKE: [4, 20, 204], DIE: [5, 20, 207], DEAD: [6, 20, 0], LEVELUP: [7, 20, 0],
});

/**
 * Equip[14] decoding reproduced from TMHuman::SetPacketMOBItem. These are
 * real, distinct client looks rather than recolours of the Unicorn model.
 */
export const MOUNT_LOOKS: readonly ClassicMountLookDefinition[] = [
  createMountLook({
    key: "javali", name: "Javali Doméstico", itemIndex: 2361, visualItemIndex: 316,
    meshIndex: 1, textureIndex: 0, skin: 25, family: BOAR,
    parts: sharedTwoParts("bo01", "02", "bo010102", "N"),
  }),
  createMountLook({
    key: "lobo", name: "Lobo Doméstico", itemIndex: 2362, visualItemIndex: 317,
    meshIndex: 0, textureIndex: 0, skin: 28, family: WOLF,
    parts: sharedTwoParts("wf01", "01", "wf010101", "N"),
  }),
  createMountLook({
    key: "dragao-menor", name: "Dragão Menor", itemIndex: 2363, visualItemIndex: 318,
    meshIndex: 7, textureIndex: 0, skin: 20, family: DRAGON,
    parts: sharedTwoParts("dr01", "08", "dr010108", "N"),
  }),
  createMountLook({
    key: "urso", name: "Urso Doméstico", itemIndex: 2364, visualItemIndex: 319,
    meshIndex: 0, textureIndex: 0, skin: 29, family: BEAR,
    parts: sharedTwoParts("be01", "01", "be010101", "N"),
  }),
  createMountLook({
    key: "dente-de-sabre", name: "Dente de Sabre", itemIndex: 2365, visualItemIndex: 320,
    meshIndex: 1, textureIndex: 0, skin: 29, family: BEAR,
    parts: sharedTwoParts("be01", "02", "be010102", "N"),
  }),
  createMountLook({
    key: "dragao", name: "Dragão", itemIndex: 2377, visualItemIndex: 332,
    meshIndex: 0, textureIndex: 1, skin: 20, family: DRAGON,
    parts: sharedTwoParts("dr01", "01", "dr010102", "N"),
  }),
  createMountLook({
    key: "fenrir-sombras", name: "Fenrir das Sombras", itemIndex: 2378, visualItemIndex: 333,
    meshIndex: 0, textureIndex: 1, skin: 30, family: TWOLF, mountScale: 1.1,
    parts: sharedTwoParts("tw01", "01", "tw010102", "C"),
  }),
  createMountLook({
    key: "tigre-fogo", name: "Tigre de Fogo", itemIndex: 2379, visualItemIndex: 334,
    meshIndex: 0, textureIndex: 0, skin: 38, family: TIGER,
    parts: sharedTwoParts("tg01", "01", "tg010101", "C"),
  }),
  createMountLook({
    key: "dragao-vermelho", name: "Dragão Vermelho", itemIndex: 2380, visualItemIndex: 335,
    meshIndex: 0, textureIndex: 0, skin: 39, family: RED_DRAGON,
    parts: [
      part("corpo", "dr020101", "dr020101", "A"),
      part("asas", "dr020201", "dr020101", "A"),
      part("arreio", "dr020301", "dr020301", "N"),
    ],
  }),
  createMountLook({
    key: "unicornio", name: "Unicórnio", itemIndex: 2381, visualItemIndex: 336,
    meshIndex: 6, textureIndex: 0, skin: 31, family: HORSE,
    parts: [
      part("corpo", "hs010107", "hs010107", "A"),
      part("pernas", "hs010207", "hs010107", "A"),
      part("chifre-e-arreio", "hs010307", "hs010307", "N"),
    ],
  }),
  createMountLook({
    key: "grifo", name: "Grifo", itemIndex: 2384, visualItemIndex: 339,
    meshIndex: 0, textureIndex: 0, skin: 40, family: GRIFFIN,
    parts: [
      part("corpo", "bd020101", "bd020101", "A"),
      part("asas", "bd020201", "bd020101", "A"),
      part("arreio", "bd020301", "bd020301", "N"),
    ],
  }),
  createMountLook({
    key: "svadilfari", name: "Svadilfari", itemIndex: 2387, visualItemIndex: 336,
    meshIndex: 10, textureIndex: 0, skin: 31, family: HORSE, refinementParts: [2],
    parts: [
      part("corpo", "hs010111", "hs010111", "A"),
      part("pernas", "hs010211", "hs010111", "A"),
      part("arreio", "hs010312", "hs010312", "N"),
    ],
  }),
  createMountLook({
    key: "sleipnir", name: "Sleipnir", itemIndex: 2388, visualItemIndex: 336,
    meshIndex: 6, textureIndex: 0, skin: 31, family: HORSE,
    parts: [
      part("corpo", "hs010107", "hs010107", "A"),
      part("pernas", "hs010207", "hs010107", "A"),
      part("arreio", "hs010310", "hs010310", "N"),
    ],
  }),
  createMountLook({
    key: "pantera-negra", name: "Pantera Negra", itemIndex: 2389, visualItemIndex: 346,
    meshIndex: 4, textureIndex: 0, skin: 29, family: BEAR,
    parts: sharedTwoParts("be01", "05", "be010105", "C"),
  }),
];

export const DEFAULT_MOUNT_LOOK_KEY = "unicornio";

export function mountLook(key: string): ClassicMountLookDefinition {
  return MOUNT_LOOKS.find((look) => look.key === key)
    ?? MOUNT_LOOKS.find((look) => look.key === DEFAULT_MOUNT_LOOK_KEY)!;
}

interface MountLookInput {
  readonly key: string;
  readonly name: string;
  readonly itemIndex: number;
  readonly visualItemIndex: number;
  readonly meshIndex: number;
  readonly textureIndex: number;
  readonly skin: number;
  readonly family: ClassicMountFamilyDefinition;
  readonly parts: readonly ClassicMountPartDefinition[];
  readonly refinementParts?: readonly number[];
  readonly mountScale?: number;
}

function createMountLook(input: MountLookInput): ClassicMountLookDefinition {
  const mountScale = input.mountScale ?? classicMountScale(input.skin, input.meshIndex);
  return {
    ...input,
    level: 120,
    source: `Equip[14] item ${input.itemIndex} -> visual ${input.visualItemIndex}`,
    refinementParts: input.refinementParts ?? input.parts.map((_, index) => index),
    mountScale,
    seatBone: classicSeatBone(input.skin, input.meshIndex),
    riderAttachment: classicRiderAttachment(input.skin, input.meshIndex, mountScale),
  };
}

function mountFamily(
  base: string,
  declaredParts: number,
  clipCount: number,
  actionSet: string,
  actions: Readonly<Record<string, readonly number[]>>,
): ClassicMountFamilyDefinition {
  const root = `player/mounts/${base}`;
  return {
    base,
    clipCount,
    visual: {
      base,
      declaredParts,
      meshParts: Array.from({ length: declaredParts }, (_, index) => index + 1),
      skeleton: `${root}/${base}.bon`,
      clips: Array.from(
        { length: clipCount },
        (_, index) => `${root}/${base}${String(101 + index).padStart(4, "0")}.ani`,
      ),
      actionSet,
      actions,
    },
  };
}

function sharedTwoParts(
  base: string,
  meshVariant: string,
  textureStem: string,
  alpha: ClassicMountAlphaMode,
): readonly ClassicMountPartDefinition[] {
  return [
    part("corpo", `${base}01${meshVariant}`, textureStem, alpha),
    part("pernas", `${base}02${meshVariant}`, textureStem, alpha),
  ];
}

function part(
  name: string,
  meshStem: string,
  textureStem: string,
  alpha: ClassicMountAlphaMode,
): ClassicMountPartDefinition {
  return { name, meshStem, textureStem, alpha };
}

/** BASE_GetMountScale plus the explicit visual-333 override in TMHuman. */
function classicMountScale(skin: number, meshIndex: number): number {
  if (skin === 28) return 1.45;
  if (skin === 25 && meshIndex === 1) return 1.4;
  if (skin === 20 && meshIndex === 7) return 0.6;
  if (skin === 20 && meshIndex === 0) return 1.3;
  if (skin === 29 && meshIndex === 4) return 1.3;
  return 1;
}

/** TMSkinMesh::RenderSkinMesh selects the mount's m_OutMatrix bone by rig. */
function classicSeatBone(skin: number, meshIndex: number): number {
  if (skin === 20) return meshIndex === 7 ? 3 : 4;
  if (skin === 25 || skin === 28 || skin === 38) return 3;
  if (skin === 29) return 5;
  if (skin === 30 || skin === 31) return 4;
  if (skin === 39) return 7;
  if (skin === 40) return 15;
  return 0;
}

/** SetVecMantua + the three arguments passed to the mounted rider's Render. */
function classicRiderAttachment(
  skin: number,
  meshIndex: number,
  mountScale: number,
): ClassicBaseAttachmentTransform {
  let length = -0.37 * mountScale;
  let length2 = 0.2 * mountScale;

  if (skin === 25) {
    length = -0.35 * mountScale;
    length2 = -0.1 * mountScale;
  } else if (skin === 28) {
    length = -0.2 * mountScale;
    length2 = 0.1 * mountScale;
  } else if (skin === 29) {
    length = (meshIndex === 1 || meshIndex === 4 ? -0.1 : -0.37) * mountScale;
    length2 = -0.6 * mountScale;
  } else if (skin === 20) {
    length = (meshIndex === 7 ? 0.5 : 0.25) * mountScale;
    length2 = -0.1 * mountScale;
  }

  // TMHuman applies these absolute offsets after the skin switch and before
  // both rider Render and m_vecSkinPos sampling. Keeping them in the shared
  // attachment definition prevents the actor and owner-bound VFX from
  // disagreeing on bears/panthers and the two dr01 mounts.
  if (skin === 29) {
    length += 0.1;
  } else if (skin === 20) {
    length -= 0.1;
    length2 -= 0.5;
  }

  if (skin === 20 && meshIndex === 7) {
    return { length, scale: 1 / mountScale, length2, yaw: Math.PI / 2, pitch: -1.3707963 };
  }
  if (skin === 20) {
    return { length, scale: 1 / mountScale, length2, yaw: Math.PI / 2, pitch: -(2 * Math.PI) / 3 };
  }

  const mantuaUp = skin === 25 ? 0.1
    : skin === 28 || skin === 31 ? 0.15
      : skin === 29 || skin === 40 ? 0.18
        : skin === 39 || skin === 30 ? 0.25
          : skin === 38 ? 0.26
            : 0;
  return {
    length,
    scale: 1 / mountScale,
    length2,
    yaw: -Math.PI / 2,
    pitch: Math.PI / 2 + mantuaUp,
  };
}
