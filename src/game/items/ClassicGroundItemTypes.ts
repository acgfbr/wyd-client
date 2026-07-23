import type { WydPosition } from "../../world/coordinates";

export interface ClassicGroundItemEffect {
  readonly effect: number;
  readonly value: number;
}

export type ClassicGroundItemEffects = readonly [
  ClassicGroundItemEffect,
  ClassicGroundItemEffect,
  ClassicGroundItemEffect,
];

export type ClassicGroundItemQuarterTurns = 0 | 1 | 2 | 3;

/**
 * Presentation contract shared by the offline gateway and the Three.js ground
 * item renderer. It mirrors only the client-visible fields needed locally;
 * ownership and item-instance effects remain server-owned in the real game.
 */
export interface ClassicGroundItemSnapshot {
  readonly id: string;
  readonly classicIndex: number;
  readonly effects: ClassicGroundItemEffects;
  readonly position: WydPosition;
  readonly rotateQuarterTurns: ClassicGroundItemQuarterTurns;
  readonly owner?: string | number | null;
  readonly createFx: boolean;
}

/** Exact subset currently emitted by the isolated offline mock gateway. */
export interface OfflineClassicGroundItemSnapshot extends ClassicGroundItemSnapshot {
  readonly owner: null;
  readonly createFx: true;
}
