import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import type {
  ClassicPlayerClassDefinition,
  ClassicPlayerClassKey,
  ClassicPlayerLookDefinition,
} from "./PlayerClasses";

const CATALOG_FILE = "player/faces.json";

interface RawPlayerFace {
  readonly index: number;
  readonly name: string;
  readonly classKey: ClassicPlayerClassKey;
  readonly itemClass: number;
  readonly mesh: number;
  readonly texture: number;
  readonly meshStem: string;
  readonly textureStem: string;
  readonly alpha: "A" | "C" | "N";
  readonly mirrorsHelmet: boolean;
  readonly helmetMeshStem: string | null;
  readonly helmetTextureStem: string | null;
  readonly helmetAlpha: "A" | "C" | "N" | null;
}

interface RawPlayerFaceCatalog {
  readonly version: 1;
  readonly items: readonly RawPlayerFace[];
}

const catalogJobs = new WeakMap<ClassicAssetSource, Promise<ClassicPlayerFaceCatalog>>();

/**
 * Exact Equip[0] catalog for the four playable races. Equip[0] owns class/rig
 * identity and LOOK_INFO part 1; it deliberately stays separate from helmets.
 */
export class ClassicPlayerFaceCatalog {
  readonly #faces = new Map<number, RawPlayerFace>();

  private constructor(raw: RawPlayerFaceCatalog) {
    for (const face of raw.items) this.#faces.set(face.index, face);
  }

  static load(assets: ClassicAssetSource): Promise<ClassicPlayerFaceCatalog> {
    const cached = catalogJobs.get(assets);
    if (cached) return cached;
    const job = (async () => {
      const response = await fetch(assets.dataUrl(CATALOG_FILE));
      if (!response.ok) throw new Error(`Catálogo Equip[0] indisponível (${response.status})`);
      return new ClassicPlayerFaceCatalog(validateCatalog(await response.json()));
    })();
    catalogJobs.set(assets, job);
    void job.catch(() => {
      if (catalogJobs.get(assets) === job) catalogJobs.delete(assets);
    });
    return job;
  }

  composeLook(
    playerClass: ClassicPlayerClassDefinition,
    faceItemIndex: number,
    look: ClassicPlayerLookDefinition,
  ): ClassicPlayerLookDefinition {
    const face = this.#faces.get(faceItemIndex);
    if (!face || face.classKey !== playerClass.key || face.itemClass !== playerClass.itemClass) {
      return look;
    }
    const parts = [...look.parts];
    parts[0] = {
      meshStem: face.meshStem,
      textureStem: face.textureStem,
      alpha: face.alpha,
    };
    if (
      face.mirrorsHelmet
      && face.helmetMeshStem
      && face.helmetTextureStem
      && face.helmetAlpha
    ) {
      parts[1] = {
        meshStem: face.helmetMeshStem,
        textureStem: face.helmetTextureStem,
        alpha: face.helmetAlpha,
      };
    }
    return {
      ...look,
      key: `${look.key}-face:${face.index}`,
      source: `${look.source} + ItemList Equip[0] #${face.index}`,
      parts,
    };
  }
}

export function loadClassicPlayerFaceCatalog(
  assets: ClassicAssetSource,
): Promise<ClassicPlayerFaceCatalog> {
  return ClassicPlayerFaceCatalog.load(assets);
}

function validateCatalog(value: unknown): RawPlayerFaceCatalog {
  if (!value || typeof value !== "object") throw new Error("Catálogo Equip[0] inválido");
  const raw = value as Partial<RawPlayerFaceCatalog>;
  if (raw.version !== 1 || !Array.isArray(raw.items)) {
    throw new Error("Versão do catálogo Equip[0] incompatível");
  }
  return raw as RawPlayerFaceCatalog;
}
