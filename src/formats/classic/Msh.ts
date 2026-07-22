const D3DFVF_POSITION_MASK = 0x00e;
const D3DFVF_NORMAL = 0x010;
const D3DFVF_TEXCOUNT_MASK = 0xf00;
const D3DFVF_TEXCOUNT_SHIFT = 8;
const D3DFVF_LASTBETA_UBYTE4 = 0x1000;

export interface MshModel {
  readonly parentBoneId: number;
  readonly meshBoneId: number;
  readonly fvf: number;
  readonly vertexStride: number;
  readonly influenceCount: number;
  readonly vertexCount: number;
  readonly indexCount: number;
  /** Original D3DX row-vector inverse-bind/offset matrices. */
  readonly paletteMatrices: readonly Float32Array[];
  /** BON/ANI bone id for each palette slot. */
  readonly paletteBoneIds: Uint32Array;
  readonly positions: Float32Array;
  readonly normals: Float32Array | null;
  readonly uvs: Float32Array | null;
  /** Four weights per vertex; unused lanes are zero. */
  readonly skinWeights: Float32Array;
  /** Four MSH palette-slot indices per vertex. */
  readonly paletteIndices: Uint8Array;
  /** Original Direct3D triangle-list winding. */
  readonly indices: Uint16Array;
  readonly trailingByteCount: number;
}

/** Parses the skinned MSH variant consumed by CMesh::LoadMesh. */
export function parseMsh(buffer: ArrayBuffer): MshModel {
  if (buffer.byteLength < 32) throw new Error("MSH truncado no cabecalho");
  const view = new DataView(buffer);

  const parentBoneId = view.getInt32(0, true);
  const meshBoneId = view.getUint32(4, true);
  const fvf = view.getUint32(8, true);
  const vertexStride = view.getUint32(12, true);
  const influenceCount = view.getUint32(16, true);
  const paletteCount = view.getUint32(20, true);
  const vertexCount = view.getUint32(24, true);
  const indexCount = view.getUint32(28, true);

  if (vertexStride < 12 || vertexStride > 256 || influenceCount > 4) {
    throw new Error(`MSH com formato de vertice invalido (stride ${vertexStride}, influencias ${influenceCount})`);
  }
  if (vertexCount === 0 || vertexCount > 1_000_000 || paletteCount > 1_024) {
    throw new Error(`MSH com contagens invalidas (${vertexCount} vertices, paleta ${paletteCount})`);
  }
  if (indexCount % 3 !== 0) throw new Error(`MSH com ${indexCount} indices; triangle list deveria ser multiplo de 3`);

  const betaCount = betaCountFromFvf(fvf);
  const packedBoneIndices = (fvf & D3DFVF_LASTBETA_UBYTE4) !== 0;
  if (influenceCount > 0 && (!packedBoneIndices || betaCount !== influenceCount)) {
    throw new Error(
      `MSH FVF 0x${fvf.toString(16)} nao corresponde a ${influenceCount} influencia(s)`,
    );
  }
  if (influenceCount > 0 && paletteCount === 0) throw new Error("MSH skinned sem paleta de bones");

  const paletteBytes = paletteCount * 64 + paletteCount * 4;
  const vertexBytes = vertexCount * vertexStride;
  const indexBytes = indexCount * 2;
  const dataEnd = 32 + paletteBytes + vertexBytes + indexBytes;
  if (!Number.isSafeInteger(dataEnd) || dataEnd > buffer.byteLength) {
    throw new Error(`MSH truncado: ${buffer.byteLength} byte(s), precisa de ${dataEnd}`);
  }
  const trailingByteCount = buffer.byteLength - dataEnd;
  // The complete classic set is exact except for one file with four padding bytes.
  if (trailingByteCount > 8) throw new Error(`MSH tem ${trailingByteCount} bytes inesperados no final`);

  let offset = 32;
  const paletteMatrices: Float32Array[] = [];
  for (let palette = 0; palette < paletteCount; palette++) {
    const matrix = new Float32Array(16);
    for (let component = 0; component < 16; component++) {
      matrix[component] = view.getFloat32(offset, true);
      offset += 4;
    }
    paletteMatrices.push(matrix);
  }

  const paletteBoneIds = new Uint32Array(paletteCount);
  for (let palette = 0; palette < paletteCount; palette++, offset += 4) {
    paletteBoneIds[palette] = view.getUint32(offset, true);
  }

  const positions = new Float32Array(vertexCount * 3);
  const hasNormal = (fvf & D3DFVF_NORMAL) !== 0;
  const textureCoordinateCount = (fvf & D3DFVF_TEXCOUNT_MASK) >>> D3DFVF_TEXCOUNT_SHIFT;
  const normals = hasNormal ? new Float32Array(vertexCount * 3) : null;
  const uvs = textureCoordinateCount > 0 ? new Float32Array(vertexCount * 2) : null;
  const skinWeights = new Float32Array(vertexCount * 4);
  const paletteIndices = new Uint8Array(vertexCount * 4);

  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const vertexStart = offset + vertex * vertexStride;
    const vertexEnd = vertexStart + vertexStride;
    let cursor = vertexStart;

    positions[vertex * 3] = view.getFloat32(cursor, true);
    positions[vertex * 3 + 1] = view.getFloat32(cursor + 4, true);
    positions[vertex * 3 + 2] = view.getFloat32(cursor + 8, true);
    cursor += 12;

    if (influenceCount > 0) {
      let explicitSum = 0;
      for (let influence = 0; influence < influenceCount - 1; influence++, cursor += 4) {
        const weight = view.getFloat32(cursor, true);
        skinWeights[vertex * 4 + influence] = weight;
        explicitSum += weight;
      }
      skinWeights[vertex * 4 + influenceCount - 1] = 1 - explicitSum;

      for (let lane = 0; lane < 4; lane++) {
        const paletteIndex = view.getUint8(cursor + lane);
        paletteIndices[vertex * 4 + lane] = paletteIndex;
        if (lane < influenceCount && paletteIndex >= paletteCount) {
          throw new Error(`MSH vertice ${vertex} referencia paleta ${paletteIndex}/${paletteCount}`);
        }
      }
      cursor += 4;
    }

    if (normals) {
      normals[vertex * 3] = view.getFloat32(cursor, true);
      normals[vertex * 3 + 1] = view.getFloat32(cursor + 4, true);
      normals[vertex * 3 + 2] = view.getFloat32(cursor + 8, true);
      cursor += 12;
    }
    if (uvs) {
      uvs[vertex * 2] = view.getFloat32(cursor, true);
      uvs[vertex * 2 + 1] = view.getFloat32(cursor + 4, true);
      cursor += 8;
    }
    if (cursor > vertexEnd) throw new Error(`MSH stride ${vertexStride} curto no vertice ${vertex}`);
  }
  offset += vertexBytes;

  const indices = new Uint16Array(indexCount);
  for (let index = 0; index < indexCount; index++, offset += 2) {
    const vertexIndex = view.getUint16(offset, true);
    if (vertexIndex >= vertexCount) throw new Error(`MSH indice ${vertexIndex}/${vertexCount} fora da faixa`);
    indices[index] = vertexIndex;
  }

  return {
    parentBoneId,
    meshBoneId,
    fvf,
    vertexStride,
    influenceCount,
    vertexCount,
    indexCount,
    paletteMatrices,
    paletteBoneIds,
    positions,
    normals,
    uvs,
    skinWeights,
    paletteIndices,
    indices,
    trailingByteCount,
  };
}

function betaCountFromFvf(fvf: number): number {
  switch (fvf & D3DFVF_POSITION_MASK) {
    case 0x006: return 1;
    case 0x008: return 2;
    case 0x00a: return 3;
    case 0x00c: return 4;
    case 0x00e: return 5;
    default: return 0;
  }
}
