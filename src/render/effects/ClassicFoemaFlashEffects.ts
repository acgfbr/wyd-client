import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";

const CAST_POOL_LIMIT = 8;
const BILLBOARD_LIFETIMES = [1.5, 1.9, 2.3, 2.7] as const;
const BILLBOARD_OFFSETS = [
  [-1, 0],
  [0, -0.5],
  [-0.5, 0],
  [-0.5, -0.5],
] as const;

interface Resources {
  readonly pillar: THREE.Texture;
  readonly ring: THREE.Texture;
  readonly flare: THREE.Texture;
  readonly shade: THREE.Texture;
}

interface FlashVisual {
  readonly root: THREE.Group;
  readonly pillars: readonly THREE.Sprite[];
  readonly ring: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly flare: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly shade: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  active: boolean;
  elapsed: number;
  serial: number;
}

/** Bounded port of Foema #26 TMSkillFlash type 0. */
export class ClassicFoemaFlashEffects {
  readonly object = new THREE.Group();
  readonly #owner: THREE.Object3D;
  readonly #dds = new ClassicDdsTextureLoader();
  readonly #plane = new THREE.PlaneGeometry(1, 1);
  readonly #fallback = createFallbackGlowTexture();
  readonly #visuals: FlashVisual[] = [];
  #resources: Resources | null = null;
  #preload: Promise<void> | null = null;
  #serial = 0;
  #enabled = true;
  #disposed = false;

  constructor(parent: THREE.Object3D) {
    this.#owner = parent;
    this.object.name = "classic-foema-flash-effects";
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
        for (const visual of this.#visuals) this.applyAssets(visual);
      })
      .catch((error: unknown) => {
        console.warn("Flash clássico indisponível; usando fallback.", error);
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

  play(casterFeet: THREE.Vector3): void {
    if (this.#disposed || !this.#enabled || !isFiniteVector(casterFeet)) return;
    const visual = this.acquireVisual();
    visual.active = true;
    visual.elapsed = 0;
    visual.serial = ++this.#serial;
    visual.root.position.copy(casterFeet);
    visual.root.position.y -= 0.5;
    visual.root.visible = true;
    this.applyAssets(visual);
    this.updateVisual(visual);
  }

  update(deltaSeconds: number): void {
    if (this.#disposed || !this.#enabled) return;
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    if (delta === 0) return;
    for (const visual of this.#visuals) {
      if (!visual.active) continue;
      visual.elapsed += delta;
      this.updateVisual(visual);
    }
  }

  clear(): void {
    for (const visual of this.#visuals) deactivateVisual(visual);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clear();
    this.#owner.remove(this.object);
    for (const visual of this.#visuals) {
      for (const pillar of visual.pillars) pillar.material.dispose();
      visual.ring.material.dispose();
      visual.flare.material.dispose();
      visual.shade.material.dispose();
    }
    this.#visuals.length = 0;
    this.#plane.dispose();
    this.#fallback.dispose();
    if (this.#resources) disposeResources(this.#resources);
    this.#resources = null;
  }

  private acquireVisual(): FlashVisual {
    const free = this.#visuals.find((visual) => !visual.active);
    if (free) return free;
    if (this.#visuals.length < CAST_POOL_LIMIT) {
      const index = this.#visuals.length;
      const root = new THREE.Group();
      root.name = `classic-foema-flash-${index}`;
      const pillars = BILLBOARD_OFFSETS.map(([x, z], pillarIndex) => {
        const sprite = createBrightSprite(
          this.#fallback,
          `classic-foema-flash-pillar-58-${index}-${pillarIndex}`,
          0xffff9c,
        );
        sprite.position.set(x, 0, z);
        root.add(sprite);
        return sprite;
      });
      const ring = createGroundPlane(
        this.#plane,
        this.#fallback,
        `classic-foema-flash-ring-93-${index}`,
      );
      ring.position.y = 0.1;
      const flare = createGroundPlane(
        this.#plane,
        this.#fallback,
        `classic-foema-flash-flare-2-${index}`,
      );
      flare.position.y = 0.3;
      const shade = createGroundPlane(
        this.#plane,
        this.#fallback,
        `classic-foema-flash-shade-7-${index}`,
      );
      shade.position.y = 0.005;
      root.add(shade, ring, flare);
      const visual: FlashVisual = {
        root,
        pillars,
        ring,
        flare,
        shade,
        active: false,
        elapsed: 0,
        serial: 0,
      };
      this.#visuals.push(visual);
      this.object.add(root);
      return visual;
    }
    const oldest = oldestBySerial(this.#visuals);
    deactivateVisual(oldest);
    return oldest;
  }

  private applyAssets(visual: FlashVisual): void {
    const resources = this.#resources;
    for (const pillar of visual.pillars) {
      setMap(pillar.material, resources?.pillar ?? this.#fallback);
    }
    setMap(visual.ring.material, resources?.ring ?? this.#fallback);
    setMap(visual.flare.material, resources?.flare ?? this.#fallback);
    setMap(visual.shade.material, resources?.shade ?? this.#fallback);
  }

  private updateVisual(visual: FlashVisual): void {
    for (let index = 0; index < visual.pillars.length; index++) {
      const pillar = visual.pillars[index]!;
      const lifetime = BILLBOARD_LIFETIMES[index]!;
      const progress = visual.elapsed / lifetime;
      pillar.visible = progress < 1 && progress >= 0.05;
      if (progress >= 1) continue;
      const height = 0.8 + visual.elapsed * (2 + index);
      pillar.scale.set(0.6, height, 1);
      pillar.position.y = height * 0.5;
      setIntensity(pillar.material, 0xffff9c, Math.sin(progress * Math.PI));
    }

    const planeProgress = visual.elapsed / 2;
    const planesVisible = planeProgress < 1 && planeProgress >= 0.05;
    const planeScale = 0.009 + visual.elapsed * 2;
    visual.ring.visible = planesVisible;
    visual.ring.scale.setScalar(planeScale);
    setIntensity(visual.ring.material, 0xffffff, Math.sin(planeProgress * Math.PI));
    visual.flare.visible = planesVisible;
    visual.flare.scale.setScalar(2 + visual.elapsed * 2);
    setIntensity(visual.flare.material, 0xaaaaaa, Math.sin(planeProgress * Math.PI));

    const shadeProgress = visual.elapsed / 3;
    visual.shade.visible = shadeProgress < 1;
    visual.shade.scale.set(8, 8, 1);
    setIntensity(visual.shade.material, 0x555555, Math.max(0, 1 - shadeProgress));
    if (visual.elapsed >= 3) deactivateVisual(visual);
  }

  private async loadResources(assets: ClassicAssetSource): Promise<Resources> {
    let textures: THREE.Texture[] = [];
    try {
      textures = await Promise.all(
        [58, 93, 2, 7].map((index) => this.loadTexture(assets, index)),
      );
      const [pillar, ring, flare, shade] = textures;
      configureBillboardUvs(pillar!);
      configureGroundUvs(shade!);
      return { pillar: pillar!, ring: ring!, flare: flare!, shade: shade! };
    } catch (error) {
      for (const texture of textures) texture.dispose();
      throw error;
    }
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
  sprite.renderOrder = 9;
  return sprite;
}

function createGroundPlane(
  geometry: THREE.PlaneGeometry,
  texture: THREE.Texture,
  name: string,
): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
  material.forceSinglePass = true;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
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

function setIntensity(
  material: THREE.MeshBasicMaterial | THREE.SpriteMaterial,
  color: number,
  intensity: number,
): void {
  const value = THREE.MathUtils.clamp(intensity, 0, 1);
  material.color.setHex(color).multiplyScalar(value);
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

function deactivateVisual(visual: FlashVisual): void {
  visual.active = false;
  visual.root.visible = false;
  for (const pillar of visual.pillars) pillar.visible = false;
  visual.ring.visible = false;
  visual.flare.visible = false;
  visual.shade.visible = false;
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
  resources.pillar.dispose();
  resources.ring.dispose();
  resources.flare.dispose();
  resources.shade.dispose();
}
