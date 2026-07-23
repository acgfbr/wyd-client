import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import type { MapObjectRecord } from "../../formats/classic/Dat";
import { FIELD_WORLD_SIZE, toScene, type WydPosition } from "../../world/coordinates";
import { fieldKey } from "../../world/regions";
import type { ModelLibrary } from "../objects/ModelLibrary";
import { EffectTextureLibrary } from "./EffectTextureLibrary";
import { MapMeshEffects } from "./MapMeshEffects";

interface BillboardDefinition {
  readonly firstTexture: number;
  readonly frameCount: number;
  readonly frameTime: number;
  readonly color: number;
  readonly opacity: number;
}

interface GroundShadeDefinition {
  readonly color: number;
  readonly opacity: number;
}

const billboardDefinitions: Readonly<Record<number, BillboardDefinition>> = {
  501: { firstTexture: 11, frameCount: 8, frameTime: 80, color: 0xeecc00, opacity: 0xee / 255 },
  502: { firstTexture: 61, frameCount: 6, frameTime: 80, color: 0xffffff, opacity: 1 },
  503: { firstTexture: 101, frameCount: 8, frameTime: 80, color: 0x5500ff, opacity: 1 },
  504: { firstTexture: 56, frameCount: 1, frameTime: 80, color: 0xff0000, opacity: 1 },
  505: { firstTexture: 79, frameCount: 1, frameTime: 80, color: 0x330000, opacity: 0.55 },
};

// TMObjectContainer.cpp: col[nTexIndex][1], used by TMShade(5, 7, 1).
const groundShadeDefinitions: Readonly<Record<number, GroundShadeDefinition>> = {
  501: { color: 0x331100, opacity: 0x33 / 255 },
  502: { color: 0x331100, opacity: 0x33 / 255 },
  // The classic literal for type 503 is 0x00011033 (zero alpha), therefore it
  // intentionally contributes no visible ground shade.
  503: { color: 0x011033, opacity: 0 },
};

const OWNED_GROUND_SHADE = "classicOwnedGroundShade";

export class MapEffects {
  readonly object = new THREE.Group();
  readonly #textures: EffectTextureLibrary;
  readonly #meshEffects: MapMeshEffects;
  readonly #fieldGroups = new Map<string, THREE.Group>();
  readonly #generations = new Map<string, number>();

  constructor(
    assets: ClassicAssetSource,
    private readonly origin: WydPosition,
    models: ModelLibrary,
    private readonly heightAt: (position: WydPosition) => number,
  ) {
    this.#textures = new EffectTextureLibrary(assets);
    this.#meshEffects = new MapMeshEffects(models, origin);
    this.object.name = "map-effects";
    this.object.add(this.#meshEffects.object);
  }

  async addBlock(column: number, row: number, records: readonly MapObjectRecord[]): Promise<void> {
    const key = fieldKey(column, row);
    this.removeBlock(column, row);
    const generation = (this.#generations.get(key) ?? 0) + 1;
    this.#generations.set(key, generation);
    const group = new THREE.Group();
    group.name = `effects-${key}`;
    this.#fieldGroups.set(key, group);
    this.object.add(group);
    const effects = records.filter((record) => record.type in billboardDefinitions || (record.type >= 511 && record.type <= 518));
    await Promise.all([
      this.#meshEffects.addBlock(column, row, records),
      ...effects.map((record) => this.addRecord(column, row, record, group, () => (
        this.#generations.get(key) === generation && this.#fieldGroups.get(key) === group
      ))),
    ]);
  }

  removeBlock(column: number, row: number): void {
    const key = fieldKey(column, row);
    this.#generations.set(key, (this.#generations.get(key) ?? 0) + 1);
    this.#meshEffects.removeBlock(column, row);
    const group = this.#fieldGroups.get(key);
    if (!group) return;
    this.#fieldGroups.delete(key);
    this.object.remove(group);
    group.traverse((child) => {
      if (child instanceof THREE.Sprite) {
        child.onBeforeRender = () => undefined;
        child.material.dispose();
        return;
      }
      if (child instanceof THREE.Mesh && child.userData[OWNED_GROUND_SHADE]) {
        child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) material.dispose();
      }
    });
  }

  dispose(): void {
    const keys = [...this.#fieldGroups.keys()];
    for (const key of keys) {
      const [column, row] = parseFieldKey(key);
      this.removeBlock(column, row);
    }
    this.#generations.clear();
    this.#meshEffects.dispose();
    this.#textures.dispose();
    this.object.removeFromParent();
    this.object.clear();
  }

  setEnabled(enabled: boolean): void {
    this.object.visible = enabled;
  }

  private async addRecord(
    column: number,
    row: number,
    record: MapObjectRecord,
    target: THREE.Group,
    isCurrent: () => boolean,
  ): Promise<void> {
    const mapPosition = {
      x: column * FIELD_WORLD_SIZE + record.localX,
      y: row * FIELD_WORLD_SIZE + record.localY,
    };
    const scene = toScene(mapPosition, this.origin);
    const position = new THREE.Vector3(scene.x, record.height, scene.z);

    if (record.type >= 511 && record.type <= 518) {
      if (!isCurrent()) return;
      const light = new THREE.PointLight(0xffe36b, 2.1, 5, 1.6);
      light.position.copy(position);
      light.name = `map-light-${record.type}`;
      target.add(light);
      return;
    }

    const definition = billboardDefinitions[record.type];
    if (!definition) return;
    const shadeDefinition = groundShadeDefinitions[record.type];
    const [frames, glowTexture, shadeTexture] = await Promise.all([
      this.#textures.sequence(definition.firstTexture, definition.frameCount),
      record.type <= 503 ? this.#textures.load(2) : Promise.resolve(null),
      shadeDefinition?.opacity ? this.#textures.load(7) : Promise.resolve(null),
    ]);
    if (frames.length === 0 || !isCurrent()) return;

    if (shadeDefinition && shadeTexture && shadeDefinition.opacity > 0) {
      target.add(createGroundShade(
        mapPosition,
        this.origin,
        this.heightAt,
        shadeTexture,
        shadeDefinition,
        record.type,
      ));
    }

    if (glowTexture) {
      const glow = createSprite([glowTexture], 1000, record.type === 503 ? 0x330055 : 0x553300, record.type === 503 ? 0.8 : 0.34);
      glow.position.copy(position);
      glow.scale.set(record.scaleH * 2.8, record.scaleV * 2.8, 1);
      glow.renderOrder = 1;
      target.add(glow);
    }

    const sprite = createSprite(frames, definition.frameTime, definition.color, definition.opacity);
    sprite.position.copy(position);
    sprite.scale.set(record.scaleH, record.scaleV, 1);
    sprite.renderOrder = 2;
    sprite.name = `map-effect-${record.type}`;
    target.add(sprite);

    // Green fire is rendered twice in the original: a large colored flame and
    // a smaller white-hot core slightly below it.
    if (record.type === 503) {
      const core = createSprite(frames, definition.frameTime, 0xffffff, 1, 37);
      core.position.copy(position);
      core.position.y -= record.scaleV * 0.2;
      core.scale.set(record.scaleH * 0.5, record.scaleV * 0.5, 1);
      core.renderOrder = 3;
      target.add(core);
    }

    if (record.type === 504) installPulse(sprite, record.scaleH, record.scaleV);
  }
}

function parseFieldKey(key: string): [number, number] {
  const [column, row] = key.split(",").map(Number);
  if (!Number.isFinite(column) || !Number.isFinite(row)) return [0, 0];
  return [column!, row!];
}

function createGroundShade(
  center: WydPosition,
  origin: WydPosition,
  heightAt: (position: WydPosition) => number,
  texture: THREE.Texture,
  definition: GroundShadeDefinition,
  type: number,
): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  // TMShade(5, ...): a 5x5 grid snapped to WYD's two-unit terrain lattice.
  const grid = 5;
  const gridOriginX = Math.trunc(center.x / 2) - Math.trunc(grid / 2);
  const gridOriginY = Math.trunc(center.y / 2) - Math.trunc(grid / 2);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let y = 0; y <= grid; y++) {
    for (let x = 0; x <= grid; x++) {
      const worldX = (gridOriginX + x) * 2;
      const worldY = (gridOriginY + y) * 2;
      const scene = toScene({ x: worldX, y: worldY }, origin);
      positions.push(scene.x, heightAt({ x: worldX, y: worldY }) + 0.05, scene.z);
      // Texture 7 is radial. These normalized coordinates reproduce the same
      // ten-unit footprint as TMShade without relying on texture wrapping.
      uvs.push(x / grid, 1 - y / grid);
    }
  }
  const stride = grid + 1;
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const a = x + y * stride;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: definition.color,
    opacity: definition.opacity,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const shade = new THREE.Mesh(geometry, material);
  shade.name = `map-effect-${type}-ground-shade`;
  shade.renderOrder = 1;
  shade.userData[OWNED_GROUND_SHADE] = true;
  return shade;
}

function createSprite(
  frames: readonly THREE.Texture[],
  frameTime: number,
  color: number,
  opacity: number,
  phaseOffset = 0,
): THREE.Sprite {
  for (const frame of frames) configureClassicBillboardUvs(frame);
  const material = new THREE.SpriteMaterial({
    map: frames[0],
    color,
    opacity,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const sprite = new THREE.Sprite(material);
  const phase = phaseOffset + Math.floor(Math.random() * Math.max(1, frames.length * frameTime));
  sprite.onBeforeRender = () => {
    const frame = Math.floor((performance.now() + phase) / frameTime) % frames.length;
    if (material.map !== frames[frame]) material.map = frames[frame]!;
  };
  return sprite;
}

/**
 * DDSLoader keeps compressed DirectDraw surfaces in their native top-left
 * orientation (`flipY = false`). Three's shared Sprite geometry, however,
 * assigns V=0 to its lower vertices. The classic TMEffectBillBoard does the
 * opposite: lower vertices sample V=.98 and upper vertices sample V=.02.
 *
 * Reproduce that mapping through the texture matrix instead of changing the
 * DDS itself. Besides fixing vertically inverted flames, the .02 inset keeps
 * compressed edge texels from bleeding exactly as the original quad did.
 */
function configureClassicBillboardUvs(texture: THREE.Texture): void {
  texture.offset.set(0.02, 0.98);
  texture.repeat.set(0.96, -0.96);
}

function installPulse(sprite: THREE.Sprite, scaleX: number, scaleY: number): void {
  const animateFrames = sprite.onBeforeRender;
  sprite.onBeforeRender = (...args) => {
    animateFrames(...args);
    const pulse = 0.85 + Math.sin(performance.now() * Math.PI / 1500) * 0.15;
    sprite.scale.set(scaleX * pulse, scaleY * pulse, 1);
  };
}
