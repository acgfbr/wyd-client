import { describe, expect, it } from "vitest";
import { parseTrn, TRN_TILE_BYTES, TRN_TILE_COUNT } from "../../../src/formats/classic/Trn";

function fixture(): ArrayBuffer {
  const name = "Armia";
  const buffer = new ArrayBuffer(1 + name.length + 2 + TRN_TILE_COUNT * TRN_TILE_BYTES);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  bytes[0] = name.length;
  bytes.set(new TextEncoder().encode(name), 1);
  bytes[1 + name.length] = 16;
  bytes[2 + name.length] = 16;
  const tile = 3 + name.length;
  view.setInt8(tile, -12);
  view.setUint8(tile + 1, 7);
  view.setUint8(tile + 2, 3);
  view.setUint8(tile + 3, 9);
  view.setUint8(tile + 4, 12);
  view.setUint32(tile + 8, 0xff336699, true);
  return buffer;
}

describe("parseTrn", () => {
  it("lê cabeçalho e FileTileInfo com padding do MSVC", () => {
    const block = parseTrn(fixture());
    expect(block.name).toBe("Armia");
    expect([block.column, block.row]).toEqual([16, 16]);
    expect(block.tiles).toHaveLength(4096);
    expect(block.tiles[0]).toEqual({
      height: -12,
      texture: 7,
      textureOrientation: 3,
      backgroundTexture: 9,
      backgroundOrientation: 12,
      colorArgb: 0xff336699,
    });
  });

  it("recusa arquivo truncado", () => {
    expect(() => parseTrn(new ArrayBuffer(8))).toThrow();
  });
});
