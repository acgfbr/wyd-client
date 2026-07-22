import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";

const CONTROLLER_LIFETIME_SECONDS = 1;
const CAST_PARTICLES_PER_CONTROLLER = 15;
const CAST_PARTICLE_LIFETIME_START_SECONDS = 2;
const CAST_PARTICLE_LIFETIME_STEP_SECONDS = 0.3;
const SHADE_LIFETIME_SECONDS = 1.5;
const PERSISTENT_PARTICLE_LIFETIME_SECONDS = 1.5;
const PERSISTENT_EMISSION_INTERVAL_SECONDS = 1 / 60;
const MAX_PERSISTENT_EMISSIONS_PER_UPDATE = 8;
const PARTICLE_CIRCLE_SPEED = 6;
const BILLBOARD_VISIBLE_FRACTION = 0.05;

const CONTROLLER_POOL_LIMIT = 32;
const CAST_PARTICLE_POOL_LIMIT = 240;
const PERSISTENT_PARTICLE_POOL_LIMIT = 240;
const SHADE_POOL_LIMIT = 16;

const ORANGE = 0xff3300;
const BLUE = 0x0033ff;
const RED = 0xff0000;
const SHADE_ORANGE = 0xaa3300;

const REQUIRED_TEXTURE_INDICES = [0, 7, 56, 122] as const;
type RequiredTextureIndex = (typeof REQUIRED_TEXTURE_INDICES)[number];
type ParticleMotion = 0 | 1 | 2 | 3;

export type ClassicManaControlGroundHeightSampler = (
  sceneX: number,
  sceneZ: number,
) => number;

export interface FoemaManaControlOwnerContext {
  /** Logical TMHuman feet: m_vecPosition.x, m_fHeight, m_vecPosition.y. */
  readonly ownerFeet: THREE.Vector3;
  /** TMHuman::m_vecPickSize[m_nSkinMeshType].y * m_fScale. */
  readonly scaledPickHeight: number;
  /**
   * Retained explicitly to document retail semantics: Mana Control does not
   * switch to m_vecSkinPos while mounted; both emitters still use ownerFeet.
   */
  readonly mounted: boolean;
}

interface MutableManaControlOwnerContext {
  readonly ownerFeet: THREE.Vector3;
  scaledPickHeight: number;
  mounted: boolean;
}

interface ManaControlResources {
  readonly textures: ReadonlyMap<RequiredTextureIndex, THREE.Texture>;
}

interface ManaControlController {
  active: boolean;
  elapsed: number;
  serial: number;
}

interface ManaControlParticle {
  readonly sprite: THREE.Sprite;
  readonly start: THREE.Vector3;
  active: boolean;
  elapsed: number;
  lifetime: number;
  baseScaleX: number;
  baseScaleY: number;
  scaleVelocity: number;
  verticalDistance: number;
  horizontalDistance: number;
  motion: ParticleMotion;
  color: number;
  serial: number;
}

interface ManaControlShade {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  active: boolean;
  elapsed: number;
  serial: number;
}

interface CastControllerDefinition {
  readonly type: 1 | 2 | 3;
  readonly textureIndex: 56 | 122;
  readonly size: number;
  readonly color: number;
}

const CAST_CONTROLLERS: readonly CastControllerDefinition[] = [
  { type: 3, textureIndex: 122, size: 1, color: ORANGE },
  { type: 1, textureIndex: 56, size: 0.3, color: ORANGE },
  { type: 2, textureIndex: 122, size: 1, color: BLUE },
  { type: 2, textureIndex: 56, size: 0.3, color: BLUE },
] as const;

/**
 * Presentation-only port of Foema #46, Controle de Mana.
 *
 * The delayed cast is TMHuman.cpp:9037-9053: four type-1/2/3
 * TMEffectParticle controllers plus one type-2 TMShade. The controllers die
 * after 1,000 ms, but TMEffectParticle.cpp:14-104 inserts all billboards as
 * independent effect-container children. Their real lifetimes remain
 * 2,000 + 300*i ms and are intentionally not truncated here.
 *
 * TMHuman.cpp:9906-9948 also emits two independent 1,500 ms billboards on
 * every active FrameMove. NewApp.cpp:598-631 runs one FrameMove per presented
 * frame; the period-normalized 60 Hz accumulator preserves the retail density
 * without doubling it on 120 Hz mobile displays. Gameplay MP rules and sound
 * 36 are deliberately outside this renderer.
 */
export class ClassicFoemaManaControlEffects {
  readonly object = new THREE.Group();
  readonly #dds = new ClassicDdsTextureLoader();
  readonly #controllers: ManaControlController[] = [];
  readonly #castParticles: ManaControlParticle[] = [];
  readonly #persistentParticles: ManaControlParticle[] = [];
  readonly #shades: ManaControlShade[] = [];
  readonly #scratchPosition = new THREE.Vector3();
  #resources: ManaControlResources | null = null;
  #persistentContext: MutableManaControlOwnerContext | null = null;
  #persistentRequested = false;
  #persistentAccumulator = 0;
  #preload: Promise<void> | null = null;
  #serial = 0;
  #randomState = 0;
  #enabled = true;
  #disposed = false;

  constructor(parent: THREE.Object3D) {
    this.object.name = "classic-foema-mana-control-effects";
    parent.add(this.object);
  }

  /** Loads retail EffectTextureList entries 0, 7, 56 and 122 once. */
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
        if (this.#persistentRequested && this.#persistentContext) {
          this.emitPersistentPair(this.#persistentContext);
        }
      })
      .catch((error: unknown) => {
        console.warn("Efeito clássico #46 Controle de Mana indisponível.", error);
      })
      .finally(() => {
        this.#preload = null;
      });
    this.#preload = job;
    return job;
  }

  /** Starts the already-delayed actor-owned burst at caster feet. */
  play(
    casterFeet: THREE.Vector3,
    groundHeightSampler?: ClassicManaControlGroundHeightSampler,
  ): boolean {
    if (
      this.#disposed
      || !this.#enabled
      || !this.#resources
      || !isFiniteVector(casterFeet)
    ) {
      return false;
    }

    const center = casterFeet.clone();
    center.y += 1;
    for (const definition of CAST_CONTROLLERS) {
      const controller = this.acquireController();
      controller.active = true;
      controller.elapsed = 0;
      controller.serial = ++this.#serial;
      for (let index = 0; index < CAST_PARTICLES_PER_CONTROLLER; index++) {
        this.spawnCastParticle(center, definition, index);
      }
    }
    this.spawnShade(casterFeet, groundHeightSampler);
    return true;
  }

  /**
   * Copies the current owner snapshot and controls only future emissions.
   * Existing 1.5 s billboards finish after the affect ends, matching their
   * independent ownership in the retail effect container.
   */
  syncPersistent(
    owner: FoemaManaControlOwnerContext | null,
    active: boolean,
  ): void {
    if (this.#disposed) return;
    if (!owner || !isFiniteOwnerContext(owner)) {
      this.#persistentRequested = false;
      this.#persistentAccumulator = 0;
      this.#persistentContext = null;
      return;
    }

    if (!this.#persistentContext) {
      this.#persistentContext = {
        ownerFeet: owner.ownerFeet.clone(),
        scaledPickHeight: owner.scaledPickHeight,
        mounted: owner.mounted,
      };
    } else {
      this.#persistentContext.ownerFeet.copy(owner.ownerFeet);
      this.#persistentContext.scaledPickHeight = owner.scaledPickHeight;
      this.#persistentContext.mounted = owner.mounted;
    }

    const nextRequested = this.#enabled && active;
    if (nextRequested && !this.#persistentRequested && this.#resources) {
      // The source emits in the same TMHuman::FrameMove that observes the affect.
      this.emitPersistentPair(this.#persistentContext);
      this.#persistentAccumulator = 0;
    }
    this.#persistentRequested = nextRequested;
    if (!nextRequested) this.#persistentAccumulator = 0;
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
    this.updateParticles(this.#castParticles, delta);
    this.updateParticles(this.#persistentParticles, delta);
    this.updateShades(delta);
    this.updatePersistentEmitter(delta);
  }

  setEnabled(enabled: boolean): void {
    if (this.#disposed || this.#enabled === enabled) return;
    this.#enabled = enabled;
    this.object.visible = enabled;
    if (!enabled) this.clear();
  }

  clear(): void {
    for (const controller of this.#controllers) deactivateController(controller);
    for (const particle of this.#castParticles) deactivateParticle(particle);
    for (const particle of this.#persistentParticles) deactivateParticle(particle);
    for (const shade of this.#shades) deactivateShade(shade);
    this.#persistentRequested = false;
    this.#persistentAccumulator = 0;
    this.#persistentContext = null;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clear();
    for (const particle of this.#castParticles) particle.sprite.material.dispose();
    for (const particle of this.#persistentParticles) particle.sprite.material.dispose();
    for (const shade of this.#shades) {
      shade.mesh.geometry.dispose();
      shade.mesh.material.dispose();
    }
    this.#controllers.length = 0;
    this.#castParticles.length = 0;
    this.#persistentParticles.length = 0;
    this.#shades.length = 0;
    if (this.#resources) disposeResources(this.#resources);
    this.#resources = null;
    this.object.removeFromParent();
    this.object.clear();
  }

  private acquireController(): ManaControlController {
    const free = this.#controllers.find((controller) => !controller.active);
    if (free) return free;
    if (this.#controllers.length < CONTROLLER_POOL_LIMIT) {
      const controller: ManaControlController = { active: false, elapsed: 0, serial: 0 };
      this.#controllers.push(controller);
      return controller;
    }
    const oldest = oldestBySerial(this.#controllers);
    deactivateController(oldest);
    return oldest;
  }

  private spawnCastParticle(
    center: THREE.Vector3,
    definition: CastControllerDefinition,
    index: number,
  ): void {
    const particle = this.acquireParticle(this.#castParticles, CAST_PARTICLE_POOL_LIMIT);
    const classicOffsetX = (this.nextClassicRandom(5) - 3) * 0.3;
    const offsetY = (this.nextClassicRandom(5) - 3) * 0.1;
    const classicOffsetZ = (this.nextClassicRandom(5) - 3) * 0.3;
    let motion: ParticleMotion = 1;
    let verticalDistance = 2;
    if (definition.type === 1) motion = index % 2 === 0 ? 2 : 3;
    if (definition.type === 2) verticalDistance = -3;
    if (definition.type === 3) verticalDistance = 3;

    this.activateParticle(particle, {
      textureIndex: definition.textureIndex,
      position: this.#scratchPosition.set(
        center.x + classicOffsetX,
        center.y + offsetY,
        center.z - classicOffsetZ,
      ),
      lifetime: CAST_PARTICLE_LIFETIME_START_SECONDS
        + CAST_PARTICLE_LIFETIME_STEP_SECONDS * index,
      baseScaleX: (index % 2) * definition.size + 0.1,
      baseScaleY: (index % 2) * definition.size + 0.1,
      scaleVelocity: 0,
      verticalDistance,
      horizontalDistance: (index % 3) * 0.05 + 0.1,
      motion,
      color: definition.color,
    });
  }

  private emitPersistentPair(owner: MutableManaControlOwnerContext): void {
    const nRand = this.nextClassicRandom(5);
    const classicOrangeZ = (this.nextClassicRandom(10) - 5) * 0.07;
    const orangeX = (this.nextClassicRandom(10) - 5) * 0.07;
    const orange = this.acquireParticle(
      this.#persistentParticles,
      PERSISTENT_PARTICLE_POOL_LIMIT,
    );
    this.activateParticle(orange, {
      textureIndex: 56,
      position: this.#scratchPosition.set(
        owner.ownerFeet.x + orangeX,
        owner.ownerFeet.y + owner.scaledPickHeight - nRand * 0.05,
        owner.ownerFeet.z - classicOrangeZ,
      ),
      lifetime: PERSISTENT_PARTICLE_LIFETIME_SECONDS,
      baseScaleX: nRand * 0.02 + 0.02,
      baseScaleY: nRand * 0.05 + 0.02,
      scaleVelocity: 0,
      verticalDistance: -1.2,
      horizontalDistance: 0.1,
      motion: (nRand % 3) as ParticleMotion,
      color: ORANGE,
    });

    const redX = (this.nextClassicRandom(10) - 5) * 0.01;
    const classicRedZ = (this.nextClassicRandom(10) - 5) * 0.01;
    const red = this.acquireParticle(
      this.#persistentParticles,
      PERSISTENT_PARTICLE_POOL_LIMIT,
    );
    this.activateParticle(red, {
      textureIndex: 0,
      position: this.#scratchPosition.set(
        owner.ownerFeet.x + redX,
        owner.ownerFeet.y,
        owner.ownerFeet.z - classicRedZ,
      ),
      lifetime: PERSISTENT_PARTICLE_LIFETIME_SECONDS,
      baseScaleX: nRand * 0.1 + 0.1,
      baseScaleY: nRand * 0.05 + 0.8,
      scaleVelocity: 0.1,
      verticalDistance: 1.5,
      horizontalDistance: 0,
      motion: 1,
      color: RED,
    });
  }

  private acquireParticle(
    pool: ManaControlParticle[],
    limit: number,
  ): ManaControlParticle {
    const free = pool.find((particle) => !particle.active);
    if (free) return free;
    if (pool.length < limit) {
      const particle = createParticle(
        this.#resources!.textures.get(56)!,
        `classic-foema-mana-control-particle-${pool.length}`,
      );
      pool.push(particle);
      this.object.add(particle.sprite);
      return particle;
    }
    const oldest = oldestBySerial(pool);
    deactivateParticle(oldest);
    return oldest;
  }

  private activateParticle(
    particle: ManaControlParticle,
    options: {
      readonly textureIndex: 0 | 56 | 122;
      readonly position: THREE.Vector3;
      readonly lifetime: number;
      readonly baseScaleX: number;
      readonly baseScaleY: number;
      readonly scaleVelocity: number;
      readonly verticalDistance: number;
      readonly horizontalDistance: number;
      readonly motion: ParticleMotion;
      readonly color: number;
    },
  ): void {
    particle.active = true;
    particle.elapsed = 0;
    particle.lifetime = options.lifetime;
    particle.baseScaleX = options.baseScaleX;
    particle.baseScaleY = options.baseScaleY;
    particle.scaleVelocity = options.scaleVelocity;
    particle.verticalDistance = options.verticalDistance;
    particle.horizontalDistance = options.horizontalDistance;
    particle.motion = options.motion;
    particle.color = options.color;
    particle.serial = ++this.#serial;
    particle.start.copy(options.position);
    particle.sprite.position.copy(options.position);
    particle.sprite.scale.set(options.baseScaleX, options.baseScaleY, 1);
    const texture = this.#resources!.textures.get(options.textureIndex)!;
    if (particle.sprite.material.map !== texture) {
      particle.sprite.material.map = texture;
      particle.sprite.material.needsUpdate = true;
    }
    particle.sprite.material.color.setHex(0x000000);
    particle.sprite.material.opacity = 1;
    particle.sprite.visible = false;
  }

  private updateParticles(pool: readonly ManaControlParticle[], delta: number): void {
    for (const particle of pool) {
      if (!particle.active) continue;
      particle.elapsed += delta;
      if (particle.elapsed >= particle.lifetime) {
        deactivateParticle(particle);
        continue;
      }
      const progress = particle.elapsed / particle.lifetime;
      particle.sprite.position.copy(particle.start);
      switch (particle.motion) {
        case 1:
          particle.sprite.position.y += progress * particle.verticalDistance;
          break;
        case 2:
          particle.sprite.position.y += progress * particle.verticalDistance;
          particle.sprite.position.x += Math.sin(
            progress * Math.PI * PARTICLE_CIRCLE_SPEED,
          ) * particle.horizontalDistance;
          break;
        case 3:
          particle.sprite.position.y += progress * particle.verticalDistance;
          particle.sprite.position.x += Math.sin(
            progress * Math.PI * PARTICLE_CIRCLE_SPEED,
          ) * particle.horizontalDistance;
          particle.sprite.position.z -= Math.cos(
            progress * Math.PI * PARTICLE_CIRCLE_SPEED,
          ) * particle.horizontalDistance;
          break;
      }
      const growth = particle.elapsed * particle.scaleVelocity;
      particle.sprite.scale.set(
        particle.baseScaleX + growth,
        particle.baseScaleY + growth,
        1,
      );
      const fade = Math.max(0, Math.sin(progress * Math.PI));
      particle.sprite.material.color.setHex(particle.color).multiplyScalar(fade);
      // EF_BRIGHT selects texture alpha; fade remains in diffuse RGB.
      particle.sprite.material.opacity = 1;
      particle.sprite.visible = progress >= BILLBOARD_VISIBLE_FRACTION && fade > 0;
    }
  }

  private spawnShade(
    casterFeet: THREE.Vector3,
    groundHeightSampler?: ClassicManaControlGroundHeightSampler,
  ): void {
    // TMHuman.cpp:9051 passes {vecStart.x, vecStart.y}; vecStart.y is vertical,
    // while TMShade::SetPosition explicitly consumes horizontal X/Z. Treating
    // that reconstructed line literally places the shade near world Z=height.
    // Use the actor's horizontal feet, which is the only spatially valid call.
    const shade = this.acquireShade();
    shade.active = true;
    shade.elapsed = 0;
    shade.serial = ++this.#serial;
    shade.mesh.position.copy(casterFeet);
    configureShadeGeometry(shade.mesh.geometry, casterFeet, groundHeightSampler);
    shade.mesh.material.color.setHex(0x000000);
    shade.mesh.material.opacity = 1;
    shade.mesh.visible = true;
  }

  private acquireShade(): ManaControlShade {
    const free = this.#shades.find((shade) => !shade.active);
    if (free) return free;
    if (this.#shades.length < SHADE_POOL_LIMIT) {
      const mesh = new THREE.Mesh(
        createShadeGeometry(),
        createBrightMaterial(this.#resources!.textures.get(7)!),
      );
      mesh.name = `classic-foema-mana-control-shade-${this.#shades.length}-texture-7`;
      mesh.renderOrder = 5;
      mesh.visible = false;
      const shade: ManaControlShade = { mesh, active: false, elapsed: 0, serial: 0 };
      this.#shades.push(shade);
      this.object.add(mesh);
      return shade;
    }
    const oldest = oldestBySerial(this.#shades);
    deactivateShade(oldest);
    return oldest;
  }

  private updateShades(delta: number): void {
    for (const shade of this.#shades) {
      if (!shade.active) continue;
      shade.elapsed += delta;
      if (shade.elapsed >= SHADE_LIFETIME_SECONDS) {
        deactivateShade(shade);
        continue;
      }
      const progress = shade.elapsed / SHADE_LIFETIME_SECONDS;
      const fade = Math.abs(Math.sin(progress * Math.PI));
      shade.mesh.material.color.setHex(SHADE_ORANGE).multiplyScalar(fade);
      shade.mesh.material.opacity = 1;
    }
  }

  private updatePersistentEmitter(delta: number): void {
    if (!this.#persistentRequested || !this.#persistentContext || !this.#resources) return;
    this.#persistentAccumulator += delta;
    const due = Math.floor(
      this.#persistentAccumulator / PERSISTENT_EMISSION_INTERVAL_SECONDS,
    );
    if (due <= 0) return;
    const count = Math.min(due, MAX_PERSISTENT_EMISSIONS_PER_UPDATE);
    if (due > MAX_PERSISTENT_EMISSIONS_PER_UPDATE) {
      // Do not replay seconds of hidden-tab emissions into one browser frame.
      this.#persistentAccumulator %= PERSISTENT_EMISSION_INTERVAL_SECONDS;
    } else {
      this.#persistentAccumulator -= count * PERSISTENT_EMISSION_INTERVAL_SECONDS;
    }
    for (let index = 0; index < count; index++) {
      this.emitPersistentPair(this.#persistentContext);
    }
  }

  private nextClassicRandom(modulus: number): number {
    this.#randomState = (Math.imul(this.#randomState, 1_103_515_245) + 12_345) >>> 0;
    return (this.#randomState >>> 16) % modulus;
  }

  private async loadClassicResources(assets: ClassicAssetSource): Promise<ManaControlResources> {
    const results = await Promise.allSettled(
      REQUIRED_TEXTURE_INDICES.map((index) => this.loadTexture(assets, index)),
    );
    const textures = new Map<RequiredTextureIndex, THREE.Texture>();
    let failure: unknown = null;
    for (let index = 0; index < results.length; index++) {
      const result = results[index]!;
      if (result.status === "fulfilled") {
        textures.set(REQUIRED_TEXTURE_INDICES[index]!, result.value);
      } else if (failure === null) {
        failure = result.reason;
      }
    }
    if (failure !== null || textures.size !== REQUIRED_TEXTURE_INDICES.length) {
      for (const texture of textures.values()) texture.dispose();
      throw failure ?? new Error("Texturas do Controle de Mana incompletas");
    }
    return { textures };
  }

  private async loadTexture(
    assets: ClassicAssetSource,
    index: RequiredTextureIndex,
  ): Promise<THREE.Texture> {
    const url = assets.effectTextureUrl(index);
    if (!url) throw new Error(`Textura de efeito ${index} ausente do manifesto`);
    const texture = await this.#dds.loadAsync(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    if (index === 7) {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
    } else {
      texture.offset.set(0.02, 0.98);
      texture.repeat.set(0.96, -0.96);
    }
    texture.needsUpdate = true;
    return texture;
  }
}

function createParticle(texture: THREE.Texture, name: string): ManaControlParticle {
  const material = new THREE.SpriteMaterial({
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
    baseScaleX: 0,
    baseScaleY: 0,
    scaleVelocity: 0,
    verticalDistance: 0,
    horizontalDistance: 0,
    motion: 0,
    color: 0xffffff,
    serial: 0,
  };
}

function createBrightMaterial(texture: THREE.Texture): THREE.MeshBasicMaterial {
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

function createShadeGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(27, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(18, 2));
  const indices: number[] = [];
  for (let row = 0; row < 2; row++) {
    for (let column = 0; column < 2; column++) {
      const topLeft = column + row * 3;
      const bottomLeft = column + (row + 1) * 3;
      indices.push(
        topLeft,
        bottomLeft,
        topLeft + 1,
        bottomLeft,
        bottomLeft + 1,
        topLeft + 1,
      );
    }
  }
  geometry.setIndex(indices);
  return geometry;
}

function configureShadeGeometry(
  geometry: THREE.BufferGeometry,
  center: THREE.Vector3,
  groundHeightSampler?: ClassicManaControlGroundHeightSampler,
): void {
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
  const uvs = geometry.getAttribute("uv") as THREE.BufferAttribute;
  const classicCenterX = center.x;
  const classicCenterZ = -center.z;
  const originX = classicShadeOrigin(classicCenterX);
  const originZ = classicShadeOrigin(classicCenterZ);
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      const index = column + row * 3;
      const classicX = (column + originX) * 2;
      const classicZ = (row + originZ) * 2;
      const sceneX = classicX;
      const sceneZ = -classicZ;
      const sampledY = groundHeightSampler?.(sceneX, sceneZ);
      const groundY = Number.isFinite(sampledY) ? sampledY! : center.y;
      positions.setXYZ(
        index,
        sceneX - center.x,
        groundY - center.y + 0.05,
        sceneZ - center.z,
      );
      const fU = (classicCenterX - classicX) / 4;
      const fV = -(classicCenterZ - classicZ) / 4;
      uvs.setXY(index, -fU - 0.5, -fV - 0.5);
    }
  }
  positions.needsUpdate = true;
  uvs.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

function classicShadeOrigin(value: number): number {
  let origin = Math.trunc(value / 2) - 1;
  if (value < 0 && (origin + 1) * 2 - value > value - origin * 2) {
    origin--;
  } else if (value > 0 && value - (origin + 1) * 2 > (origin + 2) * 2 - value) {
    origin++;
  }
  return origin;
}

function deactivateController(controller: ManaControlController): void {
  controller.active = false;
  controller.elapsed = 0;
}

function deactivateParticle(particle: ManaControlParticle): void {
  particle.active = false;
  particle.elapsed = 0;
  particle.sprite.visible = false;
}

function deactivateShade(shade: ManaControlShade): void {
  shade.active = false;
  shade.elapsed = 0;
  shade.mesh.visible = false;
}

function oldestBySerial<T extends { serial: number }>(values: readonly T[]): T {
  let oldest = values[0]!;
  for (const value of values) {
    if (value.serial < oldest.serial) oldest = value;
  }
  return oldest;
}

function isFiniteVector(value: THREE.Vector3): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function isFiniteOwnerContext(value: FoemaManaControlOwnerContext): boolean {
  return isFiniteVector(value.ownerFeet)
    && Number.isFinite(value.scaledPickHeight)
    && value.scaledPickHeight >= 0;
}

function disposeResources(resources: ManaControlResources): void {
  for (const texture of resources.textures.values()) texture.dispose();
}
