import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import type { MapObjectRecord } from "../../formats/classic/Dat";
import { FIELD_WORLD_SIZE, toScene, type WydPosition } from "../../world/coordinates";
import { fieldKey } from "../../world/regions";
import { ModelLibrary } from "./ModelLibrary";
import { MapEffects } from "../effects/MapEffects";
import { ClassicEnvironmentObjects, isClassicEnvironmentType } from "../environment/ClassicEnvironmentObjects";
import { MapWater } from "../water/MapWater";
import { ClassicFloatObjects } from "../water/ClassicFloatObjects";

const nonStaticTypes = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 121, 343, 344, 1980]);
const WATERFALL_OBJECT_TYPES = new Set([292, 490, 1526, 1665, 2005]);
const HOUSE_STATIC_COMPANIONS = new Map<number, number>([
  [614, 615],
  [1750, 1770],
  [1739, 1771],
  [1711, 1772],
]);

export interface ClassicMapAmbientSoundSource {
  readonly soundIndex: number;
  readonly position: WydPosition;
  readonly radius: number;
  readonly volume: number;
}

function isStaticMeshType(type: number): boolean {
  // These ids instantiate dedicated TMLeaf/TMTree/TMShip/fauna classes. They
  // overlap unrelated MeshList rows and must never be interpreted as MSA.
  if (isClassicEnvironmentType(type)) return false;
  if (type >= 501 && type < 600) return false;
  return !nonStaticTypes.has(type);
}

export class MapObjects {
  readonly object = new THREE.Group();
  readonly #models: ModelLibrary;
  readonly #effects: MapEffects;
  readonly #environment: ClassicEnvironmentObjects;
  readonly #water: MapWater;
  readonly #floats: ClassicFloatObjects;
  readonly #fieldGroups = new Map<string, THREE.Group>();
  readonly #fieldTypes = new Map<string, ReadonlySet<number>>();
  readonly #ambientSources = new Map<string, readonly ClassicMapAmbientSoundSource[]>();
  readonly #generations = new Map<string, number>();

  constructor(
    assets: ClassicAssetSource,
    private readonly origin: WydPosition,
    heightAt: (position: WydPosition) => number,
    colorAt: (position: WydPosition) => THREE.Color,
    models?: ModelLibrary,
  ) {
    this.#models = models ?? new ModelLibrary(assets);
    this.#effects = new MapEffects(assets, origin, this.#models, heightAt);
    this.#environment = new ClassicEnvironmentObjects(assets, origin);
    this.#water = new MapWater(assets, origin, this.#models);
    this.#floats = new ClassicFloatObjects(
      assets,
      origin,
      (position, timeMilliseconds, preferredField) => (
        this.#water.waterHeightAt(position, timeMilliseconds, preferredField)
      ),
      colorAt,
    );
    this.object.name = "map-objects";
    this.object.add(this.#effects.object);
    this.object.add(this.#environment.object);
    this.object.add(this.#water.object);
    this.object.add(this.#floats.object);
  }

  setEffectsEnabled(enabled: boolean): void {
    this.#effects.setEnabled(enabled);
    this.#environment.setEffectsEnabled(enabled);
    this.#floats.setEffectsEnabled(enabled);
  }

  update(deltaSeconds: number): void {
    this.#floats.update(deltaSeconds);
  }

  ambientSoundSources(): readonly ClassicMapAmbientSoundSource[] {
    return [...this.#ambientSources.values()].flat();
  }

  async addBlock(column: number, row: number, records: readonly MapObjectRecord[]): Promise<void> {
    const key = fieldKey(column, row);
    this.removeBlock(column, row);
    const generation = (this.#generations.get(key) ?? 0) + 1;
    this.#generations.set(key, generation);
    const group = new THREE.Group();
    group.name = `objects-${key}`;
    this.#fieldGroups.set(key, group);
    this.#ambientSources.set(
      key,
      records.flatMap((record): readonly ClassicMapAmbientSoundSource[] => {
        const position = {
          x: column * FIELD_WORLD_SIZE + record.localX,
          y: row * FIELD_WORLD_SIZE + record.localY,
        };
        if (WATERFALL_OBJECT_TYPES.has(record.type)) {
          // TMHouse type 3: waterfall.wav while the focused actor is < 7 cells.
          return [{ soundIndex: 6, position, radius: 7, volume: 0.28 }];
        }
        if (record.type === 607) {
          // TMHouse type 4 uses effect28.wav in a tight three-cell radius.
          return [{ soundIndex: 39, position, radius: 3, volume: 0.24 }];
        }
        if (record.type === 10) {
          // TMRain owns weather sample 101. Multiple emitters collapse to the
          // nearest source in ClassicAudio, matching IsSoundPlaying().
          return [{ soundIndex: 101, position, radius: 18, volume: 0.2 }];
        }
        return [];
      }),
    );
    this.object.add(group);

    const effects = this.#effects.addBlock(column, row, records);
    const environment = this.#environment.addBlock(column, row, records);
    // MapWater registers its type-2 descriptors synchronously before awaiting
    // textures, so TMFloat can resolve the correct surface in the same tick.
    const water = this.#water.addBlock(column, row, records);
    const floats = this.#floats.addBlock(column, row, records);
    const prototypes = new Map<number, THREE.Group | null>();
    const typeSet = new Set(records.map((record) => record.type).filter(isStaticMeshType));
    // TMHouse(474) possui uma segunda MSA: as pas animadas do catavento.
    if (typeSet.has(474)) typeSet.add(475);
    if (typeSet.has(607)) {
      typeSet.add(608);
      typeSet.add(609);
    }
    for (const [ownerType, companionType] of HOUSE_STATIC_COMPANIONS) {
      if (typeSet.has(ownerType)) typeSet.add(companionType);
    }
    const types = [...typeSet];
    const retainedTypes = new Set<number>();
    this.#fieldTypes.set(key, retainedTypes);
    // Importar dezenas de MSA no mesmo frame gera um hitch perceptivel. Quatro
    // prototipos por lote mantem throughput sem monopolizar a main thread.
    for (let index = 0; index < types.length; index += 4) {
      if (this.#generations.get(key) !== generation || this.#fieldGroups.get(key) !== group) return;
      const batch = types.slice(index, index + 4);
      await Promise.all(batch.map(async (type) => {
        retainedTypes.add(type);
        prototypes.set(type, await this.#models.retain(type));
      }));
      if (index + 4 < types.length) await nextFrame();
    }
    if (this.#generations.get(key) !== generation || this.#fieldGroups.get(key) !== group) return;
    for (let index = 0; index < records.length; index++) {
      const record = records[index]!;
      const prototype = prototypes.get(record.type);
      if (!prototype) continue;
      const instance = prototype.clone(true);
      const scene = toScene({ x: column * FIELD_WORLD_SIZE + record.localX, y: row * FIELD_WORLD_SIZE + record.localY }, this.origin);
      instance.position.set(scene.x, record.height, scene.z);
      instance.rotation.y = -record.angle;
      instance.scale.set(record.scaleH || 1, record.scaleV || 1, record.scaleH || 1);
      instance.name = `object-${record.type}`;
      group.add(instance);
      if (record.type === 474) {
        const bladePrototype = prototypes.get(475);
        if (bladePrototype) group.add(createWindmillBlade(bladePrototype, record, scene));
      }
      if (record.type === 607) {
        const rotatingPrototype = prototypes.get(608);
        const centerPrototype = prototypes.get(609);
        if (rotatingPrototype && centerPrototype) {
          group.add(createGateParts(rotatingPrototype, centerPrototype, record, scene));
        }
      }
      const companionType = HOUSE_STATIC_COMPANIONS.get(record.type);
      if (companionType !== undefined) {
        const companionPrototype = prototypes.get(companionType);
        if (companionPrototype) {
          group.add(createHouseCompanion(companionPrototype, companionType, record, scene));
        }
      }
      if (index > 0 && index % 64 === 0) {
        await nextFrame();
        if (this.#generations.get(key) !== generation || this.#fieldGroups.get(key) !== group) return;
      }
    }
    await effects;
    await environment;
    await water;
    await floats;
  }

  removeBlock(column: number, row: number): void {
    const key = fieldKey(column, row);
    this.#generations.set(key, (this.#generations.get(key) ?? 0) + 1);
    this.#ambientSources.delete(key);
    const group = this.#fieldGroups.get(key);
    if (group) {
      this.#fieldGroups.delete(key);
      this.object.remove(group);
      // Instancias compartilham recursos com ModelLibrary. Limpar os filhos
      // solta as referencias, sem destruir recursos ainda usados por vizinhos.
      group.clear();
    }
    const types = this.#fieldTypes.get(key);
    if (types) {
      this.#fieldTypes.delete(key);
      for (const type of types) this.#models.release(type);
    }
    this.#effects.removeBlock(column, row);
    this.#environment.removeBlock(column, row);
    this.#floats.removeBlock(column, row);
    this.#water.removeBlock(column, row);
  }

  dispose(): void {
    const keys = [...this.#fieldGroups.keys()];
    for (const key of keys) {
      const [column, row] = parseFieldKey(key);
      this.removeBlock(column, row);
    }
    this.#generations.clear();
    this.#fieldTypes.clear();
    this.#ambientSources.clear();
    this.#effects.dispose();
    this.#environment.dispose();
    this.#floats.dispose();
    this.#water.dispose();
    this.object.removeFromParent();
    this.object.clear();
  }
}

function parseFieldKey(key: string): [number, number] {
  const [column, row] = key.split(",").map(Number);
  if (!Number.isFinite(column) || !Number.isFinite(row)) return [0, 0];
  return [column!, row!];
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function createWindmillBlade(
  prototype: THREE.Group,
  record: MapObjectRecord,
  scene: { readonly x: number; readonly z: number },
): THREE.Group {
  const blade = prototype.clone(true);
  blade.position.set(scene.x, record.height + 5.2199998, scene.z);
  blade.scale.set(record.scaleH || 1, record.scaleV || 1, record.scaleH || 1);
  blade.name = "object-475-windmill-blade";

  const animate = () => {
    const windAngle = ((performance.now() % 20_000) / 10_000) * Math.PI;
    // D3DXMatrixRotationYawPitchRoll(angle-90deg, wind-90deg, 90deg),
    // convertido da base canhota para o eixo Z refletido do Three.js.
    blade.rotation.set(
      Math.PI / 2 - windAngle,
      -(record.angle - Math.PI / 2),
      Math.PI / 2,
      "YXZ",
    );
  };
  animate();
  blade.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    // Para este composite aplicamos o pitch -90 graus junto com os demais
    // angulos acima, em vez do pitch-base usado pelos MSA estaticos.
    child.rotation.set(0, 0, 0);
    child.onBeforeRender = animate;
  });
  return blade;
}

function createGateParts(
  rotatingPrototype: THREE.Group,
  centerPrototype: THREE.Group,
  record: MapObjectRecord,
  scene: { readonly x: number; readonly z: number },
): THREE.Group {
  const parts = new THREE.Group();
  parts.name = "object-607-house-parts";
  const lower = rotatingPrototype.clone(true);
  const upper = rotatingPrototype.clone(true);
  const center = centerPrototype.clone(true);
  lower.position.set(scene.x, record.height + 0.44999999, scene.z);
  upper.position.set(scene.x, record.height + 2.7, scene.z);
  center.position.set(scene.x, record.height + 2, scene.z);
  lower.name = "object-608-lower";
  upper.name = "object-608-upper";
  center.name = "object-609-center";
  parts.add(lower, upper, center);

  const animate = () => {
    const windAngle = ((performance.now() % 20_000) / 10_000) * Math.PI;
    // TMHouse passa yaw -wind para 608 e +wind para 609. O eixo Z refletido
    // do runtime inverte esses yaws ao convertê-los para Three.js.
    lower.rotation.y = windAngle;
    upper.rotation.y = windAngle;
    center.rotation.y = -windAngle;
  };
  animate();
  for (const part of [lower, upper, center]) {
    part.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.onBeforeRender = animate;
    });
  }
  return parts;
}

function createHouseCompanion(
  prototype: THREE.Group,
  companionType: number,
  record: MapObjectRecord,
  scene: { readonly x: number; readonly z: number },
): THREE.Group {
  const companion = prototype.clone(true);
  companion.position.set(scene.x, record.height, scene.z);
  companion.rotation.y = -record.angle;
  companion.scale.set(record.scaleH || 1, record.scaleV || 1, record.scaleH || 1);
  companion.name = `object-${record.type}-house-companion-${companionType}`;
  return companion;
}
