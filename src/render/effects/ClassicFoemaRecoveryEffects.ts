import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";

const CAST_POOL_LIMIT = 8;
const HEAL_PARTICLE_COUNT = 12;
const CURE_RANDOM_PARTICLE_COUNT = 16;
const CURE_WHITE_PARTICLE_COUNT = 5;
const MAX_PARTICLE_COUNT = CURE_RANDOM_PARTICLE_COUNT + CURE_WHITE_PARTICLE_COUNT;
const RANDOM_COLORS = [
  0xffffff,
  0xffaaaa,
  0xffffaa,
  0xaaffaa,
  0xaaaaff,
  0xaaffff,
  0xffaaff,
] as const;

interface Resources {
  readonly particle: THREE.Texture;
  readonly shade: THREE.Texture;
}

interface RecoveryVisual {
  readonly root: THREE.Group;
  readonly particles: readonly THREE.Sprite[];
  readonly starts: readonly THREE.Vector3[];
  readonly colors: number[];
  readonly shade: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  mode: "heal" | "cure";
  active: boolean;
  elapsed: number;
  serial: number;
}

/** Bounded port of Foema #25 TMSkillCure and #27/#29 TMSkillHeal type 0. */
export class ClassicFoemaRecoveryEffects {
  readonly object = new THREE.Group();
  readonly #owner: THREE.Object3D;
  readonly #dds = new ClassicDdsTextureLoader();
  readonly #plane = new THREE.PlaneGeometry(1, 1);
  readonly #fallback = createFallbackGlowTexture();
  readonly #visuals: RecoveryVisual[] = [];
  #resources: Resources | null = null;
  #preload: Promise<void> | null = null;
  #serial = 0;
  #randomState = 0;
  #enabled = true;
  #disposed = false;

  constructor(parent: THREE.Object3D) {
    this.#owner = parent;
    this.object.name = "classic-foema-recovery-effects";
    parent.add(this.object);
  }

  async prepareClassic(assets: ClassicAssetSource): Promise<void> {
    if (this.#disposed || this.#resources) return;
    if (this.#preload) return this.#preload;
    const job = Promise.all([
      this.loadTexture(assets, 56, true),
      this.loadTexture(assets, 7, false),
    ])
      .then(([particle, shade]) => {
        if (this.#disposed) {
          particle.dispose();
          shade.dispose();
          return;
        }
        this.#resources = { particle, shade };
        for (const visual of this.#visuals) this.applyAssets(visual);
      })
      .catch((error: unknown) => {
        console.warn("Recuperar clássico indisponível; usando fallback.", error);
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

  play(targetFeet: THREE.Vector3): void {
    this.playMode(targetFeet, "heal");
  }

  playCure(targetFeet: THREE.Vector3): void {
    this.playMode(targetFeet, "cure");
  }

  private playMode(targetFeet: THREE.Vector3, mode: "heal" | "cure"): void {
    if (this.#disposed || !this.#enabled || !isFiniteVector(targetFeet)) return;
    const visual = this.acquireVisual();
    visual.active = true;
    visual.elapsed = 0;
    visual.mode = mode;
    visual.serial = ++this.#serial;
    visual.root.position.copy(targetFeet);
    visual.root.visible = true;
    this.applyAssets(visual);
    const activeCount = mode === "heal" ? HEAL_PARTICLE_COUNT : MAX_PARTICLE_COUNT;
    for (let index = 0; index < visual.particles.length; index++) {
      const particle = visual.particles[index]!;
      particle.visible = false;
      if (index >= activeCount) continue;
      const start = visual.starts[index]!;
      start.set(
        (this.nextRandom(5) - 3) * 0.3,
        (this.nextRandom(5) - 3) * 0.1,
        // Retail +Z maps to the reflected Three scene -Z axis.
        -(this.nextRandom(5) - 3) * 0.3,
      );
      visual.colors[index] = mode === "heal"
        ? 0x77aaff
        : (
          index < CURE_RANDOM_PARTICLE_COUNT
            ? RANDOM_COLORS[this.nextRandom(RANDOM_COLORS.length)]!
            : 0xffffff
        );
    }
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
      for (const particle of visual.particles) particle.material.dispose();
      visual.shade.material.dispose();
    }
    this.#visuals.length = 0;
    this.#plane.dispose();
    this.#fallback.dispose();
    this.#resources?.particle.dispose();
    this.#resources?.shade.dispose();
    this.#resources = null;
  }

  private acquireVisual(): RecoveryVisual {
    const free = this.#visuals.find((visual) => !visual.active);
    if (free) return free;
    if (this.#visuals.length < CAST_POOL_LIMIT) {
      const index = this.#visuals.length;
      const root = new THREE.Group();
      root.name = `classic-foema-recovery-${index}`;
      const starts: THREE.Vector3[] = [];
      const particles = Array.from({ length: MAX_PARTICLE_COUNT }, (_, particleIndex) => {
        const sprite = createBrightSprite(
          this.#fallback,
          `classic-foema-recovery-particle-56-${index}-${particleIndex}`,
        );
        starts.push(new THREE.Vector3());
        root.add(sprite);
        return sprite;
      });
      const shade = new THREE.Mesh(
        this.#plane,
        createBrightMaterial(this.#fallback, 0x115588),
      );
      shade.name = `classic-foema-recovery-shade-7-${index}`;
      shade.rotation.x = -Math.PI / 2;
      shade.position.y = 0.005;
      shade.scale.set(8, 8, 1);
      shade.renderOrder = 5;
      root.add(shade);
      const visual: RecoveryVisual = {
        root,
        particles,
        starts,
        colors: Array.from({ length: MAX_PARTICLE_COUNT }, () => 0x77aaff),
        shade,
        mode: "heal",
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

  private applyAssets(visual: RecoveryVisual): void {
    for (const particle of visual.particles) {
      setMap(particle.material, this.#resources?.particle ?? this.#fallback);
    }
    setMap(visual.shade.material, this.#resources?.shade ?? this.#fallback);
  }

  private updateVisual(visual: RecoveryVisual): void {
    let anyParticle = false;
    const activeCount = visual.mode === "heal" ? HEAL_PARTICLE_COUNT : MAX_PARTICLE_COUNT;
    for (let index = 0; index < visual.particles.length; index++) {
      const particle = visual.particles[index]!;
      if (index >= activeCount) {
        particle.visible = false;
        continue;
      }
      const cureWhiteIndex = index - CURE_RANDOM_PARTICLE_COUNT;
      const sequenceIndex = visual.mode === "cure" && cureWhiteIndex >= 0
        ? cureWhiteIndex
        : index;
      const lifetime = 2 + sequenceIndex * 0.3;
      const progress = visual.elapsed / lifetime;
      if (progress >= 1) {
        particle.visible = false;
        continue;
      }
      anyParticle = true;
      const start = visual.starts[index]!;
      const horizontalDistance = visual.mode === "cure" && cureWhiteIndex >= 0
        ? 0.69
        : (index % 3) * 0.05 + 0.1;
      particle.position.copy(start);
      particle.position.y += progress * 2;
      if (visual.mode === "cure" && cureWhiteIndex >= 0) {
        particle.position.x += Math.sin(progress * Math.PI * 6) * horizontalDistance;
        particle.position.z += Math.cos(progress * Math.PI * 6) * horizontalDistance;
      } else if (index % 2 === 1) {
        particle.position.x += Math.sin(progress * Math.PI * 6) * horizontalDistance;
      }
      const scale = visual.mode === "cure" && cureWhiteIndex >= 0
        ? (cureWhiteIndex % 2) * 0.3 + 0.3
        : (index % 2) * 0.1 + 0.1;
      particle.scale.setScalar(scale);
      const intensity = Math.max(0, Math.sin(progress * Math.PI));
      particle.material.color.setHex(visual.colors[index]!).multiplyScalar(intensity);
      particle.material.opacity = 1;
      particle.visible = progress >= 0.05 && intensity > 0;
    }

    const shadeProgress = visual.elapsed / 3;
    visual.shade.visible = shadeProgress < 1;
    const shadeIntensity = Math.max(0, 1 - shadeProgress);
    visual.shade.material.color.setHex(0x115588).multiplyScalar(shadeIntensity);
    visual.shade.material.opacity = shadeIntensity;
    if (!anyParticle && shadeProgress >= 1) deactivateVisual(visual);
  }

  private nextRandom(modulus: number): number {
    this.#randomState = (Math.imul(this.#randomState, 1_103_515_245) + 12_345) >>> 0;
    return (this.#randomState >>> 16) % modulus;
  }

  private async loadTexture(
    assets: ClassicAssetSource,
    index: number,
    billboard: boolean,
  ): Promise<THREE.Texture> {
    const url = assets.effectTextureUrl(index);
    if (!url) throw new Error(`Textura de efeito ${index} ausente`);
    const texture = await this.#dds.loadAsync(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    if (billboard) {
      texture.offset.set(0.02, 0.98);
      texture.repeat.set(0.96, -0.96);
    } else {
      texture.offset.set(0.02, 0.02);
      texture.repeat.set(0.96, 0.96);
    }
    texture.needsUpdate = true;
    return texture;
  }
}

function createBrightSprite(texture: THREE.Texture, name: string): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: texture,
    color: 0x77aaff,
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

function setMap(
  material: THREE.MeshBasicMaterial | THREE.SpriteMaterial,
  texture: THREE.Texture,
): void {
  if (material.map === texture) return;
  material.map = texture;
  material.needsUpdate = true;
}

function deactivateVisual(visual: RecoveryVisual): void {
  visual.active = false;
  visual.root.visible = false;
  for (const particle of visual.particles) particle.visible = false;
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
