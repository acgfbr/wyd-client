import { BinaryReader } from "../../core/binary/BinaryReader";

export const TRN_SIDE = 64;
export const TRN_TILE_COUNT = TRN_SIDE * TRN_SIDE;
export const TRN_TILE_BYTES = 12;

export interface TrnTile {
  readonly height: number;
  readonly texture: number;
  readonly textureOrientation: number;
  readonly backgroundTexture: number;
  readonly backgroundOrientation: number;
  readonly colorArgb: number;
}

export interface TrnBlock {
  readonly name: string;
  readonly column: number;
  readonly row: number;
  readonly tiles: readonly TrnTile[];
}

/**
 * Decodifica o formato lido por TMGround::LoadTileMap no cliente clássico.
 * FileTileInfo ocupa 12 bytes no MSVC por causa do padding antes de dwColor.
 */
export function parseTrn(buffer: ArrayBuffer): TrnBlock {
  const reader = new BinaryReader(buffer);
  const nameLength = reader.uint8();

  if (nameLength > 128) throw new Error(`Nome de mapa inválido: ${nameLength} bytes`);

  const name = reader.ascii(nameLength).replace(/\0+$/, "");
  const column = reader.uint8();
  const row = reader.uint8();
  const expectedPayload = TRN_TILE_COUNT * TRN_TILE_BYTES;

  if (reader.remaining !== expectedPayload) {
    throw new Error(`TRN inválido: restam ${reader.remaining} bytes; esperado ${expectedPayload}`);
  }

  const tiles: TrnTile[] = [];
  for (let index = 0; index < TRN_TILE_COUNT; index++) {
    const height = reader.int8();
    const texture = reader.uint8();
    const textureOrientation = reader.uint8();
    const backgroundTexture = reader.uint8();
    const backgroundOrientation = reader.uint8();
    reader.uint8(); // padding do struct C++ antes do uint32
    reader.uint8();
    reader.uint8();
    const colorArgb = reader.uint32LE();

    tiles.push({ height, texture, textureOrientation, backgroundTexture, backgroundOrientation, colorArgb });
  }

  return { name, column, row, tiles };
}
