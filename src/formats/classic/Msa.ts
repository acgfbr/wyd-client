import * as THREE from "three";

interface AttributeRange {
  readonly faceStart: number;
  readonly faceCount: number;
}

export interface MsaModel {
  readonly geometry: THREE.BufferGeometry;
  readonly textureNames: readonly string[];
}

export function parseMsa(buffer: ArrayBuffer): MsaModel {
  const view = new DataView(buffer);
  if (view.byteLength < 12) throw new Error("MSA truncado");
  const fvf = view.getUint32(0, true);
  const vertexStride = view.getUint32(4, true);
  const attributeCount = view.getUint32(8, true);
  let offset = 12;
  const ranges: AttributeRange[] = [];
  for (let index = 0; index < attributeCount; index++) {
    if (offset + 20 > view.byteLength) throw new Error("MSA truncado na tabela de atributos");
    ranges.push({ faceStart: view.getUint32(offset + 4, true), faceCount: view.getUint32(offset + 8, true) });
    offset += 20;
  }

  const textureNames: string[] = [];
  for (let index = 0; index < attributeCount; index++) {
    if (offset + 11 > view.byteLength) throw new Error("MSA truncado na tabela de texturas");
    const bytes = new Uint8Array(buffer, offset, 11);
    const end = bytes.indexOf(0);
    textureNames.push(new TextDecoder("latin1").decode(bytes.subarray(0, end < 0 ? 11 : end)));
    offset += 11;
  }

  const indexBytes = view.getUint32(offset, true);
  offset += 4;
  if (offset + indexBytes + 4 > view.byteLength || indexBytes % 2 !== 0) throw new Error("Index buffer MSA inválido");
  const indices: number[] = [];
  for (let byte = 0; byte < indexBytes; byte += 6) {
    if (byte + 6 > indexBytes) break;
    const a = view.getUint16(offset + byte, true);
    const b = view.getUint16(offset + byte + 2, true);
    const c = view.getUint16(offset + byte + 4, true);
    indices.push(a, c, b);
  }
  offset += indexBytes;

  const vertexBytes = view.getUint32(offset, true);
  offset += 4;
  if (vertexStride === 0 || offset + vertexBytes > view.byteLength || vertexBytes % vertexStride !== 0) throw new Error("Vertex buffer MSA inválido");
  const vertexCount = vertexBytes / vertexStride;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const hasNormals = fvf === 274 || fvf === 18;
  const uvOffset = fvf === 274 ? 24 : fvf === 322 ? 16 : -1;
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const start = offset + vertex * vertexStride;
    positions.push(view.getFloat32(start, true), view.getFloat32(start + 4, true), -view.getFloat32(start + 8, true));
    if (hasNormals) normals.push(view.getFloat32(start + 12, true), view.getFloat32(start + 16, true), -view.getFloat32(start + 20, true));
    if (uvOffset >= 0) uvs.push(view.getFloat32(start + uvOffset, true), view.getFloat32(start + uvOffset + 4, true));
    else uvs.push(0, 0);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  if (hasNormals) geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  else geometry.computeVertexNormals();
  for (let index = 0; index < ranges.length; index++) {
    const range = ranges[index]!;
    geometry.addGroup(range.faceStart * 3, range.faceCount * 3, index);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, textureNames };
}
