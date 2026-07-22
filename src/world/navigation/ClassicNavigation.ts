import type { TrnBlock } from "../../formats/classic/Trn";
import { TRN_SIDE } from "../../formats/classic/Trn";
import { FIELD_WORLD_SIZE, HEIGHT_SCALE, fieldAt, type WydPosition } from "../coordinates";

export const CLASSIC_NAVIGATION_SIDE = 128;
export const CLASSIC_BLOCKED_MASK = 126;
export const CLASSIC_MAX_STEP_HEIGHT = 8;

export interface ClassicCollisionMask {
  /**
   * Final client mask, row-major, one signed byte per WYD coordinate.
   * A complete mask includes terrain, AttributeMap.dat and object.bin stamps.
   */
  readonly values: ArrayLike<number>;
  /** Raw AttributeMap byte sampled at each WYD cell of this resident Field. */
  readonly attributes?: ArrayLike<number>;
  readonly complete: boolean;
}

export interface ClassicNavigationSource {
  /** Only resident TRNs are visible to navigation; this never triggers I/O. */
  readonly terrainAt: (column: number, row: number) => TrnBlock | undefined;
  /** Optional future hook for the fully reconstructed m_pMaskData. */
  readonly collisionMaskAt?: (column: number, row: number) => ClassicCollisionMask | undefined;
}

export type ClassicWalkability = "walkable" | "blocked" | "unloaded";

export interface ClassicNavigationSample {
  readonly cell: WydPosition;
  readonly field: { readonly column: number; readonly row: number };
  readonly walkability: ClassicWalkability;
  readonly mask: number | null;
  readonly height: number | null;
  /** False means that static object/AttributeMap collision can still be missing. */
  readonly authoritative: boolean;
}

export interface ClassicPathOptions {
  readonly allowDiagonal?: boolean;
  /** Client calls BASE_GetRoute with MH=8; comparison is strict (< MH). */
  readonly maxStepHeight?: number;
  readonly maxVisited?: number;
}

export type ClassicPathStatus =
  | "found"
  | "already-there"
  | "blocked"
  | "unloaded"
  | "unreachable"
  | "limit";

export interface ClassicPathResult {
  readonly status: ClassicPathStatus;
  /** Integer WYD cells, including start and goal when a path is found. */
  readonly points: readonly WydPosition[];
  readonly visited: number;
  /** False means the path is terrain-valid but may still cross missing static collision. */
  readonly authoritative: boolean;
  /** Fields encountered by the search but not resident in the streaming window. */
  readonly missingFields: readonly { readonly column: number; readonly row: number }[];
}

interface CachedFieldMask {
  readonly values: Int8Array;
  readonly complete: boolean;
}

interface SearchNode {
  readonly x: number;
  readonly y: number;
  readonly g: number;
  readonly h: number;
  readonly f: number;
}

interface CellMask {
  readonly value: number;
  readonly complete: boolean;
}

const CARDINAL_DIRECTIONS = [
  { x: 0, y: -1, cost: 1 },
  { x: 1, y: 0, cost: 1 },
  { x: 0, y: 1, cost: 1 },
  { x: -1, y: 0, cost: 1 },
] as const;

const DIAGONAL_DIRECTIONS = [
  { x: 1, y: -1, cost: Math.SQRT2 },
  { x: 1, y: 1, cost: Math.SQRT2 },
  { x: -1, y: 1, cost: Math.SQRT2 },
  { x: -1, y: -1, cost: Math.SQRT2 },
] as const;

const ALL_DIRECTIONS = [...CARDINAL_DIRECTIONS, ...DIAGONAL_DIRECTIONS] as const;

/**
 * Values from TMGround::SetAttatchEnable, in left/right/up/down order.
 *
 * 0 seals a 14/15-cell border, 1 is a streamed cardinal connection and 2 is
 * an intentionally isolated map whose edge remains unpainted. Unlisted Fields
 * keep the constructor default (0000), exactly as the classic client does.
 */
const CLASSIC_ATTACHMENTS: Readonly<Record<string, string>> = {
  "1,1": "2222",
  "16,15": "0001",
  "16,16": "0110",
  "17,16": "1100",
  "18,16": "1101",
  "18,17": "0010",
  "19,16": "1110",
  "19,15": "0111",
  "20,16": "1010",
  "20,15": "1001",
  "19,14": "0011",
  "19,13": "1111",
  "19,12": "0001",
  "20,13": "1000",
  "18,13": "1110",
  "18,12": "1001",
  "17,13": "0110",
  "17,12": "1111",
  "17,11": "0011",
  "17,10": "0011",
  "17,9": "2201",
  "15,13": "1010",
  "16,12": "1100",
  "15,12": "0101",
  "14,13": "1100",
  "6,28": "2222",
  "13,31": "2222",
  "14,30": "2222",
  "15,31": "2222",
  "13,13": "1111",
  "12,13": "1100",
  "11,13": "1100",
  "10,13": "1101",
  "9,13": "1100",
  "8,13": "0100",
  "10,14": "0010",
  "13,14": "0010",
  "13,12": "0001",
  "1,31": "2222",
  "1,29": "0100",
  "2,29": "1100",
  "3,29": "1101",
  "4,29": "1100",
  "5,29": "1000",
  "3,30": "0011",
  "3,31": "0010",
  "5,31": "0100",
  "6,31": "1110",
  "7,31": "1000",
  "6,30": "0001",
  "7,29": "0100",
  "8,29": "1000",
  "10,11": "2222",
  "9,31": "0100",
  "10,31": "1100",
  "11,31": "1000",
  "10,29": "0100",
  "11,29": "1000",
  "9,28": "2222",
  "8,27": "2222",
  "10,27": "2222",
  "8,2": "2222",
  "9,1": "2222",
  "10,2": "2222",
  "13,28": "0100",
  "14,28": "1000",
  "17,31": "0110",
  "18,31": "1100",
  "19,31": "1010",
  "17,30": "0101",
  "18,30": "1100",
  "19,30": "1001",
  "17,28": "2222",
  "31,31": "2222",
  "25,13": "2222",
  "26,8": "2222",
  "26,9": "2222",
  "26,10": "2222",
  "26,11": "2222",
  "26,12": "2222",
  "27,11": "2222",
  "8,16": "0110",
  "9,16": "1010",
  "8,15": "0101",
  "9,15": "1001",
  "28,24": "0010",
  "28,23": "1111",
  "27,23": "0110",
  "29,23": "1212",
  "27,22": "0101",
  "28,22": "1111",
  "28,21": "0001",
  "29,22": "1101",
  "30,22": "1000",
  "28,28": "0000",
  "29,27": "0000",
  "30,28": "0000",
};

/**
 * Read-only navigation over the subset of Fields currently held by streaming.
 * It performs no fetch and retains no strong reference to an unloaded TRN.
 */
export class ClassicNavigation {
  readonly #terrainMasks = new WeakMap<TrnBlock, Int8Array>();

  constructor(private readonly source: ClassicNavigationSource) {}

  sample(position: WydPosition): ClassicNavigationSample {
    const cell = integerCell(position);
    const field = fieldAt(cell);
    const mask = this.maskAt(cell.x, cell.y);
    if (!mask) {
      return {
        cell,
        field,
        walkability: "unloaded",
        mask: null,
        height: null,
        authoritative: false,
      };
    }
    return {
      cell,
      field,
      walkability: isBlocked(mask.value) ? "blocked" : "walkable",
      mask: mask.value,
      height: mask.value * HEIGHT_SCALE,
      authoritative: mask.complete,
    };
  }

  canStep(from: WydPosition, to: WydPosition, options: ClassicPathOptions = {}): boolean {
    const start = integerCell(from);
    const end = integerCell(to);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (dx === 0 && dy === 0) return this.sample(start).walkability === "walkable";
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return false;
    if (dx !== 0 && dy !== 0 && options.allowDiagonal === false) return false;
    const maxStepHeight = options.maxStepHeight ?? CLASSIC_MAX_STEP_HEIGHT;
    return this.canTraverse(start.x, start.y, end.x, end.y, maxStepHeight);
  }

  /**
   * Validates the exact segment followed by click-to-move, visiting every WYD
   * cell crossed by the ray. This is the continuous counterpart of the
   * per-cell checks made by BASE_GetRoute/StraightRouteTable in the client.
   */
  canTravelDirectly(
    fromPosition: WydPosition,
    toPosition: WydPosition,
    options: ClassicPathOptions = {},
  ): boolean {
    if (
      !Number.isFinite(fromPosition.x)
      || !Number.isFinite(fromPosition.y)
      || !Number.isFinite(toPosition.x)
      || !Number.isFinite(toPosition.y)
    ) {
      return false;
    }

    const start = integerCell(fromPosition);
    const goal = integerCell(toPosition);
    const startMask = this.maskAt(start.x, start.y);
    const goalMask = this.maskAt(goal.x, goal.y);
    if (!startMask || !goalMask || isBlocked(startMask.value) || isBlocked(goalMask.value)) return false;
    if (start.x === goal.x && start.y === goal.y) return true;

    const rayX = toPosition.x - fromPosition.x;
    const rayY = toPosition.y - fromPosition.y;
    const stepX = Math.sign(rayX);
    const stepY = Math.sign(rayY);
    const deltaX = stepX === 0 ? Number.POSITIVE_INFINITY : 1 / Math.abs(rayX);
    const deltaY = stepY === 0 ? Number.POSITIVE_INFINITY : 1 / Math.abs(rayY);
    let crossingX = firstGridCrossing(fromPosition.x, start.x, rayX, stepX);
    let crossingY = firstGridCrossing(fromPosition.y, start.y, rayY, stepY);
    let cellX = start.x;
    let cellY = start.y;
    const maxStepHeight = options.maxStepHeight ?? CLASSIC_MAX_STEP_HEIGHT;
    const allowDiagonal = options.allowDiagonal ?? true;

    while (cellX !== goal.x || cellY !== goal.y) {
      let nextX = cellX;
      let nextY = cellY;
      if (crossingX < crossingY) {
        nextX += stepX;
        crossingX += deltaX;
      } else if (crossingY < crossingX) {
        nextY += stepY;
        crossingY += deltaY;
      } else {
        nextX += stepX;
        nextY += stepY;
        crossingX += deltaX;
        crossingY += deltaY;
      }

      if (nextX !== cellX && nextY !== cellY && !allowDiagonal) return false;
      if (!this.canTraverse(cellX, cellY, nextX, nextY, maxStepHeight)) return false;
      cellX = nextX;
      cellY = nextY;
    }
    return true;
  }

  findPath(
    startPosition: WydPosition,
    goalPosition: WydPosition,
    options: ClassicPathOptions = {},
  ): ClassicPathResult {
    const start = integerCell(startPosition);
    const goal = integerCell(goalPosition);
    const startMask = this.maskAt(start.x, start.y);
    const goalMask = this.maskAt(goal.x, goal.y);
    const missingFields = new Map<string, { column: number; row: number }>();

    if (!startMask || !goalMask) {
      if (!startMask) rememberMissingField(start.x, start.y, missingFields);
      if (!goalMask) rememberMissingField(goal.x, goal.y, missingFields);
      return pathResult("unloaded", [], 0, false, missingFields);
    }
    if (isBlocked(startMask.value) || isBlocked(goalMask.value)) {
      return pathResult("blocked", [], 0, startMask.complete && goalMask.complete, missingFields);
    }
    if (start.x === goal.x && start.y === goal.y) {
      return pathResult("already-there", [start], 0, startMask.complete, missingFields);
    }

    const allowDiagonal = options.allowDiagonal ?? true;
    const maxStepHeight = options.maxStepHeight ?? CLASSIC_MAX_STEP_HEIGHT;
    const maxVisited = Math.max(1, Math.floor(options.maxVisited ?? 131_072));
    const frontier = new MinHeap();
    const startKey = cellKey(start.x, start.y);
    const goalKey = cellKey(goal.x, goal.y);
    const costs = new Map<string, number>([[startKey, 0]]);
    const parents = new Map<string, string>();
    const cells = new Map<string, WydPosition>([[startKey, start]]);
    const closed = new Set<string>();
    let authoritative = startMask.complete && goalMask.complete;
    let visited = 0;

    const startHeuristic = heuristic(start.x, start.y, goal.x, goal.y, allowDiagonal);
    frontier.push({ x: start.x, y: start.y, g: 0, h: startHeuristic, f: startHeuristic });

    const directions = allowDiagonal ? ALL_DIRECTIONS : CARDINAL_DIRECTIONS;
    while (frontier.size > 0) {
      const current = frontier.pop();
      if (!current) break;
      const currentKey = cellKey(current.x, current.y);
      if (closed.has(currentKey)) continue;
      if (current.g !== costs.get(currentKey)) continue;
      closed.add(currentKey);
      visited++;

      if (currentKey === goalKey) {
        return pathResult(
          "found",
          reconstructPath(goalKey, parents, cells),
          visited,
          authoritative,
          missingFields,
        );
      }
      if (visited >= maxVisited) {
        return pathResult("limit", [], visited, authoritative, missingFields);
      }

      for (const direction of directions) {
        const nextX = current.x + direction.x;
        const nextY = current.y + direction.y;
        const nextMask = this.maskAt(nextX, nextY);
        if (!nextMask) {
          rememberMissingField(nextX, nextY, missingFields);
          continue;
        }
        authoritative &&= nextMask.complete;
        if (!this.canTraverse(current.x, current.y, nextX, nextY, maxStepHeight)) continue;

        const nextKey = cellKey(nextX, nextY);
        if (closed.has(nextKey)) continue;
        const nextCost = current.g + direction.cost;
        if (nextCost >= (costs.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
        costs.set(nextKey, nextCost);
        parents.set(nextKey, currentKey);
        cells.set(nextKey, { x: nextX, y: nextY });
        const nextHeuristic = heuristic(nextX, nextY, goal.x, goal.y, allowDiagonal);
        frontier.push({
          x: nextX,
          y: nextY,
          g: nextCost,
          h: nextHeuristic,
          f: nextCost + nextHeuristic,
        });
      }
    }

    return pathResult("unreachable", [], visited, authoritative, missingFields);
  }

  private canTraverse(fromX: number, fromY: number, toX: number, toY: number, maxStepHeight: number): boolean {
    const from = this.maskAt(fromX, fromY);
    const to = this.maskAt(toX, toY);
    if (!from || !to || isBlocked(from.value) || isBlocked(to.value)) return false;
    if (Math.abs(to.value - from.value) >= maxStepHeight) return false;

    const dx = toX - fromX;
    const dy = toY - fromY;
    if (dx === 0 || dy === 0) return true;

    // BASE_GetRoute permits a diagonal when at least one adjacent cardinal
    // cell has a valid height transition from the current cell.
    const horizontal = this.maskAt(fromX + dx, fromY);
    const vertical = this.maskAt(fromX, fromY + dy);
    return cardinalTransitionIsOpen(from, horizontal, maxStepHeight)
      || cardinalTransitionIsOpen(from, vertical, maxStepHeight);
  }

  private maskAt(x: number, y: number): CellMask | null {
    const field = fieldAt({ x, y });
    const block = this.source.terrainAt(field.column, field.row);
    if (!block) return null;
    const localX = x - field.column * FIELD_WORLD_SIZE;
    const localY = y - field.row * FIELD_WORLD_SIZE;
    if (localX < 0 || localY < 0 || localX >= CLASSIC_NAVIGATION_SIDE || localY >= CLASSIC_NAVIGATION_SIDE) {
      return null;
    }

    const imported = this.source.collisionMaskAt?.(field.column, field.row);
    if (imported && imported.values.length >= CLASSIC_NAVIGATION_SIDE * CLASSIC_NAVIGATION_SIDE) {
      return {
        value: signedByte(imported.values[localY * CLASSIC_NAVIGATION_SIDE + localX] ?? 0),
        complete: imported.complete,
      };
    }

    let values = this.#terrainMasks.get(block);
    if (!values) {
      values = buildClassicTerrainMask(block);
      this.#terrainMasks.set(block, values);
    }
    return { value: values[localY * CLASSIC_NAVIGATION_SIDE + localX] ?? 0, complete: false };
  }
}

/** Exact m_pMaskData produced by TMGround::LoadTileMap before static objects. */
export function buildClassicTerrainMask(block: TrnBlock): Int8Array {
  const mask = new Int8Array(CLASSIC_NAVIGATION_SIDE * CLASSIC_NAVIGATION_SIDE);
  for (let tileY = 0; tileY < TRN_SIDE; tileY++) {
    for (let tileX = 0; tileX < TRN_SIDE; tileX++) {
      const f1 = terrainHeight(block, tileX, tileY);
      const f3 = tileY < 62 ? terrainHeight(block, tileX, tileY + 1) : f1;
      const f2 = tileX < 62 ? terrainHeight(block, tileX + 1, tileY) : f1;
      const f4 = tileX < 62
        ? (tileY < 62 ? terrainHeight(block, tileX + 1, tileY + 1) : f2)
        : (tileY < 62 ? f3 : f1);
      const center = (f1 + f2 + f3 + f4) / 4;
      const x = tileX * 2;
      const y = tileY * 2;
      mask[y * CLASSIC_NAVIGATION_SIDE + x] = Math.trunc((f1 + center) / 2);
      mask[y * CLASSIC_NAVIGATION_SIDE + x + 1] = Math.trunc((f2 + center) / 2);
      mask[(y + 1) * CLASSIC_NAVIGATION_SIDE + x] = Math.trunc((f3 + center) / 2);
      mask[(y + 1) * CLASSIC_NAVIGATION_SIDE + x + 1] = Math.trunc((f4 + center) / 2);
    }
  }
  applyClassicFieldBorders(mask, block.column, block.row);
  return mask;
}

function terrainHeight(block: TrnBlock, column: number, row: number): number {
  // LoadTileMap replaces column zero with column one, then row zero with row
  // one before constructing m_pMaskData. This remains independent of Attach.
  const sourceColumn = column === 0 ? 1 : column;
  const sourceRow = row === 0 ? 1 : row;
  return block.tiles[sourceRow * TRN_SIDE + sourceColumn]?.height ?? 0;
}

function applyClassicFieldBorders(mask: Int8Array, column: number, row: number): void {
  const code = CLASSIC_ATTACHMENTS[`${column},${row}`] ?? "0000";
  const left = Number(code[0]);
  const right = Number(code[1]);
  const up = Number(code[2]);
  const down = Number(code[3]);

  if (up === 0) fillRect(mask, 0, 0, 128, 15);
  if (down === 0) fillRect(mask, 0, 114, 128, 14);
  if (left === 0) fillRect(mask, 0, 0, 15, 128);
  if (right === 0) fillRect(mask, 114, 0, 14, 128);

  if (left === 1 && down === 1) fillRect(mask, 0, 113, 16, 15);
  if (left === 1 && up === 1) fillRect(mask, 0, 0, 16, 16);
  if (right === 1 && down === 1) fillRect(mask, 113, 113, 15, 15);
  if (right === 1 && up === 1) fillRect(mask, 113, 0, 15, 16);
}

function fillRect(mask: Int8Array, x: number, y: number, width: number, height: number): void {
  for (let row = y; row < y + height; row++) {
    mask.fill(127, row * CLASSIC_NAVIGATION_SIDE + x, row * CLASSIC_NAVIGATION_SIDE + x + width);
  }
}

function isBlocked(mask: number): boolean {
  return mask >= CLASSIC_BLOCKED_MASK;
}

function cardinalTransitionIsOpen(from: CellMask, to: CellMask | null, maxStepHeight: number): boolean {
  return to !== null
    && !isBlocked(to.value)
    && Math.abs(to.value - from.value) < maxStepHeight;
}

function signedByte(value: number): number {
  const byte = value & 0xff;
  return byte > 127 ? byte - 256 : byte;
}

function integerCell(position: WydPosition): WydPosition {
  return { x: Math.floor(position.x), y: Math.floor(position.y) };
}

function firstGridCrossing(position: number, cell: number, ray: number, step: number): number {
  if (step === 0) return Number.POSITIVE_INFINITY;
  const boundary = step > 0 ? cell + 1 : cell;
  return (boundary - position) / ray;
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function rememberMissingField(
  x: number,
  y: number,
  fields: Map<string, { column: number; row: number }>,
): void {
  const field = fieldAt({ x, y });
  fields.set(`${field.column},${field.row}`, field);
}

function heuristic(x: number, y: number, goalX: number, goalY: number, diagonal: boolean): number {
  const dx = Math.abs(goalX - x);
  const dy = Math.abs(goalY - y);
  if (!diagonal) return dx + dy;
  const shared = Math.min(dx, dy);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * shared;
}

function reconstructPath(
  goalKey: string,
  parents: ReadonlyMap<string, string>,
  cells: ReadonlyMap<string, WydPosition>,
): readonly WydPosition[] {
  const path: WydPosition[] = [];
  let key: string | undefined = goalKey;
  while (key) {
    const cell = cells.get(key);
    if (!cell) break;
    path.push(cell);
    key = parents.get(key);
  }
  path.reverse();
  return path;
}

function pathResult(
  status: ClassicPathStatus,
  points: readonly WydPosition[],
  visited: number,
  authoritative: boolean,
  missingFields: ReadonlyMap<string, { column: number; row: number }>,
): ClassicPathResult {
  return {
    status,
    points,
    visited,
    authoritative,
    missingFields: [...missingFields.values()],
  };
}

class MinHeap {
  readonly #nodes: SearchNode[] = [];

  get size(): number {
    return this.#nodes.length;
  }

  push(node: SearchNode): void {
    this.#nodes.push(node);
    let index = this.#nodes.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      const parentNode = this.#nodes[parent];
      if (!parentNode || compareSearchNodes(parentNode, node) <= 0) break;
      this.#nodes[index] = parentNode;
      index = parent;
    }
    this.#nodes[index] = node;
  }

  pop(): SearchNode | undefined {
    const root = this.#nodes[0];
    const tail = this.#nodes.pop();
    if (!root || !tail || this.#nodes.length === 0) return root;

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.#nodes.length) break;
      let child = left;
      if (
        right < this.#nodes.length
        && this.#nodes[right]
        && this.#nodes[left]
        && compareSearchNodes(this.#nodes[right]!, this.#nodes[left]!) < 0
      ) {
        child = right;
      }
      const childNode = this.#nodes[child];
      if (!childNode || compareSearchNodes(childNode, tail) >= 0) break;
      this.#nodes[index] = childNode;
      index = child;
    }
    this.#nodes[index] = tail;
    return root;
  }
}

function compareSearchNodes(left: SearchNode, right: SearchNode): number {
  const scoreDifference = left.f - right.f;
  if (Math.abs(scoreDifference) > 1e-9) return scoreDifference;

  // BASE_GetRoute keeps advancing toward the target instead of alternating
  // equally good cardinal/diagonal steps. Lower remaining distance reproduces
  // that preference without changing A*'s path cost.
  const remainingDifference = left.h - right.h;
  if (Math.abs(remainingDifference) > 1e-9) return remainingDifference;
  return right.g - left.g;
}
