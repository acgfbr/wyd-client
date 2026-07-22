import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { parseMsa } from "../../formats/classic/Msa";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";

export type ClassicHuntressAttackBurstIndex = 72 | 80;

export interface HuntressPersistentBuffVisualState {
  readonly immunity: boolean;
  readonly soulLink: boolean;
  readonly mounted: boolean;
  readonly ownerYaw: number;
}

const ATTACK_LIFETIME_SECONDS = 0.8;
const ATTACK_BILLBOARD_LIFETIME_SECONDS = 0.7;
const ATTACK_POOL_LIMIT = 32;
const ENCHANT_ICE_POOL_LIMIT = 12;
const ENCHANT_ICE_LIFETIMES_SECONDS = [0.5, 0.7, 0.9, 1.1, 1.3] as const;
const ENCHANT_ICE_COLOR = 0x55aaff;
const IMMUNITY_CAST_POOL_LIMIT = 12;
const IMMUNITY_CAST_LIFETIMES_SECONDS = [1.3, 1.35, 1.4, 1.45, 1.5] as const;
const IMMUNITY_CAST_COLORS = [0x99bbff, 0x00ffaa, 0xffaa00, 0x880088, 0xcc8888] as const;
const IMMUNITY_ROTATION_SECONDS = 5;
const IMMUNITY_COLORS = [0x99bbff, 0x00ffaa] as const;
// D3D9's fixed-function output is materially dimmer than two additive layers
// composed in the current linear WebGL pipeline. Keep the retail colors and
// blend mode, but compensate only the state-owned persistent meshes.
const IMMUNITY_PERSISTENT_OPACITY = 0.18;
const SOUL_LINK_CAST_POOL_LIMIT = 12;
const SOUL_LINK_CAST_LIFETIMES_SECONDS = [0.8, 0.85, 0.9, 0.95, 1, 1.05] as const;
const SOUL_LINK_ROTATION_SECONDS = 2;
const SOUL_LINK_RADIUS = 1;
const SOUL_LINK_COLOR = 0x999999;
const SOUL_LINK_GLOW_COLOR = 0x55aaff;
const SOUL_LINK_MESH_OPACITY = 0.42;
const SOUL_LINK_GLOW_OPACITY = 0.3;
const SOUL_PARTICLE_COLOR = 0x6688aa;
const SOUL_PARTICLE_MAX_OPACITY = 0.24;
const SOUL_PARTICLE_LIFETIME_SECONDS = 0.8;
const SOUL_PARTICLE_INTERVAL_SECONDS = 1 / 60;
const SOUL_PARTICLE_POOL_LIMIT = 96;

interface AttackDefinition {
  readonly textureIndex: 56 | 60;
  readonly shadeSize: number;
  readonly shadeColor: number;
  readonly secondColor: number;
  readonly scaleVelocityPerSecond: number;
}

const ATTACK_DEFINITIONS: Readonly<Record<ClassicHuntressAttackBurstIndex, AttackDefinition>> = {
  // TMHuman.cpp:9161-9200. TMEffectBillBoard receives velocity in units/ms.
  72: {
    textureIndex: 56,
    shadeSize: 4,
    shadeColor: 0xffaa55,
    secondColor: 0xffaa55,
    scaleVelocityPerSecond: 1,
  },
  80: {
    textureIndex: 60,
    shadeSize: 6,
    shadeColor: 0xff0000,
    secondColor: 0xff0000,
    scaleVelocityPerSecond: 6,
  },
};

interface ClassicResources {
  readonly shadeTexture: THREE.Texture;
  readonly attackTextures: Readonly<Record<ClassicHuntressAttackBurstIndex, THREE.Texture>>;
  readonly particleTexture: THREE.Texture;
  readonly immunityTexture: THREE.Texture;
  readonly immunityGeometry: THREE.BufferGeometry;
  readonly soulLinkTexture: THREE.Texture;
  readonly soulLinkGeometry: THREE.BufferGeometry;
}

interface AttackVisual {
  readonly root: THREE.Group;
  readonly shade: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly billboards: readonly [THREE.Sprite, THREE.Sprite];
  active: boolean;
  elapsed: number;
  serial: number;
  classicIndex: ClassicHuntressAttackBurstIndex;
}

interface ImmunityVisual {
  readonly root: THREE.Group;
  readonly meshes: readonly [
    THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>,
    THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>,
  ];
  active: boolean;
  elapsed: number;
}

interface ImmunityCastVisual {
  readonly root: THREE.Group;
  readonly meshes: readonly THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
  active: boolean;
  elapsed: number;
  serial: number;
}

interface SoulLinkCastVisual {
  readonly root: THREE.Group;
  readonly billboards: readonly THREE.Sprite[];
  active: boolean;
  elapsed: number;
  serial: number;
}

interface SoulLinkOrbitVisual {
  readonly root: THREE.Group;
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly glow: THREE.Sprite;
}

interface SoulLinkVisual {
  readonly root: THREE.Group;
  readonly orbits: readonly [SoulLinkOrbitVisual, SoulLinkOrbitVisual];
  active: boolean;
  elapsed: number;
  particleAccumulator: number;
  ownerYaw: number;
}

interface SoulParticleVisual {
  readonly sprite: THREE.Sprite;
  active: boolean;
  elapsed: number;
  baseScale: number;
}

interface EnchantIceVisual {
  readonly root: THREE.Group;
  readonly billboards: readonly THREE.Sprite[];
  active: boolean;
  elapsed: number;
  serial: number;
}

/**
 * Exact local presentation for Huntress skills 72/75/76/80/81.
 *
 * `worldPosition` is the actor/target base position. The original client adds
 * +1.0 to attack billboards. Persistent buffs are anchored to the actor every
 * frame, matching TMHuman's m_pImmunity and m_pSoul ownership rules.
 * Gameplay timing, camera quake and sounds deliberately remain with the caller.
 */
export class ClassicHuntressSkillEffects {
  readonly object = new THREE.Group();
  readonly #dds = new ClassicDdsTextureLoader();
  readonly #attackPool: AttackVisual[] = [];
  readonly #enchantIcePool: EnchantIceVisual[] = [];
  readonly #immunityCastPool: ImmunityCastVisual[] = [];
  readonly #soulLinkCastPool: SoulLinkCastVisual[] = [];
  readonly #immunityVisual: ImmunityVisual;
  readonly #soulLinkVisual: SoulLinkVisual;
  readonly #soulParticlePool: SoulParticleVisual[] = [];
  readonly #planeGeometry = new THREE.PlaneGeometry(1, 1);
  readonly #fallbackImmunityGeometry = new THREE.IcosahedronGeometry(1, 2);
  readonly #fallbackSoulLinkGeometry = new THREE.TorusGeometry(0.32, 0.055, 6, 24, Math.PI * 1.45);
  readonly #fallbackGlow = createFallbackGlowTexture();
  readonly #owner: THREE.Object3D;
  #resources: ClassicResources | null = null;
  #preload: Promise<void> | null = null;
  #serial = 0;
  #particleSerial = 0;
  #enabled = true;
  #disposed = false;

  constructor(scene: THREE.Object3D) {
    this.#owner = scene;
    this.object.name = "classic-huntress-skill-effects";
    this.#immunityVisual = this.createImmunityVisual();
    this.#soulLinkVisual = this.createSoulLinkVisual();
    this.object.add(this.#immunityVisual.root, this.#soulLinkVisual.root);
    scene.add(this.object);
  }

  /** Loads the retail DDS/MSA assets once. Failure leaves the bounded fallback usable. */
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
        for (const visual of this.#attackPool) this.applyAttackAssets(visual);
        for (const visual of this.#enchantIcePool) this.applyEnchantIceAssets(visual);
        for (const visual of this.#immunityCastPool) this.applyImmunityCastAssets(visual);
        for (const visual of this.#soulLinkCastPool) this.applySoulLinkCastAssets(visual);
        this.applyImmunityAssets(this.#immunityVisual);
        this.applySoulLinkAssets(this.#soulLinkVisual);
        for (const particle of this.#soulParticlePool) this.applySoulParticleAsset(particle);
      })
      .catch((error: unknown) => {
        console.warn("Efeitos clássicos 72/75/76/80/81 indisponíveis; usando fallback.", error);
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

  update(deltaSeconds: number): void {
    if (this.#disposed || !this.#enabled) return;
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    if (delta === 0) return;

    for (const visual of this.#attackPool) {
      if (!visual.active) continue;
      visual.elapsed += delta;
      this.updateAttackVisual(visual);
    }
    for (const visual of this.#enchantIcePool) {
      if (!visual.active) continue;
      visual.elapsed += delta;
      this.updateEnchantIceVisual(visual);
    }
    for (const visual of this.#immunityCastPool) {
      if (!visual.active) continue;
      visual.elapsed += delta;
      this.updateImmunityCastVisual(visual);
    }
    for (const visual of this.#soulLinkCastPool) {
      if (!visual.active) continue;
      visual.elapsed += delta;
      this.updateSoulLinkCastVisual(visual);
    }
    if (this.#immunityVisual.active) {
      this.#immunityVisual.elapsed += delta;
      this.updateImmunityVisual(this.#immunityVisual);
    }
    if (this.#soulLinkVisual.active) {
      this.#soulLinkVisual.elapsed += delta;
      this.updateSoulLinkVisual(this.#soulLinkVisual, delta);
    }
    this.updateSoulParticles(delta);
  }

  playAttackBurst(classicIndex: ClassicHuntressAttackBurstIndex, worldPosition: THREE.Vector3): void {
    if (this.#disposed || !this.#enabled || !isFiniteVector(worldPosition)) return;
    if (classicIndex !== 72 && classicIndex !== 80) return;

    const visual = this.acquireAttackVisual();
    visual.active = true;
    visual.elapsed = 0;
    visual.serial = ++this.#serial;
    visual.classicIndex = classicIndex;
    visual.root.position.copy(worldPosition);
    visual.root.visible = true;
    this.applyAttackAssets(visual);
    this.updateAttackVisual(visual);
  }

  /** TMHuman.cpp:9223-9237 — the five short-lived sphere2 cast layers. */
  playImmunityCast(worldPosition: THREE.Vector3): void {
    if (this.#disposed || !this.#enabled || !isFiniteVector(worldPosition)) return;
    const visual = this.acquireImmunityCastVisual();
    visual.active = true;
    visual.elapsed = 0;
    visual.serial = ++this.#serial;
    visual.root.position.copy(worldPosition);
    visual.root.visible = true;
    this.applyImmunityCastAssets(visual);
    this.updateImmunityCastVisual(visual);
  }

  /** TMHuman.cpp:9276-9294 — the six texture-56 Soul Link cast layers. */
  playSoulLinkCast(worldPosition: THREE.Vector3): void {
    if (this.#disposed || !this.#enabled || !isFiniteVector(worldPosition)) return;
    const visual = this.acquireSoulLinkCastVisual();
    visual.active = true;
    visual.elapsed = 0;
    visual.serial = ++this.#serial;
    visual.root.position.copy(worldPosition);
    visual.root.visible = true;
    this.applySoulLinkCastAssets(visual);
    this.updateSoulLinkCastVisual(visual);
  }

  /** Keeps classic state-owned buff meshes attached until their affects end. */
  syncPersistentBuffs(
    worldPosition: THREE.Vector3 | null,
    state: HuntressPersistentBuffVisualState,
  ): void {
    if (this.#disposed) return;
    const canShow = this.#enabled && worldPosition !== null && isFiniteVector(worldPosition);

    if (!canShow || !state.immunity) {
      deactivateImmunity(this.#immunityVisual);
    } else {
      const visual = this.#immunityVisual;
      if (!visual.active) {
        visual.active = true;
        visual.elapsed = 0;
        visual.root.visible = true;
        this.applyImmunityAssets(visual);
      }
      visual.root.position.copy(worldPosition);
      const scale = state.mounted ? 1.5 : 1;
      const centerHeight = state.mounted ? 1.5 : 0.9;
      for (const mesh of visual.meshes) {
        mesh.position.y = centerHeight;
        mesh.scale.setScalar(scale);
      }
      this.updateImmunityVisual(visual);
    }

    if (!canShow || !state.soulLink) {
      deactivateSoulLink(this.#soulLinkVisual);
      this.clearSoulParticles();
    } else {
      const visual = this.#soulLinkVisual;
      if (!visual.active) {
        visual.active = true;
        visual.elapsed = 0;
        visual.particleAccumulator = SOUL_PARTICLE_INTERVAL_SECONDS;
        visual.root.visible = true;
        this.applySoulLinkAssets(visual);
      }
      visual.root.position.copy(worldPosition);
      visual.ownerYaw = Number.isFinite(state.ownerYaw) ? state.ownerYaw : 0;
      this.updateSoulLinkVisual(visual, 0);
    }
  }

  /**
   * Huntress #75, Encantar Gelo. `worldPosition` corresponds to the classic
   * client's vecStart; its five local height offsets are retained verbatim.
   */
  playEnchantIce(worldPosition: THREE.Vector3): void {
    if (this.#disposed || !this.#enabled || !isFiniteVector(worldPosition)) return;

    const visual = this.acquireEnchantIceVisual();
    visual.active = true;
    visual.elapsed = 0;
    visual.serial = ++this.#serial;
    visual.root.position.copy(worldPosition);
    visual.root.visible = true;
    this.applyEnchantIceAssets(visual);
    this.updateEnchantIceVisual(visual);
  }

  clear(): void {
    for (const visual of this.#attackPool) deactivateAttack(visual);
    for (const visual of this.#enchantIcePool) deactivateEnchantIce(visual);
    for (const visual of this.#immunityCastPool) deactivateImmunityCast(visual);
    for (const visual of this.#soulLinkCastPool) deactivateSoulLinkCast(visual);
    deactivateImmunity(this.#immunityVisual);
    deactivateSoulLink(this.#soulLinkVisual);
    this.clearSoulParticles();
  }

  /** Optional terminal cleanup for scene replacement. `clear()` keeps the pool reusable. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clear();
    this.object.removeFromParent();

    for (const visual of this.#attackPool) {
      visual.shade.material.dispose();
      for (const billboard of visual.billboards) billboard.material.dispose();
    }
    for (const visual of this.#enchantIcePool) {
      for (const billboard of visual.billboards) billboard.material.dispose();
    }
    for (const visual of this.#immunityCastPool) {
      for (const mesh of visual.meshes) mesh.material.dispose();
    }
    for (const visual of this.#soulLinkCastPool) {
      for (const billboard of visual.billboards) billboard.material.dispose();
    }
    for (const mesh of this.#immunityVisual.meshes) mesh.material.dispose();
    for (const orbit of this.#soulLinkVisual.orbits) {
      orbit.mesh.material.dispose();
      orbit.glow.material.dispose();
    }
    for (const particle of this.#soulParticlePool) particle.sprite.material.dispose();
    this.#attackPool.length = 0;
    this.#enchantIcePool.length = 0;
    this.#immunityCastPool.length = 0;
    this.#soulLinkCastPool.length = 0;
    this.#soulParticlePool.length = 0;
    this.#planeGeometry.dispose();
    this.#fallbackImmunityGeometry.dispose();
    this.#fallbackSoulLinkGeometry.dispose();
    this.#fallbackGlow.dispose();
    if (this.#resources) disposeClassicResources(this.#resources);
    this.#resources = null;
    this.#owner.remove(this.object);
  }

  private acquireAttackVisual(): AttackVisual {
    const free = this.#attackPool.find((visual) => !visual.active);
    if (free) return free;
    if (this.#attackPool.length < ATTACK_POOL_LIMIT) {
      const visual = this.createAttackVisual();
      this.#attackPool.push(visual);
      this.object.add(visual.root);
      return visual;
    }
    return oldestVisual(this.#attackPool);
  }

  private createAttackVisual(): AttackVisual {
    const root = new THREE.Group();
    root.name = `classic-huntress-attack-burst-${this.#attackPool.length}`;
    root.visible = false;

    const shadeMaterial = createBrightMaterial(this.#fallbackGlow, 0xffaa55);
    const shade = new THREE.Mesh(this.#planeGeometry, shadeMaterial);
    shade.name = "classic-skill-ground-shade-texture-7";
    shade.rotation.x = -Math.PI / 2;
    shade.position.y = 0.035;
    shade.renderOrder = 4;
    root.add(shade);

    const first = createBrightSprite(this.#fallbackGlow, 0xffffff, "classic-skill-billboard-primary");
    const second = createBrightSprite(this.#fallbackGlow, 0xffaa55, "classic-skill-billboard-secondary");
    first.position.y = 1;
    second.position.y = 1;
    root.add(first, second);

    return {
      root,
      shade,
      billboards: [first, second],
      active: false,
      elapsed: 0,
      serial: 0,
      classicIndex: 72,
    };
  }

  private applyAttackAssets(visual: AttackVisual): void {
    const definition = ATTACK_DEFINITIONS[visual.classicIndex];
    const attackTexture = this.#resources?.attackTextures[visual.classicIndex] ?? this.#fallbackGlow;
    const shadeTexture = this.#resources?.shadeTexture ?? this.#fallbackGlow;
    setMaterialMap(visual.shade.material, shadeTexture);
    visual.shade.material.color.setHex(definition.shadeColor);
    visual.shade.scale.set(definition.shadeSize, definition.shadeSize, 1);

    const [first, second] = visual.billboards;
    setMaterialMap(first.material, attackTexture);
    setMaterialMap(second.material, attackTexture);
    first.material.color.setHex(0xffffff);
    second.material.color.setHex(definition.secondColor);
  }

  private updateAttackVisual(visual: AttackVisual): void {
    if (visual.elapsed >= ATTACK_LIFETIME_SECONDS) {
      deactivateAttack(visual);
      return;
    }

    visual.shade.visible = true;
    const billboardVisible = visual.elapsed < ATTACK_BILLBOARD_LIFETIME_SECONDS;
    const progress = Math.min(1, visual.elapsed / ATTACK_BILLBOARD_LIFETIME_SECONDS);
    const opacity = Math.max(0, Math.sin(progress * Math.PI));
    const definition = ATTACK_DEFINITIONS[visual.classicIndex];
    const growth = visual.elapsed * definition.scaleVelocityPerSecond;
    const [first, second] = visual.billboards;
    first.visible = billboardVisible;
    second.visible = billboardVisible;
    first.material.opacity = opacity;
    second.material.opacity = opacity;
    first.scale.setScalar(1 + growth);
    second.scale.setScalar(1.2 + growth);
  }

  private acquireEnchantIceVisual(): EnchantIceVisual {
    const free = this.#enchantIcePool.find((visual) => !visual.active);
    if (free) return free;
    if (this.#enchantIcePool.length < ENCHANT_ICE_POOL_LIMIT) {
      const visual = this.createEnchantIceVisual();
      this.#enchantIcePool.push(visual);
      this.object.add(visual.root);
      return visual;
    }
    return oldestVisual(this.#enchantIcePool);
  }

  private createEnchantIceVisual(): EnchantIceVisual {
    const root = new THREE.Group();
    root.name = `classic-huntress-enchant-ice-${this.#enchantIcePool.length}`;
    root.visible = false;

    const billboards = ENCHANT_ICE_LIFETIMES_SECONDS.map((_, index) => {
      const billboard = createBrightSprite(
        this.#fallbackGlow,
        ENCHANT_ICE_COLOR,
        `classic-enchant-ice-texture-56-layer-${index}`,
      );
      const scaleXAndZ = index * 0.7 + 1;
      const scaleY = index * 0.5 + 1;
      billboard.position.y = index * 0.3 - 0.5;
      billboard.scale.set(scaleXAndZ, scaleY, scaleXAndZ);
      root.add(billboard);
      return billboard;
    });

    return { root, billboards, active: false, elapsed: 0, serial: 0 };
  }

  private applyEnchantIceAssets(visual: EnchantIceVisual): void {
    // Encantar Gelo reuses retail effect texture 56, the same flare as #72.
    const texture = this.#resources?.attackTextures[72] ?? this.#fallbackGlow;
    for (const billboard of visual.billboards) {
      setMaterialMap(billboard.material, texture);
      billboard.material.color.setHex(ENCHANT_ICE_COLOR);
    }
  }

  private updateEnchantIceVisual(visual: EnchantIceVisual): void {
    for (let index = 0; index < visual.billboards.length; index++) {
      const billboard = visual.billboards[index]!;
      const lifetime = ENCHANT_ICE_LIFETIMES_SECONDS[index]!;
      const visible = visual.elapsed < lifetime;
      const progress = Math.min(1, visual.elapsed / lifetime);
      billboard.visible = visible;
      // TMEffectBillBoard m_nFade = 1 multiplies ARGB by sin(progress * PI).
      billboard.material.opacity = visible ? Math.max(0, Math.sin(progress * Math.PI)) : 0;
    }
    if (visual.elapsed >= ENCHANT_ICE_LIFETIMES_SECONDS.at(-1)!) deactivateEnchantIce(visual);
  }

  private acquireImmunityCastVisual(): ImmunityCastVisual {
    const free = this.#immunityCastPool.find((visual) => !visual.active);
    if (free) return free;
    if (this.#immunityCastPool.length < IMMUNITY_CAST_POOL_LIMIT) {
      const visual = this.createImmunityCastVisual();
      this.#immunityCastPool.push(visual);
      this.object.add(visual.root);
      return visual;
    }
    return oldestVisual(this.#immunityCastPool);
  }

  private createImmunityCastVisual(): ImmunityCastVisual {
    const root = new THREE.Group();
    root.name = `classic-huntress-immunity-cast-${this.#immunityCastPool.length}`;
    root.visible = false;
    const meshes = IMMUNITY_CAST_COLORS.map((color, index) => {
      const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>(
        this.#fallbackImmunityGeometry,
        createBrightMaterial(this.#fallbackGlow, color),
      );
      mesh.name = `classic-immunity-cast-effect-mesh-12-layer-${index}`;
      mesh.position.y = 1.1;
      mesh.rotation.x = Math.PI / 2;
      mesh.renderOrder = 5 + index;
      root.add(mesh);
      return mesh;
    });
    return { root, meshes, active: false, elapsed: 0, serial: 0 };
  }

  private applyImmunityCastAssets(visual: ImmunityCastVisual): void {
    const geometry = this.#resources?.immunityGeometry ?? this.#fallbackImmunityGeometry;
    const texture = this.#resources?.immunityTexture ?? this.#fallbackGlow;
    for (const mesh of visual.meshes) {
      mesh.geometry = geometry;
      setMaterialMap(mesh.material, texture);
    }
  }

  private updateImmunityCastVisual(visual: ImmunityCastVisual): void {
    for (let index = 0; index < visual.meshes.length; index++) {
      visual.meshes[index]!.visible = visual.elapsed < IMMUNITY_CAST_LIFETIMES_SECONDS[index]!;
    }
    if (visual.elapsed >= IMMUNITY_CAST_LIFETIMES_SECONDS.at(-1)!) deactivateImmunityCast(visual);
  }

  private acquireSoulLinkCastVisual(): SoulLinkCastVisual {
    const free = this.#soulLinkCastPool.find((visual) => !visual.active);
    if (free) return free;
    if (this.#soulLinkCastPool.length < SOUL_LINK_CAST_POOL_LIMIT) {
      const visual = this.createSoulLinkCastVisual();
      this.#soulLinkCastPool.push(visual);
      this.object.add(visual.root);
      return visual;
    }
    return oldestVisual(this.#soulLinkCastPool);
  }

  private createSoulLinkCastVisual(): SoulLinkCastVisual {
    const root = new THREE.Group();
    root.name = `classic-huntress-soul-link-cast-${this.#soulLinkCastPool.length}`;
    root.visible = false;
    const billboards = SOUL_LINK_CAST_LIFETIMES_SECONDS.map((_, index) => {
      const billboard = createBrightSprite(
        this.#fallbackGlow,
        0xffffff,
        `classic-soul-link-cast-texture-56-layer-${index}`,
      );
      billboard.position.y = 0.2;
      billboard.scale.set(2, index * 0.2 + 1, 1);
      root.add(billboard);
      return billboard;
    });
    return { root, billboards, active: false, elapsed: 0, serial: 0 };
  }

  private applySoulLinkCastAssets(visual: SoulLinkCastVisual): void {
    const texture = this.#resources?.attackTextures[72] ?? this.#fallbackGlow;
    for (const billboard of visual.billboards) {
      setMaterialMap(billboard.material, texture);
      billboard.material.color.setHex(0xffffff);
    }
  }

  private updateSoulLinkCastVisual(visual: SoulLinkCastVisual): void {
    for (let index = 0; index < visual.billboards.length; index++) {
      const billboard = visual.billboards[index]!;
      const lifetime = SOUL_LINK_CAST_LIFETIMES_SECONDS[index]!;
      const visible = visual.elapsed < lifetime;
      const progress = Math.min(1, visual.elapsed / lifetime);
      billboard.visible = visible;
      billboard.material.opacity = visible ? Math.max(0, Math.sin(progress * Math.PI)) : 0;
    }
    if (visual.elapsed >= SOUL_LINK_CAST_LIFETIMES_SECONDS.at(-1)!) deactivateSoulLinkCast(visual);
  }

  private createImmunityVisual(): ImmunityVisual {
    const root = new THREE.Group();
    root.name = "classic-huntress-immunity-persistent";
    root.visible = false;
    const createMesh = (color: number, index: number) => {
      const material = createBrightMaterial(this.#fallbackGlow, color);
      configurePersistentMaterial(material, IMMUNITY_PERSISTENT_OPACITY);
      const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>(
        this.#fallbackImmunityGeometry,
        material,
      );
      mesh.name = `classic-immunity-effect-mesh-12-layer-${index}`;
      mesh.position.y = 1.1;
      // TMMesh's converted base pitch. Effect mesh 12 is rotationally symmetric,
      // but retaining it also keeps a future exact mesh replacement aligned.
      mesh.rotation.x = Math.PI / 2;
      mesh.renderOrder = 5 + index;
      root.add(mesh);
      return mesh;
    };
    const meshes = [
      createMesh(IMMUNITY_COLORS[0], 0),
      createMesh(IMMUNITY_COLORS[1], 1),
    ] as const;
    return { root, meshes, active: false, elapsed: 0 };
  }

  private applyImmunityAssets(visual: ImmunityVisual): void {
    const geometry = this.#resources?.immunityGeometry ?? this.#fallbackImmunityGeometry;
    const texture = this.#resources?.immunityTexture ?? this.#fallbackGlow;
    for (const mesh of visual.meshes) {
      mesh.geometry = geometry;
      setMaterialMap(mesh.material, texture);
    }
  }

  private updateImmunityVisual(visual: ImmunityVisual): void {
    if (!visual.active) return;
    const progress = (visual.elapsed % IMMUNITY_ROTATION_SECONDS) / IMMUNITY_ROTATION_SECONDS;
    const firstAngle = progress * Math.PI * 2;
    const secondAngle = ((progress + 0.2) % 1) * Math.PI * 2;
    const [first, second] = visual.meshes;
    first.visible = true;
    second.visible = true;
    // TMMesh::Render uses yaw, pitch - 90° and roll. parseMsa's handedness
    // conversion turns the fixed -90° pitch into the +90° X base below.
    first.rotation.set(Math.PI / 2, firstAngle, 0);
    second.rotation.set(Math.PI / 2 + secondAngle, 0, 0);
  }

  private createSoulLinkVisual(): SoulLinkVisual {
    const root = new THREE.Group();
    root.name = "classic-huntress-soul-link-persistent";
    root.visible = false;
    const createOrbit = (index: number): SoulLinkOrbitVisual => {
      const orbitRoot = new THREE.Group();
      orbitRoot.name = `classic-soul-link-orbit-${index}`;
      const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>(
        this.#fallbackSoulLinkGeometry,
        createBrightMaterial(this.#fallbackGlow, SOUL_LINK_COLOR),
      );
      configurePersistentMaterial(mesh.material, SOUL_LINK_MESH_OPACITY);
      mesh.name = `classic-soul-link-effect-mesh-2839-${index}`;
      mesh.scale.setScalar(1.4);
      mesh.renderOrder = 7;
      const glow = createBrightSprite(
        this.#fallbackGlow,
        SOUL_LINK_GLOW_COLOR,
        `classic-soul-link-billboard-56-${index}`,
      );
      glow.material.opacity = SOUL_LINK_GLOW_OPACITY;
      glow.scale.setScalar(1.5);
      glow.renderOrder = 8;
      orbitRoot.add(mesh, glow);
      root.add(orbitRoot);
      return { root: orbitRoot, mesh, glow };
    };
    return {
      root,
      orbits: [createOrbit(0), createOrbit(1)],
      active: false,
      elapsed: 0,
      particleAccumulator: 0,
      ownerYaw: 0,
    };
  }

  private applySoulLinkAssets(visual: SoulLinkVisual): void {
    const geometry = this.#resources?.soulLinkGeometry ?? this.#fallbackSoulLinkGeometry;
    const texture = this.#resources?.soulLinkTexture ?? this.#fallbackGlow;
    const glowTexture = this.#resources?.attackTextures[72] ?? this.#fallbackGlow;
    for (const orbit of visual.orbits) {
      orbit.mesh.geometry = geometry;
      setMaterialMap(orbit.mesh.material, texture);
      setMaterialMap(orbit.glow.material, glowTexture);
    }
  }

  private updateSoulLinkVisual(visual: SoulLinkVisual, deltaSeconds: number): void {
    if (!visual.active) return;
    const baseAngle = -(visual.elapsed % SOUL_LINK_ROTATION_SECONDS)
      / SOUL_LINK_ROTATION_SECONDS * Math.PI * 2;
    for (let index = 0; index < visual.orbits.length; index++) {
      const orbit = visual.orbits[index]!;
      const angle = baseAngle + index * Math.PI;
      orbit.root.position.set(
        Math.cos(angle) * SOUL_LINK_RADIUS,
        1,
        Math.sin(angle) * SOUL_LINK_RADIUS,
      );
      orbit.mesh.rotation.set(Math.PI / 2, visual.ownerYaw, Math.PI / 2);
      orbit.mesh.visible = true;
      orbit.glow.visible = true;
    }

    visual.particleAccumulator += deltaSeconds;
    while (visual.particleAccumulator >= SOUL_PARTICLE_INTERVAL_SECONDS) {
      visual.particleAccumulator -= SOUL_PARTICLE_INTERVAL_SECONDS;
      for (const orbit of visual.orbits) this.spawnSoulParticle(visual, orbit.root.position);
    }
  }

  private spawnSoulParticle(visual: SoulLinkVisual, localPosition: THREE.Vector3): void {
    const particle = this.acquireSoulParticle();
    const randomStep = ((Math.imul(++this.#particleSerial, 1_103_515_245) >>> 16) % 5);
    particle.active = true;
    particle.elapsed = 0;
    particle.baseScale = randomStep * 0.05 + 0.02;
    particle.sprite.position.copy(visual.root.position).add(localPosition);
    particle.sprite.scale.set(
      particle.baseScale,
      randomStep * 0.1 + 0.02,
      1,
    );
    particle.sprite.material.opacity = SOUL_PARTICLE_MAX_OPACITY;
    particle.sprite.visible = true;
    this.applySoulParticleAsset(particle);
  }

  private acquireSoulParticle(): SoulParticleVisual {
    const free = this.#soulParticlePool.find((particle) => !particle.active);
    if (free) return free;
    if (this.#soulParticlePool.length < SOUL_PARTICLE_POOL_LIMIT) {
      const sprite = createBrightSprite(
        this.#fallbackGlow,
        SOUL_PARTICLE_COLOR,
        `classic-soul-link-particle-${this.#soulParticlePool.length}`,
      );
      const particle = { sprite, active: false, elapsed: 0, baseScale: 0.02 };
      this.#soulParticlePool.push(particle);
      this.object.add(sprite);
      return particle;
    }
    let oldest = this.#soulParticlePool[0]!;
    for (const particle of this.#soulParticlePool) {
      if (particle.elapsed > oldest.elapsed) oldest = particle;
    }
    return oldest;
  }

  private applySoulParticleAsset(particle: SoulParticleVisual): void {
    setMaterialMap(particle.sprite.material, this.#resources?.particleTexture ?? this.#fallbackGlow);
    particle.sprite.material.color.setHex(SOUL_PARTICLE_COLOR);
  }

  private updateSoulParticles(deltaSeconds: number): void {
    for (const particle of this.#soulParticlePool) {
      if (!particle.active) continue;
      particle.elapsed += deltaSeconds;
      if (particle.elapsed >= SOUL_PARTICLE_LIFETIME_SECONDS) {
        deactivateSoulParticle(particle);
        continue;
      }
      const progress = particle.elapsed / SOUL_PARTICLE_LIFETIME_SECONDS;
      const growth = particle.elapsed * 0.5;
      particle.sprite.scale.x = particle.baseScale + growth;
      particle.sprite.scale.y += deltaSeconds * 0.5;
      particle.sprite.material.opacity = SOUL_PARTICLE_MAX_OPACITY * (1 - progress);
    }
  }

  private clearSoulParticles(): void {
    for (const particle of this.#soulParticlePool) deactivateSoulParticle(particle);
  }

  private async loadClassicResources(assets: ClassicAssetSource): Promise<ClassicResources> {
    const textureIndices = [7, 56, 60, 0] as const;
    const textureResults = await Promise.allSettled(
      textureIndices.map((index) => this.loadTexture(assets, index)),
    );
    const textures = textureResults
      .filter((result): result is PromiseFulfilledResult<THREE.Texture> => result.status === "fulfilled")
      .map((result) => result.value);
    const failure = textureResults.find((result) => result.status === "rejected") as PromiseRejectedResult | undefined;
    if (failure || textures.length !== textureIndices.length) {
      for (const texture of textures) texture.dispose();
      throw failure?.reason ?? new Error("Texturas de efeito 7/56/60/0 ausentes");
    }

    let immunitySource: Awaited<ReturnType<ClassicAssetSource["loadModel"]>>;
    let soulLinkSource: Awaited<ReturnType<ClassicAssetSource["loadModel"]>>;
    try {
      [immunitySource, soulLinkSource] = await Promise.all([
        assets.loadModel(12),
        assets.loadModel(2839),
      ]);
    } catch (error) {
      for (const texture of textures) texture.dispose();
      throw error;
    }
    const immunityTextureFile = immunitySource?.textures[0] ?? null;
    const soulLinkTextureFile = soulLinkSource?.textures[0] ?? null;
    if (!immunitySource || !soulLinkSource || !immunityTextureFile || !soulLinkTextureFile) {
      for (const texture of textures) texture.dispose();
      throw new Error("Modelos clássicos 12/sphere2 e 2839/unsole ausentes do manifesto");
    }

    const modelTextureResults = await Promise.allSettled([
      this.loadDataTexture(assets, immunityTextureFile),
      this.loadDataTexture(assets, soulLinkTextureFile),
    ]);
    const modelTextures = modelTextureResults
      .filter((result): result is PromiseFulfilledResult<THREE.Texture> => result.status === "fulfilled")
      .map((result) => result.value);
    const modelTextureFailure = modelTextureResults.find(
      (result) => result.status === "rejected",
    ) as PromiseRejectedResult | undefined;
    if (modelTextureFailure || modelTextures.length !== 2) {
      for (const texture of [...textures, ...modelTextures]) texture.dispose();
      throw modelTextureFailure?.reason ?? new Error("Texturas sphere2/unsole ausentes");
    }

    let immunityGeometry: THREE.BufferGeometry;
    let soulLinkGeometry: THREE.BufferGeometry;
    try {
      immunityGeometry = parseMsa(immunitySource.buffer).geometry;
      soulLinkGeometry = parseMsa(soulLinkSource.buffer).geometry;
    } catch (error) {
      for (const texture of [...textures, ...modelTextures]) texture.dispose();
      throw error;
    }

    const [shadeTexture, fatalTexture, felineTexture, particleTexture] = textures;
    const [immunityTexture, soulLinkTexture] = modelTextures;
    configureClassicBillboardUvs(fatalTexture!);
    configureClassicBillboardUvs(felineTexture!);
    configureClassicBillboardUvs(particleTexture!);
    return {
      shadeTexture: shadeTexture!,
      attackTextures: { 72: fatalTexture!, 80: felineTexture! },
      particleTexture: particleTexture!,
      immunityTexture: immunityTexture!,
      immunityGeometry,
      soulLinkTexture: soulLinkTexture!,
      soulLinkGeometry,
    };
  }

  private async loadTexture(assets: ClassicAssetSource, index: number): Promise<THREE.Texture> {
    const url = assets.effectTextureUrl(index);
    if (!url) throw new Error(`Textura de efeito ${index} ausente`);
    return this.loadTextureUrl(url);
  }

  private loadDataTexture(assets: ClassicAssetSource, file: string): Promise<THREE.Texture> {
    return this.loadTextureUrl(assets.dataUrl(file));
  }

  private async loadTextureUrl(url: string): Promise<THREE.Texture> {
    const texture = await this.#dds.loadAsync(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  }
}

function createBrightMaterial(texture: THREE.Texture, color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
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
}

function configurePersistentMaterial(material: THREE.MeshBasicMaterial, opacity: number): void {
  material.opacity = THREE.MathUtils.clamp(opacity, 0, 1);
  // Avoid Three.js's extra transparent DoubleSide pass; classic D3D9 draws
  // the uncullled mesh once, and duplicating it compounds additive saturation.
  material.forceSinglePass = true;
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
  sprite.renderOrder = 6;
  return sprite;
}

function setMaterialMap(material: THREE.MeshBasicMaterial | THREE.SpriteMaterial, texture: THREE.Texture): void {
  if (material.map === texture) return;
  material.map = texture;
  material.needsUpdate = true;
}

function deactivateAttack(visual: AttackVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.root.visible = false;
  visual.shade.visible = false;
  for (const billboard of visual.billboards) {
    billboard.visible = false;
    billboard.material.opacity = 0;
  }
}

function deactivateEnchantIce(visual: EnchantIceVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.root.visible = false;
  for (const billboard of visual.billboards) {
    billboard.visible = false;
    billboard.material.opacity = 0;
  }
}

function deactivateImmunityCast(visual: ImmunityCastVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.root.visible = false;
  for (const mesh of visual.meshes) mesh.visible = false;
}

function deactivateSoulLinkCast(visual: SoulLinkCastVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.root.visible = false;
  for (const billboard of visual.billboards) {
    billboard.visible = false;
    billboard.material.opacity = 0;
  }
}

function deactivateImmunity(visual: ImmunityVisual): void {
  if (!visual.active && !visual.root.visible) return;
  visual.active = false;
  visual.elapsed = 0;
  visual.root.visible = false;
  for (const mesh of visual.meshes) mesh.visible = false;
}

function deactivateSoulLink(visual: SoulLinkVisual): void {
  if (!visual.active && !visual.root.visible) return;
  visual.active = false;
  visual.elapsed = 0;
  visual.particleAccumulator = 0;
  visual.root.visible = false;
  for (const orbit of visual.orbits) {
    orbit.mesh.visible = false;
    orbit.glow.visible = false;
  }
}

function deactivateSoulParticle(particle: SoulParticleVisual): void {
  particle.active = false;
  particle.elapsed = 0;
  particle.sprite.visible = false;
  particle.sprite.material.opacity = 0;
}

function oldestVisual<T extends { serial: number }>(visuals: readonly T[]): T {
  let oldest = visuals[0]!;
  for (const visual of visuals) {
    if (visual.serial < oldest.serial) oldest = visual;
  }
  return oldest;
}

function configureClassicBillboardUvs(texture: THREE.Texture): void {
  // DDSLoader keeps top-left DDS orientation; TMEffectBillBoard samples with
  // the opposite V direction and a .02 inset to avoid compressed-edge bleed.
  texture.offset.set(0.02, 0.98);
  texture.repeat.set(0.96, -0.96);
  texture.needsUpdate = true;
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
  texture.name = "classic-huntress-effect-fallback";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function disposeClassicResources(resources: ClassicResources): void {
  resources.shadeTexture.dispose();
  resources.attackTextures[72].dispose();
  resources.attackTextures[80].dispose();
  resources.particleTexture.dispose();
  resources.immunityTexture.dispose();
  resources.immunityGeometry.dispose();
  resources.soulLinkTexture.dispose();
  resources.soulLinkGeometry.dispose();
}

function isFiniteVector(position: THREE.Vector3): boolean {
  return Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
}
