import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import type { TrnBlock } from "../../formats/classic/Trn";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";

const vertexShader = /* glsl */ `
  attribute vec3 color;
  attribute vec2 uv2;

  varying vec3 vTerrainColor;
  varying vec2 vForegroundUv;
  varying vec2 vBackgroundUv;

  #include <fog_pars_vertex>

  void main() {
    vTerrainColor = color;
    vForegroundUv = uv;
    vBackgroundUv = uv2;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D foregroundMap;
  uniform sampler2D backgroundMap;
  uniform vec3 foregroundTint;

  varying vec3 vTerrainColor;
  varying vec2 vForegroundUv;
  varying vec2 vBackgroundUv;

  #include <common>
  #include <fog_pars_fragment>

  void main() {
    vec4 foreground = texture2D(foregroundMap, vForegroundUv);
    vec4 background = texture2D(backgroundMap, vBackgroundUv);

    // O fixed-function pipeline original usa D3DTOP_MODULATE no segundo stage:
    // Tile * MTile * diffuse do vertice.
    // TMGround's D3D material has a constant 0.3 emissive component. The raw
    // TRN deliberately contains black vertex colors in shadowed areas; without
    // this term a custom unlit shader turns those areas into absolute black.
    vec3 classicLight = min(vTerrainColor + vec3(0.3), vec3(1.0));
    gl_FragColor = vec4(
      foreground.rgb * background.rgb * foregroundTint * classicLight,
      1.0
    );

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export class TerrainMaterialLibrary {
  readonly #loader = new ClassicDdsTextureLoader();
  readonly #materials = new Map<string, THREE.ShaderMaterial>();
  readonly #textures = new Map<number, THREE.Texture>();
  readonly #whiteTexture = createWhiteTexture();

  constructor(private readonly assets: ClassicAssetSource) {}

  material(foregroundIndex: number, backgroundIndex: number): THREE.ShaderMaterial {
    const key = `${foregroundIndex}:${backgroundIndex}`;
    const cached = this.#materials.get(key);
    if (cached) return cached;

    const hasForeground = this.assets.textureUrl(foregroundIndex) !== null;
    const uniforms = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
    Object.assign(uniforms, {
      // Nao passe texturas por UniformsUtils.merge: ele as clonaria para cada
      // combinacao Tile/MTile e duplicaria centenas de recursos na GPU.
      foregroundMap: { value: this.#texture(foregroundIndex) },
      backgroundMap: { value: this.#texture(backgroundIndex) },
      foregroundTint: {
        value: hasForeground
          ? new THREE.Color(0xffffff)
          : new THREE.Color().setHSL((foregroundIndex * 0.137) % 1, 0.35, 0.45),
      },
    });
    const material = new THREE.ShaderMaterial({
      name: `WYD terrain ${key}`,
      uniforms,
      vertexShader,
      fragmentShader,
      fog: true,
    });

    this.#materials.set(key, material);
    return material;
  }

  /** Libera combinacoes e DDS que nao pertencem mais aos Fields residentes. */
  prune(blocks: Iterable<TrnBlock>): void {
    const materialKeys = new Set<string>();
    const textureIndices = new Set<number>();
    for (const block of blocks) {
      for (const tile of block.tiles) {
        const foreground = tile.texture + 10;
        const background = tile.backgroundTexture + 256;
        materialKeys.add(`${foreground}:${background}`);
        textureIndices.add(foreground);
        textureIndices.add(background);
      }
    }
    for (const [key, material] of this.#materials) {
      if (materialKeys.has(key)) continue;
      material.dispose();
      this.#materials.delete(key);
    }
    for (const [index, texture] of this.#textures) {
      if (textureIndices.has(index)) continue;
      texture.dispose();
      this.#textures.delete(index);
    }
  }

  #texture(index: number): THREE.Texture {
    const cached = this.#textures.get(index);
    if (cached) return cached;

    const url = this.assets.textureUrl(index);
    if (!url) return this.#whiteTexture;

    const texture = this.#loader.load(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    this.#textures.set(index, texture);
    return texture;
  }
}

function createWhiteTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
