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
const BIKE_OBJECT_TYPES = new Set([1549, 1550, 1551]);
const SKY_REFLECTION_OBJECT_TYPES = new Set([1934, 1976, 1977]);
const SNOW_SKY_EFFECT_TEXTURE = 68;
const OWNED_SKY_REFLECTION_MATERIAL = "classicOwnedSkyReflectionMaterial";
const HOUSE_ROOF_TYPES = new Map<number, number>([
  [251, 252],
  [252, 253],
  [253, 254],
  [254, 255],
]);
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

interface DynamicMaterial {
  readonly material: THREE.Material;
  readonly opacity: number;
  readonly transparent: boolean;
  readonly depthWrite: boolean;
  readonly blending: THREE.Blending;
  readonly blendSrc: THREE.BlendingSrcFactor;
  readonly blendDst: THREE.BlendingDstFactor;
  readonly blendEquation: THREE.BlendingEquation;
  readonly blendSrcAlpha: THREE.BlendingSrcFactor | null;
  readonly blendDstAlpha: THREE.BlendingDstFactor | null;
  readonly blendEquationAlpha: THREE.BlendingEquation | null;
}

interface HouseRoof {
  readonly object: THREE.Group;
  readonly position: WydPosition;
  readonly materials: readonly DynamicMaterial[];
  translucent: boolean;
}

interface ProximityBlendObject {
  readonly position: WydPosition;
  readonly materials: readonly DynamicMaterial[];
  blended: boolean;
}

interface BikeObject {
  readonly object: THREE.Group;
  readonly startX: number;
  readonly startZ: number;
  readonly angle: number;
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
  readonly #houseRoofs = new Map<string, HouseRoof[]>();
  readonly #proximityBlendObjects = new Map<string, ProximityBlendObject[]>();
  readonly #bikeObjects = new Map<string, BikeObject[]>();
  readonly #ambientSources = new Map<string, readonly ClassicMapAmbientSoundSource[]>();
  readonly #generations = new Map<string, number>();

  constructor(
    assets: ClassicAssetSource,
    private readonly origin: WydPosition,
    heightAt: (position: WydPosition) => number,
    colorAt: (position: WydPosition) => THREE.Color,
    private readonly attributeAt: (position: WydPosition) => number | null,
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

  update(deltaSeconds: number, position: WydPosition): void {
    this.#floats.update(deltaSeconds);
    const insideHouse = ((this.attributeAt(position) ?? 0) & 0x08) !== 0;
    for (const roofs of this.#houseRoofs.values()) {
      for (const roof of roofs) {
        roof.object.visible = !insideHouse;
        if (insideHouse) continue;
        const translucent = Math.abs(position.x - roof.position.x) < 6
          && Math.abs(position.y - roof.position.y) < 6;
        if (roof.translucent === translucent) continue;
        roof.translucent = translucent;
        for (const material of roof.materials) {
          setClassicBlend(material, translucent ? "roof" : "normal");
        }
      }
    }
    for (const objects of this.#proximityBlendObjects.values()) {
      for (const object of objects) {
        const blended = Math.abs(position.x - object.position.x) < 6
          && Math.abs(position.y - object.position.y) < 6;
        if (object.blended === blended) continue;
        object.blended = blended;
        for (const material of object.materials) {
          setClassicBlend(material, blended ? "alpha" : "normal");
        }
      }
    }
    const bikeProgress = Math.sin(((performance.now() % 20_000) / 10_000) * Math.PI) * 3;
    for (const bikes of this.#bikeObjects.values()) {
      for (const bike of bikes) {
        const movesOnLogicalY = (
          Math.abs(bike.angle) < 0.01
          || (bike.angle > 3.13 && bike.angle < 3.15)
          || (bike.angle > 6.27 && bike.angle < 6.29)
        );
        bike.object.position.x = bike.startX + (movesOnLogicalY ? 0 : bikeProgress);
        bike.object.position.z = bike.startZ - (movesOnLogicalY ? bikeProgress : 0);
      }
    }
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
    const houseRoofs: HouseRoof[] = [];
    this.#houseRoofs.set(key, houseRoofs);
    const proximityBlendObjects: ProximityBlendObject[] = [];
    this.#proximityBlendObjects.set(key, proximityBlendObjects);
    const bikeObjects: BikeObject[] = [];
    this.#bikeObjects.set(key, bikeObjects);
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
    const skyReflectionTexture = [...typeSet].some((type) => SKY_REFLECTION_OBJECT_TYPES.has(type))
      ? this.#effects.effectTexture(SNOW_SKY_EFFECT_TEXTURE)
      : Promise.resolve(null);
    // TMHouse(474) possui uma segunda MSA: as pas animadas do catavento.
    if (typeSet.has(474)) typeSet.add(475);
    if (typeSet.has(607)) {
      typeSet.add(608);
      typeSet.add(609);
    }
    for (const [ownerType, roofType] of HOUSE_ROOF_TYPES) {
      if (typeSet.has(ownerType)) typeSet.add(roofType);
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
    const reflectionTexture = await skyReflectionTexture;
    if (this.#generations.get(key) !== generation || this.#fieldGroups.get(key) !== group) return;
    for (let index = 0; index < records.length; index++) {
      const record = records[index]!;
      const prototype = prototypes.get(record.type);
      if (!prototype) continue;
      const instance = prototype.clone(true);
      const worldPosition = {
        x: column * FIELD_WORLD_SIZE + record.localX,
        y: row * FIELD_WORLD_SIZE + record.localY,
      };
      const scene = toScene(worldPosition, this.origin);
      instance.position.set(scene.x, classicVisualHeight(record, worldPosition), scene.z);
      instance.rotation.y = -record.angle;
      instance.scale.set(record.scaleH || 1, record.scaleV || 1, record.scaleH || 1);
      instance.name = `object-${record.type}`;
      if (reflectionTexture && SKY_REFLECTION_OBJECT_TYPES.has(record.type)) {
        installClassicSkyReflection(instance, reflectionTexture);
      }
      if (record.type === 1855) {
        proximityBlendObjects.push({
          position: {
            x: column * FIELD_WORLD_SIZE + record.localX,
            y: row * FIELD_WORLD_SIZE + record.localY,
          },
          materials: cloneOwnedMaterials(instance),
          blended: false,
        });
      }
      if (BIKE_OBJECT_TYPES.has(record.type)) {
        bikeObjects.push({
          object: instance,
          startX: scene.x,
          startZ: scene.z,
          angle: record.angle,
        });
      }
      group.add(instance);
      const roofType = HOUSE_ROOF_TYPES.get(record.type);
      if (roofType !== undefined) {
        const roofPrototype = prototypes.get(roofType);
        if (roofPrototype) {
          const worldPosition = {
            x: column * FIELD_WORLD_SIZE + record.localX,
            y: row * FIELD_WORLD_SIZE + record.localY,
          };
          const roof = createHouseRoof(roofPrototype, roofType, record, scene, worldPosition);
          houseRoofs.push(roof);
          group.add(roof.object);
        }
      }
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
    const roofs = this.#houseRoofs.get(key);
    if (roofs) {
      this.#houseRoofs.delete(key);
      for (const roof of roofs) {
        for (const state of roof.materials) state.material.dispose();
      }
    }
    const proximityObjects = this.#proximityBlendObjects.get(key);
    if (proximityObjects) {
      this.#proximityBlendObjects.delete(key);
      for (const object of proximityObjects) {
        for (const state of object.materials) state.material.dispose();
      }
    }
    this.#bikeObjects.delete(key);
    if (group) {
      this.#fieldGroups.delete(key);
      this.object.remove(group);
      group.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          if (material.userData[OWNED_SKY_REFLECTION_MATERIAL]) material.dispose();
        }
      });
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
    this.#houseRoofs.clear();
    this.#proximityBlendObjects.clear();
    this.#bikeObjects.clear();
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

function classicVisualHeight(record: MapObjectRecord, position: WydPosition): number {
  const x = Math.trunc(position.x);
  const y = Math.trunc(position.y);
  // TMObject::FrameMove contains these four retail corrections. They alter
  // only the rendered object's height after mask registration, so navigation
  // must continue using the unmodified DAT height.
  if (record.type === 443 && x === 2540 && y === 2086) return 0;
  if (record.type === 454 && x === 2542 && y === 2090) return 0;
  if (record.type === 454 && x === 2540 && y === 2082) return 0;
  if (record.type === 449 && x === 2540 && y === 2094) return 0;
  return record.height;
}

function installClassicSkyReflection(object: THREE.Object3D, texture: THREE.Texture): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
    const materials = sourceMaterials.map((source) => {
      const material = source.clone();
      material.userData[OWNED_SKY_REFLECTION_MATERIAL] = true;
      const previousCompile = material.onBeforeCompile;
      material.onBeforeCompile = (
        shader: THREE.WebGLProgramParametersWithUniforms,
        renderer: THREE.WebGLRenderer,
      ) => {
        previousCompile.call(material, shader, renderer);
        shader.uniforms.wydSkyReflection = { value: texture };
        shader.vertexShader = shader.vertexShader
          .replace(
            "void main() {",
            [
              "varying vec3 vWydViewNormal;",
              "varying vec3 vWydViewPosition;",
              "void main() {",
            ].join("\n"),
          )
          .replace(
            "#include <project_vertex>",
            [
              "#include <project_vertex>",
              "vWydViewNormal = normalize(transformedNormal);",
              "vWydViewPosition = mvPosition.xyz;",
            ].join("\n"),
          );
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "void main() {",
            [
              "uniform sampler2D wydSkyReflection;",
              "varying vec3 vWydViewNormal;",
              "varying vec3 vWydViewPosition;",
              "void main() {",
            ].join("\n"),
          )
          .replace(
            "#include <map_fragment>",
            [
              "#include <map_fragment>",
              "vec3 wydIncident = normalize(vWydViewPosition);",
              "vec3 wydReflection = reflect(wydIncident, normalize(vWydViewNormal));",
              "float wydSphereM = 2.0 * sqrt(",
              "  wydReflection.x * wydReflection.x",
              "  + wydReflection.y * wydReflection.y",
              "  + (wydReflection.z + 1.0) * (wydReflection.z + 1.0)",
              ");",
              "vec2 wydReflectionUv = wydSphereM > 0.0001",
              "  ? wydReflection.xy / wydSphereM + 0.5",
              "  : vec2(0.5);",
              "vec3 wydSky = texture2D(wydSkyReflection, wydReflectionUv).rgb;",
              "// D3DTOP_ADDSMOOTH: arg1 + arg2 * (1 - arg1).",
              "diffuseColor.rgb = diffuseColor.rgb + wydSky * (1.0 - diffuseColor.rgb);",
            ].join("\n"),
          );
      };
      material.customProgramCacheKey = () => "wyd-snow-sky-reflection-v1";
      material.needsUpdate = true;
      return material;
    });
    child.material = Array.isArray(child.material) ? materials : materials[0]!;
  });
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

function createHouseRoof(
  prototype: THREE.Group,
  roofType: number,
  record: MapObjectRecord,
  scene: { readonly x: number; readonly z: number },
  position: WydPosition,
): HouseRoof {
  const object = prototype.clone(true);
  object.position.set(scene.x, record.height, scene.z);
  object.rotation.y = -record.angle;
  object.scale.set(record.scaleH || 1, record.scaleV || 1, record.scaleH || 1);
  object.name = `object-${record.type}-house-roof-${roofType}`;
  const materials = cloneOwnedMaterials(object);
  return {
    object,
    position,
    materials,
    translucent: false,
  };
}

function cloneOwnedMaterials(object: THREE.Object3D): DynamicMaterial[] {
  const materials: DynamicMaterial[] = [];
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
    const clonedMaterials = sourceMaterials.map((source) => {
      const material = source.clone();
      materials.push({
        material,
        opacity: material.opacity,
        transparent: material.transparent,
        depthWrite: material.depthWrite,
        blending: material.blending,
        blendSrc: material.blendSrc,
        blendDst: material.blendDst,
        blendEquation: material.blendEquation,
        blendSrcAlpha: material.blendSrcAlpha,
        blendDstAlpha: material.blendDstAlpha,
        blendEquationAlpha: material.blendEquationAlpha,
      });
      return material;
    });
    child.material = Array.isArray(child.material) ? clonedMaterials : clonedMaterials[0]!;
  });
  return materials;
}

function setClassicBlend(
  state: DynamicMaterial,
  mode: "normal" | "roof" | "alpha",
): void {
  const material = state.material;
  material.opacity = state.opacity;
  material.depthWrite = state.depthWrite;
  if (mode === "normal") {
    material.transparent = state.transparent;
    material.blending = state.blending;
    material.blendSrc = state.blendSrc;
    material.blendDst = state.blendDst;
    material.blendEquation = state.blendEquation;
    material.blendSrcAlpha = state.blendSrcAlpha;
    material.blendDstAlpha = state.blendDstAlpha;
    material.blendEquationAlpha = state.blendEquationAlpha;
  } else {
    // D3D9 state inherited by TMHouse is SRCBLEND=ONE. Type 0 changes only
    // DESTBLEND to DESTCOLOR; type 11 keeps INVSRCALPHA.
    material.transparent = true;
    material.blending = THREE.CustomBlending;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = mode === "roof" ? THREE.DstColorFactor : THREE.OneMinusSrcAlphaFactor;
    material.blendEquation = THREE.AddEquation;
    material.blendSrcAlpha = null;
    material.blendDstAlpha = null;
    material.blendEquationAlpha = null;
  }
  material.needsUpdate = true;
}
