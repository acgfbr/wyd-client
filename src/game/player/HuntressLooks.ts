export type ClassicAlphaMode = "A" | "C" | "N";

export interface HuntressLookPart {
  readonly meshStem: string;
  readonly textureStem: string;
  readonly alpha: ClassicAlphaMode;
}

export interface HuntressLookDefinition {
  readonly key: string;
  readonly name: string;
  readonly itemIndex: number | null;
  /** SetHumanCostume can replace m_nSkinMeshType independently of class. */
  readonly skinOverride?: 0 | 1;
  readonly source: string;
  readonly parts: readonly HuntressLookPart[];
}

const BASE_FACE_AND_HEAD = [
  { meshStem: "ch020121", textureStem: "ch020121", alpha: "N" },
  { meshStem: "ch020221", textureStem: "ch020221", alpha: "A" },
] as const;

/**
 * File decisions reproduced from TMHuman::SetPacketMOBItem/InitObject and
 * TMSkinMesh::SetHumanCostume/SetCostume. Huntress has class bit 8, therefore
 * bExpand=1 and ordinary LOOK_INFO variants receive +20 before the final +1.
 */
export const HUNTRESS_LOOKS = [
  kalintzCostume(),
  equipmentLook("rake", "Rake", 1656, 62),
  equipmentLook("loki", "Loki", 1673, 67),
  equipmentLook("waha-divino", "Waha Divino", 1681, 69),
  separateCostume("feiticeira", "Conjunto Feiticeira", 4157, "ch02", 97, ["A", "A", "N", "A", "A", "A"]),
  sharedCostume("militar-branco", "Conjunto Militar Branco", 4163, "ch02", 95, "WhitePolice", "A"),
  sharedCostume("militar-preto", "Conjunto Militar Preto", 4164, "ch02", 95, "BlackPolice", "A"),
  sharedCostume("oculto-f", "Conjunto Oculto (F)", 4166, "ch02", 89, "DeathCos", "A"),
  sharedCostume("hera-venenosa", "Conjunto Hera Venenosa", 4180, "ch01", 111, "ch0101111", "A"),
  sharedCostume("succubus", "Conjunto Succubus", 4181, "ch01", 112, "ch0101112", "C"),
  sharedCostume("medieval", "Conjunto Medieval", 4182, "ch01", 113, "ch0101113", "C"),
  sharedCostume("elegante", "Conjunto Elegante", 4183, "ch01", 114, "ch0101114", "C"),
] as const satisfies readonly HuntressLookDefinition[];

export type HuntressLookKey = (typeof HUNTRESS_LOOKS)[number]["key"];
export const DEFAULT_HUNTRESS_LOOK_KEY: HuntressLookKey = "mulher-kalintz";

export function huntressLook(key: string): HuntressLookDefinition {
  return HUNTRESS_LOOKS.find((look) => look.key === key)
    ?? HUNTRESS_LOOKS.find((look) => look.key === DEFAULT_HUNTRESS_LOOK_KEY)!;
}

function equipmentLook(key: string, name: string, firstItemIndex: number, armorVariant: number): HuntressLookDefinition {
  return {
    key,
    name,
    itemIndex: firstItemIndex,
    source: "LOOK_INFO + bExpand=1",
    parts: [
      ...BASE_FACE_AND_HEAD,
      ...Array.from({ length: 4 }, (_, index) => {
        const part = index + 3;
        const stem = `ch02${String(part).padStart(2, "0")}${armorVariant}`;
        return { meshStem: stem, textureStem: stem, alpha: "C" as const };
      }),
    ],
  };
}

function kalintzCostume(): HuntressLookDefinition {
  return {
    key: "mulher-kalintz",
    name: "Mulher Kalintz",
    itemIndex: 4156,
    source: "SetHumanCostume item 4156 -> Costype 5 -> SetOldCostume case 6",
    parts: [
      { meshStem: "ch020117", textureStem: "ch020117", alpha: "A" },
      { meshStem: "ch020217", textureStem: "ch020117", alpha: "A" },
      { meshStem: "ch020317", textureStem: "ch020317", alpha: "C" },
      { meshStem: "ch020417", textureStem: "ch020417", alpha: "C" },
      { meshStem: "ch020517", textureStem: "ch020517", alpha: "N" },
      { meshStem: "ch020617", textureStem: "ch020617", alpha: "N" },
    ],
  };
}

function separateCostume(
  key: string,
  name: string,
  itemIndex: number,
  base: string,
  variant: number,
  alpha: readonly ClassicAlphaMode[],
): HuntressLookDefinition {
  return {
    key,
    name,
    itemIndex,
    source: `SetHumanCostume item ${itemIndex}`,
    parts: Array.from({ length: 6 }, (_, index) => {
      const part = index + 1;
      const stem = `${base}${String(part).padStart(2, "0")}${variant}`;
      return { meshStem: stem, textureStem: stem, alpha: alpha[index] ?? "A" };
    }),
  };
}

function sharedCostume(
  key: string,
  name: string,
  itemIndex: number,
  base: string,
  variant: number,
  textureStem: string,
  alpha: ClassicAlphaMode,
): HuntressLookDefinition {
  return {
    key,
    name,
    itemIndex,
    source: `SetHumanCostume item ${itemIndex}`,
    parts: Array.from({ length: 6 }, (_, index) => ({
      meshStem: `${base}${String(index + 1).padStart(2, "0")}${variant}`,
      textureStem,
      alpha,
    })),
  };
}
