import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import type { ClassicWeaponEffectSegmentSample } from "../../game/player/ClassicPlayerAvatar";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";

const CAST_HEIGHT = 2.3;
const CAST_FLARE_LIFETIME_SECONDS = 0.8;
const CAST_LINE_LIFETIME_SECONDS = 0.5;
const CAST_FLARE_SCALE_VELOCITY = 2;
const CAST_LINE_SCALE_VELOCITY = 0.5;
const CAST_POOL_LIMIT = 24;

const PERSISTENT_EMISSION_INTERVAL_SECONDS = 0.15;
const PERSISTENT_PARTICLE_LIFETIME_SECONDS = 0.5;
const PERSISTENT_PARTICLE_SCALE_VELOCITY = 0.5;
const PERSISTENT_POOL_LIMIT = 48;
const MAX_WEAPON_SEGMENTS = 2;

const BILLBOARD_VISIBLE_FRACTION = 0.05;
const MAGIC_WEAPON_COLOR = 0x333355;
const CAST_FLARE_COLORS = [0x550088, 0x555500, 0x005500] as const;

type MagicWeaponTexture = "flare" | "line";

interface ClassicMagicWeaponResources {
  readonly flareTexture: THREE.Texture;
  readonly lineTexture: THREE.Texture;
}

interface MagicWeaponParticle {
  readonly sprite: THREE.Sprite;
  active: boolean;
  elapsed: number;
  lifetime: number;
  serial: number;
  baseScale: number;
  scaleVelocity: number;
  color: number;
  texture: MagicWeaponTexture;
}

interface PersistentEmitter {
  readonly side: "left" | "right";
  readonly base: THREE.Vector3;
  readonly tip: THREE.Vector3;
  active: boolean;
  elapsedSinceEmission: number;
}

/**
 * Bounded port of Foema #44's cast billboards and AffectType 9 weapon trail.
 *
 * Segment samples are copied during syncPersistent. Spawned particles live in
 * world space, so they do not follow the weapon after their emission frame.
 */
export class ClassicFoemaMagicWeaponEffects {
  readonly object = new THREE.Group();
  readonly #owner: THREE.Object3D;
  readonly #dds = new ClassicDdsTextureLoader();
  readonly #fallbackGlow = createFallbackGlowTexture();
  readonly #scratchPosition = new THREE.Vector3();
  readonly #castPool: MagicWeaponParticle[] = [];
  readonly #persistentPool: MagicWeaponParticle[] = [];
  readonly #emitters: readonly [PersistentEmitter, PersistentEmitter] = [
    createPersistentEmitter("left"),
    createPersistentEmitter("right"),
  ];
  #resources: ClassicMagicWeaponResources | null = null;
  #preload: Promise<void> | null = null;
  #serial = 0;
  #randomSerial = 0;
  #enabled = true;
  #disposed = false;

  constructor(parent: THREE.Object3D) {
    this.#owner = parent;
    this.object.name = "classic-foema-magic-weapon-effects";
    parent.add(this.object);
  }

  /** Loads EffectTextureList entries 56 (flare) and 60 (line) once. */
  async prepareClassic(assets: ClassicAssetSource): Promise<void> {
    if (this.#disposed || this.#resources) return;
    if (this.#preload) return this.#preload;

    const job = this.loadClassicResources(assets)
      .then((resources) => {
        if (this.#disposed) {
          disposeClassicResources(resources);
          return;
        }
        this.#resources = resources;
        for (const particle of this.#castPool) this.applyParticleAsset(particle);
        for (const particle of this.#persistentPool) this.applyParticleAsset(particle);
      })
      .catch((error: unknown) => {
        console.warn("Efeito clássico Arma Mágica indisponível; usando fallback.", error);
      })
      .finally(() => {
        this.#preload = null;
      });
    this.#preload = job;
    return job;
  }

  setEnabled(enabled: boolean): void {
    if (this.#disposed || this.#enabled === enabled) return;
    this.#enabled = enabled;
    this.object.visible = enabled;
    if (!enabled) this.clear();
  }

  /** Plays the one-shot six-billboard cast event at the caster's feet. */
  playCast(casterFeet: THREE.Vector3): void {
    if (!this.canPlayAt(casterFeet)) return;
    const position = casterFeet.clone();
    position.y += CAST_HEIGHT;

    for (let index = 0; index < CAST_FLARE_COLORS.length; index++) {
      this.spawnCastParticle({
        position,
        texture: "flare",
        lifetime: CAST_FLARE_LIFETIME_SECONDS,
        baseScale: 0.4 - index * 0.01,
        scaleVelocity: CAST_FLARE_SCALE_VELOCITY,
        color: CAST_FLARE_COLORS[index]!,
        rotation: 0,
      });

      const randomStep = classicRandomStep(++this.#randomSerial, index, 5) + 5;
      this.spawnCastParticle({
        position,
        texture: "line",
        lifetime: CAST_LINE_LIFETIME_SECONDS,
        baseScale: 0.4 + randomStep * 0.01,
        scaleVelocity: CAST_LINE_SCALE_VELOCITY,
        color: MAGIC_WEAPON_COLOR,
        rotation: Math.PI * randomStep / 3,
      });
    }
  }

  /**
   * Synchronizes the live weapon matrices. Disabling the buff only stops new
   * emissions; already spawned 500 ms billboards complete their own lifetime.
   */
  syncPersistent(
    active: boolean,
    segments: readonly ClassicWeaponEffectSegmentSample[],
    count: number,
  ): void {
    if (this.#disposed) return;
    const requestedCount = Number.isFinite(count) ? Math.trunc(count) : 0;
    const limit = this.#enabled && active
      ? Math.max(0, Math.min(MAX_WEAPON_SEGMENTS, requestedCount, segments.length))
      : 0;
    let sawLeft = false;
    let sawRight = false;

    for (let index = 0; index < limit; index++) {
      const sample = segments[index];
      if (!sample || !isFiniteSegment(sample)) continue;
      if (sample.base.distanceToSquared(sample.tip) <= 1e-12) continue;
      const emitter = sample.side === "right" ? this.#emitters[1] : this.#emitters[0];
      if (sample.side === "right") {
        if (sawRight) continue;
        sawRight = true;
      } else {
        if (sawLeft) continue;
        sawLeft = true;
      }
      if (!emitter.active) {
        // TMEffectSWSwing initializes m_dwOldTime to zero, so an already-live
        // actor emits on its first FrameMove after the affect becomes active.
        emitter.elapsedSinceEmission = PERSISTENT_EMISSION_INTERVAL_SECONDS;
      }
      emitter.active = true;
      emitter.base.copy(sample.base);
      emitter.tip.copy(sample.tip);
    }

    if (!sawLeft) deactivateEmitter(this.#emitters[0]);
    if (!sawRight) deactivateEmitter(this.#emitters[1]);
  }

  update(deltaSeconds: number): void {
    if (this.#disposed || !this.#enabled) return;
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    if (delta === 0) return;

    // Existing world-space children advance before emitters create this frame.
    this.updateParticles(this.#castPool, delta);
    this.updateParticles(this.#persistentPool, delta);

    for (const emitter of this.#emitters) {
      if (!emitter.active) continue;
      emitter.elapsedSinceEmission += delta;
      if (emitter.elapsedSinceEmission <= PERSISTENT_EMISSION_INTERVAL_SECONDS) continue;
      // The original checks once and resets its timestamp. Never catch up with
      // a while-loop after a suspended or unusually long browser frame.
      this.emitPersistentParticles(emitter);
      emitter.elapsedSinceEmission = 0;
    }
  }

  clear(): void {
    for (const particle of this.#castPool) deactivateParticle(particle);
    for (const particle of this.#persistentPool) deactivateParticle(particle);
    for (const emitter of this.#emitters) deactivateEmitter(emitter);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clear();
    this.#owner.remove(this.object);
    for (const particle of this.#castPool) particle.sprite.material.dispose();
    for (const particle of this.#persistentPool) particle.sprite.material.dispose();
    this.#castPool.length = 0;
    this.#persistentPool.length = 0;
    this.object.clear();
    this.#fallbackGlow.dispose();
    if (this.#resources) disposeClassicResources(this.#resources);
    this.#resources = null;
  }

  private canPlayAt(position: THREE.Vector3): boolean {
    return !this.#disposed && this.#enabled && isFiniteVector(position);
  }

  private spawnCastParticle(options: {
    readonly position: THREE.Vector3;
    readonly texture: MagicWeaponTexture;
    readonly lifetime: number;
    readonly baseScale: number;
    readonly scaleVelocity: number;
    readonly color: number;
    readonly rotation: number;
  }): void {
    const particle = this.acquireParticle(this.#castPool, CAST_POOL_LIMIT, "cast");
    activateParticle(particle, {
      ...options,
      serial: ++this.#serial,
    });
    this.applyParticleAsset(particle);
  }

  private emitPersistentParticles(emitter: PersistentEmitter): void {
    for (let index = 0; index < 3; index++) {
      const randomSerial = ++this.#randomSerial;
      const weaponSlot = 10 - classicRandomStep(randomSerial, 0, 10);
      const scaleStep = classicRandomStep(randomSerial, 1, 60);
      const position = this.#scratchPosition.copy(emitter.base).lerp(emitter.tip, weaponSlot / 10);
      const particle = this.acquireParticle(
        this.#persistentPool,
        PERSISTENT_POOL_LIMIT,
        "persistent",
      );
      activateParticle(particle, {
        position,
        texture: "flare",
        lifetime: PERSISTENT_PARTICLE_LIFETIME_SECONDS,
        baseScale: 0.2 + scaleStep * 0.01,
        scaleVelocity: PERSISTENT_PARTICLE_SCALE_VELOCITY,
        color: MAGIC_WEAPON_COLOR,
        // The source uses (PI * integer) / .1, which is 0 modulo 2*PI.
        rotation: 0,
        serial: ++this.#serial,
      });
      this.applyParticleAsset(particle);
    }
  }

  private acquireParticle(
    pool: MagicWeaponParticle[],
    limit: number,
    kind: "cast" | "persistent",
  ): MagicWeaponParticle {
    const free = pool.find((particle) => !particle.active);
    if (free) return free;
    if (pool.length < limit) {
      const particle = createParticle(
        this.#fallbackGlow,
        `classic-foema-magic-weapon-${kind}-${pool.length}`,
      );
      pool.push(particle);
      this.object.add(particle.sprite);
      return particle;
    }
    const oldest = oldestBySerial(pool);
    deactivateParticle(oldest);
    return oldest;
  }

  private applyParticleAsset(particle: MagicWeaponParticle): void {
    const resources = this.#resources;
    const texture = particle.texture === "line"
      ? resources?.lineTexture ?? this.#fallbackGlow
      : resources?.flareTexture ?? this.#fallbackGlow;
    if (particle.sprite.material.map === texture) return;
    particle.sprite.material.map = texture;
    particle.sprite.material.needsUpdate = true;
  }

  private updateParticles(pool: readonly MagicWeaponParticle[], deltaSeconds: number): void {
    for (const particle of pool) {
      if (!particle.active) continue;
      particle.elapsed += deltaSeconds;
      if (particle.elapsed >= particle.lifetime) {
        deactivateParticle(particle);
        continue;
      }
      const progress = particle.elapsed / particle.lifetime;
      const fade = progress >= BILLBOARD_VISIBLE_FRACTION
        ? Math.max(0, Math.sin(progress * Math.PI))
        : 0;
      const scale = particle.baseScale + particle.elapsed * particle.scaleVelocity;
      particle.sprite.scale.set(scale, scale, 1);
      particle.sprite.visible = fade > 0;
      particle.sprite.material.opacity = fade;
      // The fixed-function client fades RGB as well as alpha before applying
      // SrcColor+One, rather than relying only on source alpha.
      particle.sprite.material.color.setHex(particle.color).multiplyScalar(fade);
    }
  }

  private async loadClassicResources(assets: ClassicAssetSource): Promise<ClassicMagicWeaponResources> {
    const results = await Promise.allSettled([
      this.loadTexture(assets, 56),
      this.loadTexture(assets, 60),
    ]);
    const loaded = results
      .filter((result): result is PromiseFulfilledResult<THREE.Texture> => result.status === "fulfilled")
      .map((result) => result.value);
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure || loaded.length !== results.length) {
      for (const texture of loaded) texture.dispose();
      throw failure?.reason ?? new Error("Texturas 56/60 da Arma Mágica incompletas");
    }
    return {
      flareTexture: (results[0] as PromiseFulfilledResult<THREE.Texture>).value,
      lineTexture: (results[1] as PromiseFulfilledResult<THREE.Texture>).value,
    };
  }

  private async loadTexture(assets: ClassicAssetSource, index: 56 | 60): Promise<THREE.Texture> {
    const url = assets.effectTextureUrl(index);
    if (!url) throw new Error(`Textura de efeito ${index} ausente`);
    const texture = await this.#dds.loadAsync(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    // TMEffectBillBoard uses a 0.02 edge inset for both texture entries.
    texture.offset.set(0.02, 0.98);
    texture.repeat.set(0.96, -0.96);
    texture.needsUpdate = true;
    return texture;
  }
}

function createPersistentEmitter(side: "left" | "right"): PersistentEmitter {
  return {
    side,
    base: new THREE.Vector3(),
    tip: new THREE.Vector3(),
    active: false,
    elapsedSinceEmission: 0,
  };
}

function createParticle(texture: THREE.Texture, name: string): MagicWeaponParticle {
  const material = new THREE.SpriteMaterial({
    map: texture,
    color: 0x000000,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcColorFactor,
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
  sprite.renderOrder = 6;
  return {
    sprite,
    active: false,
    elapsed: 0,
    lifetime: CAST_LINE_LIFETIME_SECONDS,
    serial: 0,
    baseScale: 0,
    scaleVelocity: 0,
    color: MAGIC_WEAPON_COLOR,
    texture: "flare",
  };
}

function activateParticle(
  particle: MagicWeaponParticle,
  options: {
    readonly position: THREE.Vector3;
    readonly texture: MagicWeaponTexture;
    readonly lifetime: number;
    readonly baseScale: number;
    readonly scaleVelocity: number;
    readonly color: number;
    readonly rotation: number;
    readonly serial: number;
  },
): void {
  particle.active = true;
  particle.elapsed = 0;
  particle.lifetime = options.lifetime;
  particle.serial = options.serial;
  particle.baseScale = options.baseScale;
  particle.scaleVelocity = options.scaleVelocity;
  particle.color = options.color;
  particle.texture = options.texture;
  particle.sprite.position.copy(options.position);
  particle.sprite.scale.set(options.baseScale, options.baseScale, 1);
  particle.sprite.material.rotation = options.rotation;
  particle.sprite.material.color.setHex(0x000000);
  particle.sprite.material.opacity = 0;
  particle.sprite.visible = false;
}

function deactivateParticle(particle: MagicWeaponParticle): void {
  particle.active = false;
  particle.elapsed = 0;
  particle.sprite.visible = false;
  particle.sprite.material.opacity = 0;
}

function deactivateEmitter(emitter: PersistentEmitter): void {
  emitter.active = false;
  emitter.elapsedSinceEmission = 0;
}

function oldestBySerial(particles: readonly MagicWeaponParticle[]): MagicWeaponParticle {
  let oldest = particles[0]!;
  for (const particle of particles) {
    if (particle.serial < oldest.serial) oldest = particle;
  }
  return oldest;
}

/** Deterministic stand-in for the retail client's sequential rand() calls. */
function classicRandomStep(serial: number, lane: number, modulus: number): number {
  const seed = Math.imul(serial + lane * 0x9e37, 1_103_515_245) + 12_345;
  return (seed >>> 16) % modulus;
}

function createFallbackGlowTexture(): THREE.DataTexture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1;
      const dy = (y + 0.5) / size * 2 - 1;
      const intensity = Math.max(0, 1 - Math.hypot(dx, dy));
      const value = Math.round(255 * intensity * intensity);
      const offset = (x + y * size) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = value;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = "classic-foema-magic-weapon-fallback";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function disposeClassicResources(resources: ClassicMagicWeaponResources): void {
  resources.flareTexture.dispose();
  resources.lineTexture.dispose();
}

function isFiniteSegment(segment: ClassicWeaponEffectSegmentSample): boolean {
  return isFiniteVector(segment.base) && isFiniteVector(segment.tip);
}

function isFiniteVector(position: THREE.Vector3): boolean {
  return Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
}
