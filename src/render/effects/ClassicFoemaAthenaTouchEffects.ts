import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";

const PARTICLE_COUNT = 20;
const PARTICLE_SIZE_STEP = 0.1;
const PARTICLE_LIFETIME_BASE_SECONDS = 2;
const PARTICLE_LIFETIME_STEP_SECONDS = 0.3;
const PARTICLE_VERTICAL_DISTANCE = 2;
const PARTICLE_CIRCLE_SPEED = 6;
const TARGET_HEIGHT_OFFSET = 1;
const BILLBOARD_VISIBLE_FRACTION = 0.05;
const PARTICLE_POOL_LIMIT = 160;
const PERSISTENT_TEXTURE_INDEX = 93;
const PERSISTENT_HEIGHT_OFFSET = 0.4;
const PERSISTENT_SCALE = 1.5;
const PERSISTENT_ROTATION_SECONDS = 5;
const PERSISTENT_BASE_ANGLE = Math.PI / 4;
const PERSISTENT_COLOR = 0x888800;
const PERSISTENT_BASE_ALPHA = 0x88 / 0xff;

const RANDOM_COLORS = [
  0xffffff,
  0xffaaaa,
  0xffffaa,
  0xaaffaa,
  0xaaaaff,
  0xaaffff,
  0xffaaff,
] as const;

interface AthenaTouchParticle {
  readonly sprite: THREE.Sprite;
  readonly start: THREE.Vector3;
  active: boolean;
  elapsed: number;
  lifetime: number;
  horizontalDistance: number;
  motion: 1 | 2;
  color: number;
  serial: number;
}

interface AthenaTouchResources {
  readonly particleTexture: THREE.Texture;
  readonly persistentTexture: THREE.Texture;
}

interface AthenaTouchPersistentVisual {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  elapsed: number;
  active: boolean;
}

/**
 * Presentation-only port of Foema #45, Toque da Athena.
 *
 * TMFieldScene creates one type-0 TMEffectParticle immediately when the attack
 * packet arrives. Its 1,000 ms lifetime belongs to the invisible controller;
 * the 20 billboards it inserts directly in the effect container retain their
 * individual 2,000 + 300*i ms lifetimes. `targetPosition` is the target's feet
 * in Three.js world space; the retail target-height +1 offset is applied here.
 *
 * TMHuman's active m_cSKillAmp branch additionally owns one persistent
 * TMEffectBillBoard2 using texture 93. It follows the target at feet +0.4 Y
 * until the affect is removed. Gameplay authority, duration and sound 158
 * stay outside this renderer.
 */
export class ClassicFoemaAthenaTouchEffects {
  readonly object = new THREE.Group();
  readonly #dds = new ClassicDdsTextureLoader();
  readonly #particles: AthenaTouchParticle[] = [];
  readonly #persistentOwnerPosition = new THREE.Vector3();
  #resources: AthenaTouchResources | null = null;
  #persistent: AthenaTouchPersistentVisual | null = null;
  #persistentRequested = false;
  #preload: Promise<void> | null = null;
  #serial = 0;
  #randomState = 0;
  #enabled = true;
  #disposed = false;

  constructor(parent: THREE.Object3D) {
    this.object.name = "classic-foema-athena-touch-effects";
    parent.add(this.object);
  }

  /** Loads retail EffectTextureList entries 56 and 93 once. */
  async prepareClassic(assets: ClassicAssetSource): Promise<void> {
    if (this.#disposed || this.#resources) return;
    if (this.#preload) return this.#preload;

    const job = this.loadClassicResources(assets)
      .then((resources) => {
        if (this.#disposed) {
          disposeResources(resources);
          return;
        }
        this.#resources = resources;
        for (const particle of this.#particles) {
          particle.sprite.material.map = resources.particleTexture;
          particle.sprite.material.needsUpdate = true;
        }
        this.applyPersistentState();
      })
      .catch((error: unknown) => {
        console.warn("Efeito clássico #45 Toque da Athena indisponível.", error);
      })
      .finally(() => {
        this.#preload = null;
      });
    this.#preload = job;
    return job;
  }

  /** Spawns the retail set of 20 texture-56 billboards at target height. */
  play(targetPosition: THREE.Vector3): boolean {
    if (
      this.#disposed
      || !this.#enabled
      || !this.#resources
      || !isFiniteVector(targetPosition)
    ) {
      return false;
    }

    for (let index = 0; index < PARTICLE_COUNT; index++) {
      const particle = this.acquireParticle();
      const classicOffsetX = (this.nextClassicRandom(5) - 3) * 0.3;
      const offsetY = (this.nextClassicRandom(5) - 3) * 0.1;
      const classicOffsetZ = (this.nextClassicRandom(5) - 3) * 0.3;
      const color = RANDOM_COLORS[this.nextClassicRandom(RANDOM_COLORS.length)]!;
      const scale = (index % 2) * PARTICLE_SIZE_STEP + 0.1;

      particle.active = true;
      particle.elapsed = 0;
      particle.lifetime = PARTICLE_LIFETIME_BASE_SECONDS
        + PARTICLE_LIFETIME_STEP_SECONDS * index;
      particle.horizontalDistance = (index % 3) * 0.05 + 0.1;
      particle.motion = index % 2 === 0 ? 1 : 2;
      particle.color = color;
      particle.serial = ++this.#serial;
      particle.start.set(
        targetPosition.x + classicOffsetX,
        targetPosition.y + TARGET_HEIGHT_OFFSET + offsetY,
        // Retail/classic +Z maps to Three scene -Z.
        targetPosition.z - classicOffsetZ,
      );
      particle.sprite.position.copy(particle.start);
      particle.sprite.scale.set(scale, scale, 1);
      particle.sprite.material.color.setHex(0x000000);
      particle.sprite.material.opacity = 0;
      particle.sprite.visible = false;
    }
    return true;
  }

  /**
   * Synchronizes the state-owned m_cSKillAmp billboard with its current owner.
   * Passing null, an invalid position or active=false removes it immediately,
   * matching TMHuman's DeleteObject branch.
   */
  syncPersistent(ownerPosition: THREE.Vector3 | null, active: boolean): void {
    if (this.#disposed) return;
    this.#persistentRequested = this.#enabled
      && active
      && ownerPosition !== null
      && isFiniteVector(ownerPosition);
    if (this.#persistentRequested) this.#persistentOwnerPosition.copy(ownerPosition!);
    this.applyPersistentState();
  }

  update(deltaSeconds: number): void {
    if (this.#disposed || !this.#enabled) return;
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    if (delta === 0) return;

    for (const particle of this.#particles) {
      if (!particle.active) continue;
      particle.elapsed += delta;
      if (particle.elapsed >= particle.lifetime) {
        deactivateParticle(particle);
        continue;
      }

      const progress = particle.elapsed / particle.lifetime;
      particle.sprite.position.copy(particle.start);
      particle.sprite.position.y += progress * PARTICLE_VERTICAL_DISTANCE;
      if (particle.motion === 2) {
        particle.sprite.position.x += Math.sin(
          progress * Math.PI * PARTICLE_CIRCLE_SPEED,
        ) * particle.horizontalDistance;
      }

      // Fade type 1 attenuates vertex RGBA, but EF_BRIGHT selects texture alpha
      // in the fixed-function stage. The visible fade is therefore diffuse RGB.
      const fade = Math.max(0, Math.sin(progress * Math.PI));
      particle.sprite.material.color.setHex(particle.color).multiplyScalar(fade);
      particle.sprite.material.opacity = 1;
      particle.sprite.visible = progress >= BILLBOARD_VISIBLE_FRACTION && fade > 0;
    }

    this.updatePersistent(delta);
  }

  setEnabled(enabled: boolean): void {
    if (this.#disposed || this.#enabled === enabled) return;
    this.#enabled = enabled;
    this.object.visible = enabled;
    if (!enabled) this.clear();
  }

  clear(): void {
    for (const particle of this.#particles) deactivateParticle(particle);
    this.#persistentRequested = false;
    if (this.#persistent) {
      this.#persistent.active = false;
      this.#persistent.elapsed = 0;
      this.#persistent.mesh.visible = false;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clear();
    for (const particle of this.#particles) particle.sprite.material.dispose();
    this.#particles.length = 0;
    if (this.#persistent) {
      this.#persistent.mesh.geometry.dispose();
      this.#persistent.mesh.material.dispose();
      this.#persistent = null;
    }
    if (this.#resources) disposeResources(this.#resources);
    this.#resources = null;
    this.object.removeFromParent();
    this.object.clear();
  }

  private acquireParticle(): AthenaTouchParticle {
    const free = this.#particles.find((particle) => !particle.active);
    if (free) return free;

    if (this.#particles.length < PARTICLE_POOL_LIMIT) {
      const particle = createParticle(
        this.#resources!.particleTexture,
        `classic-foema-athena-touch-particle-${this.#particles.length}-texture-56`,
      );
      this.#particles.push(particle);
      this.object.add(particle.sprite);
      return particle;
    }

    const oldest = oldestBySerial(this.#particles);
    deactivateParticle(oldest);
    return oldest;
  }

  private nextClassicRandom(modulus: number): number {
    // Deterministic stand-in for the retail process-wide rand() sequence.
    this.#randomState = (Math.imul(this.#randomState, 1_103_515_245) + 12_345) >>> 0;
    return (this.#randomState >>> 16) % modulus;
  }

  private applyPersistentState(): void {
    if (!this.#persistentRequested || !this.#resources) {
      if (this.#persistent) {
        this.#persistent.active = false;
        this.#persistent.elapsed = 0;
        this.#persistent.mesh.visible = false;
      }
      return;
    }

    const persistent = this.#persistent ?? this.createPersistentVisual();
    if (!persistent.active) persistent.elapsed = 0;
    persistent.active = true;
    persistent.mesh.visible = true;
    persistent.mesh.position.copy(this.#persistentOwnerPosition);
    persistent.mesh.position.y += PERSISTENT_HEIGHT_OFFSET;
  }

  private createPersistentVisual(): AthenaTouchPersistentVisual {
    const mesh = new THREE.Mesh(
      createClassicGroundGeometry(),
      createPersistentMaterial(this.#resources!.persistentTexture),
    );
    mesh.name = "classic-foema-athena-touch-persistent-texture-93";
    mesh.scale.setScalar(PERSISTENT_SCALE);
    mesh.rotation.y = PERSISTENT_BASE_ANGLE;
    mesh.renderOrder = 6;
    mesh.visible = false;
    const visual: AthenaTouchPersistentVisual = { mesh, elapsed: 0, active: false };
    this.#persistent = visual;
    this.object.add(mesh);
    return visual;
  }

  private updatePersistent(deltaSeconds: number): void {
    const persistent = this.#persistent;
    if (!persistent?.active) return;
    persistent.elapsed += deltaSeconds;

    // TMEffectBillBoard2 lifetime=0 uses server-time phases. Starting at zero
    // is a valid allocation phase; only the arbitrary pointer-derived offset
    // differs, without changing either period or amplitude.
    const progress = (persistent.elapsed % PERSISTENT_ROTATION_SECONDS)
      / PERSISTENT_ROTATION_SECONDS;
    const intensity = 0.8 * Math.abs(Math.sin(progress * Math.PI * 2)) + 0.2;
    persistent.mesh.rotation.y = PERSISTENT_BASE_ANGLE + progress * Math.PI * 2;
    persistent.mesh.material.color
      .setHex(PERSISTENT_COLOR)
      .multiplyScalar(intensity);
    persistent.mesh.material.opacity = PERSISTENT_BASE_ALPHA * intensity;
    persistent.mesh.position.copy(this.#persistentOwnerPosition);
    persistent.mesh.position.y += PERSISTENT_HEIGHT_OFFSET;
  }

  private async loadClassicResources(assets: ClassicAssetSource): Promise<AthenaTouchResources> {
    const loaded: THREE.Texture[] = [];
    try {
      const particleTexture = await this.loadClassicTexture(assets, 56, true);
      loaded.push(particleTexture);
      const persistentTexture = await this.loadClassicTexture(
        assets,
        PERSISTENT_TEXTURE_INDEX,
        false,
      );
      loaded.push(persistentTexture);
      return { particleTexture, persistentTexture };
    } catch (error) {
      for (const texture of loaded) texture.dispose();
      throw error;
    }
  }

  private async loadClassicTexture(
    assets: ClassicAssetSource,
    index: 56 | typeof PERSISTENT_TEXTURE_INDEX,
    billboard: boolean,
  ): Promise<THREE.Texture> {
    const url = assets.effectTextureUrl(index);
    if (!url) throw new Error(`Textura de efeito ${index} ausente do manifesto`);
    const texture = await this.#dds.loadAsync(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    if (billboard) {
      // TMEffectBillBoard uses the 0.02/0.98 inset on its camera-facing quad.
      texture.offset.set(0.02, 0.98);
      texture.repeat.set(0.96, -0.96);
    }
    texture.needsUpdate = true;
    return texture;
  }
}

function createParticle(texture: THREE.Texture, name: string): AthenaTouchParticle {
  const material = new THREE.SpriteMaterial({
    map: texture,
    color: 0x000000,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.SrcAlphaFactor,
    blendDstAlpha: THREE.OneFactor,
    fog: false,
    toneMapped: false,
  });
  material.forceSinglePass = true;
  const sprite = new THREE.Sprite(material);
  sprite.name = name;
  sprite.visible = false;
  sprite.renderOrder = 7;
  return {
    sprite,
    start: new THREE.Vector3(),
    active: false,
    elapsed: 0,
    lifetime: PARTICLE_LIFETIME_BASE_SECONDS,
    horizontalDistance: 0,
    motion: 1,
    color: 0xffffff,
    serial: 0,
  };
}

/** TMEffectBillBoard2's XZ quad and its literal 0.02..0.98 UV inset. */
function createClassicGroundGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([
      -0.5, 0, 0.5,
      0.5, 0, 0.5,
      0.5, 0, -0.5,
      -0.5, 0, -0.5,
    ], 3),
  );
  geometry.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute([
      0.02, 0.02,
      0.98, 0.02,
      0.98, 0.98,
      0.02, 0.98,
    ], 2),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeBoundingSphere();
  return geometry;
}

function createPersistentMaterial(texture: THREE.Texture): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: new THREE.Color(PERSISTENT_COLOR).multiplyScalar(0.2),
    transparent: true,
    opacity: PERSISTENT_BASE_ALPHA * 0.2,
    depthTest: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.SrcAlphaFactor,
    blendDstAlpha: THREE.OneFactor,
    side: THREE.FrontSide,
    fog: false,
    toneMapped: false,
  });
  material.forceSinglePass = true;
  return material;
}

function deactivateParticle(particle: AthenaTouchParticle): void {
  particle.active = false;
  particle.elapsed = 0;
  particle.sprite.visible = false;
  particle.sprite.material.opacity = 0;
}

function oldestBySerial(particles: readonly AthenaTouchParticle[]): AthenaTouchParticle {
  let oldest = particles[0]!;
  for (const particle of particles) {
    if (particle.serial < oldest.serial) oldest = particle;
  }
  return oldest;
}

function isFiniteVector(value: THREE.Vector3): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function disposeResources(resources: AthenaTouchResources): void {
  resources.particleTexture.dispose();
  resources.persistentTexture.dispose();
}
