import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { parseMsa } from "../../formats/classic/Msa";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";

const EFFECT_LIFETIME_SECONDS = 3;
const START_VISIBLE_DELAY_SECONDS = EFFECT_LIFETIME_SECONDS * 0.05;
const LEVEL_UP_RING_LIFETIME_SECONDS = 2;
const GOLDEN_SHIELD_LIFETIME_SECONDS = 4.1;
const POOL_LIMIT = 40;
const LEVEL_UP_COLOR = 0x558833;
const LEVEL_UP_SHADE_COLOR = 0x335511;
const LEVEL_UP_SLOPE_COLOR = 0x555555;
const LEVEL_UP_COLUMN_OFFSETS = [
  [-1, 0],
  [0, -0.5],
  [-0.5, 0],
  [-0.5, -0.5],
] as const;
const LEVEL_UP_COLUMN_LIFETIMES_SECONDS = [1.5, 1.9, 2.3, 2.7] as const;
const GOLDEN_SHIELD_COLOR = 0x666600;
const GOLDEN_SHIELD_SHADE_COLOR = 0x333300;
const GOLDEN_SHIELD_PARTICLE_COLOR = 0xffff00;

interface ClassicLevelUpResources {
  readonly startGeometry: THREE.BufferGeometry;
  readonly startTexture: THREE.Texture;
  readonly columnTexture: THREE.Texture;
  readonly ringTexture: THREE.Texture;
  readonly goldenColumnTexture: THREE.Texture;
  readonly goldenRingTexture: THREE.Texture;
  readonly slopeTexture: THREE.Texture;
  readonly shadeTexture: THREE.Texture;
}

interface ClassicLevelUpVisual {
  readonly root: THREE.Group;
  readonly start: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly columns: readonly THREE.Sprite[];
  readonly particles: readonly THREE.Sprite[];
  readonly ring: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly slope: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly shade: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  active: boolean;
  includeStart: boolean;
  variant: 0 | 1;
  elapsed: number;
  serial: number;
}

/**
 * Retail `TMEffectLevelUp(type 0)` and the summon-only
 * `TMEffectStart(type 1)` wrapper.
 *
 * Positions are actor feet in Three.js world space. The +.05 ground clearance,
 * timings, growth velocities, colors and effect texture indices are direct
 * ports of TMEffectStart.cpp/TMEffectLevelUp.cpp. A bounded pool keeps the ten
 * simultaneous Beast Master births allocation-free after their first cast.
 */
export class ClassicLevelUpEffects {
  readonly object = new THREE.Group();
  readonly #owner: THREE.Object3D;
  readonly #dds = new ClassicDdsTextureLoader();
  readonly #pool: ClassicLevelUpVisual[] = [];
  readonly #planeGeometry = new THREE.PlaneGeometry(1, 1);
  readonly #fallbackStartGeometry = new THREE.CylinderGeometry(1.2, 1.2, 2.4, 16, 1, true);
  readonly #fallbackGlow = createFallbackGlowTexture();
  #resources: ClassicLevelUpResources | null = null;
  #preload: Promise<void> | null = null;
  #serial = 0;
  #enabled = true;
  #disposed = false;

  constructor(scene: THREE.Object3D) {
    this.#owner = scene;
    this.object.name = "classic-level-up-effects";
    scene.add(this.object);
  }

  /** Loads common mesh 703 and retail effect textures 2/7/52/54/55 once. */
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
        for (const visual of this.#pool) this.applyClassicResources(visual);
      })
      .catch((error: unknown) => {
        console.warn("Efeito clássico de nascimento/level up indisponível; usando fallback.", error);
      })
      .finally(() => {
        this.#preload = null;
      });
    this.#preload = job;
    return job;
  }

  /** `TMEffectLevelUp(position, 0)` without the summon materialization mesh. */
  playLevelUp(worldPosition: THREE.Vector3): void {
    this.play(worldPosition, false, 0);
  }

  /** `TMEffectStart(position, 1)` plus `TMEffectLevelUp(position, 0)`. */
  playSummonSpawn(worldPosition: THREE.Vector3): void {
    this.play(worldPosition, true, 0);
  }

  /** Huntress #85: exact `TMEffectLevelUp(position, 1)` presentation. */
  playGoldenShield(worldPosition: THREE.Vector3): void {
    this.play(worldPosition, false, 1);
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
    for (const visual of this.#pool) {
      if (!visual.active) continue;
      visual.elapsed += delta;
      this.updateVisual(visual);
    }
  }

  clear(): void {
    for (const visual of this.#pool) deactivateVisual(visual);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clear();
    this.object.removeFromParent();
    for (const visual of this.#pool) {
      visual.start.material.dispose();
      for (const column of visual.columns) column.material.dispose();
      for (const particle of visual.particles) particle.material.dispose();
      visual.ring.material.dispose();
      visual.slope.material.dispose();
      visual.shade.material.dispose();
    }
    this.#pool.length = 0;
    this.#planeGeometry.dispose();
    this.#fallbackStartGeometry.dispose();
    this.#fallbackGlow.dispose();
    if (this.#resources) disposeResources(this.#resources);
    this.#resources = null;
    this.#owner.remove(this.object);
  }

  private play(worldPosition: THREE.Vector3, includeStart: boolean, variant: 0 | 1): void {
    if (this.#disposed || !this.#enabled || !isFiniteVector(worldPosition)) return;
    const visual = this.acquireVisual();
    visual.active = true;
    visual.includeStart = includeStart;
    visual.variant = variant;
    visual.elapsed = 0;
    visual.serial = ++this.#serial;
    visual.root.position.copy(worldPosition);
    // TMFieldScene builds the summon effect at GroundGetMask(...)*.1 + .05.
    visual.root.position.y += 0.05;
    visual.root.visible = true;
    for (let index = 0; index < visual.particles.length; index++) {
      const particle = visual.particles[index]!;
      const offsetSeed = visual.serial + index * 17;
      particle.position.set(
        (classicRandomStep(offsetSeed, 0, 5) - 3) * 0.2,
        0.3,
        (classicRandomStep(offsetSeed, 1, 5) - 3) * 0.2,
      );
      particle.userData.startX = particle.position.x;
      particle.userData.startZ = particle.position.z;
    }
    this.applyClassicResources(visual);
    this.updateVisual(visual);
  }

  private acquireVisual(): ClassicLevelUpVisual {
    const free = this.#pool.find((visual) => !visual.active);
    if (free) return free;
    if (this.#pool.length < POOL_LIMIT) {
      const visual = this.createVisual(this.#pool.length);
      this.#pool.push(visual);
      this.object.add(visual.root);
      return visual;
    }
    let oldest = this.#pool[0]!;
    for (const visual of this.#pool) {
      if (visual.serial < oldest.serial) oldest = visual;
    }
    deactivateVisual(oldest);
    return oldest;
  }

  private createVisual(index: number): ClassicLevelUpVisual {
    const root = new THREE.Group();
    root.name = `classic-level-up-${index}`;
    root.visible = false;

    const start = new THREE.Mesh(
      this.#fallbackStartGeometry,
      createBrightMeshMaterial(this.#fallbackGlow, 0xffffff),
    );
    start.name = "classic-effect-start-type-1-mesh-703-texture-52";
    // TMMesh contributes its fixed pitch; TMEffectStart passes roll +90deg.
    start.rotation.set(Math.PI / 2, 0, Math.PI / 2, "YXZ");
    start.renderOrder = 8;
    root.add(start);

    const columns = LEVEL_UP_COLUMN_OFFSETS.map(([x, z], columnIndex) => {
      const column = createBrightSprite(
        this.#fallbackGlow,
        LEVEL_UP_COLOR,
        `classic-level-up-billboard-54-${columnIndex}`,
      );
      column.position.set(x, -0.6, z);
      column.scale.set(0.8, 0.8, 1);
      root.add(column);
      return column;
    });

    const particles = Array.from({ length: 8 }, (_, particleIndex) => {
      const particle = createBrightSprite(
        this.#fallbackGlow,
        GOLDEN_SHIELD_PARTICLE_COLOR,
        `classic-golden-shield-particle-56-${particleIndex}`,
      );
      root.add(particle);
      return particle;
    });

    const ring = createGroundPlane(
      this.#planeGeometry,
      this.#fallbackGlow,
      LEVEL_UP_COLOR,
      "classic-level-up-billboard2-55",
      7,
    );
    ring.position.y = 0.1;
    root.add(ring);

    const slope = createGroundPlane(
      this.#planeGeometry,
      this.#fallbackGlow,
      LEVEL_UP_SLOPE_COLOR,
      "classic-level-up-billboard2-2-slope",
      6,
    );
    slope.position.y = 0.3;
    slope.scale.set(2, 2, 1);
    root.add(slope);

    const shade = createGroundPlane(
      this.#planeGeometry,
      this.#fallbackGlow,
      LEVEL_UP_SHADE_COLOR,
      "classic-level-up-shade-7",
      5,
    );
    // TMShade grid 4 spans four two-unit ground cells.
    shade.scale.set(8, 8, 1);
    shade.position.y = 0.005;
    root.add(shade);

    return {
      root,
      start,
      columns,
      particles,
      ring,
      slope,
      shade,
      active: false,
      includeStart: false,
      variant: 0,
      elapsed: 0,
      serial: 0,
    };
  }

  private applyClassicResources(visual: ClassicLevelUpVisual): void {
    const resources = this.#resources;
    visual.start.geometry = resources?.startGeometry ?? this.#fallbackStartGeometry;
    setMaterialMap(visual.start.material, resources?.startTexture ?? this.#fallbackGlow);
    for (const column of visual.columns) {
      setMaterialMap(
        column.material,
        visual.variant === 1
          ? resources?.goldenColumnTexture ?? this.#fallbackGlow
          : resources?.columnTexture ?? this.#fallbackGlow,
      );
    }
    for (const particle of visual.particles) {
      setMaterialMap(particle.material, resources?.goldenRingTexture ?? this.#fallbackGlow);
    }
    setMaterialMap(
      visual.ring.material,
      visual.variant === 1
        ? resources?.goldenRingTexture ?? this.#fallbackGlow
        : resources?.ringTexture ?? this.#fallbackGlow,
    );
    setMaterialMap(visual.slope.material, resources?.slopeTexture ?? this.#fallbackGlow);
    setMaterialMap(visual.shade.material, resources?.shadeTexture ?? this.#fallbackGlow);
  }

  private updateVisual(visual: ClassicLevelUpVisual): void {
    const totalLifetime = visual.variant === 1
      ? GOLDEN_SHIELD_LIFETIME_SECONDS
      : EFFECT_LIFETIME_SECONDS;
    if (visual.elapsed >= totalLifetime) {
      deactivateVisual(visual);
      return;
    }

    const startProgress = Math.min(1, visual.elapsed / EFFECT_LIFETIME_SECONDS);
    const startIntensity = Math.abs(Math.sin(startProgress * Math.PI));
    visual.start.visible = visual.includeStart && visual.elapsed >= START_VISIBLE_DELAY_SECONDS;
    visual.start.scale.setScalar(startProgress * 0.7 + 0.2);
    setFadedColor(visual.start.material, 0xffffff, startIntensity, false);

    const mainColor = visual.variant === 1 ? GOLDEN_SHIELD_COLOR : LEVEL_UP_COLOR;
    const shadeColor = visual.variant === 1 ? GOLDEN_SHIELD_SHADE_COLOR : LEVEL_UP_SHADE_COLOR;

    for (let index = 0; index < visual.columns.length; index++) {
      const column = visual.columns[index]!;
      const lifetime = LEVEL_UP_COLUMN_LIFETIMES_SECONDS[index]!;
      const progress = Math.min(1, visual.elapsed / lifetime);
      const fade = Math.max(0, Math.sin(progress * Math.PI));
      const scaleY = 0.8 + visual.elapsed * (2 + index);
      column.visible = visual.elapsed >= lifetime * 0.05 && visual.elapsed < lifetime;
      column.scale.set(0.8, scaleY, 1);
      // m_bStickGround translates by half the current vertical scale.
      column.position.y = -1 + scaleY / 2;
      setFadedColor(column.material, mainColor, fade, true);
    }

    for (let index = 0; index < visual.particles.length; index++) {
      const particle = visual.particles[index]!;
      const lifetime = index * 0.3 + 2;
      const visible = visual.variant === 1 && visual.elapsed < lifetime;
      particle.visible = visible;
      if (!visible) {
        particle.material.opacity = 0;
        continue;
      }
      const progress = THREE.MathUtils.clamp(visual.elapsed / lifetime, 0, 1);
      const scale = (index % 2) * 0.1 + 0.1;
      const angle = progress * Math.PI * 6;
      const startX = particle.userData.startX as number;
      const startZ = particle.userData.startZ as number;
      particle.position.set(
        startX + Math.sin(angle) * 0.5,
        0.3 + progress * 1.5,
        startZ + Math.cos(angle) * 0.5,
      );
      particle.scale.set(scale, scale, 1);
      particle.material.opacity = Math.max(0, Math.sin(progress * Math.PI));
    }

    const ringProgress = Math.min(1, visual.elapsed / LEVEL_UP_RING_LIFETIME_SECONDS);
    const ringFade = Math.max(0, Math.sin(ringProgress * Math.PI));
    const ringsVisible = visual.elapsed >= LEVEL_UP_RING_LIFETIME_SECONDS * 0.05
      && visual.elapsed < LEVEL_UP_RING_LIFETIME_SECONDS;
    visual.ring.visible = ringsVisible;
    visual.ring.scale.setScalar(0.01 + visual.elapsed * 2);
    setFadedColor(visual.ring.material, mainColor, ringFade, true);
    visual.slope.visible = ringsVisible;
    setFadedColor(visual.slope.material, LEVEL_UP_SLOPE_COLOR, ringFade, true);

    const shadeFade = Math.max(0, Math.sin(startProgress * Math.PI));
    visual.shade.visible = true;
    setFadedColor(visual.shade.material, shadeColor, shadeFade, true);
  }

  private async loadClassicResources(assets: ClassicAssetSource): Promise<ClassicLevelUpResources> {
    const source = await assets.loadModel(703);
    if (!source) throw new Error("Modelo clássico 703/start.msa ausente do manifesto");

    const textureIndices = [2, 7, 52, 54, 55, 122, 56] as const;
    const loadedTextures: THREE.Texture[] = [];
    let startGeometry: THREE.BufferGeometry | null = null;
    try {
      const textureResults = await Promise.allSettled(
        textureIndices.map((textureIndex) => this.loadEffectTexture(assets, textureIndex)),
      );
      for (const result of textureResults) {
        if (result.status === "fulfilled") loadedTextures.push(result.value);
      }
      const failure = textureResults.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failure) throw failure.reason;
      const textures = textureResults.map(
        (result) => (result as PromiseFulfilledResult<THREE.Texture>).value,
      );
      startGeometry = parseMsa(source.buffer).geometry;
      const [
        slopeTexture,
        shadeTexture,
        startTexture,
        columnTexture,
        ringTexture,
        goldenColumnTexture,
        goldenRingTexture,
      ] = textures;
      configureClassicBillboardUvs(columnTexture!);
      configureClassicBillboardUvs(goldenColumnTexture!);
      configureClassicBillboardUvs(goldenRingTexture!);
      configureClassicGroundPlaneUvs(slopeTexture!);
      configureClassicGroundPlaneUvs(ringTexture!);
      return {
        startGeometry,
        startTexture: startTexture!,
        columnTexture: columnTexture!,
        ringTexture: ringTexture!,
        goldenColumnTexture: goldenColumnTexture!,
        goldenRingTexture: goldenRingTexture!,
        slopeTexture: slopeTexture!,
        shadeTexture: shadeTexture!,
      };
    } catch (error) {
      startGeometry?.dispose();
      for (const texture of loadedTextures) texture.dispose();
      throw error;
    }
  }

  private async loadEffectTexture(assets: ClassicAssetSource, index: number): Promise<THREE.Texture> {
    const url = assets.effectTextureUrl(index);
    if (!url) throw new Error(`Textura de efeito ${index} ausente do manifesto`);
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
    color,
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
  sprite.renderOrder = 9;
  return sprite;
}

function createGroundPlane(
  geometry: THREE.PlaneGeometry,
  texture: THREE.Texture,
  color: number,
  name: string,
  renderOrder: number,
): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const mesh = new THREE.Mesh(geometry, createBrightMeshMaterial(texture, color));
  mesh.name = name;
  // TMEffectBillBoard2 is authored directly in XZ and starts at yaw +45deg.
  mesh.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
  mesh.renderOrder = renderOrder;
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
  packedColor: number,
  fade: number,
  fadeAlpha: boolean,
): void {
  const intensity = THREE.MathUtils.clamp(fade, 0, 1);
  material.color.setHex(packedColor).multiplyScalar(intensity);
  material.opacity = fadeAlpha ? intensity : 1;
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

function deactivateVisual(visual: ClassicLevelUpVisual): void {
  visual.active = false;
  visual.includeStart = false;
  visual.variant = 0;
  visual.elapsed = 0;
  visual.root.visible = false;
  visual.start.visible = false;
  for (const column of visual.columns) column.visible = false;
  for (const particle of visual.particles) {
    particle.visible = false;
    particle.material.opacity = 0;
  }
  visual.ring.visible = false;
  visual.slope.visible = false;
  visual.shade.visible = false;
}

function isFiniteVector(position: THREE.Vector3): boolean {
  return Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
}

function classicRandomStep(seed: number, lane: number, modulus: number): number {
  const value = Math.imul(seed + lane * 0x9e37, 1_103_515_245) + 12_345;
  return (value >>> 16) % modulus;
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
  texture.name = "classic-level-up-fallback";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function disposeResources(resources: ClassicLevelUpResources): void {
  resources.startGeometry.dispose();
  resources.startTexture.dispose();
  resources.columnTexture.dispose();
  resources.ringTexture.dispose();
  resources.goldenColumnTexture.dispose();
  resources.goldenRingTexture.dispose();
  resources.slopeTexture.dispose();
  resources.shadeTexture.dispose();
}
