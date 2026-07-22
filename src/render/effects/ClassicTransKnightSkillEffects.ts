import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { parseMsa } from "../../formats/classic/Msa";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";

export type ClassicTransKnightAttackIndex = 0 | 1 | 2 | 19 | 23;
export type ClassicTransKnightBuffIndex = 3 | 5;
export type ClassicTransKnightSkillIndex =
  | ClassicTransKnightAttackIndex
  | ClassicTransKnightBuffIndex;

const BILLBOARD_POOL_LIMIT = 384;
const GROUND_POOL_LIMIT = 96;
const DOUBLE_SWING_POOL_LIMIT = 16;
const START_POOL_LIMIT = 16;
const FREEZE_POOL_LIMIT = 48;
const JUDGEMENT_POOL_LIMIT = 16;
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

type EffectTextureIndex = 0 | 2 | 7 | 19 | 54 | 55 | 56 | 91 | 122 | 416;
type BillboardMotion = "static" | "rise" | "rise-sine" | "fall-orbit";

interface ClassicTransKnightResources {
  readonly judgementGeometry: THREE.BufferGeometry;
  readonly doubleSwingGeometry: THREE.BufferGeometry;
  readonly startGeometry: THREE.BufferGeometry;
  readonly freezeGeometry: THREE.BufferGeometry;
  readonly freezeStormGeometry: THREE.BufferGeometry;
  readonly judgementModelTexture: THREE.Texture;
  readonly particleTexture: THREE.Texture;
  readonly slopeTexture: THREE.Texture;
  readonly shadeTexture: THREE.Texture;
  readonly iceTexture: THREE.Texture;
  readonly holyColumnTexture: THREE.Texture;
  readonly startTexture: THREE.Texture;
  readonly holyRingTexture: THREE.Texture;
  readonly magicParticleTexture: THREE.Texture;
  readonly doubleSwingTexture: THREE.Texture;
  readonly hasteRayTexture: THREE.Texture;
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
 * #0/#1/#2/#3/#5/#19/#23.
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
  readonly #billboardPool: BillboardVisual[] = [];
  readonly #groundPool: GroundVisual[] = [];
  readonly #doubleSwingPool: DoubleSwingVisual[] = [];
  readonly #startPool: StartVisual[] = [];
  readonly #freezePool: FreezeVisual[] = [];
  readonly #judgementPool: JudgementVisual[] = [];
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
    scene.add(this.object);
  }

  /** Loads retail models 10/702/703/706/707 and their DDS overrides once. */
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
        for (const visual of this.#billboardPool) this.applyBillboardAsset(visual);
        for (const visual of this.#groundPool) this.applyGroundAsset(visual);
        for (const visual of this.#doubleSwingPool) this.applyDoubleSwingAssets(visual);
        for (const visual of this.#startPool) this.applyStartAssets(visual);
        for (const visual of this.#freezePool) this.applyFreezeAssets(visual);
        for (const visual of this.#judgementPool) this.applyJudgementAssets(visual);
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
    if (!enabled) this.clear();
  }

  update(deltaSeconds: number): void {
    if (this.#disposed || !this.#enabled) return;
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    if (delta === 0) return;
    this.#clockSeconds += delta;

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
        this.playDoubleSwing(casterFeet, targetFeet);
        return true;
      case 19:
        this.playFreezeBlade(targetFeet, 0);
        return true;
      case 23:
        this.playIceStorm(targetFeet);
        return true;
      default:
        return false;
    }
  }

  /** Numeric self-buff dispatch used by the class combat route. */
  playBuff(classicIndex: number, ownerFeet: THREE.Vector3): boolean {
    switch (classicIndex) {
      case 3:
        this.playSamaritan(ownerFeet);
        return true;
      case 5:
        this.playLifeAura(ownerFeet);
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
  ): boolean {
    return this.playAttack(classicIndex, casterFeet, targetFeet)
      || this.playBuff(classicIndex, casterFeet);
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

  /** #2 level 0: model-702 projectile, attached shade and texture-0 trail. */
  playDoubleSwing(casterFeet: THREE.Vector3, targetFeet: THREE.Vector3): void {
    if (!this.canPlayAt(casterFeet) || !isFiniteVector(targetFeet)) return;
    const visual = this.acquireDoubleSwingVisual();
    visual.active = true;
    visual.elapsed = 0;
    visual.nextEmission = 0.1;
    visual.serial = ++this.#serial;
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
    this.spawnDoubleSwingParticle(visual.mesh.position);
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

  clear(): void {
    for (const visual of this.#billboardPool) deactivateBillboard(visual);
    for (const visual of this.#groundPool) deactivateGround(visual);
    for (const visual of this.#doubleSwingPool) deactivateDoubleSwing(visual);
    for (const visual of this.#startPool) deactivateStart(visual);
    for (const visual of this.#freezePool) deactivateFreeze(visual);
    for (const visual of this.#judgementPool) deactivateJudgement(visual);
    this.#lastFreezeParticleAt = Number.NEGATIVE_INFINITY;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clear();
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

    this.#billboardPool.length = 0;
    this.#groundPool.length = 0;
    this.#doubleSwingPool.length = 0;
    this.#startPool.length = 0;
    this.#freezePool.length = 0;
    this.#judgementPool.length = 0;
    this.#planeGeometry.dispose();
    this.#fallbackGlow.dispose();
    this.#fallbackDoubleSwingGeometry.dispose();
    this.#fallbackStartGeometry.dispose();
    this.#fallbackFreezeGeometry.dispose();
    this.#fallbackJudgementGeometry.dispose();
    if (this.#resources) disposeClassicResources(this.#resources);
    this.#resources = null;
  }

  private canPlayAt(position: THREE.Vector3): boolean {
    return !this.#disposed && this.#enabled && isFiniteVector(position);
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

  private spawnDoubleSwingParticle(worldPosition: THREE.Vector3): void {
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
      color: 0xffaaffee,
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
    const fade = Math.max(0, Math.sin(progress * Math.PI));
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
    visual.mesh.material.color.setHex(0xaaaaaa);
    visual.mesh.material.opacity = 1;

    const casterGroundY = visual.start.y - 1;
    const targetGroundY = visual.destination.y - 1;
    visual.shade.position.set(
      visual.mesh.position.x,
      THREE.MathUtils.lerp(casterGroundY, targetGroundY, progress) + 0.005,
      visual.mesh.position.z,
    );
    visual.shade.visible = true;
    setFadedColor(visual.shade.material, 0x005533, Math.sin(progress * Math.PI));

    if (visual.elapsed >= visual.nextEmission) {
      this.spawnDoubleSwingParticle(visual.mesh.position);
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
      case 19:
        return resources.iceTexture;
      case 54:
        return resources.holyColumnTexture;
      case 55:
        return resources.holyRingTexture;
      case 56:
        return resources.magicParticleTexture;
      case 91:
        return resources.doubleSwingTexture;
      case 122:
        return resources.hasteRayTexture;
      case 416:
        return resources.judgementRingTexture;
    }
  }

  private async loadClassicResources(
    assets: ClassicAssetSource,
  ): Promise<ClassicTransKnightResources> {
    const [judgementSource, doubleSwingSource, startSource, freezeSource, freezeStormSource] =
      await Promise.all([
        assets.loadModel(10),
        assets.loadModel(702),
        assets.loadModel(703),
        assets.loadModel(706),
        assets.loadModel(707),
      ]);
    if (!judgementSource || !doubleSwingSource || !startSource || !freezeSource || !freezeStormSource) {
      throw new Error("Modelos clássicos 10/702/703/706/707 ausentes do manifesto");
    }
    const judgementTextureFile = judgementSource.textures[0];
    if (!judgementTextureFile) throw new Error("Modelo clássico 10 sem textura de origem");

    let loadedTextures: THREE.Texture[] = [];
    const loadedGeometries: THREE.BufferGeometry[] = [];
    try {
      // Wait for every DDS request before handling a failure. Promise.all can
      // reject early and leak textures whose requests finish after the catch.
      const textureResults = await Promise.allSettled([
        this.loadEffectTexture(assets, 0),
        this.loadEffectTexture(assets, 2),
        this.loadEffectTexture(assets, 7),
        this.loadEffectTexture(assets, 19),
        this.loadEffectTexture(assets, 54),
        this.loadEffectTexture(assets, 54),
        this.loadEffectTexture(assets, 55),
        this.loadEffectTexture(assets, 56),
        this.loadEffectTexture(assets, 91),
        this.loadEffectTexture(assets, 122),
        this.loadEffectTexture(assets, 416),
        this.loadTextureUrl(assets.dataUrl(judgementTextureFile)),
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
        iceTexture,
        holyColumnTexture,
        startTexture,
        holyRingTexture,
        magicParticleTexture,
        doubleSwingTexture,
        hasteRayTexture,
        judgementRingTexture,
        judgementModelTexture,
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

      configureClassicBillboardUvs(particleTexture);
      configureClassicGroundPlaneUvs(slopeTexture);
      configureClassicBillboardUvs(holyColumnTexture);
      configureClassicBillboardUvs(holyRingTexture);
      configureClassicBillboardUvs(magicParticleTexture);
      configureClassicBillboardUvs(hasteRayTexture);
      configureClassicGroundPlaneUvs(judgementRingTexture);

      return {
        judgementGeometry,
        doubleSwingGeometry,
        startGeometry,
        freezeGeometry,
        freezeStormGeometry,
        judgementModelTexture,
        particleTexture,
        slopeTexture,
        shadeTexture,
        iceTexture,
        holyColumnTexture,
        startTexture,
        holyRingTexture,
        magicParticleTexture,
        doubleSwingTexture,
        hasteRayTexture,
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
  resources.judgementModelTexture.dispose();
  resources.particleTexture.dispose();
  resources.slopeTexture.dispose();
  resources.shadeTexture.dispose();
  resources.iceTexture.dispose();
  resources.holyColumnTexture.dispose();
  resources.startTexture.dispose();
  resources.holyRingTexture.dispose();
  resources.magicParticleTexture.dispose();
  resources.doubleSwingTexture.dispose();
  resources.hasteRayTexture.dispose();
  resources.judgementRingTexture.dispose();
}
