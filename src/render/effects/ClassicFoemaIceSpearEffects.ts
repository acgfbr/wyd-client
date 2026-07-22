import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { parseMsa } from "../../formats/classic/Msa";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";

const PROJECTILE_POOL_LIMIT = 16;
const IMPACT_POOL_LIMIT = 16;
const PARTICLE_POOL_LIMIT = 256;

const VISIBLE_FRACTION = 0.05;
const IMPACT_LIFETIME_SECONDS = 2;
const PARTICLE_LIFETIME_SECONDS = 1.5;
const PARTICLE_INTERVAL_SECONDS = 0.1;

const PROJECTILE_SHADE_COLOR = 0x333344;
const PROJECTILE_SHADE_OPACITY = 0x33 / 0xff;
const IMPACT_COLOR = 0x113366;
const IMPACT_OPACITY = 0x55 / 0xff;
const FLARE_COLOR = 0x2255aa;
const PARTICLE_COLOR = 0xaaeeff;

interface ClassicFoemaIceSpearResources {
  readonly spearGeometry: THREE.BufferGeometry;
  readonly freezeBladeGeometry: THREE.BufferGeometry;
  readonly particleTexture: THREE.Texture;
  readonly flareTexture: THREE.Texture;
  readonly shadeTexture: THREE.Texture;
  readonly iceTexture: THREE.Texture;
}

interface IceSpearVisual {
  readonly root: THREE.Group;
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly shade: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly start: THREE.Vector3;
  readonly destination: THREE.Vector3;
  readonly direction: THREE.Vector3;
  active: boolean;
  elapsed: number;
  lifetime: number;
  serial: number;
}

interface FreezeBladeVisual {
  readonly root: THREE.Group;
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly flare: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  active: boolean;
  elapsed: number;
  serial: number;
}

interface FreezeParticleVisual {
  readonly sprite: THREE.Sprite;
  readonly groundPosition: THREE.Vector3;
  active: boolean;
  elapsed: number;
  baseScale: number;
  serial: number;
}

/**
 * Presentation-only port of Foema skill record #34, `TMSkillIceSpear`.
 *
 * Public positions are actor feet in Three.js world space. The retail +1 Y
 * projectile attachment is applied internally. Damage, targeting, sound and
 * gameplay callbacks deliberately remain outside this component.
 */
export class ClassicFoemaIceSpearEffects {
  readonly object = new THREE.Group();
  readonly #parent: THREE.Object3D;
  readonly #dds = new ClassicDdsTextureLoader();
  readonly #planeGeometry = new THREE.PlaneGeometry(1, 1);
  readonly #projectilePool: IceSpearVisual[] = [];
  readonly #impactPool: FreezeBladeVisual[] = [];
  readonly #particlePool: FreezeParticleVisual[] = [];
  readonly #impactFeetScratch = new THREE.Vector3();
  #resources: ClassicFoemaIceSpearResources | null = null;
  #preload: Promise<void> | null = null;
  #serial = 0;
  #randomSerial = 0;
  #clockSeconds = 0;
  #lastParticleEmissionAt = Number.NEGATIVE_INFINITY;
  #enabled = true;
  #disposed = false;

  constructor(parent: THREE.Object3D) {
    this.#parent = parent;
    this.object.name = "classic-foema-ice-spear-effects";
    parent.add(this.object);
  }

  /** Loads retail models 708/707 and effect textures 0/2/7/19 once. */
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
      })
      .catch((error: unknown) => {
        console.warn("Efeito clássico Lança de Gelo da Foema indisponível.", error);
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
   * Fires one non-homing retail ice spear from caster feet to target feet.
   * Returns false while classic resources are unavailable or effects disabled.
   */
  play(casterFeet: THREE.Vector3, targetFeet: THREE.Vector3): boolean {
    if (
      this.#disposed
      || !this.#enabled
      || !this.#resources
      || !isFiniteVector(casterFeet)
      || !isFiniteVector(targetFeet)
    ) {
      return false;
    }

    const visual = this.acquireProjectile();
    visual.active = true;
    visual.elapsed = 0;
    visual.serial = ++this.#serial;
    visual.start.copy(casterFeet);
    visual.start.y += 1;
    visual.destination.copy(targetFeet);
    visual.destination.y += 1;
    visual.direction.subVectors(visual.destination, visual.start);

    // The original constructor receives 100 ms per integer world unit, with
    // its duration clamped to 1..5000 ms after truncating the 3D distance.
    const integerDistance = Math.floor(visual.direction.length());
    visual.lifetime = THREE.MathUtils.clamp(integerDistance * 0.1, 0.001, 5);

    const heading = Math.atan2(visual.direction.x, visual.direction.z) - Math.PI / 2;
    // Three's imported MSA coordinate conversion requires the inverse retail
    // yaw and positive X pitch; this is the same mapping used by model effects.
    visual.mesh.rotation.set(Math.PI / 2, -heading, Math.PI / 2, "YXZ");
    visual.mesh.position.copy(visual.start);
    visual.mesh.scale.setScalar(1);
    visual.mesh.material.color.setHex(0xffffff);
    visual.mesh.material.opacity = 1;

    visual.shade.position.set(casterFeet.x, casterFeet.y + 0.005, casterFeet.z);
    visual.shade.material.color.setHex(PROJECTILE_SHADE_COLOR);
    visual.shade.material.opacity = PROJECTILE_SHADE_OPACITY;
    visual.root.visible = true;
    this.updateProjectileVisual(visual);
    return true;
  }

  update(deltaSeconds: number): void {
    if (this.#disposed || !this.#enabled) return;
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    if (delta === 0) return;
    this.#clockSeconds += delta;

    // Existing children advance first, so an impact created by a projectile at
    // the end of this frame begins at retail progress zero on the next frame.
    for (const particle of this.#particlePool) {
      if (!particle.active) continue;
      particle.elapsed += delta;
      this.updateParticleVisual(particle);
    }

    for (const impact of this.#impactPool) {
      if (!impact.active) continue;
      impact.elapsed += delta;
      this.updateImpactVisual(impact);
    }
    this.emitImpactParticle();

    for (const projectile of this.#projectilePool) {
      if (!projectile.active) continue;
      projectile.elapsed += delta;
      this.updateProjectileVisual(projectile);
    }
  }

  clear(): void {
    for (const projectile of this.#projectilePool) deactivateProjectile(projectile);
    for (const impact of this.#impactPool) deactivateImpact(impact);
    for (const particle of this.#particlePool) deactivateParticle(particle);
    this.#lastParticleEmissionAt = Number.NEGATIVE_INFINITY;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clear();
    this.#parent.remove(this.object);

    for (const projectile of this.#projectilePool) {
      projectile.mesh.material.dispose();
      projectile.shade.material.dispose();
    }
    for (const impact of this.#impactPool) {
      impact.mesh.material.dispose();
      impact.flare.material.dispose();
    }
    for (const particle of this.#particlePool) particle.sprite.material.dispose();

    this.#projectilePool.length = 0;
    this.#impactPool.length = 0;
    this.#particlePool.length = 0;
    this.#planeGeometry.dispose();
    if (this.#resources) disposeClassicResources(this.#resources);
    this.#resources = null;
  }

  private acquireProjectile(): IceSpearVisual {
    const free = this.#projectilePool.find((visual) => !visual.active);
    if (free) return free;
    if (this.#projectilePool.length < PROJECTILE_POOL_LIMIT) {
      const visual = this.createProjectile(this.#projectilePool.length);
      this.#projectilePool.push(visual);
      this.object.add(visual.root);
      return visual;
    }
    const oldest = oldestBySerial(this.#projectilePool);
    deactivateProjectile(oldest);
    return oldest;
  }

  private createProjectile(index: number): IceSpearVisual {
    const resources = this.#resources!;
    const root = new THREE.Group();
    root.name = `classic-foema-ice-spear-${index}`;
    root.visible = false;

    const mesh = new THREE.Mesh(
      resources.spearGeometry,
      createBrightMeshMaterial(resources.iceTexture, 0xffffff, 1),
    );
    mesh.name = "classic-foema-ice-spear-model-708-texture-19";
    mesh.visible = false;
    mesh.renderOrder = 8;

    const shade = createGroundPlane(
      this.#planeGeometry,
      resources.shadeTexture,
      "classic-foema-ice-spear-moving-shade-7",
      0,
    );
    shade.scale.set(8, 8, 1);
    shade.material.color.setHex(PROJECTILE_SHADE_COLOR);
    shade.material.opacity = PROJECTILE_SHADE_OPACITY;
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
      serial: 0,
    };
  }

  private updateProjectileVisual(visual: IceSpearVisual): void {
    if (visual.elapsed >= visual.lifetime) {
      this.#impactFeetScratch.copy(visual.destination);
      this.#impactFeetScratch.y -= 1;
      deactivateProjectile(visual);
      this.spawnImpact(this.#impactFeetScratch);
      return;
    }

    const progress = visual.elapsed / visual.lifetime;
    visual.mesh.position.lerpVectors(visual.start, visual.destination, progress);
    const groundY = THREE.MathUtils.lerp(
      visual.start.y - 1,
      visual.destination.y - 1,
      progress,
    );
    visual.shade.position.set(visual.mesh.position.x, groundY + 0.005, visual.mesh.position.z);
    const visible = progress >= VISIBLE_FRACTION;
    visual.mesh.visible = visible;
    visual.shade.visible = visible;
  }

  private acquireImpact(): FreezeBladeVisual {
    const free = this.#impactPool.find((visual) => !visual.active);
    if (free) return free;
    if (this.#impactPool.length < IMPACT_POOL_LIMIT) {
      const visual = this.createImpact(this.#impactPool.length);
      this.#impactPool.push(visual);
      this.object.add(visual.root);
      return visual;
    }
    const oldest = oldestBySerial(this.#impactPool);
    deactivateImpact(oldest);
    return oldest;
  }

  private createImpact(index: number): FreezeBladeVisual {
    const resources = this.#resources!;
    const root = new THREE.Group();
    root.name = `classic-foema-freeze-blade-${index}`;
    root.visible = false;

    const mesh = new THREE.Mesh(
      resources.freezeBladeGeometry,
      createBrightMeshMaterial(resources.iceTexture, IMPACT_COLOR, IMPACT_OPACITY),
    );
    mesh.name = "classic-foema-freeze-blade-model-707-texture-19";
    mesh.rotation.set(Math.PI / 2, -Math.PI / 2, Math.PI / 2, "YXZ");
    mesh.visible = false;
    mesh.renderOrder = 8;

    const flare = createGroundPlane(
      this.#planeGeometry,
      resources.flareTexture,
      "classic-foema-freeze-blade-flare-2",
      Math.PI / 4,
    );
    flare.position.y = 0.3;
    flare.renderOrder = 6;

    root.add(mesh, flare);
    return { root, mesh, flare, active: false, elapsed: 0, serial: 0 };
  }

  private spawnImpact(targetFeet: THREE.Vector3): void {
    const visual = this.acquireImpact();
    visual.active = true;
    visual.elapsed = 0;
    visual.serial = ++this.#serial;
    visual.root.position.copy(targetFeet);
    visual.root.visible = true;
    visual.mesh.scale.set(1, 0.2, 1);
    visual.flare.scale.set(2, 2, 1);
    this.updateImpactVisual(visual);
  }

  private updateImpactVisual(visual: FreezeBladeVisual): void {
    if (visual.elapsed >= IMPACT_LIFETIME_SECONDS) {
      deactivateImpact(visual);
      return;
    }

    const progress = visual.elapsed / IMPACT_LIFETIME_SECONDS;
    const visible = progress >= VISIBLE_FRACTION;
    const verticalScale = progress < 0.1 ? 0.2 + 15 * progress : 1.7;
    visual.mesh.scale.set(1, verticalScale, 1);
    visual.mesh.visible = visible;

    const impactFade = progress < 0.6
      ? 1
      : Math.max(0, Math.cos((progress - 0.6) * 1.25 * Math.PI));
    setFadedColor(visual.mesh.material, IMPACT_COLOR, IMPACT_OPACITY, impactFade);

    const flareScale = 2 + visual.elapsed * 2;
    visual.flare.scale.set(flareScale, flareScale, 1);
    visual.flare.visible = visible;
    setFadedColor(
      visual.flare.material,
      FLARE_COLOR,
      1,
      Math.max(0, Math.sin(progress * Math.PI)),
    );
  }

  private emitImpactParticle(): void {
    const source = oldestActiveBySerial(this.#impactPool);
    if (
      !source
      || this.#clockSeconds - this.#lastParticleEmissionAt <= PARTICLE_INTERVAL_SECONDS
    ) return;

    // TMSkillFreezeBlade owns a function-static timestamp: every concurrent
    // blade shares this gate and even a long frame can emit only one particle.
    this.spawnParticle(source.root.position);
    this.#lastParticleEmissionAt = this.#clockSeconds;
  }

  private acquireParticle(): FreezeParticleVisual {
    const free = this.#particlePool.find((visual) => !visual.active);
    if (free) return free;
    if (this.#particlePool.length < PARTICLE_POOL_LIMIT) {
      const resources = this.#resources!;
      const sprite = createBrightSprite(
        resources.particleTexture,
        `classic-foema-freeze-blade-particle-${this.#particlePool.length}`,
      );
      const visual: FreezeParticleVisual = {
        sprite,
        groundPosition: new THREE.Vector3(),
        active: false,
        elapsed: 0,
        baseScale: 0.5,
        serial: 0,
      };
      this.#particlePool.push(visual);
      this.object.add(sprite);
      return visual;
    }
    const oldest = oldestBySerial(this.#particlePool);
    deactivateParticle(oldest);
    return oldest;
  }

  private spawnParticle(impactFeet: THREE.Vector3): void {
    const randomSerial = ++this.#randomSerial;
    const visual = this.acquireParticle();
    visual.active = true;
    visual.elapsed = 0;
    visual.serial = ++this.#serial;
    visual.baseScale = 0.5 + classicRandomStep(randomSerial, 2, 5) * 0.3;
    visual.groundPosition.copy(impactFeet);
    visual.groundPosition.x += (classicRandomStep(randomSerial, 0, 10) - 5) * 0.2;
    visual.groundPosition.z += (classicRandomStep(randomSerial, 1, 10) - 5) * 0.2;
    this.updateParticleVisual(visual);
  }

  private updateParticleVisual(visual: FreezeParticleVisual): void {
    if (visual.elapsed >= PARTICLE_LIFETIME_SECONDS) {
      deactivateParticle(visual);
      return;
    }

    const progress = visual.elapsed / PARTICLE_LIFETIME_SECONDS;
    const scale = visual.baseScale + visual.elapsed;
    visual.sprite.scale.set(scale, scale, 1);
    visual.sprite.position.copy(visual.groundPosition);
    // TMEffectBillBoard's stick-ground mode raises the centered quad by half
    // its current height while it grows.
    visual.sprite.position.y += scale / 2;
    visual.sprite.visible = progress >= VISIBLE_FRACTION;
    setFadedColor(
      visual.sprite.material,
      PARTICLE_COLOR,
      1,
      Math.max(0, Math.sin(progress * Math.PI)),
    );
  }

  private async loadClassicResources(
    assets: ClassicAssetSource,
  ): Promise<ClassicFoemaIceSpearResources> {
    const [spearSource, freezeBladeSource] = await Promise.all([
      assets.loadModel(708),
      assets.loadModel(707),
    ]);
    if (!spearSource || !freezeBladeSource) {
      throw new Error("Modelos clássicos 708/707 ausentes do manifesto");
    }

    const loadedTextures: THREE.Texture[] = [];
    const loadedGeometries: THREE.BufferGeometry[] = [];
    try {
      // allSettled avoids leaking a DDS request that finishes after a sibling
      // has already rejected.
      const textureResults = await Promise.allSettled([
        this.loadEffectTexture(assets, 0),
        this.loadEffectTexture(assets, 2),
        this.loadEffectTexture(assets, 7),
        this.loadEffectTexture(assets, 19),
      ]);
      for (const result of textureResults) {
        if (result.status === "fulfilled") loadedTextures.push(result.value);
      }
      const failure = textureResults.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failure || loadedTextures.length !== textureResults.length) {
        throw failure?.reason ?? new Error("Texturas clássicas 0/2/7/19 incompletas");
      }

      const [particleTexture, flareTexture, shadeTexture, iceTexture] = loadedTextures as [
        THREE.Texture,
        THREE.Texture,
        THREE.Texture,
        THREE.Texture,
      ];
      configureClassicBillboardUvs(particleTexture);
      configureClassicGroundPlaneUvs(flareTexture);

      const spearGeometry = parseMsa(spearSource.buffer).geometry;
      loadedGeometries.push(spearGeometry);
      const freezeBladeGeometry = parseMsa(freezeBladeSource.buffer).geometry;
      loadedGeometries.push(freezeBladeGeometry);

      return {
        spearGeometry,
        freezeBladeGeometry,
        particleTexture,
        flareTexture,
        shadeTexture,
        iceTexture,
      };
    } catch (error) {
      for (const geometry of loadedGeometries) geometry.dispose();
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

function createBrightMeshMaterial(
  texture: THREE.Texture,
  color: number,
  opacity: number,
): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color,
    transparent: true,
    opacity,
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

function createGroundPlane(
  geometry: THREE.PlaneGeometry,
  texture: THREE.Texture,
  name: string,
  rotation: number,
): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const mesh = new THREE.Mesh(geometry, createBrightMeshMaterial(texture, 0xffffff, 1));
  mesh.name = name;
  mesh.rotation.set(-Math.PI / 2, 0, rotation);
  mesh.visible = false;
  return mesh;
}

function createBrightSprite(texture: THREE.Texture, name: string): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: texture,
    color: PARTICLE_COLOR,
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

function setFadedColor(
  material: THREE.MeshBasicMaterial | THREE.SpriteMaterial,
  color: number,
  baseOpacity: number,
  fade: number,
): void {
  const intensity = THREE.MathUtils.clamp(fade, 0, 1);
  material.color.setHex(color).multiplyScalar(intensity);
  material.opacity = baseOpacity * intensity;
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

function deactivateProjectile(visual: IceSpearVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.root.visible = false;
  visual.mesh.visible = false;
  visual.shade.visible = false;
}

function deactivateImpact(visual: FreezeBladeVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.root.visible = false;
  visual.mesh.visible = false;
  visual.flare.visible = false;
}

function deactivateParticle(visual: FreezeParticleVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.sprite.visible = false;
  visual.sprite.material.opacity = 0;
}

function oldestBySerial<T extends { serial: number }>(visuals: readonly T[]): T {
  let oldest = visuals[0]!;
  for (const visual of visuals) {
    if (visual.serial < oldest.serial) oldest = visual;
  }
  return oldest;
}

function oldestActiveBySerial<T extends { active: boolean; serial: number }>(
  visuals: readonly T[],
): T | null {
  let oldest: T | null = null;
  for (const visual of visuals) {
    if (!visual.active || (oldest && visual.serial >= oldest.serial)) continue;
    oldest = visual;
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

function disposeClassicResources(resources: ClassicFoemaIceSpearResources): void {
  resources.spearGeometry.dispose();
  resources.freezeBladeGeometry.dispose();
  resources.particleTexture.dispose();
  resources.flareTexture.dispose();
  resources.shadeTexture.dispose();
  resources.iceTexture.dispose();
}
