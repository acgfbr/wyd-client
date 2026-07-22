export interface MapObjectRecord {
  readonly type: number;
  readonly localX: number;
  readonly localY: number;
  readonly height: number;
  readonly angle: number;
  readonly textureSet: number;
  readonly mask: number;
  readonly scaleH: number;
  readonly scaleV: number;
}

export function parseDat(buffer: ArrayBuffer): readonly MapObjectRecord[] {
  const view = new DataView(buffer);
  const records: MapObjectRecord[] = [];
  let offset = 0;
  while (offset + 28 <= view.byteLength) {
    const type = view.getUint32(offset, true);
    const extended = type >= 501 && type < 600;
    if (extended && offset + 36 > view.byteLength) throw new Error(`DAT truncado no offset ${offset}`);
    records.push({
      type,
      localX: view.getFloat32(offset + 4, true),
      localY: view.getFloat32(offset + 8, true),
      height: view.getFloat32(offset + 12, true),
      angle: view.getFloat32(offset + 16, true),
      textureSet: view.getInt32(offset + 20, true),
      mask: view.getInt32(offset + 24, true),
      scaleH: extended ? view.getFloat32(offset + 28, true) : 1,
      scaleV: extended ? view.getFloat32(offset + 32, true) : 1,
    });
    offset += extended ? 36 : 28;
  }
  if (offset !== view.byteLength) throw new Error(`DAT possui ${view.byteLength - offset} byte(s) excedentes`);
  return records;
}

