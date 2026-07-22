import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { parseAni, type AniAnimation } from "../../formats/classic/Ani";
import { parseBon, type BonSkeleton } from "../../formats/classic/Bon";
import { parseMsh, type MshModel } from "../../formats/classic/Msh";
import { ClassicSkinnedModel } from "../characters/ClassicSkinnedModel";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";

const FAIRY_POOL_LIMIT = 12;
const TRAIL_POOL_LIMIT = 1_024;
const FAIRIES_PER_CAST = 3;

const FAIRY_SCALE = 2;
const FAIRY_ORBIT_RADIUS = 0.2;
const FAIRY_ORBIT_MILLISECONDS = 1_000;
const FAIRY_VISIBLE_FRACTION = 0.01;
const FAIRY_MIN_LIFETIME_SECONDS = 0.001;
const FAIRY_MAX_LIFETIME_SECONDS = 5;
const FAIRY_SECONDS_PER_WHOLE_UNIT = 0.2;

// TMSkillPoison emits one pair per FrameMove. Capping the browser path at the
// retail-era 60 Hz preserves the common result without doubling it on 120 Hz.
const TRAIL_EMISSION_INTERVAL_SECONDS = 1 / 60;
const TRAIL_VISIBLE_FRACTION = 0.05;
const TRAIL_GROWTH_PER_SECOND = 1;
const TRAIL_COLOR = 0xffaaff;

const FAIRY_ROOT = "player/familiars/ag01";
const FAIRY_SKELETON_FILE = `${FAIRY_ROOT}/ag01.bon`;
const FAIRY_ANIMATION_FILE = `${FAIRY_ROOT}/ag010101.ani`;
const FAIRY_MESH_FILE = `${FAIRY_ROOT}/ag010101.msh`;
const FAIRY_TEXTURE_FILE = `${FAIRY_ROOT}/ag010101.dds`;

/** Cumulative TMHuman offsets converted from classic +Z to Three.js -Z. */
const FAIRY_START_OFFSETS = [
  [-0.5, -0.5],
  [0.1, 0.1],
  [1.3, 1.3],
] as const;

interface FairyResources {
  readonly skeleton: BonSkeleton;
  readonly animation: AniAnimation;
  readonly mesh: MshModel;
  readonly modelTexture: THREE.Texture;
  readonly trailTexture: THREE.Texture;
}

interface FairyVisual {
  readonly model: ClassicSkinnedModel;
  readonly material: THREE.MeshBasicMaterial;
  readonly startWorld: THREE.Vector3;
  readonly targetWorld: THREE.Vector3;
  readonly positionWorld: THREE.Vector3;
  active: boolean;
  elapsed: number;
  lifetime: number;
  casterClassicYaw: number;
  phaseSeedMilliseconds: number;
  trailAccumulator: number;
  followTarget: (() => THREE.Vector3 | null) | null;
  serial: number;
}

interface TrailVisual {
  readonly sprite: THREE.Sprite;
  readonly material: THREE.SpriteMaterial;
  readonly baseWorldPosition: THREE.Vector3;
  active: boolean;
  elapsed: number;
  lifetime: number;
  baseScale: number;
  serial: number;
}

/**
 * BeastMaster #50, reconstructed from TMHuman + TMEffectSkinMesh motion 4.
 *
 * Public positions are actor/target feet in Three.js world space. The caller
 * owns the retail +500 ms dispatch delay and all gameplay/damage. These three
 * ag01 actors only render the client visual and may optionally follow a live
 * target position while flying.
 */
export class ClassicBeastMasterFairyEffects {
  readonly object = new THREE.Group();
  readonly #dds = new ClassicDdsTextureLoader();
  readonly #fairies: FairyVisual[] = [];
  readonly #trail: TrailVisual[] = [];
  readonly #inverseWorld = new THREE.Matrix4();
  readonly #scratchLocal = new THREE.Vector3();
  readonly #scratchCenter = new THREE.Vector3();
  readonly #scratchWorld = new THREE.Vector3();
  #resources: FairyResources | null = null;
  #preload: Promise<void> | null = null;
  #serial = 0;
  #randomState = 0x50a90101;
  #enabled = true;
  #disposed = false;

  constructor(parent: THREE.Object3D) {
    this.object.name = "classic-beastmaster-fairy-effects";
    parent.add(this.object);
  }

  /** Loads the exact ag010101 look, WALK ANI and effect texture 0. */
  async prepareClassic(assets: ClassicAssetSource): Promise<void> {
    if (this.#disposed || this.#resources) return;
    if (this.#preload) return this.#preload;

    const job = this.loadClassicResources(assets)
      .then((resources) => {
        if (this.#disposed) {
          disposeResources(resources);
          return;
        }

        const created: FairyVisual[] = [];
        try {
          for (let index = 0; index < FAIRY_POOL_LIMIT; index++) {
            created.push(this.createFairy(resources, index));
          }
        } catch (error) {
          for (const visual of created) disposeFairy(visual);
          disposeResources(resources);
          throw error;
        }

        this.#resources = resources;
        this.#fairies.push(...created);
      })
      .catch((error: unknown) => {
        console.warn("Fadas clássicas do BeastMaster indisponíveis.", error);
      })
      .finally(() => {
        this.#preload = null;
      });

    this.#preload = job;
    return job;
  }

  play(
    casterFeet: THREE.Vector3,
    targetFeet: THREE.Vector3,
    casterClassicYaw: number,
    followTarget?: () => THREE.Vector3 | null,
  ): boolean {
    if (
      this.#disposed
      || !this.#enabled
      || !this.#resources
      || this.#fairies.length < FAIRIES_PER_CAST
      || !isFiniteVector(casterFeet)
      || !isFiniteVector(targetFeet)
      || !Number.isFinite(casterClassicYaw)
    ) {
      return false;
    }

    this.updateInverseWorld();
    for (const [offsetX, offsetZ] of FAIRY_START_OFFSETS) {
      const visual = this.acquireFairy();
      visual.active = true;
      visual.elapsed = 0;
      visual.casterClassicYaw = casterClassicYaw;
      visual.trailAccumulator = 0;
      visual.followTarget = followTarget ?? null;
      visual.serial = ++this.#serial;
      visual.startWorld.set(
        casterFeet.x + offsetX,
        casterFeet.y,
        casterFeet.z + offsetZ,
      );
      visual.targetWorld.copy(targetFeet);
      visual.lifetime = THREE.MathUtils.clamp(
        Math.floor(visual.startWorld.distanceTo(targetFeet))
          * FAIRY_SECONDS_PER_WHOLE_UNIT,
        FAIRY_MIN_LIFETIME_SECONDS,
        FAIRY_MAX_LIFETIME_SECONDS,
      );
      // The original DWORD conversion wraps negative world coordinates.
      visual.phaseSeedMilliseconds = (
        Math.trunc(visual.startWorld.x * 100) >>> 0
      ) % FAIRY_ORBIT_MILLISECONDS;
      visual.material.color.setHex(0xffffff);
      visual.material.opacity = 1;
      visual.model.play("WALK", true);
      visual.model.object.visible = false;
      this.updateFairyPose(visual, 0);
    }
    return true;
  }

  setEnabled(enabled: boolean): void {
    if (this.#disposed || this.#enabled === enabled) return;
    this.#enabled = enabled;
    this.object.visible = enabled;
    if (!enabled) this.clear();
  }

  update(deltaSeconds: number): void {
    if (
      this.#disposed
      || !this.#enabled
      || !Number.isFinite(deltaSeconds)
      || deltaSeconds <= 0
    ) {
      return;
    }

    this.updateInverseWorld();
    for (const visual of this.#fairies) {
      if (!visual.active) continue;
      visual.elapsed += deltaSeconds;
      if (visual.elapsed >= visual.lifetime) {
        deactivateFairy(visual);
        continue;
      }

      this.followLiveTarget(visual);
      const progress = THREE.MathUtils.clamp(
        visual.elapsed / visual.lifetime,
        0,
        1,
      );
      this.updateFairyPose(visual, progress);
      visual.model.update(deltaSeconds);

      // One TMSkillPoison(count=2) per visible FrameMove, with a 60 Hz ceiling.
      visual.trailAccumulator += deltaSeconds;
      if (
        progress >= FAIRY_VISIBLE_FRACTION
        && visual.trailAccumulator >= TRAIL_EMISSION_INTERVAL_SECONDS
      ) {
        visual.trailAccumulator %= TRAIL_EMISSION_INTERVAL_SECONDS;
        this.spawnTrailPair(visual.positionWorld);
      }
    }

    this.updateTrail(deltaSeconds);
  }

  clear(): void {
    for (const visual of this.#fairies) deactivateFairy(visual);
    for (const visual of this.#trail) deactivateTrail(visual);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clear();

    for (const visual of this.#fairies) disposeFairy(visual);
    for (const visual of this.#trail) visual.material.dispose();
    this.#fairies.length = 0;
    this.#trail.length = 0;

    if (this.#resources) disposeResources(this.#resources);
    this.#resources = null;
    this.object.removeFromParent();
    this.object.clear();
  }

  private createFairy(resources: FairyResources, index: number): FairyVisual {
    // Color fade is per effect instance in TMEffectSkinMesh, so materials must
    // not be shared by the pool even though their immutable DDS map is shared.
    const material = new THREE.MeshBasicMaterial({
      map: resources.modelTexture,
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      alphaTest: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    });
    material.forceSinglePass = true;

    const model = new ClassicSkinnedModel({
      skeleton: resources.skeleton,
      parts: [{ name: "ag010101", model: resources.mesh, material }],
      clips: [{
        name: "WALK",
        animation: resources.animation,
        quarterStepMs: 5,
        loop: true,
      }],
      initialClip: "WALK",
      mirrorModelZ: true,
    });
    model.object.name = `beastmaster-fairy-${index}`;
    model.object.visible = false;
    model.setClassicTransform({ scale: FAIRY_SCALE, mirrorModelZ: true });
    for (const mesh of model.meshes) {
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = 8;
    }
    this.object.add(model.object);

    return {
      model,
      material,
      startWorld: new THREE.Vector3(),
      targetWorld: new THREE.Vector3(),
      positionWorld: new THREE.Vector3(),
      active: false,
      elapsed: 0,
      lifetime: FAIRY_MIN_LIFETIME_SECONDS,
      casterClassicYaw: 0,
      phaseSeedMilliseconds: 0,
      trailAccumulator: 0,
      followTarget: null,
      serial: 0,
    };
  }

  private acquireFairy(): FairyVisual {
    const free = this.#fairies.find((visual) => !visual.active);
    if (free) return free;
    const oldest = oldestBySerial(this.#fairies);
    deactivateFairy(oldest);
    return oldest;
  }

  private followLiveTarget(visual: FairyVisual): void {
    if (!visual.followTarget) return;
    try {
      const target = visual.followTarget();
      if (target && isFiniteVector(target)) visual.targetWorld.copy(target);
    } catch {
      // A disappearing streamed target leaves the effect flying to its last
      // valid position, matching the retained m_vecTo fallback in the client.
    }
  }

  private updateFairyPose(visual: FairyVisual, progress: number): void {
    this.#scratchCenter.lerpVectors(
      visual.startWorld,
      visual.targetWorld,
      progress,
    );
    const elapsedMilliseconds = Math.trunc(visual.elapsed * 1_000);
    const orbitPhase = (
      ((elapsedMilliseconds + visual.phaseSeedMilliseconds)
        % FAIRY_ORBIT_MILLISECONDS)
      * Math.PI * 2 / FAIRY_ORBIT_MILLISECONDS
    );
    // TMHuman stores the opposite sign from its TMSkinMesh. The public API
    // receives that logical mesh yaw, while retail m_fStartAngle used the
    // owning TMHuman angle for the orbit phase.
    const orbitAngle = orbitPhase - visual.casterClassicYaw;
    visual.positionWorld.set(
      this.#scratchCenter.x + Math.cos(orbitAngle) * FAIRY_ORBIT_RADIUS,
      this.#scratchCenter.y,
      this.#scratchCenter.z - Math.sin(orbitAngle) * FAIRY_ORBIT_RADIUS,
    );
    visual.model.object.position.copy(
      this.#scratchLocal.copy(visual.positionWorld).applyMatrix4(this.#inverseWorld),
    );
    visual.model.object.visible = progress >= FAIRY_VISIBLE_FRACTION;

    const deltaX = visual.targetWorld.x - visual.startWorld.x;
    const deltaZ = visual.targetWorld.z - visual.startWorld.z;
    const classicYaw = Math.atan2(deltaX, -deltaZ) + Math.PI / 2;
    visual.model.setClassicTransform({ yaw: classicYaw, scale: FAIRY_SCALE });

    // TMEffectSkinMesh fade mode 1 attenuates diffuse RGB, not texture alpha.
    const fade = Math.max(0, Math.cos(progress * Math.PI / 2));
    visual.material.color.setRGB(fade, fade, fade);
    visual.material.opacity = 1;
  }

  private spawnTrailPair(positionWorld: THREE.Vector3): void {
    if (!this.#resources) return;
    for (let index = 0; index < 2; index++) {
      const visual = this.acquireTrail();
      visual.active = true;
      visual.elapsed = 0;
      visual.lifetime = 1.5 + index * 0.4;
      visual.baseScale = 0.2 + this.nextRandomInt(5) * 0.1;
      visual.serial = ++this.#serial;
      visual.baseWorldPosition.copy(positionWorld);
      visual.baseWorldPosition.x += (this.nextRandomInt(10) - 5) * 0.1;
      // Classic random +Z becomes Three.js -Z.
      visual.baseWorldPosition.z -= (this.nextRandomInt(10) - 5) * 0.1;
      visual.sprite.visible = false;
      visual.material.color.setHex(0x000000);
      visual.material.opacity = 1;
    }
  }

  private acquireTrail(): TrailVisual {
    const free = this.#trail.find((visual) => !visual.active);
    if (free) return free;
    if (this.#trail.length < TRAIL_POOL_LIMIT) {
      const visual = this.createTrail(this.#trail.length);
      this.#trail.push(visual);
      this.object.add(visual.sprite);
      return visual;
    }
    const oldest = oldestBySerial(this.#trail);
    deactivateTrail(oldest);
    return oldest;
  }

  private createTrail(index: number): TrailVisual {
    const material = new THREE.SpriteMaterial({
      map: this.#resources?.trailTexture ?? null,
      color: 0x000000,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.name = `beastmaster-fairy-trail-${index}`;
    sprite.visible = false;
    sprite.renderOrder = 9;
    return {
      sprite,
      material,
      baseWorldPosition: new THREE.Vector3(),
      active: false,
      elapsed: 0,
      lifetime: 1.5,
      baseScale: 0.2,
      serial: 0,
    };
  }

  private updateTrail(deltaSeconds: number): void {
    for (const visual of this.#trail) {
      if (!visual.active) continue;
      visual.elapsed += deltaSeconds;
      const progress = visual.elapsed / visual.lifetime;
      if (progress >= 1) {
        deactivateTrail(visual);
        continue;
      }

      const scale = visual.baseScale + visual.elapsed * TRAIL_GROWTH_PER_SECOND;
      visual.sprite.scale.set(scale, scale, 1);
      this.#scratchWorld.copy(visual.baseWorldPosition);
      // TMSkillPoison's stick-ground billboard grows upward from its base.
      this.#scratchWorld.y += scale / 2;
      visual.sprite.position.copy(
        this.#scratchLocal.copy(this.#scratchWorld).applyMatrix4(this.#inverseWorld),
      );
      visual.sprite.visible = progress >= TRAIL_VISIBLE_FRACTION;

      const fade = Math.max(0, Math.sin(progress * Math.PI));
      visual.material.color
        .setHex(TRAIL_COLOR)
        .multiplyScalar(fade);
      visual.material.opacity = 1;
    }
  }

  private updateInverseWorld(): void {
    this.object.updateWorldMatrix(true, false);
    this.#inverseWorld.copy(this.object.matrixWorld).invert();
  }

  private nextRandomInt(maxExclusive: number): number {
    this.#randomState = (
      Math.imul(this.#randomState, 1_664_525) + 1_013_904_223
    ) >>> 0;
    return this.#randomState % maxExclusive;
  }

  private async loadClassicResources(assets: ClassicAssetSource): Promise<FairyResources> {
    const trailUrl = assets.effectTextureUrl(0);
    if (!trailUrl) throw new Error("Textura de efeito 0 ausente do manifesto");

    const [skeletonBuffer, animationBuffer, meshBuffer] = await Promise.all([
      loadBuffer(assets.dataUrl(FAIRY_SKELETON_FILE)),
      loadBuffer(assets.dataUrl(FAIRY_ANIMATION_FILE)),
      loadBuffer(assets.dataUrl(FAIRY_MESH_FILE)),
    ]);
    const textureResults = await Promise.allSettled([
      this.#dds.loadAsync(assets.dataUrl(FAIRY_TEXTURE_FILE)),
      this.#dds.loadAsync(trailUrl),
    ]);
    const loadedTextures = textureResults.flatMap((result) => (
      result.status === "fulfilled" ? [result.value] : []
    ));
    const rejected = textureResults.find((result) => result.status === "rejected");
    if (rejected?.status === "rejected") {
      for (const texture of loadedTextures) texture.dispose();
      throw rejected.reason;
    }
    const modelTexture = loadedTextures[0];
    const trailTexture = loadedTextures[1];
    if (!modelTexture || !trailTexture) {
      for (const texture of loadedTextures) texture.dispose();
      throw new Error("Texturas ag01 incompletas");
    }

    try {
      configureColorTexture(modelTexture, "beastmaster-fairy-ag010101");
      configureColorTexture(trailTexture, "beastmaster-fairy-trail-000");
      // TMEffectBillBoard uses the 0.02/0.98 inset with inverted V.
      trailTexture.offset.set(0.02, 0.98);
      trailTexture.repeat.set(0.96, -0.96);
      trailTexture.needsUpdate = true;
      return {
        skeleton: parseBon(skeletonBuffer),
        animation: parseAni(animationBuffer),
        mesh: parseMsh(meshBuffer),
        modelTexture,
        trailTexture,
      };
    } catch (error) {
      modelTexture.dispose();
      trailTexture.dispose();
      throw error;
    }
  }
}

async function loadBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Falha ao carregar ${url}`);
  return response.arrayBuffer();
}

function configureColorTexture(texture: THREE.Texture, name: string): void {
  texture.name = name;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
}

function deactivateFairy(visual: FairyVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.trailAccumulator = 0;
  visual.followTarget = null;
  visual.model.object.visible = false;
  visual.material.color.setHex(0xffffff);
  visual.material.opacity = 1;
}

function deactivateTrail(visual: TrailVisual): void {
  visual.active = false;
  visual.elapsed = 0;
  visual.sprite.visible = false;
  visual.material.color.setHex(0x000000);
  visual.material.opacity = 1;
}

function disposeFairy(visual: FairyVisual): void {
  visual.model.object.removeFromParent();
  for (const mesh of visual.model.meshes) {
    mesh.skeleton.dispose();
    mesh.geometry.dispose();
  }
  visual.material.dispose();
}

function disposeResources(resources: FairyResources): void {
  resources.modelTexture.dispose();
  resources.trailTexture.dispose();
}

function oldestBySerial<T extends { readonly serial: number }>(values: readonly T[]): T {
  const first = values[0];
  if (!first) throw new Error("Pool visual vazio");
  let oldest = first;
  for (let index = 1; index < values.length; index++) {
    const candidate = values[index];
    if (candidate && candidate.serial < oldest.serial) oldest = candidate;
  }
  return oldest;
}

function isFiniteVector(value: THREE.Vector3): boolean {
  return Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.z);
}
