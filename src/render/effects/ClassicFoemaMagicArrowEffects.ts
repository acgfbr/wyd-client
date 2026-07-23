import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { parseMsa } from "../../formats/classic/Msa";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";

const ARROW_POOL_LIMIT = 20;
const PARTICLE_POOL_LIMIT = 160;
const IMPACT_POOL_LIMIT = 20;
const TRAIL_INTERVAL_SECONDS = 0.03;

interface Resources {
  readonly geometry: THREE.BufferGeometry;
  readonly frames: readonly THREE.Texture[];
  readonly particle: THREE.Texture;
  readonly impact: THREE.Texture;
  readonly shade: THREE.Texture;
}

interface ArrowVisual {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly shade: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly start: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly current: THREE.Vector3;
  active: boolean;
  elapsed: number;
  lifetime: number;
  nextEmission: number;
  serial: number;
}

interface ParticleVisual {
  readonly sprite: THREE.Sprite;
  readonly origin: THREE.Vector3;
  active: boolean;
  elapsed: number;
  lifetime: number;
  baseScale: number;
  serial: number;
}

interface ImpactVisual {
  readonly root: THREE.Group;
  readonly sprite: THREE.Sprite;
  readonly shade: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  active: boolean;
  elapsed: number;
  serial: number;
}

/** Exact bounded presentation controller for Foema #24 TMSkillMagicArrow type 0. */
export class ClassicFoemaMagicArrowEffects {
  readonly object = new THREE.Group();
  readonly #owner: THREE.Object3D;
  readonly #dds = new ClassicDdsTextureLoader();
  readonly #plane = new THREE.PlaneGeometry(1, 1);
  readonly #fallback = createFallbackGlowTexture();
  readonly #fallbackGeometry = new THREE.OctahedronGeometry(0.3, 0);
  readonly #arrows: ArrowVisual[] = [];
  readonly #particles: ParticleVisual[] = [];
  readonly #impacts: ImpactVisual[] = [];
  #resources: Resources | null = null;
  #preload: Promise<void> | null = null;
  #serial = 0;
  #randomSerial = 0;
  #enabled = true;
  #disposed = false;

  constructor(parent: THREE.Object3D) {
    this.#owner = parent;
    this.object.name = "classic-foema-magic-arrow-effects";
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
        for (const arrow of this.#arrows) this.applyArrowAssets(arrow);
        for (const particle of this.#particles) {
          setMap(particle.sprite.material, resources.particle);
        }
        for (const impact of this.#impacts) this.applyImpactAssets(impact);
      })
      .catch((error: unknown) => {
        console.warn("Flecha Mágica clássica indisponível; usando fallback.", error);
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
    const arrow = this.acquireArrow();
    arrow.active = true;
    arrow.elapsed = 0;
    arrow.nextEmission = 0;
    arrow.serial = ++this.#serial;
    arrow.start.copy(casterFeet);
    arrow.start.y += 1;
    arrow.target.copy(targetFeet);
    arrow.target.y += 1;
    arrow.current.copy(arrow.start);
    const retailMilliseconds = Math.trunc(arrow.start.distanceTo(arrow.target) * 50);
    arrow.lifetime = THREE.MathUtils.clamp(retailMilliseconds / 1000, 0.001, 5);
    arrow.mesh.visible = false;
    arrow.shade.visible = true;
    this.applyArrowAssets(arrow);
    this.updateArrow(arrow);
  }

  update(deltaSeconds: number): void {
    if (this.#disposed || !this.#enabled) return;
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    if (delta === 0) return;
    for (const particle of this.#particles) {
      if (!particle.active) continue;
      particle.elapsed += delta;
      this.updateParticle(particle);
    }
    for (const impact of this.#impacts) {
      if (!impact.active) continue;
      impact.elapsed += delta;
      this.updateImpact(impact);
    }
    for (const arrow of this.#arrows) {
      if (!arrow.active) continue;
      arrow.elapsed += delta;
      this.updateArrow(arrow);
    }
  }

  clear(): void {
    for (const arrow of this.#arrows) deactivateArrow(arrow);
    for (const particle of this.#particles) deactivateParticle(particle);
    for (const impact of this.#impacts) deactivateImpact(impact);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clear();
    this.#owner.remove(this.object);
    for (const arrow of this.#arrows) {
      arrow.mesh.material.dispose();
      arrow.shade.material.dispose();
    }
    for (const particle of this.#particles) particle.sprite.material.dispose();
    for (const impact of this.#impacts) {
      impact.sprite.material.dispose();
      impact.shade.material.dispose();
    }
    this.#arrows.length = 0;
    this.#particles.length = 0;
    this.#impacts.length = 0;
    this.#plane.dispose();
    this.#fallback.dispose();
    this.#fallbackGeometry.dispose();
    if (this.#resources) disposeResources(this.#resources);
    this.#resources = null;
  }

  private acquireArrow(): ArrowVisual {
    const free = this.#arrows.find((arrow) => !arrow.active);
    if (free) return free;
    if (this.#arrows.length < ARROW_POOL_LIMIT) {
      const mesh = new THREE.Mesh(
        this.#fallbackGeometry,
        createBrightMaterial(this.#fallback, 0xaa88ff),
      );
      mesh.name = `classic-foema-magic-arrow-model-701-${this.#arrows.length}`;
      mesh.scale.setScalar(0.69);
      mesh.renderOrder = 9;
      const shade = createGroundPlane(
        this.#plane,
        this.#fallback,
        `classic-foema-magic-arrow-moving-shade-${this.#arrows.length}`,
      );
      shade.scale.set(4, 4, 1);
      const arrow: ArrowVisual = {
        mesh,
        shade,
        start: new THREE.Vector3(),
        target: new THREE.Vector3(),
        current: new THREE.Vector3(),
        active: false,
        elapsed: 0,
        lifetime: 1,
        nextEmission: 0,
        serial: 0,
      };
      this.#arrows.push(arrow);
      this.object.add(shade, mesh);
      return arrow;
    }
    const oldest = oldestBySerial(this.#arrows);
    deactivateArrow(oldest);
    return oldest;
  }

  private applyArrowAssets(arrow: ArrowVisual): void {
    arrow.mesh.geometry = this.#resources?.geometry ?? this.#fallbackGeometry;
    setMap(arrow.mesh.material, this.#resources?.frames[0] ?? this.#fallback);
    setMap(arrow.shade.material, this.#resources?.shade ?? this.#fallback);
  }

  private updateArrow(arrow: ArrowVisual): void {
    const progress = Math.min(1, arrow.elapsed / arrow.lifetime);
    arrow.current.copy(arrow.start).lerp(arrow.target, progress);
    arrow.mesh.position.copy(arrow.current);
    arrow.mesh.rotation.set(0, Math.atan2(
      arrow.target.x - arrow.start.x,
      arrow.target.z - arrow.start.z,
    ) - Math.PI / 2, 0);
    const frame = Math.floor(arrow.elapsed / 0.04) % 6;
    setMap(arrow.mesh.material, this.#resources?.frames[frame] ?? this.#fallback);
    arrow.mesh.visible = progress >= 0.05;
    arrow.shade.position.set(
      arrow.current.x,
      Math.min(arrow.start.y, arrow.target.y) - 0.995,
      arrow.current.z,
    );
    setColor(arrow.shade.material, 0xff4422aa, 1);
    arrow.shade.visible = true;

    while (arrow.nextEmission <= arrow.elapsed && arrow.nextEmission < arrow.lifetime) {
      const emissionProgress = arrow.nextEmission / arrow.lifetime;
      const emissionPosition = arrow.start.clone().lerp(arrow.target, emissionProgress);
      for (let index = 0; index < 3; index++) this.spawnParticle(emissionPosition, index);
      arrow.nextEmission += TRAIL_INTERVAL_SECONDS;
    }
    if (progress < 1) return;
    this.spawnImpact(arrow.target);
    deactivateArrow(arrow);
  }

  private spawnParticle(position: THREE.Vector3, lane: number): void {
    const particle = this.acquireParticle();
    const random = classicRandomStep(++this.#randomSerial, lane, 5);
    particle.active = true;
    particle.elapsed = 0;
    particle.lifetime = 1;
    particle.baseScale = random * 0.2 + 0.3;
    particle.serial = ++this.#serial;
    particle.origin.copy(position);
    particle.origin.x += random * 0.1;
    particle.origin.y -= 1;
    particle.origin.z += random * 0.1;
    setMap(particle.sprite.material, this.#resources?.particle ?? this.#fallback);
    this.updateParticle(particle);
  }

  private acquireParticle(): ParticleVisual {
    const free = this.#particles.find((particle) => !particle.active);
    if (free) return free;
    if (this.#particles.length < PARTICLE_POOL_LIMIT) {
      const sprite = createBrightSprite(
        this.#fallback,
        `classic-foema-magic-arrow-particle-${this.#particles.length}`,
      );
      const particle: ParticleVisual = {
        sprite,
        origin: new THREE.Vector3(),
        active: false,
        elapsed: 0,
        lifetime: 1,
        baseScale: 0.3,
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

  private updateParticle(particle: ParticleVisual): void {
    if (particle.elapsed >= particle.lifetime) {
      deactivateParticle(particle);
      return;
    }
    const progress = particle.elapsed / particle.lifetime;
    const scale = particle.baseScale + particle.elapsed;
    particle.sprite.position.copy(particle.origin);
    particle.sprite.position.y += scale / 2;
    particle.sprite.scale.setScalar(scale);
    setColor(particle.sprite.material, 0xff4422aa, Math.sin(progress * Math.PI));
    particle.sprite.visible = progress >= 0.05;
  }

  private spawnImpact(position: THREE.Vector3): void {
    const impact = this.acquireImpact();
    impact.active = true;
    impact.elapsed = 0;
    impact.serial = ++this.#serial;
    impact.root.position.copy(position);
    impact.sprite.position.set(0, -0.5, 0);
    impact.shade.position.set(0, -0.995, 0);
    impact.root.visible = true;
    this.applyImpactAssets(impact);
    this.updateImpact(impact);
  }

  private acquireImpact(): ImpactVisual {
    const free = this.#impacts.find((impact) => !impact.active);
    if (free) return free;
    if (this.#impacts.length < IMPACT_POOL_LIMIT) {
      const root = new THREE.Group();
      root.name = `classic-foema-magic-arrow-impact-${this.#impacts.length}`;
      const sprite = createBrightSprite(this.#fallback, "classic-foema-magic-arrow-impact-71");
      const shade = createGroundPlane(this.#plane, this.#fallback, "classic-foema-magic-arrow-impact-shade-7");
      shade.scale.set(4, 4, 1);
      root.add(sprite, shade);
      const impact: ImpactVisual = {
        root,
        sprite,
        shade,
        active: false,
        elapsed: 0,
        serial: 0,
      };
      this.#impacts.push(impact);
      this.object.add(root);
      return impact;
    }
    const oldest = oldestBySerial(this.#impacts);
    deactivateImpact(oldest);
    return oldest;
  }

  private applyImpactAssets(impact: ImpactVisual): void {
    setMap(impact.sprite.material, this.#resources?.impact ?? this.#fallback);
    setMap(impact.shade.material, this.#resources?.shade ?? this.#fallback);
  }

  private updateImpact(impact: ImpactVisual): void {
    if (impact.elapsed >= 1.5) {
      deactivateImpact(impact);
      return;
    }
    impact.sprite.visible = impact.elapsed < 0.888;
    impact.sprite.scale.setScalar(1.5);
    setColor(impact.sprite.material, 0xffffffff, 1);
    impact.shade.visible = true;
    setColor(impact.shade.material, 0xff4422aa, Math.cos(impact.elapsed / 1.5 * Math.PI / 2));
  }

  private async loadResources(assets: ClassicAssetSource): Promise<Resources> {
    const model = await assets.loadModel(701);
    if (!model) throw new Error("Modelo clássico 701 ausente");
    const geometry = parseMsa(model.buffer).geometry;
    let textures: THREE.Texture[] = [];
    try {
      textures = await Promise.all([
        ...Array.from({ length: 6 }, (_, index) => this.loadEffectTexture(assets, 20 + index)),
        this.loadEffectTexture(assets, 0),
        this.loadEffectTexture(assets, 71),
        this.loadEffectTexture(assets, 7),
      ]);
      const [f0, f1, f2, f3, f4, f5, particle, impact, shade] = textures;
      configureBillboardUvs(particle!);
      configureBillboardUvs(impact!);
      configureGroundUvs(shade!);
      return {
        geometry,
        frames: [f0!, f1!, f2!, f3!, f4!, f5!],
        particle: particle!,
        impact: impact!,
        shade: shade!,
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

function createBrightMaterial(texture: THREE.Texture, color: number): THREE.MeshBasicMaterial {
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

function createBrightSprite(texture: THREE.Texture, name: string): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: texture,
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.name = name;
  sprite.visible = false;
  sprite.renderOrder = 9;
  return sprite;
}

function createGroundPlane(
  geometry: THREE.PlaneGeometry,
  texture: THREE.Texture,
  name: string,
): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const mesh = new THREE.Mesh(geometry, createBrightMaterial(texture, 0xffffff));
  mesh.name = name;
  mesh.rotation.x = -Math.PI / 2;
  mesh.visible = false;
  mesh.renderOrder = 6;
  return mesh;
}

function setMap(
  material: THREE.MeshBasicMaterial | THREE.SpriteMaterial,
  texture: THREE.Texture,
): void {
  if (material.map === texture) return;
  material.map = texture;
  material.needsUpdate = true;
}

function setColor(
  material: THREE.MeshBasicMaterial | THREE.SpriteMaterial,
  color: number,
  intensity: number,
): void {
  const value = THREE.MathUtils.clamp(intensity, 0, 1);
  material.color.setHex(color & 0xffffff).multiplyScalar(value);
  material.opacity = value;
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

function deactivateArrow(arrow: ArrowVisual): void {
  arrow.active = false;
  arrow.mesh.visible = false;
  arrow.shade.visible = false;
}

function deactivateParticle(particle: ParticleVisual): void {
  particle.active = false;
  particle.sprite.visible = false;
}

function deactivateImpact(impact: ImpactVisual): void {
  impact.active = false;
  impact.root.visible = false;
  impact.sprite.visible = false;
  impact.shade.visible = false;
}

function oldestBySerial<T extends { serial: number }>(entries: readonly T[]): T {
  let oldest = entries[0]!;
  for (const entry of entries) if (entry.serial < oldest.serial) oldest = entry;
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
  for (const texture of resources.frames) texture.dispose();
  resources.particle.dispose();
  resources.impact.dispose();
  resources.shade.dispose();
}
