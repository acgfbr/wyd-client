import * as THREE from "three";
import { DDSLoader } from "three/addons/loaders/DDSLoader.js";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import {
  ClassicSkinnedAssetLibrary,
  type ClassicSkinnedInstanceLease,
} from "../npcs/ClassicSkinnedAssetLibrary";
import { MonsterCatalog, type MonsterVisualFamily } from "../npcs/MonsterCatalog";

const GRIUPAN_ITEM_INDEX = 1726;
const GRIUPAN_SKIN = 32;
const GRIUPAN_EFFECT_LEVEL = 5;
const GRIUPAN_ROOT = "player/familiars/ag01";
const OWNER_CLASSIC_SCALE = 0.9;

// TMEffectSkinMesh::FrameMove motion type 5.
const FOLLOW_DISTANCE = 0.3;
const FOLLOW_ORBIT_RADIUS = 0.1;
const FOLLOW_ORBIT_PERIOD_SECONDS = 1;
const FOLLOW_HEIGHT = 2 * OWNER_CLASSIC_SCALE;
const FOLLOW_BOB_HEIGHT = 0.05;

// Level 5's exact TMEffectBillBoard parameters: effect texture 2, 2500 ms,
// scale 0.03 * 2, EF_BRIGHT, particle type 1 and vertical velocity -1.5.
const PARTICLE_TEXTURE_INDEX = 2;
const PARTICLE_LIFETIME_SECONDS = 2.5;
const PARTICLE_SCALE = 0.06;
const PARTICLE_VERTICAL_DISTANCE = -1.5;
const PARTICLE_COLOR = 0xeeeeff;
const PARTICLE_INTERVAL_SECONDS = 1 / 60;
const PARTICLE_POOL_LIMIT = 160;

const GRIUPAN_FAMILY: MonsterVisualFamily = {
  base: "ag01",
  declaredParts: 1,
  meshParts: [1],
  skeleton: `${GRIUPAN_ROOT}/ag01.bon`,
  clips: [`${GRIUPAN_ROOT}/ag010101.ani`],
  actionSet: "angel",
  // AniSound4's [angel] actions all select clip 0. Motion type 5 overrides
  // m_dwFPS to 10 for effect levels 4/5/6, hence the 10 ms quarter-step.
  actions: { RUN: [0, 10, 0] },
};

interface FamiliarParticle {
  readonly sprite: THREE.Sprite;
  readonly material: THREE.SpriteMaterial;
  readonly worldStart: THREE.Vector3;
  active: boolean;
  elapsed: number;
}

/**
 * Equip[13] item 1726, rendered separately from Equip[14] mounts.
 *
 * TMHuman.cpp creates `TMEffectSkinMesh(32, ..., 5, owner)`, sets Mesh0 and
 * Mesh1 to 2, scale 1 and motion type 5. The old TMSkinMesh formula resolves
 * that one-part look to ag010103.msh/ag010103.wys.
 */
export class ClassicFamiliar {
  readonly object = new THREE.Group();
  readonly name = "Griupan";
  readonly itemIndex = GRIUPAN_ITEM_INDEX;
  readonly #lease: ClassicSkinnedInstanceLease;
  readonly #modelAnchor = new THREE.Group();
  readonly #particleRoot = new THREE.Group();
  readonly #particleTexture: THREE.Texture | null;
  readonly #particles: FamiliarParticle[] = [];
  readonly #inverseWorld = new THREE.Matrix4();
  readonly #scratchWorld = new THREE.Vector3();
  #phase = 0;
  #particleAccumulator = 0;
  #randomState = 0x6c8e9cf5;
  #effectsEnabled = true;
  #released = false;

  private constructor(
    lease: ClassicSkinnedInstanceLease,
    particleTexture: THREE.Texture | null,
    ownerStartX: number,
  ) {
    this.#lease = lease;
    this.#particleTexture = particleTexture;
    this.#phase = ((((ownerStartX * 100) % 1_000) + 1_000) % 1_000) / 1_000 * Math.PI * 2;

    this.object.name = "classic-familiar-griupan";
    this.object.userData.itemIndex = GRIUPAN_ITEM_INDEX;
    this.object.userData.skin = GRIUPAN_SKIN;
    this.object.userData.lookMesh0 = 2;
    this.object.userData.lookSkin0 = 0;
    this.object.userData.effectLevel = GRIUPAN_EFFECT_LEVEL;
    this.object.userData.motionType = 5;

    this.#modelAnchor.name = "griupan-motion-type-5-anchor";
    this.#particleRoot.name = "griupan-level-5-particles";
    this.object.add(this.#modelAnchor, this.#particleRoot);
    this.#modelAnchor.add(lease.model.object);

    lease.model.setClassicTransform({
      yaw: -Math.PI / 2,
      scale: 1,
      mirrorModelZ: true,
    });
    lease.model.play("RUN");
    this.updateMotion(-Math.PI / 2);
  }

  static async load(
    assets: ClassicAssetSource,
    ownerStartX: number,
  ): Promise<ClassicFamiliar | null> {
    const textureJob = loadParticleTexture(assets);
    const catalog = await MonsterCatalog.load(assets);
    const library = new ClassicSkinnedAssetLibrary(assets, catalog);
    const lease = await library.createInstance({
      skin: GRIUPAN_SKIN,
      family: GRIUPAN_FAMILY,
      parts: [{
        name: "griupan-ag010103",
        mesh: `${GRIUPAN_ROOT}/ag010103.msh`,
        texture: `${GRIUPAN_ROOT}/ag010103.dds`,
        alpha: "N",
      }],
      actions: ["RUN"],
      initialAction: "RUN",
    });
    const particleTexture = await textureJob;
    if (!lease) {
      particleTexture?.dispose();
      return null;
    }
    return new ClassicFamiliar(lease, particleTexture, ownerStartX);
  }

  setEffectsEnabled(enabled: boolean): void {
    if (this.#released) return;
    this.#effectsEnabled = enabled;
    // g_bHideEffect suppresses the spawned billboards, not the level-5 skin.
    this.#particleRoot.visible = enabled;
  }

  update(deltaSeconds: number, ownerClassicYaw: number): void {
    if (this.#released) return;
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(deltaSeconds, 0.1)) : 0;
    this.#phase = (this.#phase + delta * Math.PI * 2 / FOLLOW_ORBIT_PERIOD_SECONDS) % (Math.PI * 2);
    this.updateMotion(ownerClassicYaw);
    this.#lease.model.update(delta);
    this.updateParticles(delta);

    if (!this.#effectsEnabled || !this.#particleTexture || delta <= 0) return;
    this.#particleAccumulator += delta;
    if (this.#particleAccumulator < PARTICLE_INTERVAL_SECONDS) return;
    // The original emits once per FrameMove. Do not generate a large catch-up
    // burst after a suspended/background frame.
    this.#particleAccumulator %= PARTICLE_INTERVAL_SECONDS;
    this.spawnParticle();
  }

  release(): void {
    if (this.#released) return;
    this.#released = true;
    this.#lease.release();
    for (const particle of this.#particles) particle.material.dispose();
    this.#particleTexture?.dispose();
    this.#particles.length = 0;
    this.object.removeFromParent();
    this.object.clear();
  }

  private updateMotion(ownerClassicYaw: number): void {
    const behindAngle = ownerClassicYaw - Math.PI;
    const classicOffsetX = Math.cos(behindAngle) * FOLLOW_DISTANCE
      + Math.cos(this.#phase) * FOLLOW_ORBIT_RADIUS;
    const classicOffsetY = Math.sin(behindAngle) * FOLLOW_DISTANCE
      + Math.sin(this.#phase) * FOLLOW_ORBIT_RADIUS;
    this.#modelAnchor.position.set(
      classicOffsetX,
      FOLLOW_HEIGHT + Math.sin(this.#phase) * FOLLOW_BOB_HEIGHT,
      -classicOffsetY,
    );
    this.#lease.model.setClassicTransform({ yaw: ownerClassicYaw });
  }

  private spawnParticle(): void {
    let particle = this.#particles.find((entry) => !entry.active);
    if (!particle && this.#particles.length < PARTICLE_POOL_LIMIT) {
      particle = this.createParticle();
      this.#particles.push(particle);
      this.#particleRoot.add(particle.sprite);
    }
    if (!particle) {
      particle = this.#particles.reduce((oldest, entry) => (
        entry.elapsed > oldest.elapsed ? entry : oldest
      ));
    }

    this.object.updateWorldMatrix(true, true);
    this.#modelAnchor.getWorldPosition(particle.worldStart);
    particle.worldStart.x += (this.nextRandomInt(10) - 5) * 0.02;
    particle.worldStart.z += (this.nextRandomInt(10) - 5) * 0.02;
    particle.active = true;
    particle.elapsed = 0;
    particle.sprite.visible = false;
    particle.material.opacity = 0;
  }

  private createParticle(): FamiliarParticle {
    const material = new THREE.SpriteMaterial({
      map: this.#particleTexture,
      color: PARTICLE_COLOR,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.name = `griupan-particle-${this.#particles.length}`;
    sprite.scale.set(PARTICLE_SCALE, PARTICLE_SCALE, 1);
    sprite.visible = false;
    sprite.renderOrder = 8;
    return {
      sprite,
      material,
      worldStart: new THREE.Vector3(),
      active: false,
      elapsed: 0,
    };
  }

  private updateParticles(deltaSeconds: number): void {
    if (this.#particles.length === 0) return;
    this.object.updateWorldMatrix(true, false);
    this.#inverseWorld.copy(this.object.matrixWorld).invert();

    for (const particle of this.#particles) {
      if (!particle.active) continue;
      particle.elapsed += deltaSeconds;
      const progress = particle.elapsed / PARTICLE_LIFETIME_SECONDS;
      if (progress >= 1) {
        particle.active = false;
        particle.sprite.visible = false;
        particle.material.opacity = 0;
        continue;
      }

      this.#scratchWorld.copy(particle.worldStart);
      this.#scratchWorld.y += PARTICLE_VERTICAL_DISTANCE * progress;
      particle.sprite.position.copy(this.#scratchWorld).applyMatrix4(this.#inverseWorld);
      // TMEffectBillBoard skips the first 5% and uses fade mode 1.
      particle.sprite.visible = this.#effectsEnabled && progress >= 0.05;
      particle.material.opacity = Math.max(0, Math.sin(progress * Math.PI));
    }
  }

  private nextRandomInt(maxExclusive: number): number {
    this.#randomState = (Math.imul(this.#randomState, 1_664_525) + 1_013_904_223) >>> 0;
    return this.#randomState % maxExclusive;
  }
}

async function loadParticleTexture(assets: ClassicAssetSource): Promise<THREE.Texture | null> {
  const url = assets.effectTextureUrl(PARTICLE_TEXTURE_INDEX);
  if (!url) return null;
  const texture = await new DDSLoader().loadAsync(url).catch(() => null);
  if (!texture) return null;
  texture.name = "griupan-effect-texture-2";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  // TMEffectBillBoard's four UVs use the 0.02/0.98 inset and inverted V.
  texture.offset.set(0.02, 0.98);
  texture.repeat.set(0.96, -0.96);
  texture.needsUpdate = true;
  return texture;
}
