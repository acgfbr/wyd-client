import * as THREE from "three";
import type { TrnBlock, TrnTile } from "../../formats/classic/Trn";
import { TRN_SIDE } from "../../formats/classic/Trn";
import { HEIGHT_SCALE, TILE_WORLD_SIZE, toScene, type WydPosition } from "../../world/coordinates";
import type { TerrainMaterialLibrary } from "./TerrainMaterialLibrary";

const uvOrientations: readonly (readonly [number, number])[][] = [
  [[0, 0], [0, 1], [1, 0], [1, 1]], [[1, 0], [0, 0], [1, 1], [0, 1]],
  [[1, 1], [1, 0], [0, 1], [0, 0]], [[0, 1], [1, 1], [0, 0], [1, 0]],
  [[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 1], [0, 0], [1, 1], [1, 0]],
  [[1, 1], [0, 1], [1, 0], [0, 0]], [[1, 0], [1, 1], [0, 0], [0, 1]],
];

// O MTile e um atlas 2x2. Estes 32 arranjos sao exatamente
// TMGround::BackTileCoordList do cliente classic.
const backgroundUvOrientations: readonly (readonly [number, number])[][] = [
  [[0, 0], [0, 0.5], [0.5, 0], [0.5, 0.5]],
  [[1, 0], [0.5, 0], [1, 0.5], [0.5, 0.5]],
  [[1, 1], [1, 0.5], [0.5, 1], [0.5, 0.5]],
  [[0, 1], [0.5, 1], [0, 0.5], [0.5, 0.5]],
  [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]],
  [[0, 1], [0, 0.5], [0.5, 1], [0.5, 0.5]],
  [[1, 1], [0.5, 1], [1, 0.5], [0.5, 0.5]],
  [[1, 0], [1, 0.5], [0.5, 0], [0.5, 0.5]],
  [[0, 0.5], [0, 1], [0.5, 0.5], [0.5, 1]],
  [[0.5, 0], [0, 0], [0.5, 0.5], [0, 0.5]],
  [[1, 0.5], [1, 0], [0.5, 0.5], [0.5, 0]],
  [[0.5, 1], [1, 1], [0.5, 0.5], [1, 0.5]],
  [[0.5, 0], [1, 0], [0.5, 0.5], [1, 0.5]],
  [[0, 0.5], [0, 0], [0.5, 0.5], [0.5, 0]],
  [[0.5, 1], [0, 1], [0.5, 0.5], [0, 0.5]],
  [[1, 0.5], [1, 1], [0.5, 0.5], [0.5, 1]],
  [[0.5, 0], [0.5, 0.5], [1, 0], [1, 0.5]],
  [[1, 0.5], [0.5, 0.5], [1, 1], [0.5, 1]],
  [[0.5, 1], [0.5, 0.5], [0, 1], [0, 0.5]],
  [[0, 0.5], [0.5, 0.5], [0, 0], [0.5, 0]],
  [[0, 0.5], [0.5, 0.5], [0, 1], [0.5, 1]],
  [[0.5, 1], [0.5, 0.5], [1, 1], [1, 0.5]],
  [[1, 0.5], [0.5, 0.5], [1, 0], [0.5, 0]],
  [[0.5, 0], [0.5, 0.5], [0, 0], [0, 0.5]],
  [[0.5, 0.5], [0.5, 1], [1, 0.5], [1, 1]],
  [[0.5, 0.5], [0, 0.5], [0.5, 1], [0, 1]],
  [[0.5, 0.5], [0.5, 0], [0, 0.5], [0, 0]],
  [[0.5, 0.5], [1, 0.5], [0.5, 0], [1, 0]],
  [[0.5, 0.5], [1, 0.5], [0.5, 1], [1, 1]],
  [[0.5, 0.5], [0.5, 0], [1, 0.5], [1, 0]],
  [[0.5, 0.5], [0, 0.5], [0.5, 0], [0, 0]],
  [[0.5, 0.5], [0.5, 1], [0, 0.5], [0, 1]],
];

interface Bucket {
  readonly foregroundIndex: number;
  readonly backgroundIndex: number;
  positions: number[];
  colors: number[];
  uvs: number[];
  backgroundUvs: number[];
}

export function createTerrainBlockMesh(block: TrnBlock, origin: WydPosition, materials: TerrainMaterialLibrary): THREE.Group {
  const group = new THREE.Group();
  group.name = `Field${String(block.column).padStart(2, "0")}${String(block.row).padStart(2, "0")}`;
  const buckets = new Map<string, Bucket>();
  const base = toScene({ x: block.column * 128, y: block.row * 128 }, origin);
  const baseX = base.x;
  const baseZ = base.z;

  for (let row = 0; row < TRN_SIDE; row++) {
    for (let column = 0; column < TRN_SIDE; column++) {
      const a = tileAt(block, column, row);
      const b = tileAt(block, Math.min(column + 1, TRN_SIDE - 1), row);
      const c = tileAt(block, column, Math.min(row + 1, TRN_SIDE - 1));
      const d = tileAt(block, Math.min(column + 1, TRN_SIDE - 1), Math.min(row + 1, TRN_SIDE - 1));
      const foregroundIndex = a.texture + 10;
      const backgroundIndex = a.backgroundTexture + 256;
      const key = `${foregroundIndex}:${backgroundIndex}`;
      const bucket = buckets.get(key) ?? {
        foregroundIndex,
        backgroundIndex,
        positions: [],
        colors: [],
        uvs: [],
        backgroundUvs: [],
      };
      buckets.set(key, bucket);
      appendCell(bucket, baseX + column * TILE_WORLD_SIZE, baseZ - row * TILE_WORLD_SIZE, a, b, c, d);
    }
  }

  for (const bucket of buckets.values()) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(bucket.positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(bucket.colors, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(bucket.uvs, 2));
    geometry.setAttribute("uv2", new THREE.Float32BufferAttribute(bucket.backgroundUvs, 2));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, materials.material(bucket.foregroundIndex, bucket.backgroundIndex));
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

function tileAt(block: TrnBlock, x: number, y: number): TrnTile {
  const tile = block.tiles[y * TRN_SIDE + x];
  if (!tile) throw new RangeError(`Tile ausente em ${x},${y}`);
  return tile;
}

function appendCell(bucket: Bucket, x: number, z: number, a: TrnTile, b: TrnTile, c: TrnTile, d: TrnTile): void {
  const corners = [[x, a.height * HEIGHT_SCALE, z], [x, c.height * HEIGHT_SCALE, z - TILE_WORLD_SIZE], [x + TILE_WORLD_SIZE, b.height * HEIGHT_SCALE, z], [x + TILE_WORLD_SIZE, d.height * HEIGHT_SCALE, z - TILE_WORLD_SIZE]] as const;
  const tiles = [a, c, b, d] as const;
  const uv = uvOrientations[a.textureOrientation & 7] ?? uvOrientations[0]!;
  const backgroundUv = backgroundUvOrientations[a.backgroundOrientation & 31] ?? backgroundUvOrientations[0]!;
  for (const index of [0, 2, 1, 2, 3, 1] as const) {
    bucket.positions.push(...corners[index]);
    bucket.colors.push(...colorOf(tiles[index].colorArgb));
    const [u, v] = uv[index]!;
    // DDSLoader already exposes the texture with flipY=false. The classic UV
    // tables are therefore used verbatim; flipping V here breaks the seams
    // between neighbouring MTile quadrants.
    bucket.uvs.push(u, v);
    const [backgroundU, backgroundV] = backgroundUv[index]!;
    bucket.backgroundUvs.push(backgroundU, backgroundV);
  }
}

function colorOf(argb: number): [number, number, number] {
  return [((argb >>> 16) & 255) / 255, ((argb >>> 8) & 255) / 255, (argb & 255) / 255];
}
