import type {
  ClassicAlphaMode,
  HuntressLookDefinition,
  HuntressLookPart,
} from "./HuntressLooks";

/**
 * Complete 4150..4183 SetHumanCostume table. Costumes replace the body and
 * can change m_nSkinMeshType independently of the character's original class.
 */
export const CLASSIC_COSTUME_LOOKS = [
  shared("yin-yang", "Conjunto Yin-Yang", 4150, 0, "ch01", 99, "ch010199", "C"),
  shared("quebrado", "Conjunto Quebrado", 4151, 0, "ch01", 115, "ch0101115", "C"),
  valkyrie(),
  skeleton(),
  shared("romano", "Conjunto Romano", 4154, 1, "ch02", 90, "SpiderCos", "A"),
  kalintzMale(),
  kalintzFemale(),
  individual("feiticeira", "Conjunto Feiticeira", 4157, 1, "ch02", 97, ["A", "A", "N", "A", "A", "A"]),
  shared("draco", "Conjunto Draco", 4158, 0, "ch01", 95, "ch010195", "A"),
  shared("anjo-natalino-vermelho", "Anjo Natalino Vermelho", 4159, 1, "ch02", 96, "RedSanta", "A"),
  shared("anjo-natalino-branco", "Anjo Natalino Branco", 4160, 1, "ch02", 96, "WhiteSanta", "A"),
  shared("rudolph-roxo", "Conjunto Rudolph Roxo", 4161, 1, "ch02", 94, "PurpleRudol", "A"),
  shared("rudolph-azul", "Conjunto Rudolph Azul", 4162, 1, "ch02", 94, "BlueRudol", "A"),
  shared("militar-branco", "Conjunto Militar Branco", 4163, 1, "ch02", 95, "WhitePolice", "A"),
  shared("militar-preto", "Conjunto Militar Preto", 4164, 1, "ch02", 95, "BlackPolice", "A"),
  shared("oculto-m", "Conjunto Oculto (M)", 4165, 0, "ch01", 89, "DeathCos2", "A"),
  shared("oculto-f", "Conjunto Oculto (F)", 4166, 1, "ch02", 89, "DeathCos", "A"),
  shared("anfitria", "Conjunto Anfitriã", 4167, 0, "ch01", 100, "ch0101100", "A"),
  shared("charmoso", "Conjunto Charmoso", 4168, 0, "ch01", 101, "ch0101101", "A"),
  shared("madeira-1", "Conjunto Madeira 1", 4169, 0, "ch01", 102, "ch0101102", "C"),
  shared("madeira-2", "Conjunto Madeira 2", 4170, 0, "ch01", 102, "ch0101102", "C"),
  shared("real-vermelho", "Conjunto Real Vermelho", 4171, 0, "ch01", 103, "ch0101103", "C"),
  shared("real-azul", "Conjunto Real Azul", 4172, 0, "ch01", 103, "ch0102103", "C"),
  shared("profeta", "Conjunto Profeta", 4173, 0, "ch01", 104, "ch0101104", "C"),
  shared("odin", "Conjunto Odin", 4174, 0, "ch01", 106, "ch0101106", "C"),
  shared("dancarina", "Conjunto Dançarina", 4175, 1, "ch01", 105, "ch0101105", "A"),
  shared("coelho-pascoa", "Coelho da Páscoa", 4176, 1, "ch01", 107, "ch0101107", "C"),
  shared("oriental", "Conjunto Oriental", 4177, 1, "ch01", 108, "ch0101108", "C"),
  shared("feudal-m", "Conjunto Feudal (M)", 4178, 0, "ch01", 109, "ch0101109", "C"),
  shared("feudal-f", "Conjunto Feudal (F)", 4179, 1, "ch01", 110, "ch0101110", "C"),
  shared("hera-venenosa", "Conjunto Hera Venenosa", 4180, 1, "ch01", 111, "ch0101111", "A"),
  shared("succubus", "Conjunto Succubus", 4181, 1, "ch01", 112, "ch0101112", "C"),
  shared("medieval", "Conjunto Medieval", 4182, 1, "ch01", 113, "ch0101113", "C"),
  shared("elegante", "Conjunto Elegante", 4183, 1, "ch01", 114, "ch0101114", "C"),
] as const satisfies readonly HuntressLookDefinition[];

function shared(
  key: string,
  name: string,
  itemIndex: number,
  skinOverride: 0 | 1,
  base: "ch01" | "ch02",
  variant: number,
  textureStem: string,
  alpha: ClassicAlphaMode,
): HuntressLookDefinition {
  return {
    key,
    name,
    itemIndex,
    skinOverride,
    source: `TMHuman::SetHumanCostume item ${itemIndex} + TMSkinMesh::SetCostume`,
    parts: parts(base, variant, () => textureStem, () => alpha),
  };
}

function individual(
  key: string,
  name: string,
  itemIndex: number,
  skinOverride: 0 | 1,
  base: "ch01" | "ch02",
  variant: number,
  alpha: readonly ClassicAlphaMode[],
): HuntressLookDefinition {
  return {
    key,
    name,
    itemIndex,
    skinOverride,
    source: `TMHuman::SetHumanCostume item ${itemIndex} + TMSkinMesh::SetCostume`,
    parts: parts(
      base,
      variant,
      (part) => stem(base, part, variant),
      (part) => alpha[part - 1] ?? "N",
    ),
  };
}

function valkyrie(): HuntressLookDefinition {
  return {
    key: "valquiria",
    name: "Conjunto Valquíria",
    itemIndex: 4152,
    skinOverride: 1,
    source: "SetHumanCostume item 4152 -> Costype 1 -> SetOldCostume case 2",
    parts: Array.from({ length: 6 }, (_, index) => {
      const part = index + 1;
      const variant = part <= 2 ? 61 : 57;
      const partStem = stem("ch02", part, variant);
      return { meshStem: partStem, textureStem: partStem, alpha: "A" };
    }),
  };
}

function skeleton(): HuntressLookDefinition {
  return {
    key: "esqueleto",
    name: "Conjunto Esqueleto",
    itemIndex: 4153,
    skinOverride: 0,
    source: "SetHumanCostume item 4153 -> Costype 2 -> SetOldCostume case 3",
    parts: Array.from({ length: 6 }, (_, index) => {
      const part = index + 1;
      const variant = part === 1 ? 30 : 31;
      const partStem = stem("ch01", part, variant);
      return { meshStem: partStem, textureStem: partStem, alpha: "N" };
    }),
  };
}

function kalintzMale(): HuntressLookDefinition {
  return {
    key: "kalintz-m",
    name: "Conjunto Kalintz (M)",
    itemIndex: 4155,
    skinOverride: 0,
    source: "SetHumanCostume item 4155 -> Costype 4 -> SetOldCostume case 5",
    parts: Array.from({ length: 6 }, (_, index) => {
      const part = index + 1;
      const partStem = stem("ch01", part, 37);
      // The second mesh has no own WYS; CMesh keeps the face texture.
      const textureStem = part === 2 ? "ch010137" : partStem;
      return { meshStem: partStem, textureStem, alpha: "N" };
    }),
  };
}

function kalintzFemale(): HuntressLookDefinition {
  return {
    key: "mulher-kalintz",
    name: "Mulher Kalintz",
    itemIndex: 4156,
    skinOverride: 1,
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

function parts(
  base: "ch01" | "ch02",
  variant: number,
  texture: (part: number) => string,
  alpha: (part: number) => ClassicAlphaMode,
): readonly HuntressLookPart[] {
  return Array.from({ length: 6 }, (_, index) => {
    const part = index + 1;
    return {
      meshStem: stem(base, part, variant),
      textureStem: texture(part),
      alpha: alpha(part),
    };
  });
}

function stem(base: "ch01" | "ch02", part: number, variant: number): string {
  return `${base}${String(part).padStart(2, "0")}${variant}`;
}
