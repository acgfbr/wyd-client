import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import type { MapObjectRecord } from "../../formats/classic/Dat";
import {
  ClassicSkinnedAssetLibrary,
  type ClassicSkinnedInstanceLease,
} from "../../game/npcs/ClassicSkinnedAssetLibrary";
import {
  MonsterCatalog,
  type CatalogSkinnedObject,
  type CatalogSkinnedObjectVariant,
} from "../../game/npcs/MonsterCatalog";
import { FIELD_WORLD_SIZE, toScene, type WydPosition } from "../../world/coordinates";
import { fieldKey } from "../../world/regions";
import { EffectTextureLibrary } from "../effects/EffectTextureLibrary";

const LOW_AMBIENT_TYPES = new Set([4, 6, 7, 8, 9, 10, 12, 13, 343, 344]);

export function isClassicEnvironmentType(type: number): boolean {
  return LOW_AMBIENT_TYPES.has(type)
    || (type >= 311 && type <= 322)
    || (type >= 331 && type <= 342)
    || (type >= 351 && type <= 378)
    || (type >= 487 && type <= 489);
}

type ShaderProfile = "leaf" | "tree" | "ship" | "butterfly" | "butterfly-tiny" | "fish";

interface AmbientInstance {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
  readonly seed: number;
}

interface InstanceBatch {
  readonly definition: CatalogSkinnedObject;
  readonly variant: CatalogSkinnedObjectVariant;
  readonly profile: ShaderProfile;
  readonly types: Set<number>;
  readonly instances: AmbientInstance[];
}

interface BakedPrototype {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.MeshLambertMaterial;
  readonly time: { value: number };
  readonly lease: ClassicSkinnedInstanceLease;
}

interface PrototypeEntry {
  references: number;
  readonly promise: Promise<BakedPrototype | null>;
}

interface FieldState {
  readonly group: THREE.Group;
  readonly releases: Array<() => void>;
  readonly disposers: Array<() => void>;
}

interface RuntimeAssets {
  readonly catalog: MonsterCatalog;
  readonly skinned: ClassicSkinnedAssetLibrary;
}

/**
 * DAT entities whose numeric id is interpreted as a C++ class rather than a
 * MeshList id. Dense grass and small fauna are instanced so a Field with more
 * than ten thousand leaves remains cheap to stream and render.
 */
export class ClassicEnvironmentObjects {
  readonly object = new THREE.Group();
  readonly #runtime: Promise<RuntimeAssets | null>;
  readonly #textures: EffectTextureLibrary;
  readonly #prototypes = new Map<string, PrototypeEntry>();
  readonly #fields = new Map<string, FieldState>();
  readonly #generations = new Map<string, number>();
  #effectsEnabled = true;

  constructor(
    private readonly assets: ClassicAssetSource,
    private readonly origin: WydPosition,
  ) {
    this.object.name = "classic-environment-objects";
    this.#textures = new EffectTextureLibrary(assets);
    this.#runtime = MonsterCatalog.load(assets).then((catalog) => ({
      catalog,
      skinned: new ClassicSkinnedAssetLibrary(assets, catalog),
    })).catch((error: unknown) => {
      console.warn("Ambientação esquelética clássica indisponível", error);
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
      releases: [],
      disposers: [],
    };
    state.group.name = `classic-environment-${key}`;
    this.#fields.set(key, state);
    this.object.add(state.group);

    const special = records
      .map((record, index) => ({ record, index }))
      .filter(({ record }) => isClassicEnvironmentType(record.type));
    if (special.length === 0) return;

    const runtime = await this.#runtime;
    if (!runtime || !this.isCurrent(key, generation, state)) return;

    const batches = new Map<string, InstanceBatch>();
    for (const { record, index } of special) {
      if (record.type === 8 || record.type === 9 || record.type === 10 || record.type === 13) continue;
      const definition = runtime.catalog.skinnedObject(record.type);
      if (!definition || definition.variants.length === 0) continue;
      const copies = definition.kind === "butterfly" || definition.kind === "fish" ? 5 : 1;
      for (let copy = 0; copy < copies; copy++) {
        const seed = deterministic(column, row, index, copy, record.type);
        const sourceVariant = definition.variants[Math.floor(seed * definition.variants.length)]
          ?? definition.variants[0];
        if (!sourceVariant) continue;
        const variant = regionalLeafVariant(column, row, definition, sourceVariant);
        const profile = shaderProfile(record.type, definition.kind);
        const batchKey = [
          definition.skin,
          variant.mesh,
          variant.texture ?? "-",
          variant.alpha ?? "?",
          profile,
        ].join("|");
        let batch = batches.get(batchKey);
        if (!batch) {
          batch = { definition, variant, profile, types: new Set(), instances: [] };
          batches.set(batchKey, batch);
        }
        batch.types.add(record.type);
        batch.instances.push(createInstance(column, row, record, definition.kind, seed, this.origin));
      }
    }

    await Promise.all([
      ...[...batches.entries()].map(([prototypeKey, batch]) => (
        this.addInstanceBatch(key, generation, state, runtime, prototypeKey, batch)
      )),
      this.addParticleBatch(key, generation, state, column, row, special.map(({ record }) => record), 8),
      this.addParticleBatch(key, generation, state, column, row, special.map(({ record }) => record), 9),
      this.addParticleBatch(key, generation, state, column, row, special.map(({ record }) => record), 10),
      this.addParticleBatch(key, generation, state, column, row, special.map(({ record }) => record), 13),
    ]);
  }

  removeBlock(column: number, row: number): void {
    const key = fieldKey(column, row);
    this.#generations.set(key, (this.#generations.get(key) ?? 0) + 1);
    const state = this.#fields.get(key);
    if (!state) return;
    this.#fields.delete(key);
    this.object.remove(state.group);
    state.group.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Points) child.onBeforeRender = () => undefined;
    });
    state.group.clear();
    for (const dispose of state.disposers.splice(0)) dispose();
    for (const release of state.releases.splice(0)) release();
  }

  /** Mirrors g_bHideEffect for rain/snow/ambient particles, not vegetation. */
  setEffectsEnabled(enabled: boolean): void {
    this.#effectsEnabled = enabled;
    this.object.traverse((child) => {
      if (child instanceof THREE.Points) child.visible = enabled;
    });
  }

  private isCurrent(key: string, generation: number, state: FieldState): boolean {
    return this.#generations.get(key) === generation && this.#fields.get(key) === state;
  }

  private async addInstanceBatch(
    field: string,
    generation: number,
    state: FieldState,
    runtime: RuntimeAssets,
    prototypeKey: string,
    batch: InstanceBatch,
  ): Promise<void> {
    const release = this.retainPrototype(prototypeKey, runtime, batch);
    state.releases.push(release.release);
    const prototype = await release.promise;
    if (!prototype || !this.isCurrent(field, generation, state)) return;

    let geometry = prototype.geometry;
    if (isFauna(batch.profile)) {
      geometry = prototype.geometry.clone();
      geometry.setAttribute(
        "wydSeed",
        new THREE.InstancedBufferAttribute(new Float32Array(batch.instances.map((entry) => entry.seed)), 1),
      );
      state.disposers.push(() => geometry.dispose());
    }

    const mesh = new THREE.InstancedMesh(geometry, prototype.material, batch.instances.length);
    mesh.name = `classic-${batch.profile}-${[...batch.types].join("-")}`;
    mesh.castShadow = batch.profile === "tree" || batch.profile === "ship";
    mesh.receiveShadow = batch.profile !== "butterfly" && batch.profile !== "butterfly-tiny";
    mesh.frustumCulled = !isFauna(batch.profile);
    const transform = new THREE.Object3D();
    for (let index = 0; index < batch.instances.length; index++) {
      const instance = batch.instances[index];
      if (!instance) continue;
      transform.position.set(instance.x, instance.y, instance.z);
      transform.quaternion.setFromAxisAngle(UP, -instance.yaw);
      transform.scale.setScalar(instance.scale);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    mesh.onBeforeRender = () => {
      prototype.time.value = performance.now() / 1_000;
    };
    state.group.add(mesh);
  }

  private retainPrototype(
    key: string,
    runtime: RuntimeAssets,
    batch: InstanceBatch,
  ): { readonly promise: Promise<BakedPrototype | null>; readonly release: () => void } {
    let entry = this.#prototypes.get(key);
    if (!entry) {
      entry = {
        references: 0,
        promise: this.createPrototype(runtime, batch).catch(() => null),
      };
      this.#prototypes.set(key, entry);
    }
    entry.references++;
    let released = false;
    return {
      promise: entry.promise,
      release: () => {
        if (released) return;
        released = true;
        const current = this.#prototypes.get(key);
        if (!current) return;
        current.references = Math.max(0, current.references - 1);
        if (current.references !== 0) return;
        this.#prototypes.delete(key);
        void current.promise.then((prototype) => {
          if (!prototype) return;
          prototype.geometry.dispose();
          prototype.material.dispose();
          prototype.lease.release();
        }).catch(() => undefined);
      },
    };
  }

  private async createPrototype(runtime: RuntimeAssets, batch: InstanceBatch): Promise<BakedPrototype | null> {
    const lease = await runtime.skinned.createInstance({
      skin: batch.definition.skin,
      parts: [{
        name: `environment-${batch.profile}`,
        mesh: batch.variant.mesh,
        texture: batch.variant.texture,
        alpha: batch.variant.alpha,
      }],
      actions: ["STAND01"],
      initialAction: "STAND01",
    });
    if (!lease) return null;
    try {
      // TMLeaf/TMTree/TMShip create TMSkinMesh with no owner and mesh type 0.
      // TMSkinMesh::Render only applies its extra Z mirror to an owned mesh of
      // type 1 (the character branch). Mirroring these world objects displaced
      // their deliberately off-centre footprints by roughly one tile.
      lease.model.setClassicTransform({ yaw: 0, scale: 1, mirrorModelZ: false });
      const geometry = bakeFirstPose(lease);
      const sourceMaterial = lease.model.meshes[0]?.material;
      if (!sourceMaterial || Array.isArray(sourceMaterial) || !(sourceMaterial instanceof THREE.MeshLambertMaterial)) {
        geometry.dispose();
        lease.release();
        return null;
      }
      const material = sourceMaterial.clone();
      configureMaterial(material, batch.profile, batch.variant.alpha);
      const time = installAmbientShader(material, geometry, batch.profile);
      return { geometry, material, time, lease };
    } catch (error) {
      lease.release();
      throw error;
    }
  }

  private async addParticleBatch(
    field: string,
    generation: number,
    state: FieldState,
    column: number,
    row: number,
    records: readonly MapObjectRecord[],
    type: 8 | 9 | 10 | 13,
  ): Promise<void> {
    const matching = records.filter((record) => record.type === type);
    if (matching.length === 0) return;
    const textureIndex = type === 9 ? 6 : type === 10 ? 9 : 119;
    const texture = await this.#textures.load(textureIndex);
    if (!texture || !this.isCurrent(field, generation, state)) return;
    const copies = type === 9 ? 2 : type === 10 ? 10 : 1;
    const count = matching.length * copies;
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    let cursor = 0;
    for (let recordIndex = 0; recordIndex < matching.length; recordIndex++) {
      const record = matching[recordIndex];
      if (!record) continue;
      const scene = toScene({
        x: column * FIELD_WORLD_SIZE + record.localX,
        y: row * FIELD_WORLD_SIZE + record.localY,
      }, this.origin);
      for (let copy = 0; copy < copies; copy++, cursor++) {
        const seed = deterministic(column, row, recordIndex, copy, type);
        positions[cursor * 3] = scene.x + (hash01(seed * 97.1) - 0.5) * (type === 10 ? 1 : 0.8);
        positions[cursor * 3 + 1] = record.height;
        positions[cursor * 3 + 2] = scene.z + (hash01(seed * 193.7) - 0.5) * (type === 10 ? 1 : 0.8);
        seeds[cursor] = seed;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("seed", new THREE.BufferAttribute(seeds, 1));
    geometry.computeBoundingSphere();
    if (geometry.boundingSphere) geometry.boundingSphere.radius += type === 13 ? 24 : 12;
    const { material, time } = createParticleMaterial(texture, type);
    const particles = new THREE.Points(geometry, material);
    particles.name = type === 10 ? "classic-local-rain" : `classic-ambient-particles-${type}`;
    particles.renderOrder = 5;
    particles.visible = this.#effectsEnabled;
    particles.onBeforeRender = () => {
      time.value = performance.now() / 1_000;
    };
    state.disposers.push(() => {
      geometry.dispose();
      material.dispose();
    });
    state.group.add(particles);
  }
}

const UP = new THREE.Vector3(0, 1, 0);

function regionalLeafVariant(
  column: number,
  row: number,
  definition: CatalogSkinnedObject,
  variant: CatalogSkinnedObjectVariant,
): CatalogSkinnedObjectVariant {
  if (
    definition.kind !== "leaf"
    || column <= 26 || column >= 31
    || row <= 20 || row >= 25
    || !variant.regionalTexture
  ) return variant;
  return {
    ...variant,
    texture: variant.regionalTexture,
    alpha: variant.regionalAlpha ?? variant.alpha,
  };
}

function shaderProfile(type: number, kind: CatalogSkinnedObject["kind"]): ShaderProfile {
  if (kind === "float") throw new Error("TMFloat pertence à camada aquática animada");
  if (kind === "butterfly") return type === 7 ? "butterfly-tiny" : "butterfly";
  return kind;
}

function isFauna(profile: ShaderProfile): boolean {
  return profile === "butterfly" || profile === "butterfly-tiny" || profile === "fish";
}

function createInstance(
  column: number,
  row: number,
  record: MapObjectRecord,
  kind: CatalogSkinnedObject["kind"],
  seed: number,
  origin: WydPosition,
): AmbientInstance {
  const scene = toScene({
    x: column * FIELD_WORLD_SIZE + record.localX,
    y: row * FIELD_WORLD_SIZE + record.localY,
  }, origin);
  let x = scene.x;
  let y = record.height;
  let z = scene.z;
  let scale = 1;
  let yaw = record.angle;
  if (kind === "butterfly") {
    x += hash01(seed * 11.7) * 0.4;
    z -= hash01(seed * 17.3) * 0.4;
    y += hash01(seed * 23.9) * 1.8;
    scale = record.type === 7 ? 0.2 : record.type === 4 ? (seed < 0.5 ? 1 : 0.69) : 0.5;
    yaw = record.type === 7 ? -Math.PI / 2 : seed * Math.PI * 2;
  } else if (kind === "fish") {
    x += hash01(seed * 31.1) * 0.2;
    z -= hash01(seed * 43.7) * 0.2;
    y += hash01(seed * 53.3) * 0.18;
    scale = 1 + Math.floor(hash01(seed * 67.1) * 10) * 0.1;
    yaw = seed * Math.PI * 2;
  }
  return { x, y, z, yaw, scale, seed };
}

function deterministic(column: number, row: number, record: number, copy: number, type: number): number {
  return hash01(column * 73.17 + row * 151.31 + record * 19.19 + copy * 7.13 + type * 0.811);
}

function hash01(value: number): number {
  return Math.abs(Math.sin(value * 12.9898 + 78.233) * 43_758.5453) % 1;
}

function bakeFirstPose(lease: ClassicSkinnedInstanceLease): THREE.BufferGeometry {
  const source = lease.model.meshes[0];
  if (!source) throw new Error("Objeto ambiental clássico sem MSH");
  lease.model.object.updateMatrixWorld(true);
  source.skeleton.update();
  const sourcePosition = source.geometry.getAttribute("position");
  const positions = new Float32Array(sourcePosition.count * 3);
  const vertex = new THREE.Vector3();
  for (let index = 0; index < sourcePosition.count; index++) {
    vertex.fromBufferAttribute(sourcePosition, index);
    source.applyBoneTransform(index, vertex);
    vertex.applyMatrix4(source.matrixWorld);
    positions[index * 3] = vertex.x;
    positions[index * 3 + 1] = vertex.y;
    positions[index * 3 + 2] = vertex.z;
  }
  const geometry = source.geometry.clone();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.deleteAttribute("skinIndex");
  geometry.deleteAttribute("skinWeight");
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function configureMaterial(
  material: THREE.MeshLambertMaterial,
  profile: ShaderProfile,
  alpha: string | null,
): void {
  material.name = `WYD classic ${profile}`;
  material.side = THREE.DoubleSide;
  if (profile === "leaf") {
    material.transparent = true;
    material.alphaTest = 0.22;
    material.depthWrite = false;
  } else if (profile === "tree") {
    material.alphaTest = Math.max(material.alphaTest, 0.5);
  } else if (profile === "butterfly" || profile === "butterfly-tiny") {
    material.transparent = true;
    material.alphaTest = 0;
    material.depthWrite = profile === "butterfly-tiny";
    material.blending = THREE.AdditiveBlending;
  } else if (profile === "ship") {
    material.transparent = false;
    material.alphaTest = alpha === "C" ? 0 : material.alphaTest;
  }
}

function installAmbientShader(
  material: THREE.MeshLambertMaterial,
  geometry: THREE.BufferGeometry,
  profile: ShaderProfile,
): { value: number } {
  const time = { value: 0 };
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const bounds = geometry.boundingBox ?? new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
  const minimum = bounds.min.y;
  const height = Math.max(0.001, bounds.max.y - bounds.min.y);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.wydTime = time;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>\nuniform float wydTime;${isFauna(profile) ? "\nattribute float wydSeed;" : ""}`,
    );
    if (profile === "leaf" || profile === "tree") {
      const amplitude = profile === "leaf" ? 0.055 : Math.min(0.18, Math.max(0.025, height * 0.018));
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float wydTop = clamp((position.y - ${minimum.toFixed(6)}) / ${height.toFixed(6)}, 0.0, 1.0);
          float wydWind = wydTime * ${profile === "leaf" ? "1.45" : "0.72"}
            + instanceMatrix[3].x * 0.071 + instanceMatrix[3].z * 0.053;
          transformed.x += sin(wydWind) * wydTop * wydTop * ${amplitude.toFixed(6)};
          transformed.z += cos(wydWind * 0.83) * wydTop * wydTop * ${(amplitude * 0.55).toFixed(6)};
        #endif`,
      );
    } else if (profile === "ship") {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          transformed.y += sin(wydTime * 0.72 + instanceMatrix[3].x * 0.09 + instanceMatrix[3].z * 0.07) * 0.075;
        #endif`,
      );
    } else {
      const fish = profile === "fish";
      const tiny = profile === "butterfly-tiny";
      const radius = fish ? 1.7 : tiny ? 1.0 : 0.72;
      const vertical = fish ? 0.08 : tiny ? 0.48 : 0.32;
      const speed = fish ? 0.62 : tiny ? 1.25 : 0.92;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        transformed.y += sin(wydTime * ${fish ? "7.0" : "18.0"} + wydSeed * 31.4159)
          * abs(position.x) * ${fish ? "0.012" : "0.045"};`,
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <project_vertex>",
        `vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_BATCHING
          mvPosition = batchingMatrix * mvPosition;
        #endif
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          float wydPhase = wydTime * ${speed.toFixed(4)} + wydSeed * 31.415926;
          mvPosition.x += sin(wydPhase) * ${radius.toFixed(4)};
          mvPosition.z += cos(wydPhase * ${fish ? "0.79" : "0.73"}) * ${radius.toFixed(4)};
          mvPosition.y += sin(wydPhase * ${fish ? "1.61" : "2.4"}) * ${vertical.toFixed(4)};
        #endif
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`,
      );
    }
  };
  // Wind deformation embeds the prototype bounds directly in GLSL. Include
  // them in the cache key so Three.js cannot reuse (for example) a shrub's
  // program for a tall tree that happens to share the same material profile.
  material.customProgramCacheKey = () => [
    "wyd-environment",
    profile,
    minimum.toFixed(6),
    height.toFixed(6),
  ].join("-");
  material.needsUpdate = true;
  return time;
}

function createParticleMaterial(
  texture: THREE.Texture,
  type: 8 | 9 | 10 | 13,
): { readonly material: THREE.ShaderMaterial; readonly time: { value: number } } {
  const time = { value: 0 };
  const rain = type === 10;
  const fallingStone = type === 13;
  const luminous = type === 9;
  const material = new THREE.ShaderMaterial({
    name: rain ? "WYD local rain" : `WYD ambient particle ${type}`,
    uniforms: {
      time,
      spriteMap: { value: texture },
      tint: { value: new THREE.Color(rain ? 0xa9c8e8 : fallingStone ? 0x7a6957 : luminous ? 0xc9d5ff : 0xb8aa91) },
      opacity: { value: rain ? 0.48 : luminous ? 0.65 : 0.42 },
    },
    vertexShader: /* glsl */ `
      uniform float time;
      attribute float seed;
      varying float vFade;
      void main() {
        vec3 animated = position;
        float phase = fract(time * ${rain ? "0.52" : fallingStone ? "0.18" : luminous ? "0.31" : "0.095"} + seed);
        ${rain
          ? "animated.y += (1.0 - phase) * 10.0; animated.x += sin(seed * 51.0) * 0.18;"
          : fallingStone
            ? "animated.y += (1.0 - phase) * 21.0; animated.x += sin(seed * 43.0) * 0.7; animated.z += cos(seed * 37.0) * 0.7;"
            : luminous
              ? "animated.y += phase * 1.4; animated.x += sin(time * 1.7 + seed * 29.0) * 0.18;"
              : "animated.y += phase * 1.1; animated.x += sin(time * 0.8 + seed * 17.0) * 0.28;"}
        vFade = sin(phase * 3.14159265);
        vec4 mvPosition = modelViewMatrix * vec4(animated, 1.0);
        gl_PointSize = clamp(${rain ? "235.0" : fallingStone ? "135.0" : "105.0"} / max(1.0, -mvPosition.z), ${rain ? "4.0, 24.0" : "2.0, 14.0"});
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D spriteMap;
      uniform vec3 tint;
      uniform float opacity;
      varying float vFade;
      void main() {
        vec4 sampleColor = texture2D(spriteMap, gl_PointCoord);
        float sourceAlpha = max(sampleColor.a, dot(sampleColor.rgb, vec3(0.333333)));
        ${rain
          ? "float shape = smoothstep(0.18, 0.025, abs(gl_PointCoord.x - 0.5));"
          : "float shape = smoothstep(0.5, 0.08, length(gl_PointCoord - vec2(0.5)));"}
        float alpha = sourceAlpha * shape * vFade * opacity;
        if (alpha < 0.015) discard;
        gl_FragColor = vec4(tint * max(sampleColor.rgb, vec3(0.45)), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: luminous ? THREE.AdditiveBlending : THREE.NormalBlending,
    fog: false,
  });
  return { material, time };
}
