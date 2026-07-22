export interface AniAnimation {
  /** Number of source keyframes in this file. */
  readonly tickCount: number;
  /** Number of matrix slots per keyframe. A slot is addressed by BON bone id. */
  readonly boneSlotCount: number;
  /** Tick-major D3DX matrices in their original row-vector layout. */
  readonly matrices: Float32Array;
}

/**
 * ANI layout:
 *
 * - uint32 tickCount
 * - uint32 boneSlotCount
 * - float32 matrix[tickCount][boneSlotCount][16]
 *
 * The old client calls the second field `numAniFrame`, but uses it as the
 * matrix/bone stride. The first field is the actual number of animation ticks.
 */
export function parseAni(buffer: ArrayBuffer): AniAnimation {
  if (buffer.byteLength < 8) throw new Error("ANI truncado no cabecalho");

  const view = new DataView(buffer);
  const tickCount = view.getUint32(0, true);
  const boneSlotCount = view.getUint32(4, true);
  if (tickCount === 0 || boneSlotCount === 0) {
    throw new Error(`ANI invalido: ${tickCount} tick(s), ${boneSlotCount} slot(s)`);
  }

  const matrixCount = tickCount * boneSlotCount;
  if (!Number.isSafeInteger(matrixCount)) throw new Error("ANI grande demais");
  const expectedBytes = 8 + matrixCount * 64;
  if (expectedBytes !== buffer.byteLength) {
    throw new Error(`ANI com tamanho invalido: ${buffer.byteLength}, esperado ${expectedBytes}`);
  }

  const matrices = new Float32Array(matrixCount * 16);
  let offset = 8;
  for (let index = 0; index < matrices.length; index++, offset += 4) {
    matrices[index] = view.getFloat32(offset, true);
  }

  return { tickCount, boneSlotCount, matrices };
}

export function aniMatrixOffset(animation: AniAnimation, tick: number, boneSlot: number): number {
  if (tick < 0 || tick >= animation.tickCount || boneSlot < 0 || boneSlot >= animation.boneSlotCount) {
    throw new RangeError(`Matriz ANI fora da faixa: tick ${tick}, slot ${boneSlot}`);
  }
  return (tick * animation.boneSlotCount + boneSlot) * 16;
}
