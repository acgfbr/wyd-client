import {
  DEFAULT_HUNTRESS_LOOK_KEY,
  HUNTRESS_LOOKS,
  type ClassicAlphaMode,
  type HuntressLookDefinition,
  type HuntressLookPart,
} from "./HuntressLooks";

export type ClassicPlayerClassKey = "transknight" | "foema" | "beastmaster" | "huntress";
export type ClassicPlayerAnimationSet = "Knight" | "Mage";
export type ClassicPlayerLookDefinition = HuntressLookDefinition;
export type ClassicPlayerLookPart = HuntressLookPart;

export interface ClassicPlayerWeaponAttachment {
  /** LOOK_INFO Mesh7 / the second g_dwHandIndex entry. */
  readonly lookPart: 7;
  readonly boneIndex: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yawDegrees: number;
  readonly pitchDegrees: number;
  readonly rollDegrees: number;
}

export interface ClassicPlayerWeaponDefinition {
  readonly key: string;
  readonly name: string;
  readonly itemIndex: number;
  readonly meshIndex: number;
  readonly meshStem: string;
  readonly textureStem: string;
  readonly alpha: ClassicAlphaMode;
  /** EF_WTYPE (ItemList static effect 21). */
  readonly weaponType: number;
  /** EF_POS (ItemList equipment position). */
  readonly position: number;
  /** Values passed to SetWeaponType by TMHuman::CheckWeapon. */
  readonly animationWeaponType: number;
  readonly mountedAnimationWeaponType: number;
  readonly attachment: ClassicPlayerWeaponAttachment;
  readonly source: string;
}

export interface ClassicSelectionItems {
  readonly face: number;
  readonly helm: number;
  readonly body: number;
  readonly mantle: number;
  readonly right: number;
  readonly left: number;
  readonly refinement: number;
}

export interface ClassicPlayerSelectionDefinition {
  readonly items: ClassicSelectionItems;
  /** Final six-piece result after SetRace + InitObject, not the raw selchar row. */
  readonly look: ClassicPlayerLookDefinition;
  readonly weapon: ClassicPlayerWeaponDefinition;
}

export interface ClassicPlayerClassDefinition {
  readonly key: ClassicPlayerClassKey;
  readonly name: string;
  /** Class sent by character creation (0..3). */
  readonly classIndex: 0 | 1 | 2 | 3;
  /** EF_CLASS bit stored by the face item. */
  readonly itemClass: 1 | 2 | 4 | 8;
  /** BASE_DefineSkinMeshType result: ch01=0, ch02=1. */
  readonly skin: 0 | 1;
  /** BM and Huntress add 20 to ordinary LOOK_INFO variants. */
  readonly expand: 0 | 1;
  readonly animationSet: ClassicPlayerAnimationSet;
  readonly baseParts: readonly ClassicPlayerLookPart[];
  readonly selection: ClassicPlayerSelectionDefinition;
  readonly looks: readonly ClassicPlayerLookDefinition[];
  readonly defaultLookKey: string;
  readonly defaultWeapon: ClassicPlayerWeaponDefinition;
  readonly source: string;
}

const CH01_LEFT_HAND = {
  lookPart: 7,
  boneIndex: 25,
  x: -0.1,
  y: -0.01,
  z: 0,
  yawDegrees: 0,
  pitchDegrees: 0,
  rollDegrees: 180,
} as const satisfies ClassicPlayerWeaponAttachment;

const CH02_LEFT_HAND = {
  lookPart: 7,
  boneIndex: 24,
  x: -0.07,
  y: -0.01,
  z: 0,
  yawDegrees: -15,
  pitchDegrees: -10,
  rollDegrees: 180,
} as const satisfies ClassicPlayerWeaponAttachment;

const TRANSKNIGHT_SELECTION_WEAPON = weapon({
  key: "gaoth-ancient",
  name: "Machado Gaoth (Ancient)",
  itemIndex: 3605,
  meshIndex: 2894,
  meshStem: "aawhammerone",
  alpha: "A",
  weaponType: 11,
  position: 192,
  animationWeaponType: 1,
  mountedAnimationWeaponType: 1,
  attachment: CH01_LEFT_HAND,
});

const FOEMA_SELECTION_WEAPON = weapon({
  key: "dordje-ancient",
  name: "Dordje (Ancient)",
  itemIndex: 3733,
  meshIndex: 2891,
  meshStem: "aawandtwo",
  alpha: "A",
  weaponType: 32,
  position: 64,
  animationWeaponType: 9,
  mountedAnimationWeaponType: 4,
  attachment: CH02_LEFT_HAND,
});

const BEASTMASTER_SELECTION_WEAPON = weapon({
  key: "kaumodaki-ancient",
  name: "Martelo Kaumodaki (Ancient)",
  itemIndex: 3785,
  meshIndex: 2895,
  meshStem: "aawhammertwo",
  alpha: "A",
  weaponType: 13,
  position: 64,
  animationWeaponType: 7,
  mountedAnimationWeaponType: 4,
  attachment: CH01_LEFT_HAND,
});

const HUNTRESS_SELECTION_WEAPON = weapon({
  key: "eithna-ancient",
  name: "Eithna (Ancient)",
  itemIndex: 3625,
  meshIndex: 2892,
  meshStem: "aawbow",
  alpha: "A",
  weaponType: 101,
  position: 64,
  animationWeaponType: 6,
  mountedAnimationWeaponType: 5,
  attachment: CH02_LEFT_HAND,
});

/** Existing playable Huntress weapon; intentionally distinct from selchar's Eithna. */
const HUNTRESS_DEFAULT_WEAPON = weapon({
  key: "skytalos-ancient",
  name: "Skytalos (Ancient)",
  itemIndex: 2551,
  meshIndex: 762,
  meshStem: "bow16",
  alpha: "N",
  weaponType: 101,
  position: 64,
  animationWeaponType: 6,
  mountedAnimationWeaponType: 5,
  attachment: CH02_LEFT_HAND,
});

const TRANSKNIGHT_SELECTION_LOOK = selectionLook(
  "melpomene-selection",
  "Armadura Melpômene",
  1230,
  "ch01",
  41,
  3,
  46,
  ["N", "N", "C", "C", "C", "C"],
  "UI/selchar.txt row 1 + TMHuman::InitObject FaceMesh=40",
);

const FOEMA_SELECTION_LOOK = selectionLook(
  "potamides-selection",
  "Túnica Potâmides",
  1365,
  "ch02",
  41,
  null,
  46,
  ["N", "A", "C", "C", "C", "C"],
  "UI/selchar.txt row 2 + TMHuman::InitObject FaceMesh=40",
);

const BEASTMASTER_SELECTION_LOOK = selectionLook(
  "driade-selection",
  "Peitoral Dríade",
  1515,
  "ch01",
  61,
  85,
  66,
  ["N", "N", "C", "C", "C", "C"],
  "UI/selchar.txt row 3 + bExpand=1 + TMHuman::InitObject FaceMesh=40",
);

const HUNTRESS_SELECTION_LOOK = selectionLook(
  "urania-selection",
  "Túnica Urânia",
  1665,
  "ch02",
  61,
  85,
  66,
  ["A", "A", "C", "C", "C", "C"],
  "UI/selchar.txt row 4 + bExpand=1 + TMHuman::InitObject FaceMesh=40",
);

/**
 * Exact base rigs and canonical selection-scene equipment from the classic
 * client. Huntress remains Mulher Kalintz + Skytalos by default; its selchar
 * Urânia/Eithna pair is metadata for a future character-selection screen.
 */
export const CLASSIC_PLAYER_CLASSES = [
  {
    key: "transknight",
    name: "TransKnight",
    classIndex: 0,
    itemClass: 1,
    skin: 0,
    expand: 0,
    animationSet: "Knight",
    baseParts: baseParts("ch01", 1, ["N", "A", "N", "C", "C", "N"]),
    selection: selection(
      { face: 6, helm: 1417, body: 1230, mantle: 0, right: 0, left: 3605, refinement: 9 },
      TRANSKNIGHT_SELECTION_LOOK,
      TRANSKNIGHT_SELECTION_WEAPON,
    ),
    looks: [TRANSKNIGHT_SELECTION_LOOK],
    defaultLookKey: TRANSKNIGHT_SELECTION_LOOK.key,
    defaultWeapon: TRANSKNIGHT_SELECTION_WEAPON,
    source: "BASE_DefineSkinMeshType(1)=0; BoneAni4 ch01; AniSound4 [Knight]",
  },
  {
    key: "foema",
    name: "Foema",
    classIndex: 1,
    itemClass: 2,
    skin: 1,
    expand: 0,
    animationSet: "Mage",
    baseParts: baseParts("ch02", 1, ["N", "A", "N", "N", "C", "C"]),
    selection: selection(
      { face: 16, helm: 44, body: 1365, mantle: 0, right: 0, left: 3733, refinement: 9 },
      FOEMA_SELECTION_LOOK,
      FOEMA_SELECTION_WEAPON,
    ),
    looks: [FOEMA_SELECTION_LOOK],
    defaultLookKey: FOEMA_SELECTION_LOOK.key,
    defaultWeapon: FOEMA_SELECTION_WEAPON,
    source: "BASE_DefineSkinMeshType(2)=1; BoneAni4 ch02; AniSound4 [Mage]",
  },
  {
    key: "beastmaster",
    name: "BeastMaster",
    classIndex: 2,
    itemClass: 4,
    skin: 0,
    expand: 1,
    animationSet: "Knight",
    baseParts: baseParts("ch01", 21, ["N", "A", "N", "A", "C", "C"]),
    selection: selection(
      { face: 26, helm: 44, body: 1515, mantle: 0, right: 0, left: 3785, refinement: 9 },
      BEASTMASTER_SELECTION_LOOK,
      BEASTMASTER_SELECTION_WEAPON,
    ),
    looks: [BEASTMASTER_SELECTION_LOOK],
    defaultLookKey: BEASTMASTER_SELECTION_LOOK.key,
    defaultWeapon: BEASTMASTER_SELECTION_WEAPON,
    source: "BASE_DefineSkinMeshType(4)=0; bExpand=1; BoneAni4 ch01; AniSound4 [Knight]",
  },
  {
    key: "huntress",
    name: "Huntress",
    classIndex: 3,
    itemClass: 8,
    skin: 1,
    expand: 1,
    animationSet: "Mage",
    baseParts: baseParts("ch02", 21, ["N", "A", "C", "C", "C", "C"]),
    selection: selection(
      { face: 36, helm: 44, body: 1665, mantle: 0, right: 0, left: 3625, refinement: 9 },
      HUNTRESS_SELECTION_LOOK,
      HUNTRESS_SELECTION_WEAPON,
    ),
    looks: HUNTRESS_LOOKS,
    defaultLookKey: DEFAULT_HUNTRESS_LOOK_KEY,
    defaultWeapon: HUNTRESS_DEFAULT_WEAPON,
    source: "BASE_DefineSkinMeshType(8)=1; bExpand=1; playable default preserved as Mulher Kalintz",
  },
] as const satisfies readonly ClassicPlayerClassDefinition[];

export function classicPlayerClass(key: string): ClassicPlayerClassDefinition {
  return CLASSIC_PLAYER_CLASSES.find((definition) => definition.key === key)
    ?? CLASSIC_PLAYER_CLASSES[3];
}

function baseParts(
  base: "ch01" | "ch02",
  variant: 1 | 21,
  alpha: readonly ClassicAlphaMode[],
): readonly ClassicPlayerLookPart[] {
  return Array.from({ length: 6 }, (_, index) => {
    const stem = `${base}${String(index + 1).padStart(2, "0")}${String(variant).padStart(2, "0")}`;
    return { meshStem: stem, textureStem: stem, alpha: alpha[index] ?? "N" };
  });
}

function selectionLook(
  key: string,
  name: string,
  bodyItemIndex: number,
  base: "ch01" | "ch02",
  faceVariant: number,
  helmetVariant: number | null,
  bodyVariant: number,
  alpha: readonly ClassicAlphaMode[],
  source: string,
): ClassicPlayerLookDefinition {
  const parts: ClassicPlayerLookPart[] = [
    playerPart(base, 1, faceVariant, alpha[0] ?? "N"),
  ];
  // Item #44 resolves Foema's helmet to ch020265, which is absent from the
  // shipped Origem client. TMSkinMesh simply skips that failed mesh load.
  if (helmetVariant !== null) {
    parts.push(playerPart(base, 2, helmetVariant, alpha[1] ?? "N"));
  }
  for (let part = 3; part <= 6; part++) {
    parts.push(playerPart(base, part, bodyVariant, alpha[part - 1] ?? "N"));
  }
  return {
    key,
    name,
    itemIndex: bodyItemIndex,
    source,
    parts,
  };
}

function playerPart(
  base: "ch01" | "ch02",
  part: number,
  variant: number,
  alpha: ClassicAlphaMode,
): ClassicPlayerLookPart {
  const stem = `${base}${String(part).padStart(2, "0")}${String(variant).padStart(2, "0")}`;
  return { meshStem: stem, textureStem: stem, alpha };
}

function selection(
  items: ClassicSelectionItems,
  look: ClassicPlayerLookDefinition,
  playerWeapon: ClassicPlayerWeaponDefinition,
): ClassicPlayerSelectionDefinition {
  return { items, look, weapon: playerWeapon };
}

function weapon(
  definition: Omit<ClassicPlayerWeaponDefinition, "textureStem" | "source">,
): ClassicPlayerWeaponDefinition {
  return {
    ...definition,
    textureStem: definition.meshStem,
    source: "Origem/ItemList.bin + mesh/MeshList.txt + TMHuman::CheckWeapon + CFrame::Render",
  };
}
