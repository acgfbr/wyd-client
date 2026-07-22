import type { MapObjectRecord } from "../../formats/classic/Dat";
import {
  ATTRIBUTE_MAP_SIDE,
  OBJECT_MASK_COUNT,
  OBJECT_MASK_SIDE,
  type ClassicNavigationData,
} from "../../formats/classic/NavigationData";
import type { TrnBlock } from "../../formats/classic/Trn";
import { FIELD_WORLD_SIZE } from "../coordinates";
import { buildClassicTerrainMask, type ClassicCollisionMask } from "./ClassicNavigation";

const MAX_CLASSIC_FIELD_OBJECTS = 4096;

/**
 * Builds the final classic m_HeightMapData for one resident Field:
 * LoadTileMap, every TMObject::RegisterMask call, then BASE_ApplyAttribute.
 */
export function composeClassicCollisionMask(
  block: TrnBlock,
  records: readonly MapObjectRecord[],
  data: ClassicNavigationData,
): ClassicCollisionMask {
  const values = buildClassicTerrainMask(block);
  const recordCount = Math.min(records.length, MAX_CLASSIC_FIELD_OBJECTS);
  for (let index = 0; index < recordCount; index++) {
    const record = records[index];
    if (record && classicObjectRegistersMask(record.type)) {
      registerClassicObjectMask(values, record, data.objectMasks.values);
    }
  }
  applyClassicAttributes(values, block.column, block.row, data.attributes.values);
  return { values, complete: true };
}

/** Mirrors the early-continue branches in TMObjectContainer::Load. */
export function classicObjectRegistersMask(type: number): boolean {
  if (type === 2 || type === 343 || type === 4 || type === 6 || type === 7 || type === 344 || type === 12) return false;
  if (type >= 311 && type <= 322) return false;
  if (type === 121) return false;
  if (type >= 501 && type <= 506) return false;
  if ((type >= 511 && type <= 518) || (type >= 520 && type <= 530)) return false;
  if (type === 532 || type === 10 || type === 1980 || type === 1846) return false;
  return true;
}

function registerClassicObjectMask(
  fieldMask: Int8Array,
  record: MapObjectRecord,
  objectMasks: Int8Array,
): void {
  const maskIndex = Math.trunc(record.mask);
  if (maskIndex < 0 || maskIndex >= OBJECT_MASK_COUNT) return;

  // `float revAngle = D3DXToRadian(180) - m_fAngle * -1.0f`.
  const revAngle = Math.fround(Math.fround(Math.PI) - Math.fround(Math.fround(record.angle) * -1));
  const cosine = Math.cos(revAngle);
  const sine = Math.sin(revAngle);
  const baseX = Math.trunc(record.localX) - 7;
  const baseY = Math.trunc(record.localY) - 7;
  const sourceBase = maskIndex * OBJECT_MASK_SIDE * OBJECT_MASK_SIDE;

  for (let y = 0; y < OBJECT_MASK_SIDE; y++) {
    const fy = y + 0.5 - 7.5;
    for (let x = 0; x < OBJECT_MASK_SIDE; x++) {
      const fx = x + 0.5 - 7.5;
      const tx = Math.fround(cosine * fx - sine * fy);
      const ty = Math.fround(sine * fx + cosine * fy);
      const sourceX = Math.trunc(Math.fround(tx + 7.5));
      const sourceY = Math.trunc(Math.fround(ty + 7.5));
      if (sourceX < 0 || sourceY < 0 || sourceX >= OBJECT_MASK_SIDE || sourceY >= OBJECT_MASK_SIDE) continue;
      const sourceValue = objectMasks[sourceBase + sourceY * OBJECT_MASK_SIDE + sourceX] ?? 0;
      if (sourceValue === 0) continue;

      const targetX = baseX + x;
      const targetY = baseY + y;
      // RegisterMask accepts 128 even though m_pMaskData is [128][128]. MSVC's
      // contiguous layout makes x=128 alias x=0 of the following row; preserve
      // that in-array quirk, but discard writes that really leave m_pMaskData.
      if (targetX < 0 || targetY < 0 || targetX > FIELD_WORLD_SIZE || targetY > FIELD_WORLD_SIZE) continue;

      const scaledHeight = Math.fround(Math.fround(record.height) / Math.fround(0.1));
      let candidate = Math.trunc(Math.fround(scaledHeight + 3 * sourceValue));
      if (record.height > 0) candidate++;
      if (candidate > 127) candidate = 127;
      candidate = signedByte(candidate);
      const targetIndex = targetY * FIELD_WORLD_SIZE + targetX;
      if (targetIndex >= fieldMask.length) continue;
      if (candidate > (fieldMask[targetIndex] ?? 0)) fieldMask[targetIndex] = candidate;
    }
  }
}

function applyClassicAttributes(
  fieldMask: Int8Array,
  column: number,
  row: number,
  attributes: Uint8Array,
): void {
  const worldBaseX = column * FIELD_WORLD_SIZE;
  const worldBaseY = row * FIELD_WORLD_SIZE;
  for (let localY = 0; localY < FIELD_WORLD_SIZE; localY++) {
    const attributeY = ((worldBaseY + localY) >> 2) & (ATTRIBUTE_MAP_SIDE - 1);
    for (let localX = 0; localX < FIELD_WORLD_SIZE; localX++) {
      const attributeX = ((worldBaseX + localX) >> 2) & (ATTRIBUTE_MAP_SIDE - 1);
      if (((attributes[attributeY * ATTRIBUTE_MAP_SIDE + attributeX] ?? 0) & 2) !== 0) {
        fieldMask[localY * FIELD_WORLD_SIZE + localX] = 127;
      }
    }
  }
}

function signedByte(value: number): number {
  const byte = value & 0xff;
  return byte > 127 ? byte - 256 : byte;
}
