import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import type { InventoryItem } from "../state/PlayerState";
import type { ClassicPlayerClassDefinition } from "./PlayerClasses";

const CATALOG_FILE = "player/mantuas.json";

interface RawMantuaItem {
  readonly index: number;
  readonly name: string;
  readonly mesh: number;
  readonly textureIndex: number;
  readonly grade: number;
  readonly texture: string;
  readonly alpha: "A" | "C" | "N";
}

interface RawMantuaCatalog {
  readonly version: 1;
  readonly items: readonly RawMantuaItem[];
}

export interface ClassicEquippedMantuaVisual {
  readonly itemIndex: number;
  readonly name: string;
  readonly textureIndex: number;
  readonly grade: number;
  readonly classRow: 0 | 1 | 2 | 3;
  readonly headItemIndex: number;
  readonly coatMesh: number;
}

const catalogJobs = new WeakMap<ClassicAssetSource, Promise<ClassicPlayerMantuaCatalog>>();

/** Exact Equip[15] item/texture adapter for the auxiliary mt01 rig. */
export class ClassicPlayerMantuaCatalog {
  readonly #items = new Map<number, RawMantuaItem>();

  private constructor(raw: RawMantuaCatalog) {
    for (const item of raw.items) this.#items.set(item.index, item);
  }

  static load(assets: ClassicAssetSource): Promise<ClassicPlayerMantuaCatalog> {
    const cached = catalogJobs.get(assets);
    if (cached) return cached;
    const job = (async () => {
      const response = await fetch(assets.dataUrl(CATALOG_FILE));
      if (!response.ok) throw new Error(`Catálogo de mantuas indisponível (${response.status})`);
      return new ClassicPlayerMantuaCatalog(validateCatalog(await response.json()));
    })();
    catalogJobs.set(assets, job);
    void job.catch(() => {
      if (catalogJobs.get(assets) === job) catalogJobs.delete(assets);
    });
    return job;
  }

  resolve(
    playerClass: ClassicPlayerClassDefinition,
    cape: InventoryItem | null,
    headItemIndex: number,
    coatMesh: number,
  ): ClassicEquippedMantuaVisual | null {
    if (!cape?.classicIndex) return null;
    const raw = this.#items.get(cape.classicIndex);
    if (!raw) return null;
    return {
      itemIndex: raw.index,
      name: cape.name || raw.name,
      textureIndex: raw.textureIndex,
      grade: raw.grade,
      classRow: playerClass.classIndex,
      headItemIndex,
      coatMesh,
    };
  }
}

export function loadClassicPlayerMantuaCatalog(
  assets: ClassicAssetSource,
): Promise<ClassicPlayerMantuaCatalog> {
  return ClassicPlayerMantuaCatalog.load(assets);
}

function validateCatalog(value: unknown): RawMantuaCatalog {
  if (!value || typeof value !== "object") throw new Error("Catálogo de mantuas inválido");
  const raw = value as Partial<RawMantuaCatalog>;
  if (raw.version !== 1 || !Array.isArray(raw.items)) {
    throw new Error("Versão do catálogo de mantuas incompatível");
  }
  return raw as RawMantuaCatalog;
}
