import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import type { MapObjectRecord } from "../../formats/classic/Dat";
import { FIELD_WORLD_SIZE, fieldAt, toScene, type WydPosition } from "../../world/coordinates";
import { fieldKey } from "../../world/regions";
import type { ModelLibrary } from "../objects/ModelLibrary";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";

// Exact TMHouse::InitObject owner -> water mesh mapping. These secondary MSA
// files never appear as independent records in a Field DAT.
const HOUSE_WATER_COMPANIONS = new Map<number, number>([
  [195, 196], [273, 280], [274, 281], [292, 293], [697, 698], [699, 700],
  [490, 491], [1520, 1521], [1526, 1527], [1535, 1536], [1695, 1696],
  [1665, 1666], [2005, 2006], [1993, 1994],
]);
const DUNGEON_WATER_ONE_OWNERS = new Set([292, 490, 1526, 1665, 2005]);
const OWNED_GEOMETRY = "classicOwnedWaterGeometry";

// Water records (type 2) are horizontal planes. Their local Y really is the
// vertical axis, so a small height ripple is safe here.
const surfaceVertexShader = /* glsl */ `
  uniform float time;
  attribute vec2 uv2;
  varying vec2 vUv1;
  varying vec2 vUv2;

  void main() {
    vUv1 = uv + vec2(0.0, time / 12.0);
    vUv2 = uv2 + vec2(time / 18.0, time / 12.0);
    vec3 animated = position;
    animated.y += sin(uv.x * 3.14159265 + time * 1.04719755) * 0.05 - 0.1;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(animated, 1.0);
  }
`;

// TMHouse water companions use the classic MSA coordinate system and are
// pitched +90 degrees by ModelLibrary. Moving local Y therefore pushes their
// fountain jets sideways. In the original meshes height is authored along U
// (correlation between MSA Z and U ranges from -0.47 to -0.99), so advance the
// pattern towards increasing U: from the top of a jet to its basin.
const fallingWaterVertexShader = /* glsl */ `
  uniform float time;
  attribute vec2 uv2;
  varying vec2 vUv1;
  varying vec2 vUv2;

  void main() {
    vUv1 = uv + vec2(-time / 12.0, 0.0);
    vUv2 = uv2 + vec2(-time / 18.0, 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D baseMap;
  uniform sampler2D detailMap;
  uniform float opacity;
  varying vec2 vUv1;
  varying vec2 vUv2;

  void main() {
    vec4 base = texture2D(baseMap, vUv1);
    vec4 detail = texture2D(detailMap, vUv2);
    vec3 water = base.rgb * 0.72 + detail.rgb * 0.42 + vec3(0.015, 0.035, 0.055);
    gl_FragColor = vec4(water, opacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class MapWater {
  readonly object = new THREE.Group();
  readonly #loader = new ClassicDdsTextureLoader();
  readonly #materials = new Map<string, Promise<THREE.ShaderMaterial | null>>();
  readonly #fieldGroups = new Map<string, THREE.Group>();
  readonly #fieldModelTypes = new Map<string, readonly number[]>();
  readonly #fieldSurfaces = new Map<string, readonly ClassicWaterSurface[]>();
  readonly #generations = new Map<string, number>();

  constructor(
    private readonly assets: ClassicAssetSource,
    private readonly origin: WydPosition,
    private readonly models: ModelLibrary,
  ) {
    this.object.name = "map-water";
  }

  async addBlock(column: number, row: number, records: readonly MapObjectRecord[]): Promise<void> {
    const key = fieldKey(column, row);
    this.removeBlock(column, row);
    const generation = (this.#generations.get(key) ?? 0) + 1;
    this.#generations.set(key, generation);
    const group = new THREE.Group();
    group.name = `water-${key}`;
    this.#fieldGroups.set(key, group);
    this.object.add(group);
    const waterRecords = records.filter((record) => record.type === 2);
    // Register before the first await. TMFloat loads concurrently with this
    // renderer and must be able to resolve its surface immediately.
    this.#fieldSurfaces.set(key, waterRecords.map((record) => createWaterSurface(column, row, record)));
    const houseRecords = records.filter((record) => HOUSE_WATER_COMPANIONS.has(record.type));
    if (waterRecords.length === 0 && houseRecords.length === 0) return;
    const dungeon = dungeonType(column, row);
    const isDungeon = dungeon !== 0 && dungeon !== 3 && dungeon !== 4;
    const houseModelTypes = [...new Set(houseRecords.map((record) => HOUSE_WATER_COMPANIONS.get(record.type)!))];
    this.#fieldModelTypes.set(key, houseModelTypes);
    const [material, houseModels] = await Promise.all([
      this.material(isDungeon),
      Promise.all(houseModelTypes.map(async (type) => [type, await this.models.retain(type)] as const)),
    ]);
    if (!material || this.#generations.get(key) !== generation || this.#fieldGroups.get(key) !== group) return;

    for (const record of waterRecords) {
      const gridX = Math.trunc(record.mask / 2);
      const gridY = Math.trunc(record.textureSet / 2);
      if (gridX <= 0 || gridY <= 0) continue;
      const geometry = createWaterGeometry(gridX, gridY);
      const mesh = new THREE.Mesh(geometry, material);
      const scene = toScene({
        x: column * FIELD_WORLD_SIZE + record.localX,
        y: row * FIELD_WORLD_SIZE + record.localY,
      }, this.origin);
      mesh.position.set(scene.x, record.height, scene.z);
      mesh.rotation.y = -record.angle;
      mesh.renderOrder = 4;
      mesh.name = "water-surface";
      mesh.userData[OWNED_GEOMETRY] = true;
      mesh.onBeforeRender = () => {
        material.uniforms.time!.value = performance.now() / 1000;
      };
      group.add(mesh);
    }

    const prototypes = new Map(houseModels);
    const houseMaterials = new Map<string, THREE.ShaderMaterial | null>();
    for (const record of houseRecords) {
      const waterType = HOUSE_WATER_COMPANIONS.get(record.type);
      if (waterType === undefined) continue;
      const prototype = prototypes.get(waterType);
      if (!prototype) continue;
      const profile = !isDungeon
        ? "house-outdoor"
        : DUNGEON_WATER_ONE_OWNERS.has(record.type) ? "house-dungeon-one" : "house-dungeon-eight";
      let houseMaterial = houseMaterials.get(profile);
      if (houseMaterial === undefined) {
        houseMaterial = await this.houseMaterial(profile);
        houseMaterials.set(profile, houseMaterial);
      }
      if (!houseMaterial || this.#generations.get(key) !== generation || this.#fieldGroups.get(key) !== group) return;
      const instance = prototype.clone(true);
      const scene = toScene({
        x: column * FIELD_WORLD_SIZE + record.localX,
        y: row * FIELD_WORLD_SIZE + record.localY,
      }, this.origin);
      instance.position.set(scene.x, record.height, scene.z);
      instance.rotation.y = -record.angle;
      instance.scale.set(record.scaleH || 1, record.scaleV || 1, record.scaleH || 1);
      instance.name = `house-water-${record.type}-${waterType}`;
      instance.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const uv = child.geometry.getAttribute("uv");
        if (uv && !child.geometry.getAttribute("uv2")) child.geometry.setAttribute("uv2", uv.clone());
        child.material = houseMaterial!;
        child.castShadow = false;
        child.receiveShadow = false;
        child.renderOrder = 4;
        child.onBeforeRender = () => {
          houseMaterial!.uniforms.time!.value = performance.now() / 1000;
        };
      });
      group.add(instance);
    }
  }

  removeBlock(column: number, row: number): void {
    const key = fieldKey(column, row);
    this.#generations.set(key, (this.#generations.get(key) ?? 0) + 1);
    this.#fieldSurfaces.delete(key);
    const modelTypes = this.#fieldModelTypes.get(key);
    if (modelTypes) {
      this.#fieldModelTypes.delete(key);
      for (const type of modelTypes) this.models.release(type);
    }
    const group = this.#fieldGroups.get(key);
    if (!group) return;
    this.#fieldGroups.delete(key);
    this.object.remove(group);
    group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.onBeforeRender = () => undefined;
      if (child.userData[OWNED_GEOMETRY]) child.geometry.dispose();
      // O ShaderMaterial e as texturas sao compartilhados entre todos os
      // Fields; somente a geometria pertencente ao bloco e descartada aqui.
    });
  }

  dispose(): void {
    const keys = [...this.#fieldGroups.keys()];
    for (const key of keys) {
      const [column, row] = parseFieldKey(key);
      this.removeBlock(column, row);
    }
    this.#generations.clear();
    const materials = [...this.#materials.values()];
    this.#materials.clear();
    for (const entry of materials) {
      void entry.then((material) => {
        if (!material) return;
        const uniforms = material.uniforms as Record<string, { value: unknown }>;
        const textures = [uniforms.baseMap?.value, uniforms.detailMap?.value]
          .filter((value): value is THREE.Texture => value instanceof THREE.Texture);
        material.dispose();
        for (const texture of textures) texture.dispose();
      }).catch(() => undefined);
    }
    this.object.removeFromParent();
    this.object.clear();
  }

  /** Exact TMScene::GroundGetWaterHeight lookup for resident Fields. */
  waterHeightAt(
    position: WydPosition,
    timeMilliseconds = performance.now(),
    preferredField?: string,
  ): number | null {
    const field = fieldAt(position);
    const keys = [
      fieldKey(field.column, field.row),
      fieldKey(field.column - 1, field.row),
      fieldKey(field.column + 1, field.row),
      fieldKey(field.column, field.row - 1),
      fieldKey(field.column, field.row + 1),
    ];
    if (preferredField && !keys.includes(preferredField)) keys.push(preferredField);
    const gridX = Math.trunc(position.x);
    const gridY = Math.trunc(position.y);
    for (const key of keys) {
      for (const surface of this.#fieldSurfaces.get(key) ?? []) {
        if (
          gridX < surface.left
          || gridX >= surface.right
          || gridY < surface.top
          || gridY >= surface.bottom
        ) continue;
        const phase = (position.x - surface.left) * Math.PI / 2
          + ((timeMilliseconds % 12_000) / 6_000) * Math.PI * 2;
        return surface.height + Math.sin(phase) * 0.1 - 0.1;
      }
    }
    return null;
  }

  private material(dungeon: boolean): Promise<THREE.ShaderMaterial | null> {
    return this.materialFor(
      dungeon ? "dungeon" : "outdoor",
      dungeon ? [8, 9] : [2, 3],
      0.82,
      surfaceVertexShader,
    );
  }

  private houseMaterial(profile: string): Promise<THREE.ShaderMaterial | null> {
    if (profile === "house-outdoor") {
      return this.materialFor(profile, [2, 2], 0.58, fallingWaterVertexShader);
    }
    if (profile === "house-dungeon-one") {
      return this.materialFor(profile, [1, 9], 0.58, fallingWaterVertexShader);
    }
    return this.materialFor(profile, [8, 9], 0.58, fallingWaterVertexShader);
  }

  private materialFor(
    key: string,
    indices: readonly [number, number],
    opacity: number,
    shader: string,
  ): Promise<THREE.ShaderMaterial | null> {
    const cached = this.#materials.get(key);
    if (cached) return cached;
    const promise = Promise.all(indices.map(async (index) => {
      const url = this.assets.waterTextureUrl(index);
      if (!url) return null;
      return this.#loader.loadAsync(url).then((texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.anisotropy = 4;
        return texture;
      }).catch(() => null);
    })).then(([baseMap, detailMap]) => {
      if (!baseMap || !detailMap) return null;
      return new THREE.ShaderMaterial({
        name: `WYD water ${key}`,
        uniforms: {
          time: { value: 0 },
          baseMap: { value: baseMap },
          detailMap: { value: detailMap },
          opacity: { value: opacity },
        },
        vertexShader: shader,
        fragmentShader,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    });
    this.#materials.set(key, promise);
    return promise;
  }
}

function parseFieldKey(key: string): [number, number] {
  const [column, row] = key.split(",").map(Number);
  if (!Number.isFinite(column) || !Number.isFinite(row)) return [0, 0];
  return [column!, row!];
}

interface ClassicWaterSurface {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly height: number;
}

function createWaterSurface(
  column: number,
  row: number,
  record: MapObjectRecord,
): ClassicWaterSurface {
  const x = column * FIELD_WORLD_SIZE + record.localX;
  const y = row * FIELD_WORLD_SIZE + record.localY;
  const gridX = Math.trunc(record.mask / 2);
  const gridY = Math.trunc(record.textureSet / 2);
  return {
    // C++ float-to-int truncation used by TMSea::InitPosition.
    left: Math.trunc(x - gridX),
    right: Math.trunc(x + gridX),
    top: Math.trunc(y - gridY),
    bottom: Math.trunc(y + gridY),
    height: record.height,
  };
}

function createWaterGeometry(gridX: number, gridY: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const uv: number[] = [];
  const uv2: number[] = [];
  const indices: number[] = [];
  const halfX = Math.trunc(gridX / 2);
  const halfY = Math.trunc(gridY / 2);
  for (let y = 0; y <= gridY; y++) {
    for (let x = 0; x <= gridX; x++) {
      positions.push((x - halfX) * 2, 0, -(y - halfY) * 2);
      uv.push(x / 2, y / 2);
      uv2.push(x / 12, y / 12);
    }
  }
  const stride = gridX + 1;
  for (let y = 0; y < gridY; y++) {
    for (let x = 0; x < gridX; x++) {
      const a = x + y * stride;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, b, c, c, b, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute("uv2", new THREE.Float32BufferAttribute(uv2, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function dungeonType(column: number, row: number): number {
  if (row > 25) return column > 8 && column < 16 ? 2 : 1;
  if (column >= 8 && column <= 30 && row >= 11 && row <= 12) return column <= 12 ? 3 : column >= 26 ? 5 : 0;
  if (column > 1 && column < 11 && row < 5) return 4;
  return 0;
}
