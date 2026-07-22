import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { parseMsa } from "../../formats/classic/Msa";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";

const METEOR_POOL_LIMIT = 24;
const TRAIL_POOL_LIMIT = 256;
const IMPACT_POOL_LIMIT = 48;
const SHADE_POOL_LIMIT = 48;

// TMSkillMeteorStorm level 1: 30 ms * uint(length(target +(3, 5, -3))).
// uint(sqrt(43)) is six, so every shard lives for exactly 180 ms.
const METEOR_LIFETIME_SECONDS = 0.18;
const TRAIL_LIFETIME_SECONDS = 1;
const TRAIL_GROWTH_PER_SECOND = 1;
const IMPACT_LIFETIME_SECONDS = 0.888;
const IMPACT_FRAME_SECONDS = 0.111;
const SHADE_LIFETIME_SECONDS = 1.5;
const BILLBOARD_VISIBLE_FRACTION = 0.05;

const ICE_BLUE = 0x3333ff;
const IMPACT_FRAME_INDICES = [71, 72, 73, 74, 75, 76, 77, 78] as const;
const REQUIRED_TEXTURE_INDICES = [0, 7, 19, ...IMPACT_FRAME_INDICES] as const;

type RequiredTextureIndex = (typeof REQUIRED_TEXTURE_INDICES)[number];

interface ClassicFoemaBlizzardResources {
  readonly shardGeometry: THREE.BufferGeometry;
  readonly trailTexture: THREE.Texture;
  readonly shadeTexture: THREE.Texture;
  readonly iceTexture: THREE.Texture;
  readonly impactFrames: readonly THREE.Texture[];
}

interface BlizzardMeteorVisual {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly start: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly position: THREE.Vector3;
  active: boolean;
  elapsed: number;
  serial: number;
}

interface BlizzardTrailVisual {
  readonly sprite: THREE.Sprite;
  readonly basePosition: THREE.Vector3;
  active: boolean;
  elapsed: number;
  baseScale: number;
  serial: number;
}

interface BlizzardImpactVisual {
  readonly sprite: THREE.Sprite;
  active: boolean;
  elapsed: number;
  serial: number;
}

interface BlizzardShadeVisual {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  active: boolean;
  elapsed: number;
  serial: number;
}

/**
 * Presentation-only port of Foema record #36, Nevasca.
 *
 * The retail client does not use its empty TMSkillSnow class here. At packet
 * time TMFieldScene creates six TMSkillMeteorStorm controllers at level 1;
 * those are 180 ms model-708 ice shards with blue texture-0 trails, animated
 * texture-71..78 impacts and texture-7 ground shades. The authoritative
 * AffectType 1 freeze lifecycle, actor tint and animation slowdown live in the
 * actor/spawn layer rather than this short-lived particle renderer.
 *
 * Public positions are target feet in Three.js scene coordinates. Targeting,
 * damage, status authority and sounds 161/154 deliberately remain outside.
 */
export class ClassicFoemaBlizzardEffects {
  readonly object = new THREE.Group();
  readonly #dds = new ClassicDdsTextureLoader();
  readonly #planeGeometry = new THREE.PlaneGeometry(1, 1);
  readonly #meteors: BlizzardMeteorVisual[] = [];
  readonly #meteorUpdateOrder: BlizzardMeteorVisual[] = [];
  readonly #trails: BlizzardTrailVisual[] = [];
  readonly #impacts: BlizzardImpactVisual[] = [];
  readonly #shades: BlizzardShadeVisual[] = [];
  #resources: ClassicFoemaBlizzardResources | null = null;
  #preload: Promise<void> | null = null;
  #clockSeconds = 0;
  #lastTrailEmissionAt = Number.NEGATIVE_INFINITY;
  #serial = 0;
  #randomSerial = 0;
  #enabled = true;
  #disposed = false;

  constructor(parent: THREE.Object3D) {
    this.object.name = "classic-foema-blizzard-effects";
    parent.add(this.object);
  }

  /** Loads retail model 708 and EffectTextureList entries 0, 7, 19, 71..78. */
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
        console.warn("Efeito clássico #36 Nevasca da Foema indisponível.", error);
      })
      .finally(() => {
        this.#preload = null;
      });
    this.#preload = job;
    return job;
  }

  /** Starts the six retail ice-shard controllers at the supplied target feet. */
  play(targetFeet: THREE.Vector3): boolean {
    if (
      this.#disposed
      || !this.#enabled
      || !this.#resources
      || !isFiniteVector(targetFeet)
    ) {
      return false;
    }

    // TMFieldScene.cpp creates i=0..5 in this order. Classic +Z is scene -Z.
    // EffectContainer::AddChild inserts at the head; update() mirrors that by
    // advancing the newest controller first.
    for (let index = 0; index < 6; index++) {
      this.spawnMeteor(
        targetFeet.x + (index % 3) * 0.3,
        targetFeet.y,
        targetFeet.z - (((index + 3) % 5) * 0.3),
      );
    }
    return true;
  }

  update(deltaSeconds: number): void {
    if (this.#disposed || !this.#enabled) return;
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    if (delta === 0) return;
    this.#clockSeconds += delta;

    // Effect-container children advance before their owning MeteorStorm. New
    // trails/impacts therefore begin at elapsed zero on the following frame.
    this.updateTrails(delta);
    this.updateImpacts(delta);
    this.updateShades(delta);
    this.updateMeteors(delta);
  }

  setEnabled(enabled: boolean): void {
    if (this.#disposed || this.#enabled === enabled) return;
    this.#enabled = enabled;
    this.object.visible = enabled;
    if (!enabled) this.clear();
  }

  clear(): void {
    for (const meteor of this.#meteors) deactivateMeteor(meteor);
    this.#meteorUpdateOrder.length = 0;
    for (const trail of this.#trails) deactivateTrail(trail);
    for (const impact of this.#impacts) deactivateImpact(impact);
    for (const shade of this.#shades) deactivateShade(shade);
    this.#lastTrailEmissionAt = Number.NEGATIVE_INFINITY;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clear();

    for (const meteor of this.#meteors) meteor.mesh.material.dispose();
    for (const trail of this.#trails) trail.sprite.material.dispose();
    for (const impact of this.#impacts) impact.sprite.material.dispose();
    for (const shade of this.#shades) shade.mesh.material.dispose();
    this.#meteors.length = 0;
    this.#trails.length = 0;
    this.#impacts.length = 0;
    this.#shades.length = 0;
    this.#planeGeometry.dispose();
    if (this.#resources) disposeResources(this.#resources);
    this.#resources = null;
    this.object.removeFromParent();
    this.object.clear();
  }

  private spawnMeteor(targetX: number, targetFeetY: number, targetZ: number): void {
    const meteor = this.acquireMeteor();
    meteor.active = true;
    meteor.elapsed = 0;
    meteor.serial = ++this.#serial;
    meteor.target.set(targetX, targetFeetY, targetZ);
    // TMSkillMeteorStorm's zero-start fallback is target +(3,+5,-3).
    // Reflecting classic Z into scene space changes the final term to +3.
    meteor.start.set(targetX + 3, targetFeetY + 5, targetZ + 3);
    meteor.position.copy(meteor.start);

    const direction = meteor.target.clone().sub(meteor.start);
    const retailAngle = Math.atan2(direction.x, direction.z) - Math.PI / 2;
    // TMMesh adds -90 degrees to its pitch. Level 1 passes (angle + 90,
    // +45, 0), so the converted YXZ basis is (+45, -(angle+90), 0).
    meteor.mesh.rotation.set(
      Math.PI / 4,
      -(retailAngle + Math.PI / 2),
      0,
      "YXZ",
    );
    meteor.mesh.position.copy(meteor.position);
    meteor.mesh.scale.setScalar(1.7);
    meteor.mesh.visible = false;
  }

  private acquireMeteor(): BlizzardMeteorVisual {
    const free = this.#meteors.find((meteor) => !meteor.active);
    if (free) return free;
    if (this.#meteors.length < METEOR_POOL_LIMIT) {
      const resources = this.#resources!;
      const mesh = new THREE.Mesh(
        resources.shardGeometry,
        createBrightMeshMaterial(resources.iceTexture),
      );
      mesh.name = `classic-foema-blizzard-shard-${this.#meteors.length}-model-708-texture-19`;
      mesh.renderOrder = 8;
      mesh.visible = false;
      const meteor: BlizzardMeteorVisual = {
        mesh,
        start: new THREE.Vector3(),
        target: new THREE.Vector3(),
        position: new THREE.Vector3(),
        active: false,
        elapsed: 0,
        serial: 0,
      };
      this.#meteors.push(meteor);
      this.object.add(mesh);
      return meteor;
    }
    const oldest = oldestBySerial(this.#meteors);
    deactivateMeteor(oldest);
    return oldest;
  }

  private updateMeteors(delta: number): void {
    this.#meteorUpdateOrder.length = 0;
    for (const meteor of this.#meteors) {
      if (meteor.active) this.#meteorUpdateOrder.push(meteor);
    }
    this.#meteorUpdateOrder.sort((left, right) => right.serial - left.serial);

    for (const meteor of this.#meteorUpdateOrder) {
      meteor.elapsed += delta;
      if (meteor.elapsed >= METEOR_LIFETIME_SECONDS) {
        // The destructor uses the last sampled position rather than snapping
        // to the target. That makes impact height frame-rate dependent in the
        // retail client and is intentionally retained here.
        this.spawnImpact(meteor);
        this.spawnShade(meteor);
        deactivateMeteor(meteor);
        continue;
      }

      const progress = meteor.elapsed / METEOR_LIFETIME_SECONDS;
      meteor.position.lerpVectors(meteor.start, meteor.target, progress);
      meteor.mesh.position.copy(meteor.position);
      meteor.mesh.visible = progress >= BILLBOARD_VISIBLE_FRACTION;
      const totalEffects = this.consumeSharedTrailBurst();
      for (let index = 0; index < totalEffects; index++) this.spawnTrail(meteor.position);
    }
  }

  private consumeSharedTrailBurst(): 1 | 2 | 4 {
    const elapsed = this.#clockSeconds - this.#lastTrailEmissionAt;
    const count = elapsed < 0.02 ? 1 : elapsed < 0.03 ? 2 : 4;
    this.#lastTrailEmissionAt = this.#clockSeconds;
    return count;
  }

  private spawnTrail(position: THREE.Vector3): void {
    const random = classicRandomStep(++this.#randomSerial, 5);
    const trail = this.acquireTrail();
    trail.active = true;
    trail.elapsed = 0;
    trail.baseScale = 0.4 + random * 0.1;
    trail.serial = ++this.#serial;
    trail.basePosition.set(
      position.x + random * 0.01,
      position.y - 0.7 + random * 0.01,
      // Classic +Z becomes scene -Z.
      position.z - random * 0.01,
    );
    this.updateTrailVisual(trail);
  }

  private acquireTrail(): BlizzardTrailVisual {
    const free = this.#trails.find((trail) => !trail.active);
    if (free) return free;
    if (this.#trails.length < TRAIL_POOL_LIMIT) {
      const sprite = createBrightSprite(
        this.#resources!.trailTexture,
        `classic-foema-blizzard-blue-trail-${this.#trails.length}`,
      );
      const trail: BlizzardTrailVisual = {
        sprite,
        basePosition: new THREE.Vector3(),
        active: false,
        elapsed: 0,
        baseScale: 0.4,
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

  private updateTrails(delta: number): void {
    for (const trail of this.#trails) {
      if (!trail.active) continue;
      trail.elapsed += delta;
      this.updateTrailVisual(trail);
    }
  }

  private updateTrailVisual(trail: BlizzardTrailVisual): void {
    if (trail.elapsed >= TRAIL_LIFETIME_SECONDS) {
      deactivateTrail(trail);
      return;
    }
    const progress = trail.elapsed / TRAIL_LIFETIME_SECONDS;
    const scale = trail.baseScale + trail.elapsed * TRAIL_GROWTH_PER_SECOND;
    trail.sprite.position.copy(trail.basePosition);
    // TMEffectBillBoard::m_bStickGround raises the centered quad by half its
    // current vertical scale; it does not resample terrain.
    trail.sprite.position.y += scale / 2;
    trail.sprite.scale.set(scale, scale, 1);
    trail.sprite.visible = progress >= BILLBOARD_VISIBLE_FRACTION;
    setBrightIntensity(trail.sprite.material, ICE_BLUE, Math.sin(progress * Math.PI));
  }

  private spawnImpact(meteor: BlizzardMeteorVisual): void {
    const impact = this.acquireImpact();
    impact.active = true;
    impact.elapsed = 0;
    impact.serial = ++this.#serial;
    impact.sprite.position.set(
      meteor.target.x,
      meteor.position.y - 1.5,
      meteor.target.z,
    );
    impact.sprite.scale.set(0.5, 0.5, 1);
    impact.sprite.material.color.setHex(0xffffff);
    impact.sprite.material.opacity = 1;
    impact.sprite.visible = false;
  }

  private acquireImpact(): BlizzardImpactVisual {
    const free = this.#impacts.find((impact) => !impact.active);
    if (free) return free;
    if (this.#impacts.length < IMPACT_POOL_LIMIT) {
      const sprite = createBrightSprite(
        this.#resources!.impactFrames[0]!,
        `classic-foema-blizzard-impact-71-78-${this.#impacts.length}`,
      );
      sprite.renderOrder = 9;
      const impact: BlizzardImpactVisual = {
        sprite,
        active: false,
        elapsed: 0,
        serial: 0,
      };
      this.#impacts.push(impact);
      this.object.add(sprite);
      return impact;
    }
    const oldest = oldestBySerial(this.#impacts);
    deactivateImpact(oldest);
    return oldest;
  }

  private updateImpacts(delta: number): void {
    for (const impact of this.#impacts) {
      if (!impact.active) continue;
      impact.elapsed += delta;
      if (impact.elapsed >= IMPACT_LIFETIME_SECONDS) {
        deactivateImpact(impact);
        continue;
      }
      const progress = impact.elapsed / IMPACT_LIFETIME_SECONDS;
      const frameIndex = Math.min(
        IMPACT_FRAME_INDICES.length - 1,
        Math.floor(impact.elapsed / IMPACT_FRAME_SECONDS),
      );
      setMaterialMap(impact.sprite.material, this.#resources!.impactFrames[frameIndex]!);
      impact.sprite.visible = progress >= BILLBOARD_VISIBLE_FRACTION;
    }
  }

  private spawnShade(meteor: BlizzardMeteorVisual): void {
    const shade = this.acquireShade();
    shade.active = true;
    shade.elapsed = 0;
    shade.serial = ++this.#serial;
    shade.mesh.position.set(meteor.target.x, meteor.target.y + 0.05, meteor.target.z);
    // TMShade grid 2 spans four classic world units.
    shade.mesh.scale.set(4, 4, 1);
    shade.mesh.visible = true;
    setBrightIntensity(shade.mesh.material, ICE_BLUE, 0);
  }

  private acquireShade(): BlizzardShadeVisual {
    const free = this.#shades.find((shade) => !shade.active);
    if (free) return free;
    if (this.#shades.length < SHADE_POOL_LIMIT) {
      const mesh = createBrightGroundPlane(
        this.#planeGeometry,
        this.#resources!.shadeTexture,
        `classic-foema-blizzard-shade-2-texture-7-${this.#shades.length}`,
      );
      const shade: BlizzardShadeVisual = {
        mesh,
        active: false,
        elapsed: 0,
        serial: 0,
      };
      this.#shades.push(shade);
      this.object.add(mesh);
      return shade;
    }
    const oldest = oldestBySerial(this.#shades);
    deactivateShade(oldest);
    return oldest;
  }

  private updateShades(delta: number): void {
    for (const shade of this.#shades) {
      if (!shade.active) continue;
      shade.elapsed += delta;
      if (shade.elapsed >= SHADE_LIFETIME_SECONDS) {
        deactivateShade(shade);
        continue;
      }
      setBrightIntensity(
        shade.mesh.material,
        ICE_BLUE,
        Math.sin((shade.elapsed / SHADE_LIFETIME_SECONDS) * Math.PI),
      );
    }
  }

  private async loadClassicResources(
    assets: ClassicAssetSource,
  ): Promise<ClassicFoemaBlizzardResources> {
    const shardSource = await assets.loadModel(708);
    if (!shardSource) throw new Error("Modelo clássico 708 ausente do manifesto");

    const results = await Promise.allSettled(
      REQUIRED_TEXTURE_INDICES.map((index) => this.loadEffectTexture(assets, index)),
    );
    const loaded = new Map<RequiredTextureIndex, THREE.Texture>();
    let failure: unknown = null;
    for (let index = 0; index < results.length; index++) {
      const result = results[index]!;
      const textureIndex = REQUIRED_TEXTURE_INDICES[index]!;
      if (result.status === "fulfilled") loaded.set(textureIndex, result.value);
      else failure ??= result.reason;
    }
    if (failure || loaded.size !== REQUIRED_TEXTURE_INDICES.length) {
      for (const texture of loaded.values()) texture.dispose();
      throw failure ?? new Error("Texturas clássicas 0/7/19/71..78 incompletas");
    }

    let shardGeometry: THREE.BufferGeometry | null = null;
    try {
      configureClassicBillboardUvs(loaded.get(0)!);
      configureClassicGroundPlaneUvs(loaded.get(7)!);
      for (const index of IMPACT_FRAME_INDICES) {
        configureClassicBillboardUvs(loaded.get(index)!);
      }
      shardGeometry = parseMsa(shardSource.buffer).geometry;
      return {
        shardGeometry,
        trailTexture: loaded.get(0)!,
        shadeTexture: loaded.get(7)!,
        iceTexture: loaded.get(19)!,
        impactFrames: IMPACT_FRAME_INDICES.map((index) => loaded.get(index)!),
      };
    } catch (error) {
      shardGeometry?.dispose();
      for (const texture of loaded.values()) texture.dispose();
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

function createBrightMeshMaterial(texture: THREE.Texture): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: 0xffffff,
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

function createBrightSprite(texture: THREE.Texture, name: string): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: texture,
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.name = name;
  sprite.renderOrder = 7;
  sprite.visible = false;
  return sprite;
}

function createBrightGroundPlane(
  geometry: THREE.PlaneGeometry,
  texture: THREE.Texture,
  name: string,
): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const mesh = new THREE.Mesh(geometry, createBrightMeshMaterial(texture));
  mesh.name = name;
  mesh.rotation.set(-Math.PI / 2, 0, 0);
  mesh.renderOrder = 5;
  mesh.visible = false;
  return mesh;
}

function setBrightIntensity(
  material: THREE.SpriteMaterial | THREE.MeshBasicMaterial,
  color: number,
  intensity: number,
): void {
  material.color
    .setHex(color & 0xffffff)
    .multiplyScalar(THREE.MathUtils.clamp(intensity, 0, 1));
  // EF_BRIGHT preserves texture alpha and carries fades in diffuse RGB.
  material.opacity = 1;
}

function setMaterialMap(material: THREE.SpriteMaterial, texture: THREE.Texture): void {
  if (material.map === texture) return;
  material.map = texture;
  material.needsUpdate = true;
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

function deactivateMeteor(meteor: BlizzardMeteorVisual): void {
  meteor.active = false;
  meteor.elapsed = 0;
  meteor.mesh.visible = false;
}

function deactivateTrail(trail: BlizzardTrailVisual): void {
  trail.active = false;
  trail.elapsed = 0;
  trail.sprite.visible = false;
  trail.sprite.material.color.setHex(0x000000);
}

function deactivateImpact(impact: BlizzardImpactVisual): void {
  impact.active = false;
  impact.elapsed = 0;
  impact.sprite.visible = false;
}

function deactivateShade(shade: BlizzardShadeVisual): void {
  shade.active = false;
  shade.elapsed = 0;
  shade.mesh.visible = false;
  shade.mesh.material.color.setHex(0x000000);
}

function oldestBySerial<T extends { serial: number }>(visuals: readonly T[]): T {
  let oldest = visuals[0]!;
  for (const visual of visuals) {
    if (visual.serial < oldest.serial) oldest = visual;
  }
  return oldest;
}

function classicRandomStep(serial: number, modulus: number): number {
  const seed = Math.imul(serial + 0x9e37, 1_103_515_245) + 12_345;
  return (seed >>> 16) % modulus;
}

function isFiniteVector(position: THREE.Vector3): boolean {
  return Number.isFinite(position.x)
    && Number.isFinite(position.y)
    && Number.isFinite(position.z);
}

function disposeResources(resources: ClassicFoemaBlizzardResources): void {
  resources.shardGeometry.dispose();
  const textures = new Set<THREE.Texture>([
    resources.trailTexture,
    resources.shadeTexture,
    resources.iceTexture,
    ...resources.impactFrames,
  ]);
  for (const texture of textures) texture.dispose();
}
