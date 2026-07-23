import * as THREE from "three";
import type { MapObjectRecord } from "../../formats/classic/Dat";
import { FIELD_WORLD_SIZE, toScene, type WydPosition } from "../../world/coordinates";
import { fieldKey } from "../../world/regions";
import type { ModelLibrary } from "../objects/ModelLibrary";

const EFFECT_MESH_TYPES = new Set([506, 532, 1980]);
const EFFECT_CYCLE_MS = 5_000;

interface EffectMeshDefinition {
  readonly modelType: number;
  readonly color: number;
  readonly shine: boolean;
  readonly scrollU: boolean;
  readonly positionOffsetX: number;
  readonly positionOffsetY: number;
  readonly positionOffsetZ: number;
  readonly absoluteHeight: number | null;
  readonly scaleH: number;
  readonly scaleV: number;
}

interface AnimatedMaterial {
  readonly material: THREE.MeshBasicMaterial;
  readonly baseRed: number;
  readonly baseGreen: number;
  readonly baseBlue: number;
  readonly baseAlpha: number;
  readonly shine: boolean;
  readonly scrollingTexture: THREE.Texture | null;
}

interface FieldResources {
  readonly retainedTypes: Set<number>;
  readonly materials: Set<THREE.Material>;
  readonly ownedTextures: Set<THREE.Texture>;
}

/** MSA-based DAT effects which are neither static scenery nor billboards. */
export class MapMeshEffects {
  readonly object = new THREE.Group();
  readonly #fieldGroups = new Map<string, THREE.Group>();
  readonly #fieldResources = new Map<string, FieldResources>();
  readonly #generations = new Map<string, number>();
  readonly #shadeGeometry = new THREE.CircleGeometry(1, 24);
  readonly #shadeMaterial = createShadeMaterial();

  constructor(
    private readonly models: ModelLibrary,
    private readonly origin: WydPosition,
  ) {
    this.object.name = "map-mesh-effects";
  }

  async addBlock(column: number, row: number, records: readonly MapObjectRecord[]): Promise<void> {
    const key = fieldKey(column, row);
    this.removeBlock(column, row);
    const matching = records.filter((record) => EFFECT_MESH_TYPES.has(record.type));
    if (matching.length === 0) return;

    const generation = (this.#generations.get(key) ?? 0) + 1;
    this.#generations.set(key, generation);
    const group = new THREE.Group();
    group.name = `mesh-effects-${key}`;
    this.#fieldGroups.set(key, group);
    this.object.add(group);

    const resources: FieldResources = {
      retainedTypes: new Set(),
      materials: new Set(),
      ownedTextures: new Set(),
    };
    this.#fieldResources.set(key, resources);

    const prototypes = new Map<number, THREE.Group | null>();
    const types = [...new Set(matching.flatMap((record) => (
      effectMeshDefinitions(record).map((definition) => definition.modelType)
    )))];
    await Promise.all(types.map(async (type) => {
      resources.retainedTypes.add(type);
      prototypes.set(type, await this.models.retain(type));
    }));
    if (!this.isCurrent(key, generation, group)) return;

    const materialCaches = new Map<number, Map<THREE.Material, AnimatedMaterial>>();
    for (const record of matching) {
      const scene = toScene({
        x: column * FIELD_WORLD_SIZE + record.localX,
        y: row * FIELD_WORLD_SIZE + record.localY,
      }, this.origin);
      for (const definition of effectMeshDefinitions(record)) {
        const prototype = prototypes.get(definition.modelType);
        if (!prototype) continue;
        let cache = materialCaches.get(definition.modelType);
        if (!cache) {
          cache = new Map();
          materialCaches.set(definition.modelType, cache);
        }

        const instance = prototype.clone(true);
        instance.position.set(
          scene.x + definition.positionOffsetX,
          definition.absoluteHeight ?? record.height + definition.positionOffsetY,
          scene.z + definition.positionOffsetZ,
        );
        instance.scale.set(definition.scaleH, definition.scaleV, definition.scaleH);
        // TMEffectMesh passes (angle - 90deg, 0, 90deg) to TMMesh, whose
        // renderer contributes another -90deg pitch. This is the converted
        // right-handed YXZ orientation used by the classic windmill as well.
        instance.rotation.set(Math.PI / 2, -(record.angle - Math.PI / 2), Math.PI / 2, "YXZ");
        instance.name = `map-mesh-effect-${record.type}-${definition.modelType}`;
        installEffectMaterials(instance, definition, cache, resources);
        group.add(instance);
      }
    }

    const lights = matching.filter((record) => record.type === 506);
    if (lights.length > 0) group.add(this.createShades(column, row, lights));
  }

  removeBlock(column: number, row: number): void {
    const key = fieldKey(column, row);
    this.#generations.set(key, (this.#generations.get(key) ?? 0) + 1);
    const group = this.#fieldGroups.get(key);
    if (group) {
      this.#fieldGroups.delete(key);
      this.object.remove(group);
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) child.onBeforeRender = () => undefined;
      });
      group.clear();
    }

    const resources = this.#fieldResources.get(key);
    if (!resources) return;
    this.#fieldResources.delete(key);
    for (const material of resources.materials) material.dispose();
    for (const texture of resources.ownedTextures) texture.dispose();
    for (const type of resources.retainedTypes) this.models.release(type);
  }

  dispose(): void {
    const keys = [...this.#fieldGroups.keys()];
    for (const key of keys) {
      const [column, row] = parseFieldKey(key);
      this.removeBlock(column, row);
    }
    this.#generations.clear();
    this.#shadeGeometry.dispose();
    this.#shadeMaterial.dispose();
    this.object.removeFromParent();
    this.object.clear();
  }

  private isCurrent(key: string, generation: number, group: THREE.Group): boolean {
    return this.#generations.get(key) === generation && this.#fieldGroups.get(key) === group;
  }

  private createShades(column: number, row: number, records: readonly MapObjectRecord[]): THREE.InstancedMesh {
    const shades = new THREE.InstancedMesh(this.#shadeGeometry, this.#shadeMaterial, records.length);
    shades.name = "map-effect-506-ground-shades";
    shades.frustumCulled = false;
    const transform = new THREE.Object3D();
    for (let index = 0; index < records.length; index++) {
      const record = records[index]!;
      const scene = toScene({
        x: column * FIELD_WORLD_SIZE + record.localX,
        y: row * FIELD_WORLD_SIZE + record.localY,
      }, this.origin);
      transform.position.set(scene.x, record.height + 0.015, scene.z);
      transform.rotation.set(-Math.PI / 2, 0, 0);
      transform.scale.setScalar(2.4);
      transform.updateMatrix();
      shades.setMatrixAt(index, transform.matrix);
    }
    shades.instanceMatrix.needsUpdate = true;
    return shades;
  }
}

function parseFieldKey(key: string): [number, number] {
  const [column, row] = key.split(",").map(Number);
  if (!Number.isFinite(column) || !Number.isFinite(row)) return [0, 0];
  return [column!, row!];
}

function installEffectMaterials(
  instance: THREE.Group,
  definition: EffectMeshDefinition,
  cache: Map<THREE.Material, AnimatedMaterial>,
  resources: FieldResources,
): void {
  instance.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    // ModelLibrary adds the ordinary MSA base pitch. EffectMesh supplies its
    // complete three-axis transform above, so retaining both would double it.
    child.rotation.set(0, 0, 0);
    const sources = Array.isArray(child.material) ? child.material : [child.material];
    const animated = sources.map((source) => {
      let entry = cache.get(source);
      if (!entry) {
        entry = createAnimatedMaterial(source, definition, resources);
        cache.set(source, entry);
      }
      return entry;
    });
    child.material = Array.isArray(child.material)
      ? animated.map((entry) => entry.material)
      : animated[0]!.material;
    child.castShadow = false;
    child.receiveShadow = false;
    child.renderOrder = 3;
    child.onBeforeRender = () => animateMaterials(animated);
  });
}

function createAnimatedMaterial(
  source: THREE.Material,
  definition: EffectMeshDefinition,
  resources: FieldResources,
): AnimatedMaterial {
  const textured = source as THREE.Material & { map?: THREE.Texture | null };
  let map = textured.map ?? null;
  let scrollingTexture: THREE.Texture | null = null;
  if (definition.scrollU && map) {
    map = map.clone();
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.needsUpdate = true;
    scrollingTexture = map;
    resources.ownedTextures.add(map);
  }

  const packedColor = definition.color;
  const baseAlpha = ((packedColor >>> 24) & 0xff) / 255;
  const baseRed = ((packedColor >>> 16) & 0xff) / 255;
  const baseGreen = ((packedColor >>> 8) & 0xff) / 255;
  const baseBlue = (packedColor & 0xff) / 255;
  const material = new THREE.MeshBasicMaterial({
    name: `WYD map EffectMesh ${definition.modelType}`,
    map,
    color: new THREE.Color().setRGB(baseRed, baseGreen, baseBlue),
    opacity: baseAlpha,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
  resources.materials.add(material);
  return {
    material,
    baseRed,
    baseGreen,
    baseBlue,
    baseAlpha,
    shine: definition.shine,
    scrollingTexture,
  };
}

function animateMaterials(materials: readonly AnimatedMaterial[]): void {
  const now = performance.now();
  const progress = (now % EFFECT_CYCLE_MS) / EFFECT_CYCLE_MS;
  const shine = 0.8 + Math.sin(progress * Math.PI * 2) * 0.2;
  for (const entry of materials) {
    const intensity = entry.shine ? shine : 1;
    entry.material.color.setRGB(
      entry.baseRed * intensity,
      entry.baseGreen * intensity,
      entry.baseBlue * intensity,
    );
    entry.material.opacity = entry.baseAlpha * intensity;
    if (entry.scrollingTexture) {
      // The original increments U by progress*0.001 every rendered frame.
      // 0.03 UV/s matches that frame-dependent drift at its nominal 60 FPS.
      entry.scrollingTexture.offset.x = (now * 0.00003) % 1;
    }
  }
}

function effectMeshDefinitions(record: MapObjectRecord): readonly EffectMeshDefinition[] {
  if (record.type === 1980) {
    return [
      effectMeshDefinition(1980, 0xaaaaaaaa),
      {
        ...effectMeshDefinition(1979, 0xaaaaaaaa, true, true),
        positionOffsetX: 4.5799999,
        positionOffsetZ: -4.5,
        absoluteHeight: 0.3,
        scaleH: 0.98,
        scaleV: record.height / 15.4 + 0.72000003,
      },
      {
        ...effectMeshDefinition(1981, 0x88888888),
        positionOffsetX: 4.5799999,
        positionOffsetZ: -4.5,
        absoluteHeight: 0.30000001,
      },
    ];
  }
  return [
    effectMeshDefinition(
      record.type,
      record.type === 506 ? 0x44554444 : 0xaaaaaaaa,
      true,
      record.type === 532,
      record.scaleH || 1,
      record.scaleV || 1,
    ),
  ];
}

function effectMeshDefinition(
  modelType: number,
  color: number,
  shine = false,
  scrollU = false,
  scaleH = 1,
  scaleV = 1,
): EffectMeshDefinition {
  return {
    modelType,
    color,
    shine,
    scrollU,
    positionOffsetX: 0,
    positionOffsetY: 0,
    positionOffsetZ: 0,
    absoluteHeight: null,
    scaleH,
    scaleV,
  };
}

function createShadeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: "WYD EffectMesh 506 ground shade",
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        float distanceFromCenter = length(vUv - vec2(0.5)) * 2.0;
        float alpha = (1.0 - smoothstep(0.15, 1.0, distanceFromCenter)) * 0.16;
        gl_FragColor = vec4(1.0, 0.86, 0.86, alpha);
      }
    `,
  });
}
