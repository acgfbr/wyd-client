import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { parseMsa } from "../../formats/classic/Msa";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";

const CONTROLLER_LIFETIME_SECONDS = 3;
const PARTICLE_COUNT = 15;
const PARTICLE_LIFETIME_START_SECONDS = 2;
const PARTICLE_LIFETIME_STEP_SECONDS = 0.3;
const PARTICLE_VERTICAL_DISTANCE = -7;
const PARTICLE_CIRCLE_SPEED = 6;
const RAY_LIFETIME_SECONDS = 4;
const BILLBOARD_VISIBLE_FRACTION = 0.05;

const CONTROLLER_POOL_LIMIT = 8;
const PARTICLE_POOL_LIMIT = CONTROLLER_POOL_LIMIT * PARTICLE_COUNT;
const RAY_POOL_LIMIT = CONTROLLER_POOL_LIMIT;

const PARTICLE_TEXTURE_INDEX = 56;
const RAY_TEXTURE_INDEX = 51;
const PARTICLE_COLOR = 0xaa00ff;
const RAY_ROLL = 2.792527;

const PERSISTENT_VISIBLE_SECONDS = 1;
const PERSISTENT_MODEL_TYPES = [704, 705] as const;
const PERSISTENT_TEXTURE_INDEX = 57;
const PERSISTENT_YAW_OFFSETS = [0, 45, 90, -45, -90].map(THREE.MathUtils.degToRad);
const PERSISTENT_HEIGHT_OFFSETS = [0, -0.1, -0.2, -0.1, -0.2] as const;
const PERSISTENT_HORIZONTAL_SCALES = [1, 1.5, 2, 2, 1.5] as const;

export interface FoemaMagicShieldOwnerContext {
  /** Logical actor feet, equivalent to the unmounted TMHuman height anchor. */
  readonly ownerFeet: THREE.Vector3;
  /** Exact m_vecSkinPos equivalent used by the mounted retail branch. */
  readonly ownerSkinAnchor: THREE.Vector3;
  readonly mounted: boolean;
}

interface MagicShieldResources {
  readonly particleTexture: THREE.Texture;
  readonly rayTexture: THREE.Texture;
  readonly persistentTexture: THREE.Texture;
  readonly geometry704: THREE.BufferGeometry;
  readonly geometry705: THREE.BufferGeometry;
}

interface MagicShieldController {
  active: boolean;
  elapsed: number;
  serial: number;
}

interface MagicShieldParticle {
  readonly sprite: THREE.Sprite;
  readonly start: THREE.Vector3;
  active: boolean;
  elapsed: number;
  lifetime: number;
  horizontalRadius: number;
  serial: number;
}

interface MagicShieldRay {
  readonly sprite: THREE.Sprite;
  active: boolean;
  elapsed: number;
  serial: number;
}

interface PersistentShieldPair {
  readonly root: THREE.Group;
  readonly horizontalScale: number;
  readonly heightOffset: number;
  readonly yawOffset: number;
}

interface MutableFoemaMagicShieldOwnerContext {
  readonly ownerFeet: THREE.Vector3;
  readonly ownerSkinAnchor: THREE.Vector3;
  mounted: boolean;
}

/**
 * Presentation-only port of Foema #43, Escudo Magico.
 *
 * TMHuman.cpp:9192-9204 maps event #43 to `TMSkillHaste(..., 1)`. The type-1
 * constructor in TMSkillHaste.cpp:6-74 creates fifteen independent texture-56
 * particles and one texture-51 ray. Its own three-second lifetime
 * (TMSkillHaste.cpp:10-11,89-99) does not truncate those child billboards,
 * whose longest lifetime is 6.2 seconds.
 *
 * The caller owns the retail +500 ms event delay (TMFieldScene.cpp:21623-21658),
 * gameplay affect, sound 159 and target selection. `syncPersistent` implements
 * the active retail shield path: TMHuman.cpp:1401-1424 owns a type-0
 * TMSkillMagicShield and TMHuman.cpp:9584-9589 retriggers StartVisible every
 * second while affect 11 is set.
 */
export class ClassicFoemaMagicShieldEffects {
  readonly object = new THREE.Group();
  readonly #dds = new ClassicDdsTextureLoader();
  readonly #controllers: MagicShieldController[] = [];
  readonly #particles: MagicShieldParticle[] = [];
  readonly #rays: MagicShieldRay[] = [];
  readonly #persistentRoot = new THREE.Group();
  readonly #persistentPairs: PersistentShieldPair[] = [];
  #resources: MagicShieldResources | null = null;
  #persistentMaterial: THREE.MeshBasicMaterial | null = null;
  #persistentContext: MutableFoemaMagicShieldOwnerContext | null = null;
  #persistentRequested = false;
  #persistentPulseActive = false;
  #persistentElapsed = 0;
  #preload: Promise<void> | null = null;
  #serial = 0;
  #castSerial = 0;
  #enabled = true;
  #disposed = false;

  constructor(parent: THREE.Object3D) {
    this.object.name = "classic-foema-magic-shield-effects";
    this.#persistentRoot.name = "classic-foema-magic-shield-persistent-704-705-57";
    this.#persistentRoot.visible = false;
    this.object.add(this.#persistentRoot);
    parent.add(this.object);
  }

  /** Loads textures 51/56/57 and common models 704/705 exactly once. */
  async prepareClassic(assets: ClassicAssetSource): Promise<void> {
    if (this.#disposed || this.#resources) return;
    if (this.#preload) return this.#preload;

    const job = this.loadClassicResources(assets)
      .then((resources) => {
        if (this.#disposed) {
          disposeResources(resources);
          return;
        }
        try {
          this.installPersistentResources(resources);
          this.#resources = resources;
          if (this.#persistentRequested && this.#persistentContext) {
            this.startPersistentPulse();
          }
        } catch (error) {
          this.disposePersistentInstallation();
          disposeResources(resources);
          throw error;
        }
      })
      .catch((error: unknown) => {
        console.warn("Efeito classico #43 Escudo Magico da Foema indisponivel.", error);
      })
      .finally(() => {
        this.#preload = null;
      });
    this.#preload = job;
    return job;
  }

  /** Starts the already-delayed type-1 TMSkillHaste burst at target feet. */
  play(targetPosition: THREE.Vector3): boolean {
    if (
      this.#disposed
      || !this.#enabled
      || !this.#resources
      || !isFiniteVector(targetPosition)
    ) {
      return false;
    }

    const controller = this.acquireController();
    controller.active = true;
    controller.elapsed = 0;
    controller.serial = ++this.#serial;

    const castSerial = ++this.#castSerial;
    for (let index = 0; index < PARTICLE_COUNT; index++) {
      this.spawnParticle(targetPosition, castSerial, index);
    }
    this.spawnRay(targetPosition);
    return true;
  }

  /**
   * Copies the owner's current visual anchors and persistent affect state.
   * A null/invalid owner removes the visual immediately. Turning only `active`
   * off lets the current one-second StartVisible pulse finish, as in retail.
   */
  syncPersistent(
    owner: FoemaMagicShieldOwnerContext | null,
    active: boolean,
  ): void {
    if (this.#disposed) return;
    if (!owner || !isFiniteOwnerContext(owner)) {
      this.stopPersistent(true);
      this.#persistentContext = null;
      return;
    }

    if (!this.#persistentContext) {
      this.#persistentContext = {
        ownerFeet: owner.ownerFeet.clone(),
        ownerSkinAnchor: owner.ownerSkinAnchor.clone(),
        mounted: owner.mounted,
      };
    } else {
      this.#persistentContext.ownerFeet.copy(owner.ownerFeet);
      this.#persistentContext.ownerSkinAnchor.copy(owner.ownerSkinAnchor);
      this.#persistentContext.mounted = owner.mounted;
    }

    const nextRequested = this.#enabled && active;
    if (nextRequested && !this.#persistentRequested && this.#resources) {
      this.startPersistentPulse();
    }
    this.#persistentRequested = nextRequested;
    this.updatePersistentTransform();
  }

  update(deltaSeconds: number): void {
    if (this.#disposed || !this.#enabled) return;
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    if (delta === 0) return;

    for (const controller of this.#controllers) {
      if (!controller.active) continue;
      controller.elapsed += delta;
      if (controller.elapsed >= CONTROLLER_LIFETIME_SECONDS) {
        deactivateController(controller);
      }
    }

    for (const particle of this.#particles) {
      if (!particle.active) continue;
      particle.elapsed += delta;
      this.updateParticle(particle);
    }

    for (const ray of this.#rays) {
      if (!ray.active) continue;
      ray.elapsed += delta;
      this.updateRay(ray);
    }

    this.updatePersistent(delta);
  }

  clear(): void {
    for (const controller of this.#controllers) deactivateController(controller);
    for (const particle of this.#particles) deactivateParticle(particle);
    for (const ray of this.#rays) deactivateRay(ray);
    this.stopPersistent(true);
    this.#persistentContext = null;
  }

  setEnabled(enabled: boolean): void {
    if (this.#disposed || this.#enabled === enabled) return;
    this.#enabled = enabled;
    this.object.visible = enabled;
    if (!enabled) this.clear();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clear();

    for (const particle of this.#particles) particle.sprite.material.dispose();
    for (const ray of this.#rays) ray.sprite.material.dispose();
    this.#controllers.length = 0;
    this.#particles.length = 0;
    this.#rays.length = 0;
    this.disposePersistentInstallation();
    if (this.#resources) disposeResources(this.#resources);
    this.#resources = null;
    this.object.removeFromParent();
    this.object.clear();
  }

  private acquireController(): MagicShieldController {
    const free = this.#controllers.find((controller) => !controller.active);
    if (free) return free;
    if (this.#controllers.length < CONTROLLER_POOL_LIMIT) {
      const controller: MagicShieldController = {
        active: false,
        elapsed: 0,
        serial: 0,
      };
      this.#controllers.push(controller);
      return controller;
    }
    const oldest = oldestBySerial(this.#controllers);
    deactivateController(oldest);
    return oldest;
  }

  private spawnParticle(
    targetPosition: THREE.Vector3,
    castSerial: number,
    index: number,
  ): void {
    const particle = this.acquireParticle();
    const randomOffset = classicRandomStep(castSerial, index, 5) - 3;
    const offset = randomOffset * 0.1;

    particle.active = true;
    particle.elapsed = 0;
    particle.lifetime = PARTICLE_LIFETIME_START_SECONDS
      + index * PARTICLE_LIFETIME_STEP_SECONDS;
    particle.horizontalRadius = (index % 3) * 0.05 + 0.1;
    particle.serial = ++this.#serial;
    particle.start.set(
      targetPosition.x + offset,
      targetPosition.y + 5 + offset,
      // Classic +Z is scene -Z.
      targetPosition.z - offset,
    );

    const baseScale = (index % 2) * 0.1 + 0.1;
    particle.sprite.scale.set(baseScale, baseScale, 1);
    particle.sprite.material.color.setHex(PARTICLE_COLOR).multiplyScalar(0);
    particle.sprite.material.opacity = 1;
    particle.sprite.visible = false;
    this.updateParticleTransform(particle, 0);
  }

  private acquireParticle(): MagicShieldParticle {
    const free = this.#particles.find((particle) => !particle.active);
    if (free) return free;
    if (this.#particles.length < PARTICLE_POOL_LIMIT) {
      const sprite = createBrightSprite(
        this.#resources!.particleTexture,
        PARTICLE_COLOR,
        `classic-foema-magic-shield-particle-56-${this.#particles.length}`,
      );
      const particle: MagicShieldParticle = {
        sprite,
        start: new THREE.Vector3(),
        active: false,
        elapsed: 0,
        lifetime: 0,
        horizontalRadius: 0,
        serial: 0,
      };
      this.#particles.push(particle);
      this.object.add(sprite);
      return particle;
    }
    const oldest = oldestBySerial(this.#particles);
    deactivateParticle(oldest);
    return oldest;
  }

  private updateParticle(particle: MagicShieldParticle): void {
    if (particle.elapsed >= particle.lifetime) {
      deactivateParticle(particle);
      return;
    }
    const progress = particle.elapsed / particle.lifetime;
    this.updateParticleTransform(particle, progress);
    const fade = Math.max(0, Math.sin(progress * Math.PI));
    // EF_BRIGHT selects texture alpha; retail fades the diffuse RGB channels.
    particle.sprite.material.color.setHex(PARTICLE_COLOR).multiplyScalar(fade);
    particle.sprite.material.opacity = 1;
    particle.sprite.visible = progress >= BILLBOARD_VISIBLE_FRACTION;
  }

  private updateParticleTransform(particle: MagicShieldParticle, progress: number): void {
    const phase = progress * Math.PI * PARTICLE_CIRCLE_SPEED;
    particle.sprite.position.set(
      particle.start.x + Math.sin(phase) * particle.horizontalRadius,
      particle.start.y + progress * PARTICLE_VERTICAL_DISTANCE,
      // Reflect TMSkillBillBoard particle type 3's classic Z orbit.
      particle.start.z - Math.cos(phase) * particle.horizontalRadius,
    );
  }

  private spawnRay(targetPosition: THREE.Vector3): void {
    const ray = this.acquireRay();
    ray.active = true;
    ray.elapsed = 0;
    ray.serial = ++this.#serial;
    ray.sprite.position.set(targetPosition.x, targetPosition.y + 2, targetPosition.z);
    ray.sprite.scale.set(1.5, 10, 1);
    ray.sprite.material.rotation = RAY_ROLL;
    ray.sprite.material.color.setHex(0xffffff).multiplyScalar(0);
    ray.sprite.material.opacity = 1;
    ray.sprite.visible = false;
  }

  private acquireRay(): MagicShieldRay {
    const free = this.#rays.find((ray) => !ray.active);
    if (free) return free;
    if (this.#rays.length < RAY_POOL_LIMIT) {
      const sprite = createBrightSprite(
        this.#resources!.rayTexture,
        0xffffff,
        `classic-foema-magic-shield-ray-51-${this.#rays.length}`,
      );
      sprite.renderOrder = 7;
      const ray: MagicShieldRay = {
        sprite,
        active: false,
        elapsed: 0,
        serial: 0,
      };
      this.#rays.push(ray);
      this.object.add(sprite);
      return ray;
    }
    const oldest = oldestBySerial(this.#rays);
    deactivateRay(oldest);
    return oldest;
  }

  private updateRay(ray: MagicShieldRay): void {
    if (ray.elapsed >= RAY_LIFETIME_SECONDS) {
      deactivateRay(ray);
      return;
    }
    const progress = ray.elapsed / RAY_LIFETIME_SECONDS;
    const fade = Math.max(0, Math.sin(progress * Math.PI));
    ray.sprite.material.color.setHex(0xffffff).multiplyScalar(fade);
    ray.sprite.material.opacity = 1;
    ray.sprite.visible = progress >= BILLBOARD_VISIBLE_FRACTION;
  }

  private installPersistentResources(resources: MagicShieldResources): void {
    this.#persistentMaterial = createBrightMeshMaterial(resources.persistentTexture);
    for (let index = 0; index < PERSISTENT_YAW_OFFSETS.length; index++) {
      const root = new THREE.Group();
      root.name = `classic-foema-magic-shield-pair-${index}`;
      root.visible = false;

      const mesh704 = new THREE.Mesh(resources.geometry704, this.#persistentMaterial);
      const mesh705 = new THREE.Mesh(resources.geometry705, this.#persistentMaterial);
      mesh704.name = `classic-foema-magic-shield-model-704-${index}`;
      mesh705.name = `classic-foema-magic-shield-model-705-${index}`;
      mesh704.renderOrder = 8;
      mesh705.renderOrder = 8;
      root.add(mesh704, mesh705);
      this.#persistentRoot.add(root);
      this.#persistentPairs.push({
        root,
        horizontalScale: PERSISTENT_HORIZONTAL_SCALES[index]!,
        heightOffset: PERSISTENT_HEIGHT_OFFSETS[index]!,
        yawOffset: PERSISTENT_YAW_OFFSETS[index]!,
      });
    }
  }

  private startPersistentPulse(): void {
    if (!this.#resources || !this.#persistentContext) return;
    this.#persistentElapsed = 0;
    this.#persistentPulseActive = true;
    this.#persistentRoot.visible = false;
    for (const pair of this.#persistentPairs) pair.root.visible = false;
  }

  private updatePersistent(delta: number): void {
    if (!this.#resources || !this.#persistentContext || !this.#persistentMaterial) {
      this.hidePersistent();
      return;
    }

    if (!this.#persistentPulseActive) {
      if (!this.#persistentRequested) {
        this.hidePersistent();
        return;
      }
      this.startPersistentPulse();
    } else {
      this.#persistentElapsed += delta;
      if (this.#persistentElapsed > PERSISTENT_VISIBLE_SECONDS) {
        if (this.#persistentRequested) {
          // TMHuman stores the current tick after StartVisible; suspended frames
          // never replay missed one-second pulses.
          this.startPersistentPulse();
        } else {
          this.#persistentPulseActive = false;
          this.hidePersistent();
          return;
        }
      }
    }

    this.updatePersistentTransform();
  }

  private updatePersistentTransform(): void {
    const context = this.#persistentContext;
    const material = this.#persistentMaterial;
    if (!context || !material || !this.#persistentPulseActive) return;

    const progress = THREE.MathUtils.clamp(
      this.#persistentElapsed / PERSISTENT_VISIBLE_SECONDS,
      0,
      1,
    );
    const fade = Math.abs(Math.sin(progress * Math.PI));
    const anchor = context.mounted ? context.ownerSkinAnchor : context.ownerFeet;
    this.#persistentRoot.position.copy(anchor);
    this.#persistentRoot.visible = progress >= BILLBOARD_VISIBLE_FRACTION;
    material.color.setRGB(fade, fade, fade);
    // Type 0 rewrites vertex RGB only; texture alpha remains the blend source.
    material.opacity = 1;

    const angle = progress * Math.PI * 2;
    const mountScale = context.mounted ? 1.5 : 1;
    for (const pair of this.#persistentPairs) {
      const sourceYaw = -angle + pair.yawOffset;
      pair.root.position.set(0, pair.heightOffset, 0);
      // parseMsa reflects Z; this is TMMesh::Render(yaw, 0, +90deg roll)
      // converted into Three's right-handed YXZ basis.
      pair.root.rotation.set(Math.PI / 2, -sourceYaw, Math.PI / 2, "YXZ");
      const horizontalScale = pair.horizontalScale * mountScale;
      // TMMesh mutates only m_fScaleH; vertical scale remains one.
      pair.root.scale.set(horizontalScale, 1, horizontalScale);
      pair.root.visible = this.#persistentRoot.visible;
    }
  }

  private stopPersistent(immediate: boolean): void {
    this.#persistentRequested = false;
    if (!immediate && this.#persistentPulseActive) return;
    this.#persistentPulseActive = false;
    this.#persistentElapsed = 0;
    this.hidePersistent();
  }

  private hidePersistent(): void {
    this.#persistentRoot.visible = false;
    for (const pair of this.#persistentPairs) pair.root.visible = false;
  }

  private disposePersistentInstallation(): void {
    this.hidePersistent();
    this.#persistentPairs.length = 0;
    this.#persistentRoot.clear();
    this.#persistentMaterial?.dispose();
    this.#persistentMaterial = null;
  }

  private async loadClassicResources(assets: ClassicAssetSource): Promise<MagicShieldResources> {
    const results = await Promise.allSettled([
      this.loadEffectTexture(assets, PARTICLE_TEXTURE_INDEX, true),
      this.loadEffectTexture(assets, RAY_TEXTURE_INDEX, true),
      this.loadEffectTexture(assets, PERSISTENT_TEXTURE_INDEX, false),
      loadEffectGeometry(assets, 704),
      loadEffectGeometry(assets, 705),
    ] as const);
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) {
      for (const result of results) {
        if (result.status === "fulfilled") result.value.dispose();
      }
      throw failure.reason;
    }
    return {
      particleTexture: settledValue(results[0]),
      rayTexture: settledValue(results[1]),
      persistentTexture: settledValue(results[2]),
      geometry704: settledValue(results[3]),
      geometry705: settledValue(results[4]),
    };
  }

  private async loadEffectTexture(
    assets: ClassicAssetSource,
    index: typeof PARTICLE_TEXTURE_INDEX
      | typeof RAY_TEXTURE_INDEX
      | typeof PERSISTENT_TEXTURE_INDEX,
    billboard: boolean,
  ): Promise<THREE.Texture> {
    const url = assets.effectTextureUrl(index);
    if (!url) throw new Error(`Textura de efeito ${index} ausente do manifesto`);
    const texture = await this.#dds.loadAsync(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    if (billboard) configureClassicBillboardUvs(texture);
    texture.needsUpdate = true;
    return texture;
  }
}

function createBrightSprite(texture: THREE.Texture, color: number, name: string): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: texture,
    color,
    transparent: true,
    opacity: 1,
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
  sprite.renderOrder = 6;
  return sprite;
}

function createBrightMeshMaterial(texture: THREE.Texture): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: 0x000000,
    transparent: true,
    opacity: 1,
    depthTest: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.SrcAlphaFactor,
    blendDstAlpha: THREE.OneFactor,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
  material.forceSinglePass = true;
  return material;
}

function configureClassicBillboardUvs(texture: THREE.Texture): void {
  // TMEffectBillBoard.cpp:49-56 uses a two-percent inset and DDS V flip.
  texture.offset.set(0.02, 0.98);
  texture.repeat.set(0.96, -0.96);
  texture.needsUpdate = true;
}

function deactivateController(controller: MagicShieldController): void {
  controller.active = false;
  controller.elapsed = 0;
}

function deactivateParticle(particle: MagicShieldParticle): void {
  particle.active = false;
  particle.elapsed = 0;
  particle.sprite.visible = false;
  particle.sprite.material.opacity = 1;
  particle.sprite.material.color.setHex(PARTICLE_COLOR).multiplyScalar(0);
}

function deactivateRay(ray: MagicShieldRay): void {
  ray.active = false;
  ray.elapsed = 0;
  ray.sprite.visible = false;
  ray.sprite.material.opacity = 1;
  ray.sprite.material.color.setHex(0xffffff).multiplyScalar(0);
}

function oldestBySerial<T extends { serial: number }>(entries: readonly T[]): T {
  let oldest = entries[0]!;
  for (const entry of entries) {
    if (entry.serial < oldest.serial) oldest = entry;
  }
  return oldest;
}

/** Deterministic stand-in for the retail client's sequential rand() calls. */
function classicRandomStep(serial: number, lane: number, modulus: number): number {
  const seed = Math.imul(serial + lane * 0x9e37, 1_103_515_245) + 12_345;
  return (seed >>> 16) % modulus;
}

async function loadEffectGeometry(
  assets: ClassicAssetSource,
  type: (typeof PERSISTENT_MODEL_TYPES)[number],
): Promise<THREE.BufferGeometry> {
  const source = await assets.loadModel(type);
  if (!source) throw new Error(`Modelo classico ${type} ausente do manifesto`);
  return parseMsa(source.buffer).geometry;
}

function settledValue<T>(result: PromiseSettledResult<T>): T {
  if (result.status === "rejected") throw result.reason;
  return result.value;
}

function disposeResources(resources: MagicShieldResources): void {
  resources.particleTexture.dispose();
  resources.rayTexture.dispose();
  resources.persistentTexture.dispose();
  resources.geometry704.dispose();
  resources.geometry705.dispose();
}

function isFiniteVector(position: THREE.Vector3): boolean {
  return Number.isFinite(position.x)
    && Number.isFinite(position.y)
    && Number.isFinite(position.z);
}

function isFiniteOwnerContext(context: FoemaMagicShieldOwnerContext): boolean {
  return isFiniteVector(context.ownerFeet) && isFiniteVector(context.ownerSkinAnchor);
}
