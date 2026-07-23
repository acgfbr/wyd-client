import type { WydPosition } from "../../world/coordinates";

export const CLASSIC_QUEST_RESET_INTERVAL_MILLISECONDS = 10 * 60 * 1_000;

export interface ClassicTimedQuest {
  readonly key: "cemiterio" | "cabuncle";
  readonly name: string;
  readonly entrance: WydPosition;
  readonly bounds: {
    readonly minX: number;
    readonly maxX: number;
    readonly minY: number;
    readonly maxY: number;
  };
  readonly generatorIds: ReadonlySet<number>;
}

/**
 * The bounds are the recovered Generator start rectangles, including each
 * generator's StartRange=3. Entrance coordinates remain outside those combat
 * rectangles and therefore do not accidentally grant quest aggro.
 */
export const CLASSIC_TIMED_QUESTS: readonly ClassicTimedQuest[] = [
  {
    key: "cemiterio",
    name: "Cemitério",
    entrance: { x: 2376, y: 2104 },
    bounds: { minX: 2381, maxX: 2422, minY: 2078, maxY: 2127 },
    generatorIds: inclusiveIntegerSet(3606, 3618),
  },
  {
    key: "cabuncle",
    name: "Cabuncle",
    entrance: { x: 2230, y: 1714 },
    bounds: { minX: 2230, maxX: 2255, minY: 1703, maxY: 1725 },
    generatorIds: inclusiveIntegerSet(3619, 3628),
  },
] as const;

const questByGeneratorId = new Map<number, ClassicTimedQuest>();
for (const quest of CLASSIC_TIMED_QUESTS) {
  for (const generatorId of quest.generatorIds) questByGeneratorId.set(generatorId, quest);
}

export function classicTimedQuestForGenerator(generatorId: number): ClassicTimedQuest | null {
  return questByGeneratorId.get(generatorId) ?? null;
}

export function isInsideClassicTimedQuest(
  quest: ClassicTimedQuest,
  position: WydPosition,
): boolean {
  return position.x >= quest.bounds.minX
    && position.x <= quest.bounds.maxX
    && position.y >= quest.bounds.minY
    && position.y <= quest.bounds.maxY;
}

/**
 * Offline clients share the same wall-clock-aligned ten-minute boundary.
 * A future authoritative server should replace Date.now() with server time.
 */
export function classicQuestResetSecondsRemaining(nowMilliseconds = Date.now()): number {
  const normalized = Number.isFinite(nowMilliseconds) ? Math.max(0, nowMilliseconds) : 0;
  const elapsed = normalized % CLASSIC_QUEST_RESET_INTERVAL_MILLISECONDS;
  const remaining = elapsed === 0
    ? CLASSIC_QUEST_RESET_INTERVAL_MILLISECONDS
    : CLASSIC_QUEST_RESET_INTERVAL_MILLISECONDS - elapsed;
  return Math.max(1, Math.ceil(remaining / 1_000));
}

export function formatClassicQuestReset(secondsRemaining: number): string {
  const seconds = Math.max(0, Math.ceil(secondsRemaining));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function inclusiveIntegerSet(first: number, last: number): ReadonlySet<number> {
  const values = new Set<number>();
  for (let value = first; value <= last; value++) values.add(value);
  return values;
}
