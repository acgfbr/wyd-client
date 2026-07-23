import {
  type ActiveClassBuff,
  type ClassSkillSystem,
  type ClassicClassKey,
  type ExternalClassBuffGrant,
} from "../combat/ClassSkills";
import type { ClassicMonsterSnapshot } from "./ClassicMonsterGameplay";

export const MASTER_CARB_BUFF_DURATION_SECONDS = 15 * 60;

/** Exact npcdb/template keys present in the imported 7.54 monster catalog. */
export const CLASSIC_MASTER_CARB_TEMPLATE_KEYS = Object.freeze([
  "Mestre_Carb_",
  "Mestre_Carb__",
  "Mestre_Carb___",
  "Mestre_Carb____",
  "_Mestre_Carb_",
] as const);

export type ClassicMasterCarbTemplateKey =
  (typeof CLASSIC_MASTER_CARB_TEMPLATE_KEYS)[number];

export type ClassicMasterCarbBuffCategory = "class" | "master";

export interface ClassicMasterCarbBuff extends ExternalClassBuffGrant {
  readonly category: ClassicMasterCarbBuffCategory;
  /** Original AffectTime from SkillData.bin, retained only as source metadata. */
  readonly classicDurationSeconds: number;
  readonly effectKey: null;
}

type SkillDataBuffRecord = readonly [
  classicIndex: number,
  category: ClassicMasterCarbBuffCategory,
  classKey: ClassicClassKey,
  name: string,
  iconIndex: number,
  instanceType: number,
  instanceValue: number,
  tickType: number,
  tickValue: number,
  affectType: number,
  affectValue: number,
  classicDurationSeconds: number,
];

/**
 * Exact `kind === "buff"` projection of the class/master records in the
 * imported SkillData.bin catalog (`public/game-data/classic/data/skills.json`,
 * version 3). Master-skill icon indices intentionally differ from their
 * classic skill indices. No stat formula or substitute VFX is inferred here.
 */
const SKILL_DATA_BUFF_RECORDS: readonly SkillDataBuffRecord[] = [
  [3, "class", "transknight", "Samaritano", 3, 0, 0, 0, 0, 14, 10, 15],
  [5, "class", "transknight", "Aura da Vida", 5, 0, 0, 17, 75, 0, 0, 12],
  [11, "class", "transknight", "Assalto", 11, 0, 0, 0, 0, 13, 7, 12],
  [13, "class", "transknight", "Possuído", 13, 0, 0, 0, 0, 24, 0, 12],
  [37, "class", "foema", "Trovão", 37, 0, 0, 22, 100, 0, 0, 12],
  [41, "class", "foema", "Velocidade", 41, 0, 0, 0, 0, 2, 1, 15],
  [43, "class", "foema", "Escudo Mágico", 43, 0, 0, 0, 0, 11, 15, 15],
  [44, "class", "foema", "Arma Mágica", 44, 0, 0, 0, 0, 9, 5, 15],
  [45, "class", "foema", "Toque da Athena", 45, 0, 0, 0, 0, 15, 7, 15],
  [46, "class", "foema", "Controle de Mana", 46, 0, 0, 0, 0, 18, 0, 10],
  [53, "class", "beastmaster", "Proteção Elemental", 53, 0, 0, 0, 0, 25, 10, 10],
  [54, "class", "beastmaster", "Força Elemental", 54, 0, 0, 23, 160, 0, 0, 12],
  [64, "class", "beastmaster", "Lobisomem", 64, 0, 0, 0, 0, 21, 1, 13],
  [66, "class", "beastmaster", "Homem Urso", 66, 0, 0, 0, 0, 16, 2, 11],
  [68, "class", "beastmaster", "Astaroth", 68, 0, 0, 0, 0, 16, 3, 13],
  [70, "class", "beastmaster", "Titã", 70, 0, 0, 0, 0, 16, 4, 13],
  [71, "class", "beastmaster", "Éden", 71, 0, 0, 0, 0, 16, 5, 13],
  [75, "class", "huntress", "Encantar Gelo", 75, 0, 0, 0, 0, 27, 1, 12],
  [76, "class", "huntress", "Imunidade", 76, 0, 0, 0, 0, 19, 15, 12],
  [77, "class", "huntress", "Meditação", 77, 0, 0, 0, 0, 21, 10, 12],
  [81, "class", "huntress", "Ligação Espectral", 81, 0, 0, 0, 0, 37, 0, 14],
  [85, "class", "huntress", "Escudo Dourado", 85, 0, 0, 0, 0, 31, 150, 30],
  [87, "class", "huntress", "Troca de Espírito", 87, 0, 160, 0, 0, 38, 0, 14],
  [89, "class", "huntress", "Evasão Aprimorada", 89, 0, 0, 0, 0, 26, 1, 12],
  [92, "class", "huntress", "Toxina de Serpente", 92, 0, 0, 0, 0, 36, 1, 12],
  [95, "class", "huntress", "Invisibilidade", 95, 0, 0, 0, 0, 28, 1, 3],
  [200, "master", "transknight", "Proteção Divina", 105, 0, 0, 0, 0, 6, 0, 1],
  [213, "master", "foema", "Proteção Absoluta", 118, 0, 0, 0, 0, 6, 0, 2],
  [216, "master", "foema", "Magia Misteriosa", 121, 0, 0, 0, 0, 42, 0, 12],
  [224, "master", "beastmaster", "Anti Magia", 129, 0, 0, 0, 0, 43, 0, 1],
  [225, "master", "beastmaster", "Chama Resistente", 130, 0, 0, 46, 100, 0, 0, 12],
  [235, "master", "beastmaster", "Last Resistance", 140, 0, 0, 0, 0, 48, 15, 1],
];

export const CLASSIC_MASTER_CARB_BUFFS: readonly ClassicMasterCarbBuff[] =
  defineMasterCarbBuffs(SKILL_DATA_BUFF_RECORDS);

const MASTER_CARB_TEMPLATE_KEY_SET: ReadonlySet<string> = new Set(
  CLASSIC_MASTER_CARB_TEMPLATE_KEYS,
);

export function isClassicMasterCarbTemplateKey(
  templateKey: string,
): templateKey is ClassicMasterCarbTemplateKey {
  return MASTER_CARB_TEMPLATE_KEY_SET.has(templateKey);
}

export function isClassicMasterCarb(
  npc: Pick<ClassicMonsterSnapshot, "templateKey">,
): boolean {
  return isClassicMasterCarbTemplateKey(npc.templateKey);
}

/** Refreshes all 32 class/master buffs to exactly fifteen minutes. */
export function grantClassicMasterCarbBuffs(
  skills: ClassSkillSystem,
): readonly ActiveClassBuff[] {
  return skills.grantExternalBuffs(CLASSIC_MASTER_CARB_BUFFS);
}

function defineMasterCarbBuffs(
  records: readonly SkillDataBuffRecord[],
): readonly ClassicMasterCarbBuff[] {
  if (records.length !== 32) {
    throw new Error(`Mestre Carb: esperado catálogo de 32 buffs, recebido ${records.length}`);
  }
  const indices = new Set<number>();
  const buffs = records.map(([
    classicIndex,
    category,
    classKey,
    name,
    iconIndex,
    instanceType,
    instanceValue,
    tickType,
    tickValue,
    affectType,
    affectValue,
    classicDurationSeconds,
  ]) => {
    if (indices.has(classicIndex)) {
      throw new Error(`Mestre Carb: buff clássico duplicado #${classicIndex}`);
    }
    indices.add(classicIndex);
    return Object.freeze({
      category,
      classKey,
      classicIndex,
      name,
      iconIndex,
      instanceType,
      instanceValue,
      tickType,
      tickValue,
      affectType,
      affectValue,
      classicDurationSeconds,
      durationSeconds: MASTER_CARB_BUFF_DURATION_SECONDS,
      effectKey: null,
    });
  });
  return Object.freeze(buffs);
}
