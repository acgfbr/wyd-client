import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";

const CONTROLLER_POOL_LIMIT = 16;
const PARTICLE_POOL_LIMIT = 128;

const CONTROLLER_LIFETIME_SECONDS = 2;
const OWNER_FOLLOW_SECONDS = CONTROLLER_LIFETIME_SECONDS * 0.5;
const EMISSION_INTERVAL_SECONDS = 0.5;
const PARTICLE_LIFETIME_SECONDS = 2;
const PARTICLE_VISIBLE_FRACTION = 0.05;
const PARTICLE_SCALE_PER_SECOND = 0.1;
const PARTICLE_VERTICAL_DISTANCE = 1.5;
const PARTICLE_CIRCLE_SPEED = 3;

export type ClassicSlowSlashType = 0 | 1 | 2;
export type ClassicSlowSlashFollowTarget = () => THREE.Vector3 | null;
export type BeastMasterWeakenFollowTarget = ClassicSlowSlashFollowTarget;

interface WeakenResources {
  readonly slowTexture: THREE.Texture;
}

interface SlowSlashController {
  readonly casterSnapshot: THREE.Vector3;
  readonly emissionCenter: THREE.Vector3;
  active: boolean;
  elapsed: number;
  nextEmission: number;
  serial: number;
  type: ClassicSlowSlashType;
  followTarget: ClassicSlowSlashFollowTarget | null;
}

interface SlowSlashParticle {
  readonly sprite: THREE.Sprite;
  readonly start: THREE.Vector3;
  active: boolean;
  elapsed: number;
  serial: number;
  motion: 1 | 2 | 3;
  color: number;
  baseScale: number;
  horizontalDistance: number;
}

/**
 * Shared presentation port of TMSkillSlowSlash.
 *
 * Type 0 belongs to TransKnight #16 Perseguição, type 1 to BeastMaster #51
 * Enfraquecer and type 2 remains available for the other recovered callsites.
 * Sound and gameplay stay with the caller. `play` copies both positions
 * immediately; the first half follows the owner and the second resolves the
 * constructor target exactly like the original controller.
 */
export class ClassicSlowSlashEffects {
  readonly object = new THREE.Group();
  readonly #dds = new ClassicDdsTextureLoader();
  readonly #controllers: SlowSlashController[] = [];
  readonly #particles: SlowSlashParticle[] = [];
  #resources: WeakenResources | null = null;
  #preload: Promise<void> | null = null;
  #serial = 0;
  #randomSerial = 0;
  #enabled = true;
  #disposed = false;

  constructor(parent: THREE.Object3D) {
    this.object.name = "classic-slow-slash-effects";
    parent.add(this.object);
  }

  /** Loads retail effect texture 2 used by TMSkillSlowSlash type 1. */
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
      })
      .catch((error: unknown) => {
        console.warn("Efeito clássico TMSkillSlowSlash indisponível.", error);
      })
      .finally(() => {
        this.#preload = null;
      });
    this.#preload = job;
    return job;
  }

  /**
   * Starts the already-delayed visual. No timer, hit, damage or debuff is
   * scheduled here; callers should invoke this at the classic +500 ms event.
   */
  play(
    casterFeet: THREE.Vector3,
    primaryTargetFeet: THREE.Vector3,
    followTarget?: ClassicSlowSlashFollowTarget,
    type: ClassicSlowSlashType = 1,
  ): boolean {
    if (
      this.#disposed
      || !this.#enabled
      || !this.#resources
      || !isFiniteVector(casterFeet)
      || !isFiniteVector(primaryTargetFeet)
    ) {
      return false;
    }

    const controller = this.acquireController();
    controller.active = true;
    controller.elapsed = 0;
    controller.nextEmission = EMISSION_INTERVAL_SECONDS;
    controller.serial = ++this.#serial;
    controller.type = type;
    controller.followTarget = followTarget ?? null;
    controller.casterSnapshot.copy(casterFeet);
    controller.emissionCenter.copy(primaryTargetFeet);

    // m_dwLastTime starts at zero, so retail emits on the first FrameMove.
    this.spawnParticle(controller.emissionCenter, controller.type);
    return true;
  }

  update(deltaSeconds: number): void {
    if (this.#disposed || !this.#enabled) return;
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    if (delta === 0) return;

    this.updateControllers(delta);
    this.updateParticles(delta);
  }

  setEnabled(enabled: boolean): void {
    if (this.#disposed || this.#enabled === enabled) return;
    this.#enabled = enabled;
    this.object.visible = enabled;
    if (!enabled) this.clear();
  }

  clear(): void {
    for (const controller of this.#controllers) deactivateController(controller);
    for (const particle of this.#particles) deactivateParticle(particle);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clear();

    for (const particle of this.#particles) particle.sprite.material.dispose();
    this.#controllers.length = 0;
    this.#particles.length = 0;
    if (this.#resources) disposeResources(this.#resources);
    this.#resources = null;
    this.object.removeFromParent();
    this.object.clear();
  }

  private acquireController(): SlowSlashController {
    const free = this.#controllers.find((controller) => !controller.active);
    if (free) return free;
    if (this.#controllers.length < CONTROLLER_POOL_LIMIT) {
      const controller: SlowSlashController = {
        casterSnapshot: new THREE.Vector3(),
        emissionCenter: new THREE.Vector3(),
        active: false,
        elapsed: 0,
        nextEmission: 0,
        serial: 0,
        type: 1,
        followTarget: null,
      };
      this.#controllers.push(controller);
      return controller;
    }
    const oldest = oldestBySerial(this.#controllers);
    deactivateController(oldest);
    return oldest;
  }

  private updateControllers(delta: number): void {
    for (const controller of this.#controllers) {
      if (!controller.active) continue;
      controller.elapsed += delta;
      if (controller.elapsed >= CONTROLLER_LIFETIME_SECONDS) {
        deactivateController(controller);
        continue;
      }

      if (controller.elapsed > OWNER_FOLLOW_SECONDS) {
        // Retail drops m_pOwner and resolves the constructor vecTarget, which
        // TMHuman supplied as the caster's packet-time position.
        controller.followTarget = null;
        controller.emissionCenter.copy(controller.casterSnapshot);
      } else {
        this.refreshFollowedTarget(controller);
      }

      if (controller.elapsed > controller.nextEmission) {
        this.spawnParticle(controller.emissionCenter, controller.type);
        // TMSkillSlowSlash stores the current tick instead of catching up all
        // missed 500 ms emissions after a suspended/background frame.
        controller.nextEmission = controller.elapsed + EMISSION_INTERVAL_SECONDS;
      }
    }
  }

  private refreshFollowedTarget(controller: SlowSlashController): void {
    // Without a live callback the packet-time target snapshot already stored
    // in emissionCenter remains valid. After a callback fails, retaining the
    // last good sample is safer and closer to the still-owned retail object.
    if (!controller.followTarget) return;
    try {
      const followed = controller.followTarget();
      if (followed && isFiniteVector(followed)) {
        controller.emissionCenter.copy(followed);
      }
    } catch {
      // Presentation callbacks must never interrupt the render loop. Preserve
      // the last valid owner position for the rest of the first half.
      controller.followTarget = null;
    }
  }

  private spawnParticle(center: THREE.Vector3, type: ClassicSlowSlashType): void {
    const resources = this.#resources;
    if (!resources) return;
    const particle = this.acquireParticle(resources.slowTexture);
    const nRand = classicRandomStep(++this.#randomSerial, 32_768);
    particle.active = true;
    particle.elapsed = 0;
    particle.serial = ++this.#serial;
    particle.motion = (nRand % 3 + 1) as 1 | 2 | 3;
    particle.color = type === 0 ? 0xaaaa00 : type === 1 ? 0x5599aa : 0xffeeff;
    particle.baseScale = type === 2 ? 0.02 : 0.05;
    particle.horizontalDistance = type === 0 ? 0.2 : type === 1 ? 0.6 : 1.2;
    particle.start.set(
      center.x + (nRand % 5 + 1) * 0.1,
      center.y,
      // Classic +Z becomes scene -Z.
      center.z - (nRand % 5) * 0.1,
    );
    particle.sprite.position.copy(particle.start);
    particle.sprite.scale.set(particle.baseScale, particle.baseScale, 1);
    particle.sprite.material.color.setHex(particle.color).multiplyScalar(0);
    particle.sprite.material.opacity = 1;
    particle.sprite.visible = false;
  }

  private acquireParticle(texture: THREE.Texture): SlowSlashParticle {
    const free = this.#particles.find((particle) => !particle.active);
    if (free) return free;
    if (this.#particles.length < PARTICLE_POOL_LIMIT) {
      const sprite = createBrightSprite(
        texture,
        `classic-slow-slash-${this.#particles.length}`,
      );
      const particle: SlowSlashParticle = {
        sprite,
        start: new THREE.Vector3(),
        active: false,
        elapsed: 0,
        serial: 0,
        motion: 1,
        color: 0xffffff,
        baseScale: 0.05,
        horizontalDistance: 0.6,
      };
      this.#particles.push(particle);
      this.object.add(sprite);
      return particle;
    }
    const oldest = oldestBySerial(this.#particles);
    deactivateParticle(oldest);
    return oldest;
  }

  private updateParticles(delta: number): void {
    for (const particle of this.#particles) {
      if (!particle.active) continue;
      particle.elapsed += delta;
      if (particle.elapsed >= PARTICLE_LIFETIME_SECONDS) {
        deactivateParticle(particle);
        continue;
      }

      const progress = particle.elapsed / PARTICLE_LIFETIME_SECONDS;
      const phase = progress * Math.PI * PARTICLE_CIRCLE_SPEED;
      particle.sprite.position.copy(particle.start);
      particle.sprite.position.y += progress * PARTICLE_VERTICAL_DISTANCE;
      if (particle.motion >= 2) {
        particle.sprite.position.x += Math.sin(phase) * particle.horizontalDistance;
      }
      if (particle.motion >= 3) {
        particle.sprite.position.z -= Math.cos(phase) * particle.horizontalDistance;
      }
      const scale = particle.baseScale + particle.elapsed * PARTICLE_SCALE_PER_SECOND;
      particle.sprite.scale.set(scale, scale, 1);
      particle.sprite.material.color
        .setHex(particle.color)
        .multiplyScalar(Math.max(0, Math.sin(progress * Math.PI)));
      // EF_BRIGHT keeps texture alpha; RGB carries the retail fade.
      particle.sprite.material.opacity = 1;
      particle.sprite.visible = progress >= PARTICLE_VISIBLE_FRACTION;
    }
  }

  private async loadClassicResources(assets: ClassicAssetSource): Promise<WeakenResources> {
    const url = assets.effectTextureUrl(2);
    if (!url) throw new Error("Textura de efeito 2 ausente do manifesto");
    const slowTexture = await this.#dds.loadAsync(url);
    slowTexture.colorSpace = THREE.SRGBColorSpace;
    slowTexture.anisotropy = 4;
    slowTexture.offset.set(0.02, 0.98);
    slowTexture.repeat.set(0.96, -0.96);
    slowTexture.needsUpdate = true;
    return { slowTexture };
  }
}

function createBrightSprite(texture: THREE.Texture, name: string): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: texture,
    color: 0xffffff,
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
  sprite.renderOrder = 7;
  return sprite;
}

function deactivateController(controller: SlowSlashController): void {
  controller.active = false;
  controller.elapsed = 0;
  controller.nextEmission = 0;
  controller.type = 1;
  controller.followTarget = null;
}

function deactivateParticle(particle: SlowSlashParticle): void {
  particle.active = false;
  particle.elapsed = 0;
  particle.sprite.visible = false;
}

function oldestBySerial<T extends { serial: number }>(entries: readonly T[]): T {
  const first = entries[0];
  if (!first) throw new Error("Pool clássico vazio");
  let oldest = first;
  for (let index = 1; index < entries.length; index++) {
    const candidate = entries[index]!;
    if (candidate.serial < oldest.serial) oldest = candidate;
  }
  return oldest;
}

/** Deterministic stand-in for the classic client's sequential rand() call. */
function classicRandomStep(serial: number, modulus: number): number {
  const seed = Math.imul(serial, 1_103_515_245) + 12_345;
  return (seed >>> 16) % modulus;
}

function isFiniteVector(position: THREE.Vector3): boolean {
  return Number.isFinite(position.x)
    && Number.isFinite(position.y)
    && Number.isFinite(position.z);
}

function disposeResources(resources: WeakenResources): void {
  resources.slowTexture.dispose();
}

/** Backwards-compatible semantic name for BeastMaster #51. */
export { ClassicSlowSlashEffects as ClassicBeastMasterWeakenEffects };
