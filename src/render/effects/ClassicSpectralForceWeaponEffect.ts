import * as THREE from "three";
import { DDSLoader } from "three/addons/loaders/DDSLoader.js";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { parseMsa } from "../../formats/classic/Msa";
import { createClassicD3DLocalMatrix } from "../characters/ClassicSkinnedModel";

// TMEffectSWSwing::Render, m_cSForce == 2 (Huntress bow WTYPE 101).
const EFFECT_LIFETIME_SECONDS = 1.5;
const COLOR_FADE_SECONDS = 5;
const SERVER_PHASE_MILLISECONDS = 6_280;
const FIXED_YAW = 4.712389;

const LAYERS = [
  { model: 10, color: 0x332244, radialScale: 0.08, spinDivisorMs: 1_000, texture: "embedded" },
  { model: 19, color: 0x333388, radialScale: 0.12, spinDivisorMs: 100, texture: "embedded" },
  { model: 20, color: 0x003388, radialScale: 0.12, spinDivisorMs: -100, texture: "effect201" },
] as const;

interface SpectralForceLayer {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly baseColor: THREE.Color;
  readonly radialScale: number;
  readonly spinDivisorMs: number;
  readonly baseMatrix: THREE.Matrix4;
  readonly spinMatrix: THREE.Matrix4;
}

/** Exact SForce type-2 visual attached to the Skytalos hand matrix. */
export class ClassicSpectralForceWeaponEffect {
  readonly object = new THREE.Group();
  readonly #layers: readonly SpectralForceLayer[];
  readonly #textures: readonly THREE.Texture[];
  #elapsed = EFFECT_LIFETIME_SECONDS;
  #serverPhaseMilliseconds = 0;
  #enabled = true;
  #disposed = false;

  private constructor(
    layers: readonly SpectralForceLayer[],
    textures: readonly THREE.Texture[],
    effectLength: number,
  ) {
    this.#layers = layers;
    this.#textures = textures;
    this.object.name = "classic-spectral-force-sforce-type-2";
    this.object.visible = false;
    const fixedYaw = createClassicD3DLocalMatrix({ yaw: FIXED_YAW });
    const longitudinalScale = effectLength * 1.4;
    for (const layer of layers) {
      layer.baseMatrix
        .copy(fixedYaw)
        .multiply(new THREE.Matrix4().makeScale(
          layer.radialScale,
          layer.radialScale,
          longitudinalScale,
        ));
      this.object.add(layer.mesh);
    }
  }

  static async load(
    assets: ClassicAssetSource,
    effectLength: number,
  ): Promise<ClassicSpectralForceWeaponEffect> {
    const modelSources = await Promise.all(LAYERS.map(async ({ model }) => {
      const source = await assets.loadModel(model);
      if (!source) throw new Error(`Modelo SForce ${model} ausente no manifesto`);
      return { source, parsed: parseMsa(source.buffer) };
    }));

    const model10TextureUrl = modelSources[0]!.source.textures[0];
    const model19TextureUrl = modelSources[1]!.source.textures[0];
    const effectTextureUrl = assets.effectTextureUrl(201);
    if (!model10TextureUrl || !model19TextureUrl || !effectTextureUrl) {
      for (const entry of modelSources) entry.parsed.geometry.dispose();
      throw new Error("Texturas clássicas da Força Espectral indisponíveis");
    }

    const loader = new DDSLoader();
    let textures: THREE.Texture[] = [];
    try {
      textures = await Promise.all([
        loader.loadAsync(assets.dataUrl(model10TextureUrl)),
        loader.loadAsync(assets.dataUrl(model19TextureUrl)),
        loader.loadAsync(effectTextureUrl),
      ]);
      for (const texture of textures) {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
      }
      const [model10Texture, model19Texture, effectTexture] = textures;
      const layers = LAYERS.map((definition, index): SpectralForceLayer => {
        const map = definition.texture === "embedded"
          ? (index === 0 ? model10Texture! : model19Texture!)
          : effectTexture!;
        const material = new THREE.MeshBasicMaterial({
          name: `WYD Força Espectral SForce ${definition.model}`,
          map,
          color: definition.color,
          transparent: true,
          opacity: 1,
          blending: THREE.AdditiveBlending,
          depthTest: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
        const mesh = new THREE.Mesh(modelSources[index]!.parsed.geometry, material);
        mesh.name = `classic-sforce-layer-model-${definition.model}`;
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        mesh.renderOrder = 12 + index;
        return {
          mesh,
          baseColor: new THREE.Color(definition.color),
          radialScale: definition.radialScale,
          spinDivisorMs: definition.spinDivisorMs,
          baseMatrix: new THREE.Matrix4(),
          spinMatrix: new THREE.Matrix4(),
        };
      });
      return new ClassicSpectralForceWeaponEffect(layers, textures, effectLength);
    } catch (error) {
      for (const entry of modelSources) entry.parsed.geometry.dispose();
      for (const texture of textures) texture.dispose();
      throw error;
    }
  }

  trigger(): void {
    if (this.#disposed || !this.#enabled) return;
    this.#elapsed = 0;
    this.object.visible = true;
    this.updateLayers();
  }

  setEnabled(enabled: boolean): void {
    if (this.#disposed) return;
    this.#enabled = enabled;
    if (!enabled) {
      this.#elapsed = EFFECT_LIFETIME_SECONDS;
      this.object.visible = false;
    }
  }

  update(deltaSeconds: number): void {
    if (this.#disposed || !this.#enabled) return;
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    this.#serverPhaseMilliseconds = (
      this.#serverPhaseMilliseconds + delta * 1_000
    ) % SERVER_PHASE_MILLISECONDS;
    if (!this.object.visible) return;
    this.#elapsed += delta;
    if (this.#elapsed > EFFECT_LIFETIME_SECONDS) {
      this.#elapsed = EFFECT_LIFETIME_SECONDS;
      this.object.visible = false;
      return;
    }
    this.updateLayers();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.object.removeFromParent();
    for (const layer of this.#layers) {
      layer.mesh.geometry.dispose();
      layer.mesh.material.dispose();
    }
    for (const texture of this.#textures) texture.dispose();
    this.object.clear();
  }

  private updateLayers(): void {
    const colorTerm = Math.max(0, 1 - this.#elapsed / COLOR_FADE_SECONDS);
    for (const layer of this.#layers) {
      const spin = this.#serverPhaseMilliseconds / layer.spinDivisorMs;
      // D3DX row order is RotZ * Scale * RotY * handMatrix. Conversion to
      // Three's column convention reverses that local product; parenting the
      // result to the exact hand holder supplies handMatrix itself.
      layer.mesh.matrix
        .copy(layer.baseMatrix)
        // D3D row RotationZ converts directly to Three's RotationZ after the
        // classic handedness mirror; reuse the matrix to avoid frame garbage.
        .multiply(layer.spinMatrix.makeRotationZ(spin));
      layer.mesh.matrixWorldNeedsUpdate = true;
      layer.mesh.material.color.copy(layer.baseColor).multiplyScalar(colorTerm);
    }
  }
}
