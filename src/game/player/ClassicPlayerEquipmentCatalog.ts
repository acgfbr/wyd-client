import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import type { EquipmentSlot } from "../state/PlayerState";
import type {
  ClassicPlayerClassDefinition,
  ClassicPlayerClassKey,
  ClassicPlayerLookDefinition,
  ClassicPlayerLookPart,
} from "./PlayerClasses";

const CATALOG_FILE = "player/equipment-looks.json";
const BODY_SLOTS = ["helmet", "armor", "pants", "gloves", "boots"] as const;

export type ClassicBodyEquipmentSlot = typeof BODY_SLOTS[number];

export type ClassicBodyEquipmentIndices = Readonly<
  Partial<Record<ClassicBodyEquipmentSlot, number | null>>
>;

interface RawEquipmentPart {
  readonly classKey: ClassicPlayerClassKey;
  readonly slot: ClassicBodyEquipmentSlot;
  readonly part: 2 | 3 | 4 | 5 | 6;
  readonly meshStem: string;
  readonly textureStem: string;
  readonly alpha: "A" | "C" | "N";
}

interface RawEquipmentItem {
  readonly index: number;
  readonly name: string;
  readonly itemClass: number;
  readonly position: number;
  readonly mesh: number;
  readonly texture: number;
  readonly variants: readonly RawEquipmentPart[];
}

interface RawEquipmentCatalog {
  readonly version: 1;
  readonly items: readonly RawEquipmentItem[];
}

const catalogJobs = new WeakMap<ClassicAssetSource, Promise<ClassicPlayerEquipmentCatalog>>();

/**
 * Read-only LOOK_INFO body catalog generated from ItemList.bin and the exact
 * filename rules used by TMSkinMesh::RestoreDeviceObjects.
 */
export class ClassicPlayerEquipmentCatalog {
  readonly #parts = new Map<string, RawEquipmentPart>();

  private constructor(raw: RawEquipmentCatalog) {
    for (const item of raw.items) {
      for (const variant of item.variants) {
        this.#parts.set(partKey(item.index, variant.classKey, variant.slot), variant);
      }
    }
  }

  static load(assets: ClassicAssetSource): Promise<ClassicPlayerEquipmentCatalog> {
    const cached = catalogJobs.get(assets);
    if (cached) return cached;
    const job = (async () => {
      const response = await fetch(assets.dataUrl(CATALOG_FILE));
      if (!response.ok) {
        throw new Error(`Catálogo LOOK_INFO indisponível (${response.status})`);
      }
      const raw = validateCatalog(await response.json());
      return new ClassicPlayerEquipmentCatalog(raw);
    })();
    catalogJobs.set(assets, job);
    void job.catch(() => {
      if (catalogJobs.get(assets) === job) catalogJobs.delete(assets);
    });
    return job;
  }

  /**
   * Composes only the five ordinary equipment parts. A costume remains a
   * separate full-body override and must be resolved before this method.
   */
  composeLook(
    playerClass: ClassicPlayerClassDefinition,
    equipment: ClassicBodyEquipmentIndices,
  ): ClassicPlayerLookDefinition {
    const parts = [...playerClass.baseParts] as ClassicPlayerLookPart[];
    const applied: string[] = [];
    for (const slot of BODY_SLOTS) {
      const itemIndex = equipment[slot];
      if (!itemIndex) continue;
      const resolved = this.#parts.get(partKey(itemIndex, playerClass.key, slot));
      if (!resolved) continue;
      parts[resolved.part - 1] = {
        meshStem: resolved.meshStem,
        textureStem: resolved.textureStem,
        alpha: resolved.alpha,
      };
      applied.push(`${slot}:${itemIndex}`);
    }
    return {
      key: classicBodyEquipmentLookKey(playerClass.key, equipment),
      name: applied.length > 0
        ? `Equipamento ${playerClass.name}`
        : `Traje básico ${playerClass.name}`,
      itemIndex: null,
      source: "ItemList.bin LOOK_INFO + TMSkinMesh::RestoreDeviceObjects",
      parts,
    };
  }

  supports(
    itemIndex: number,
    classKey: ClassicPlayerClassKey,
    slot: EquipmentSlot,
  ): boolean {
    return isBodySlot(slot) && this.#parts.has(partKey(itemIndex, classKey, slot));
  }
}

export function loadClassicPlayerEquipmentCatalog(
  assets: ClassicAssetSource,
): Promise<ClassicPlayerEquipmentCatalog> {
  return ClassicPlayerEquipmentCatalog.load(assets);
}

export function classicBodyEquipmentIndices(
  equipment: Readonly<Record<EquipmentSlot, { readonly item: { readonly classicIndex?: number } } | null>>,
): ClassicBodyEquipmentIndices {
  return Object.fromEntries(BODY_SLOTS.map((slot) => [
    slot,
    equipment[slot]?.item.classicIndex ?? null,
  ]));
}

export function hasClassicBodyEquipment(indices: ClassicBodyEquipmentIndices): boolean {
  return BODY_SLOTS.some((slot) => (indices[slot] ?? 0) > 0);
}

export function classicBodyEquipmentLookKey(
  classKey: ClassicPlayerClassKey,
  indices: ClassicBodyEquipmentIndices,
): string {
  const suffix = BODY_SLOTS
    .flatMap((slot) => {
      const itemIndex = indices[slot];
      return itemIndex ? [`${slot}:${itemIndex}`] : [];
    })
    .join("-");
  return `${classKey}-equipment-${suffix || "base"}`;
}

function isBodySlot(slot: EquipmentSlot): slot is ClassicBodyEquipmentSlot {
  return (BODY_SLOTS as readonly EquipmentSlot[]).includes(slot);
}

function partKey(
  itemIndex: number,
  classKey: ClassicPlayerClassKey,
  slot: ClassicBodyEquipmentSlot,
): string {
  return `${itemIndex}:${classKey}:${slot}`;
}

function validateCatalog(value: unknown): RawEquipmentCatalog {
  if (!value || typeof value !== "object") throw new Error("Catálogo LOOK_INFO inválido");
  const raw = value as Partial<RawEquipmentCatalog>;
  if (raw.version !== 1 || !Array.isArray(raw.items)) {
    throw new Error("Versão do catálogo LOOK_INFO incompatível");
  }
  return raw as RawEquipmentCatalog;
}
