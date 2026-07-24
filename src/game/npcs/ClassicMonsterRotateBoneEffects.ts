import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import type { ModelLibrary } from "../../render/objects/ModelLibrary";
import { ClassicDdsTextureLoader } from "../../render/textures/ClassicDdsTextureLoader";
import type { MonsterCatalog, MonsterTemplate } from "./MonsterCatalog";

const MESH_TYPES = [3, 6, 4, 7, 5, 6, 7] as const;
const UNIQUE_MESH_TYPES = [...new Set(MESH_TYPES)];
const FIRE_TEXTURES = [11, 12, 13, 14, 15, 16, 17, 18] as const;
const ROTATION_SECONDS = 1;
const FRAME_SECONDS = 0.08;

interface RotateBoneResources {
  readonly prototypes: ReadonlyMap<number, THREE.Group>;
  readonly fireTextures: readonly THREE.Texture[];
  readonly fireMaterials: readonly THREE.SpriteMaterial[];
}

export interface ClassicMonsterRotateBoneActorEffect {
  readonly object: THREE.Group;
  update(timeSeconds: number): void;
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

/**
 * TMEffectMeshRotate used by the helmet-10 skeleton warrior.
 *
 * The retail client orbits seven real bnsh01..05 common meshes at radius 1,
 * phases them by 150 ms and attaches the 11..18 red-fire sequence to every
 * shield. Resources are retained once for the whole streamed spawn manager.
 */
export class ClassicMonsterRotateBoneEffects {
  readonly #dds = new ClassicDdsTextureLoader();
  #resourcesJob: Promise<RotateBoneResources | null> | null = null;
  #resources: RotateBoneResources | null = null;
  #disposed = false;

  constructor(
    private readonly assets: ClassicAssetSource,
    private readonly models: ModelLibrary,
    private readonly catalog: MonsterCatalog,
  ) {}

  async create(
    template: MonsterTemplate,
  ): Promise<ClassicMonsterRotateBoneActorEffect | null> {
    if (!usesRotateBoneEffect(template, this.catalog) || this.#disposed) return null;
    const resources = await this.loadResources();
    if (!resources || this.#disposed) return null;
    return createActorEffect(resources);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#resources) this.disposeResources(this.#resources);
    this.#resources = null;
  }

  private loadResources(): Promise<RotateBoneResources | null> {
    if (this.#resourcesJob) return this.#resourcesJob;
    this.#resourcesJob = Promise.all([
      Promise.all(UNIQUE_MESH_TYPES.map(async (type) => (
        [type, await this.models.retain(type)] as const
      ))),
      Promise.all(FIRE_TEXTURES.map((index) => this.loadTexture(index))),
    ]).then(([models, textures]) => {
      const prototypes = new Map<number, THREE.Group>();
      for (const [type, prototype] of models) {
        if (prototype) prototypes.set(type, prototype);
      }
      const fireTextures = textures.filter((texture): texture is THREE.Texture => texture !== null);
      if (prototypes.size !== UNIQUE_MESH_TYPES.length || fireTextures.length !== FIRE_TEXTURES.length) {
        for (const type of UNIQUE_MESH_TYPES) this.models.release(type);
        for (const texture of fireTextures) texture.dispose();
        return null;
      }
      const resources: RotateBoneResources = {
        prototypes,
        fireTextures,
        fireMaterials: fireTextures.map(createFireMaterial),
      };
      if (this.#disposed) {
        this.disposeResources(resources);
        return null;
      }
      this.#resources = resources;
      return resources;
    }).catch(() => {
      for (const type of UNIQUE_MESH_TYPES) this.models.release(type);
      return null;
    });
    return this.#resourcesJob;
  }

  private async loadTexture(index: number): Promise<THREE.Texture | null> {
    const url = this.assets.effectTextureUrl(index);
    if (!url) return null;
    return this.#dds.loadAsync(url).then((texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      // Sprite UVs must invert the top-left DDS convention used by the client.
      texture.offset.set(0.02, 0.98);
      texture.repeat.set(0.96, -0.96);
      return texture;
    }).catch(() => null);
  }

  private disposeResources(resources: RotateBoneResources): void {
    for (const material of resources.fireMaterials) material.dispose();
    for (const texture of resources.fireTextures) texture.dispose();
    for (const type of UNIQUE_MESH_TYPES) this.models.release(type);
  }
}

function usesRotateBoneEffect(template: MonsterTemplate, catalog: MonsterCatalog): boolean {
  const visual = template.visual;
  if (!visual || (visual.itemClass !== 36 && visual.itemClass !== 37)) return false;
  const helmMesh = visual.parts.find((part) => part[0] === 2)?.[2] ?? 0;
  if (helmMesh !== 10) return false;
  const leftItem = catalog.item(template.equipment?.[6 * 7] ?? 0);
  return (leftItem?.mesh ?? -1) !== 930;
}

function createActorEffect(
  resources: RotateBoneResources,
): ClassicMonsterRotateBoneActorEffect {
  const object = new THREE.Group();
  const orbiters: {
    readonly holder: THREE.Group;
    readonly mesh: THREE.Group;
    readonly flame: THREE.Sprite;
    readonly phaseMilliseconds: number;
  }[] = [];
  object.name = "classic-monster-rotate-bone-effects";

  for (let index = 0; index < MESH_TYPES.length; index++) {
    const type = MESH_TYPES[index]!;
    const prototype = resources.prototypes.get(type)!;
    const holder = new THREE.Group();
    holder.name = `classic-rotate-bone-${index}-mesh-${type}`;

    const mesh = prototype.clone(true);
    // ModelLibrary supplies the ordinary map-object pitch. EffectMeshRotate
    // passes the complete yaw/pitch/roll transform directly to TMMesh.
    for (const child of mesh.children) child.rotation.set(0, 0, 0);
    mesh.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = false;
      child.receiveShadow = false;
      child.frustumCulled = false;
      child.renderOrder = 3;
    });
    holder.add(mesh);

    const flame = new THREE.Sprite(resources.fireMaterials[0]);
    flame.name = `classic-rotate-bone-fire-${index}`;
    flame.position.y = 0.2;
    flame.scale.set(0.8, 1, 1);
    flame.renderOrder = 8;
    holder.add(flame);
    object.add(holder);
    orbiters.push({
      holder,
      mesh,
      flame,
      phaseMilliseconds: index * 150,
    });
  }

  let enabled = true;
  let disposed = false;
  return {
    object,
    update(timeSeconds: number): void {
      if (!enabled || disposed) return;
      const milliseconds = timeSeconds * 1_000;
      const fireFrame = Math.floor(milliseconds / (FRAME_SECONDS * 1_000))
        % resources.fireMaterials.length;
      const fireMaterial = resources.fireMaterials[fireFrame]!;
      for (const orbiter of orbiters) {
        // C++: ((m_dwStartTime - serverTime) % 1000) / 1000.
        const phase = (
          (orbiter.phaseMilliseconds - milliseconds)
          / (ROTATION_SECONDS * 1_000)
        ) * Math.PI * 2;
        orbiter.holder.position.set(Math.cos(phase), 1, -Math.sin(phase));
        // TMEffectMeshRotate doubles the orbital angle for the shield mesh.
        orbiter.mesh.rotation.set(Math.PI / 2, -(phase * 2), Math.PI / 2, "YXZ");
        if (orbiter.flame.material !== fireMaterial) orbiter.flame.material = fireMaterial;
      }
    },
    setEnabled(next: boolean): void {
      enabled = next;
      object.visible = next;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      object.removeFromParent();
      object.clear();
    },
  };
}

function createFireMaterial(texture: THREE.Texture): THREE.SpriteMaterial {
  const material = new THREE.SpriteMaterial({
    map: texture,
    color: 0x440000,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
  material.forceSinglePass = true;
  return material;
}
