import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { parseMsa } from "../../formats/classic/Msa";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";

const POOL_LIMIT = 8;
const LIFETIME_SECONDS = 3;
const RING_OWNER_LIFETIME_SECONDS = 0.3;

interface Resources {
  readonly geometry: THREE.BufferGeometry;
  readonly modelTexture: THREE.Texture;
  readonly ringTexture: THREE.Texture;
}

interface JudgementVisual {
  readonly root: THREE.Group;
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly rings: readonly [
    THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
    THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
  ];
  active: boolean;
  elapsed: number;
  serial: number;
}

/** Bounded port of Foema #30 TMSkillJudgement type 0. */
export class ClassicFoemaDivineJudgementEffects {
  readonly object = new THREE.Group();
  readonly #owner: THREE.Object3D;
  readonly #dds = new ClassicDdsTextureLoader();
  readonly #plane = new THREE.PlaneGeometry(1, 1);
  readonly #fallback = createFallbackGlowTexture();
  readonly #fallbackGeometry = new THREE.ConeGeometry(0.5, 1.5, 8);
  readonly #visuals: JudgementVisual[] = [];
  #resources: Resources | null = null;
  #preload: Promise<void> | null = null;
  #serial = 0;
  #enabled = true;
  #disposed = false;

  constructor(parent: THREE.Object3D) {
    this.#owner = parent;
    this.object.name = "classic-foema-divine-judgement-effects";
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
        console.warn("Julgamento Divino clássico indisponível; usando fallback.", error);
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
    visual.root.position.y += 0.5;
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
      visual.mesh.material.dispose();
      for (const ring of visual.rings) ring.material.dispose();
    }
    this.#visuals.length = 0;
    this.#plane.dispose();
    this.#fallback.dispose();
    this.#fallbackGeometry.dispose();
    if (this.#resources) disposeResources(this.#resources);
    this.#resources = null;
  }

  private acquireVisual(): JudgementVisual {
    const free = this.#visuals.find((visual) => !visual.active);
    if (free) return free;
    if (this.#visuals.length < POOL_LIMIT) {
      const index = this.#visuals.length;
      const root = new THREE.Group();
      root.name = `classic-foema-divine-judgement-${index}`;
      const mesh = new THREE.Mesh(
        this.#fallbackGeometry,
        createBrightMaterial(this.#fallback, 0x333355, 0x88 / 0xff),
      );
      mesh.name = `classic-foema-divine-judgement-model-10-${index}`;
      mesh.rotation.set(Math.PI / 2, 0, Math.PI / 2, "YXZ");
      mesh.renderOrder = 8;
      const createRing = (color: number, ringIndex: number) => {
        const ring = new THREE.Mesh(
          this.#plane,
          createBrightMaterial(this.#fallback, color, 0x88 / 0xff),
        );
        ring.name = `classic-foema-divine-judgement-ring-124-${index}-${ringIndex}`;
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.3 + ringIndex * 0.01;
        ring.scale.set(8, 8, 1);
        ring.renderOrder = 6 + ringIndex;
        root.add(ring);
        return ring;
      };
      const rings: JudgementVisual["rings"] = [
        createRing(0x333355, 0),
        createRing(0x555555, 1),
      ];
      root.add(mesh);
      const visual: JudgementVisual = {
        root,
        mesh,
        rings,
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

  private applyAssets(visual: JudgementVisual): void {
    visual.mesh.geometry = this.#resources?.geometry ?? this.#fallbackGeometry;
    setMap(visual.mesh.material, this.#resources?.modelTexture ?? this.#fallback);
    for (const ring of visual.rings) {
      setMap(ring.material, this.#resources?.ringTexture ?? this.#fallback);
    }
  }

  private updateVisual(visual: JudgementVisual): void {
    if (visual.elapsed >= LIFETIME_SECONDS) {
      deactivateVisual(visual);
      return;
    }

    // TMEffectMesh type 2 uses one 3 s cycle: fixed horizontal scale, vertical
    // growth to 3x and a half-turn around its authored yaw.
    const progress = visual.elapsed / LIFETIME_SECONDS;
    visual.mesh.visible = true;
    visual.mesh.scale.set(4, 12 * progress, 4);
    visual.mesh.rotation.z = Math.PI / 2 + progress * Math.PI;
    setIntensity(visual.mesh.material, 0x333355, 1, 0x88 / 0xff);

    // TMSkillJudgement owns and deletes both 3 s Billboard2 rings after only
    // 300 ms. Their own 5% render gate means they appear from 150–300 ms.
    const ringsVisible = visual.elapsed >= LIFETIME_SECONDS * 0.05
      && visual.elapsed < RING_OWNER_LIFETIME_SECONDS;
    const ringFade = Math.sin(progress * Math.PI);
    for (let index = 0; index < visual.rings.length; index++) {
      const ring = visual.rings[index]!;
      ring.visible = ringsVisible;
      ring.rotation.z = Math.PI / 4 + visual.elapsed / 5 * Math.PI * 2 * (index === 0 ? 1 : -1);
      setIntensity(
        ring.material,
        index === 0 ? 0x333355 : 0x555555,
        ringFade,
        0x88 / 0xff,
      );
    }
  }

  private async loadResources(assets: ClassicAssetSource): Promise<Resources> {
    const model = await assets.loadModel(10);
    const modelTextureFile = model?.textures[0];
    if (!model || !modelTextureFile) throw new Error("Modelo clássico 10 incompleto");
    const geometry = parseMsa(model.buffer).geometry;
    let textures: THREE.Texture[] = [];
    try {
      const ringUrl = assets.effectTextureUrl(124);
      if (!ringUrl) throw new Error("Textura de efeito 124 ausente");
      textures = await Promise.all([
        this.loadTexture(assets.dataUrl(modelTextureFile)),
        this.loadTexture(ringUrl),
      ]);
      const [modelTexture, ringTexture] = textures;
      ringTexture!.offset.set(0.02, 0.02);
      ringTexture!.repeat.set(0.96, 0.96);
      ringTexture!.needsUpdate = true;
      return { geometry, modelTexture: modelTexture!, ringTexture: ringTexture! };
    } catch (error) {
      geometry.dispose();
      for (const texture of textures) texture.dispose();
      throw error;
    }
  }

  private async loadTexture(url: string): Promise<THREE.Texture> {
    const texture = await this.#dds.loadAsync(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  }
}

function createBrightMaterial(
  texture: THREE.Texture,
  color: number,
  opacity: number,
): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color,
    opacity,
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

function setMap(material: THREE.MeshBasicMaterial, texture: THREE.Texture): void {
  if (material.map === texture) return;
  material.map = texture;
  material.needsUpdate = true;
}

function setIntensity(
  material: THREE.MeshBasicMaterial,
  color: number,
  intensity: number,
  baseOpacity: number,
): void {
  const value = THREE.MathUtils.clamp(intensity, 0, 1);
  material.color.setHex(color).multiplyScalar(value);
  material.opacity = baseOpacity * value;
}

function deactivateVisual(visual: JudgementVisual): void {
  visual.active = false;
  visual.root.visible = false;
  visual.mesh.visible = false;
  for (const ring of visual.rings) ring.visible = false;
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
  resources.ringTexture.dispose();
}
