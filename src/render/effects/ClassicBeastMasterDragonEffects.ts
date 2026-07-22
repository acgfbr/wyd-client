import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import {
  ClassicSkinnedAssetLibrary,
  type ClassicSkinnedInstanceLease,
} from "../../game/npcs/ClassicSkinnedAssetLibrary";
import {
  MonsterCatalog,
  type MonsterVisualFamily,
} from "../../game/npcs/MonsterCatalog";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";

type ClassicDragonSkillIndex = 48 | 49;
type DragonMode = "inactive" | "flight" | "orbit";

// Skill cooldown/range permit only one live projectile of each type in the
// local-player runtime. A spare avoids allocation churn without cloning six
// complete skinned rigs per skill during boot (important on mobile GPUs).
const DRAGON_POOL_PER_SKILL = 2;
const JUDGEMENT_POOL_LIMIT = 16;
const TRAIL_POOL_LIMIT = 512;
const FIRE_EMITTER_POOL_LIMIT = 16;
const FIRE_PARTICLE_POOL_LIMIT = 128;
const FIRE_SHADE_POOL_LIMIT = 24;

const FLIGHT_VISIBLE_FRACTION = 0.01;
const PARTICLE_VISIBLE_FRACTION = 0.05;
const MAX_FLIGHT_LIFETIME_SECONDS = 5;
const ORBIT_LIFETIME_SECONDS = 3;
const ORBIT_RADIUS = 1;
const ORBIT_HEIGHT = 0.5;
const ORBIT_RADIANS_PER_SECOND = Math.PI * 2;

const TRAIL_STEP_SECONDS = 1 / 60;
// TMEffectSkinMesh emits once per FrameMove and never catches up missed frames.
const MAX_TRAIL_STEPS_PER_UPDATE = 1;
const FIRE_LIFETIME_SECONDS = 2.4;
const FIRE_EMISSION_INTERVAL_SECONDS = 0.1;
const FIRE_FIRST_EMISSION_SECONDS = FIRE_LIFETIME_SECONDS * 0.01;
const FIRE_PARTICLE_LIFETIME_SECONDS = 0.5;
const FIRE_SHADE_LIFETIME_SECONDS = 3.4;
const FIRE_FRAME_MILLISECONDS = 11;
const FIRE_TEXTURE_INDICES = [33, 34, 35, 36, 37, 38, 39, 40, 41] as const;

const JUDGEMENT_LIFETIME_SECONDS = 3;
const JUDGEMENT_CONTROLLER_LIFETIME_SECONDS = 0.6;
const JUDGEMENT_VISIBLE_AFTER_SECONDS = JUDGEMENT_LIFETIME_SECONDS * 0.05;
const GROUND_Y_OFFSET = 0.015;

const DRAGON_LOOKS: Readonly<Record<ClassicDragonSkillIndex, {
  readonly action: "RUN" | "ATTACK1";
  readonly mesh0: string;
  readonly mesh1: string;
  readonly texture: string;
  readonly scale: number;
  /** Retail animation table quarter-step divided by the effect's forced FPS. */
  readonly animationRate: number;
}>> = {
  48: {
    action: "RUN",
    mesh0: "monsters/meshes/dr010105.msh",
    mesh1: "monsters/meshes/dr010205.msh",
    texture: "monsters/textures/dr010106.dds",
    scale: 0.4,
    animationRate: 20 / 5,
  },
  49: {
    action: "ATTACK1",
    mesh0: "monsters/meshes/dr010103.msh",
    mesh1: "monsters/meshes/dr010203.msh",
    texture: "monsters/textures/dr010103.dds",
    scale: 0.2,
    animationRate: 22 / 4,
  },
};

interface DragonEffectResources {
  readonly library: ClassicSkinnedAssetLibrary;
  readonly trailTexture: THREE.Texture;
  readonly fireShadeTexture: THREE.Texture;
  readonly fireTextures: readonly THREE.Texture[];
  readonly judgementTexture: THREE.Texture;
  readonly judgementCenterTexture: THREE.Texture;
  readonly dragons48: readonly DragonVisual[];
  readonly dragons49: readonly DragonVisual[];
}

interface DragonVisual {
  readonly root: THREE.Group;
  readonly lease: ClassicSkinnedInstanceLease;
  readonly materials: readonly THREE.MeshLambertMaterial[];
  readonly start: THREE.Vector3;
  readonly destination: THREE.Vector3;
  readonly lastPosition: THREE.Vector3;
  readonly orbitCenter: THREE.Vector3;
  readonly skill: ClassicDragonSkillIndex;
  mode: DragonMode;
  elapsed: number;
  lifetime: number;
  nextTrailAt: number;
  flightClassicAngle: number;
  orbitStartAngle: number;
  serial: number;
  followTarget: (() => THREE.Vector3 | null) | null;
}

interface JudgementVisual {
  readonly root: THREE.Group;
  readonly outerFast: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly outerSlow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly center: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  active: boolean;
  elapsed: number;
  serial: number;
}

interface TrailParticleVisual {
  readonly sprite: THREE.Sprite;
  readonly basePosition: THREE.Vector3;
  active: boolean;
  elapsed: number;
  lifetime: number;
  baseScale: number;
  color: number;
  serial: number;
}

interface FireEmitterVisual {
  readonly position: THREE.Vector3;
  active: boolean;
  elapsed: number;
  nextEmission: number;
  serial: number;
}

interface FireParticleVisual {
  readonly sprite: THREE.Sprite;
  readonly basePosition: THREE.Vector3;
  active: boolean;
  elapsed: number;
  serial: number;
}

interface FireShadeVisual {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  active: boolean;
  elapsed: number;
  serial: number;
}

/**
 * Presentation-only port of BeastMaster skill records #48 and #49.
 *
 * Both public positions are actor feet in Three.js world space. The exact
 * dr01 rigs and the retail scene-Z conversion are applied internally. The
 * `Render(0, 1, 0)` arguments in TMEffectSkinMesh do not translate these
 * models because TMSkinMesh keeps `m_bBaseMat = 0`; their roots stay at the
 * interpolated ground height. Damage, hit timing, sound 155/156 and server
 * authority remain with the caller.
 */
export class ClassicBeastMasterDragonEffects {
  readonly object = new THREE.Group();
  readonly #owner: THREE.Object3D;
  readonly #dds = new ClassicDdsTextureLoader();
  readonly #planeGeometry = new THREE.PlaneGeometry(1, 1);
  readonly #dragons48: DragonVisual[] = [];
  readonly #dragons49: DragonVisual[] = [];
  readonly #judgements: JudgementVisual[] = [];
  readonly #trailParticles: TrailParticleVisual[] = [];
  readonly #fireEmitters: FireEmitterVisual[] = [];
  readonly #fireParticles: FireParticleVisual[] = [];
  readonly #fireShades: FireShadeVisual[] = [];
  readonly #scratchPosition = new THREE.Vector3();
  #resources: DragonEffectResources | null = null;
  #preload: Promise<void> | null = null;
  #serial = 0;
  #randomSerial = 0;
  #enabled = true;
  #disposed = false;

  constructor(parent: THREE.Object3D) {
    this.#owner = parent;
    this.object.name = "classic-beastmaster-dragon-effects";
    parent.add(this.object);
  }

  /** Prepares the exact Basilisco/Dracorich effect rigs and five DDS layers. */
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
        this.#dragons48.push(...resources.dragons48);
        this.#dragons49.push(...resources.dragons49);
        for (const dragon of [...this.#dragons48, ...this.#dragons49]) {
          this.object.add(dragon.root);
        }
      })
      .catch((error: unknown) => {
        console.warn("Dragões clássicos das skills 48/49 do BeastMaster indisponíveis.", error);
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

  /**
   * Starts the retail judgement + flying dr01 effect. Skill #48 explodes into
   * fire; #49 keeps the same Dracorich and orbits the followed target.
   */
  play(
    classicIndex: ClassicDragonSkillIndex,
    casterFeet: THREE.Vector3,
    targetFeet: THREE.Vector3,
    followTarget?: () => THREE.Vector3 | null,
  ): boolean {
    if (
      this.#disposed
      || !this.#enabled
      || !this.#resources
      || (classicIndex !== 48 && classicIndex !== 49)
      || !isFiniteVector(casterFeet)
      || !isFiniteVector(targetFeet)
    ) {
      return false;
    }

    this.spawnJudgement(casterFeet);
    const dragon = this.acquireDragon(classicIndex);
    const look = DRAGON_LOOKS[classicIndex];
    dragon.mode = "flight";
    dragon.elapsed = 0;
    dragon.nextTrailAt = TRAIL_STEP_SECONDS;
    dragon.serial = ++this.#serial;
    dragon.followTarget = followTarget ?? null;
    dragon.start.copy(casterFeet);
    dragon.destination.copy(targetFeet);
    dragon.lastPosition.copy(casterFeet);
    dragon.orbitCenter.copy(targetFeet);

    const direction = this.#scratchPosition.subVectors(targetFeet, casterFeet);
    dragon.lifetime = THREE.MathUtils.clamp(
      Math.floor(direction.length()) * 0.2,
      0.001,
      MAX_FLIGHT_LIFETIME_SECONDS,
    );
    dragon.flightClassicAngle = classicEffectYaw(casterFeet, targetFeet);
    dragon.orbitStartAngle = dragon.flightClassicAngle;
    dragon.root.position.copy(casterFeet);
    dragon.root.visible = false;
    dragon.lease.model.object.position.set(0, 0, 0);
    dragon.lease.model.play(look.action, true);
    dragon.lease.model.setClassicTransform({
      // TMEffectSkinMesh inherits TMObject::SetAngle, which forwards m_fAngle
      // directly to TMSkinMesh::m_vAngle.y (unlike TMHuman's negated angle).
      yaw: dragon.flightClassicAngle,
      scale: look.scale,
    });
    setDragonIntensity(dragon, 1);
    return true;
  }

  update(deltaSeconds: number): void {
    if (this.#disposed || !this.#enabled) return;
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    if (delta === 0) return;

    // Existing children advance first. A fire/particle spawned by a dragon at
    // the end of this update consequently begins at retail progress zero.
    this.updateJudgements(delta);
    this.updateTrailParticles(delta);
    this.updateFireParticles(delta);
    this.updateFireShades(delta);
    this.updateFireEmitters(delta);
    for (const dragon of this.#dragons48) {
      if (dragon.mode === "flight") this.updateFlight(dragon, delta);
      else if (dragon.mode === "orbit") this.updateOrbit(dragon, delta);
    }
    for (const dragon of this.#dragons49) {
      if (dragon.mode === "flight") this.updateFlight(dragon, delta);
      else if (dragon.mode === "orbit") this.updateOrbit(dragon, delta);
    }
  }

  clear(): void {
    for (const dragon of this.#dragons48) deactivateDragon(dragon);
    for (const dragon of this.#dragons49) deactivateDragon(dragon);
    for (const visual of this.#judgements) deactivateJudgement(visual);
    for (const visual of this.#trailParticles) deactivateTrailParticle(visual);
    for (const visual of this.#fireEmitters) deactivateFireEmitter(visual);
    for (const visual of this.#fireParticles) deactivateFireParticle(visual);
    for (const visual of this.#fireShades) deactivateFireShade(visual);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clear();
    this.#owner.remove(this.object);

    for (const visual of this.#judgements) {
      visual.outerFast.material.dispose();
      visual.outerSlow.material.dispose();
      visual.center.material.dispose();
    }
    for (const visual of this.#trailParticles) visual.sprite.material.dispose();
    for (const visual of this.#fireParticles) visual.sprite.material.dispose();
    for (const visual of this.#fireShades) visual.mesh.material.dispose();
    this.#judgements.length = 0;
    this.#trailParticles.length = 0;
    this.#fireEmitters.length = 0;
    this.#fireParticles.length = 0;
    this.#fireShades.length = 0;
    this.#planeGeometry.dispose();

    if (this.#resources) disposeResources(this.#resources);
    this.#resources = null;
    this.#dragons48.length = 0;
    this.#dragons49.length = 0;
    this.object.clear();
  }

  private acquireDragon(skill: ClassicDragonSkillIndex): DragonVisual {
    const pool = skill === 48 ? this.#dragons48 : this.#dragons49;
    const free = pool.find((visual) => visual.mode === "inactive");
    if (free) return free;
    const oldest = oldestBySerial(pool);
    deactivateDragon(oldest);
    return oldest;
  }

  private updateFlight(dragon: DragonVisual, delta: number): void {
    const previousElapsed = dragon.elapsed;
    dragon.elapsed += delta;
    this.refreshFollowedTarget(dragon, dragon.destination);
    // Motion type 2 recomputes atan2(dx, classicDz)+90 degrees every frame,
    // including while m_pOwner moves. Public scene Z is inverse classic Z.
    dragon.flightClassicAngle = classicEffectYaw(dragon.start, dragon.destination);
    dragon.lease.model.setClassicTransform({
      yaw: dragon.flightClassicAngle,
      scale: DRAGON_LOOKS[dragon.skill].scale,
    });
    const progress = Math.min(1, dragon.elapsed / dragon.lifetime);
    dragon.root.position.lerpVectors(dragon.start, dragon.destination, progress);
    dragon.lastPosition.copy(dragon.root.position);
    dragon.root.visible = progress >= FLIGHT_VISIBLE_FRACTION;
    setDragonIntensity(dragon, Math.cos(progress * Math.PI / 2));
    dragon.lease.model.update(delta * DRAGON_LOOKS[dragon.skill].animationRate);

    this.emitDragonTrailSteps(dragon, previousElapsed, dragon.elapsed, false);
    if (dragon.elapsed < dragon.lifetime) return;

    dragon.root.position.copy(dragon.destination);
    dragon.lastPosition.copy(dragon.destination);
    if (dragon.skill === 48) {
      const impact = this.#scratchPosition.copy(dragon.lastPosition);
      deactivateDragon(dragon);
      this.spawnFire(impact);
      return;
    }

    dragon.mode = "orbit";
    dragon.elapsed = 0;
    dragon.lifetime = ORBIT_LIFETIME_SECONDS;
    dragon.nextTrailAt = TRAIL_STEP_SECONDS;
    dragon.orbitCenter.copy(dragon.destination);
    dragon.orbitStartAngle = dragon.flightClassicAngle;
    dragon.root.visible = true;
    dragon.lease.model.play(DRAGON_LOOKS[49].action, true);
    dragon.lease.model.setClassicTransform({ yaw: 0, scale: DRAGON_LOOKS[49].scale });
    setDragonIntensity(dragon, 1);
    this.setOrbitPosition(dragon, 0, dragon.root.position);
    dragon.lastPosition.copy(dragon.root.position);
  }

  private updateOrbit(dragon: DragonVisual, delta: number): void {
    const previousElapsed = dragon.elapsed;
    dragon.elapsed += delta;
    this.refreshFollowedTarget(dragon, dragon.orbitCenter);
    this.setOrbitPosition(dragon, dragon.elapsed, dragon.root.position);
    dragon.lastPosition.copy(dragon.root.position);
    // motion type 3 restarts table[3] (ATTACK1, quarter-step 22) at FPS 5.
    dragon.lease.model.update(delta * (22 / 5));
    this.emitDragonTrailSteps(dragon, previousElapsed, dragon.elapsed, true);
    if (dragon.elapsed >= ORBIT_LIFETIME_SECONDS) deactivateDragon(dragon);
  }

  private refreshFollowedTarget(dragon: DragonVisual, destination: THREE.Vector3): void {
    if (!dragon.followTarget) return;
    try {
      const followed = dragon.followTarget();
      if (followed && isFiniteVector(followed)) destination.copy(followed);
    } catch {
      // A presentation callback must never stop the render loop.
      dragon.followTarget = null;
    }
  }

  private setOrbitPosition(
    dragon: DragonVisual,
    elapsed: number,
    output: THREE.Vector3,
  ): void {
    const angle = dragon.orbitStartAngle + elapsed * ORBIT_RADIANS_PER_SECOND;
    output.set(
      dragon.orbitCenter.x + Math.cos(angle) * ORBIT_RADIUS,
      dragon.orbitCenter.y + ORBIT_HEIGHT,
      dragon.orbitCenter.z - Math.sin(angle) * ORBIT_RADIUS,
    );
  }

  private emitDragonTrailSteps(
    dragon: DragonVisual,
    previousElapsed: number,
    currentElapsed: number,
    orbit: boolean,
  ): void {
    let emitted = 0;
    const end = Math.min(currentElapsed, dragon.lifetime);
    while (dragon.nextTrailAt <= end && emitted < MAX_TRAIL_STEPS_PER_UPDATE) {
      if (dragon.nextTrailAt > previousElapsed) {
        if (orbit) {
          this.setOrbitPosition(dragon, dragon.nextTrailAt, this.#scratchPosition);
        } else {
          const progress = Math.min(1, dragon.nextTrailAt / dragon.lifetime);
          this.#scratchPosition.lerpVectors(dragon.start, dragon.destination, progress);
        }
        this.spawnTrailPair(this.#scratchPosition, dragon.skill);
        emitted++;
      }
      dragon.nextTrailAt += TRAIL_STEP_SECONDS;
    }
    if (dragon.nextTrailAt <= end) {
      // Drop old emissions after a suspended/background tab instead of
      // allocating a burst on resume.
      dragon.nextTrailAt = end + TRAIL_STEP_SECONDS;
    }
  }

  private spawnTrailPair(position: THREE.Vector3, skill: ClassicDragonSkillIndex): void {
    const color = skill === 48 ? 0xffaa00 : 0xff0000;
    for (let index = 0; index < 2; index++) {
      const particle = this.acquireTrailParticle();
      particle.active = true;
      particle.elapsed = 0;
      particle.lifetime = index === 0 ? 1.5 : 1.9;
      particle.baseScale = 0.2 + classicRandomStep(++this.#randomSerial, 0, 5) * 0.1;
      particle.color = color;
      particle.serial = ++this.#serial;
      particle.basePosition.set(
        position.x + (classicRandomStep(++this.#randomSerial, 1, 10) - 5) * 0.1,
        position.y,
        position.z - (classicRandomStep(++this.#randomSerial, 2, 10) - 5) * 0.1,
      );
      particle.sprite.visible = false;
      particle.sprite.material.color.setHex(color).multiplyScalar(0);
      this.updateTrailParticleVisual(particle);
    }
  }

  private acquireTrailParticle(): TrailParticleVisual {
    const free = this.#trailParticles.find((visual) => !visual.active);
    if (free) return free;
    if (this.#trailParticles.length < TRAIL_POOL_LIMIT) {
      const texture = this.#resources!.trailTexture;
      const sprite = createBrightSprite(
        texture,
        `classic-beastmaster-dragon-trail-${this.#trailParticles.length}`,
      );
      const visual: TrailParticleVisual = {
        sprite,
        basePosition: new THREE.Vector3(),
        active: false,
        elapsed: 0,
        lifetime: 1.5,
        baseScale: 0.2,
        color: 0xffffff,
        serial: 0,
      };
      this.#trailParticles.push(visual);
      this.object.add(sprite);
      return visual;
    }
    const oldest = oldestBySerial(this.#trailParticles);
    deactivateTrailParticle(oldest);
    return oldest;
  }

  private updateTrailParticles(delta: number): void {
    for (const particle of this.#trailParticles) {
      if (!particle.active) continue;
      particle.elapsed += delta;
      this.updateTrailParticleVisual(particle);
    }
  }

  private updateTrailParticleVisual(particle: TrailParticleVisual): void {
    if (particle.elapsed >= particle.lifetime) {
      deactivateTrailParticle(particle);
      return;
    }
    const progress = particle.elapsed / particle.lifetime;
    const scale = particle.baseScale + particle.elapsed;
    particle.sprite.position.copy(particle.basePosition);
    particle.sprite.position.y += scale / 2;
    particle.sprite.scale.set(scale, scale, 1);
    setBrightIntensity(particle.sprite.material, particle.color, Math.sin(progress * Math.PI));
    particle.sprite.visible = progress >= PARTICLE_VISIBLE_FRACTION;
  }

  private spawnJudgement(casterFeet: THREE.Vector3): void {
    const visual = this.acquireJudgement();
    visual.active = true;
    visual.elapsed = 0;
    visual.serial = ++this.#serial;
    visual.root.position.copy(casterFeet);
    visual.root.visible = true;
    visual.outerFast.visible = false;
    visual.outerSlow.visible = false;
    visual.center.visible = false;
    this.updateJudgementVisual(visual);
  }

  private acquireJudgement(): JudgementVisual {
    const free = this.#judgements.find((visual) => !visual.active);
    if (free) return free;
    if (this.#judgements.length < JUDGEMENT_POOL_LIMIT) {
      const judgementTexture = this.#resources!.judgementTexture;
      const centerTexture = this.#resources!.judgementCenterTexture;
      const outerFast = createGroundPlane(
        this.#planeGeometry,
        judgementTexture,
        `classic-beastmaster-judgement-fast-${this.#judgements.length}`,
      );
      const outerSlow = createGroundPlane(
        this.#planeGeometry,
        judgementTexture,
        `classic-beastmaster-judgement-slow-${this.#judgements.length}`,
      );
      const center = createGroundPlane(
        this.#planeGeometry,
        centerTexture,
        `classic-beastmaster-judgement-center-${this.#judgements.length}`,
      );
      outerFast.position.y = 0.31;
      outerSlow.position.y = 0.3;
      center.position.y = 0.3;
      outerFast.scale.set(5.6, 5.6, 1);
      outerSlow.scale.set(5.6, 5.6, 1);
      center.scale.set(2.8, 2.8, 1);
      const root = new THREE.Group();
      root.name = `classic-beastmaster-judgement-${this.#judgements.length}`;
      root.visible = false;
      root.add(outerFast, outerSlow, center);
      const visual: JudgementVisual = {
        root,
        outerFast,
        outerSlow,
        center,
        active: false,
        elapsed: 0,
        serial: 0,
      };
      this.#judgements.push(visual);
      this.object.add(root);
      return visual;
    }
    const oldest = oldestBySerial(this.#judgements);
    deactivateJudgement(oldest);
    return oldest;
  }

  private updateJudgements(delta: number): void {
    for (const visual of this.#judgements) {
      if (!visual.active) continue;
      visual.elapsed += delta;
      this.updateJudgementVisual(visual);
    }
  }

  private updateJudgementVisual(visual: JudgementVisual): void {
    if (visual.elapsed >= JUDGEMENT_LIFETIME_SECONDS) {
      deactivateJudgement(visual);
      return;
    }
    const intensity = Math.sin(visual.elapsed / JUDGEMENT_LIFETIME_SECONDS * Math.PI);
    setBrightIntensity(visual.outerFast.material, 0x3333ff, intensity);
    setBrightIntensity(visual.outerSlow.material, 0xaaaaaa, intensity);
    setBrightIntensity(visual.center.material, 0xaaaaaa, intensity);
    visual.outerFast.rotation.z = visual.elapsed / 0.6 * Math.PI * 2;
    visual.outerSlow.rotation.z = visual.elapsed / 0.9 * Math.PI * 2;
    // The unsigned -900 retail velocity wraps to an effectively static ring.
    visual.center.rotation.z = -visual.elapsed * 0.000_001;
    const visible = visual.elapsed >= JUDGEMENT_VISIBLE_AFTER_SECONDS;
    visual.outerFast.visible = visible
      && visual.elapsed < JUDGEMENT_CONTROLLER_LIFETIME_SECONDS;
    visual.center.visible = visible
      && visual.elapsed < JUDGEMENT_CONTROLLER_LIFETIME_SECONDS;
    // Retail loses this pointer in TMSkillJudgement's destructor; the second
    // ring therefore remains for its own complete three-second lifetime.
    visual.outerSlow.visible = visible;
  }

  private spawnFire(position: THREE.Vector3): void {
    const emitter = this.acquireFireEmitter();
    emitter.active = true;
    emitter.elapsed = 0;
    emitter.nextEmission = FIRE_FIRST_EMISSION_SECONDS;
    emitter.position.copy(position);
    emitter.serial = ++this.#serial;
    this.spawnFireShade(position);
  }

  private acquireFireEmitter(): FireEmitterVisual {
    const free = this.#fireEmitters.find((visual) => !visual.active);
    if (free) return free;
    if (this.#fireEmitters.length < FIRE_EMITTER_POOL_LIMIT) {
      const visual: FireEmitterVisual = {
        position: new THREE.Vector3(),
        active: false,
        elapsed: 0,
        nextEmission: FIRE_FIRST_EMISSION_SECONDS,
        serial: 0,
      };
      this.#fireEmitters.push(visual);
      return visual;
    }
    const oldest = oldestBySerial(this.#fireEmitters);
    deactivateFireEmitter(oldest);
    return oldest;
  }

  private updateFireEmitters(delta: number): void {
    for (const emitter of this.#fireEmitters) {
      if (!emitter.active) continue;
      emitter.elapsed += delta;
      const end = Math.min(emitter.elapsed, FIRE_LIFETIME_SECONDS);
      let emitted = 0;
      while (emitter.nextEmission <= end && emitted < MAX_TRAIL_STEPS_PER_UPDATE) {
        this.spawnFireParticle(emitter.position);
        emitter.nextEmission += FIRE_EMISSION_INTERVAL_SECONDS;
        emitted++;
      }
      if (emitter.nextEmission <= end) {
        emitter.nextEmission = end + FIRE_EMISSION_INTERVAL_SECONDS;
      }
      if (emitter.elapsed >= FIRE_LIFETIME_SECONDS) deactivateFireEmitter(emitter);
    }
  }

  private spawnFireParticle(position: THREE.Vector3): void {
    const particle = this.acquireFireParticle();
    particle.active = true;
    particle.elapsed = 0;
    particle.serial = ++this.#serial;
    particle.basePosition.set(
      position.x + classicRandomStep(++this.#randomSerial, 0, 5) * 0.01,
      position.y,
      position.z - classicRandomStep(++this.#randomSerial, 1, 5) * 0.01,
    );
    particle.sprite.visible = false;
    this.updateFireParticleVisual(particle);
  }

  private acquireFireParticle(): FireParticleVisual {
    const free = this.#fireParticles.find((visual) => !visual.active);
    if (free) return free;
    if (this.#fireParticles.length < FIRE_PARTICLE_POOL_LIMIT) {
      const sprite = createBrightSprite(
        this.#resources!.fireTextures[0]!,
        `classic-beastmaster-dragon-fire-${this.#fireParticles.length}`,
      );
      const visual: FireParticleVisual = {
        sprite,
        basePosition: new THREE.Vector3(),
        active: false,
        elapsed: 0,
        serial: 0,
      };
      this.#fireParticles.push(visual);
      this.object.add(sprite);
      return visual;
    }
    const oldest = oldestBySerial(this.#fireParticles);
    deactivateFireParticle(oldest);
    return oldest;
  }

  private updateFireParticles(delta: number): void {
    for (const particle of this.#fireParticles) {
      if (!particle.active) continue;
      particle.elapsed += delta;
      this.updateFireParticleVisual(particle);
    }
  }

  private updateFireParticleVisual(particle: FireParticleVisual): void {
    if (particle.elapsed >= FIRE_PARTICLE_LIFETIME_SECONDS) {
      deactivateFireParticle(particle);
      return;
    }
    const progress = particle.elapsed / FIRE_PARTICLE_LIFETIME_SECONDS;
    const frames = this.#resources?.fireTextures;
    if (frames?.length) {
      const frameIndex = Math.floor(
        particle.elapsed * 1_000 / FIRE_FRAME_MILLISECONDS,
      ) % frames.length;
      const texture = frames[frameIndex]!;
      if (particle.sprite.material.map !== texture) {
        particle.sprite.material.map = texture;
      }
    }
    const scale = 0.7 + particle.elapsed;
    particle.sprite.position.copy(particle.basePosition);
    particle.sprite.position.y += progress * 3;
    particle.sprite.scale.set(scale, scale, 1);
    setBrightIntensity(particle.sprite.material, 0xffffff, Math.sin(progress * Math.PI));
    particle.sprite.visible = progress >= PARTICLE_VISIBLE_FRACTION;
  }

  private spawnFireShade(position: THREE.Vector3): void {
    const visual = this.acquireFireShade();
    visual.active = true;
    visual.elapsed = 0;
    visual.serial = ++this.#serial;
    visual.mesh.position.set(position.x, position.y + GROUND_Y_OFFSET, position.z);
    visual.mesh.scale.set(8, 8, 1);
    visual.mesh.visible = true;
    setBrightIntensity(visual.mesh.material, 0x331100, 0);
  }

  private acquireFireShade(): FireShadeVisual {
    const free = this.#fireShades.find((visual) => !visual.active);
    if (free) return free;
    if (this.#fireShades.length < FIRE_SHADE_POOL_LIMIT) {
      const mesh = createGroundPlane(
        this.#planeGeometry,
        this.#resources!.fireShadeTexture,
        `classic-beastmaster-dragon-fire-shade-${this.#fireShades.length}`,
      );
      const visual: FireShadeVisual = {
        mesh,
        active: false,
        elapsed: 0,
        serial: 0,
      };
      this.#fireShades.push(visual);
      this.object.add(mesh);
      return visual;
    }
    const oldest = oldestBySerial(this.#fireShades);
    deactivateFireShade(oldest);
    return oldest;
  }

  private updateFireShades(delta: number): void {
    for (const visual of this.#fireShades) {
      if (!visual.active) continue;
      visual.elapsed += delta;
      if (visual.elapsed >= FIRE_SHADE_LIFETIME_SECONDS) {
        deactivateFireShade(visual);
        continue;
      }
      const progress = visual.elapsed / FIRE_SHADE_LIFETIME_SECONDS;
      setBrightIntensity(visual.mesh.material, 0x331100, Math.sin(progress * Math.PI));
    }
  }

  private async loadClassicResources(assets: ClassicAssetSource): Promise<DragonEffectResources> {
    const textureIndices = [0, 7, ...FIRE_TEXTURE_INDICES, 418, 419] as const;
    const textureJob = Promise.allSettled(
      textureIndices.map((index) => this.loadEffectTexture(assets, index)),
    );
    let catalog: MonsterCatalog;
    try {
      // Keep catalog and DDS I/O parallel without leaking completed textures
      // when the catalog request itself fails.
      catalog = await MonsterCatalog.load(assets);
    } catch (error) {
      const completedTextures = await textureJob;
      for (const result of completedTextures) {
        if (result.status === "fulfilled") result.value.dispose();
      }
      throw error;
    }
    const textureResults = await textureJob;
    const textures = textureResults
      .filter((result): result is PromiseFulfilledResult<THREE.Texture> => (
        result.status === "fulfilled"
      ))
      .map((result) => result.value);
    const textureFailure = textureResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (textureFailure || textures.length !== textureIndices.length) {
      for (const texture of textures) texture.dispose();
      throw textureFailure?.reason
        ?? new Error("Texturas 0/7/33..41/418/419 incompletas");
    }

    const family = catalog.visualFamily(20);
    if (!family?.skeleton) {
      for (const texture of textures) texture.dispose();
      throw new Error("Família dr01 (skin 20) ausente do catálogo");
    }

    const library = new ClassicSkinnedAssetLibrary(assets, catalog);
    const created: DragonVisual[] = [];
    try {
      const requestedSkills: ClassicDragonSkillIndex[] = [
        ...Array.from({ length: DRAGON_POOL_PER_SKILL }, () => 48 as const),
        ...Array.from({ length: DRAGON_POOL_PER_SKILL }, () => 49 as const),
      ];
      const results = await Promise.allSettled(
        requestedSkills.map((skill) => this.createDragonVisual(library, family, skill)),
      );
      for (const result of results) {
        if (result.status === "fulfilled" && result.value) created.push(result.value);
      }
      if (
        created.length !== requestedSkills.length
        || results.some((result) => result.status === "rejected")
      ) {
        throw new Error("Rig dr01 incompleto para as skills 48/49");
      }

      const trailTexture = textures[0]!;
      const fireShadeTexture = textures[1]!;
      const fireTextures = textures.slice(2, 2 + FIRE_TEXTURE_INDICES.length);
      const judgementTexture = textures[2 + FIRE_TEXTURE_INDICES.length]!;
      const judgementCenterTexture = textures[3 + FIRE_TEXTURE_INDICES.length]!;
      configureClassicBillboardUvs(trailTexture, false);
      configureClassicGroundPlaneUvs(fireShadeTexture);
      for (const texture of fireTextures) configureClassicBillboardUvs(texture, true);
      configureClassicGroundPlaneUvs(judgementTexture);
      configureClassicGroundPlaneUvs(judgementCenterTexture);
      return {
        library,
        trailTexture,
        fireShadeTexture,
        fireTextures,
        judgementTexture,
        judgementCenterTexture,
        dragons48: created.filter((dragon) => dragon.skill === 48),
        dragons49: created.filter((dragon) => dragon.skill === 49),
      };
    } catch (error) {
      for (const dragon of created) disposeDragon(dragon);
      for (const texture of textures) texture.dispose();
      throw error;
    }
  }

  private async createDragonVisual(
    library: ClassicSkinnedAssetLibrary,
    family: MonsterVisualFamily,
    skill: ClassicDragonSkillIndex,
  ): Promise<DragonVisual | null> {
    const look = DRAGON_LOOKS[skill];
    const lease = await library.createInstance({
      skin: 20,
      family,
      parts: [
        { name: "part-0", mesh: look.mesh0, texture: look.texture, alpha: "N" },
        { name: "part-1", mesh: look.mesh1, texture: look.texture, alpha: "N" },
      ],
      actions: [look.action],
      initialAction: look.action,
    });
    if (!lease) return null;

    const materials: THREE.MeshLambertMaterial[] = [];
    try {
      for (const mesh of lease.model.meshes) {
        const isArray = Array.isArray(mesh.material);
        const sources: THREE.Material[] = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        const clones = sources.map((source) => {
          const clone = source.clone();
          if (!(clone instanceof THREE.MeshLambertMaterial)) {
            clone.dispose();
            throw new Error("Material dr01 incompatível com o renderer clássico");
          }
          configureDragonMaterial(clone, skill);
          materials.push(clone);
          return clone;
        });
        mesh.material = isArray ? clones : clones[0]!;
        mesh.renderOrder = skill === 48 ? 6 : 0;
      }

      const root = new THREE.Group();
      root.name = `classic-beastmaster-dragon-${skill}`;
      root.visible = false;
      lease.model.object.position.set(0, 0, 0);
      lease.model.setClassicTransform({ scale: look.scale, yaw: 0 });
      root.add(lease.model.object);
      return {
        root,
        lease,
        materials,
        start: new THREE.Vector3(),
        destination: new THREE.Vector3(),
        lastPosition: new THREE.Vector3(),
        orbitCenter: new THREE.Vector3(),
        skill,
        mode: "inactive",
        elapsed: 0,
        lifetime: 0,
        nextTrailAt: TRAIL_STEP_SECONDS,
        flightClassicAngle: 0,
        orbitStartAngle: 0,
        serial: 0,
        followTarget: null,
      };
    } catch (error) {
      for (const material of materials) material.dispose();
      lease.release();
      throw error;
    }
  }

  private async loadEffectTexture(
    assets: ClassicAssetSource,
    index: number,
  ): Promise<THREE.Texture> {
    const url = assets.effectTextureUrl(index);
    if (!url) throw new Error(`Textura de efeito ${index} ausente do manifesto`);
    const texture = await this.#dds.loadAsync(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  }
}

function configureDragonMaterial(
  material: THREE.MeshLambertMaterial,
  skill: ClassicDragonSkillIndex,
): void {
  material.color.setHex(0xffffff);
  material.transparent = true;
  material.opacity = 1;
  material.depthTest = true;
  material.alphaTest = 0;
  material.side = THREE.DoubleSide;
  material.toneMapped = false;
  if (skill === 48) {
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;
    material.emissive.setHex(0x4d4d4d);
  } else {
    material.blending = THREE.NormalBlending;
    material.depthWrite = true;
    material.emissive.setHex(0x000000);
  }
  material.needsUpdate = true;
}

function setDragonIntensity(dragon: DragonVisual, intensity: number): void {
  const value = THREE.MathUtils.clamp(intensity, 0, 1);
  for (const material of dragon.materials) {
    material.color.setRGB(value, value, value);
    // TMEffectSkinMesh fades Diffuse through m_color, but EF_BRIGHT writes
    // Emissive=.3 again on every Render. Keep that constant for #48.
    material.opacity = 1;
  }
}

function createBrightMaterial(texture: THREE.Texture): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: 0xffffff,
    transparent: true,
    opacity: 1,
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
    opacity: 1,
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
  const mesh = new THREE.Mesh(geometry, createBrightMaterial(texture));
  mesh.name = name;
  mesh.rotation.x = -Math.PI / 2;
  mesh.visible = false;
  mesh.renderOrder = 4;
  return mesh;
}

function setBrightIntensity(
  material: THREE.MeshBasicMaterial | THREE.SpriteMaterial,
  packedColor: number,
  intensity: number,
): void {
  material.color
    .setHex(packedColor & 0xffffff)
    .multiplyScalar(THREE.MathUtils.clamp(intensity, 0, 1));
  // EF_BRIGHT selects texture alpha; the packed DWORD alpha is not opacity.
  material.opacity = 1;
}

function configureClassicBillboardUvs(texture: THREE.Texture, fullFrame: boolean): void {
  texture.offset.set(fullFrame ? 0 : 0.02, fullFrame ? 1 : 0.98);
  texture.repeat.set(fullFrame ? 1 : 0.96, fullFrame ? -1 : -0.96);
  texture.needsUpdate = true;
}

function configureClassicGroundPlaneUvs(texture: THREE.Texture): void {
  texture.offset.set(0.02, 0.02);
  texture.repeat.set(0.96, 0.96);
  texture.needsUpdate = true;
}

function deactivateDragon(dragon: DragonVisual): void {
  dragon.mode = "inactive";
  dragon.elapsed = 0;
  dragon.followTarget = null;
  dragon.root.visible = false;
}

function deactivateJudgement(visual: JudgementVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.root.visible = false;
  visual.outerFast.visible = false;
  visual.outerSlow.visible = false;
  visual.center.visible = false;
}

function deactivateTrailParticle(visual: TrailParticleVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.sprite.visible = false;
}

function deactivateFireEmitter(visual: FireEmitterVisual): void {
  visual.active = false;
  visual.elapsed = 0;
}

function deactivateFireParticle(visual: FireParticleVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.sprite.visible = false;
}

function deactivateFireShade(visual: FireShadeVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.mesh.visible = false;
}

function oldestBySerial<T extends { serial: number }>(visuals: readonly T[]): T {
  let oldest = visuals[0]!;
  for (const visual of visuals) {
    if (visual.serial < oldest.serial) oldest = visual;
  }
  return oldest;
}

/** Deterministic stand-in for the classic client's sequential rand() calls. */
function classicRandomStep(serial: number, lane: number, modulus: number): number {
  const seed = Math.imul(serial + lane * 0x9e37, 1_103_515_245) + 12_345;
  return (seed >>> 16) % modulus;
}

/** TMEffectSkinMesh motion-2 yaw, converted only at the scene-Z boundary. */
function classicEffectYaw(start: THREE.Vector3, destination: THREE.Vector3): number {
  const deltaX = destination.x - start.x;
  const sceneDeltaZ = destination.z - start.z;
  // Preserve C/C++ atan2(0, 0) == 0 instead of producing PI for JS atan2(0, -0).
  const classicDeltaZ = sceneDeltaZ === 0 ? 0 : -sceneDeltaZ;
  return Math.atan2(deltaX, classicDeltaZ) + Math.PI / 2;
}

function disposeDragon(dragon: DragonVisual): void {
  for (const material of dragon.materials) material.dispose();
  dragon.lease.release();
  dragon.root.clear();
}

function disposeResources(resources: DragonEffectResources): void {
  for (const dragon of [...resources.dragons48, ...resources.dragons49]) disposeDragon(dragon);
  const textures = new Set<THREE.Texture>([
    resources.trailTexture,
    resources.fireShadeTexture,
    ...resources.fireTextures,
    resources.judgementTexture,
    resources.judgementCenterTexture,
  ]);
  for (const texture of textures) texture.dispose();
}

function isFiniteVector(position: THREE.Vector3): boolean {
  return Number.isFinite(position.x)
    && Number.isFinite(position.y)
    && Number.isFinite(position.z);
}
