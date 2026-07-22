import * as THREE from "three";
import { DDSLoader } from "three/addons/loaders/DDSLoader.js";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { parseMsa } from "../../formats/classic/Msa";

export class ModelLibrary {
  readonly #loader = new DDSLoader();
  readonly #cache = new Map<number, { references: number; promise: Promise<THREE.Group | null> }>();

  constructor(private readonly assets: ClassicAssetSource) {}

  load(type: number): Promise<THREE.Group | null> {
    const cached = this.#cache.get(type);
    if (cached) return cached.promise;
    const promise = this.loadUncached(type);
    this.#cache.set(type, { references: 0, promise });
    return promise;
  }

  /** Mantem o prototipo vivo enquanto ao menos um Field carregado o utiliza. */
  retain(type: number): Promise<THREE.Group | null> {
    let cached = this.#cache.get(type);
    if (!cached) {
      cached = { references: 0, promise: this.loadUncached(type) };
      this.#cache.set(type, cached);
    }
    cached.references++;
    return cached.promise;
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
    void cached.promise.then((prototype) => {
      if (prototype) disposePrototype(prototype);
    }).catch(() => undefined);
  }

  private async loadUncached(type: number): Promise<THREE.Group | null> {
    const source = await this.assets.loadModel(type);
    if (!source) return null;
    const model = parseMsa(source.buffer);
    const materials = await Promise.all(source.textures.map(async (file, index) => {
      if (!file) return fallbackMaterial(type, index);
      const texture = await this.#loader.loadAsync(this.assets.dataUrl(file)).catch(() => null);
      if (!texture) return fallbackMaterial(type, index);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      return new THREE.MeshLambertMaterial({ map: texture, alphaTest: 0.35, side: THREE.DoubleSide });
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
    return group;
  }
}

function disposePrototype(prototype: THREE.Group): void {
  const textures = new Set<THREE.Texture>();
  prototype.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      const textured = material as THREE.Material & { map?: THREE.Texture | null; alphaMap?: THREE.Texture | null };
      if (textured.map) textures.add(textured.map);
      if (textured.alphaMap) textures.add(textured.alphaMap);
      material.dispose();
    }
  });
  for (const texture of textures) texture.dispose();
}

function fallbackMaterial(type: number, part: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(((type + part * 17) * 0.071) % 1, 0.25, 0.45) });
}
