import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { parseMsa } from "../../formats/classic/Msa";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";

const CAST_POOL_LIMIT = 12;
const EXPLOSION_POOL_LIMIT = 12;
const FIRE_EMITTER_POOL_LIMIT = 96;
const BILLBOARD_POOL_LIMIT = 384;
const SHADE_POOL_LIMIT = 160;

const EFFECT_VISIBLE_FRACTION = 0.05;
const MAGIC_MILLISECONDS_PER_UNIT = 120;
const DOUBLE_SWING_MILLISECONDS_PER_WHOLE_UNIT = 300;
const MAX_PROJECTILE_LIFETIME_SECONDS = 5;
const MAGIC_TRAIL_INTERVAL_SECONDS = 0.03;
const DOUBLE_TRAIL_INTERVAL_SECONDS = 0.1;

const EXPLOSION_LIFETIME_SECONDS = 0.8;
const EXPLOSION_RING_INTERVAL_SECONDS = 0.18;
const FIRE_TYPE_2_LIFETIME_SECONDS = 0.8;
const FIRE_TYPE_0_LIFETIME_SECONDS = 2.4;
const FIRE_TYPE_2_FIRST_EMISSION_SECONDS = FIRE_TYPE_2_LIFETIME_SECONDS * 0.01;
const FIRE_TYPE_0_FIRST_EMISSION_SECONDS = FIRE_TYPE_0_LIFETIME_SECONDS * 0.01;

const SHADE_Y_OFFSET = 0.015;
const FORWARD_FALLBACK = new THREE.Vector3(0, 0, 1);
const BOMB_FRAME_INDICES = [33, 34, 35, 36, 37, 38, 39, 40, 41] as const;
const MAGIC_FRAME_INDICES = [61, 62, 63, 64, 65, 66] as const;
const EXPLOSION_DIRECTIONS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
] as const;

interface FirePhoenixResources {
  readonly magicGeometry: THREE.BufferGeometry;
  readonly doubleGeometry: THREE.BufferGeometry;
  readonly smogTexture: THREE.Texture;
  readonly shadeTexture: THREE.Texture;
  readonly bombFrames: readonly THREE.Texture[];
  readonly magicFrames: readonly THREE.Texture[];
  readonly doubleTexture: THREE.Texture;
}

interface CastVisual {
  readonly root: THREE.Group;
  readonly magicMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly magicShade: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly doubleMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly doubleShade: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly start: THREE.Vector3;
  readonly magicTarget: THREE.Vector3;
  readonly doubleTarget: THREE.Vector3;
  readonly magicDirection: THREE.Vector3;
  readonly doubleDirection: THREE.Vector3;
  active: boolean;
  magicActive: boolean;
  doubleActive: boolean;
  elapsed: number;
  magicLifetime: number;
  doubleLifetime: number;
  nextDoubleTrail: number;
  casterGroundY: number;
  targetGroundY: number;
  serial: number;
}

interface ExplosionVisual {
  readonly position: THREE.Vector3;
  active: boolean;
  elapsed: number;
  nextRing: number;
  groundY: number;
  serial: number;
}

type FireEmitterKind = "explosion" | "target";

interface FireEmitterVisual {
  readonly position: THREE.Vector3;
  active: boolean;
  elapsed: number;
  lifetime: number;
  nextEmission: number;
  emissionInterval: number;
  groundY: number;
  kind: FireEmitterKind;
  serial: number;
}

type BillboardKind = "smog" | "bomb";

interface BillboardVisual {
  readonly sprite: THREE.Sprite;
  readonly basePosition: THREE.Vector3;
  active: boolean;
  elapsed: number;
  lifetime: number;
  baseScaleX: number;
  baseScaleY: number;
  growthPerSecond: number;
  rise: number;
  stickGround: boolean;
  kind: BillboardKind;
  frameSeconds: number;
  color: number;
  serial: number;
}

interface ShadeVisual {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  active: boolean;
  elapsed: number;
  lifetime: number;
  color: number;
  serial: number;
}

interface BillboardOptions {
  readonly position: THREE.Vector3;
  readonly kind: BillboardKind;
  readonly lifetime: number;
  readonly baseScaleX: number;
  readonly baseScaleY?: number;
  readonly growthPerSecond: number;
  readonly rise?: number;
  readonly stickGround?: boolean;
  readonly frameSeconds?: number;
  readonly color: number;
}

/**
 * Foema #38, as rendered by TMHuman/TMSkillMagicArrow/TMSkillDoubleSwing.
 *
 * Public positions are actor and target feet in Three.js world space. The
 * retail +2/+1/+2 projectile offsets are applied internally. Gameplay,
 * damage, sound and the FieldScene +500 ms dispatch delay remain with the
 * caller; play() begins both retail visual layers immediately.
 *
 * Every material below is the EF_BRIGHT path. Its packed DWORD alpha is not
 * base opacity: Direct3D selects texture alpha and only modulates texture RGB
 * by the packed diffuse RGB. Consequently opacity remains 1 and temporal
 * fades attenuate RGB intensity.
 */
export class ClassicFoemaFirePhoenixEffects {
  readonly object = new THREE.Group();
  readonly #owner: THREE.Object3D;
  readonly #dds = new ClassicDdsTextureLoader();
  readonly #planeGeometry = new THREE.PlaneGeometry(1, 1);
  readonly #fallbackMagicGeometry = createFallbackMagicGeometry();
  readonly #fallbackDoubleGeometry = new THREE.SphereGeometry(0.35, 12, 8);
  readonly #fallbackGlow = createFallbackGlowTexture();
  readonly #casts: CastVisual[] = [];
  readonly #explosions: ExplosionVisual[] = [];
  readonly #fireEmitters: FireEmitterVisual[] = [];
  readonly #billboards: BillboardVisual[] = [];
  readonly #shades: ShadeVisual[] = [];
  readonly #scratchPosition = new THREE.Vector3();
  #resources: FirePhoenixResources | null = null;
  #preload: Promise<void> | null = null;
  #clockSeconds = 0;
  #lastMagicTrailAt = Number.NEGATIVE_INFINITY;
  #serial = 0;
  #randomSerial = 0;
  #enabled = true;
  #disposed = false;

  constructor(parent: THREE.Object3D) {
    this.#owner = parent;
    this.object.name = "classic-foema-fire-phoenix-effects";
    parent.add(this.object);
  }

  /** Loads retail models 8/702 and effect textures 0/7/33..41/61..66/91 once. */
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
        for (const visual of this.#casts) this.applyCastAssets(visual);
        for (const visual of this.#billboards) this.applyBillboardAsset(visual);
        for (const visual of this.#shades) this.applyShadeAsset(visual);
      })
      .catch((error: unknown) => {
        console.warn("Fênix de Fogo clássica indisponível; usando fallback.", error);
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

  /** Starts the normal Foema type-1 bird and level-4 DoubleSwing together. */
  play(casterFeet: THREE.Vector3, targetFeet: THREE.Vector3): boolean {
    if (!this.canPlayAt(casterFeet) || !isFiniteVector(targetFeet)) return false;

    const visual = this.acquireCast();
    visual.active = true;
    visual.magicActive = true;
    visual.doubleActive = true;
    visual.elapsed = 0;
    visual.nextDoubleTrail = DOUBLE_TRAIL_INTERVAL_SECONDS;
    visual.casterGroundY = casterFeet.y;
    visual.targetGroundY = targetFeet.y;
    visual.serial = ++this.#serial;

    visual.start.copy(casterFeet);
    visual.start.y += 2;
    visual.magicTarget.copy(targetFeet);
    visual.magicTarget.y += 1;
    visual.doubleTarget.copy(targetFeet);
    visual.doubleTarget.y += 2;
    visual.magicDirection.subVectors(visual.magicTarget, visual.start);
    visual.doubleDirection.subVectors(visual.doubleTarget, visual.start);

    visual.magicLifetime = THREE.MathUtils.clamp(
      visual.magicDirection.length() * MAGIC_MILLISECONDS_PER_UNIT / 1_000,
      0.001,
      MAX_PROJECTILE_LIFETIME_SECONDS,
    );
    visual.doubleLifetime = THREE.MathUtils.clamp(
      Math.floor(visual.doubleDirection.length())
        * DOUBLE_SWING_MILLISECONDS_PER_WHOLE_UNIT / 1_000,
      0.001,
      MAX_PROJECTILE_LIFETIME_SECONDS,
    );

    visual.root.visible = true;
    visual.magicMesh.visible = false;
    visual.magicShade.visible = false;
    visual.doubleMesh.visible = false;
    visual.doubleShade.visible = false;
    orientEffectMesh(visual.magicMesh, visual.magicDirection);
    orientEffectMesh(visual.doubleMesh, visual.doubleDirection);
    this.applyCastAssets(visual);
    this.updateCastPositions(visual);

    // m_dwOldTime starts at zero in TMSkillDoubleSwing, so the first retail
    // FrameMove emits a stationary texture-0 smog billboard immediately.
    this.spawnDoubleTrailAt(visual, 0);
    return true;
  }

  update(deltaSeconds: number): void {
    if (this.#disposed || !this.#enabled) return;
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    if (delta === 0) return;
    this.#clockSeconds += delta;

    // Existing independent children advance before their controllers emit.
    this.updateBillboards(delta);
    this.updateShades(delta);
    this.updateFireEmitters(delta);
    this.updateExplosions(delta);

    for (const visual of this.#casts) {
      if (!visual.active) continue;
      visual.elapsed += delta;
      this.updateCast(visual);
    }

    // TMSkillMagicArrow owns one function-static 30 ms timestamp shared by
    // every instance. At most the first active bird emits during this frame.
    if (this.#clockSeconds - this.#lastMagicTrailAt > MAGIC_TRAIL_INTERVAL_SECONDS) {
      const visual = this.oldestActiveMagicCast();
      if (visual) {
        this.spawnMagicTrail(visual);
        this.#lastMagicTrailAt = this.#clockSeconds;
      }
    }
  }

  clear(): void {
    for (const visual of this.#casts) deactivateCast(visual);
    for (const visual of this.#explosions) deactivateExplosion(visual);
    for (const visual of this.#fireEmitters) deactivateFireEmitter(visual);
    for (const visual of this.#billboards) deactivateBillboard(visual);
    for (const visual of this.#shades) deactivateShade(visual);
    this.#lastMagicTrailAt = Number.NEGATIVE_INFINITY;
  }

  /** Terminal cleanup; clear() intentionally keeps all bounded pools reusable. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clear();
    this.#owner.remove(this.object);

    for (const visual of this.#casts) {
      visual.magicMesh.material.dispose();
      visual.magicShade.material.dispose();
      visual.doubleMesh.material.dispose();
      visual.doubleShade.material.dispose();
    }
    for (const visual of this.#billboards) visual.sprite.material.dispose();
    for (const visual of this.#shades) visual.mesh.material.dispose();
    this.#casts.length = 0;
    this.#explosions.length = 0;
    this.#fireEmitters.length = 0;
    this.#billboards.length = 0;
    this.#shades.length = 0;
    this.object.clear();

    this.#planeGeometry.dispose();
    this.#fallbackMagicGeometry.dispose();
    this.#fallbackDoubleGeometry.dispose();
    this.#fallbackGlow.dispose();
    if (this.#resources) disposeResources(this.#resources);
    this.#resources = null;
  }

  private canPlayAt(position: THREE.Vector3): boolean {
    return !this.#disposed && this.#enabled && isFiniteVector(position);
  }

  private acquireCast(): CastVisual {
    const free = this.#casts.find((visual) => !visual.active);
    if (free) return free;
    if (this.#casts.length < CAST_POOL_LIMIT) {
      const visual = this.createCast(this.#casts.length);
      this.#casts.push(visual);
      this.object.add(visual.root);
      return visual;
    }
    const oldest = oldestBySerial(this.#casts);
    deactivateCast(oldest);
    return oldest;
  }

  private createCast(index: number): CastVisual {
    const root = new THREE.Group();
    root.name = `classic-foema-fire-phoenix-${index}`;
    root.visible = false;

    const magicMesh = new THREE.Mesh(
      this.#fallbackMagicGeometry,
      createBrightMaterial(this.#fallbackGlow, 0x444444),
    );
    magicMesh.name = `classic-foema-fire-phoenix-magic-arrow-model-8-${index}`;
    magicMesh.renderOrder = 8;
    magicMesh.visible = false;

    const magicShade = createGroundPlane(
      this.#planeGeometry,
      this.#fallbackGlow,
      0xaa8800,
      `classic-foema-fire-phoenix-magic-shade-7-${index}`,
    );
    magicShade.scale.set(8, 8, 1);

    const doubleMesh = new THREE.Mesh(
      this.#fallbackDoubleGeometry,
      createBrightMaterial(this.#fallbackGlow, 0xdd4400),
    );
    doubleMesh.name = `classic-foema-fire-phoenix-double-swing-model-702-${index}`;
    doubleMesh.scale.set(5.8, 3, 5.8);
    doubleMesh.renderOrder = 8;
    doubleMesh.visible = false;

    const doubleShade = createGroundPlane(
      this.#planeGeometry,
      this.#fallbackGlow,
      0x770000,
      `classic-foema-fire-phoenix-double-shade-7-${index}`,
    );
    doubleShade.scale.set(4, 4, 1);

    root.add(magicMesh, magicShade, doubleMesh, doubleShade);
    return {
      root,
      magicMesh,
      magicShade,
      doubleMesh,
      doubleShade,
      start: new THREE.Vector3(),
      magicTarget: new THREE.Vector3(),
      doubleTarget: new THREE.Vector3(),
      magicDirection: new THREE.Vector3(),
      doubleDirection: new THREE.Vector3(),
      active: false,
      magicActive: false,
      doubleActive: false,
      elapsed: 0,
      magicLifetime: 0.001,
      doubleLifetime: 0.001,
      nextDoubleTrail: DOUBLE_TRAIL_INTERVAL_SECONDS,
      casterGroundY: 0,
      targetGroundY: 0,
      serial: 0,
    };
  }

  private applyCastAssets(visual: CastVisual): void {
    const resources = this.#resources;
    visual.magicMesh.geometry = resources?.magicGeometry ?? this.#fallbackMagicGeometry;
    const frame = Math.floor((this.#clockSeconds % 0.3) / 0.05);
    setMaterialMap(
      visual.magicMesh.material,
      resources?.magicFrames[frame] ?? this.#fallbackGlow,
    );
    visual.magicMesh.material.color.setHex(0x444444);
    visual.magicMesh.material.opacity = 1;

    visual.doubleMesh.geometry = resources?.doubleGeometry ?? this.#fallbackDoubleGeometry;
    setMaterialMap(visual.doubleMesh.material, resources?.doubleTexture ?? this.#fallbackGlow);
    visual.doubleMesh.material.color.setHex(0xdd4400);
    visual.doubleMesh.material.opacity = 1;

    const shadeTexture = resources?.shadeTexture ?? this.#fallbackGlow;
    setMaterialMap(visual.magicShade.material, shadeTexture);
    setMaterialMap(visual.doubleShade.material, shadeTexture);
    visual.magicShade.material.color.setHex(0xaa8800);
    visual.magicShade.material.opacity = 1;
    visual.doubleShade.material.color.setHex(0x770000);
    visual.doubleShade.material.opacity = 1;
  }

  private updateCast(visual: CastVisual): void {
    if (visual.magicActive) {
      const progress = Math.min(1, visual.elapsed / visual.magicLifetime);
      this.updateMagicPosition(visual, progress);
      const frame = Math.floor((this.#clockSeconds % 0.3) / 0.05);
      setMaterialMap(
        visual.magicMesh.material,
        this.#resources?.magicFrames[frame] ?? this.#fallbackGlow,
      );
      const visible = progress >= EFFECT_VISIBLE_FRACTION;
      visual.magicMesh.visible = visible;
      visual.magicShade.visible = visible;
      if (visual.elapsed >= visual.magicLifetime) {
        visual.magicActive = false;
        visual.magicMesh.visible = false;
        visual.magicShade.visible = false;
        this.spawnExplosion(visual.magicTarget, visual.targetGroundY);
      }
    }

    if (visual.doubleActive) {
      const visibleEnd = visual.doubleLifetime * 0.5;
      const emissionEnd = Math.min(visual.elapsed, visibleEnd);
      while (visual.nextDoubleTrail <= emissionEnd) {
        this.spawnDoubleTrailAt(visual, visual.nextDoubleTrail / visual.doubleLifetime);
        visual.nextDoubleTrail += DOUBLE_TRAIL_INTERVAL_SECONDS;
      }

      const progress = Math.min(0.5, visual.elapsed / visual.doubleLifetime);
      this.updateDoublePosition(visual, progress);
      const visible = progress >= EFFECT_VISIBLE_FRACTION;
      visual.doubleMesh.visible = visible;
      visual.doubleShade.visible = visible;
      if (visual.elapsed >= visibleEnd) {
        visual.doubleActive = false;
        visual.doubleMesh.visible = false;
        visual.doubleShade.visible = false;
        this.spawnFireEmitter(visual.doubleTarget, visual.targetGroundY, "target");
      }
    }

    if (!visual.magicActive && !visual.doubleActive) deactivateCast(visual);
  }

  private updateCastPositions(visual: CastVisual): void {
    this.updateMagicPosition(visual, 0);
    this.updateDoublePosition(visual, 0);
  }

  private updateMagicPosition(visual: CastVisual, progress: number): void {
    visual.magicMesh.position.copy(visual.start).addScaledVector(visual.magicDirection, progress);
    const groundY = THREE.MathUtils.lerp(
      visual.casterGroundY,
      visual.targetGroundY,
      progress,
    );
    visual.magicShade.position.set(
      visual.magicMesh.position.x,
      groundY + SHADE_Y_OFFSET,
      visual.magicMesh.position.z,
    );
  }

  private updateDoublePosition(visual: CastVisual, progress: number): void {
    // Level 4: start*(1-p) + (target + direction*2)*p == start + 3pD.
    const pathProgress = progress * 3;
    visual.doubleMesh.position.copy(visual.start).addScaledVector(
      visual.doubleDirection,
      pathProgress,
    );
    const groundY = THREE.MathUtils.lerp(
      visual.casterGroundY,
      visual.targetGroundY,
      pathProgress,
    );
    visual.doubleShade.position.set(
      visual.doubleMesh.position.x,
      groundY + SHADE_Y_OFFSET,
      visual.doubleMesh.position.z,
    );
  }

  private oldestActiveMagicCast(): CastVisual | null {
    let oldest: CastVisual | null = null;
    for (const visual of this.#casts) {
      if (!visual.active || !visual.magicActive) continue;
      if (!oldest || visual.serial < oldest.serial) oldest = visual;
    }
    return oldest;
  }

  private spawnMagicTrail(visual: CastVisual): void {
    const progress = Math.min(1, visual.elapsed / visual.magicLifetime);
    const groundY = THREE.MathUtils.lerp(
      visual.casterGroundY,
      visual.targetGroundY,
      progress,
    );
    const position = this.#scratchPosition.set(
      visual.magicMesh.position.x,
      groundY + 0.4,
      visual.magicMesh.position.z,
    );
    this.spawnShade(position, groundY, 4, 1.8, 0x331100);
    this.spawnBombBillboard(position, 1, 0.6, 1, 1.7, 0.111, 0x444444);
  }

  private spawnDoubleTrailAt(visual: CastVisual, progress: number): void {
    const position = this.#scratchPosition.copy(visual.start).addScaledVector(
      visual.doubleDirection,
      Math.min(0.5, progress) * 3,
    );
    position.y -= 0.5;
    const randomScale = 0.3 + classicRandomStep(++this.#randomSerial, 0, 5) * 0.2;
    this.spawnBillboard({
      position,
      kind: "smog",
      lifetime: 1,
      baseScaleX: randomScale,
      growthPerSecond: 1,
      stickGround: true,
      color: 0xffffff,
    });
  }

  private spawnExplosion(position: THREE.Vector3, groundY: number): void {
    const visual = this.acquireExplosion();
    visual.active = true;
    visual.elapsed = 0;
    visual.nextRing = 0;
    visual.groundY = groundY;
    visual.serial = ++this.#serial;
    visual.position.copy(position);
    this.spawnShade(position, groundY, 8, 1.8, 0x775511);
    this.emitExplosionRing(visual, 0);
    visual.nextRing = EXPLOSION_RING_INTERVAL_SECONDS;
  }

  private acquireExplosion(): ExplosionVisual {
    const free = this.#explosions.find((visual) => !visual.active);
    if (free) return free;
    if (this.#explosions.length < EXPLOSION_POOL_LIMIT) {
      const visual: ExplosionVisual = {
        position: new THREE.Vector3(),
        active: false,
        elapsed: 0,
        nextRing: 0,
        groundY: 0,
        serial: 0,
      };
      this.#explosions.push(visual);
      return visual;
    }
    const oldest = oldestBySerial(this.#explosions);
    deactivateExplosion(oldest);
    return oldest;
  }

  private updateExplosions(deltaSeconds: number): void {
    for (const visual of this.#explosions) {
      if (!visual.active) continue;
      visual.elapsed += deltaSeconds;
      const emissionEnd = Math.min(visual.elapsed, EXPLOSION_LIFETIME_SECONDS);
      while (visual.nextRing <= emissionEnd) {
        this.emitExplosionRing(visual, visual.nextRing / EXPLOSION_LIFETIME_SECONDS);
        visual.nextRing += EXPLOSION_RING_INTERVAL_SECONDS;
      }
      if (visual.elapsed >= EXPLOSION_LIFETIME_SECONDS) deactivateExplosion(visual);
    }
  }

  private emitExplosionRing(visual: ExplosionVisual, progress: number): void {
    for (const [directionX, directionZ] of EXPLOSION_DIRECTIONS) {
      const position = this.#scratchPosition.set(
        visual.position.x + directionX * progress,
        visual.groundY,
        visual.position.z + directionZ * progress,
      );
      this.spawnFireEmitter(position, visual.groundY, "explosion");
    }
  }

  private spawnFireEmitter(
    position: THREE.Vector3,
    groundY: number,
    kind: FireEmitterKind,
  ): void {
    const visual = this.acquireFireEmitter();
    visual.active = true;
    visual.elapsed = 0;
    visual.groundY = groundY;
    visual.kind = kind;
    visual.serial = ++this.#serial;
    visual.position.copy(position);
    if (kind === "explosion") {
      visual.lifetime = FIRE_TYPE_2_LIFETIME_SECONDS;
      visual.nextEmission = FIRE_TYPE_2_FIRST_EMISSION_SECONDS;
      visual.emissionInterval = 0.18;
      this.spawnShade(position, groundY, 4, 1.8, 0x331100);
    } else {
      visual.lifetime = FIRE_TYPE_0_LIFETIME_SECONDS;
      visual.nextEmission = FIRE_TYPE_0_FIRST_EMISSION_SECONDS;
      visual.emissionInterval = 0.1;
      this.spawnShade(position, groundY, 8, 3.4, 0x331100);
    }
  }

  private acquireFireEmitter(): FireEmitterVisual {
    const free = this.#fireEmitters.find((visual) => !visual.active);
    if (free) return free;
    if (this.#fireEmitters.length < FIRE_EMITTER_POOL_LIMIT) {
      const visual: FireEmitterVisual = {
        position: new THREE.Vector3(),
        active: false,
        elapsed: 0,
        lifetime: FIRE_TYPE_2_LIFETIME_SECONDS,
        nextEmission: FIRE_TYPE_2_FIRST_EMISSION_SECONDS,
        emissionInterval: 0.18,
        groundY: 0,
        kind: "explosion",
        serial: 0,
      };
      this.#fireEmitters.push(visual);
      return visual;
    }
    const oldest = oldestBySerial(this.#fireEmitters);
    deactivateFireEmitter(oldest);
    return oldest;
  }

  private updateFireEmitters(deltaSeconds: number): void {
    for (const visual of this.#fireEmitters) {
      if (!visual.active) continue;
      visual.elapsed += deltaSeconds;
      const emissionEnd = Math.min(visual.elapsed, visual.lifetime);
      while (visual.nextEmission <= emissionEnd) {
        if (visual.kind === "explosion") {
          this.spawnBombBillboard(visual.position, 1, 0.4, 1, 4, 0.111, 0x444444);
        } else {
          this.spawnBombBillboard(visual.position, 0.5, 0.7, 1, 3, 0.011, 0xffffff);
        }
        visual.nextEmission += visual.emissionInterval;
      }
      if (visual.elapsed >= visual.lifetime) deactivateFireEmitter(visual);
    }
  }

  private spawnBombBillboard(
    position: THREE.Vector3,
    lifetime: number,
    baseScale: number,
    growthPerSecond: number,
    rise: number,
    frameSeconds: number,
    color: number,
  ): void {
    const jitter = classicRandomStep(++this.#randomSerial, 0, 5) * 0.01;
    const start = this.#scratchPosition.set(
      position.x + jitter,
      position.y,
      position.z + jitter,
    );
    this.spawnBillboard({
      position: start,
      kind: "bomb",
      lifetime,
      baseScaleX: baseScale,
      growthPerSecond,
      rise,
      frameSeconds,
      color,
    });
  }

  private spawnBillboard(options: BillboardOptions): void {
    const visual = this.acquireBillboard();
    visual.active = true;
    visual.elapsed = 0;
    visual.lifetime = options.lifetime;
    visual.baseScaleX = options.baseScaleX;
    visual.baseScaleY = options.baseScaleY ?? options.baseScaleX;
    visual.growthPerSecond = options.growthPerSecond;
    visual.rise = options.rise ?? 0;
    visual.stickGround = options.stickGround ?? false;
    visual.kind = options.kind;
    visual.frameSeconds = options.frameSeconds ?? 1;
    visual.color = options.color;
    visual.serial = ++this.#serial;
    visual.basePosition.copy(options.position);
    visual.sprite.visible = false;
    visual.sprite.material.opacity = 1;
    this.applyBillboardAsset(visual);
    this.updateBillboardVisual(visual);
  }

  private acquireBillboard(): BillboardVisual {
    const free = this.#billboards.find((visual) => !visual.active);
    if (free) return free;
    if (this.#billboards.length < BILLBOARD_POOL_LIMIT) {
      const sprite = createBrightSprite(
        this.#fallbackGlow,
        `classic-foema-fire-phoenix-billboard-${this.#billboards.length}`,
      );
      const visual: BillboardVisual = {
        sprite,
        basePosition: new THREE.Vector3(),
        active: false,
        elapsed: 0,
        lifetime: 1,
        baseScaleX: 1,
        baseScaleY: 1,
        growthPerSecond: 0,
        rise: 0,
        stickGround: false,
        kind: "bomb",
        frameSeconds: 0.111,
        color: 0xffffff,
        serial: 0,
      };
      this.#billboards.push(visual);
      this.object.add(sprite);
      return visual;
    }
    const oldest = oldestBySerial(this.#billboards);
    deactivateBillboard(oldest);
    return oldest;
  }

  private updateBillboards(deltaSeconds: number): void {
    for (const visual of this.#billboards) {
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
    const scaleX = visual.baseScaleX + visual.elapsed * visual.growthPerSecond;
    const scaleY = visual.baseScaleY + visual.elapsed * visual.growthPerSecond;
    visual.sprite.scale.set(scaleX, scaleY, 1);
    visual.sprite.position.copy(visual.basePosition);
    visual.sprite.position.y += progress * visual.rise;
    if (visual.stickGround) visual.sprite.position.y += scaleY / 2;

    if (visual.kind === "bomb") {
      const frame = Math.floor(visual.elapsed / visual.frameSeconds) % BOMB_FRAME_INDICES.length;
      setMaterialMap(
        visual.sprite.material,
        this.#resources?.bombFrames[frame] ?? this.#fallbackGlow,
      );
    }
    setBrightIntensity(visual.sprite.material, visual.color, Math.sin(progress * Math.PI));
    visual.sprite.visible = progress >= EFFECT_VISIBLE_FRACTION;
  }

  private applyBillboardAsset(visual: BillboardVisual): void {
    if (visual.kind === "smog") {
      setMaterialMap(visual.sprite.material, this.#resources?.smogTexture ?? this.#fallbackGlow);
      return;
    }
    const frame = Math.floor(visual.elapsed / visual.frameSeconds) % BOMB_FRAME_INDICES.length;
    setMaterialMap(
      visual.sprite.material,
      this.#resources?.bombFrames[frame] ?? this.#fallbackGlow,
    );
  }

  private spawnShade(
    position: THREE.Vector3,
    groundY: number,
    size: number,
    lifetime: number,
    color: number,
  ): void {
    const visual = this.acquireShade();
    visual.active = true;
    visual.elapsed = 0;
    visual.lifetime = lifetime;
    visual.color = color;
    visual.serial = ++this.#serial;
    visual.mesh.position.set(position.x, groundY + SHADE_Y_OFFSET, position.z);
    visual.mesh.scale.set(size, size, 1);
    visual.mesh.visible = true;
    visual.mesh.material.opacity = 1;
    this.applyShadeAsset(visual);
    setBrightIntensity(visual.mesh.material, color, 0);
  }

  private acquireShade(): ShadeVisual {
    const free = this.#shades.find((visual) => !visual.active);
    if (free) return free;
    if (this.#shades.length < SHADE_POOL_LIMIT) {
      const mesh = createGroundPlane(
        this.#planeGeometry,
        this.#fallbackGlow,
        0xffffff,
        `classic-foema-fire-phoenix-transient-shade-${this.#shades.length}`,
      );
      const visual: ShadeVisual = {
        mesh,
        active: false,
        elapsed: 0,
        lifetime: 1,
        color: 0xffffff,
        serial: 0,
      };
      this.#shades.push(visual);
      this.object.add(mesh);
      return visual;
    }
    const oldest = oldestBySerial(this.#shades);
    deactivateShade(oldest);
    return oldest;
  }

  private updateShades(deltaSeconds: number): void {
    for (const visual of this.#shades) {
      if (!visual.active) continue;
      visual.elapsed += deltaSeconds;
      if (visual.elapsed >= visual.lifetime) {
        deactivateShade(visual);
        continue;
      }
      const progress = visual.elapsed / visual.lifetime;
      setBrightIntensity(visual.mesh.material, visual.color, Math.sin(progress * Math.PI));
    }
  }

  private applyShadeAsset(visual: ShadeVisual): void {
    setMaterialMap(visual.mesh.material, this.#resources?.shadeTexture ?? this.#fallbackGlow);
  }

  private async loadClassicResources(assets: ClassicAssetSource): Promise<FirePhoenixResources> {
    const [magicSource, doubleSource] = await Promise.all([
      assets.loadModel(8),
      assets.loadModel(702),
    ]);
    if (!magicSource || !doubleSource) {
      throw new Error("Modelos clássicos 8/702 ausentes do manifesto");
    }

    const textureIndices = [
      0,
      7,
      ...BOMB_FRAME_INDICES,
      ...MAGIC_FRAME_INDICES,
      91,
    ] as const;
    const textureResults = await Promise.allSettled(
      textureIndices.map((index) => this.loadEffectTexture(assets, index)),
    );
    const loadedTextures = textureResults
      .filter((result): result is PromiseFulfilledResult<THREE.Texture> => (
        result.status === "fulfilled"
      ))
      .map((result) => result.value);
    const failure = textureResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure || loadedTextures.length !== textureIndices.length) {
      for (const texture of loadedTextures) texture.dispose();
      throw failure?.reason ?? new Error("Texturas clássicas da Fênix de Fogo incompletas");
    }

    let magicGeometry: THREE.BufferGeometry | null = null;
    let doubleGeometry: THREE.BufferGeometry | null = null;
    try {
      magicGeometry = parseMsa(magicSource.buffer).geometry;
      doubleGeometry = parseMsa(doubleSource.buffer).geometry;
      const smogTexture = loadedTextures[0]!;
      const shadeTexture = loadedTextures[1]!;
      const bombFrames = loadedTextures.slice(2, 2 + BOMB_FRAME_INDICES.length);
      const magicFrameStart = 2 + BOMB_FRAME_INDICES.length;
      const magicFrames = loadedTextures.slice(
        magicFrameStart,
        magicFrameStart + MAGIC_FRAME_INDICES.length,
      );
      const doubleTexture = loadedTextures.at(-1)!;

      configureClassicBillboardUvs(smogTexture, false);
      configureClassicGroundPlaneUvs(shadeTexture);
      for (const texture of bombFrames) configureClassicBillboardUvs(texture, true);

      return {
        magicGeometry,
        doubleGeometry,
        smogTexture,
        shadeTexture,
        bombFrames,
        magicFrames,
        doubleTexture,
      };
    } catch (error) {
      magicGeometry?.dispose();
      doubleGeometry?.dispose();
      for (const texture of loadedTextures) texture.dispose();
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

function createBrightMaterial(texture: THREE.Texture, color: number): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: color & 0xffffff,
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
  color: number,
  name: string,
): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const mesh = new THREE.Mesh(geometry, createBrightMaterial(texture, color));
  mesh.name = name;
  mesh.rotation.x = -Math.PI / 2;
  mesh.visible = false;
  mesh.renderOrder = 4;
  return mesh;
}

function orientEffectMesh(
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>,
  direction: THREE.Vector3,
): void {
  const horizontal = direction.lengthSq() > 1e-10 ? direction : FORWARD_FALLBACK;
  const angle = Math.atan2(horizontal.x, horizontal.z) - Math.PI / 2;
  // parseMsa reflects Z. This is the right-handed conversion of TMMesh's
  // yaw=angle, pitch=-90 degrees and EffectMesh roll=+90 degrees.
  mesh.rotation.set(Math.PI / 2, -angle, Math.PI / 2, "YXZ");
}

function setMaterialMap(
  material: THREE.MeshBasicMaterial | THREE.SpriteMaterial,
  texture: THREE.Texture,
): void {
  if (material.map === texture) return;
  material.map = texture;
  material.needsUpdate = true;
}

function setBrightIntensity(
  material: THREE.MeshBasicMaterial | THREE.SpriteMaterial,
  packedColor: number,
  intensity: number,
): void {
  material.color
    .setHex(packedColor & 0xffffff)
    .multiplyScalar(THREE.MathUtils.clamp(intensity, 0, 1));
  // EF_BRIGHT selects texture alpha; packed DWORD A is intentionally ignored.
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

function deactivateCast(visual: CastVisual): void {
  visual.active = false;
  visual.magicActive = false;
  visual.doubleActive = false;
  visual.elapsed = 0;
  visual.root.visible = false;
  visual.magicMesh.visible = false;
  visual.magicShade.visible = false;
  visual.doubleMesh.visible = false;
  visual.doubleShade.visible = false;
}

function deactivateExplosion(visual: ExplosionVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.nextRing = 0;
}

function deactivateFireEmitter(visual: FireEmitterVisual): void {
  visual.active = false;
  visual.elapsed = 0;
}

function deactivateBillboard(visual: BillboardVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.sprite.visible = false;
}

function deactivateShade(visual: ShadeVisual): void {
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

/** Deterministic stand-in for the retail client's sequential rand() calls. */
function classicRandomStep(serial: number, lane: number, modulus: number): number {
  const seed = Math.imul(serial + lane * 0x9e37, 1_103_515_245) + 12_345;
  return (seed >>> 16) % modulus;
}

function createFallbackMagicGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.ConeGeometry(0.25, 1.2, 4, 1, true);
  geometry.rotateZ(-Math.PI / 2);
  return geometry;
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
  texture.name = "classic-foema-fire-phoenix-fallback";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function disposeResources(resources: FirePhoenixResources): void {
  resources.magicGeometry.dispose();
  resources.doubleGeometry.dispose();
  const textures = new Set<THREE.Texture>([
    resources.smogTexture,
    resources.shadeTexture,
    resources.doubleTexture,
    ...resources.bombFrames,
    ...resources.magicFrames,
  ]);
  for (const texture of textures) texture.dispose();
}

function isFiniteVector(position: THREE.Vector3): boolean {
  return Number.isFinite(position.x)
    && Number.isFinite(position.y)
    && Number.isFinite(position.z);
}
