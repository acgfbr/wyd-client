import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { parseMsa } from "../../formats/classic/Msa";
import type { ClassicWeaponEffectSegmentSample } from "../../game/player/ClassicPlayerAvatar";
import type { ClassicSkinnedAfterimage } from "../characters/ClassicSkinnedAfterimage";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";
import { ClassicSlowSlashEffects } from "./ClassicBeastMasterWeakenEffects";

export type ClassicTransKnightAttackIndex = 0 | 1 | 2 | 4 | 6 | 7 | 8 | 10 | 12 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23;
export type ClassicTransKnightBuffIndex = 3 | 5 | 11 | 13 | 200;
export type ClassicTransKnightSkillIndex =
  | ClassicTransKnightAttackIndex
  | ClassicTransKnightBuffIndex;

const BILLBOARD_POOL_LIMIT = 384;
const GROUND_POOL_LIMIT = 96;
const DOUBLE_SWING_POOL_LIMIT = 16;
const START_POOL_LIMIT = 16;
const FREEZE_POOL_LIMIT = 48;
const JUDGEMENT_POOL_LIMIT = 16;
const CRITICAL_ARMOR_POOL_LIMIT = 16;
const SPARK_POOL_LIMIT = 16;
const DESTINY_POOL_LIMIT = 32;
const FLAMING_SWORD_EMITTER_LIMIT = 8;
const BASH_POOL_LIMIT = 8;
const BASH_EXPLOSION_POOL_LIMIT = 8;
const BASH_FIRE_EMITTER_POOL_LIMIT = 128;
const BILLBOARD_VISIBLE_FRACTION = 0.05;

const DUST_LIFETIMES_SECONDS = [1.5, 1.9, 2.3, 2.7, 3.1, 3.5, 3.9, 4.3, 4.7, 5.1] as const;
const HOLY_COLUMN_LIFETIMES_SECONDS = [1.5, 1.9, 2.3, 2.7] as const;
const HOLY_COLUMN_OFFSETS = [
  [-1, -1],
  [0, 0],
  [-0.5, -0.5],
  [-0.5, -0.5],
] as const;
const HOLY_PARTICLE_LIFETIMES_SECONDS = [2, 2.3, 2.6, 2.9, 3.2, 3.5, 3.8, 4.1, 4.4, 4.7] as const;
const HASTE_PARTICLE_LIFETIMES_SECONDS = [
  2, 2.3, 2.6, 2.9, 3.2, 3.5, 3.8, 4.1, 4.4, 4.7, 5, 5.3, 5.6, 5.9, 6.2,
] as const;
const FREEZE_LIFETIME_SECONDS = 2;
const FREEZE_PARTICLE_INTERVAL_SECONDS = 0.1;
const JUDGEMENT_LIFETIME_SECONDS = 1.5;
const JUDGEMENT_RING_KILL_SECONDS = 0.3;

type EffectTextureIndex = 0 | 2 | 7 | 8 | 11 | 19 | 33 | 54 | 55 | 56 | 60 | 91 | 122 | 128 | 416;
type BillboardMotion = "static" | "rise" | "rise-sine" | "fall-orbit";

interface ClassicTransKnightResources {
  readonly judgementGeometry: THREE.BufferGeometry;
  readonly doubleSwingGeometry: THREE.BufferGeometry;
  readonly startGeometry: THREE.BufferGeometry;
  readonly freezeGeometry: THREE.BufferGeometry;
  readonly freezeStormGeometry: THREE.BufferGeometry;
  readonly criticalArmorGeometry: THREE.BufferGeometry;
  readonly destinyGeometry: THREE.BufferGeometry;
  readonly judgementModelTexture: THREE.Texture;
  readonly particleTexture: THREE.Texture;
  readonly slopeTexture: THREE.Texture;
  readonly shadeTexture: THREE.Texture;
  readonly iceTexture: THREE.Texture;
  readonly holyColumnTexture: THREE.Texture;
  readonly startTexture: THREE.Texture;
  readonly holyRingTexture: THREE.Texture;
  readonly magicParticleTexture: THREE.Texture;
  readonly assaultFlameTexture: THREE.Texture;
  readonly criticalArmorTexture: THREE.Texture;
  readonly destinyModelTexture: THREE.Texture;
  readonly destinyImpactTexture: THREE.Texture;
  readonly fireTexture: THREE.Texture;
  readonly destinyBeamTexture: THREE.Texture;
  readonly flamingSwordTexture: THREE.Texture;
  readonly doubleSwingTexture: THREE.Texture;
  readonly hasteRayTexture: THREE.Texture;
  readonly sparkTexture: THREE.Texture;
  readonly judgementRingTexture: THREE.Texture;
}

interface BillboardVisual {
  readonly sprite: THREE.Sprite;
  readonly basePosition: THREE.Vector3;
  active: boolean;
  elapsed: number;
  lifetime: number;
  serial: number;
  textureIndex: EffectTextureIndex;
  baseScaleX: number;
  baseScaleY: number;
  scaleVelocityX: number;
  scaleVelocityY: number;
  stickGround: boolean;
  color: number;
  fade: boolean;
  motion: BillboardMotion;
  motionHeight: number;
  motionDistance: number;
}

interface GroundVisual {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly basePosition: THREE.Vector3;
  active: boolean;
  elapsed: number;
  lifetime: number;
  killAt: number;
  serial: number;
  textureIndex: EffectTextureIndex;
  baseScale: number;
  scaleVelocity: number;
  color: number;
  fade: boolean;
  delayed: boolean;
}

interface DoubleSwingVisual {
  readonly root: THREE.Group;
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly shade: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly start: THREE.Vector3;
  readonly destination: THREE.Vector3;
  readonly direction: THREE.Vector3;
  active: boolean;
  elapsed: number;
  lifetime: number;
  nextEmission: number;
  serial: number;
  level: 0 | 1;
}

interface StartVisual {
  readonly root: THREE.Group;
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  active: boolean;
  elapsed: number;
  serial: number;
}

interface FreezeVisual {
  readonly root: THREE.Group;
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly ring: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  active: boolean;
  elapsed: number;
  serial: number;
  type: 0 | 1;
}

interface JudgementVisual {
  readonly root: THREE.Group;
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly rings: readonly [
    THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
    THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
  ];
  active: boolean;
  elapsed: number;
  serial: number;
}

interface CriticalArmorVisual {
  readonly root: THREE.Group;
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  active: boolean;
  elapsed: number;
  serial: number;
}

interface SparkSegmentVisual {
  readonly root: THREE.Group;
  readonly planes: readonly [
    THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
    THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
  ];
  readonly shade: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
}

interface SparkVisual {
  readonly root: THREE.Group;
  readonly segments: readonly SparkSegmentVisual[];
  readonly start: THREE.Vector3;
  readonly end: THREE.Vector3;
  active: boolean;
  elapsed: number;
  serial: number;
  followTarget: (() => THREE.Vector3 | null) | null;
}

interface DestinyVisual {
  readonly root: THREE.Group;
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly beamRoot: THREE.Group;
  readonly beamPlanes: readonly [
    THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
    THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
  ];
  readonly start: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly current: THREE.Vector3;
  active: boolean;
  elapsed: number;
  lifetime: number;
  nextEmission: number;
  targetGroundY: number;
  serial: number;
  onImpact: (() => void) | null;
}

interface FlamingSwordEmitter {
  readonly segments: ClassicWeaponEffectSegmentSample[];
  active: boolean;
  elapsed: number;
  duration: number;
  nextEmission: number;
  serial: number;
  sample: ((out: ClassicWeaponEffectSegmentSample[]) => number) | null;
}

interface BashVisual {
  readonly position: THREE.Vector3;
  active: boolean;
  elapsed: number;
  nextEmission: number;
  serial: number;
  onPulse: (() => void) | null;
  onExplosion: (() => void) | null;
}

interface BashExplosionVisual {
  readonly position: THREE.Vector3;
  active: boolean;
  elapsed: number;
  nextEmission: number;
  serial: number;
}

interface BashFireEmitter {
  readonly position: THREE.Vector3;
  active: boolean;
  elapsed: number;
  nextEmission: number;
  serial: number;
}

interface FanaticismVisual {
  readonly afterimage: ClassicSkinnedAfterimage;
  elapsed: number;
  lifetime: number;
  baseY: number;
  risePerSecond: number;
}

export interface ClassicTransKnightOwnerContext {
  readonly skinAnchor: THREE.Vector3;
  readonly mounted: boolean;
  readonly scale: number;
  readonly classicYaw: number;
}

export interface ClassicTransKnightPersistentBuffs extends ClassicTransKnightOwnerContext {
  readonly ownerFeet: THREE.Vector3;
  readonly possessed: boolean;
}

interface BillboardOptions {
  readonly position: THREE.Vector3;
  readonly textureIndex: EffectTextureIndex;
  readonly lifetime: number;
  readonly baseScaleX: number;
  readonly baseScaleY?: number;
  readonly scaleVelocityX?: number;
  readonly scaleVelocityY?: number;
  readonly stickGround?: boolean;
  readonly color: number;
  readonly fade?: boolean;
  readonly motion?: BillboardMotion;
  readonly motionHeight?: number;
  readonly motionDistance?: number;
  readonly rotation?: number;
}

interface GroundOptions {
  readonly position: THREE.Vector3;
  readonly textureIndex: EffectTextureIndex;
  readonly lifetime: number;
  readonly killAt?: number;
  readonly baseScale: number;
  readonly scaleVelocity?: number;
  readonly color: number;
  readonly fade?: boolean;
  readonly delayed?: boolean;
}

/**
 * Bounded Three.js port of the original TransKnight presentation for records
 * #0/#1/#2/#3/#4/#5/#6/#7/#8/#10/#11/#12/#13/#16/#17/#18/#19/#20/#21/#23.
 *
 * Public positions are actor or target feet in Three.js world space. The
 * retail +0.5/+1.0 attachment offsets are applied internally. Gameplay,
 * damage, buffs and sound remain owned by the caller.
 */
export class ClassicTransKnightSkillEffects {
  readonly object = new THREE.Group();
  readonly #owner: THREE.Object3D;
  readonly #dds = new ClassicDdsTextureLoader();
  readonly #planeGeometry = new THREE.PlaneGeometry(1, 1);
  readonly #fallbackGlow = createFallbackGlowTexture();
  readonly #fallbackDoubleSwingGeometry = new THREE.OctahedronGeometry(0.35, 0);
  readonly #fallbackStartGeometry = new THREE.CylinderGeometry(0.8, 1.2, 2.2, 12, 1, true);
  readonly #fallbackFreezeGeometry = new THREE.ConeGeometry(0.65, 2.4, 6, 1, true);
  readonly #fallbackJudgementGeometry = new THREE.CylinderGeometry(0.7, 0.7, 2.2, 12, 1, true);
  readonly #fallbackCriticalArmorGeometry = new THREE.SphereGeometry(0.85, 12, 8);
  readonly #billboardPool: BillboardVisual[] = [];
  readonly #groundPool: GroundVisual[] = [];
  readonly #doubleSwingPool: DoubleSwingVisual[] = [];
  readonly #startPool: StartVisual[] = [];
  readonly #freezePool: FreezeVisual[] = [];
  readonly #judgementPool: JudgementVisual[] = [];
  readonly #criticalArmorPool: CriticalArmorVisual[] = [];
  readonly #sparkPool: SparkVisual[] = [];
  readonly #destinyPool: DestinyVisual[] = [];
  readonly #flamingSwordEmitters: FlamingSwordEmitter[] = [];
  readonly #bashPool: BashVisual[] = [];
  readonly #bashExplosionPool: BashExplosionVisual[] = [];
  readonly #bashFireEmitterPool: BashFireEmitter[] = [];
  readonly #fanaticismVisuals: FanaticismVisual[] = [];
  readonly #possessedAura: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly #slowSlash: ClassicSlowSlashEffects;
  #resources: ClassicTransKnightResources | null = null;
  #preload: Promise<void> | null = null;
  #serial = 0;
  #randomSerial = 0;
  #clockSeconds = 0;
  #lastFreezeParticleAt = Number.NEGATIVE_INFINITY;
  #enabled = true;
  #disposed = false;

  constructor(scene: THREE.Object3D) {
    this.#owner = scene;
    this.object.name = "classic-transknight-skill-effects";
    this.#possessedAura = new THREE.Mesh(
      this.#fallbackCriticalArmorGeometry,
      createBrightMeshMaterial(this.#fallbackGlow, 0x999999),
    );
    this.#possessedAura.name = "classic-transknight-possessed-persistent-model-2838-texture-413";
    this.#possessedAura.visible = false;
    this.#possessedAura.renderOrder = 8;
    this.object.add(this.#possessedAura);
    this.#slowSlash = new ClassicSlowSlashEffects(this.object);
    scene.add(this.object);
  }

  /** Loads retail models 10/702/703/706/707/2838 and their DDS overrides once. */
  async prepareClassic(assets: ClassicAssetSource): Promise<void> {
    if (this.#disposed || this.#resources) return;
    if (this.#preload) return this.#preload;

    const job = Promise.all([
      this.loadClassicResources(assets),
      this.#slowSlash.prepareClassic(assets),
    ])
      .then(([resources]) => {
        if (this.#disposed) {
          disposeClassicResources(resources);
          return;
        }
        this.#resources = resources;
        for (const visual of this.#billboardPool) this.applyBillboardAsset(visual);
        for (const visual of this.#groundPool) this.applyGroundAsset(visual);
        for (const visual of this.#doubleSwingPool) this.applyDoubleSwingAssets(visual);
        for (const visual of this.#startPool) this.applyStartAssets(visual);
        for (const visual of this.#freezePool) this.applyFreezeAssets(visual);
        for (const visual of this.#judgementPool) this.applyJudgementAssets(visual);
        for (const visual of this.#criticalArmorPool) this.applyCriticalArmorAsset(visual);
        for (const visual of this.#sparkPool) this.applySparkAssets(visual);
        for (const visual of this.#destinyPool) this.applyDestinyAssets(visual);
        this.applyPossessedAuraAsset();
      })
      .catch((error: unknown) => {
        console.warn("Efeitos clássicos do TransKnight indisponíveis; usando fallback.", error);
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
    this.#slowSlash.setEnabled(enabled);
    if (!enabled) this.clear();
  }

  update(deltaSeconds: number): void {
    if (this.#disposed || !this.#enabled) return;
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    if (delta === 0) return;
    this.#clockSeconds += delta;
    this.#slowSlash.update(delta);

    // Independent child billboards advance before controllers emit this frame.
    this.updateBillboards(delta);
    this.updateGroundVisuals(delta);

    for (const visual of this.#doubleSwingPool) {
      if (!visual.active) continue;
      visual.elapsed += delta;
      this.updateDoubleSwingVisual(visual);
    }
    for (const visual of this.#startPool) {
      if (!visual.active) continue;
      visual.elapsed += delta;
      this.updateStartVisual(visual);
    }
    for (const visual of this.#freezePool) {
      if (!visual.active) continue;
      visual.elapsed += delta;
      this.updateFreezeVisual(visual);
    }
    for (const visual of this.#judgementPool) {
      if (!visual.active) continue;
      visual.elapsed += delta;
      this.updateJudgementVisual(visual);
    }
    for (const visual of this.#criticalArmorPool) {
      if (!visual.active) continue;
      visual.elapsed += delta;
      this.updateCriticalArmorVisual(visual);
    }
    for (const visual of this.#sparkPool) {
      if (!visual.active) continue;
      visual.elapsed += delta;
      this.updateSparkVisual(visual);
    }
    for (const visual of this.#destinyPool) {
      if (!visual.active) continue;
      visual.elapsed += delta;
      this.updateDestinyVisual(visual);
    }
    for (const emitter of this.#flamingSwordEmitters) {
      if (!emitter.active) continue;
      emitter.elapsed += delta;
      this.updateFlamingSwordEmitter(emitter);
    }
    this.updateBashVisuals(delta);
    this.updateBashExplosions(delta);
    this.updateBashFireEmitters(delta);
    this.updateFanaticismVisuals(delta);

    // TMSkillFreezeBlade owns one function-static emission timestamp. Four
    // storm blades therefore share a single particle cadence.
    let emittingFreeze: FreezeVisual | undefined;
    for (const visual of this.#freezePool) {
      if (visual.active && (!emittingFreeze || visual.serial < emittingFreeze.serial)) {
        emittingFreeze = visual;
      }
    }
    if (
      emittingFreeze
      && this.#clockSeconds - this.#lastFreezeParticleAt > FREEZE_PARTICLE_INTERVAL_SECONDS
    ) {
      this.spawnFreezeParticle(emittingFreeze.root.position);
      this.#lastFreezeParticleAt = this.#clockSeconds;
    }
  }

  /** Numeric attack dispatch used by the class combat route. */
  playAttack(
    classicIndex: number,
    casterFeet: THREE.Vector3,
    targetFeet: THREE.Vector3,
    followTarget?: () => THREE.Vector3 | null,
  ): boolean {
    switch (classicIndex) {
      case 0:
        this.playHeavensDust(targetFeet);
        return true;
      case 1:
        // TMFieldScene anchors HolyTouch to the acting character, not the
        // selected target used by the neighbouring offensive effects.
        this.playHolyTouch(casterFeet, 0);
        return true;
      case 2:
        this.playDoubleSwing(casterFeet, targetFeet, 0);
        return true;
      case 4:
        // The current-pose clone is captured by GameApp every 300 ms.
        return true;
      case 6:
        this.playDivineFury(casterFeet, targetFeet, followTarget);
        return true;
      case 7:
        this.playDestiny(casterFeet, targetFeet);
        return true;
      case 8:
      case 10:
      case 18:
        // TMHuman's shared branch deliberately owns no VFX object. The
        // caller reproduces EarthQuake(2); ClassicAudio owns sound 160.
        return true;
      case 12:
        this.playDoubleSwing(casterFeet, targetFeet, 1);
        return true;
      case 16:
        // TMHuman creates type-0 TMSkillSlowSlash after the server-side chase
        // has placed the actor on the target cell.
        this.#slowSlash.play(casterFeet, targetFeet, followTarget, 0);
        return true;
      case 17:
        // Requires the live weapon matrix and is dispatched explicitly by
        // GameApp through playFlamingSword.
        return true;
      case 19:
        this.playFreezeBlade(targetFeet, 0);
        return true;
      case 20:
        // Target look/rig ownership is resolved by ClassicSpawnManager.
        return true;
      case 21:
        this.playPoisonStab(targetFeet);
        return true;
      case 22:
        this.playBash(targetFeet);
        return true;
      case 23:
        this.playIceStorm(targetFeet);
        return true;
      default:
        return false;
    }
  }

  /** Numeric self-buff dispatch used by the class combat route. */
  playBuff(
    classicIndex: number,
    ownerFeet: THREE.Vector3,
    context?: ClassicTransKnightOwnerContext,
  ): boolean {
    switch (classicIndex) {
      case 3:
        this.playSamaritan(ownerFeet);
        return true;
      case 5:
        this.playLifeAura(ownerFeet);
        return true;
      case 11:
        this.playAssault(ownerFeet);
        return true;
      case 13:
        this.playPossessedCast(ownerFeet, context);
        return true;
      case 200:
        // Master skill #200 never enters TMHuman's visual event branch.
        // Affect 6 only toggles m_bShield2; the authoritative mitigation
        // formula is intentionally reserved for the server.
        return true;
      default:
        return false;
    }
  }

  /** Convenience dispatch for callers that do not split attack and buff paths. */
  playCast(
    classicIndex: number,
    casterFeet: THREE.Vector3,
    targetFeet: THREE.Vector3 = casterFeet,
    context?: ClassicTransKnightOwnerContext,
  ): boolean {
    return this.playAttack(classicIndex, casterFeet, targetFeet)
      || this.playBuff(classicIndex, casterFeet, context);
  }

  /** #0: ten independently growing texture-0 dust billboards. */
  playHeavensDust(targetWorldPosition: THREE.Vector3): void {
    if (!this.canPlayAt(targetWorldPosition)) return;
    for (let index = 0; index < DUST_LIFETIMES_SECONDS.length; index++) {
      const serial = ++this.#randomSerial;
      const position = targetWorldPosition.clone();
      position.x += (classicRandomStep(serial, 0, 10) - 5) * 0.2;
      position.z += (classicRandomStep(serial, 1, 10) - 5) * 0.2;
      const scale = 0.8 + classicRandomStep(serial, 2, 5) * 0.5;
      this.spawnBillboard({
        position,
        textureIndex: 0,
        lifetime: DUST_LIFETIMES_SECONDS[index]!,
        baseScaleX: scale,
        scaleVelocityX: 1,
        scaleVelocityY: 1,
        stickGround: true,
        color: 0xffaaeeff,
      });
    }
  }

  /** #1 type 0, or the type-1 HolyTouch half used by #3 Samaritano. */
  playHolyTouch(ownerFeet: THREE.Vector3, type: 0 | 1 = 0): void {
    if (!this.canPlayAt(ownerFeet)) return;
    const origin = ownerFeet.clone();
    origin.y += 0.5;

    if (type === 0) {
      for (let index = 0; index < HOLY_COLUMN_OFFSETS.length; index++) {
        const offset = HOLY_COLUMN_OFFSETS[index]!;
        const position = origin.clone();
        // The original nX array is accidentally used for both axes.
        position.x += offset[0];
        position.y -= 1;
        position.z += offset[1];
        this.spawnBillboard({
          position,
          textureIndex: 54,
          lifetime: HOLY_COLUMN_LIFETIMES_SECONDS[index]!,
          baseScaleX: 0.8,
          baseScaleY: 0.8,
          scaleVelocityY: 2 + index,
          stickGround: true,
          color: 0xffaaeeff,
        });
      }

      const ringPosition = origin.clone();
      ringPosition.y += 0.1;
      this.spawnBillboard({
        position: ringPosition,
        textureIndex: 55,
        lifetime: 2,
        baseScaleX: 0.01,
        scaleVelocityX: 3,
        scaleVelocityY: 3,
        color: 0xffaaeeff,
      });

      for (let index = 0; index < HOLY_PARTICLE_LIFETIMES_SECONDS.length; index++) {
        const serial = ++this.#randomSerial;
        const position = origin.clone();
        position.x += (classicRandomStep(serial, 0, 5) - 3) * 0.3;
        position.y += (classicRandomStep(serial, 1, 5) - 3) * 0.1;
        position.z += (classicRandomStep(serial, 2, 5) - 3) * 0.3;
        this.spawnBillboard({
          position,
          textureIndex: 56,
          lifetime: HOLY_PARTICLE_LIFETIMES_SECONDS[index]!,
          baseScaleX: (index % 2) * 0.05 + 0.1,
          color: 0xffffffff,
          motion: index % 2 === 0 ? "rise" : "rise-sine",
          motionHeight: (index % 3) * 0.05 + 0.1,
          motionDistance: 2,
        });
      }
    }

    const slopePosition = origin.clone();
    slopePosition.y += 0.3;
    this.spawnGround({
      position: slopePosition,
      textureIndex: 2,
      lifetime: 2,
      baseScale: 2,
      scaleVelocity: 2,
      color: type === 0 ? 0xffaaaaaa : 0xffaa77ff,
    });

    const shadePosition = ownerFeet.clone();
    shadePosition.y += 0.005;
    this.spawnGround({
      position: shadePosition,
      textureIndex: 7,
      lifetime: 3,
      baseScale: 8,
      color: type === 0 ? 0x55555555 : 0x55553388,
      delayed: false,
    });
  }

  /** #2 level 0 or #12 level 1: model-702 projectile, shade and texture-0 trail. */
  playDoubleSwing(
    casterFeet: THREE.Vector3,
    targetFeet: THREE.Vector3,
    level: 0 | 1 = 0,
  ): void {
    if (!this.canPlayAt(casterFeet) || !isFiniteVector(targetFeet)) return;
    const visual = this.acquireDoubleSwingVisual();
    visual.active = true;
    visual.elapsed = 0;
    visual.nextEmission = 0.1;
    visual.serial = ++this.#serial;
    visual.level = level;
    visual.start.copy(casterFeet);
    visual.start.y += 1;
    visual.destination.copy(targetFeet);
    visual.destination.y += 1;
    visual.direction.subVectors(visual.destination, visual.start);
    const retailDistance = Math.floor(visual.direction.length());
    visual.lifetime = THREE.MathUtils.clamp(retailDistance * 0.3, 0.001, 5);
    visual.root.visible = true;
    visual.mesh.position.copy(visual.start);
    visual.shade.position.set(visual.start.x, casterFeet.y + 0.005, visual.start.z);
    const angle = Math.atan2(visual.direction.x, visual.direction.z) - Math.PI / 2;
    visual.mesh.rotation.set(Math.PI / 2, -angle, Math.PI / 2, "YXZ");
    this.applyDoubleSwingAssets(visual);
    this.spawnDoubleSwingParticle(visual.mesh.position, level);
    this.updateDoubleSwingVisual(visual);
  }

  /** #3: TMSkillHaste type 3 and TMSkillHolyTouch type 1. */
  playSamaritan(ownerFeet: THREE.Vector3): void {
    if (!this.canPlayAt(ownerFeet)) return;
    this.spawnSamaritanHaste(ownerFeet);
    this.playHolyTouch(ownerFeet, 1);
  }

  /** #5: TMEffectStart type 2 using model 703 and effect texture 54. */
  playLifeAura(ownerFeet: THREE.Vector3): void {
    if (!this.canPlayAt(ownerFeet)) return;
    const visual = this.acquireStartVisual();
    visual.active = true;
    visual.elapsed = 0;
    visual.serial = ++this.#serial;
    visual.root.position.copy(ownerFeet);
    visual.root.position.y += 0.5;
    visual.root.visible = true;
    this.applyStartAssets(visual);
    this.updateStartVisual(visual);
  }

  /**
   * #11 Assalto: the two additive fire billboards authored directly in
   * TMHuman's effect-event branch. The classic rand()%5 only changes the
   * second flame's scale and axis angle.
   */
  playAssault(ownerFeet: THREE.Vector3): void {
    if (!this.canPlayAt(ownerFeet)) return;
    const position = ownerFeet.clone();
    position.y += 1.2;
    this.spawnBillboard({
      position,
      textureIndex: 56,
      lifetime: 0.7,
      baseScaleX: 1.6,
      baseScaleY: 1.6,
      scaleVelocityX: 2,
      scaleVelocityY: 2,
      color: 0xff990000,
    });

    const serial = ++this.#randomSerial;
    const randomScale = classicRandomStep(serial, 0, 5);
    this.spawnBillboard({
      position,
      textureIndex: 60,
      lifetime: 1.2,
      baseScaleX: randomScale * 0.3 + 2.6,
      baseScaleY: randomScale * 0.3 + 2.3,
      scaleVelocityX: 0.5,
      scaleVelocityY: 0.5,
      color: 0xff994444,
      rotation: Math.PI * randomScale / 3,
    });
  }

  /**
   * #21 Punhalada Venenosa: TMSkillPoison with the default event level.
   * The server packet may select three alternate colors; the offline loadout
   * has no authoritative effect level and therefore uses retail level 0.
   */
  playPoisonStab(targetFeet: THREE.Vector3): void {
    if (!this.canPlayAt(targetFeet)) return;
    for (let index = 0; index < 10; index++) {
      const serial = ++this.#randomSerial;
      const randomScale = classicRandomStep(serial, 0, 5);
      const position = targetFeet.clone();
      position.x += (classicRandomStep(serial, 1, 10) - 5) * 0.1;
      position.z += (classicRandomStep(serial, 2, 10) - 5) * 0.1;
      this.spawnBillboard({
        position,
        textureIndex: 0,
        lifetime: index * 0.4 + 1.5,
        baseScaleX: randomScale * 0.1 + 0.2,
        scaleVelocityX: 1,
        scaleVelocityY: 1,
        stickGround: true,
        color: 0xff33ff66,
      });
    }
  }

  /**
   * #6 Fúria Divina: TMEffectSpark follows the selected target for 900 ms.
   * Five texture-128 billboard strips form the jagged bolt and five texture-7
   * shades track the segment midpoints on the ground.
   */
  playDivineFury(
    casterFeet: THREE.Vector3,
    targetFeet: THREE.Vector3,
    followTarget?: () => THREE.Vector3 | null,
  ): void {
    if (!this.canPlayAt(casterFeet) || !isFiniteVector(targetFeet)) return;
    const visual = this.acquireSparkVisual();
    visual.active = true;
    visual.elapsed = 0;
    visual.serial = ++this.#serial;
    visual.start.copy(casterFeet);
    visual.start.y += 1;
    visual.end.copy(targetFeet);
    visual.end.y += 1;
    visual.followTarget = followTarget ?? null;
    visual.root.visible = true;
    this.applySparkAssets(visual);
    this.updateSparkVisual(visual);
  }

  /**
   * #7 Destino: a TMArrow type 10001 descends from (+3,+5,-3) to each packet
   * target. Model 2840, the texture-410 beam and the texture-0 wake share the
   * controller's exact 600 ms flight for this fixed retail vector.
   */
  playDestiny(
    casterFeet: THREE.Vector3,
    targetFeet: THREE.Vector3,
    onImpact?: () => void,
  ): void {
    if (!this.canPlayAt(casterFeet) || !isFiniteVector(targetFeet)) return;
    const visual = this.acquireDestinyVisual();
    visual.active = true;
    visual.elapsed = 0;
    visual.lifetime = 0.6;
    visual.nextEmission = 0;
    visual.targetGroundY = targetFeet.y;
    visual.serial = ++this.#serial;
    visual.target.set(targetFeet.x, casterFeet.y + 0.5, targetFeet.z);
    visual.start.copy(visual.target).add(new THREE.Vector3(3, 5, -3));
    visual.current.copy(visual.start);
    visual.onImpact = onImpact ?? null;
    visual.root.visible = true;
    this.applyDestinyAssets(visual);
    this.updateDestinyVisual(visual);
  }

  /** #17: enables TMEffectSWSwing::m_cFireEffect for the remaining attack. */
  playFlamingSword(
    sample: (out: ClassicWeaponEffectSegmentSample[]) => number,
    durationSeconds: number,
  ): void {
    if (this.#disposed || !this.#enabled) return;
    const emitter = this.acquireFlamingSwordEmitter();
    emitter.active = true;
    emitter.elapsed = 0;
    emitter.duration = THREE.MathUtils.clamp(durationSeconds, 0.15, 1.5);
    emitter.nextEmission = 0;
    emitter.serial = ++this.#serial;
    emitter.sample = sample;
    this.updateFlamingSwordEmitter(emitter);
  }

  /** One of Fanatismo's current-pose gray clones (700 ms, motion type 0). */
  playFanaticismAfterimage(afterimage: ClassicSkinnedAfterimage): void {
    if (this.#disposed || !this.#enabled) {
      afterimage.dispose();
      return;
    }
    afterimage.object.position.y += 0.1;
    afterimage.setIntensity(0.5);
    this.object.add(afterimage.object);
    this.#fanaticismVisuals.push({
      afterimage,
      elapsed: 0,
      lifetime: 0.7,
      baseY: afterimage.object.position.y,
      risePerSecond: 0,
    });
  }

  /** #20 target clone: stand animation, gray fade and motion type 1 rise. */
  playSoulAttackAfterimage(afterimage: ClassicSkinnedAfterimage): void {
    if (this.#disposed || !this.#enabled) {
      afterimage.dispose();
      return;
    }
    afterimage.object.position.y += 0.1;
    afterimage.setIntensity(0.5);
    this.object.add(afterimage.object);
    this.#fanaticismVisuals.push({
      afterimage,
      elapsed: 0,
      lifetime: 3,
      baseY: afterimage.object.position.y,
      risePerSecond: 1,
    });
  }

  /** #13 cast event: model 2838, texture 413, type-4 half-second expansion. */
  playPossessedCast(
    ownerFeet: THREE.Vector3,
    context?: ClassicTransKnightOwnerContext,
  ): void {
    if (!this.canPlayAt(ownerFeet)) return;
    const visual = this.acquireCriticalArmorVisual();
    visual.active = true;
    visual.elapsed = 0;
    visual.serial = ++this.#serial;
    visual.root.position.copy(this.criticalArmorCastPosition(ownerFeet, context));
    visual.root.rotation.set(
      Math.PI / 2,
      -(context?.classicYaw ?? 0),
      Math.PI / 2,
      "YXZ",
    );
    visual.root.visible = true;
    this.applyCriticalArmorAsset(visual);
    this.updateCriticalArmorVisual(visual);
  }

  /**
   * AffectType 24 (`m_cCriticalArmor`) keeps the same mesh alive while the
   * buff exists. Its 1.5-second shine cycle is distinct from the cast burst.
   */
  syncPersistentBuffs(options: ClassicTransKnightPersistentBuffs | null): void {
    if (
      this.#disposed
      || !this.#enabled
      || !options?.possessed
      || !isFiniteVector(options.ownerFeet)
      || !isFiniteVector(options.skinAnchor)
    ) {
      this.#possessedAura.visible = false;
      return;
    }
    const scaledPickHeight = 2 * options.scale;
    this.#possessedAura.position.copy(options.mounted ? options.skinAnchor : options.ownerFeet);
    this.#possessedAura.position.y += options.mounted
      ? scaledPickHeight + 1.7
      : scaledPickHeight + 1.3;
    this.#possessedAura.rotation.set(
      Math.PI / 2,
      -options.classicYaw,
      Math.PI / 2,
      "YXZ",
    );
    this.#possessedAura.scale.set(2, 1.5, 2);
    const progress = (this.#clockSeconds % 1.5) / 1.5;
    const shine = Math.sin(progress * Math.PI * 2) * 0.2 + 0.8;
    setFadedColor(this.#possessedAura.material, 0xff999999, shine);
    this.#possessedAura.visible = true;
  }

  /** #19 type 0, or the type-1 blade used by #23. */
  playFreezeBlade(targetFeet: THREE.Vector3, type: 0 | 1 = 0): void {
    if (!this.canPlayAt(targetFeet)) return;
    const visual = this.acquireFreezeVisual();
    visual.active = true;
    visual.elapsed = 0;
    visual.serial = ++this.#serial;
    visual.type = type;
    visual.root.position.copy(targetFeet);
    visual.root.visible = true;
    this.applyFreezeAssets(visual);
    this.updateFreezeVisual(visual);
    if (this.#clockSeconds - this.#lastFreezeParticleAt > FREEZE_PARTICLE_INTERVAL_SECONDS) {
      this.spawnFreezeParticle(visual.root.position);
      this.#lastFreezeParticleAt = this.#clockSeconds;
    }
  }

  /** #23: four model-707 FreezeBlades plus Judgement type 2. */
  playIceStorm(targetFeet: THREE.Vector3): void {
    if (!this.canPlayAt(targetFeet)) return;
    const offsets = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const;
    for (const [x, z] of offsets) {
      const position = targetFeet.clone();
      position.x += x;
      position.z += z;
      this.playFreezeBlade(position, 1);
    }
    this.playJudgement(targetFeet);
  }

  /**
   * #22 Exterminar: bounded port of TMSkillBash(type 1), followed by its
   * TMSkillExplosion2(type 0) destructor effect.
   */
  playBash(
    targetFeet: THREE.Vector3,
    onPulse?: () => void,
    onExplosion?: () => void,
  ): void {
    if (!this.canPlayAt(targetFeet)) return;
    const visual = this.acquireBashVisual();
    visual.active = true;
    visual.elapsed = 0;
    visual.nextEmission = 0;
    visual.serial = ++this.#serial;
    visual.onPulse = onPulse ?? null;
    visual.onExplosion = onExplosion ?? null;
    visual.position.copy(targetFeet);
    visual.position.y += 1;
  }

  clear(): void {
    for (const visual of this.#billboardPool) deactivateBillboard(visual);
    for (const visual of this.#groundPool) deactivateGround(visual);
    for (const visual of this.#doubleSwingPool) deactivateDoubleSwing(visual);
    for (const visual of this.#startPool) deactivateStart(visual);
    for (const visual of this.#freezePool) deactivateFreeze(visual);
    for (const visual of this.#judgementPool) deactivateJudgement(visual);
    for (const visual of this.#criticalArmorPool) deactivateCriticalArmor(visual);
    for (const visual of this.#sparkPool) deactivateSpark(visual);
    for (const visual of this.#destinyPool) deactivateDestiny(visual);
    for (const emitter of this.#flamingSwordEmitters) deactivateFlamingSwordEmitter(emitter);
    for (const visual of this.#bashPool) deactivateBash(visual);
    for (const visual of this.#bashExplosionPool) deactivateTimedEmitter(visual);
    for (const visual of this.#bashFireEmitterPool) deactivateTimedEmitter(visual);
    this.clearFanaticismVisuals();
    this.#slowSlash.clear();
    this.#possessedAura.visible = false;
    this.#lastFreezeParticleAt = Number.NEGATIVE_INFINITY;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clear();
    this.#slowSlash.dispose();
    this.#owner.remove(this.object);

    for (const visual of this.#billboardPool) visual.sprite.material.dispose();
    for (const visual of this.#groundPool) visual.mesh.material.dispose();
    for (const visual of this.#doubleSwingPool) {
      visual.mesh.material.dispose();
      visual.shade.material.dispose();
    }
    for (const visual of this.#startPool) visual.mesh.material.dispose();
    for (const visual of this.#freezePool) {
      visual.mesh.material.dispose();
      visual.ring.material.dispose();
    }
    for (const visual of this.#judgementPool) {
      visual.mesh.material.dispose();
      for (const ring of visual.rings) ring.material.dispose();
    }
    for (const visual of this.#criticalArmorPool) visual.mesh.material.dispose();
    for (const visual of this.#sparkPool) {
      for (const segment of visual.segments) {
        for (const plane of segment.planes) plane.material.dispose();
        segment.shade.material.dispose();
      }
    }
    for (const visual of this.#destinyPool) {
      visual.mesh.material.dispose();
      for (const plane of visual.beamPlanes) plane.material.dispose();
    }
    this.#possessedAura.material.dispose();

    this.#billboardPool.length = 0;
    this.#groundPool.length = 0;
    this.#doubleSwingPool.length = 0;
    this.#startPool.length = 0;
    this.#freezePool.length = 0;
    this.#judgementPool.length = 0;
    this.#criticalArmorPool.length = 0;
    this.#sparkPool.length = 0;
    this.#destinyPool.length = 0;
    this.#flamingSwordEmitters.length = 0;
    this.#bashPool.length = 0;
    this.#bashExplosionPool.length = 0;
    this.#bashFireEmitterPool.length = 0;
    this.#planeGeometry.dispose();
    this.#fallbackGlow.dispose();
    this.#fallbackDoubleSwingGeometry.dispose();
    this.#fallbackStartGeometry.dispose();
    this.#fallbackFreezeGeometry.dispose();
    this.#fallbackJudgementGeometry.dispose();
    this.#fallbackCriticalArmorGeometry.dispose();
    if (this.#resources) disposeClassicResources(this.#resources);
    this.#resources = null;
  }

  private canPlayAt(position: THREE.Vector3): boolean {
    return !this.#disposed && this.#enabled && isFiniteVector(position);
  }

  private acquireSparkVisual(): SparkVisual {
    const free = this.#sparkPool.find((visual) => !visual.active);
    if (free) return free;
    if (this.#sparkPool.length < SPARK_POOL_LIMIT) {
      const root = new THREE.Group();
      root.name = `classic-transknight-divine-fury-${this.#sparkPool.length}`;
      root.visible = false;
      const segments = Array.from({ length: 5 }, (_, segmentIndex): SparkSegmentVisual => {
        const segmentRoot = new THREE.Group();
        segmentRoot.name = `classic-transknight-spark-128-${segmentIndex}`;
        const planes = [0, 1].map((planeIndex) => {
          const plane = new THREE.Mesh(
            this.#planeGeometry,
            createBrightMeshMaterial(this.#fallbackGlow, 0x5555ff),
          );
          plane.name = `classic-transknight-spark-plane-${segmentIndex}-${planeIndex}`;
          plane.rotation.y = planeIndex * Math.PI / 2;
          plane.renderOrder = 9;
          segmentRoot.add(plane);
          return plane;
        }) as [
          THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
          THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
        ];
        const shade = createGroundPlane(
          this.#planeGeometry,
          this.#fallbackGlow,
          `classic-transknight-spark-shade-7-${segmentIndex}`,
        );
        shade.scale.setScalar(1);
        shade.renderOrder = 6;
        root.add(segmentRoot, shade);
        return { root: segmentRoot, planes, shade };
      });
      const visual: SparkVisual = {
        root,
        segments,
        start: new THREE.Vector3(),
        end: new THREE.Vector3(),
        active: false,
        elapsed: 0,
        serial: 0,
        followTarget: null,
      };
      this.#sparkPool.push(visual);
      this.object.add(root);
      return visual;
    }
    const oldest = oldestBySerial(this.#sparkPool);
    deactivateSpark(oldest);
    return oldest;
  }

  private applySparkAssets(visual: SparkVisual): void {
    const sparkTexture = this.#resources?.sparkTexture ?? this.#fallbackGlow;
    const shadeTexture = this.#resources?.shadeTexture ?? this.#fallbackGlow;
    for (const segment of visual.segments) {
      for (const plane of segment.planes) setMaterialMap(plane.material, sparkTexture);
      setMaterialMap(segment.shade.material, shadeTexture);
    }
  }

  private updateSparkVisual(visual: SparkVisual): void {
    if (visual.elapsed >= 0.9) {
      deactivateSpark(visual);
      return;
    }
    const followed = visual.followTarget?.();
    if (followed && isFiniteVector(followed)) {
      visual.end.copy(followed);
      visual.end.y += 1;
    }
    const frame = Math.floor(visual.elapsed * 60);
    const fade = Math.max(0, Math.sin((visual.elapsed / 0.9) * Math.PI));
    const previous = visual.start.clone();
    for (let index = 0; index < visual.segments.length; index++) {
      const progress = (index + 1) / visual.segments.length;
      const next = visual.start.clone().lerp(visual.end, progress);
      if (index < visual.segments.length - 1) {
        const grade = visual.segments.length - index > 2 ? 0.5 : 0.3;
        const randomSeed = visual.serial * 61 + frame;
        next.x += (classicRandomStep(randomSeed, index * 3, 9) - 5) * grade;
        next.y += (classicRandomStep(randomSeed, index * 3 + 1, 9) - 5) * grade;
        next.z += (classicRandomStep(randomSeed, index * 3 + 2, 9) - 5) * grade;
      }
      const segment = visual.segments[index]!;
      const direction = next.clone().sub(previous);
      const length = Math.max(0.001, direction.length());
      segment.root.position.copy(previous).add(next).multiplyScalar(0.5);
      segment.root.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.multiplyScalar(1 / length),
      );
      for (const plane of segment.planes) {
        plane.scale.set(0.8, length, 1);
        setFadedColor(plane.material, 0xff5555ff, fade);
        plane.visible = true;
      }
      segment.shade.position.set(
        (previous.x + next.x) * 0.5,
        Math.min(visual.start.y, visual.end.y) - 0.995,
        (previous.z + next.z) * 0.5,
      );
      segment.shade.scale.set(1, 1, 1);
      setFadedColor(segment.shade.material, 0xff222299, fade);
      segment.shade.visible = true;
      previous.copy(next);
    }
  }

  private acquireDestinyVisual(): DestinyVisual {
    const free = this.#destinyPool.find((visual) => !visual.active);
    if (free) return free;
    if (this.#destinyPool.length < DESTINY_POOL_LIMIT) {
      const root = new THREE.Group();
      root.name = `classic-transknight-destiny-${this.#destinyPool.length}`;
      root.visible = false;
      const mesh = new THREE.Mesh(
        this.#fallbackDoubleSwingGeometry,
        createBrightMeshMaterial(this.#fallbackGlow, 0x4d4dff),
      );
      mesh.name = "classic-transknight-destiny-model-2840";
      mesh.rotation.set(-Math.PI / 4, -0.69813174, Math.PI / 4, "YXZ");
      mesh.renderOrder = 9;
      root.add(mesh);
      const beamRoot = new THREE.Group();
      beamRoot.name = "classic-transknight-destiny-beam-410";
      const beamPlanes = [0, 1].map((planeIndex) => {
        const plane = new THREE.Mesh(
          this.#planeGeometry,
          createBrightMeshMaterial(this.#fallbackGlow, 0x7777ff),
        );
        plane.rotation.y = planeIndex * Math.PI / 2;
        plane.renderOrder = 8;
        beamRoot.add(plane);
        return plane;
      }) as [
        THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
        THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
      ];
      root.add(beamRoot);
      const visual: DestinyVisual = {
        root,
        mesh,
        beamRoot,
        beamPlanes,
        start: new THREE.Vector3(),
        target: new THREE.Vector3(),
        current: new THREE.Vector3(),
        active: false,
        elapsed: 0,
        lifetime: 0.6,
        nextEmission: 0,
        targetGroundY: 0,
        serial: 0,
        onImpact: null,
      };
      this.#destinyPool.push(visual);
      this.object.add(root);
      return visual;
    }
    const oldest = oldestBySerial(this.#destinyPool);
    deactivateDestiny(oldest);
    return oldest;
  }

  private applyDestinyAssets(visual: DestinyVisual): void {
    visual.mesh.geometry = this.#resources?.destinyGeometry ?? this.#fallbackDoubleSwingGeometry;
    setMaterialMap(
      visual.mesh.material,
      this.#resources?.destinyModelTexture ?? this.#fallbackGlow,
    );
    for (const plane of visual.beamPlanes) {
      setMaterialMap(
        plane.material,
        this.#resources?.destinyBeamTexture ?? this.#fallbackGlow,
      );
    }
  }

  private updateDestinyVisual(visual: DestinyVisual): void {
    const progress = Math.min(1, visual.elapsed / visual.lifetime);
    visual.current.copy(visual.start).lerp(visual.target, progress);
    visual.mesh.position.copy(visual.current);
    visual.mesh.visible = true;
    setFadedColor(visual.mesh.material, 0xff4d4dff, 1);

    const beamDirection = visual.current.clone().sub(visual.start);
    const beamLength = beamDirection.length();
    visual.beamRoot.visible = progress > 0.2 && beamLength > 0.001;
    if (visual.beamRoot.visible) {
      visual.beamRoot.position.copy(visual.start).add(visual.current).multiplyScalar(0.5);
      visual.beamRoot.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        beamDirection.multiplyScalar(1 / beamLength),
      );
      for (const plane of visual.beamPlanes) {
        plane.scale.set(0.5, beamLength, 1);
        setFadedColor(plane.material, 0xff7777ff, 1);
        plane.visible = true;
      }
    }

    while (visual.nextEmission <= visual.elapsed && visual.nextEmission < visual.lifetime) {
      const serial = ++this.#randomSerial;
      const trailProgress = visual.nextEmission / visual.lifetime;
      const position = visual.start.clone().lerp(visual.target, trailProgress);
      position.y -= 0.5;
      const scale = classicRandomStep(serial, 0, 5) * 0.2 + 0.2;
      this.spawnBillboard({
        position,
        textureIndex: 0,
        lifetime: 1,
        baseScaleX: scale,
        stickGround: true,
        color: 0xffaaaaee,
      });
      visual.nextEmission += 1 / 30;
    }

    if (progress < 1) return;
    const impact = visual.target.clone();
    impact.y -= 0.6;
    this.spawnBillboard({
      position: impact,
      textureIndex: 8,
      lifetime: 1,
      baseScaleX: 0.01,
      scaleVelocityX: 3,
      scaleVelocityY: 3,
      color: 0xffffffff,
    });
    this.spawnGround({
      position: new THREE.Vector3(visual.target.x, visual.targetGroundY + 0.005, visual.target.z),
      textureIndex: 7,
      lifetime: 0.8,
      baseScale: 4,
      color: 0xff7777ff,
      delayed: false,
    });
    const onImpact = visual.onImpact;
    deactivateDestiny(visual);
    onImpact?.();
  }

  private acquireFlamingSwordEmitter(): FlamingSwordEmitter {
    const free = this.#flamingSwordEmitters.find((emitter) => !emitter.active);
    if (free) return free;
    if (this.#flamingSwordEmitters.length < FLAMING_SWORD_EMITTER_LIMIT) {
      const emitter: FlamingSwordEmitter = {
        segments: [],
        active: false,
        elapsed: 0,
        duration: 0.5,
        nextEmission: 0,
        serial: 0,
        sample: null,
      };
      this.#flamingSwordEmitters.push(emitter);
      return emitter;
    }
    const oldest = oldestBySerial(this.#flamingSwordEmitters);
    deactivateFlamingSwordEmitter(oldest);
    return oldest;
  }

  private updateFlamingSwordEmitter(emitter: FlamingSwordEmitter): void {
    if (emitter.elapsed >= emitter.duration || !emitter.sample) {
      deactivateFlamingSwordEmitter(emitter);
      return;
    }
    while (emitter.nextEmission <= emitter.elapsed) {
      const count = Math.max(0, Math.min(2, emitter.sample(emitter.segments)));
      for (let index = 0; index < count; index++) {
        const segment = emitter.segments[index];
        if (!segment || !isFiniteVector(segment.tip)) continue;
        const serial = ++this.#randomSerial;
        const randomScale = classicRandomStep(serial, index, 5);
        const position = segment.tip.clone();
        position.y += 0.2;
        this.spawnBillboard({
          position,
          textureIndex: 11,
          lifetime: 1,
          baseScaleX: randomScale * 0.1 + 0.8,
          baseScaleY: randomScale * 0.2 + 0.8,
          color: 0xff0055ff,
          fade: false,
        });
      }
      emitter.nextEmission += 1 / 30;
    }
  }

  private updateFanaticismVisuals(deltaSeconds: number): void {
    for (let index = this.#fanaticismVisuals.length - 1; index >= 0; index--) {
      const visual = this.#fanaticismVisuals[index]!;
      visual.elapsed += deltaSeconds;
      if (visual.elapsed >= visual.lifetime) {
        visual.afterimage.dispose();
        this.#fanaticismVisuals.splice(index, 1);
        continue;
      }
      const progress = visual.elapsed / visual.lifetime;
      visual.afterimage.object.position.y = visual.baseY + visual.elapsed * visual.risePerSecond;
      visual.afterimage.setIntensity(0.5 * Math.cos(progress * Math.PI / 2));
      visual.afterimage.update(deltaSeconds);
    }
  }

  private clearFanaticismVisuals(): void {
    for (const visual of this.#fanaticismVisuals) visual.afterimage.dispose();
    this.#fanaticismVisuals.length = 0;
  }

  private acquireBashVisual(): BashVisual {
    const free = this.#bashPool.find((visual) => !visual.active);
    if (free) return free;
    if (this.#bashPool.length < BASH_POOL_LIMIT) {
      const visual: BashVisual = {
        position: new THREE.Vector3(),
        active: false,
        elapsed: 0,
        nextEmission: 0,
        serial: 0,
        onPulse: null,
        onExplosion: null,
      };
      this.#bashPool.push(visual);
      return visual;
    }
    const oldest = oldestBySerial(this.#bashPool);
    deactivateBash(oldest);
    return oldest;
  }

  private acquireBashExplosion(): BashExplosionVisual {
    const free = this.#bashExplosionPool.find((visual) => !visual.active);
    if (free) return free;
    if (this.#bashExplosionPool.length < BASH_EXPLOSION_POOL_LIMIT) {
      const visual: BashExplosionVisual = {
        position: new THREE.Vector3(),
        active: false,
        elapsed: 0,
        nextEmission: 0,
        serial: 0,
      };
      this.#bashExplosionPool.push(visual);
      return visual;
    }
    const oldest = oldestBySerial(this.#bashExplosionPool);
    deactivateTimedEmitter(oldest);
    return oldest;
  }

  private acquireBashFireEmitter(): BashFireEmitter {
    const free = this.#bashFireEmitterPool.find((visual) => !visual.active);
    if (free) return free;
    if (this.#bashFireEmitterPool.length < BASH_FIRE_EMITTER_POOL_LIMIT) {
      const visual: BashFireEmitter = {
        position: new THREE.Vector3(),
        active: false,
        elapsed: 0,
        nextEmission: 0.01,
        serial: 0,
      };
      this.#bashFireEmitterPool.push(visual);
      return visual;
    }
    const oldest = oldestBySerial(this.#bashFireEmitterPool);
    deactivateTimedEmitter(oldest);
    return oldest;
  }

  private updateBashVisuals(deltaSeconds: number): void {
    for (const visual of this.#bashPool) {
      if (!visual.active) continue;
      visual.elapsed += deltaSeconds;
      const emissionEnd = Math.min(visual.elapsed, 0.7);
      while (visual.nextEmission <= emissionEnd) {
        this.spawnBashSpeedUp(visual);
        visual.nextEmission += 0.25;
      }
      if (visual.elapsed < 0.7) continue;

      const explosion = this.acquireBashExplosion();
      explosion.active = true;
      explosion.elapsed = 0;
      explosion.nextEmission = 0;
      explosion.serial = ++this.#serial;
      explosion.position.copy(visual.position);
      const shadePosition = visual.position.clone();
      shadePosition.y -= 0.995;
      this.spawnGround({
        position: shadePosition,
        textureIndex: 7,
        lifetime: 1.8,
        baseScale: 4,
        color: 0x77775511,
      });
      visual.onExplosion?.();
      deactivateBash(visual);
    }
  }

  private spawnBashSpeedUp(visual: BashVisual): void {
    const progress = Math.min(1, visual.elapsed / 0.7);
    const serial = ++this.#randomSerial;
    const position = visual.position.clone();
    position.x += (classicRandomStep(serial, 0, 3) - progress * 10) * 0.2;
    position.z -= (classicRandomStep(serial, 1, 3) - progress * 10) * 0.2;

    const glowPosition = position.clone();
    glowPosition.y -= 0.6;
    this.spawnBillboard({
      position: glowPosition,
      textureIndex: 8,
      lifetime: 1,
      baseScaleX: 1.51,
      scaleVelocityX: 3,
      color: 0xffffffff,
      fade: false,
    });
    const firePosition = position.clone();
    firePosition.y -= 0.5;
    this.spawnBillboard({
      position: firePosition,
      textureIndex: 33,
      lifetime: 1,
      baseScaleX: 3,
      color: 0xffffffff,
      fade: false,
    });
    const shadePosition = position.clone();
    shadePosition.y -= 0.995;
    this.spawnGround({
      position: shadePosition,
      textureIndex: 7,
      lifetime: 1.5,
      baseScale: 4,
      color: 0x70704000,
    });
    visual.onPulse?.();
  }

  private updateBashExplosions(deltaSeconds: number): void {
    const directions = [
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
      [0, -1],
      [1, -1],
    ] as const;
    for (const explosion of this.#bashExplosionPool) {
      if (!explosion.active) continue;
      explosion.elapsed += deltaSeconds;
      const emissionEnd = Math.min(explosion.elapsed, 0.8);
      while (explosion.nextEmission <= emissionEnd) {
        const progress = explosion.nextEmission / 0.8;
        for (const [directionX, directionZ] of directions) {
          const emitter = this.acquireBashFireEmitter();
          emitter.active = true;
          emitter.elapsed = 0;
          emitter.nextEmission = 0.01;
          emitter.serial = ++this.#serial;
          emitter.position.copy(explosion.position);
          emitter.position.x += directionX * progress * 0.5;
          emitter.position.z -= directionZ * progress * 0.5;
          emitter.position.y -= 1;
          const shadePosition = emitter.position.clone();
          shadePosition.y += 0.005;
          this.spawnGround({
            position: shadePosition,
            textureIndex: 7,
            lifetime: 1.8,
            baseScale: 2,
            color: 0x22331100,
          });
        }
        explosion.nextEmission += 0.25;
      }
      if (explosion.elapsed >= 0.8) deactivateTimedEmitter(explosion);
    }
  }

  private updateBashFireEmitters(deltaSeconds: number): void {
    for (const emitter of this.#bashFireEmitterPool) {
      if (!emitter.active) continue;
      emitter.elapsed += deltaSeconds;
      const emissionEnd = Math.min(emitter.elapsed, 0.8);
      while (emitter.nextEmission <= emissionEnd) {
        const serial = ++this.#randomSerial;
        const offset = classicRandomStep(serial, 0, 5) * 0.01;
        const position = emitter.position.clone();
        position.x += offset;
        position.z -= offset;
        this.spawnBillboard({
          position,
          textureIndex: 33,
          lifetime: 1,
          baseScaleX: 0.4,
          scaleVelocityX: 1,
          color: 0xffffffff,
          motion: "rise",
          motionDistance: 4,
        });
        emitter.nextEmission += 0.18;
      }
      if (emitter.elapsed >= 0.8) deactivateTimedEmitter(emitter);
    }
  }

  private spawnSamaritanHaste(ownerFeet: THREE.Vector3): void {
    for (let index = 0; index < HASTE_PARTICLE_LIFETIMES_SECONDS.length; index++) {
      const serial = ++this.#randomSerial;
      const randomOffset = (classicRandomStep(serial, 0, 5) - 3) * 0.1;
      const position = ownerFeet.clone().addScalar(randomOffset);
      position.y += 5;
      this.spawnBillboard({
        position,
        textureIndex: 56,
        lifetime: HASTE_PARTICLE_LIFETIMES_SECONDS[index]!,
        baseScaleX: (index % 2) * 0.1 + 0.1,
        color: 0xffffeeff,
        motion: "fall-orbit",
        motionHeight: (index % 3) * 0.05 + 0.1,
        motionDistance: -7,
      });
    }
    const rayPosition = ownerFeet.clone();
    rayPosition.y += 2;
    this.spawnBillboard({
      position: rayPosition,
      textureIndex: 122,
      lifetime: 4,
      baseScaleX: 1.5,
      baseScaleY: 10,
      color: 0xffffeeff,
      rotation: 2.792527,
    });
  }

  private spawnDoubleSwingParticle(worldPosition: THREE.Vector3, level: 0 | 1): void {
    const serial = ++this.#randomSerial;
    const position = worldPosition.clone();
    // TMSkillDoubleSwing subtracts .5 from the moving mesh position before
    // TMEffectBillBoard's stick-ground half-height adjustment.
    position.y -= 0.5;
    this.spawnBillboard({
      position,
      textureIndex: 0,
      lifetime: 1,
      baseScaleX: 0.3 + classicRandomStep(serial, 0, 5) * 0.2,
      scaleVelocityX: 1,
      scaleVelocityY: 1,
      stickGround: true,
      color: level === 0 ? 0xffaaffee : 0xffff9999,
    });
  }

  private spawnFreezeParticle(worldPosition: THREE.Vector3): void {
    const serial = ++this.#randomSerial;
    const position = worldPosition.clone();
    position.x += (classicRandomStep(serial, 0, 10) - 5) * 0.2;
    position.z += (classicRandomStep(serial, 1, 10) - 5) * 0.2;
    this.spawnBillboard({
      position,
      textureIndex: 0,
      lifetime: 1.5,
      baseScaleX: 0.5 + classicRandomStep(serial, 2, 5) * 0.3,
      scaleVelocityX: 1,
      scaleVelocityY: 1,
      stickGround: true,
      color: 0xffaaeeff,
    });
  }

  private spawnBillboard(options: BillboardOptions): void {
    const visual = this.acquireBillboard();
    visual.active = true;
    visual.elapsed = 0;
    visual.lifetime = options.lifetime;
    visual.serial = ++this.#serial;
    visual.textureIndex = options.textureIndex;
    visual.basePosition.copy(options.position);
    visual.baseScaleX = options.baseScaleX;
    visual.baseScaleY = options.baseScaleY ?? options.baseScaleX;
    visual.scaleVelocityX = options.scaleVelocityX ?? 0;
    visual.scaleVelocityY = options.scaleVelocityY ?? options.scaleVelocityX ?? 0;
    visual.stickGround = options.stickGround ?? false;
    visual.color = options.color;
    visual.fade = options.fade ?? true;
    visual.motion = options.motion ?? "static";
    visual.motionHeight = options.motionHeight ?? 0;
    visual.motionDistance = options.motionDistance ?? 0;
    visual.sprite.material.rotation = options.rotation ?? 0;
    visual.sprite.visible = false;
    this.applyBillboardAsset(visual);
    this.updateBillboardVisual(visual);
  }

  private acquireBillboard(): BillboardVisual {
    const free = this.#billboardPool.find((visual) => !visual.active);
    if (free) return free;
    if (this.#billboardPool.length < BILLBOARD_POOL_LIMIT) {
      const sprite = createBrightSprite(
        this.#fallbackGlow,
        `classic-transknight-billboard-${this.#billboardPool.length}`,
      );
      const visual: BillboardVisual = {
        sprite,
        basePosition: new THREE.Vector3(),
        active: false,
        elapsed: 0,
        lifetime: 1,
        serial: 0,
        textureIndex: 0,
        baseScaleX: 1,
        baseScaleY: 1,
        scaleVelocityX: 0,
        scaleVelocityY: 0,
        stickGround: false,
        color: 0xffffff,
        fade: true,
        motion: "static",
        motionHeight: 0,
        motionDistance: 0,
      };
      this.#billboardPool.push(visual);
      this.object.add(sprite);
      return visual;
    }
    const oldest = oldestBySerial(this.#billboardPool);
    deactivateBillboard(oldest);
    return oldest;
  }

  private updateBillboards(deltaSeconds: number): void {
    for (const visual of this.#billboardPool) {
      if (!visual.active) continue;
      visual.elapsed += deltaSeconds;
      this.updateBillboardVisual(visual);
    }
  }

  private updateBillboardVisual(visual: BillboardVisual): void {
    if (visual.elapsed >= visual.lifetime) {
      deactivateBillboard(visual);
      return;
    }
    const progress = visual.elapsed / visual.lifetime;
    const scaleX = visual.baseScaleX + visual.elapsed * visual.scaleVelocityX;
    const scaleY = visual.baseScaleY + visual.elapsed * visual.scaleVelocityY;
    visual.sprite.scale.set(scaleX, scaleY, 1);
    visual.sprite.position.copy(visual.basePosition);
    switch (visual.motion) {
      case "rise":
        visual.sprite.position.y += progress * visual.motionDistance;
        break;
      case "rise-sine":
        visual.sprite.position.x += Math.sin(progress * Math.PI * 6) * visual.motionHeight;
        visual.sprite.position.y += progress * visual.motionDistance;
        break;
      case "fall-orbit":
        visual.sprite.position.x += Math.sin(progress * Math.PI * 6) * visual.motionHeight;
        visual.sprite.position.y += progress * visual.motionDistance;
        visual.sprite.position.z += Math.cos(progress * Math.PI * 6) * visual.motionHeight;
        break;
      case "static":
        break;
    }
    if (visual.stickGround) visual.sprite.position.y += scaleY / 2;
    const fade = visual.fade ? Math.max(0, Math.sin(progress * Math.PI)) : 1;
    setFadedColor(visual.sprite.material, visual.color, fade);
    visual.sprite.visible = progress >= BILLBOARD_VISIBLE_FRACTION;
  }

  private applyBillboardAsset(visual: BillboardVisual): void {
    setMaterialMap(visual.sprite.material, this.textureFor(visual.textureIndex));
  }

  private spawnGround(options: GroundOptions): void {
    const visual = this.acquireGround();
    visual.active = true;
    visual.elapsed = 0;
    visual.lifetime = options.lifetime;
    visual.killAt = options.killAt ?? options.lifetime;
    visual.serial = ++this.#serial;
    visual.textureIndex = options.textureIndex;
    visual.basePosition.copy(options.position);
    visual.baseScale = options.baseScale;
    visual.scaleVelocity = options.scaleVelocity ?? 0;
    visual.color = options.color;
    visual.fade = options.fade ?? true;
    visual.delayed = options.delayed ?? true;
    visual.mesh.visible = false;
    this.applyGroundAsset(visual);
    this.updateGroundVisual(visual);
  }

  private acquireGround(): GroundVisual {
    const free = this.#groundPool.find((visual) => !visual.active);
    if (free) return free;
    if (this.#groundPool.length < GROUND_POOL_LIMIT) {
      const mesh = createGroundPlane(
        this.#planeGeometry,
        this.#fallbackGlow,
        `classic-transknight-ground-${this.#groundPool.length}`,
      );
      const visual: GroundVisual = {
        mesh,
        basePosition: new THREE.Vector3(),
        active: false,
        elapsed: 0,
        lifetime: 1,
        killAt: 1,
        serial: 0,
        textureIndex: 2,
        baseScale: 1,
        scaleVelocity: 0,
        color: 0xffffff,
        fade: true,
        delayed: true,
      };
      this.#groundPool.push(visual);
      this.object.add(mesh);
      return visual;
    }
    const oldest = oldestBySerial(this.#groundPool);
    deactivateGround(oldest);
    return oldest;
  }

  private updateGroundVisuals(deltaSeconds: number): void {
    for (const visual of this.#groundPool) {
      if (!visual.active) continue;
      visual.elapsed += deltaSeconds;
      this.updateGroundVisual(visual);
    }
  }

  private updateGroundVisual(visual: GroundVisual): void {
    if (visual.elapsed >= visual.killAt) {
      deactivateGround(visual);
      return;
    }
    const progress = Math.min(1, visual.elapsed / visual.lifetime);
    const scale = visual.baseScale + visual.elapsed * visual.scaleVelocity;
    visual.mesh.position.copy(visual.basePosition);
    visual.mesh.scale.set(scale, scale, 1);
    const fade = visual.fade ? Math.max(0, Math.sin(progress * Math.PI)) : 1;
    setFadedColor(visual.mesh.material, visual.color, fade);
    visual.mesh.visible = !visual.delayed || progress >= BILLBOARD_VISIBLE_FRACTION;
  }

  private applyGroundAsset(visual: GroundVisual): void {
    setMaterialMap(visual.mesh.material, this.textureFor(visual.textureIndex));
  }

  private acquireDoubleSwingVisual(): DoubleSwingVisual {
    const free = this.#doubleSwingPool.find((visual) => !visual.active);
    if (free) return free;
    if (this.#doubleSwingPool.length < DOUBLE_SWING_POOL_LIMIT) {
      const visual = this.createDoubleSwingVisual(this.#doubleSwingPool.length);
      this.#doubleSwingPool.push(visual);
      this.object.add(visual.root);
      return visual;
    }
    const oldest = oldestBySerial(this.#doubleSwingPool);
    deactivateDoubleSwing(oldest);
    return oldest;
  }

  private createDoubleSwingVisual(index: number): DoubleSwingVisual {
    const root = new THREE.Group();
    root.name = `classic-transknight-double-swing-${index}`;
    root.visible = false;
    const mesh = new THREE.Mesh(
      this.#fallbackDoubleSwingGeometry,
      createBrightMeshMaterial(this.#fallbackGlow, 0xaaaaaa),
    );
    mesh.name = "classic-transknight-double-swing-model-702-texture-91";
    mesh.scale.set(1.5, 1.5, 1.5);
    mesh.renderOrder = 8;
    const shade = createGroundPlane(
      this.#planeGeometry,
      this.#fallbackGlow,
      "classic-transknight-double-swing-shade-7",
    );
    shade.rotation.set(-Math.PI / 2, 0, 0);
    shade.scale.set(6, 6, 1);
    shade.renderOrder = 4;
    root.add(mesh, shade);
    return {
      root,
      mesh,
      shade,
      start: new THREE.Vector3(),
      destination: new THREE.Vector3(),
      direction: new THREE.Vector3(),
      active: false,
      elapsed: 0,
      lifetime: 1,
        nextEmission: 0.1,
        serial: 0,
        level: 0,
    };
  }

  private applyDoubleSwingAssets(visual: DoubleSwingVisual): void {
    visual.mesh.geometry = this.#resources?.doubleSwingGeometry ?? this.#fallbackDoubleSwingGeometry;
    setMaterialMap(visual.mesh.material, this.#resources?.doubleSwingTexture ?? this.#fallbackGlow);
    setMaterialMap(visual.shade.material, this.#resources?.shadeTexture ?? this.#fallbackGlow);
  }

  private updateDoubleSwingVisual(visual: DoubleSwingVisual): void {
    if (visual.elapsed >= visual.lifetime) {
      deactivateDoubleSwing(visual);
      return;
    }
    const progress = visual.elapsed / visual.lifetime;
    visual.mesh.position.copy(visual.start).addScaledVector(visual.direction, progress * 4);
    visual.mesh.visible = progress >= BILLBOARD_VISIBLE_FRACTION;
    visual.mesh.scale.set(
      visual.level === 0 ? 1.5 : 5,
      visual.level === 0 ? 1.5 : 2,
      visual.level === 0 ? 1.5 : 5,
    );
    visual.mesh.material.color.setHex(visual.level === 0 ? 0xaaaaaa : 0xff0000);
    visual.mesh.material.opacity = 1;

    const casterGroundY = visual.start.y - 1;
    const targetGroundY = visual.destination.y - 1;
    visual.shade.position.set(
      visual.mesh.position.x,
      THREE.MathUtils.lerp(casterGroundY, targetGroundY, progress) + 0.005,
      visual.mesh.position.z,
    );
    const shadeScale = visual.level === 0 ? 6 : 10;
    visual.shade.scale.set(shadeScale, shadeScale, 1);
    visual.shade.visible = true;
    setFadedColor(
      visual.shade.material,
      visual.level === 0 ? 0x005533 : 0x770000,
      Math.sin(progress * Math.PI),
    );

    if (visual.elapsed >= visual.nextEmission) {
      this.spawnDoubleSwingParticle(visual.mesh.position, visual.level);
      visual.nextEmission = visual.elapsed + 0.1;
    }
  }

  private acquireStartVisual(): StartVisual {
    const free = this.#startPool.find((visual) => !visual.active);
    if (free) return free;
    if (this.#startPool.length < START_POOL_LIMIT) {
      const root = new THREE.Group();
      root.name = `classic-transknight-life-aura-${this.#startPool.length}`;
      root.visible = false;
      const mesh = new THREE.Mesh(
        this.#fallbackStartGeometry,
        createBrightMeshMaterial(this.#fallbackGlow, 0xffffff),
      );
      mesh.name = "classic-transknight-effect-start-type-2-model-703-texture-54";
      mesh.renderOrder = 8;
      root.add(mesh);
      const visual: StartVisual = { root, mesh, active: false, elapsed: 0, serial: 0 };
      this.#startPool.push(visual);
      this.object.add(root);
      return visual;
    }
    const oldest = oldestBySerial(this.#startPool);
    deactivateStart(oldest);
    return oldest;
  }

  private applyStartAssets(visual: StartVisual): void {
    visual.mesh.geometry = this.#resources?.startGeometry ?? this.#fallbackStartGeometry;
    setMaterialMap(visual.mesh.material, this.#resources?.startTexture ?? this.#fallbackGlow);
  }

  private updateStartVisual(visual: StartVisual): void {
    if (visual.elapsed >= 3) {
      deactivateStart(visual);
      return;
    }
    const progress = visual.elapsed / 3;
    const intensity = Math.abs(Math.sin(progress * Math.PI));
    const scale = intensity * 0.5 + 0.5;
    visual.mesh.visible = progress >= BILLBOARD_VISIBLE_FRACTION;
    visual.mesh.scale.setScalar(scale);
    visual.mesh.rotation.set(Math.PI / 2, -progress * Math.PI, Math.PI / 2, "YXZ");
    visual.mesh.material.color.setRGB(intensity, intensity, intensity);
    visual.mesh.material.opacity = 1;
  }

  private acquireFreezeVisual(): FreezeVisual {
    const free = this.#freezePool.find((visual) => !visual.active);
    if (free) return free;
    if (this.#freezePool.length < FREEZE_POOL_LIMIT) {
      const root = new THREE.Group();
      root.name = `classic-transknight-freeze-blade-${this.#freezePool.length}`;
      root.visible = false;
      const mesh = new THREE.Mesh(
        this.#fallbackFreezeGeometry,
        createBrightMeshMaterial(this.#fallbackGlow, 0x113366),
      );
      mesh.name = "classic-transknight-freeze-blade-model-706-707-texture-19";
      mesh.rotation.set(Math.PI / 2, -Math.PI / 2, Math.PI / 2, "YXZ");
      mesh.renderOrder = 8;
      const ring = createGroundPlane(
        this.#planeGeometry,
        this.#fallbackGlow,
        "classic-transknight-freeze-blade-billboard2-2",
      );
      ring.position.y = 0.3;
      ring.renderOrder = 6;
      root.add(mesh, ring);
      const visual: FreezeVisual = {
        root,
        mesh,
        ring,
        active: false,
        elapsed: 0,
        serial: 0,
        type: 0,
      };
      this.#freezePool.push(visual);
      this.object.add(root);
      return visual;
    }
    const oldest = oldestBySerial(this.#freezePool);
    deactivateFreeze(oldest);
    return oldest;
  }

  private applyFreezeAssets(visual: FreezeVisual): void {
    visual.mesh.geometry = visual.type === 0
      ? this.#resources?.freezeGeometry ?? this.#fallbackFreezeGeometry
      : this.#resources?.freezeStormGeometry ?? this.#fallbackFreezeGeometry;
    setMaterialMap(visual.mesh.material, this.#resources?.iceTexture ?? this.#fallbackGlow);
    setMaterialMap(visual.ring.material, this.#resources?.slopeTexture ?? this.#fallbackGlow);
  }

  private updateFreezeVisual(visual: FreezeVisual): void {
    if (visual.elapsed >= FREEZE_LIFETIME_SECONDS) {
      deactivateFreeze(visual);
      return;
    }
    const progress = visual.elapsed / FREEZE_LIFETIME_SECONDS;
    visual.mesh.visible = progress >= BILLBOARD_VISIBLE_FRACTION;
    const verticalScale = progress < 0.1 ? progress * 15 + 0.2 : 1.7;
    visual.mesh.scale.set(1, verticalScale, 1);
    const fade = progress < 0.6
      ? 1
      : Math.max(0, Math.cos((progress - 0.6) * 1.25 * Math.PI));
    setFadedColor(visual.mesh.material, 0x55113366, fade);

    const ringProgress = progress;
    const ringScale = 2 + visual.elapsed * 2;
    visual.ring.scale.set(ringScale, ringScale, 1);
    visual.ring.visible = ringProgress >= BILLBOARD_VISIBLE_FRACTION;
    setFadedColor(visual.ring.material, 0xff2255aa, Math.sin(ringProgress * Math.PI));
  }

  private acquireCriticalArmorVisual(): CriticalArmorVisual {
    const free = this.#criticalArmorPool.find((visual) => !visual.active);
    if (free) return free;
    if (this.#criticalArmorPool.length < CRITICAL_ARMOR_POOL_LIMIT) {
      const root = new THREE.Group();
      root.name = `classic-transknight-possessed-cast-${this.#criticalArmorPool.length}`;
      root.visible = false;
      const mesh = new THREE.Mesh(
        this.#fallbackCriticalArmorGeometry,
        createBrightMeshMaterial(this.#fallbackGlow, 0x999999),
      );
      mesh.name = "classic-transknight-possessed-cast-model-2838-texture-413";
      mesh.renderOrder = 8;
      root.add(mesh);
      const visual: CriticalArmorVisual = {
        root,
        mesh,
        active: false,
        elapsed: 0,
        serial: 0,
      };
      this.#criticalArmorPool.push(visual);
      this.object.add(root);
      return visual;
    }
    const oldest = oldestBySerial(this.#criticalArmorPool);
    deactivateCriticalArmor(oldest);
    return oldest;
  }

  private applyCriticalArmorAsset(visual: CriticalArmorVisual): void {
    visual.mesh.geometry = this.#resources?.criticalArmorGeometry
      ?? this.#fallbackCriticalArmorGeometry;
    setMaterialMap(
      visual.mesh.material,
      this.#resources?.criticalArmorTexture ?? this.#fallbackGlow,
    );
  }

  private applyPossessedAuraAsset(): void {
    this.#possessedAura.geometry = this.#resources?.criticalArmorGeometry
      ?? this.#fallbackCriticalArmorGeometry;
    setMaterialMap(
      this.#possessedAura.material,
      this.#resources?.criticalArmorTexture ?? this.#fallbackGlow,
    );
  }

  private updateCriticalArmorVisual(visual: CriticalArmorVisual): void {
    if (visual.elapsed >= 0.5) {
      deactivateCriticalArmor(visual);
      return;
    }
    const progress = visual.elapsed / 0.5;
    const expansion = progress >= 0.2
      ? Math.sin((progress - 0.2) * Math.PI * 0.5) + 1.5
      : progress * 5 + 0.5;
    visual.mesh.scale.setScalar(expansion * 2.5);
    setFadedColor(visual.mesh.material, 0xff999999, Math.sin(progress * Math.PI));
    visual.mesh.visible = true;
  }

  private criticalArmorCastPosition(
    ownerFeet: THREE.Vector3,
    context?: ClassicTransKnightOwnerContext,
  ): THREE.Vector3 {
    if (context?.mounted && isFiniteVector(context.skinAnchor)) {
      return context.skinAnchor.clone().add(
        new THREE.Vector3(0, context.scale - 0.3, 0),
      );
    }
    return ownerFeet.clone().add(new THREE.Vector3(0, (context?.scale ?? 0.9) + 0.3, 0));
  }

  private playJudgement(targetFeet: THREE.Vector3): void {
    const visual = this.acquireJudgementVisual();
    visual.active = true;
    visual.elapsed = 0;
    visual.serial = ++this.#serial;
    visual.root.position.copy(targetFeet);
    visual.root.position.y += 0.5;
    visual.root.visible = true;
    this.applyJudgementAssets(visual);
    this.updateJudgementVisual(visual);
  }

  private acquireJudgementVisual(): JudgementVisual {
    const free = this.#judgementPool.find((visual) => !visual.active);
    if (free) return free;
    if (this.#judgementPool.length < JUDGEMENT_POOL_LIMIT) {
      const root = new THREE.Group();
      root.name = `classic-transknight-judgement-${this.#judgementPool.length}`;
      root.visible = false;
      const mesh = new THREE.Mesh(
        this.#fallbackJudgementGeometry,
        createBrightMeshMaterial(this.#fallbackGlow, 0x3333ff),
      );
      mesh.name = "classic-transknight-judgement-model-10";
      mesh.rotation.set(Math.PI / 2, 0, Math.PI / 2, "YXZ");
      mesh.scale.setScalar(3.5);
      mesh.renderOrder = 8;
      const rings = [0x3333ff, 0x5555ff].map((color, ringIndex) => {
        const ring = createGroundPlane(
          this.#planeGeometry,
          this.#fallbackGlow,
          `classic-transknight-judgement-ring-416-${ringIndex}`,
        );
        ring.position.y = ringIndex * 0.004;
        ring.scale.set(5.6, 5.6, 1);
        ring.material.color.setHex(color);
        ring.renderOrder = 6 + ringIndex;
        root.add(ring);
        return ring;
      }) as [
        THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
        THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
      ];
      root.add(mesh);
      const visual: JudgementVisual = {
        root,
        mesh,
        rings,
        active: false,
        elapsed: 0,
        serial: 0,
      };
      this.#judgementPool.push(visual);
      this.object.add(root);
      return visual;
    }
    const oldest = oldestBySerial(this.#judgementPool);
    deactivateJudgement(oldest);
    return oldest;
  }

  private applyJudgementAssets(visual: JudgementVisual): void {
    visual.mesh.geometry = this.#resources?.judgementGeometry ?? this.#fallbackJudgementGeometry;
    setMaterialMap(
      visual.mesh.material,
      this.#resources?.judgementModelTexture ?? this.#fallbackGlow,
    );
    for (const ring of visual.rings) {
      setMaterialMap(ring.material, this.#resources?.judgementRingTexture ?? this.#fallbackGlow);
    }
  }

  private updateJudgementVisual(visual: JudgementVisual): void {
    if (visual.elapsed >= JUDGEMENT_LIFETIME_SECONDS) {
      deactivateJudgement(visual);
      return;
    }
    visual.mesh.visible = true;
    setFadedColor(visual.mesh.material, 0x883333ff, 1);
    const progress = visual.elapsed / JUDGEMENT_LIFETIME_SECONDS;
    const ringsVisible = visual.elapsed < JUDGEMENT_RING_KILL_SECONDS
      && progress >= BILLBOARD_VISIBLE_FRACTION;
    const fade = Math.max(0, Math.sin(progress * Math.PI));
    for (let index = 0; index < visual.rings.length; index++) {
      const ring = visual.rings[index]!;
      ring.visible = ringsVisible;
      setFadedColor(ring.material, index === 0 ? 0x883333ff : 0x885555ff, fade);
    }
  }

  private textureFor(index: EffectTextureIndex): THREE.Texture {
    const resources = this.#resources;
    if (!resources) return this.#fallbackGlow;
    switch (index) {
      case 0:
        return resources.particleTexture;
      case 2:
        return resources.slopeTexture;
      case 7:
        return resources.shadeTexture;
      case 8:
        return resources.destinyImpactTexture;
      case 11:
        return resources.flamingSwordTexture;
      case 19:
        return resources.iceTexture;
      case 33:
        return resources.fireTexture;
      case 54:
        return resources.holyColumnTexture;
      case 55:
        return resources.holyRingTexture;
      case 56:
        return resources.magicParticleTexture;
      case 60:
        return resources.assaultFlameTexture;
      case 91:
        return resources.doubleSwingTexture;
      case 122:
        return resources.hasteRayTexture;
      case 128:
        return resources.sparkTexture;
      case 416:
        return resources.judgementRingTexture;
    }
  }

  private async loadClassicResources(
    assets: ClassicAssetSource,
  ): Promise<ClassicTransKnightResources> {
    const [
      judgementSource,
      doubleSwingSource,
      startSource,
      freezeSource,
      freezeStormSource,
      criticalArmorSource,
      destinySource,
    ] =
      await Promise.all([
        assets.loadModel(10),
        assets.loadModel(702),
        assets.loadModel(703),
        assets.loadModel(706),
        assets.loadModel(707),
        assets.loadModel(2838),
        assets.loadModel(2840),
      ]);
    if (
      !judgementSource
      || !doubleSwingSource
      || !startSource
      || !freezeSource
      || !freezeStormSource
      || !criticalArmorSource
      || !destinySource
    ) {
      throw new Error("Modelos clássicos 10/702/703/706/707/2838/2840 ausentes do manifesto");
    }
    const judgementTextureFile = judgementSource.textures[0];
    if (!judgementTextureFile) throw new Error("Modelo clássico 10 sem textura de origem");
    const destinyTextureFile = destinySource.textures[0];
    if (!destinyTextureFile) throw new Error("Modelo clássico 2840 sem textura de origem");

    let loadedTextures: THREE.Texture[] = [];
    const loadedGeometries: THREE.BufferGeometry[] = [];
    try {
      // Wait for every DDS request before handling a failure. Promise.all can
      // reject early and leak textures whose requests finish after the catch.
      const textureResults = await Promise.allSettled([
        this.loadEffectTexture(assets, 0),
        this.loadEffectTexture(assets, 2),
        this.loadEffectTexture(assets, 7),
        this.loadEffectTexture(assets, 8),
        this.loadEffectTexture(assets, 11),
        this.loadEffectTexture(assets, 19),
        this.loadEffectTexture(assets, 33),
        this.loadEffectTexture(assets, 54),
        this.loadEffectTexture(assets, 54),
        this.loadEffectTexture(assets, 55),
        this.loadEffectTexture(assets, 56),
        this.loadEffectTexture(assets, 60),
        this.loadEffectTexture(assets, 413),
        this.loadEffectTexture(assets, 91),
        this.loadEffectTexture(assets, 122),
        this.loadEffectTexture(assets, 128),
        this.loadEffectTexture(assets, 410),
        this.loadEffectTexture(assets, 416),
        this.loadTextureUrl(assets.dataUrl(judgementTextureFile)),
        this.loadTextureUrl(assets.dataUrl(destinyTextureFile)),
      ]);
      loadedTextures = textureResults
        .filter((result): result is PromiseFulfilledResult<THREE.Texture> => (
          result.status === "fulfilled"
        ))
        .map((result) => result.value);
      const textureFailure = textureResults.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (textureFailure || loadedTextures.length !== textureResults.length) {
        throw textureFailure?.reason ?? new Error("Texturas clássicas do TransKnight incompletas");
      }
      const [
        particleTexture,
        slopeTexture,
        shadeTexture,
        destinyImpactTexture,
        flamingSwordTexture,
        iceTexture,
        fireTexture,
        holyColumnTexture,
        startTexture,
        holyRingTexture,
        magicParticleTexture,
        assaultFlameTexture,
        criticalArmorTexture,
        doubleSwingTexture,
        hasteRayTexture,
        sparkTexture,
        destinyBeamTexture,
        judgementRingTexture,
        judgementModelTexture,
        destinyModelTexture,
      ] = loadedTextures as [
        THREE.Texture,
        THREE.Texture,
        THREE.Texture,
        THREE.Texture,
        THREE.Texture,
        THREE.Texture,
        THREE.Texture,
        THREE.Texture,
        THREE.Texture,
        THREE.Texture,
        THREE.Texture,
        THREE.Texture,
        THREE.Texture,
        THREE.Texture,
        THREE.Texture,
        THREE.Texture,
        THREE.Texture,
        THREE.Texture,
        THREE.Texture,
        THREE.Texture,
      ];

      const judgementGeometry = parseMsa(judgementSource.buffer).geometry;
      loadedGeometries.push(judgementGeometry);
      const doubleSwingGeometry = parseMsa(doubleSwingSource.buffer).geometry;
      loadedGeometries.push(doubleSwingGeometry);
      const startGeometry = parseMsa(startSource.buffer).geometry;
      loadedGeometries.push(startGeometry);
      const freezeGeometry = parseMsa(freezeSource.buffer).geometry;
      loadedGeometries.push(freezeGeometry);
      const freezeStormGeometry = parseMsa(freezeStormSource.buffer).geometry;
      loadedGeometries.push(freezeStormGeometry);
      const criticalArmorGeometry = parseMsa(criticalArmorSource.buffer).geometry;
      loadedGeometries.push(criticalArmorGeometry);
      const destinyGeometry = parseMsa(destinySource.buffer).geometry;
      loadedGeometries.push(destinyGeometry);

      configureClassicBillboardUvs(particleTexture);
      configureClassicGroundPlaneUvs(slopeTexture);
      configureClassicBillboardUvs(destinyImpactTexture);
      configureClassicBillboardUvs(flamingSwordTexture);
      // Texture 33 deliberately samples the full DDS frame in
      // TMEffectBillBoard; do not apply the usual 2% inset.
      configureClassicBillboardUvs(holyColumnTexture);
      configureClassicBillboardUvs(holyRingTexture);
      configureClassicBillboardUvs(magicParticleTexture);
      configureClassicBillboardUvs(assaultFlameTexture);
      configureClassicBillboardUvs(hasteRayTexture);
      configureClassicBillboardUvs(sparkTexture);
      configureClassicBillboardUvs(destinyBeamTexture);
      configureClassicGroundPlaneUvs(judgementRingTexture);

      return {
        judgementGeometry,
        doubleSwingGeometry,
        startGeometry,
        freezeGeometry,
        freezeStormGeometry,
        criticalArmorGeometry,
        destinyGeometry,
        judgementModelTexture,
        destinyModelTexture,
        particleTexture,
        slopeTexture,
        shadeTexture,
        iceTexture,
        fireTexture,
        holyColumnTexture,
        startTexture,
        holyRingTexture,
        magicParticleTexture,
        assaultFlameTexture,
        criticalArmorTexture,
        destinyImpactTexture,
        destinyBeamTexture,
        flamingSwordTexture,
        doubleSwingTexture,
        hasteRayTexture,
        sparkTexture,
        judgementRingTexture,
      };
    } catch (error) {
      for (const geometry of loadedGeometries) geometry.dispose();
      for (const texture of loadedTextures) texture.dispose();
      throw error;
    }
  }

  private loadEffectTexture(assets: ClassicAssetSource, index: number): Promise<THREE.Texture> {
    const url = assets.effectTextureUrl(index);
    if (!url) return Promise.reject(new Error(`Textura de efeito ${index} ausente do manifesto`));
    return this.loadTextureUrl(url);
  }

  private async loadTextureUrl(url: string): Promise<THREE.Texture> {
    const texture = await this.#dds.loadAsync(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  }
}

function createBrightMeshMaterial(texture: THREE.Texture, color: number): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: color & 0xffffff,
    transparent: true,
    opacity: packedAlpha(color),
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
  material.forceSinglePass = true;
  return material;
}

function createBrightSprite(texture: THREE.Texture, name: string): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: texture,
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.name = name;
  sprite.visible = false;
  sprite.renderOrder = 7;
  return sprite;
}

function createGroundPlane(
  geometry: THREE.PlaneGeometry,
  texture: THREE.Texture,
  name: string,
): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const mesh = new THREE.Mesh(geometry, createBrightMeshMaterial(texture, 0xffffff));
  mesh.name = name;
  mesh.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
  mesh.visible = false;
  mesh.renderOrder = 5;
  return mesh;
}

function setMaterialMap(
  material: THREE.MeshBasicMaterial | THREE.SpriteMaterial,
  texture: THREE.Texture,
): void {
  if (material.map === texture) return;
  material.map = texture;
  material.needsUpdate = true;
}

function setFadedColor(
  material: THREE.MeshBasicMaterial | THREE.SpriteMaterial,
  color: number,
  fade: number,
): void {
  const intensity = THREE.MathUtils.clamp(fade, 0, 1);
  material.color.setHex(color & 0xffffff).multiplyScalar(intensity);
  material.opacity = packedAlpha(color) * intensity;
}

/** Six-digit RGB values are opaque; eight-digit retail DWORDs retain alpha. */
function packedAlpha(color: number): number {
  const alpha = Math.floor(color / 0x1000000) & 0xff;
  return color <= 0xffffff || alpha === 0 ? 1 : alpha / 0xff;
}

function configureClassicBillboardUvs(texture: THREE.Texture): void {
  texture.offset.set(0.02, 0.98);
  texture.repeat.set(0.96, -0.96);
  texture.needsUpdate = true;
}

function configureClassicGroundPlaneUvs(texture: THREE.Texture): void {
  texture.offset.set(0.02, 0.02);
  texture.repeat.set(0.96, 0.96);
  texture.needsUpdate = true;
}

function deactivateBillboard(visual: BillboardVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.sprite.visible = false;
  visual.sprite.material.opacity = 0;
}

function deactivateGround(visual: GroundVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.mesh.visible = false;
  visual.mesh.material.opacity = 0;
}

function deactivateDoubleSwing(visual: DoubleSwingVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.root.visible = false;
  visual.mesh.visible = false;
  visual.shade.visible = false;
}

function deactivateStart(visual: StartVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.root.visible = false;
  visual.mesh.visible = false;
}

function deactivateFreeze(visual: FreezeVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.root.visible = false;
  visual.mesh.visible = false;
  visual.ring.visible = false;
}

function deactivateJudgement(visual: JudgementVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.root.visible = false;
  visual.mesh.visible = false;
  for (const ring of visual.rings) ring.visible = false;
}

function deactivateCriticalArmor(visual: CriticalArmorVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.root.visible = false;
  visual.mesh.visible = false;
}

function deactivateSpark(visual: SparkVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.followTarget = null;
  visual.root.visible = false;
  for (const segment of visual.segments) {
    for (const plane of segment.planes) {
      plane.visible = false;
      plane.material.opacity = 0;
    }
    segment.shade.visible = false;
    segment.shade.material.opacity = 0;
  }
}

function deactivateDestiny(visual: DestinyVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.onImpact = null;
  visual.root.visible = false;
  visual.mesh.visible = false;
  visual.beamRoot.visible = false;
  for (const plane of visual.beamPlanes) {
    plane.visible = false;
    plane.material.opacity = 0;
  }
}

function deactivateFlamingSwordEmitter(emitter: FlamingSwordEmitter): void {
  emitter.active = false;
  emitter.elapsed = 0;
  emitter.sample = null;
}

function deactivateTimedEmitter(
  emitter: { active: boolean; elapsed: number; nextEmission: number },
): void {
  emitter.active = false;
  emitter.elapsed = 0;
  emitter.nextEmission = 0;
}

function deactivateBash(visual: BashVisual): void {
  deactivateTimedEmitter(visual);
  visual.onPulse = null;
  visual.onExplosion = null;
}

function oldestBySerial<T extends { serial: number }>(visuals: readonly T[]): T {
  let oldest = visuals[0]!;
  for (const visual of visuals) {
    if (visual.serial < oldest.serial) oldest = visual;
  }
  return oldest;
}

function classicRandomStep(serial: number, lane: number, modulus: number): number {
  const seed = Math.imul(serial + lane * 0x9e37, 1_103_515_245) + 12_345;
  return (seed >>> 16) % modulus;
}

function isFiniteVector(position: THREE.Vector3): boolean {
  return Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
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
  texture.name = "classic-transknight-effect-fallback";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function disposeClassicResources(resources: ClassicTransKnightResources): void {
  resources.judgementGeometry.dispose();
  resources.doubleSwingGeometry.dispose();
  resources.startGeometry.dispose();
  resources.freezeGeometry.dispose();
  resources.freezeStormGeometry.dispose();
  resources.criticalArmorGeometry.dispose();
  resources.destinyGeometry.dispose();
  resources.judgementModelTexture.dispose();
  resources.destinyModelTexture.dispose();
  resources.particleTexture.dispose();
  resources.slopeTexture.dispose();
  resources.shadeTexture.dispose();
  resources.iceTexture.dispose();
  resources.fireTexture.dispose();
  resources.holyColumnTexture.dispose();
  resources.startTexture.dispose();
  resources.holyRingTexture.dispose();
  resources.magicParticleTexture.dispose();
  resources.assaultFlameTexture.dispose();
  resources.criticalArmorTexture.dispose();
  resources.destinyImpactTexture.dispose();
  resources.destinyBeamTexture.dispose();
  resources.flamingSwordTexture.dispose();
  resources.doubleSwingTexture.dispose();
  resources.hasteRayTexture.dispose();
  resources.sparkTexture.dispose();
  resources.judgementRingTexture.dispose();
}
