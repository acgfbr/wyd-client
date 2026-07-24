import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { ClassicDdsTextureLoader } from "../../render/textures/ClassicDdsTextureLoader";

const MAX_PARTICLES = 512;
const LIFE_SECONDS = 1.5;
const VERTICAL_DISTANCE = -0.5;
const COLOR = new THREE.Color(0xaaffee);

/**
 * One-draw-call version of TMEffectSkinMesh level-4's per-frame billboards.
 * Nyerdes itself remains visible with FX disabled; only this emitted trail is
 * suppressed, matching g_bHideEffect.
 */
export class ClassicNyerdesParticles {
  readonly object: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  readonly #centers = new Float32Array(MAX_PARTICLES * 3);
  readonly #scales = new Float32Array(MAX_PARTICLES * 2);
  readonly #opacities = new Float32Array(MAX_PARTICLES);
  readonly #startY = new Float32Array(MAX_PARTICLES);
  readonly #elapsed = new Float32Array(MAX_PARTICLES);
  readonly #active = new Uint8Array(MAX_PARTICLES);
  readonly #centerAttribute: THREE.InstancedBufferAttribute;
  readonly #scaleAttribute: THREE.InstancedBufferAttribute;
  readonly #opacityAttribute: THREE.InstancedBufferAttribute;
  readonly #world = new THREE.Vector3();
  readonly #inverseParent = new THREE.Matrix4();
  #texture: THREE.Texture | null = null;
  #cursor = 0;
  #enabled = true;

  constructor(assets: ClassicAssetSource) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([
      -0.5, -0.5, 0,
      0.5, -0.5, 0,
      0.5, 0.5, 0,
      -0.5, 0.5, 0,
    ], 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute([
      0, 0,
      1, 0,
      1, 1,
      0, 1,
    ], 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.#centerAttribute = new THREE.InstancedBufferAttribute(this.#centers, 3);
    this.#scaleAttribute = new THREE.InstancedBufferAttribute(this.#scales, 2);
    this.#opacityAttribute = new THREE.InstancedBufferAttribute(this.#opacities, 1);
    geometry.setAttribute("instanceCenter", this.#centerAttribute);
    geometry.setAttribute("instanceScale", this.#scaleAttribute);
    geometry.setAttribute("instanceOpacity", this.#opacityAttribute);
    geometry.instanceCount = MAX_PARTICLES;

    const material = new THREE.ShaderMaterial({
      uniforms: { map: { value: null } },
      vertexShader: `
        attribute vec3 instanceCenter;
        attribute vec2 instanceScale;
        attribute float instanceOpacity;
        varying vec2 vUv;
        varying float vOpacity;
        void main() {
          vec4 center = modelViewMatrix * vec4(instanceCenter, 1.0);
          center.xy += position.xy * instanceScale;
          gl_Position = projectionMatrix * center;
          vUv = uv;
          vOpacity = instanceOpacity;
        }
      `,
      fragmentShader: `
        uniform sampler2D map;
        varying vec2 vUv;
        varying float vOpacity;
        void main() {
          vec4 texel = texture2D(map, vUv);
          float alpha = texel.a * vOpacity;
          if (alpha <= 0.003) discard;
          gl_FragColor = vec4(texel.rgb * vec3(${COLOR.r}, ${COLOR.g}, ${COLOR.b}), alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.object = new THREE.Mesh(geometry, material);
    this.object.name = "classic-nyerdes-particles";
    this.object.frustumCulled = false;
    this.object.renderOrder = 8;

    const url = assets.effectTextureUrl(0);
    if (url) {
      const loader = new ClassicDdsTextureLoader();
      void loader.loadAsync(url).then((texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        this.#texture = texture;
        material.uniforms.map!.value = texture;
        material.needsUpdate = true;
      }).catch(() => undefined);
    }
  }

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    this.object.visible = enabled;
  }

  spawn(source: THREE.Object3D, randomValue: number): void {
    if (!this.#enabled || !this.#texture || !source.parent) return;
    const slot = this.#cursor++ % MAX_PARTICLES;
    source.updateWorldMatrix(true, false);
    source.getWorldPosition(this.#world);
    const parent = this.object.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      this.#world.applyMatrix4(this.#inverseParent.copy(parent.matrixWorld).invert());
    }
    const randomA = ((randomValue >>> 8) & 0xff) / 255;
    const randomB = ((randomValue >>> 16) & 0xff) / 255;
    const variant = randomValue % 5;
    const center = slot * 3;
    this.#centers[center] = this.#world.x + (randomA * 0.2 - 0.1);
    this.#centers[center + 1] = this.#world.y;
    this.#centers[center + 2] = this.#world.z + (randomB * 0.2 - 0.1);
    const scale = slot * 2;
    this.#scales[scale] = variant * 0.01 + 0.02;
    this.#scales[scale + 1] = variant * 0.1 + 0.02;
    this.#opacities[slot] = 1;
    this.#startY[slot] = this.#world.y;
    this.#elapsed[slot] = 0;
    this.#active[slot] = 1;
    this.markAttributesDirty();
  }

  update(deltaSeconds: number): void {
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(deltaSeconds, 0.1)) : 0;
    if (delta <= 0) return;
    let changed = false;
    for (let slot = 0; slot < MAX_PARTICLES; slot++) {
      if (!this.#active[slot]) continue;
      const elapsed = this.#elapsed[slot]! + delta;
      this.#elapsed[slot] = elapsed;
      const progress = elapsed / LIFE_SECONDS;
      if (progress >= 1) {
        this.#active[slot] = 0;
        this.#opacities[slot] = 0;
      } else {
        this.#centers[slot * 3 + 1] = this.#startY[slot]! + VERTICAL_DISTANCE * progress;
        this.#opacities[slot] = Math.cos(progress * Math.PI * 0.5);
      }
      changed = true;
    }
    if (changed) this.markAttributesDirty();
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.object.material.dispose();
    this.#texture?.dispose();
    this.#texture = null;
  }

  private markAttributesDirty(): void {
    this.#centerAttribute.needsUpdate = true;
    this.#scaleAttribute.needsUpdate = true;
    this.#opacityAttribute.needsUpdate = true;
  }
}
