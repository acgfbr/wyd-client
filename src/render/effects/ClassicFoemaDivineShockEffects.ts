import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { parseMsa } from "../../formats/classic/Msa";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";

const PROJECTILE_POOL_LIMIT = 16;
const TRAIL_POOL_LIMIT = 96;
const TRAIL_INTERVAL_SECONDS = 0.1;

interface Resources {
  readonly geometry: THREE.BufferGeometry;
  readonly modelTexture: THREE.Texture;
  readonly shadeTexture: THREE.Texture;
  readonly centerLightTexture: THREE.Texture;
  readonly centerLight2Texture: THREE.Texture;
  readonly centerFlareTexture: THREE.Texture;
  readonly trailTexture: THREE.Texture;
}

interface ProjectileVisual {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly shade: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly centerLight: THREE.Sprite;
  readonly centerLight2: THREE.Sprite;
  readonly centerFlare: THREE.Sprite;
  readonly start: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly direction: THREE.Vector3;
  readonly current: THREE.Vector3;
  active: boolean;
  elapsed: number;
  lifetime: number;
  nextTrail: number;
  casterGroundY: number;
  targetGroundY: number;
  serial: number;
}

interface TrailVisual {
  readonly sprite: THREE.Sprite;
  readonly origin: THREE.Vector3;
  active: boolean;
  elapsed: number;
  baseScale: number;
  serial: number;
}

/** Bounded port of Foema #28 TMSkillDoubleSwing level 2. */
export class ClassicFoemaDivineShockEffects {
  readonly object = new THREE.Group();
  readonly #owner: THREE.Object3D;
  readonly #dds = new ClassicDdsTextureLoader();
  readonly #plane = new THREE.PlaneGeometry(1, 1);
  readonly #fallback = createFallbackGlowTexture();
  readonly #fallbackGeometry = new THREE.OctahedronGeometry(0.35, 0);
  readonly #projectiles: ProjectileVisual[] = [];
  readonly #trails: TrailVisual[] = [];
  #resources: Resources | null = null;
  #preload: Promise<void> | null = null;
  #serial = 0;
  #randomSerial = 0;
  #enabled = true;
  #disposed = false;

  constructor(parent: THREE.Object3D) {
    this.#owner = parent;
    this.object.name = "classic-foema-divine-shock-effects";
    parent.add(this.object);
  }

  async prepareClassic(assets: ClassicAssetSource): Promise<void> {
    if (this.#disposed || this.#resources) return;
    if (this.#preload) return this.#preload;
    const job = this.loadResources(assets)
      .then((resources) => {
        if (this.#disposed) {
          disposeResources(resources);
          return;
        }
        this.#resources = resources;
        for (const projectile of this.#projectiles) this.applyProjectileAssets(projectile);
        for (const trail of this.#trails) setMap(trail.sprite.material, resources.trailTexture);
      })
      .catch((error: unknown) => {
        console.warn("Choque Divino clássico indisponível; usando fallback.", error);
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

  play(casterFeet: THREE.Vector3, targetFeet: THREE.Vector3): void {
    if (
      this.#disposed
      || !this.#enabled
      || !isFiniteVector(casterFeet)
      || !isFiniteVector(targetFeet)
    ) return;

    const visual = this.acquireProjectile();
    visual.active = true;
    visual.elapsed = 0;
    visual.nextTrail = TRAIL_INTERVAL_SECONDS;
    visual.casterGroundY = casterFeet.y;
    visual.targetGroundY = targetFeet.y;
    visual.serial = ++this.#serial;
    visual.start.copy(casterFeet);
    visual.target.copy(targetFeet);
    visual.target.y += 1;
    visual.direction.subVectors(visual.target, visual.start);
    visual.current.copy(visual.start);
    const retailMilliseconds = 300 * Math.trunc(visual.direction.length());
    visual.lifetime = THREE.MathUtils.clamp(retailMilliseconds / 1_000, 0.001, 5);
    orientEffectMesh(visual.mesh, visual.direction);
    this.applyProjectileAssets(visual);
    this.updateProjectilePosition(visual, 0);
    setProjectileVisibility(visual, false);

    // m_dwOldTime starts at zero, while the retail server clock is already
    // non-zero: the first FrameMove emits one ground-stuck texture-0 puff.
    this.spawnTrail(visual.current);
  }

  update(deltaSeconds: number): void {
    if (this.#disposed || !this.#enabled) return;
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    if (delta === 0) return;

    for (const trail of this.#trails) {
      if (!trail.active) continue;
      trail.elapsed += delta;
      this.updateTrail(trail);
    }
    for (const visual of this.#projectiles) {
      if (!visual.active) continue;
      visual.elapsed += delta;
      this.updateProjectile(visual);
    }
  }

  clear(): void {
    for (const visual of this.#projectiles) deactivateProjectile(visual);
    for (const trail of this.#trails) deactivateTrail(trail);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clear();
    this.#owner.remove(this.object);
    for (const visual of this.#projectiles) {
      visual.mesh.material.dispose();
      visual.shade.material.dispose();
      visual.centerLight.material.dispose();
      visual.centerLight2.material.dispose();
      visual.centerFlare.material.dispose();
    }
    for (const trail of this.#trails) trail.sprite.material.dispose();
    this.#projectiles.length = 0;
    this.#trails.length = 0;
    this.#plane.dispose();
    this.#fallback.dispose();
    this.#fallbackGeometry.dispose();
    if (this.#resources) disposeResources(this.#resources);
    this.#resources = null;
  }

  private updateProjectile(visual: ProjectileVisual): void {
    const progress = Math.min(1, visual.elapsed / visual.lifetime);
    this.updateProjectilePosition(visual, progress);
    const visible = progress >= 0.05;
    setProjectileVisibility(visual, visible);

    while (visual.nextTrail <= visual.elapsed && visual.nextTrail < visual.lifetime) {
      const trailProgress = visual.nextTrail / visual.lifetime;
      const position = visual.start.clone().addScaledVector(
        visual.direction,
        trailProgress * 4,
      );
      position.y -= 0.5;
      this.spawnTrail(position);
      visual.nextTrail += TRAIL_INTERVAL_SECONDS;
    }

    if (progress >= 1) deactivateProjectile(visual);
  }

  private updateProjectilePosition(visual: ProjectileVisual, progress: number): void {
    // Level 2 uses target + direction*3, so the effect crosses the target and
    // completes four times the original start-to-target segment.
    const pathProgress = progress * 4;
    visual.current.copy(visual.start).addScaledVector(visual.direction, pathProgress);
    visual.mesh.position.copy(visual.current);
    visual.mesh.rotation.z = Math.PI / 2 + visual.elapsed * Math.PI * 2;

    const centerPosition = visual.current.clone();
    centerPosition.y -= 0.5;
    visual.centerLight.position.copy(centerPosition);
    visual.centerLight2.position.copy(centerPosition);
    visual.centerFlare.position.copy(centerPosition);

    const groundY = THREE.MathUtils.lerp(
      visual.casterGroundY,
      visual.targetGroundY,
      pathProgress,
    );
    visual.shade.position.set(visual.current.x, groundY + 0.005, visual.current.z);
  }

  private acquireProjectile(): ProjectileVisual {
    const free = this.#projectiles.find((visual) => !visual.active);
    if (free) return free;
    if (this.#projectiles.length < PROJECTILE_POOL_LIMIT) {
      const index = this.#projectiles.length;
      const mesh = new THREE.Mesh(
        this.#fallbackGeometry,
        createBrightMaterial(this.#fallback, 0xaaaaaa),
      );
      mesh.name = `classic-foema-divine-shock-model-12-${index}`;
      mesh.renderOrder = 9;
      const shade = new THREE.Mesh(
        this.#plane,
        createBrightMaterial(this.#fallback, 0x003355),
      );
      shade.name = `classic-foema-divine-shock-shade-7-${index}`;
      shade.rotation.x = -Math.PI / 2;
      shade.scale.set(4, 4, 1);
      shade.renderOrder = 5;
      const centerLight = createBrightSprite(
        this.#fallback,
        `classic-foema-divine-shock-center-56-${index}`,
        0x55eeff,
      );
      centerLight.scale.set(1, 1, 1);
      const centerLight2 = createBrightSprite(
        this.#fallback,
        `classic-foema-divine-shock-center-2-${index}`,
        0xffffff,
      );
      centerLight2.scale.set(0.5, 0.5, 1);
      const centerFlare = createBrightSprite(
        this.#fallback,
        `classic-foema-divine-shock-flare-60-${index}`,
        0x003344,
      );
      centerFlare.scale.set(2.5, 2, 1);
      const visual: ProjectileVisual = {
        mesh,
        shade,
        centerLight,
        centerLight2,
        centerFlare,
        start: new THREE.Vector3(),
        target: new THREE.Vector3(),
        direction: new THREE.Vector3(),
        current: new THREE.Vector3(),
        active: false,
        elapsed: 0,
        lifetime: 1,
        nextTrail: TRAIL_INTERVAL_SECONDS,
        casterGroundY: 0,
        targetGroundY: 0,
        serial: 0,
      };
      this.#projectiles.push(visual);
      this.object.add(shade, mesh, centerFlare, centerLight, centerLight2);
      return visual;
    }
    const oldest = oldestBySerial(this.#projectiles);
    deactivateProjectile(oldest);
    return oldest;
  }

  private applyProjectileAssets(visual: ProjectileVisual): void {
    const resources = this.#resources;
    visual.mesh.geometry = resources?.geometry ?? this.#fallbackGeometry;
    setMap(visual.mesh.material, resources?.modelTexture ?? this.#fallback);
    setMap(visual.shade.material, resources?.shadeTexture ?? this.#fallback);
    setMap(visual.centerLight.material, resources?.centerLightTexture ?? this.#fallback);
    setMap(visual.centerLight2.material, resources?.centerLight2Texture ?? this.#fallback);
    setMap(visual.centerFlare.material, resources?.centerFlareTexture ?? this.#fallback);
  }

  private spawnTrail(position: THREE.Vector3): void {
    const trail = this.acquireTrail();
    const random = classicRandomStep(++this.#randomSerial, 5);
    trail.active = true;
    trail.elapsed = 0;
    trail.baseScale = 0.3 + random * 0.2;
    trail.serial = ++this.#serial;
    trail.origin.copy(position);
    setMap(trail.sprite.material, this.#resources?.trailTexture ?? this.#fallback);
    this.updateTrail(trail);
  }

  private acquireTrail(): TrailVisual {
    const free = this.#trails.find((trail) => !trail.active);
    if (free) return free;
    if (this.#trails.length < TRAIL_POOL_LIMIT) {
      const sprite = createBrightSprite(
        this.#fallback,
        `classic-foema-divine-shock-trail-0-${this.#trails.length}`,
        0xffffff,
      );
      const trail: TrailVisual = {
        sprite,
        origin: new THREE.Vector3(),
        active: false,
        elapsed: 0,
        baseScale: 0.3,
        serial: 0,
      };
      this.#trails.push(trail);
      this.object.add(sprite);
      return trail;
    }
    const oldest = oldestBySerial(this.#trails);
    deactivateTrail(oldest);
    return oldest;
  }

  private updateTrail(trail: TrailVisual): void {
    if (trail.elapsed >= 1) {
      deactivateTrail(trail);
      return;
    }
    const scale = trail.baseScale + trail.elapsed;
    trail.sprite.position.copy(trail.origin);
    trail.sprite.position.y += scale * 0.5;
    trail.sprite.scale.setScalar(scale);
    trail.sprite.material.opacity = Math.sin(trail.elapsed * Math.PI);
    trail.sprite.visible = true;
  }

  private async loadResources(assets: ClassicAssetSource): Promise<Resources> {
    const model = await assets.loadModel(12);
    if (!model) throw new Error("Modelo clássico 12 ausente");
    const geometry = parseMsa(model.buffer).geometry;
    let textures: THREE.Texture[] = [];
    try {
      textures = await Promise.all(
        [91, 7, 56, 2, 60, 0].map((index) => this.loadEffectTexture(assets, index)),
      );
      const [modelTexture, shadeTexture, centerLightTexture, centerLight2Texture, centerFlareTexture, trailTexture] = textures;
      configureGroundUvs(shadeTexture!);
      for (const texture of [centerLightTexture!, centerLight2Texture!, centerFlareTexture!, trailTexture!]) {
        configureBillboardUvs(texture);
      }
      return {
        geometry,
        modelTexture: modelTexture!,
        shadeTexture: shadeTexture!,
        centerLightTexture: centerLightTexture!,
        centerLight2Texture: centerLight2Texture!,
        centerFlareTexture: centerFlareTexture!,
        trailTexture: trailTexture!,
      };
    } catch (error) {
      geometry.dispose();
      for (const texture of textures) texture.dispose();
      throw error;
    }
  }

  private async loadEffectTexture(assets: ClassicAssetSource, index: number): Promise<THREE.Texture> {
    const url = assets.effectTextureUrl(index);
    if (!url) throw new Error(`Textura de efeito ${index} ausente`);
    const texture = await this.#dds.loadAsync(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  }
}

const FORWARD_FALLBACK = new THREE.Vector3(0, 0, 1);

function orientEffectMesh(
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>,
  direction: THREE.Vector3,
): void {
  const horizontal = direction.lengthSq() > 1e-10 ? direction : FORWARD_FALLBACK;
  const angle = Math.atan2(horizontal.x, horizontal.z) - Math.PI / 2;
  mesh.rotation.set(Math.PI / 2, -angle, Math.PI / 2, "YXZ");
}

function createBrightMaterial(
  texture: THREE.Texture,
  color: number,
): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
  material.forceSinglePass = true;
  return material;
}

function createBrightSprite(texture: THREE.Texture, name: string, color: number): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: texture,
    color,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.name = name;
  sprite.visible = false;
  sprite.renderOrder = 10;
  return sprite;
}

function setMap(
  material: THREE.MeshBasicMaterial | THREE.SpriteMaterial,
  texture: THREE.Texture,
): void {
  if (material.map === texture) return;
  material.map = texture;
  material.needsUpdate = true;
}

function setProjectileVisibility(visual: ProjectileVisual, visible: boolean): void {
  visual.mesh.visible = visible;
  visual.shade.visible = true;
  visual.centerLight.visible = visible;
  visual.centerLight2.visible = visible;
  visual.centerFlare.visible = visible;
}

function deactivateProjectile(visual: ProjectileVisual): void {
  visual.active = false;
  visual.mesh.visible = false;
  visual.shade.visible = false;
  visual.centerLight.visible = false;
  visual.centerLight2.visible = false;
  visual.centerFlare.visible = false;
}

function deactivateTrail(trail: TrailVisual): void {
  trail.active = false;
  trail.sprite.visible = false;
}

function configureBillboardUvs(texture: THREE.Texture): void {
  texture.offset.set(0.02, 0.98);
  texture.repeat.set(0.96, -0.96);
  texture.needsUpdate = true;
}

function configureGroundUvs(texture: THREE.Texture): void {
  texture.offset.set(0.02, 0.02);
  texture.repeat.set(0.96, 0.96);
  texture.needsUpdate = true;
}

function classicRandomStep(serial: number, modulus: number): number {
  const seed = Math.imul(serial, 1_103_515_245) + 12_345;
  return (seed >>> 16) % modulus;
}

function oldestBySerial<T extends { serial: number }>(entries: readonly T[]): T {
  let oldest = entries[0]!;
  for (const entry of entries) if (entry.serial < oldest.serial) oldest = entry;
  return oldest;
}

function isFiniteVector(position: THREE.Vector3): boolean {
  return Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
}

function createFallbackGlowTexture(): THREE.DataTexture {
  const data = new Uint8Array([
    0, 0, 0, 0, 255, 255, 255, 255,
    255, 255, 255, 255, 0, 0, 0, 0,
  ]);
  const texture = new THREE.DataTexture(data, 2, 2, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function disposeResources(resources: Resources): void {
  resources.geometry.dispose();
  resources.modelTexture.dispose();
  resources.shadeTexture.dispose();
  resources.centerLightTexture.dispose();
  resources.centerLight2Texture.dispose();
  resources.centerFlareTexture.dispose();
  resources.trailTexture.dispose();
}
