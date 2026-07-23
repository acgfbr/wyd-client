import { loadClassicCommerceCatalog, type ClassicCommerceItem } from "../commerce/ClassicCommerceCatalog";
import type { ClassicMonsterDropEvent } from "../npcs/ClassicMonsterGameplay";
import type { InventoryItem } from "../state/PlayerState";
import type {
  ClassicGroundItemEffects,
  OfflineClassicGroundItemSnapshot,
} from "./ClassicGroundItemTypes";

const HEALTH_POTION_ITEM_INDEX = 400;
const MANA_POTION_ITEM_INDEX = 405;
const ORIHARUCON_DUST_ITEM_INDEX = 412;
const LACTOLERIUM_DUST_ITEM_INDEX = 413;
const HEALTH_EFFECT = 4;
const MANA_EFFECT = 5;

type OfflineDropItemIndex =
  | typeof HEALTH_POTION_ITEM_INDEX
  | typeof MANA_POTION_ITEM_INDEX
  | typeof ORIHARUCON_DUST_ITEM_INDEX
  | typeof LACTOLERIUM_DUST_ITEM_INDEX;

const ZERO_INSTANCE_EFFECTS = Object.freeze([
  Object.freeze({ effect: 0, value: 0 }),
  Object.freeze({ effect: 0, value: 0 }),
  Object.freeze({ effect: 0, value: 0 }),
]) as ClassicGroundItemEffects;

export const OFFLINE_CLASSIC_GROUND_ITEM_POLICY_SOURCE = "offline-basic-drop-demo-no-drop-table" as const;

export interface OfflineClassicGroundItemPickupDelivery {
  readonly id: string;
  readonly groundItem: OfflineClassicGroundItemSnapshot;
  readonly item: InventoryItem;
  readonly quantity: 1;
  /** This DTO is local demo output, not a server pickup acknowledgement. */
  readonly source: typeof OFFLINE_CLASSIC_GROUND_ITEM_POLICY_SOURCE;
}

/**
 * Deterministic frontend-only policy: 34% ItemList #400, 24% #405, 6% #412,
 * 4% #413 and otherwise no ground item. These rates are a gameplay mock; only
 * the item identities and presentation data come from the classic client.
 *
 * The recovered client has item definitions, but no authoritative monster
 * drop tables. This function must not be presented as retail/server loot.
 */
export function selectOfflineGroundItemDrop(
  event: Pick<ClassicMonsterDropEvent, "seed">,
): OfflineDropItemIndex | null {
  const roll = (event.seed >>> 0) % 100;
  if (roll < 34) return HEALTH_POTION_ITEM_INDEX;
  if (roll < 58) return MANA_POTION_ITEM_INDEX;
  if (roll < 64) return ORIHARUCON_DUST_ITEM_INDEX;
  if (roll < 68) return LACTOLERIUM_DUST_ITEM_INDEX;
  return null;
}

/**
 * Converts a visual ground snapshot into an inventory DTO from ItemList data.
 * It does not insert, stack or otherwise mutate the player's inventory.
 */
export async function offlineGroundItemToInventoryItem(
  snapshot: Pick<OfflineClassicGroundItemSnapshot, "classicIndex">,
): Promise<InventoryItem> {
  if (
    snapshot.classicIndex !== HEALTH_POTION_ITEM_INDEX
    && snapshot.classicIndex !== MANA_POTION_ITEM_INDEX
    && snapshot.classicIndex !== ORIHARUCON_DUST_ITEM_INDEX
    && snapshot.classicIndex !== LACTOLERIUM_DUST_ITEM_INDEX
  ) {
    throw new Error(`Item de chão fora da política offline: ${snapshot.classicIndex}`);
  }

  const catalog = await loadClassicCommerceCatalog();
  const classicItem = catalog.item(snapshot.classicIndex);
  if (!classicItem) {
    throw new Error(`ItemList #${snapshot.classicIndex} ausente do catálogo clássico`);
  }
  return classicOfflineInventoryItem(classicItem);
}

/**
 * Isolated pending-item gateway for the offline demo.
 *
 * `receiveMonsterDrop` only materializes a client-side snapshot. A successful
 * `confirmPickup` removes it and returns a delivery DTO to the caller; applying
 * that DTO to inventory is intentionally outside this class.
 */
export class OfflineClassicGroundItemGateway {
  readonly #pending = new Map<string, OfflineClassicGroundItemSnapshot>();
  readonly #confirmationJobs = new Map<
    string,
    Promise<OfflineClassicGroundItemPickupDelivery | null>
  >();

  receiveMonsterDrop(event: ClassicMonsterDropEvent): OfflineClassicGroundItemSnapshot | null {
    const classicIndex = selectOfflineGroundItemDrop(event);
    if (classicIndex === null) return null;

    const id = offlineGroundItemId(event);
    const existing = this.#pending.get(id);
    if (existing) return existing;

    const snapshot = Object.freeze<OfflineClassicGroundItemSnapshot>({
      id,
      classicIndex,
      effects: ZERO_INSTANCE_EFFECTS,
      // MSG_CreateItem carries integer GridX/GridY. Spawn snapshots are
      // continuous actor coordinates, so quantize before the renderer applies
      // the retail +0.5 cell-centering transform.
      position: Object.freeze({
        x: Math.floor(event.position.x),
        y: Math.floor(event.position.y),
      }),
      rotateQuarterTurns: ((event.seed >>> 8) & 3) as 0 | 1 | 2 | 3,
      owner: null,
      createFx: true,
    });
    this.#pending.set(id, snapshot);
    return snapshot;
  }

  get(id: string): OfflineClassicGroundItemSnapshot | null {
    return this.#pending.get(id) ?? null;
  }

  snapshots(): readonly OfflineClassicGroundItemSnapshot[] {
    return Object.freeze([...this.#pending.values()]);
  }

  /** Cancels a pending presentation without producing a pickup delivery. */
  remove(id: string): boolean {
    return this.#pending.delete(id);
  }

  clear(): void {
    this.#pending.clear();
  }

  confirmPickup(id: string): Promise<OfflineClassicGroundItemPickupDelivery | null> {
    const existingJob = this.#confirmationJobs.get(id);
    if (existingJob) return existingJob;

    const snapshot = this.#pending.get(id);
    if (!snapshot) return Promise.resolve(null);

    const job = (async (): Promise<OfflineClassicGroundItemPickupDelivery | null> => {
      const item = await offlineGroundItemToInventoryItem(snapshot);
      // `remove`/`clear` may invalidate the pickup while ItemList is loading.
      if (this.#pending.get(id) !== snapshot) return null;
      this.#pending.delete(id);
      return Object.freeze({
        id,
        groundItem: snapshot,
        item,
        quantity: 1,
        source: OFFLINE_CLASSIC_GROUND_ITEM_POLICY_SOURCE,
      });
    })();

    this.#confirmationJobs.set(id, job);
    const releaseJob = (): void => {
      if (this.#confirmationJobs.get(id) === job) this.#confirmationJobs.delete(id);
    };
    void job.then(releaseJob, releaseJob);
    return job;
  }
}

function offlineGroundItemId(event: ClassicMonsterDropEvent): string {
  return `offline-ground:${event.source.id}:${event.seed >>> 0}`;
}

function classicOfflineInventoryItem(item: ClassicCommerceItem): InventoryItem {
  const heal = effectValue(item, HEALTH_EFFECT);
  const mana = effectValue(item, MANA_EFFECT);
  if (item.index === HEALTH_POTION_ITEM_INDEX && heal <= 0) {
    throw new Error(`ItemList #${item.index} não contém EF${HEALTH_EFFECT}`);
  }
  if (item.index === MANA_POTION_ITEM_INDEX && mana <= 0) {
    throw new Error(`ItemList #${item.index} não contém EF${MANA_EFFECT}`);
  }

  const name = item.name.replaceAll("_", " ").trim();
  const isPotion = item.index === HEALTH_POTION_ITEM_INDEX || item.index === MANA_POTION_ITEM_INDEX;
  const restorativeEffect = heal > 0
    ? `EF${HEALTH_EFFECT} ${heal}`
    : mana > 0
      ? `EF${MANA_EFFECT} ${mana}`
      : null;
  return Object.freeze({
    key: `classic-item-${item.index}`,
    name,
    description: restorativeEffect
      ? `${name} · ItemList #${item.index} · ${restorativeEffect}.`
      : `${name} · material clássico · ItemList #${item.index}.`,
    rarity: "common",
    // Ordinary STRUCT_ITEM materials have no quantity field; each dust keeps
    // its own inventory position in this offline representation.
    maxStack: isPotion ? 50 : 1,
    value: item.staticDisplayPrice.amount,
    kind: isPotion ? "consumable" : "material",
    classicIndex: item.index,
    previewModelType: item.mesh,
    ...(heal > 0 ? { heal } : {}),
    ...(mana > 0 ? { mana } : {}),
  });
}

function effectValue(item: ClassicCommerceItem, effect: number): number {
  return item.effects.find((candidate) => candidate.effect === effect)?.value ?? 0;
}
