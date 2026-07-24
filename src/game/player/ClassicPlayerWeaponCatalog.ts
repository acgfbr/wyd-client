import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import type { InventoryItem } from "../state/PlayerState";
import { classicHumanoidWeaponAnimationType } from "../npcs/ClassicSkinnedAssetLibrary";
import type { ClassicPlayerClassDefinition } from "./PlayerClasses";

const CATALOG_FILE = "player/weapons.json";

export type ClassicWeaponSide = "left" | "right";

interface RawWeaponItem {
  readonly index: number;
  readonly name: string;
  readonly itemClass: number;
  readonly position: number;
  readonly modelType: number;
  readonly texture: number;
  readonly visualEffect: number;
  readonly weaponType: number;
  readonly fallbackTexture: string | null;
  readonly fallbackAlpha: "A" | "C" | "N" | null;
}

interface RawWeaponCatalog {
  readonly version: 1;
  readonly items: readonly RawWeaponItem[];
}

export interface ClassicEquippedWeaponVisual {
  readonly side: ClassicWeaponSide;
  readonly itemIndex: number;
  readonly name: string;
  readonly modelType: number;
  readonly weaponType: number;
  readonly position: number;
  readonly refinement: number;
  readonly ancient: boolean;
  readonly refinementTextureIndex: number | null;
  readonly fallbackTexture: string | null;
  readonly fallbackAlpha: "A" | "C" | "N" | null;
  /** WTYPE 41 copies LeftMesh into RightMesh without changing itemR. */
  readonly mirroredFromLeft?: boolean;
}

export interface ClassicPlayerWeaponLoadout {
  readonly left: ClassicEquippedWeaponVisual | null;
  readonly right: ClassicEquippedWeaponVisual | null;
  readonly animationWeaponType: number;
  readonly mountedAnimationWeaponType: number;
}

export interface ClassicWeaponEquipmentInput {
  readonly leftHand: InventoryItem | null;
  readonly rightHand: InventoryItem | null;
}

const catalogJobs = new WeakMap<ClassicAssetSource, Promise<ClassicPlayerWeaponCatalog>>();

/** ItemList-backed adapter for the two HUMAN_LOOKINFO common-mesh hands. */
export class ClassicPlayerWeaponCatalog {
  readonly #items = new Map<number, RawWeaponItem>();

  private constructor(raw: RawWeaponCatalog) {
    for (const item of raw.items) this.#items.set(item.index, item);
  }

  static load(assets: ClassicAssetSource): Promise<ClassicPlayerWeaponCatalog> {
    const cached = catalogJobs.get(assets);
    if (cached) return cached;
    const job = (async () => {
      const response = await fetch(assets.dataUrl(CATALOG_FILE));
      if (!response.ok) throw new Error(`Catálogo de armas indisponível (${response.status})`);
      return new ClassicPlayerWeaponCatalog(validateCatalog(await response.json()));
    })();
    catalogJobs.set(assets, job);
    void job.catch(() => {
      if (catalogJobs.get(assets) === job) catalogJobs.delete(assets);
    });
    return job;
  }

  composeLoadout(
    playerClass: ClassicPlayerClassDefinition,
    equipment: ClassicWeaponEquipmentInput,
  ): ClassicPlayerWeaponLoadout {
    const leftSource = this.resolve("left", equipment.leftHand);
    const actualRight = this.resolve("right", equipment.rightHand);
    // TMHuman duplicates claws into the other visual hand, while CheckWeapon
    // deliberately continues to see an empty Equip[7].
    const right = actualRight ?? (
      leftSource?.weaponType === 41
        ? { ...leftSource, side: "right", mirroredFromLeft: true as const }
        : null
    );
    const animationInput = {
      skin: playerClass.skin,
      leftType: leftSource?.weaponType ?? 0,
      rightType: actualRight?.weaponType ?? 0,
      leftPosition: leftSource?.position ?? 0,
      rightPosition: actualRight?.position ?? 0,
    };
    return {
      left: leftSource,
      right,
      animationWeaponType: classicHumanoidWeaponAnimationType(animationInput),
      mountedAnimationWeaponType: classicHumanoidWeaponAnimationType({
        ...animationInput,
        mounted: true,
      }),
    };
  }

  item(itemIndex: number): RawWeaponItem | null {
    return this.#items.get(itemIndex) ?? null;
  }

  private resolve(
    side: ClassicWeaponSide,
    inventoryItem: InventoryItem | null,
  ): ClassicEquippedWeaponVisual | null {
    if (!inventoryItem?.classicIndex) return null;
    const raw = this.#items.get(inventoryItem.classicIndex);
    if (!raw) return null;
    return {
      side,
      itemIndex: raw.index,
      name: inventoryItem.name || raw.name,
      modelType: raw.modelType,
      weaponType: inventoryItem.weaponType ?? raw.weaponType,
      position: raw.position,
      refinement: Math.max(0, Math.trunc(inventoryItem.refinement ?? 0)),
      ancient: inventoryItem.ancient === true,
      refinementTextureIndex: inventoryItem.refinementTextureIndex ?? null,
      fallbackTexture: raw.fallbackTexture,
      fallbackAlpha: raw.fallbackAlpha,
    };
  }
}

export function loadClassicPlayerWeaponCatalog(
  assets: ClassicAssetSource,
): Promise<ClassicPlayerWeaponCatalog> {
  return ClassicPlayerWeaponCatalog.load(assets);
}

function validateCatalog(value: unknown): RawWeaponCatalog {
  if (!value || typeof value !== "object") throw new Error("Catálogo de armas inválido");
  const raw = value as Partial<RawWeaponCatalog>;
  if (raw.version !== 1 || !Array.isArray(raw.items)) {
    throw new Error("Versão do catálogo de armas incompatível");
  }
  return raw as RawWeaponCatalog;
}
