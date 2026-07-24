import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { parseMsa } from "../../formats/classic/Msa";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";

interface ModelResource {
  readonly prototype: THREE.Group | null;
  readonly textureFiles: readonly string[];
}

interface ModelCacheEntry {
  references: number;
  readonly promise: Promise<ModelResource>;
}

interface TextureCacheEntry {
  references: number;
  readonly promise: Promise<THREE.Texture | null>;
}

export class ModelLibrary {
  readonly #loader = new ClassicDdsTextureLoader();
  readonly #cache = new Map<number, ModelCacheEntry>();
  readonly #textures = new Map<string, TextureCacheEntry>();

  constructor(private readonly assets: ClassicAssetSource) {}

  load(type: number): Promise<THREE.Group | null> {
    const cached = this.#cache.get(type);
    if (cached) return cached.promise.then((resource) => resource.prototype);
    const promise = this.loadUncached(type);
    this.#cache.set(type, { references: 0, promise });
    return promise.then((resource) => resource.prototype);
  }

  /** Mantem o prototipo vivo enquanto ao menos um Field carregado o utiliza. */
  retain(type: number): Promise<THREE.Group | null> {
    let cached = this.#cache.get(type);
    if (!cached) {
      cached = { references: 0, promise: this.loadUncached(type) };
      this.#cache.set(type, cached);
    }
    cached.references++;
    return cached.promise.then((resource) => resource.prototype);
  }

  /**
   * Os clones compartilham geometria/material/textura com o prototipo. So os
   * descartamos quando nenhum dos Fields residentes usa mais esse tipo.
   */
  release(type: number): void {
    const cached = this.#cache.get(type);
    if (!cached) return;
    cached.references = Math.max(0, cached.references - 1);
    if (cached.references !== 0) return;
    this.#cache.delete(type);
    void cached.promise.then((resource) => {
      this.disposeResource(resource);
    }).catch(() => undefined);
  }

  dispose(): void {
    const entries = [...this.#cache.values()];
    this.#cache.clear();
    for (const entry of entries) {
      entry.references = 0;
      void entry.promise.then((resource) => {
        this.disposeResource(resource);
      }).catch(() => undefined);
    }
  }

  private async loadUncached(type: number): Promise<ModelResource> {
    const source = await this.assets.loadModel(type);
    if (!source) return { prototype: null, textureFiles: [] };
    const model = parseMsa(source.buffer);
    const textureFiles = [...new Set(
      source.textures.filter((file): file is string => file !== null),
    )];
    const textureJobs = new Map(
      textureFiles.map((file) => [file, this.retainTexture(file)]),
    );
    // TMObject reads only m_nTextureIndex[0].cAlpha and applies the resulting
    // render state to every attribute range drawn by the TMMesh.
    const firstAlphaMode = source.textureAlphas[0];
    const usesAlpha = (firstAlphaMode != null && firstAlphaMode !== "N")
      || (type >= 156 && type <= 185);
    const materials = await Promise.all(source.textures.map(async (file, index) => {
      if (!file) return fallbackMaterial(type, index);
      const texture = await textureJobs.get(file);
      if (!texture) return fallbackMaterial(type, index);
      // TMObject forces the dungeon set 156..185 through the alpha path even
      // though its six DXT1 entries are marked N in MeshTextureList.
      return new THREE.MeshLambertMaterial({
        map: texture,
        alphaTest: usesAlpha ? 0xaa / 0xff : 0,
        transparent: usesAlpha,
        depthWrite: true,
        side: THREE.DoubleSide,
      });
    }));
    if (materials.length === 0) materials.push(fallbackMaterial(type, 0));
    const mesh = new THREE.Mesh(model.geometry, materials);
    // WYD's TMMesh renderer applies a -90° DirectX pitch to every MSA before
    // the map object's yaw. MSA vertices are reflected on Z when converted to
    // Three.js, so the equivalent right-handed base transform is +90° on X.
    mesh.rotation.x = Math.PI / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `model-${type}`;
    const group = new THREE.Group();
    group.add(mesh);
    return { prototype: group, textureFiles };
  }

  private retainTexture(file: string): Promise<THREE.Texture | null> {
    let cached = this.#textures.get(file);
    if (!cached) {
      const promise = this.#loader.loadAsync(this.assets.dataUrl(file)).then((texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        return texture;
      }).catch(() => null);
      cached = { references: 0, promise };
      this.#textures.set(file, cached);
    }
    cached.references++;
    return cached.promise;
  }

  private releaseTexture(file: string): void {
    const cached = this.#textures.get(file);
    if (!cached) return;
    cached.references = Math.max(0, cached.references - 1);
    if (cached.references !== 0) return;
    this.#textures.delete(file);
    void cached.promise.then((texture) => texture?.dispose()).catch(() => undefined);
  }

  private disposeResource(resource: ModelResource): void {
    if (resource.prototype) disposePrototype(resource.prototype);
    for (const file of resource.textureFiles) this.releaseTexture(file);
  }
}

function disposePrototype(prototype: THREE.Group): void {
  prototype.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material.dispose();
  });
}

function fallbackMaterial(type: number, part: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(((type + part * 17) * 0.071) % 1, 0.25, 0.45) });
}
