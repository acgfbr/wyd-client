import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import type { MapObjectRecord } from "../../formats/classic/Dat";
import {
  ClassicSkinnedAssetLibrary,
  type ClassicSkinnedInstanceLease,
} from "../../game/npcs/ClassicSkinnedAssetLibrary";
import { MonsterCatalog } from "../../game/npcs/MonsterCatalog";
import { FIELD_WORLD_SIZE, toScene, type WydPosition } from "../../world/coordinates";
import { fieldKey } from "../../world/regions";
import { EffectTextureLibrary } from "../effects/EffectTextureLibrary";

const FLOAT_MODEL_TYPE = 3;
const FLOAT_BILLBOARD_TYPE = 5;
const FLOAT_SKIN_SCALE = 1.5;
const FLOAT_QUARTER_STEP_MS = 80;

interface FloatEntry {
  readonly type: typeof FLOAT_MODEL_TYPE | typeof FLOAT_BILLBOARD_TYPE;
  readonly position: WydPosition;
  readonly baseHeight: number;
  readonly sceneX: number;
  readonly sceneZ: number;
  readonly seed: number;
  readonly lease: ClassicSkinnedInstanceLease | null;
}

interface FieldState {
  readonly group: THREE.Group;
  readonly entries: FloatEntry[];
  readonly leases: ClassicSkinnedInstanceLease[];
  readonly ownedMaterials: THREE.Material[];
  ripple: THREE.InstancedMesh | null;
  marker: THREE.InstancedMesh | null;
}

interface FloatRuntime {
  readonly catalog: MonsterCatalog;
  readonly skinned: ClassicSkinnedAssetLibrary;
}

/**
 * Runtime equivalent of TMFloat for DAT types 3 and 5. These ids are C++ class
 * selectors, not MeshList/MSA ids: type 3 is the animated fl01 rig, while type
 * 5 is effect texture 90. Both own the pulsing texture-10 water ring.
 */
export class ClassicFloatObjects {
  readonly object = new THREE.Group();
  readonly #runtime: Promise<FloatRuntime | null>;
  readonly #textures: EffectTextureLibrary;
  readonly #fields = new Map<string, FieldState>();
  readonly #generations = new Map<string, number>();
  readonly #plane = createClassicBillboardGeometry();
  #rippleMaterial: Promise<THREE.ShaderMaterial | null> | null = null;
  #markerMaterial: Promise<THREE.ShaderMaterial | null> | null = null;
  #effectsEnabled = true;

  constructor(
    assets: ClassicAssetSource,
    private readonly origin: WydPosition,
    private readonly waterHeightAt: (position: WydPosition, timeMilliseconds: number, preferredField: string) => number | null,
    private readonly groundColorAt: (position: WydPosition) => THREE.Color,
  ) {
    this.object.name = "classic-float-objects";
    this.#textures = new EffectTextureLibrary(assets);
    this.#runtime = MonsterCatalog.load(assets).then((catalog) => ({
      catalog,
      skinned: new ClassicSkinnedAssetLibrary(assets, catalog),
    })).catch((error: unknown) => {
      console.warn("TMFloat clássico indisponível", error);
      return null;
    });
  }

  async addBlock(column: number, row: number, records: readonly MapObjectRecord[]): Promise<void> {
    const key = fieldKey(column, row);
    this.removeBlock(column, row);
    const generation = (this.#generations.get(key) ?? 0) + 1;
    this.#generations.set(key, generation);
    const state: FieldState = {
      group: new THREE.Group(),
      entries: [],
      leases: [],
      ownedMaterials: [],
      ripple: null,
      marker: null,
    };
    state.group.name = `classic-floats-${key}`;
    this.#fields.set(key, state);
    this.object.add(state.group);

    const matching = records.filter((record): record is MapObjectRecord & {
      readonly type: typeof FLOAT_MODEL_TYPE | typeof FLOAT_BILLBOARD_TYPE;
    } => record.type === FLOAT_MODEL_TYPE || record.type === FLOAT_BILLBOARD_TYPE);
    if (matching.length === 0) return;

    const needsModel = matching.some((record) => record.type === FLOAT_MODEL_TYPE);
    const needsMarker = matching.some((record) => record.type === FLOAT_BILLBOARD_TYPE);
    const [runtime, rippleMaterial, markerMaterial] = await Promise.all([
      needsModel ? this.#runtime : Promise.resolve(null),
      this.rippleMaterial(),
      needsMarker ? this.markerMaterial() : Promise.resolve(null),
    ]);
    if (!this.isCurrent(key, generation, state)) return;

    for (let index = 0; index < matching.length; index++) {
      const record = matching[index]!;
      const position = {
        x: column * FIELD_WORLD_SIZE + record.localX,
        y: row * FIELD_WORLD_SIZE + record.localY,
      };
      const scene = toScene(position, this.origin);
      let lease: ClassicSkinnedInstanceLease | null = null;
      if (record.type === FLOAT_MODEL_TYPE && runtime) {
        const definition = runtime.catalog.skinnedObject(FLOAT_MODEL_TYPE);
        const variant = definition?.variants[0];
        if (definition && variant) {
          lease = await runtime.skinned.createInstance({
            skin: definition.skin,
            parts: [{
              name: "tmfloat-fl01",
              mesh: variant.mesh,
              texture: variant.texture,
              alpha: variant.alpha,
            }],
            actions: ["STAND01"],
            initialAction: "STAND01",
            quarterStepMs: FLOAT_QUARTER_STEP_MS,
          });
        }
        if (!this.isCurrent(key, generation, state)) {
          lease?.release();
          return;
        }
        if (lease) {
          lease.model.setClassicTransform({
            yaw: record.angle,
            scale: FLOAT_SKIN_SCALE,
            mirrorModelZ: false,
          });
          // TMFloat randomises m_dwStartOffset in 300 ms steps. A stable seed
          // keeps map reloads deterministic while preserving the phase spread.
          const phaseStep = Math.floor(deterministicSeed(column, row, index) * 10);
          lease.model.update(phaseStep * 0.3);
          for (const mesh of lease.model.meshes) {
            const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
            const material = source?.clone() ?? new THREE.MeshLambertMaterial({ color: 0xb3b3b3 });
            material.transparent = true;
            material.depthWrite = true;
            if ("alphaTest" in material) material.alphaTest = 0;
            if ("color" in material && material.color instanceof THREE.Color) {
              material.color.copy(this.groundColorAt(position)).multiplyScalar(0.3).addScalar(0.5);
            }
            mesh.material = material;
            state.ownedMaterials.push(material);
          }
          lease.model.object.position.set(scene.x, record.height, scene.z);
          state.group.add(lease.model.object);
          state.leases.push(lease);
        }
      }
      state.entries.push({
        type: record.type,
        position,
        baseHeight: record.height,
        sceneX: scene.x,
        sceneZ: scene.z,
        seed: deterministicSeed(column, row, index),
        lease,
      });
      if (index > 0 && index % 8 === 0) await nextFrame();
      if (!this.isCurrent(key, generation, state)) return;
    }

    if (rippleMaterial) {
      state.ripple = createEffectInstances(
        this.#plane,
        rippleMaterial,
        state.entries,
        "tmfloat-water-ripple",
      );
      state.ripple.visible = this.#effectsEnabled;
      state.group.add(state.ripple);
    }
    const markerEntries = state.entries.filter((entry) => entry.type === FLOAT_BILLBOARD_TYPE);
    if (markerMaterial && markerEntries.length > 0) {
      state.marker = createEffectInstances(
        this.#plane,
        markerMaterial,
        markerEntries,
        "tmfloat-type-5-marker",
      );
      state.marker.visible = this.#effectsEnabled;
      state.group.add(state.marker);
    }
    this.updateState(state, key, 0, performance.now());
  }

  update(deltaSeconds: number): void {
    const timeMilliseconds = performance.now();
    for (const [key, state] of this.#fields) {
      this.updateState(state, key, deltaSeconds, timeMilliseconds);
    }
  }

  setEffectsEnabled(enabled: boolean): void {
    this.#effectsEnabled = enabled;
    for (const state of this.#fields.values()) {
      if (state.ripple) state.ripple.visible = enabled;
      if (state.marker) state.marker.visible = enabled;
    }
  }

  removeBlock(column: number, row: number): void {
    const key = fieldKey(column, row);
    this.#generations.set(key, (this.#generations.get(key) ?? 0) + 1);
    const state = this.#fields.get(key);
    if (!state) return;
    this.#fields.delete(key);
    this.object.remove(state.group);
    state.group.clear();
    state.ripple?.geometry.dispose();
    state.marker?.geometry.dispose();
    for (const lease of state.leases.splice(0)) lease.release();
    for (const material of state.ownedMaterials.splice(0)) material.dispose();
  }

  dispose(): void {
    const keys = [...this.#fields.keys()];
    for (const key of keys) {
      const [column, row] = parseFieldKey(key);
      this.removeBlock(column, row);
    }
    this.#generations.clear();
    this.#plane.dispose();
    const materialJobs = [this.#rippleMaterial, this.#markerMaterial].filter(
      (entry): entry is Promise<THREE.ShaderMaterial | null> => entry !== null,
    );
    this.#rippleMaterial = null;
    this.#markerMaterial = null;
    for (const job of materialJobs) void job.then((material) => material?.dispose()).catch(() => undefined);
    void this.#runtime.then((runtime) => runtime?.skinned.dispose()).catch(() => undefined);
    this.#textures.dispose();
    this.object.removeFromParent();
    this.object.clear();
  }

  private isCurrent(key: string, generation: number, state: FieldState): boolean {
    return this.#generations.get(key) === generation && this.#fields.get(key) === state;
  }

  private updateState(
    state: FieldState,
    key: string,
    deltaSeconds: number,
    timeMilliseconds: number,
  ): void {
    const transform = new THREE.Object3D();
    let rippleIndex = 0;
    let markerIndex = 0;
    for (const entry of state.entries) {
      const waterHeight = this.waterHeightAt(entry.position, timeMilliseconds, key)
        ?? entry.baseHeight;
      if (entry.lease) {
        entry.lease.model.object.position.y = waterHeight + 0.3;
        entry.lease.model.update(deltaSeconds);
      }
      if (state.ripple) {
        transform.position.set(entry.sceneX, waterHeight + (entry.type === FLOAT_MODEL_TYPE ? 0.2 : 0.26), entry.sceneZ);
        transform.rotation.set(0, -Math.PI / 4, 0);
        transform.scale.setScalar(1);
        transform.updateMatrix();
        state.ripple.setMatrixAt(rippleIndex++, transform.matrix);
      }
      if (state.marker && entry.type === FLOAT_BILLBOARD_TYPE) {
        transform.position.set(entry.sceneX, waterHeight + 0.36, entry.sceneZ);
        transform.rotation.set(0, -Math.PI / 4, 0);
        transform.scale.setScalar(1);
        transform.updateMatrix();
        state.marker.setMatrixAt(markerIndex++, transform.matrix);
      }
    }
    if (state.ripple) state.ripple.instanceMatrix.needsUpdate = true;
    if (state.marker) state.marker.instanceMatrix.needsUpdate = true;
  }

  private rippleMaterial(): Promise<THREE.ShaderMaterial | null> {
    if (this.#rippleMaterial) return this.#rippleMaterial;
    this.#rippleMaterial = this.#textures.load(10).then((texture) => (
      texture ? createFloatEffectMaterial(texture, true) : null
    ));
    return this.#rippleMaterial;
  }

  private markerMaterial(): Promise<THREE.ShaderMaterial | null> {
    if (this.#markerMaterial) return this.#markerMaterial;
    this.#markerMaterial = this.#textures.load(90).then((texture) => (
      texture ? createFloatEffectMaterial(texture, false) : null
    ));
    return this.#markerMaterial;
  }
}

function parseFieldKey(key: string): [number, number] {
  const [column, row] = key.split(",").map(Number);
  if (!Number.isFinite(column) || !Number.isFinite(row)) return [0, 0];
  return [column!, row!];
}

function createEffectInstances(
  geometry: THREE.BufferGeometry,
  material: THREE.ShaderMaterial,
  entries: readonly FloatEntry[],
  name: string,
): THREE.InstancedMesh {
  const instanceGeometry = geometry.clone();
  const mesh = new THREE.InstancedMesh(instanceGeometry, material, entries.length);
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  instanceGeometry.setAttribute(
    "wydFloatSeed",
    new THREE.InstancedBufferAttribute(new Float32Array(entries.map((entry) => entry.seed)), 1),
  );
  mesh.onBeforeRender = () => {
    material.uniforms.time!.value = performance.now() / 1_000;
  };
  return mesh;
}

function createFloatEffectMaterial(texture: THREE.Texture, ripple: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: ripple ? "WYD TMFloat water effect 10" : "WYD TMFloat marker effect 90",
    uniforms: {
      time: { value: 0 },
      spriteMap: { value: texture },
    },
    vertexShader: /* glsl */ `
      uniform float time;
      attribute float wydFloatSeed;
      varying vec2 vUv;
      varying float vIntensity;
      void main() {
        vUv = uv;
        float phase = fract(time + wydFloatSeed);
        vIntensity = ${ripple ? "sin(phase * 3.14159265)" : "0.80901699"};
        vec3 transformed = position;
        ${ripple ? "transformed.xz *= 0.5 + phase * 0.5;" : ""}
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(transformed, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D spriteMap;
      varying vec2 vUv;
      varying float vIntensity;
      void main() {
        vec4 sampled = texture2D(spriteMap, vUv);
        float sourceAlpha = max(sampled.a, dot(sampled.rgb, vec3(0.333333)));
        float alpha = sourceAlpha * vIntensity;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(sampled.rgb * vIntensity, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: ripple ? THREE.AdditiveBlending : THREE.NormalBlending,
    fog: false,
  });
}

function createClassicBillboardGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -0.5, 0, 0.5,
    0.5, 0, 0.5,
    0.5, 0, -0.5,
    -0.5, 0, -0.5,
  ], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([
    0.02, 0.02,
    0.98, 0.02,
    0.98, 0.98,
    0.02, 0.98,
  ], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function deterministicSeed(column: number, row: number, index: number): number {
  return Math.abs(Math.sin(column * 73.17 + row * 151.31 + index * 19.19) * 43_758.5453) % 1;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
