import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { parseMsa } from "../../formats/classic/Msa";
import {
  ClassicSkinnedAssetLibrary,
  type ClassicSkinnedInstanceLease,
} from "../../game/npcs/ClassicSkinnedAssetLibrary";
import { MonsterCatalog, type MonsterVisualFamily } from "../../game/npcs/MonsterCatalog";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";

export interface BeastMasterBuffVisualContext {
  readonly ownerFeet: THREE.Vector3;
  readonly ownerSkinAnchor: THREE.Vector3;
  readonly ownerClassicYaw: number;
  readonly ownerScale: number;
  readonly mounted: boolean;
  readonly elementalProtection: boolean;
  readonly elementalStrength: boolean;
}

type BeastMasterBuffIndex = 53 | 54;

const PROTECTOR_SKIN = 32;
const PROTECTOR_ROOT = "player/familiars/ag01";
const PROTECTOR_MODEL_SCALE = 0.3;
const PROTECTOR_FOLLOW_DISTANCE = 0.3;
const PROTECTOR_ORBIT_RADIUS = 0.1;
const PROTECTOR_BOB_HEIGHT = 0.05;
const PROTECTOR_ORBIT_PERIOD_SECONDS = 1;
const PROTECTOR_TRAIL_INTERVAL_SECONDS = 1 / 60;

const PROTECTION_CAST_POOL_LIMIT = 30;
const PROTECTION_TRAIL_POOL_LIMIT = 128;
const STRENGTH_CAST_POOL_LIMIT = 60;
const STRENGTH_RAY_POOL_LIMIT = 8;
const STRENGTH_SLOW_POOL_LIMIT = 96;
const SLOW_CONTROLLER_POOL_LIMIT = 12;

const PARTICLE_VISIBLE_FRACTION = 0.05;
const PROTECTION_TRAIL_COLOR = 0xffaaff;
const STRENGTH_COLOR = 0xffeeff;
const STRENGTH_TRIGGER_INTERVAL_SECONDS = 0.25;
const SLOW_CONTROLLER_LIFETIME_SECONDS = 2;
const SLOW_PARTICLE_INTERVAL_SECONDS = 0.5;
const STREAM_LINGER_SECONDS = 1;

const STREAM_MODEL_TYPES = [704, 705] as const;
const STREAM_YAW_OFFSETS = [0, 45, 90, -45, -90].map(THREE.MathUtils.degToRad);
const STREAM_HEIGHT_OFFSETS = [0, -0.1, -0.2, -0.1, -0.2] as const;
const STREAM_SCALES = [1, 1.5, 2, 2, 1.5] as const;

const PROTECTOR_FAMILY: MonsterVisualFamily = {
  base: "ag01",
  declaredParts: 1,
  meshParts: [1],
  skeleton: `${PROTECTOR_ROOT}/ag01.bon`,
  clips: [`${PROTECTOR_ROOT}/ag010101.ani`],
  actionSet: "angel",
  // TMEffectSkinMesh level 3 overrides m_dwFPS to five milliseconds.
  actions: { RUN: [0, 5, 0] },
};

type ParticleMotion = 0 | 1 | 2 | 3;

interface ClassicBuffResources {
  readonly protectionTexture: THREE.Texture;
  readonly slowTexture: THREE.Texture;
  readonly strengthTexture: THREE.Texture;
  readonly streamTexture: THREE.Texture;
  readonly rayTexture: THREE.Texture;
  readonly streamGeometry704: THREE.BufferGeometry;
  readonly streamGeometry705: THREE.BufferGeometry;
  readonly protectorLease: ClassicSkinnedInstanceLease;
  readonly protectorMaterials: THREE.Material[];
}

interface BuffParticle {
  readonly sprite: THREE.Sprite;
  readonly start: THREE.Vector3;
  active: boolean;
  elapsed: number;
  lifetime: number;
  serial: number;
  baseWidth: number;
  baseHeight: number;
  scaleVelocity: number;
  color: number;
  motion: ParticleMotion;
  verticalDistance: number;
  horizontalDistance: number;
  circleSpeed: number;
}

interface SlowSlashController {
  readonly feet: THREE.Vector3;
  readonly targetFeet: THREE.Vector3;
  active: boolean;
  elapsed: number;
  nextEmission: number;
  serial: number;
}

interface StreamPair {
  readonly root: THREE.Group;
  readonly scale: number;
  readonly heightOffset: number;
  readonly yawOffset: number;
}

interface MutableBuffVisualContext {
  readonly ownerFeet: THREE.Vector3;
  readonly ownerSkinAnchor: THREE.Vector3;
  ownerClassicYaw: number;
  ownerScale: number;
  mounted: boolean;
  elementalProtection: boolean;
  elementalStrength: boolean;
}

/**
 * Bounded presentation port of BeastMaster #53/#54.
 *
 * #53 owns TMEffectSkinMesh skin 32 plus its texture-0 cast/trail billboards.
 * #54 owns TMSkillHaste, SlowSlash and the persistent models 704/705 stream.
 * Positions accepted by the public API are logical actor feet in world space.
 */
export class ClassicBeastMasterBuffEffects {
  readonly object = new THREE.Group();
  readonly #parent: THREE.Object3D;
  readonly #dds = new ClassicDdsTextureLoader();
  readonly #protectorRoot = new THREE.Group();
  readonly #streamRoot = new THREE.Group();
  readonly #protectionCastPool: BuffParticle[] = [];
  readonly #protectionTrailPool: BuffParticle[] = [];
  readonly #strengthCastPool: BuffParticle[] = [];
  readonly #strengthRayPool: BuffParticle[] = [];
  readonly #strengthSlowPool: BuffParticle[] = [];
  readonly #slowControllers: SlowSlashController[] = [];
  readonly #streamPairs: StreamPair[] = [];
  #streamMaterial: THREE.MeshBasicMaterial | null = null;
  #resources: ClassicBuffResources | null = null;
  #preload: Promise<void> | null = null;
  #context: MutableBuffVisualContext | null = null;
  #protectionActive = false;
  #strengthActive = false;
  #protectorPhase = 0;
  #protectionEmissionAccumulator = 0;
  #strengthTriggerAccumulator = 0;
  #streamElapsed = STREAM_LINGER_SECONDS;
  #streamAlive = false;
  #serial = 0;
  #randomSerial = 0;
  #enabled = true;
  #disposed = false;

  constructor(parent: THREE.Object3D) {
    this.#parent = parent;
    this.object.name = "classic-beastmaster-buff-effects";
    this.#protectorRoot.name = "classic-elemental-protection-skin-32";
    this.#streamRoot.name = "classic-elemental-strength-stream-704-705";
    this.#protectorRoot.visible = false;
    this.#streamRoot.visible = false;
    this.object.add(this.#protectorRoot, this.#streamRoot);
    parent.add(this.object);
  }

  /** Loads effect textures 0/2/56/99/122, models 704/705 and ag010101. */
  async prepareClassic(assets: ClassicAssetSource): Promise<void> {
    if (this.#disposed || this.#resources) return;
    if (this.#preload) return this.#preload;

    const job = this.loadClassicResources(assets)
      .then((resources) => {
        if (this.#disposed) {
          disposeClassicResources(resources);
          return;
        }
        try {
          this.installClassicResources(resources);
          this.#resources = resources;
        } catch (error) {
          disposeClassicResources(resources);
          throw error;
        }
      })
      .catch((error: unknown) => {
        console.warn("Buffs clássicos 53/54 do BeastMaster indisponíveis.", error);
      })
      .finally(() => {
        this.#preload = null;
      });
    this.#preload = job;
    return job;
  }

  /** Plays the retail one-shot cast controller for #53 or #54. */
  playCast(index: BeastMasterBuffIndex, ownerFeet: THREE.Vector3): boolean {
    if (
      this.#disposed
      || !this.#enabled
      || !this.#resources
      || !isFiniteVector(ownerFeet)
    ) {
      return false;
    }
    if (index === 53) this.playProtectionCast(ownerFeet);
    else if (index === 54) this.playStrengthCast(ownerFeet);
    else return false;
    return true;
  }

  /** Copies mutable actor state; no caller-owned vector is retained. */
  syncPersistentBuffs(context: BeastMasterBuffVisualContext | null): void {
    if (this.#disposed) return;
    if (!context || !isFiniteContext(context)) {
      this.stopPersistentVisuals(true);
      this.#context = null;
      return;
    }

    if (!this.#context) {
      this.#context = {
        ownerFeet: context.ownerFeet.clone(),
        ownerSkinAnchor: context.ownerSkinAnchor.clone(),
        ownerClassicYaw: context.ownerClassicYaw,
        ownerScale: context.ownerScale,
        mounted: context.mounted,
        elementalProtection: false,
        elementalStrength: false,
      };
    } else {
      this.#context.ownerFeet.copy(context.ownerFeet);
      this.#context.ownerSkinAnchor.copy(context.ownerSkinAnchor);
      this.#context.ownerClassicYaw = context.ownerClassicYaw;
      this.#context.ownerScale = context.ownerScale;
      this.#context.mounted = context.mounted;
    }

    this.#context.elementalProtection = context.elementalProtection;
    this.#context.elementalStrength = context.elementalStrength;
    const nextProtection = this.#enabled && context.elementalProtection;
    const nextStrength = this.#enabled && context.elementalStrength;

    if (nextProtection && !this.#protectionActive) {
      this.#protectorPhase = initialProtectorPhase(context.ownerFeet.x);
      // TMEffectSkinMesh emits on its first FrameMove.
      this.#protectionEmissionAccumulator = PROTECTOR_TRAIL_INTERVAL_SECONDS;
    }
    if (!nextProtection && this.#protectionActive) this.#protectorRoot.visible = false;

    if (nextStrength && !this.#strengthActive) {
      // TMHuman's 250 ms gate has an old zero timestamp on first activation.
      this.#strengthTriggerAccumulator = STRENGTH_TRIGGER_INTERVAL_SECONDS;
    }

    this.#protectionActive = nextProtection;
    this.#strengthActive = nextStrength;
  }

  update(deltaSeconds: number): void {
    if (this.#disposed || !this.#enabled) return;
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    if (delta <= 0) return;

    this.updateParticlePool(this.#protectionCastPool, delta);
    this.updateParticlePool(this.#protectionTrailPool, delta);
    this.updateParticlePool(this.#strengthCastPool, delta);
    this.updateParticlePool(this.#strengthRayPool, delta);
    this.updateParticlePool(this.#strengthSlowPool, delta);
    this.updateSlowControllers(delta);

    this.updateProtector(delta);
    this.updateStrengthStream(delta);
  }

  setEnabled(enabled: boolean): void {
    if (this.#disposed || this.#enabled === enabled) return;
    this.#enabled = enabled;
    this.object.visible = enabled;
    if (!enabled) this.clear();
  }

  clear(): void {
    for (const pool of this.particlePools()) {
      for (const particle of pool) deactivateParticle(particle);
    }
    for (const controller of this.#slowControllers) deactivateSlowController(controller);
    this.stopPersistentVisuals(true);
    this.#context = null;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clear();
    this.#parent.remove(this.object);

    for (const pool of this.particlePools()) {
      for (const particle of pool) particle.sprite.material.dispose();
      pool.length = 0;
    }
    this.#slowControllers.length = 0;
    this.#streamMaterial?.dispose();
    this.#streamMaterial = null;
    this.#streamPairs.length = 0;
    this.#streamRoot.clear();
    this.#protectorRoot.clear();
    if (this.#resources) disposeClassicResources(this.#resources);
    this.#resources = null;
    this.object.clear();
  }

  private playProtectionCast(ownerFeet: THREE.Vector3): void {
    const resources = this.#resources!;
    for (let index = 0; index < 5; index++) {
      const randomSerial = ++this.#randomSerial;
      const nRand = classicRandomStep(randomSerial, 0, 10) + 10;
      const addedScale = index * 0.3;
      const position = ownerFeet.clone();
      position.x += (classicRandomStep(randomSerial, 1, 10) - 5) * 0.02;
      position.z -= (classicRandomStep(randomSerial, 2, 10) - 5) * 0.02;
      this.spawnParticle(
        this.#protectionCastPool,
        PROTECTION_CAST_POOL_LIMIT,
        resources.protectionTexture,
        "classic-elemental-protection-cast-texture-0",
        {
          position,
          lifetime: 1.2 + index * 0.2,
          baseWidth: nRand * 0.1 + 0.6 + addedScale,
          baseHeight: nRand * 0.3 + 0.6 + addedScale,
          scaleVelocity: 0.1,
          color: 0xffffff,
          motion: 1,
          verticalDistance: 2,
          horizontalDistance: 0,
          circleSpeed: 0,
          rotation: 0,
        },
      );
    }
  }

  private playStrengthCast(ownerFeet: THREE.Vector3): void {
    const resources = this.#resources!;
    for (let index = 0; index < 15; index++) {
      const randomSerial = ++this.#randomSerial;
      const offset = (classicRandomStep(randomSerial, 0, 5) - 3) * 0.1;
      const position = ownerFeet.clone();
      position.x += offset;
      position.y += offset + 5;
      // Classic +Z maps to scene -Z.
      position.z -= offset;
      this.spawnParticle(
        this.#strengthCastPool,
        STRENGTH_CAST_POOL_LIMIT,
        resources.strengthTexture,
        "classic-elemental-strength-haste-texture-56",
        {
          position,
          lifetime: 2 + index * 0.3,
          baseWidth: index % 2 === 0 ? 0.1 : 0.2,
          baseHeight: index % 2 === 0 ? 0.1 : 0.2,
          scaleVelocity: 0,
          color: STRENGTH_COLOR,
          motion: 3,
          verticalDistance: -7,
          horizontalDistance: 0.1 + index % 3 * 0.05,
          circleSpeed: 6,
          rotation: 0,
        },
      );
    }

    const rayPosition = ownerFeet.clone();
    rayPosition.y += 2;
    this.spawnParticle(
      this.#strengthRayPool,
      STRENGTH_RAY_POOL_LIMIT,
      resources.rayTexture,
      "classic-elemental-strength-ray-texture-122",
      {
        position: rayPosition,
        lifetime: 4,
        baseWidth: 1.5,
        baseHeight: 10,
        scaleVelocity: 0,
        color: STRENGTH_COLOR,
        motion: 0,
        verticalDistance: 0,
        horizontalDistance: 0,
        circleSpeed: 0,
        rotation: 2.792527,
      },
    );
  }

  private updateProtector(delta: number): void {
    const resources = this.#resources;
    const context = this.#context;
    if (!resources || !context || !this.#protectionActive) {
      this.#protectorRoot.visible = false;
      return;
    }

    this.#protectorPhase = (
      this.#protectorPhase
      + delta * Math.PI * 2 / PROTECTOR_ORBIT_PERIOD_SECONDS
    ) % (Math.PI * 2);
    // Player exposes the TMSkinMesh yaw. TMHuman keeps the opposite sign in
    // m_fAngle, and motion type 5 uses that human angle for both following and
    // the effect skin's own TMObject::SetAngle call.
    const ownerHumanAngle = -context.ownerClassicYaw;
    const behindAngle = ownerHumanAngle - Math.PI;
    const classicOffsetX = Math.cos(behindAngle) * PROTECTOR_FOLLOW_DISTANCE
      + Math.cos(this.#protectorPhase) * PROTECTOR_ORBIT_RADIUS;
    const classicOffsetY = Math.sin(behindAngle) * PROTECTOR_FOLLOW_DISTANCE
      + Math.sin(this.#protectorPhase) * PROTECTOR_ORBIT_RADIUS;
    this.#protectorRoot.position.set(
      context.ownerFeet.x + classicOffsetX,
      context.ownerFeet.y + context.ownerScale * 2
        + Math.sin(this.#protectorPhase) * PROTECTOR_BOB_HEIGHT,
      context.ownerFeet.z - classicOffsetY,
    );
    this.#protectorRoot.visible = true;
    resources.protectorLease.model.setClassicTransform({
      yaw: ownerHumanAngle,
      scale: PROTECTOR_MODEL_SCALE,
      mirrorModelZ: true,
    });
    resources.protectorLease.model.update(Math.min(delta, 0.1));

    this.#protectionEmissionAccumulator += delta;
    if (this.#protectionEmissionAccumulator < PROTECTOR_TRAIL_INTERVAL_SECONDS) return;
    // Retail emits once per FrameMove and never catches up after a stall.
    this.#protectionEmissionAccumulator %= PROTECTOR_TRAIL_INTERVAL_SECONDS;
    this.spawnProtectionTrail(this.#protectorRoot.position);
  }

  private spawnProtectionTrail(protectorPosition: THREE.Vector3): void {
    const resources = this.#resources;
    if (!resources) return;
    const randomSerial = ++this.#randomSerial;
    const nRand = classicRandomStep(randomSerial, 2, 5);
    const position = protectorPosition.clone();
    position.x += (classicRandomStep(randomSerial, 0, 10) - 5) * 0.02;
    position.z -= (classicRandomStep(randomSerial, 1, 10) - 5) * 0.02;
    this.spawnParticle(
      this.#protectionTrailPool,
      PROTECTION_TRAIL_POOL_LIMIT,
      resources.protectionTexture,
      "classic-elemental-protection-trail-texture-0",
      {
        position,
        lifetime: 1.5,
        // TMEffectSkinMesh reuses the same rand()%5 for both dimensions.
        baseWidth: (nRand + 1) * 0.01,
        baseHeight: nRand * 0.1 + 0.01,
        scaleVelocity: 0.1,
        color: PROTECTION_TRAIL_COLOR,
        motion: 1,
        verticalDistance: -0.5,
        horizontalDistance: 0,
        circleSpeed: 0,
        rotation: 0,
      },
    );
  }

  private updateStrengthStream(delta: number): void {
    const context = this.#context;
    if (context && this.#strengthActive && this.#resources) {
      this.#strengthTriggerAccumulator += delta;
      if (this.#strengthTriggerAccumulator > STRENGTH_TRIGGER_INTERVAL_SECONDS) {
        // TMHuman stores the current tick instead of consuming every missed
        // interval, so a background frame cannot create a catch-up burst.
        this.#strengthTriggerAccumulator = 0;
        this.activateSlowController(context.ownerFeet);
        this.#streamElapsed = 0;
        this.#streamAlive = true;
      }
    }

    if (!this.#streamAlive || !context || !this.#resources) {
      this.hideStream();
      return;
    }

    this.#streamElapsed += delta;
    if (!this.#strengthActive && this.#streamElapsed >= STREAM_LINGER_SECONDS) {
      this.#streamAlive = false;
      this.hideStream();
      return;
    }

    const progress = THREE.MathUtils.clamp(this.#streamElapsed / STREAM_LINGER_SECONDS, 0, 1);
    const fade = Math.max(0, Math.sin(progress * Math.PI));
    const anchor = context.mounted ? context.ownerSkinAnchor : context.ownerFeet;
    this.#streamRoot.position.set(anchor.x, anchor.y - 0.3, anchor.z);
    this.#streamRoot.visible = progress >= PARTICLE_VISIBLE_FRACTION;
    if (this.#streamMaterial) {
      this.#streamMaterial.color.setRGB(fade, fade, fade);
      // The classic vertex rewrite fades RGB; texture alpha remains intact.
      this.#streamMaterial.opacity = 1;
    }

    const streamAngle = progress * Math.PI * 2;
    const mountScale = context.mounted ? 1.5 : 1;
    for (const pair of this.#streamPairs) {
      const sourceYaw = -streamAngle + pair.yawOffset;
      pair.root.position.set(0, pair.heightOffset, 0);
      pair.root.rotation.set(Math.PI / 2, -sourceYaw, Math.PI / 2, "YXZ");
      const horizontalScale = pair.scale * mountScale;
      // TMMesh mutates m_fScaleH only; classic vertical scale stays at 1.
      pair.root.scale.set(horizontalScale, 1, horizontalScale);
      pair.root.visible = this.#streamRoot.visible;
    }
  }

  private activateSlowController(ownerFeet: THREE.Vector3): void {
    let controller = this.#slowControllers.find((entry) => !entry.active);
    if (!controller && this.#slowControllers.length < SLOW_CONTROLLER_POOL_LIMIT) {
      controller = {
        feet: new THREE.Vector3(),
        targetFeet: new THREE.Vector3(),
        active: false,
        elapsed: 0,
        nextEmission: 0,
        serial: 0,
      };
      this.#slowControllers.push(controller);
    }
    if (!controller) {
      controller = oldestBySerial(this.#slowControllers);
      deactivateSlowController(controller);
    }
    controller.active = true;
    controller.elapsed = 0;
    controller.nextEmission = SLOW_PARTICLE_INTERVAL_SECONDS;
    controller.serial = ++this.#serial;
    controller.feet.copy(ownerFeet);
    controller.targetFeet.copy(ownerFeet);
    // m_dwOldTime starts at zero: the first SlowSlash billboard is immediate.
    this.spawnSlowSlashParticle(controller.feet);
  }

  private updateSlowControllers(delta: number): void {
    for (const controller of this.#slowControllers) {
      if (!controller.active) continue;
      controller.elapsed += delta;
      if (controller.elapsed >= SLOW_CONTROLLER_LIFETIME_SECONDS) {
        deactivateSlowController(controller);
        continue;
      }

      // The first half follows its owner; the second returns to the constructor
      // target captured when this 250 ms controller was created.
      if (controller.elapsed <= 1 && this.#context) {
        controller.feet.copy(this.#context.ownerFeet);
      } else if (controller.elapsed > 1) {
        // TMSkillSlowSlash drops m_pOwner at 50% and uses the constructor's
        // vecTarget (not the owner's last sampled position) thereafter.
        controller.feet.copy(controller.targetFeet);
      }
      if (controller.elapsed > controller.nextEmission) {
        this.spawnSlowSlashParticle(controller.feet);
        controller.nextEmission += SLOW_PARTICLE_INTERVAL_SECONDS;
      }
    }
  }

  private spawnSlowSlashParticle(feet: THREE.Vector3): void {
    const resources = this.#resources;
    if (!resources) return;
    const randomSerial = ++this.#randomSerial;
    // Retail consumes one rand() and derives all three values from it.
    const nRand = classicRandomStep(randomSerial, 0, 32_768);
    const position = feet.clone();
    position.x += (nRand % 5 + 1) * 0.1;
    position.z -= nRand % 5 * 0.1;
    this.spawnParticle(
      this.#strengthSlowPool,
      STRENGTH_SLOW_POOL_LIMIT,
      resources.slowTexture,
      "classic-elemental-strength-slow-slash-texture-2",
      {
        position,
        lifetime: 2,
        baseWidth: 0.02,
        baseHeight: 0.02,
        scaleVelocity: 0.1,
        color: STRENGTH_COLOR,
        motion: (nRand % 3 + 1) as 1 | 2 | 3,
        verticalDistance: 1.5,
        horizontalDistance: 1.2,
        circleSpeed: 3,
        rotation: 0,
      },
    );
  }

  private spawnParticle(
    pool: BuffParticle[],
    limit: number,
    texture: THREE.Texture,
    name: string,
    options: {
      readonly position: THREE.Vector3;
      readonly lifetime: number;
      readonly baseWidth: number;
      readonly baseHeight: number;
      readonly scaleVelocity: number;
      readonly color: number;
      readonly motion: ParticleMotion;
      readonly verticalDistance: number;
      readonly horizontalDistance: number;
      readonly circleSpeed: number;
      readonly rotation: number;
    },
  ): void {
    let particle = pool.find((entry) => !entry.active);
    if (!particle && pool.length < limit) {
      particle = createParticle(texture, `${name}-${pool.length}`);
      pool.push(particle);
      this.object.add(particle.sprite);
    }
    if (!particle) {
      particle = oldestBySerial(pool);
      deactivateParticle(particle);
    }

    particle.active = true;
    particle.elapsed = 0;
    particle.lifetime = options.lifetime;
    particle.serial = ++this.#serial;
    particle.baseWidth = options.baseWidth;
    particle.baseHeight = options.baseHeight;
    particle.scaleVelocity = options.scaleVelocity;
    particle.color = options.color;
    particle.motion = options.motion;
    particle.verticalDistance = options.verticalDistance;
    particle.horizontalDistance = options.horizontalDistance;
    particle.circleSpeed = options.circleSpeed;
    particle.start.copy(options.position);
    particle.sprite.position.copy(options.position);
    particle.sprite.scale.set(options.baseWidth, options.baseHeight, 1);
    particle.sprite.material.rotation = options.rotation;
    particle.sprite.material.color.setHex(options.color);
    particle.sprite.material.opacity = 0;
    particle.sprite.visible = false;
  }

  private updateParticlePool(pool: readonly BuffParticle[], delta: number): void {
    for (const particle of pool) {
      if (!particle.active) continue;
      particle.elapsed += delta;
      if (particle.elapsed >= particle.lifetime) {
        deactivateParticle(particle);
        continue;
      }

      const progress = particle.elapsed / particle.lifetime;
      const phase = progress * Math.PI * particle.circleSpeed;
      particle.sprite.position.copy(particle.start);
      particle.sprite.position.y += progress * particle.verticalDistance;
      if (particle.motion >= 2) {
        particle.sprite.position.x += Math.sin(phase) * particle.horizontalDistance;
      }
      if (particle.motion >= 3) {
        particle.sprite.position.z -= Math.cos(phase) * particle.horizontalDistance;
      }
      const width = Math.max(0, particle.baseWidth + particle.scaleVelocity * particle.elapsed);
      const height = Math.max(0, particle.baseHeight + particle.scaleVelocity * particle.elapsed);
      particle.sprite.scale.set(width, height, 1);
      const fade = Math.max(0, Math.sin(progress * Math.PI));
      particle.sprite.material.color.setHex(particle.color).multiplyScalar(fade);
      // EF_BRIGHT selects texture alpha; fading opacity too would square the
      // retail sine curve that is already applied to vertex RGB.
      particle.sprite.material.opacity = 1;
      particle.sprite.visible = progress >= PARTICLE_VISIBLE_FRACTION;
    }
  }

  private installClassicResources(resources: ClassicBuffResources): void {
    isolateProtectorMaterials(resources.protectorLease, resources.protectorMaterials);
    resources.protectorLease.model.setClassicTransform({
      yaw: -Math.PI / 2,
      scale: PROTECTOR_MODEL_SCALE,
      mirrorModelZ: true,
    });
    resources.protectorLease.model.play("RUN");
    resources.protectorLease.model.object.name = "classic-elemental-protector-ag010101";
    this.#protectorRoot.add(resources.protectorLease.model.object);

    this.#streamMaterial = createBrightMeshMaterial(resources.streamTexture);
    for (let index = 0; index < STREAM_YAW_OFFSETS.length; index++) {
      const root = new THREE.Group();
      root.name = `classic-elemental-stream-pair-${index}`;
      root.visible = false;
      const mesh704 = new THREE.Mesh(resources.streamGeometry704, this.#streamMaterial);
      const mesh705 = new THREE.Mesh(resources.streamGeometry705, this.#streamMaterial);
      mesh704.name = `classic-elemental-stream-model-704-${index}`;
      mesh705.name = `classic-elemental-stream-model-705-${index}`;
      mesh704.renderOrder = 8;
      mesh705.renderOrder = 8;
      root.add(mesh704, mesh705);
      this.#streamRoot.add(root);
      this.#streamPairs.push({
        root,
        scale: STREAM_SCALES[index]!,
        heightOffset: STREAM_HEIGHT_OFFSETS[index]!,
        yawOffset: STREAM_YAW_OFFSETS[index]!,
      });
    }
  }

  private async loadClassicResources(assets: ClassicAssetSource): Promise<ClassicBuffResources> {
    const results = await Promise.allSettled([
      this.loadEffectTexture(assets, 0, true),
      this.loadEffectTexture(assets, 2, true),
      this.loadEffectTexture(assets, 56, true),
      this.loadEffectTexture(assets, 99, false),
      this.loadEffectTexture(assets, 122, true),
      loadEffectGeometry(assets, 704),
      loadEffectGeometry(assets, 705),
      loadProtector(assets),
    ] as const);

    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) {
      disposeFulfilled(results[0]);
      disposeFulfilled(results[1]);
      disposeFulfilled(results[2]);
      disposeFulfilled(results[3]);
      disposeFulfilled(results[4]);
      disposeFulfilled(results[5]);
      disposeFulfilled(results[6]);
      if (results[7].status === "fulfilled") results[7].value.release();
      throw failure.reason;
    }

    return {
      protectionTexture: settledValue(results[0]),
      slowTexture: settledValue(results[1]),
      strengthTexture: settledValue(results[2]),
      streamTexture: settledValue(results[3]),
      rayTexture: settledValue(results[4]),
      streamGeometry704: settledValue(results[5]),
      streamGeometry705: settledValue(results[6]),
      protectorLease: settledValue(results[7]),
      protectorMaterials: [],
    };
  }

  private async loadEffectTexture(
    assets: ClassicAssetSource,
    index: 0 | 2 | 56 | 99 | 122,
    billboard: boolean,
  ): Promise<THREE.Texture> {
    const url = assets.effectTextureUrl(index);
    if (!url) throw new Error(`Textura de efeito ${index} ausente do manifesto`);
    const texture = await this.#dds.loadAsync(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    if (billboard) {
      texture.offset.set(0.02, 0.98);
      texture.repeat.set(0.96, -0.96);
    }
    texture.needsUpdate = true;
    return texture;
  }

  private stopPersistentVisuals(clearChildren: boolean): void {
    this.#protectionActive = false;
    this.#strengthActive = false;
    this.#protectionEmissionAccumulator = 0;
    this.#strengthTriggerAccumulator = 0;
    this.#streamElapsed = STREAM_LINGER_SECONDS;
    this.#streamAlive = false;
    this.#protectorRoot.visible = false;
    this.hideStream();
    if (clearChildren) {
      for (const controller of this.#slowControllers) deactivateSlowController(controller);
    }
  }

  private hideStream(): void {
    this.#streamRoot.visible = false;
    for (const pair of this.#streamPairs) pair.root.visible = false;
  }

  private particlePools(): BuffParticle[][] {
    return [
      this.#protectionCastPool,
      this.#protectionTrailPool,
      this.#strengthCastPool,
      this.#strengthRayPool,
      this.#strengthSlowPool,
    ];
  }
}

async function loadProtector(assets: ClassicAssetSource): Promise<ClassicSkinnedInstanceLease> {
  const catalog = await MonsterCatalog.load(assets);
  const library = new ClassicSkinnedAssetLibrary(assets, catalog);
  const lease = await library.createInstance({
    skin: PROTECTOR_SKIN,
    family: PROTECTOR_FAMILY,
    parts: [{
      name: "elemental-protector-ag010101",
      mesh: `${PROTECTOR_ROOT}/ag010101.msh`,
      texture: `${PROTECTOR_ROOT}/ag010101.dds`,
      alpha: "N",
    }],
    actions: ["RUN"],
    initialAction: "RUN",
  });
  if (!lease) throw new Error("Skin 32 ag010101 da Proteção Elemental ausente");
  return lease;
}

async function loadEffectGeometry(
  assets: ClassicAssetSource,
  type: (typeof STREAM_MODEL_TYPES)[number],
): Promise<THREE.BufferGeometry> {
  const source = await assets.loadModel(type);
  if (!source) throw new Error(`Modelo clássico ${type} ausente do manifesto`);
  return parseMsa(source.buffer).geometry;
}

function isolateProtectorMaterials(
  lease: ClassicSkinnedInstanceLease,
  destination: THREE.Material[],
): void {
  for (const mesh of lease.model.meshes) {
    const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const isolated = source.map((material) => {
      const clone = material.clone();
      clone.transparent = true;
      clone.opacity = 1;
      clone.alphaTest = 0;
      clone.depthTest = true;
      clone.depthWrite = false;
      clone.blending = THREE.CustomBlending;
      clone.blendEquation = THREE.AddEquation;
      clone.blendSrc = THREE.SrcAlphaFactor;
      clone.blendDst = THREE.OneFactor;
      clone.blendEquationAlpha = THREE.AddEquation;
      clone.blendSrcAlpha = THREE.SrcAlphaFactor;
      clone.blendDstAlpha = THREE.OneFactor;
      clone.toneMapped = false;
      if (clone instanceof THREE.MeshLambertMaterial || clone instanceof THREE.MeshPhongMaterial) {
        clone.emissive.setRGB(0.3, 0.3, 0.3);
      }
      clone.needsUpdate = true;
      destination.push(clone);
      return clone;
    });
    mesh.material = Array.isArray(mesh.material) ? isolated : isolated[0]!;
    mesh.renderOrder = 8;
  }
}

function createParticle(texture: THREE.Texture, name: string): BuffParticle {
  const material = new THREE.SpriteMaterial({
    map: texture,
    color: 0xffffff,
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
    lifetime: 1,
    serial: 0,
    baseWidth: 1,
    baseHeight: 1,
    scaleVelocity: 0,
    color: 0xffffff,
    motion: 0,
    verticalDistance: 0,
    horizontalDistance: 0,
    circleSpeed: 0,
  };
}

function createBrightMeshMaterial(texture: THREE.Texture): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: 0xffffff,
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
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
  material.forceSinglePass = true;
  return material;
}

function deactivateParticle(particle: BuffParticle): void {
  particle.active = false;
  particle.elapsed = 0;
  particle.sprite.visible = false;
  particle.sprite.material.opacity = 0;
}

function deactivateSlowController(controller: SlowSlashController): void {
  controller.active = false;
  controller.elapsed = 0;
  controller.nextEmission = 0;
}

function oldestBySerial<T extends { readonly serial: number }>(entries: readonly T[]): T {
  const first = entries[0];
  if (!first) throw new Error("Pool clássico vazio");
  let oldest = first;
  for (let index = 1; index < entries.length; index++) {
    const candidate = entries[index]!;
    if (candidate.serial < oldest.serial) oldest = candidate;
  }
  return oldest;
}

function initialProtectorPhase(ownerX: number): number {
  const normalized = (((ownerX * 100) % 1_000) + 1_000) % 1_000;
  return normalized / 1_000 * Math.PI * 2;
}

function classicRandomStep(serial: number, lane: number, modulus: number): number {
  const seed = Math.imul(serial + lane * 0x9e37, 1_103_515_245) + 12_345;
  return (seed >>> 16) % modulus;
}

function isFiniteVector(value: THREE.Vector3): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function isFiniteContext(context: BeastMasterBuffVisualContext): boolean {
  return isFiniteVector(context.ownerFeet)
    && isFiniteVector(context.ownerSkinAnchor)
    && Number.isFinite(context.ownerClassicYaw)
    && Number.isFinite(context.ownerScale);
}

function settledValue<T>(result: PromiseSettledResult<T>): T {
  if (result.status === "rejected") throw result.reason;
  return result.value;
}

function disposeFulfilled<T extends { dispose(): void }>(result: PromiseSettledResult<T>): void {
  if (result.status === "fulfilled") result.value.dispose();
}

function disposeClassicResources(resources: ClassicBuffResources): void {
  resources.protectorLease.release();
  for (const material of resources.protectorMaterials) material.dispose();
  resources.streamGeometry704.dispose();
  resources.streamGeometry705.dispose();
  resources.protectionTexture.dispose();
  resources.slowTexture.dispose();
  resources.strengthTexture.dispose();
  resources.streamTexture.dispose();
  resources.rayTexture.dispose();
}
