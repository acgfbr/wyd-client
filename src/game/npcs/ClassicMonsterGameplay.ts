import type { WydPosition } from "../../world/coordinates";

export interface ClassicMonsterSnapshot {
  readonly id: string;
  readonly name: string;
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

export interface ClassicMonsterEventMap {
  readonly hit: ClassicMonsterHitEvent;
  readonly death: ClassicMonsterDeathEvent;
  readonly respawn: ClassicMonsterRespawnEvent;
  readonly drop: ClassicMonsterDropEvent;
  readonly monsterAttack: ClassicMonsterAttackEvent;
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
