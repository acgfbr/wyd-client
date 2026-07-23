import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";

export class EffectTextureLibrary {
  readonly #loader = new ClassicDdsTextureLoader();
  readonly #cache = new Map<number, Promise<THREE.Texture | null>>();

  constructor(private readonly assets: ClassicAssetSource) {}

  load(index: number): Promise<THREE.Texture | null> {
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

  async sequence(first: number, count: number): Promise<THREE.Texture[]> {
    const textures = await Promise.all(Array.from({ length: count }, (_, index) => this.load(first + index)));
    return textures.filter((texture): texture is THREE.Texture => texture !== null);
  }

  dispose(): void {
    const entries = [...this.#cache.values()];
    this.#cache.clear();
    for (const entry of entries) {
      void entry.then((texture) => texture?.dispose()).catch(() => undefined);
    }
  }
}
