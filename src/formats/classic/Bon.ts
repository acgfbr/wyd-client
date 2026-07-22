export interface BonBone {
  /** Bone id used by ANI slots and MSH palette entries. */
  readonly id: number;
  /** -1 marks a skeleton root. */
  readonly parentId: number;
}

export interface BonSkeleton {
  readonly bones: readonly BonBone[];
  readonly slotCount: number;
  readonly rootIds: readonly number[];
  readonly duplicateIds: readonly number[];
}

/**
 * BON has no header: the complete file is a sequence of
 * `{ parentId: int32, boneId: uint32 }` records.
 *
 * Record order is not the animation order. ANI matrices are addressed by
 * `boneId`, and a few late-game skeletons contain gaps (or even duplicate ids),
 * so consumers must not use the BON row as an ANI slot.
 */
export function parseBon(buffer: ArrayBuffer): BonSkeleton {
  if (buffer.byteLength === 0 || buffer.byteLength % 8 !== 0) {
    throw new Error(`BON invalido: ${buffer.byteLength} byte(s), esperado multiplo de 8`);
  }

  const view = new DataView(buffer);
  const bones: BonBone[] = [];
  const roots: number[] = [];
  const seen = new Set<number>();
  const duplicateIds: number[] = [];
  let maximumId = -1;

  for (let offset = 0; offset < view.byteLength; offset += 8) {
    const parentId = view.getInt32(offset, true);
    const id = view.getUint32(offset + 4, true);
    bones.push({ id, parentId });
    if (parentId === -1) roots.push(id);
    if (seen.has(id) && !duplicateIds.includes(id)) duplicateIds.push(id);
    seen.add(id);
    maximumId = Math.max(maximumId, id);
  }

  return {
    bones,
    slotCount: maximumId + 1,
    rootIds: roots,
    duplicateIds,
  };
}
