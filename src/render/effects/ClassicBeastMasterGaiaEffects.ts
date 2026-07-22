import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { parseMsa } from "../../formats/classic/Msa";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";

const SEGMENT_MODEL_TYPES = [712, 713, 714, 715, 716, 717, 718] as const;
const SEGMENT_COUNT = SEGMENT_MODEL_TYPES.length;
const SEGMENT_LIFETIME_SECONDS = 1.5;
const NEXT_SEGMENT_SECONDS = SEGMENT_LIFETIME_SECONDS * 0.2;
const CHAIN_LIFETIME_SECONDS = NEXT_SEGMENT_SECONDS * (SEGMENT_COUNT - 1)
  + SEGMENT_LIFETIME_SECONDS;
const SEGMENT_POOL_PER_TYPE = 2;
const CHAIN_POOL_LIMIT = 3;
const PARTICLE_POOL_LIMIT = 64;
const PARTICLE_LIFETIME_SECONDS = 1.5;
const PARTICLE_INTERVAL_SECONDS = 0.1;
const VISIBLE_FRACTION = 0.05;
const PARTICLE_COLOR = 0xaaaaaa;

export type ClassicGroundHeightSampler = (sceneX: number, sceneZ: number) => number;

interface GaiaResources {
  readonly geometries: readonly THREE.BufferGeometry[];
  readonly stoneTexture: THREE.Texture;
  readonly particleTexture: THREE.Texture;
  readonly stoneMaterial: THREE.MeshLambertMaterial;
}

interface GaiaChain {
  readonly start: THREE.Vector3;
  readonly step: THREE.Vector3;
  active: boolean;
  elapsed: number;
  nextSegment: number;
  groundHeightAt: ClassicGroundHeightSampler | null;
  serial: number;
}

interface GaiaSegment {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  readonly groundPosition: THREE.Vector3;
  readonly typeOffset: number;
  active: boolean;
  elapsed: number;
  serial: number;
}

interface GaiaParticle {
  readonly sprite: THREE.Sprite;
  readonly groundPosition: THREE.Vector3;
  active: boolean;
  elapsed: number;
  baseScale: number;
  serial: number;
}

/**
 * Presentation-only reconstruction of BeastMaster #52, Fúria de Gaia.
 *
 * The retail normal-motion branch creates seven TMSkillFreezeBlade actors,
 * models 712..718, one seventh of the caster-to-target segment apart. Every
 * actor starts the next after 20% of its 1.5 s lifetime. Damage and the rare
 * packet `Motion == 254` branch remain outside this visual component.
 */
export class ClassicBeastMasterGaiaEffects {
  readonly object = new THREE.Group();
  readonly #parent: THREE.Object3D;
  readonly #dds = new ClassicDdsTextureLoader();
  readonly #chains: GaiaChain[] = [];
  readonly #segmentPools: GaiaSegment[][] = Array.from(
    { length: SEGMENT_COUNT },
    () => [],
  );
  readonly #particles: GaiaParticle[] = [];
  readonly #scratchPosition = new THREE.Vector3();
  #resources: GaiaResources | null = null;
  #preload: Promise<void> | null = null;
  #serial = 0;
  #randomSerial = 0;
  #clockSeconds = 0;
  #lastParticleEmissionAt = Number.NEGATIVE_INFINITY;
  #enabled = true;
  #disposed = false;

  constructor(parent: THREE.Object3D) {
    this.#parent = parent;
    this.object.name = "classic-beastmaster-gaia-effects";
    parent.add(this.object);
  }

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
        console.warn("Efeito clássico Fúria de Gaia indisponível.", error);
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

  play(
    casterFeet: THREE.Vector3,
    targetFeet: THREE.Vector3,
    groundHeightAt: ClassicGroundHeightSampler,
  ): boolean {
    if (
      this.#disposed
      || !this.#enabled
      || !this.#resources
      || typeof groundHeightAt !== "function"
      || !isFiniteVector(casterFeet)
      || !isFiniteVector(targetFeet)
    ) return false;

    const chain = this.acquireChain();
    chain.active = true;
    chain.elapsed = 0;
    chain.nextSegment = 1;
    chain.groundHeightAt = groundHeightAt;
    chain.serial = ++this.#serial;
    chain.start.copy(casterFeet);
    // TMFieldScene starts the 3D division at attacker height +1. FrameMove
    // immediately snaps every actual stone to GroundGetMask, so only X/Z from
    // this vector persist after the first update.
    chain.step.subVectors(targetFeet, casterFeet).multiplyScalar(1 / SEGMENT_COUNT);
    this.spawnSegment(chain, 0);
    return true;
  }

  update(deltaSeconds: number): void {
    if (this.#disposed || !this.#enabled) return;
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    if (delta === 0) return;
    this.#clockSeconds += delta;

    for (const particle of this.#particles) {
      if (!particle.active) continue;
      particle.elapsed += delta;
      this.updateParticle(particle);
    }

    for (const pool of this.#segmentPools) {
      for (const segment of pool) {
        if (!segment.active) continue;
        segment.elapsed += delta;
        this.updateSegment(segment);
      }
    }
    this.emitSharedParticle();

    for (const chain of this.#chains) {
      if (!chain.active) continue;
      chain.elapsed += delta;
      while (
        chain.nextSegment < SEGMENT_COUNT
        && chain.elapsed > chain.nextSegment * NEXT_SEGMENT_SECONDS
      ) {
        this.spawnSegment(chain, chain.nextSegment++);
      }
      if (chain.elapsed >= CHAIN_LIFETIME_SECONDS) deactivateChain(chain);
    }
  }

  clear(): void {
    for (const chain of this.#chains) deactivateChain(chain);
    for (const pool of this.#segmentPools) {
      for (const segment of pool) deactivateSegment(segment);
    }
    for (const particle of this.#particles) deactivateParticle(particle);
    this.#lastParticleEmissionAt = Number.NEGATIVE_INFINITY;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clear();
    this.#parent.remove(this.object);
    for (const particle of this.#particles) particle.sprite.material.dispose();
    this.#particles.length = 0;
    for (const pool of this.#segmentPools) pool.length = 0;
    this.#chains.length = 0;
    if (this.#resources) disposeResources(this.#resources);
    this.#resources = null;
    this.object.clear();
  }

  private acquireChain(): GaiaChain {
    const free = this.#chains.find((chain) => !chain.active);
    if (free) return free;
    if (this.#chains.length < CHAIN_POOL_LIMIT) {
      const chain: GaiaChain = {
        start: new THREE.Vector3(),
        step: new THREE.Vector3(),
        active: false,
        elapsed: 0,
        nextSegment: 0,
        groundHeightAt: null,
        serial: 0,
      };
      this.#chains.push(chain);
      return chain;
    }
    const oldest = oldestBySerial(this.#chains);
    deactivateChain(oldest);
    return oldest;
  }

  private spawnSegment(chain: GaiaChain, typeOffset: number): void {
    const segment = this.acquireSegment(typeOffset);
    segment.active = true;
    segment.elapsed = 0;
    segment.serial = ++this.#serial;
    segment.groundPosition.copy(chain.start).addScaledVector(chain.step, typeOffset + 1);
    const sampledHeight = chain.groundHeightAt?.(
      segment.groundPosition.x,
      segment.groundPosition.z,
    );
    if (sampledHeight !== undefined && Number.isFinite(sampledHeight)) {
      segment.groundPosition.y = sampledHeight;
    }
    segment.mesh.position.copy(segment.groundPosition);
    // After the converted yaw/pitch/roll, TMMesh::m_fScaleV maps to local Z.
    segment.mesh.scale.set(1, 1, 0.1);
    segment.mesh.visible = false;
    this.updateSegment(segment);
  }

  private acquireSegment(typeOffset: number): GaiaSegment {
    const pool = this.#segmentPools[typeOffset]!;
    const free = pool.find((segment) => !segment.active);
    if (free) return free;
    if (pool.length < SEGMENT_POOL_PER_TYPE) {
      const resources = this.#resources!;
      const mesh = new THREE.Mesh(
        resources.geometries[typeOffset]!,
        resources.stoneMaterial,
      );
      mesh.name = `classic-beastmaster-gaia-model-${SEGMENT_MODEL_TYPES[typeOffset]}`;
      mesh.rotation.set(Math.PI / 2, -Math.PI / 2, Math.PI / 2, "YXZ");
      mesh.visible = false;
      mesh.renderOrder = 5;
      const segment: GaiaSegment = {
        mesh,
        groundPosition: new THREE.Vector3(),
        typeOffset,
        active: false,
        elapsed: 0,
        serial: 0,
      };
      pool.push(segment);
      this.object.add(mesh);
      return segment;
    }
    const oldest = oldestBySerial(pool);
    deactivateSegment(oldest);
    return oldest;
  }

  private updateSegment(segment: GaiaSegment): void {
    if (segment.elapsed >= SEGMENT_LIFETIME_SECONDS) {
      deactivateSegment(segment);
      return;
    }
    const progress = segment.elapsed / SEGMENT_LIFETIME_SECONDS;
    const verticalScale = progress < 0.1
      ? progress * 11 + 0.1
      : progress > 0.9
        ? Math.max(0.1, 1.2 - (progress - 0.9) * 11)
        : 1.2;
    segment.mesh.position.copy(segment.groundPosition);
    segment.mesh.scale.set(1, 1, verticalScale);
    segment.mesh.visible = progress >= VISIBLE_FRACTION;
  }

  private emitSharedParticle(): void {
    if (this.#clockSeconds - this.#lastParticleEmissionAt <= PARTICLE_INTERVAL_SECONDS) return;
    let source: GaiaSegment | null = null;
    for (const pool of this.#segmentPools) {
      for (const segment of pool) {
        if (!segment.active || (source && segment.serial >= source.serial)) continue;
        source = segment;
      }
    }
    if (!source) return;
    this.spawnParticle(source.groundPosition);
    this.#lastParticleEmissionAt = this.#clockSeconds;
  }

  private spawnParticle(position: THREE.Vector3): void {
    const particle = this.acquireParticle();
    const randomSerial = ++this.#randomSerial;
    particle.active = true;
    particle.elapsed = 0;
    particle.serial = ++this.#serial;
    particle.baseScale = classicRandomStep(randomSerial, 0, 5) * 0.3 + 0.5;
    particle.groundPosition.copy(position);
    particle.groundPosition.x += (classicRandomStep(randomSerial, 1, 10) - 5) * 0.2;
    // Classic +Z maps to scene -Z.
    particle.groundPosition.z -= (classicRandomStep(randomSerial, 2, 10) - 5) * 0.2;
    this.updateParticle(particle);
  }

  private acquireParticle(): GaiaParticle {
    const free = this.#particles.find((particle) => !particle.active);
    if (free) return free;
    if (this.#particles.length < PARTICLE_POOL_LIMIT) {
      const material = new THREE.SpriteMaterial({
        map: this.#resources!.particleTexture,
        color: PARTICLE_COLOR,
        transparent: true,
        opacity: 0,
        depthTest: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
        fog: false,
        toneMapped: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.name = `classic-beastmaster-gaia-particle-${this.#particles.length}`;
      sprite.visible = false;
      sprite.renderOrder = 6;
      const particle: GaiaParticle = {
        sprite,
        groundPosition: new THREE.Vector3(),
        active: false,
        elapsed: 0,
        baseScale: 0.5,
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

  private updateParticle(particle: GaiaParticle): void {
    if (particle.elapsed >= PARTICLE_LIFETIME_SECONDS) {
      deactivateParticle(particle);
      return;
    }
    const progress = particle.elapsed / PARTICLE_LIFETIME_SECONDS;
    const scale = particle.baseScale + particle.elapsed;
    const fade = Math.max(0, Math.sin(progress * Math.PI));
    particle.sprite.position.copy(particle.groundPosition);
    particle.sprite.position.y += progress * 2 + scale / 2;
    particle.sprite.scale.set(scale, scale, 1);
    particle.sprite.material.color.setHex(PARTICLE_COLOR).multiplyScalar(fade);
    particle.sprite.material.opacity = fade;
    particle.sprite.visible = progress >= VISIBLE_FRACTION;
  }

  private async loadClassicResources(assets: ClassicAssetSource): Promise<GaiaResources> {
    const sourceResults = await Promise.allSettled(
      SEGMENT_MODEL_TYPES.map((type) => assets.loadModel(type)),
    );
    const failure = sourceResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) throw failure.reason;
    const sources = sourceResults.map((result) => (
      result.status === "fulfilled" ? result.value : null
    ));
    if (sources.some((source) => source === null)) {
      throw new Error("Modelos clássicos 712..718 ausentes do manifesto");
    }

    const geometries: THREE.BufferGeometry[] = [];
    const loadedTextures: THREE.Texture[] = [];
    try {
      for (const source of sources) geometries.push(parseMsa(source!.buffer).geometry);
      const stoneFile = sources[0]!.textures.find((file): file is string => Boolean(file));
      if (!stoneFile) throw new Error("Textura mesh/stone01 ausente dos modelos 712..718");
      const particleUrl = assets.effectTextureUrl(0);
      if (!particleUrl) throw new Error("Textura de efeito 0 ausente do manifesto");
      const textureResults = await Promise.allSettled([
        this.#dds.loadAsync(assets.dataUrl(stoneFile)),
        this.#dds.loadAsync(particleUrl),
      ]);
      for (const result of textureResults) {
        if (result.status === "fulfilled") loadedTextures.push(result.value);
      }
      const textureFailure = textureResults.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (textureFailure || loadedTextures.length !== 2) {
        throw textureFailure?.reason ?? new Error("Texturas de Fúria de Gaia incompletas");
      }
      const [stoneTexture, particleTexture] = loadedTextures as [THREE.Texture, THREE.Texture];
      for (const texture of loadedTextures) {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        texture.needsUpdate = true;
      }
      configureClassicBillboardUvs(particleTexture);
      const stoneMaterial = createStoneMaterial(stoneTexture);
      return { geometries, stoneTexture, particleTexture, stoneMaterial };
    } catch (error) {
      for (const geometry of geometries) geometry.dispose();
      for (const texture of loadedTextures) texture.dispose();
      throw error;
    }
  }
}

function createStoneMaterial(texture: THREE.Texture): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({
    map: texture,
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    alphaTest: 0.35,
    depthTest: true,
    depthWrite: true,
    side: THREE.FrontSide,
    fog: true,
    toneMapped: false,
  });
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = THREE.OneFactor;
  material.blendDst = THREE.OneMinusSrcAlphaFactor;
  material.blendEquationAlpha = THREE.AddEquation;
  material.blendSrcAlpha = THREE.OneFactor;
  material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  material.forceSinglePass = true;
  return material;
}

function configureClassicBillboardUvs(texture: THREE.Texture): void {
  texture.offset.set(0.02, 0.98);
  texture.repeat.set(0.96, -0.96);
  texture.needsUpdate = true;
}

function deactivateChain(chain: GaiaChain): void {
  chain.active = false;
  chain.elapsed = 0;
  chain.nextSegment = 0;
  chain.groundHeightAt = null;
}

function deactivateSegment(segment: GaiaSegment): void {
  segment.active = false;
  segment.elapsed = 0;
  segment.mesh.visible = false;
}

function deactivateParticle(particle: GaiaParticle): void {
  particle.active = false;
  particle.elapsed = 0;
  particle.sprite.visible = false;
  particle.sprite.material.opacity = 0;
}

function oldestBySerial<T extends { serial: number }>(values: readonly T[]): T {
  let oldest = values[0]!;
  for (const value of values) {
    if (value.serial < oldest.serial) oldest = value;
  }
  return oldest;
}

function classicRandomStep(serial: number, lane: number, modulus: number): number {
  const seed = Math.imul(serial + lane * 0x9e37, 1_103_515_245) + 12_345;
  return (seed >>> 16) % modulus;
}

function isFiniteVector(position: THREE.Vector3): boolean {
  return Number.isFinite(position.x)
    && Number.isFinite(position.y)
    && Number.isFinite(position.z);
}

function disposeResources(resources: GaiaResources): void {
  for (const geometry of resources.geometries) geometry.dispose();
  resources.stoneMaterial.dispose();
  resources.stoneTexture.dispose();
  resources.particleTexture.dispose();
}
