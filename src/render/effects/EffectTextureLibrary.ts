import * as THREE from "three";
import { DDSLoader } from "three/addons/loaders/DDSLoader.js";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";

export class EffectTextureLibrary {
  readonly #loader = new DDSLoader();
  readonly #cache = new Map<number, Promise<THREE.CompressedTexture | null>>();

  constructor(private readonly assets: ClassicAssetSource) {}

  load(index: number): Promise<THREE.CompressedTexture | null> {
    const cached = this.#cache.get(index);
    if (cached) return cached;
    const url = this.assets.effectTextureUrl(index);
    const promise = url
      ? this.#loader.loadAsync(url).then((texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        return texture;
      }).catch(() => null)
      : Promise.resolve(null);
    this.#cache.set(index, promise);
    return promise;
  }

  async sequence(first: number, count: number): Promise<THREE.CompressedTexture[]> {
    const textures = await Promise.all(Array.from({ length: count }, (_, index) => this.load(first + index)));
    return textures.filter((texture): texture is THREE.CompressedTexture => texture !== null);
  }
}
