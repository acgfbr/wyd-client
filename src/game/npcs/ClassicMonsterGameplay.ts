import type { WydPosition } from "../../world/coordinates";

/**
 * Coarse offline routing for the interaction branches in the 7.54 client.
 * Some classic branches additionally inspect the current Field, equipment or
 * server state; those intentionally collapse to `special` here.
 */
export type ClassicNpcInteractionKind =
  | "none"
  | "shop"
  | "cargo"
  | "quest"
  | "mix"
  | "premium"
  | "special";

export interface ClassicMonsterSnapshot {
  readonly id: string;
  readonly name: string;
  readonly generatorId: number;
  readonly templateIndex: number;
  readonly templateKey: string;
  readonly interactionCode: number;
  readonly headItemIndex: number;
  readonly interactionKind: ClassicNpcInteractionKind;
  readonly position: WydPosition;
  readonly hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
  readonly hostile: boolean;
}

export interface ClassicMonsterHitEvent {
  readonly target: ClassicMonsterSnapshot;
  readonly damage: number;
  readonly remainingHp: number;
}

export interface ClassicMonsterDeathEvent {
  readonly target: ClassicMonsterSnapshot;
  readonly killer: "player";
  readonly respawnInSeconds: number;
}

export interface ClassicMonsterRespawnEvent {
  readonly target: ClassicMonsterSnapshot;
}

/** Logical reward payload; a later inventory layer decides what is materialized. */
export interface ClassicMonsterDropEvent {
  readonly source: ClassicMonsterSnapshot;
  readonly position: WydPosition;
  readonly experience: number;
  readonly coin: number;
  readonly seed: number;
}

export interface ClassicMonsterAttackEvent {
  readonly attacker: ClassicMonsterSnapshot;
  readonly playerPosition: WydPosition;
  readonly damage: number;
  readonly distance: number;
}

export interface ClassicActorSoundEvent {
  readonly source: ClassicMonsterSnapshot;
  readonly action: string;
  readonly soundIndex: number;
  readonly position: WydPosition;
}

export interface ClassicMonsterEventMap {
  readonly hit: ClassicMonsterHitEvent;
  readonly death: ClassicMonsterDeathEvent;
  readonly respawn: ClassicMonsterRespawnEvent;
  readonly drop: ClassicMonsterDropEvent;
  readonly monsterAttack: ClassicMonsterAttackEvent;
  readonly actorSound: ClassicActorSoundEvent;
}

export type ClassicMonsterEventName = keyof ClassicMonsterEventMap;
export type ClassicMonsterEventListener<K extends ClassicMonsterEventName> = (
  event: ClassicMonsterEventMap[K],
) => void;

export type ClassicStrikeResult =
  | {
    readonly ok: true;
    readonly target: ClassicMonsterSnapshot;
    readonly damage: number;
    readonly killed: boolean;
  }
  | {
    readonly ok: false;
    readonly id: string;
    readonly reason: "not-found" | "dead" | "invalid-damage";
  };
