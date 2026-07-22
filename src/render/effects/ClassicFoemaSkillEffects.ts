import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import type { ClassicWeaponEffectSegmentSample } from "../../game/player/ClassicPlayerAvatar";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";
import { ClassicFoemaFirePhoenixEffects } from "./ClassicFoemaFirePhoenixEffects";
import { ClassicFoemaBlizzardEffects } from "./ClassicFoemaBlizzardEffects";
import { ClassicFoemaIceSpearEffects } from "./ClassicFoemaIceSpearEffects";
import { ClassicFoemaMagicWeaponEffects } from "./ClassicFoemaMagicWeaponEffects";
import { ClassicFoemaMeteorEffects } from "./ClassicFoemaMeteorEffects";

export type FoemaPoisonEffectLevel = 0 | 1 | 2 | 3;

export interface FoemaPersistentBuffVisualState {
  readonly thunder: boolean;
  readonly magicWeapon: boolean;
  readonly mounted: boolean;
}

const FIRE_EFFECT_LIFETIME_SECONDS = 2.4;
const FIRE_SHADE_LIFETIME_SECONDS = 3.4;
const FIRE_EMISSION_START_SECONDS = FIRE_EFFECT_LIFETIME_SECONDS * 0.01;
const FIRE_EMISSION_INTERVAL_SECONDS = 0.1;
const FIRE_PARTICLE_LIFETIME_SECONDS = 0.5;
const FIRE_PARTICLE_RISE = 3;
const FIRE_PARTICLE_GROWTH_PER_SECOND = 1;
const FIRE_POOL_LIMIT = 8;
const FIRE_PARTICLE_POOL_LIMIT = 64;
const FIRE_SHADE_COLOR = 0x331100;
const FIRE_SHADE_OPACITY = 0x22 / 0xff;

const LIGHTNING_LIFETIME_SECONDS = 2;
const LIGHTNING_FRAME_SECONDS = 0.08;
const LIGHTNING_POOL_LIMIT = 12;
const LIGHTNING_FIRST_COLOR = 0x77aaaa;
const LIGHTNING_SECOND_COLOR = 0x7777aa;
const LIGHTNING_SHADE_COLOR = 0x7777ff;

const POISON_PARTICLE_LIFETIMES_SECONDS = [
  1.5, 1.9, 2.3, 2.7, 3.1, 3.5, 3.9, 4.3, 4.7, 5.1,
] as const;
const POISON_PARTICLE_GROWTH_PER_SECOND = 1;
const POISON_PARTICLE_POOL_LIMIT = 128;
const POISON_MIST_COLORS = [0x33ff66, 0x66ffaa, 0x113388, 0xff8800] as const;

const HASTE_PARTICLE_LIFETIMES_SECONDS = [
  2, 2.3, 2.6, 2.9, 3.2, 3.5, 3.8, 4.1, 4.4, 4.7, 5, 5.3, 5.6, 5.9, 6.2,
] as const;
const HASTE_RAY_LIFETIME_SECONDS = 4;
const HASTE_POOL_LIMIT = 8;
const HASTE_COLOR = 0xff0000;
const HASTE_RAY_ROLL = 2.792527;

const THUNDER_RING_FRAME_SECONDS = 0.08;
const THUNDER_RING_ROTATION_SECONDS = 1;
const THUNDER_RING_COLOR = 0xffdd00;
const THUNDER_CAST_LIFETIME_SECONDS = 2;
const THUNDER_CAST_POOL_LIMIT = 12;

const SHADE_SIZE = 4;
const BILLBOARD_START_DELAY_FRACTION = 0.05;

const EFFECT_TEXTURE_INDICES = [
  7,
  33,
  0,
  45, 46, 47, 48, 49, 50,
  109, 110, 111, 112, 113, 114, 115, 116,
  56,
  52,
] as const;

interface ClassicFoemaResources {
  readonly shadeTexture: THREE.Texture;
  readonly fireTexture: THREE.Texture;
  readonly particleTexture: THREE.Texture;
  readonly lightningFrames: readonly THREE.Texture[];
  readonly thunderRingFrames: readonly THREE.Texture[];
  readonly hasteParticleTexture: THREE.Texture;
  readonly hasteRayTexture: THREE.Texture;
}

interface FireVisual {
  readonly root: THREE.Group;
  readonly shade: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  active: boolean;
  elapsed: number;
  nextEmission: number;
  serial: number;
}

interface FireParticleVisual {
  readonly sprite: THREE.Sprite;
  active: boolean;
  elapsed: number;
  serial: number;
  startY: number;
  baseScale: number;
}

interface LightningVisual {
  readonly root: THREE.Group;
  readonly shade: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly bolts: readonly [THREE.Sprite, THREE.Sprite];
  active: boolean;
  elapsed: number;
  serial: number;
}

interface PoisonParticleVisual {
  readonly sprite: THREE.Sprite;
  active: boolean;
  elapsed: number;
  lifetime: number;
  serial: number;
  groundY: number;
  baseScale: number;
}

interface HasteVisual {
  readonly root: THREE.Group;
  readonly particles: readonly THREE.Sprite[];
  readonly startOffsets: readonly THREE.Vector3[];
  readonly ray: THREE.Sprite;
  active: boolean;
  elapsed: number;
  serial: number;
}

interface ThunderBuffVisual {
  readonly root: THREE.Group;
  readonly rings: readonly [THREE.Sprite, THREE.Sprite];
  active: boolean;
  elapsed: number;
  randomStep: number;
  mounted: boolean;
}

interface ThunderCastVisual {
  readonly root: THREE.Group;
  readonly steadyRings: readonly [THREE.Sprite, THREE.Sprite];
  readonly fadingRings: readonly [THREE.Sprite, THREE.Sprite];
  active: boolean;
  elapsed: number;
  serial: number;
}

/**
 * Retail presentation facade for Foema #32/#33/#34/#35/#36/#37/#38/#39/
 * #40/#41/#44, including the dedicated meteor and skinned controllers.
 *
 * The implementation is a direct, bounded port of TMSkillFire.cpp:8-201,
 * TMSkillThunderBolt.cpp:10-67, TMSkillPoison.cpp:8-66,
 * TMSkillHaste.cpp:5-100 and TMHuman.cpp:9530-9581. Gameplay, sound and
 * affect duration deliberately remain with the caller.
 *
 * Cast positions are actor/target feet in Three.js world space. The persistent
 * thunder position is the owner's visual root (the m_vecSkinPos equivalent);
 * syncPersistentBuffs retains the retail +1.2 Y / +0.5 Z attachment offset.
 */
export class ClassicFoemaSkillEffects {
  readonly object = new THREE.Group();
  readonly #owner: THREE.Object3D;
  readonly #dds = new ClassicDdsTextureLoader();
  readonly #planeGeometry = new THREE.PlaneGeometry(1, 1);
  readonly #fallbackGlow = createFallbackGlowTexture();
  readonly #firePool: FireVisual[] = [];
  readonly #fireParticlePool: FireParticleVisual[] = [];
  readonly #lightningPool: LightningVisual[] = [];
  readonly #poisonParticlePool: PoisonParticleVisual[] = [];
  readonly #hastePool: HasteVisual[] = [];
  readonly #thunderCastPool: ThunderCastVisual[] = [];
  readonly #thunderBuff: ThunderBuffVisual;
  readonly #iceSpearEffects: ClassicFoemaIceSpearEffects;
  readonly #firePhoenixEffects: ClassicFoemaFirePhoenixEffects;
  readonly #magicWeaponEffects: ClassicFoemaMagicWeaponEffects;
  readonly #meteorEffects: ClassicFoemaMeteorEffects;
  readonly #blizzardEffects: ClassicFoemaBlizzardEffects;
  #resources: ClassicFoemaResources | null = null;
  #preload: Promise<void> | null = null;
  #serial = 0;
  #particleSerial = 0;
  #randomSerial = 0;
  #enabled = true;
  #disposed = false;

  constructor(scene: THREE.Object3D) {
    this.#owner = scene;
    this.object.name = "classic-foema-skill-effects";
    this.#thunderBuff = this.createThunderBuffVisual();
    this.object.add(this.#thunderBuff.root);
    this.#iceSpearEffects = new ClassicFoemaIceSpearEffects(this.object);
    this.#firePhoenixEffects = new ClassicFoemaFirePhoenixEffects(this.object);
    this.#magicWeaponEffects = new ClassicFoemaMagicWeaponEffects(this.object);
    this.#meteorEffects = new ClassicFoemaMeteorEffects(this.object);
    this.#blizzardEffects = new ClassicFoemaBlizzardEffects(this.object);
    scene.add(this.object);
  }

  /** Loads effect textures 0/7/33/45..50/52/56/109..116 exactly once. */
  async prepareClassic(assets: ClassicAssetSource): Promise<void> {
    if (this.#disposed) return;
    if (this.#preload) return this.#preload;

    const coreJob = this.#resources
      ? Promise.resolve()
      : this.loadClassicResources(assets)
      .then((resources) => {
        if (this.#disposed) {
          disposeClassicResources(resources);
          return;
        }
        this.#resources = resources;
        for (const visual of this.#firePool) this.applyFireAssets(visual);
        for (const particle of this.#fireParticlePool) this.applyFireParticleAsset(particle);
        for (const visual of this.#lightningPool) this.applyLightningAssets(visual);
        for (const particle of this.#poisonParticlePool) this.applyPoisonParticleAsset(particle);
        for (const visual of this.#hastePool) this.applyHasteAssets(visual);
        for (const visual of this.#thunderCastPool) this.applyThunderCastAssets(visual);
        this.applyThunderBuffAssets(this.#thunderBuff);
      })
      .catch((error: unknown) => {
        console.warn("Efeitos clássicos da Foema indisponíveis; usando fallback.", error);
      });
    const job = Promise.allSettled([
      coreJob,
      this.#iceSpearEffects.prepareClassic(assets),
      this.#firePhoenixEffects.prepareClassic(assets),
      this.#magicWeaponEffects.prepareClassic(assets),
      this.#meteorEffects.prepareClassic(assets),
      this.#blizzardEffects.prepareClassic(assets),
    ])
      .then((results) => {
        for (const result of results.slice(1)) {
          if (result.status === "rejected") {
            console.warn("Efeito avançado clássico da Foema indisponível; usando fallback.", result.reason);
          }
        }
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
    this.#iceSpearEffects.setEnabled(enabled);
    this.#firePhoenixEffects.setEnabled(enabled);
    this.#magicWeaponEffects.setEnabled(enabled);
    this.#meteorEffects.setEnabled(enabled);
    this.#blizzardEffects.setEnabled(enabled);
    if (!enabled) this.clear();
  }

  update(deltaSeconds: number): void {
    if (this.#disposed || !this.#enabled) return;
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    if (delta === 0) return;

    this.#iceSpearEffects.update(delta);
    this.#firePhoenixEffects.update(delta);
    this.#magicWeaponEffects.update(delta);
    this.#meteorEffects.update(delta);
    this.#blizzardEffects.update(delta);

    // Existing independent children advance before their parent controllers
    // emit this frame, so a newly emitted classic billboard starts at t=0.
    this.updateFireParticles(delta);
    this.updatePoisonParticles(delta);

    for (const visual of this.#firePool) {
      if (!visual.active) continue;
      visual.elapsed += delta;
      this.updateFireVisual(visual);
    }
    for (const visual of this.#lightningPool) {
      if (!visual.active) continue;
      visual.elapsed += delta;
      this.updateLightningVisual(visual);
    }
    for (const visual of this.#hastePool) {
      if (!visual.active) continue;
      visual.elapsed += delta;
      this.updateHasteVisual(visual);
    }
    for (const visual of this.#thunderCastPool) {
      if (!visual.active) continue;
      visual.elapsed += delta;
      this.updateThunderCastVisual(visual);
    }
    if (this.#thunderBuff.active) {
      this.#thunderBuff.elapsed += delta;
      this.updateThunderBuffVisual(this.#thunderBuff);
    }
  }

  /**
   * Numeric dispatch entry point for GameApp. #37 is state-owned and therefore
   * intentionally handled only by syncPersistentBuffs rather than as a burst.
   */
  playCast(
    classicIndex: number,
    worldPosition: THREE.Vector3,
    poisonEffectLevel: FoemaPoisonEffectLevel = 0,
  ): boolean {
    switch (classicIndex) {
      case 32:
        this.playFireAttack(worldPosition);
        return true;
      case 33:
        this.playLightningStrike(worldPosition);
        return true;
      case 40:
        this.playPoisonMist(worldPosition, poisonEffectLevel);
        return true;
      case 41:
        this.playHasteCast(worldPosition);
        return true;
      case 44:
        this.#magicWeaponEffects.playCast(worldPosition);
        return true;
      default:
        return false;
    }
  }

  /** Dedicated offensive dispatch; damage remains authoritative in GameApp. */
  playAttack(
    classicIndex: number,
    casterFeet: THREE.Vector3,
    targetFeet: THREE.Vector3,
    poisonEffectLevel: FoemaPoisonEffectLevel = 0,
  ): boolean {
    switch (classicIndex) {
      case 34:
        this.#iceSpearEffects.play(casterFeet, targetFeet);
        return true;
      case 38:
        this.#firePhoenixEffects.play(casterFeet, targetFeet);
        return true;
      case 35:
      case 39:
        // TMFieldScene creates these at packet time. GameApp owns that timing;
        // the renderer only expands the retail meteor layout around the target.
        this.#meteorEffects.play(classicIndex, targetFeet);
        return true;
      case 36:
        this.#blizzardEffects.play(targetFeet);
        return true;
      default:
        return this.playCast(classicIndex, targetFeet, poisonEffectLevel);
    }
  }

  /** #32: TMSkillFire type 0 — stationary texture-33 fire, never a projectile. */
  playFireAttack(targetWorldPosition: THREE.Vector3): void {
    if (!this.canPlayAt(targetWorldPosition)) return;
    const visual = this.acquireFireVisual();
    visual.active = true;
    visual.elapsed = 0;
    visual.nextEmission = FIRE_EMISSION_START_SECONDS;
    visual.serial = ++this.#serial;
    visual.root.position.copy(targetWorldPosition);
    visual.root.visible = true;
    this.applyFireAssets(visual);
    this.updateFireVisual(visual);
  }

  /**
   * #33: TMSkillThunderBolt type 0 — two six-frame vertical bolts, shade and
   * the ten cyan TMSkillPoison children created by the retail constructor.
   */
  playLightningStrike(targetWorldPosition: THREE.Vector3): void {
    if (!this.canPlayAt(targetWorldPosition)) return;
    const visual = this.acquireLightningVisual();
    visual.active = true;
    visual.elapsed = 0;
    visual.serial = ++this.#serial;
    visual.root.position.copy(targetWorldPosition);
    visual.root.visible = true;
    this.applyLightningAssets(visual);
    this.spawnPoisonParticles(targetWorldPosition, LIGHTNING_FIRST_COLOR);
    this.updateLightningVisual(visual);
  }

  /**
   * #40: TMHuman.cpp:8966-8977 + TMSkillPoison.cpp:18-49. Effect level zero
   * is the normal retail green; the other audited packet colors stay available.
   */
  playPoisonMist(targetWorldPosition: THREE.Vector3, effectLevel: FoemaPoisonEffectLevel = 0): void {
    if (!this.canPlayAt(targetWorldPosition)) return;
    this.spawnPoisonParticles(targetWorldPosition, POISON_MIST_COLORS[effectLevel]);
  }

  /** #41: TMSkillHaste type 0 — fifteen falling red particles plus ray 52. */
  playHasteCast(ownerWorldPosition: THREE.Vector3): void {
    if (!this.canPlayAt(ownerWorldPosition)) return;
    const visual = this.acquireHasteVisual();
    visual.active = true;
    visual.elapsed = 0;
    visual.serial = ++this.#serial;
    visual.root.position.copy(ownerWorldPosition);
    visual.root.visible = true;

    for (let index = 0; index < visual.startOffsets.length; index++) {
      const randomOffset = classicRandomStep(visual.serial, index, 5) - 3;
      visual.startOffsets[index]!.set(
        randomOffset * 0.1,
        randomOffset * 0.1 + 5,
        randomOffset * 0.1,
      );
    }
    this.applyHasteAssets(visual);
    this.updateHasteVisual(visual);
  }

  /**
   * #37 cast event (TMHuman.cpp:8898-8956): two steady and two fading
   * texture-109 rings live for 2 s. The state-owned m_cLighten pair remains
   * separate in syncPersistentBuffs and lasts for the complete buff.
   */
  playThunderCast(ownerWorldPosition: THREE.Vector3, mounted: boolean): void {
    if (!this.canPlayAt(ownerWorldPosition)) return;
    const visual = this.acquireThunderCastVisual();
    visual.active = true;
    visual.elapsed = 0;
    visual.serial = ++this.#serial;
    visual.root.position.copy(ownerWorldPosition);
    visual.root.position.set(
      visual.root.position.x + 0.5,
      visual.root.position.y + 1.8,
      visual.root.position.z + 0.5,
    );
    visual.root.visible = true;
    const mountScale = mounted ? 1.3 : 1;
    for (let index = 0; index < 2; index++) {
      const randomStep = classicRandomStep(++this.#randomSerial, index, 5);
      const baseScale = (randomStep * 0.2 + 1) * mountScale;
      visual.steadyRings[index]!.scale.setScalar(baseScale - index * 0.4);
      visual.fadingRings[index]!.scale.setScalar(baseScale);
    }
    this.applyThunderCastAssets(visual);
    this.updateThunderCastVisual(visual);
  }

  /**
   * #37 persistent TickType 22 state. Call once per frame with the current
   * owner visual root; passing null or thunder=false removes both retail rings.
   */
  syncPersistentBuffs(
    ownerWorldPosition: THREE.Vector3 | null,
    state: FoemaPersistentBuffVisualState,
    weaponSegments: readonly ClassicWeaponEffectSegmentSample[] = [],
    weaponSegmentCount = 0,
  ): void {
    if (this.#disposed) return;
    this.#magicWeaponEffects.syncPersistent(
      this.#enabled && state.magicWeapon,
      weaponSegments,
      weaponSegmentCount,
    );
    const canShow = this.#enabled
      && state.thunder
      && ownerWorldPosition !== null
      && isFiniteVector(ownerWorldPosition);
    if (!canShow) {
      deactivateThunderBuff(this.#thunderBuff);
      return;
    }

    const visual = this.#thunderBuff;
    if (!visual.active) {
      visual.active = true;
      visual.elapsed = 0;
      visual.randomStep = classicRandomStep(++this.#randomSerial, 0, 5);
      visual.root.visible = true;
      this.applyThunderBuffAssets(visual);
    }
    visual.mounted = state.mounted;
    visual.root.position.copy(ownerWorldPosition);
    visual.root.position.y += 1.2;
    visual.root.position.z += 0.5;
    this.updateThunderBuffVisual(visual);
  }

  clear(): void {
    for (const visual of this.#firePool) deactivateFire(visual);
    for (const particle of this.#fireParticlePool) deactivateFireParticle(particle);
    for (const visual of this.#lightningPool) deactivateLightning(visual);
    for (const particle of this.#poisonParticlePool) deactivatePoisonParticle(particle);
    for (const visual of this.#hastePool) deactivateHaste(visual);
    for (const visual of this.#thunderCastPool) deactivateThunderCast(visual);
    deactivateThunderBuff(this.#thunderBuff);
    this.#iceSpearEffects.clear();
    this.#firePhoenixEffects.clear();
    this.#magicWeaponEffects.clear();
    this.#meteorEffects.clear();
    this.#blizzardEffects.clear();
  }

  /** Terminal cleanup; clear() intentionally leaves every bounded pool reusable. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clear();
    this.#iceSpearEffects.dispose();
    this.#firePhoenixEffects.dispose();
    this.#magicWeaponEffects.dispose();
    this.#meteorEffects.dispose();
    this.#blizzardEffects.dispose();
    this.#owner.remove(this.object);

    for (const visual of this.#firePool) visual.shade.material.dispose();
    for (const particle of this.#fireParticlePool) particle.sprite.material.dispose();
    for (const visual of this.#lightningPool) {
      visual.shade.material.dispose();
      for (const bolt of visual.bolts) bolt.material.dispose();
    }
    for (const particle of this.#poisonParticlePool) particle.sprite.material.dispose();
    for (const visual of this.#hastePool) {
      for (const particle of visual.particles) particle.material.dispose();
      visual.ray.material.dispose();
    }
    for (const visual of this.#thunderCastPool) {
      for (const ring of [...visual.steadyRings, ...visual.fadingRings]) ring.material.dispose();
    }
    for (const ring of this.#thunderBuff.rings) ring.material.dispose();

    this.#firePool.length = 0;
    this.#fireParticlePool.length = 0;
    this.#lightningPool.length = 0;
    this.#poisonParticlePool.length = 0;
    this.#hastePool.length = 0;
    this.#thunderCastPool.length = 0;
    this.#planeGeometry.dispose();
    this.#fallbackGlow.dispose();
    if (this.#resources) disposeClassicResources(this.#resources);
    this.#resources = null;
  }

  private canPlayAt(position: THREE.Vector3): boolean {
    return !this.#disposed && this.#enabled && isFiniteVector(position);
  }

  private acquireFireVisual(): FireVisual {
    const free = this.#firePool.find((visual) => !visual.active);
    if (free) return free;
    if (this.#firePool.length < FIRE_POOL_LIMIT) {
      const visual = this.createFireVisual(this.#firePool.length);
      this.#firePool.push(visual);
      this.object.add(visual.root);
      return visual;
    }
    const oldest = oldestBySerial(this.#firePool);
    deactivateFire(oldest);
    return oldest;
  }

  private createFireVisual(index: number): FireVisual {
    const root = new THREE.Group();
    root.name = `classic-foema-fire-attack-${index}`;
    root.visible = false;
    const shade = this.createShade("classic-foema-fire-shade-7", FIRE_SHADE_COLOR);
    root.add(shade);
    return {
      root,
      shade,
      active: false,
      elapsed: 0,
      nextEmission: FIRE_EMISSION_START_SECONDS,
      serial: 0,
    };
  }

  private applyFireAssets(visual: FireVisual): void {
    setMaterialMap(visual.shade.material, this.#resources?.shadeTexture ?? this.#fallbackGlow);
    visual.shade.material.color.setHex(FIRE_SHADE_COLOR);
  }

  private updateFireVisual(visual: FireVisual): void {
    const shadeProgress = Math.min(1, visual.elapsed / FIRE_SHADE_LIFETIME_SECONDS);
    visual.shade.visible = visual.elapsed < FIRE_SHADE_LIFETIME_SECONDS;
    visual.shade.material.opacity = FIRE_SHADE_OPACITY * Math.max(0, Math.sin(shadeProgress * Math.PI));

    const emissionEnd = Math.min(visual.elapsed, FIRE_EFFECT_LIFETIME_SECONDS);
    while (visual.nextEmission <= emissionEnd) {
      this.spawnFireParticle(visual.root.position);
      visual.nextEmission += FIRE_EMISSION_INTERVAL_SECONDS;
    }

    if (visual.elapsed >= FIRE_SHADE_LIFETIME_SECONDS) deactivateFire(visual);
  }

  private spawnFireParticle(worldPosition: THREE.Vector3): void {
    const particle = this.acquireFireParticle();
    const serial = ++this.#particleSerial;
    const offset = classicRandomStep(serial, 0, 5) * 0.01;
    particle.active = true;
    particle.elapsed = 0;
    particle.serial = serial;
    particle.startY = worldPosition.y;
    particle.baseScale = 0.7;
    particle.sprite.position.set(worldPosition.x + offset, worldPosition.y, worldPosition.z + offset);
    particle.sprite.scale.setScalar(particle.baseScale);
    particle.sprite.material.color.setHex(0xffffff);
    particle.sprite.material.opacity = 0;
    particle.sprite.visible = true;
    this.applyFireParticleAsset(particle);
  }

  private acquireFireParticle(): FireParticleVisual {
    const free = this.#fireParticlePool.find((particle) => !particle.active);
    if (free) return free;
    if (this.#fireParticlePool.length < FIRE_PARTICLE_POOL_LIMIT) {
      const sprite = createBrightSprite(
        this.#fallbackGlow,
        0xffffff,
        `classic-foema-fire-particle-${this.#fireParticlePool.length}`,
      );
      const particle: FireParticleVisual = {
        sprite,
        active: false,
        elapsed: 0,
        serial: 0,
        startY: 0,
        baseScale: 0.7,
      };
      this.#fireParticlePool.push(particle);
      this.object.add(sprite);
      return particle;
    }
    const oldest = oldestBySerial(this.#fireParticlePool);
    deactivateFireParticle(oldest);
    return oldest;
  }

  private applyFireParticleAsset(particle: FireParticleVisual): void {
    setMaterialMap(particle.sprite.material, this.#resources?.fireTexture ?? this.#fallbackGlow);
  }

  private updateFireParticles(deltaSeconds: number): void {
    for (const particle of this.#fireParticlePool) {
      if (!particle.active) continue;
      particle.elapsed += deltaSeconds;
      if (particle.elapsed >= FIRE_PARTICLE_LIFETIME_SECONDS) {
        deactivateFireParticle(particle);
        continue;
      }
      const progress = particle.elapsed / FIRE_PARTICLE_LIFETIME_SECONDS;
      const scale = particle.baseScale + particle.elapsed * FIRE_PARTICLE_GROWTH_PER_SECOND;
      particle.sprite.position.y = particle.startY + progress * FIRE_PARTICLE_RISE;
      particle.sprite.scale.setScalar(scale);
      particle.sprite.material.opacity = billboardOpacity(progress);
      particle.sprite.visible = progress >= BILLBOARD_START_DELAY_FRACTION;
    }
  }

  private acquireLightningVisual(): LightningVisual {
    const free = this.#lightningPool.find((visual) => !visual.active);
    if (free) return free;
    if (this.#lightningPool.length < LIGHTNING_POOL_LIMIT) {
      const visual = this.createLightningVisual(this.#lightningPool.length);
      this.#lightningPool.push(visual);
      this.object.add(visual.root);
      return visual;
    }
    const oldest = oldestBySerial(this.#lightningPool);
    deactivateLightning(oldest);
    return oldest;
  }

  private createLightningVisual(index: number): LightningVisual {
    const root = new THREE.Group();
    root.name = `classic-foema-lightning-${index}`;
    root.visible = false;
    const shade = this.createShade("classic-foema-lightning-shade-7", LIGHTNING_SHADE_COLOR);
    const first = createBrightSprite(
      this.#fallbackGlow,
      LIGHTNING_FIRST_COLOR,
      `classic-foema-lightning-45-primary-${index}`,
    );
    const second = createBrightSprite(
      this.#fallbackGlow,
      LIGHTNING_SECOND_COLOR,
      `classic-foema-lightning-45-secondary-${index}`,
    );
    for (const bolt of [first, second]) {
      // m_bStickGround adds scaleY/2 to vecPosition.y - 1.0.
      bolt.position.y = 4;
      bolt.scale.set(0.55, 10, 1);
      bolt.renderOrder = 8;
    }
    root.add(shade, first, second);
    return { root, shade, bolts: [first, second], active: false, elapsed: 0, serial: 0 };
  }

  private applyLightningAssets(visual: LightningVisual): void {
    setMaterialMap(visual.shade.material, this.#resources?.shadeTexture ?? this.#fallbackGlow);
    visual.shade.material.color.setHex(LIGHTNING_SHADE_COLOR);
    const frames = this.#resources?.lightningFrames;
    const frame = frames?.[Math.floor(visual.elapsed / LIGHTNING_FRAME_SECONDS) % frames.length]
      ?? this.#fallbackGlow;
    setMaterialMap(visual.bolts[0].material, frame);
    setMaterialMap(visual.bolts[1].material, frame);
    visual.bolts[0].material.color.setHex(LIGHTNING_FIRST_COLOR);
    visual.bolts[1].material.color.setHex(LIGHTNING_SECOND_COLOR);
  }

  private updateLightningVisual(visual: LightningVisual): void {
    if (visual.elapsed >= LIGHTNING_LIFETIME_SECONDS) {
      deactivateLightning(visual);
      return;
    }
    const progress = visual.elapsed / LIGHTNING_LIFETIME_SECONDS;
    const visible = progress >= BILLBOARD_START_DELAY_FRACTION;
    const frames = this.#resources?.lightningFrames;
    const frame = frames?.[Math.floor(visual.elapsed / LIGHTNING_FRAME_SECONDS) % frames.length]
      ?? this.#fallbackGlow;
    for (const bolt of visual.bolts) {
      setMaterialMap(bolt.material, frame);
      bolt.material.opacity = 1;
      bolt.visible = visible;
    }
    visual.shade.visible = true;
    visual.shade.material.opacity = Math.max(0, Math.sin(progress * Math.PI));
  }

  private spawnPoisonParticles(worldPosition: THREE.Vector3, color: number): void {
    for (let index = 0; index < POISON_PARTICLE_LIFETIMES_SECONDS.length; index++) {
      const particle = this.acquirePoisonParticle();
      const serial = ++this.#particleSerial;
      const scaleStep = classicRandomStep(serial, 0, 5);
      const offsetZ = classicRandomStep(serial, 1, 10) - 5;
      const offsetX = classicRandomStep(serial, 2, 10) - 5;
      particle.active = true;
      particle.elapsed = 0;
      particle.lifetime = POISON_PARTICLE_LIFETIMES_SECONDS[index]!;
      particle.serial = serial;
      particle.groundY = worldPosition.y;
      particle.baseScale = scaleStep * 0.1 + 0.2;
      particle.sprite.position.set(
        worldPosition.x + offsetX * 0.1,
        worldPosition.y + particle.baseScale / 2,
        worldPosition.z + offsetZ * 0.1,
      );
      particle.sprite.scale.setScalar(particle.baseScale);
      particle.sprite.material.color.setHex(color);
      particle.sprite.material.opacity = 0;
      particle.sprite.visible = true;
      this.applyPoisonParticleAsset(particle);
    }
  }

  private acquirePoisonParticle(): PoisonParticleVisual {
    const free = this.#poisonParticlePool.find((particle) => !particle.active);
    if (free) return free;
    if (this.#poisonParticlePool.length < POISON_PARTICLE_POOL_LIMIT) {
      const sprite = createBrightSprite(
        this.#fallbackGlow,
        POISON_MIST_COLORS[0],
        `classic-foema-poison-particle-${this.#poisonParticlePool.length}`,
      );
      const particle: PoisonParticleVisual = {
        sprite,
        active: false,
        elapsed: 0,
        lifetime: POISON_PARTICLE_LIFETIMES_SECONDS[0],
        serial: 0,
        groundY: 0,
        baseScale: 0.2,
      };
      this.#poisonParticlePool.push(particle);
      this.object.add(sprite);
      return particle;
    }
    const oldest = oldestBySerial(this.#poisonParticlePool);
    deactivatePoisonParticle(oldest);
    return oldest;
  }

  private applyPoisonParticleAsset(particle: PoisonParticleVisual): void {
    setMaterialMap(particle.sprite.material, this.#resources?.particleTexture ?? this.#fallbackGlow);
  }

  private updatePoisonParticles(deltaSeconds: number): void {
    for (const particle of this.#poisonParticlePool) {
      if (!particle.active) continue;
      particle.elapsed += deltaSeconds;
      if (particle.elapsed >= particle.lifetime) {
        deactivatePoisonParticle(particle);
        continue;
      }
      const progress = particle.elapsed / particle.lifetime;
      const scale = particle.baseScale + particle.elapsed * POISON_PARTICLE_GROWTH_PER_SECOND;
      particle.sprite.scale.setScalar(scale);
      particle.sprite.position.y = particle.groundY + scale / 2;
      particle.sprite.material.opacity = billboardOpacity(progress);
      particle.sprite.visible = progress >= BILLBOARD_START_DELAY_FRACTION;
    }
  }

  private acquireHasteVisual(): HasteVisual {
    const free = this.#hastePool.find((visual) => !visual.active);
    if (free) return free;
    if (this.#hastePool.length < HASTE_POOL_LIMIT) {
      const visual = this.createHasteVisual(this.#hastePool.length);
      this.#hastePool.push(visual);
      this.object.add(visual.root);
      return visual;
    }
    const oldest = oldestBySerial(this.#hastePool);
    deactivateHaste(oldest);
    return oldest;
  }

  private createHasteVisual(index: number): HasteVisual {
    const root = new THREE.Group();
    root.name = `classic-foema-haste-${index}`;
    root.visible = false;
    const startOffsets = HASTE_PARTICLE_LIFETIMES_SECONDS.map(() => new THREE.Vector3());
    const particles = HASTE_PARTICLE_LIFETIMES_SECONDS.map((_, particleIndex) => {
      const particle = createBrightSprite(
        this.#fallbackGlow,
        HASTE_COLOR,
        `classic-foema-haste-particle-56-${index}-${particleIndex}`,
      );
      const scale = (particleIndex % 2) * 0.1 + 0.1;
      particle.scale.setScalar(scale);
      root.add(particle);
      return particle;
    });
    const ray = createBrightSprite(
      this.#fallbackGlow,
      0xffffff,
      `classic-foema-haste-ray-52-${index}`,
    );
    ray.position.y = 2;
    ray.scale.set(1.5, 10, 1);
    ray.material.rotation = HASTE_RAY_ROLL;
    ray.renderOrder = 7;
    root.add(ray);
    return { root, particles, startOffsets, ray, active: false, elapsed: 0, serial: 0 };
  }

  private applyHasteAssets(visual: HasteVisual): void {
    const particleTexture = this.#resources?.hasteParticleTexture ?? this.#fallbackGlow;
    for (const particle of visual.particles) {
      setMaterialMap(particle.material, particleTexture);
      particle.material.color.setHex(HASTE_COLOR);
    }
    setMaterialMap(visual.ray.material, this.#resources?.hasteRayTexture ?? this.#fallbackGlow);
    visual.ray.material.color.setHex(0xffffff);
  }

  private updateHasteVisual(visual: HasteVisual): void {
    for (let index = 0; index < visual.particles.length; index++) {
      const particle = visual.particles[index]!;
      const lifetime = HASTE_PARTICLE_LIFETIMES_SECONDS[index]!;
      const progress = Math.min(1, visual.elapsed / lifetime);
      const start = visual.startOffsets[index]!;
      const horizontal = (index % 3) * 0.05 + 0.1;
      const angle = progress * Math.PI * 6;
      particle.position.set(
        start.x + Math.sin(angle) * horizontal,
        start.y - progress * 7,
        start.z + Math.cos(angle) * horizontal,
      );
      particle.visible = visual.elapsed < lifetime && progress >= BILLBOARD_START_DELAY_FRACTION;
      particle.material.opacity = particle.visible ? billboardOpacity(progress) : 0;
    }

    const rayProgress = Math.min(1, visual.elapsed / HASTE_RAY_LIFETIME_SECONDS);
    visual.ray.visible = visual.elapsed < HASTE_RAY_LIFETIME_SECONDS
      && rayProgress >= BILLBOARD_START_DELAY_FRACTION;
    visual.ray.material.opacity = visual.ray.visible ? billboardOpacity(rayProgress) : 0;

    if (visual.elapsed >= HASTE_PARTICLE_LIFETIMES_SECONDS.at(-1)!) deactivateHaste(visual);
  }

  private acquireThunderCastVisual(): ThunderCastVisual {
    const free = this.#thunderCastPool.find((visual) => !visual.active);
    if (free) return free;
    if (this.#thunderCastPool.length < THUNDER_CAST_POOL_LIMIT) {
      const visual = this.createThunderCastVisual(this.#thunderCastPool.length);
      this.#thunderCastPool.push(visual);
      this.object.add(visual.root);
      return visual;
    }
    const oldest = oldestBySerial(this.#thunderCastPool);
    deactivateThunderCast(oldest);
    return oldest;
  }

  private createThunderCastVisual(index: number): ThunderCastVisual {
    const root = new THREE.Group();
    root.name = `classic-foema-thunder-cast-${index}`;
    root.visible = false;
    const createRing = (kind: "steady" | "fade", layer: number): THREE.Sprite => {
      const ring = createBrightSprite(
        this.#fallbackGlow,
        THUNDER_RING_COLOR,
        `classic-foema-thunder-cast-${kind}-109-${index}-${layer}`,
      );
      ring.renderOrder = 8 + layer + (kind === "fade" ? 2 : 0);
      root.add(ring);
      return ring;
    };
    return {
      root,
      steadyRings: [createRing("steady", 0), createRing("steady", 1)],
      fadingRings: [createRing("fade", 0), createRing("fade", 1)],
      active: false,
      elapsed: 0,
      serial: 0,
    };
  }

  private applyThunderCastAssets(visual: ThunderCastVisual): void {
    const frames = this.#resources?.thunderRingFrames;
    const frame = frames?.[Math.floor(visual.elapsed / THUNDER_RING_FRAME_SECONDS) % frames.length]
      ?? this.#fallbackGlow;
    for (const ring of [...visual.steadyRings, ...visual.fadingRings]) {
      setMaterialMap(ring.material, frame);
      ring.material.color.setHex(THUNDER_RING_COLOR);
    }
  }

  private updateThunderCastVisual(visual: ThunderCastVisual): void {
    if (visual.elapsed >= THUNDER_CAST_LIFETIME_SECONDS) {
      deactivateThunderCast(visual);
      return;
    }
    const progress = visual.elapsed / THUNDER_CAST_LIFETIME_SECONDS;
    const visible = progress >= BILLBOARD_START_DELAY_FRACTION;
    const frames = this.#resources?.thunderRingFrames;
    const frame = frames?.[Math.floor(visual.elapsed / THUNDER_RING_FRAME_SECONDS) % frames.length]
      ?? this.#fallbackGlow;
    const rotation = (visual.elapsed % THUNDER_RING_ROTATION_SECONDS)
      / THUNDER_RING_ROTATION_SECONDS * Math.PI * 2;
    for (let index = 0; index < 2; index++) {
      const steady = visual.steadyRings[index]!;
      const fading = visual.fadingRings[index]!;
      setMaterialMap(steady.material, frame);
      setMaterialMap(fading.material, frame);
      steady.material.rotation = rotation + index;
      fading.material.rotation = rotation;
      steady.material.opacity = visible ? 1 : 0;
      fading.material.opacity = visible ? Math.max(0, Math.sin(progress * Math.PI)) : 0;
      steady.visible = visible;
      fading.visible = visible;
    }
  }

  private createThunderBuffVisual(): ThunderBuffVisual {
    const root = new THREE.Group();
    root.name = "classic-foema-thunder-persistent";
    root.visible = false;
    const rings = [0, 1].map((index) => {
      const ring = createBrightSprite(
        this.#fallbackGlow,
        THUNDER_RING_COLOR,
        `classic-foema-thunder-ring-109-${index}`,
      );
      ring.material.opacity = 1;
      ring.renderOrder = 8 + index;
      root.add(ring);
      return ring;
    }) as [THREE.Sprite, THREE.Sprite];
    return { root, rings, active: false, elapsed: 0, randomStep: 0, mounted: false };
  }

  private applyThunderBuffAssets(visual: ThunderBuffVisual): void {
    const frames = this.#resources?.thunderRingFrames;
    const frame = frames?.[Math.floor(visual.elapsed / THUNDER_RING_FRAME_SECONDS) % frames.length]
      ?? this.#fallbackGlow;
    for (const ring of visual.rings) {
      setMaterialMap(ring.material, frame);
      ring.material.color.setHex(THUNDER_RING_COLOR);
    }
  }

  private updateThunderBuffVisual(visual: ThunderBuffVisual): void {
    if (!visual.active) return;
    const frames = this.#resources?.thunderRingFrames;
    const frame = frames?.[Math.floor(visual.elapsed / THUNDER_RING_FRAME_SECONDS) % frames.length]
      ?? this.#fallbackGlow;
    const baseScale = visual.mounted ? 1.3 : 2;
    const rotation = (visual.elapsed % THUNDER_RING_ROTATION_SECONDS)
      / THUNDER_RING_ROTATION_SECONDS * Math.PI * 2;
    for (let index = 0; index < visual.rings.length; index++) {
      const ring = visual.rings[index]!;
      const scale = (visual.randomStep * 0.2 + 1) * baseScale - index * 0.4;
      setMaterialMap(ring.material, frame);
      ring.scale.setScalar(scale);
      ring.material.rotation = rotation + index;
      ring.material.opacity = 1;
      ring.visible = true;
    }
  }

  private createShade(name: string, color: number): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
    const shade = new THREE.Mesh(
      this.#planeGeometry,
      createBrightMaterial(this.#fallbackGlow, color),
    );
    shade.name = name;
    shade.rotation.x = -Math.PI / 2;
    shade.position.y = 0.05;
    shade.scale.set(SHADE_SIZE, SHADE_SIZE, 1);
    shade.renderOrder = 4;
    return shade;
  }

  private async loadClassicResources(assets: ClassicAssetSource): Promise<ClassicFoemaResources> {
    const results = await Promise.allSettled(
      EFFECT_TEXTURE_INDICES.map((index) => this.loadTexture(assets, index)),
    );
    const loaded = results
      .filter((result): result is PromiseFulfilledResult<THREE.Texture> => result.status === "fulfilled")
      .map((result) => result.value);
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure || loaded.length !== EFFECT_TEXTURE_INDICES.length) {
      for (const texture of loaded) texture.dispose();
      throw failure?.reason ?? new Error("Texturas clássicas da Foema incompletas");
    }

    const textures = results.map((result) => (result as PromiseFulfilledResult<THREE.Texture>).value);
    const shadeTexture = textures[0]!;
    const fireTexture = textures[1]!;
    const particleTexture = textures[2]!;
    const lightningFrames = textures.slice(3, 9);
    const thunderRingFrames = textures.slice(9, 17);
    const hasteParticleTexture = textures[17]!;
    const hasteRayTexture = textures[18]!;

    // TMEffectBillBoard.cpp:35-64 uses a .02 inset for every texture except
    // texture 33, whose fire quad deliberately samples the full DDS frame.
    configureClassicBillboardUvs(fireTexture, true);
    configureClassicBillboardUvs(particleTexture, false);
    for (const texture of lightningFrames) configureClassicBillboardUvs(texture, false);
    for (const texture of thunderRingFrames) configureClassicBillboardUvs(texture, false);
    configureClassicBillboardUvs(hasteParticleTexture, false);
    configureClassicBillboardUvs(hasteRayTexture, false);

    return {
      shadeTexture,
      fireTexture,
      particleTexture,
      lightningFrames,
      thunderRingFrames,
      hasteParticleTexture,
      hasteRayTexture,
    };
  }

  private async loadTexture(assets: ClassicAssetSource, index: number): Promise<THREE.Texture> {
    const url = assets.effectTextureUrl(index);
    if (!url) throw new Error(`Textura de efeito ${index} ausente`);
    const texture = await this.#dds.loadAsync(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  }
}

function createBrightMaterial(texture: THREE.Texture, color: number): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color,
    transparent: true,
    opacity: 0,
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

function createBrightSprite(texture: THREE.Texture, color: number, name: string): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: texture,
    color,
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
  sprite.renderOrder = 6;
  return sprite;
}

function setMaterialMap(material: THREE.MeshBasicMaterial | THREE.SpriteMaterial, texture: THREE.Texture): void {
  if (material.map === texture) return;
  material.map = texture;
  material.needsUpdate = true;
}

function billboardOpacity(progress: number): number {
  if (progress < BILLBOARD_START_DELAY_FRACTION || progress >= 1) return 0;
  return Math.max(0, Math.sin(progress * Math.PI));
}

function deactivateFire(visual: FireVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.nextEmission = FIRE_EMISSION_START_SECONDS;
  visual.root.visible = false;
  visual.shade.visible = false;
  visual.shade.material.opacity = 0;
}

function deactivateFireParticle(particle: FireParticleVisual): void {
  particle.active = false;
  particle.elapsed = 0;
  particle.sprite.visible = false;
  particle.sprite.material.opacity = 0;
}

function deactivateLightning(visual: LightningVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.root.visible = false;
  visual.shade.visible = false;
  visual.shade.material.opacity = 0;
  for (const bolt of visual.bolts) {
    bolt.visible = false;
    bolt.material.opacity = 0;
  }
}

function deactivatePoisonParticle(particle: PoisonParticleVisual): void {
  particle.active = false;
  particle.elapsed = 0;
  particle.sprite.visible = false;
  particle.sprite.material.opacity = 0;
}

function deactivateHaste(visual: HasteVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.root.visible = false;
  for (const particle of visual.particles) {
    particle.visible = false;
    particle.material.opacity = 0;
  }
  visual.ray.visible = false;
  visual.ray.material.opacity = 0;
}

function deactivateThunderCast(visual: ThunderCastVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.root.visible = false;
  for (const ring of [...visual.steadyRings, ...visual.fadingRings]) {
    ring.visible = false;
    ring.material.opacity = 0;
  }
}

function deactivateThunderBuff(visual: ThunderBuffVisual): void {
  if (!visual.active && !visual.root.visible) return;
  visual.active = false;
  visual.elapsed = 0;
  visual.root.visible = false;
  for (const ring of visual.rings) {
    ring.visible = false;
    ring.material.opacity = 0;
  }
}

function oldestBySerial<T extends { serial: number }>(visuals: readonly T[]): T {
  let oldest = visuals[0]!;
  for (const visual of visuals) {
    if (visual.serial < oldest.serial) oldest = visual;
  }
  return oldest;
}

/** Deterministic stand-in for the retail client's sequential rand() calls. */
function classicRandomStep(serial: number, lane: number, modulus: number): number {
  const seed = Math.imul(serial + lane * 0x9e37, 1_103_515_245) + 12_345;
  return (seed >>> 16) % modulus;
}

function configureClassicBillboardUvs(texture: THREE.Texture, fullFrame: boolean): void {
  texture.offset.set(fullFrame ? 0 : 0.02, fullFrame ? 1 : 0.98);
  texture.repeat.set(fullFrame ? 1 : 0.96, fullFrame ? -1 : -0.96);
  texture.needsUpdate = true;
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
  texture.name = "classic-foema-effect-fallback";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function disposeClassicResources(resources: ClassicFoemaResources): void {
  resources.shadeTexture.dispose();
  resources.fireTexture.dispose();
  resources.particleTexture.dispose();
  for (const texture of resources.lightningFrames) texture.dispose();
  for (const texture of resources.thunderRingFrames) texture.dispose();
  resources.hasteParticleTexture.dispose();
  resources.hasteRayTexture.dispose();
}

function isFiniteVector(position: THREE.Vector3): boolean {
  return Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
}
