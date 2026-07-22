import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { parseAni, type AniAnimation } from "../../formats/classic/Ani";
import type {
  ClassicSkinnedAnimationSnapshot,
  ClassicSkinnedCloneAnimationController,
} from "../../render/characters/ClassicSkinnedModel";
import { ClassicDdsTextureLoader } from "../../render/textures/ClassicDdsTextureLoader";
import {
  ClassicSkinnedAssetLibrary,
  type ClassicSkinnedInstanceLease,
} from "../npcs/ClassicSkinnedAssetLibrary";
import { MonsterCatalog } from "../npcs/MonsterCatalog";
import {
  DEFAULT_MOUNT_LOOK_KEY,
  mountLook,
  type ClassicMountAlphaMode,
  type ClassicMountLookDefinition,
} from "./MountLooks";

const MOUNT_LEVEL_EFFECT_TEXTURE = 452;
const MOUNT_ACTIONS = [
  "STAND01", "WALK", "RUN", "ATTACK1", "ATTACK2", "SKILL01",
  "STRIKE", "DIE", "DEAD", "LEVELUP",
] as const;

interface MountLevelEffect {
  readonly texture: THREE.Texture;
  readonly enabled: { value: number };
  readonly uvProgress: { value: number };
}

interface MountFlightMotion {
  readonly animation: AniAnimation;
  readonly boneSlot: number;
  readonly baselineZ: number;
  readonly modelScale: number;
  readonly quarterStepSeconds: number;
}

/** Mount-owned #88 clip plus the only value copied from the rider. */
export interface ClassicMountAfterimageAnimationSnapshot {
  readonly animation: ClassicSkinnedAnimationSnapshot;
  readonly riderQuarterStepMs: number;
}

/** A real classic mount model kept loaded and toggled without another hitch. */
export class ClassicMount {
  readonly object: THREE.Group;
  readonly riderAnchor = new THREE.Group();
  readonly name: string;
  readonly look: ClassicMountLookDefinition;
  readonly #lease: ClassicSkinnedInstanceLease;
  readonly #levelEffect: MountLevelEffect | null;
  readonly #flightMotion: MountFlightMotion | null;
  #action: string | null = null;
  #moving = false;
  #flightElapsed = 0;
  #flightHeight = 0;
  #released = false;

  private constructor(
    lease: ClassicSkinnedInstanceLease,
    look: ClassicMountLookDefinition,
    levelEffect: MountLevelEffect | null,
    flightMotion: MountFlightMotion | null,
  ) {
    this.#lease = lease;
    this.#levelEffect = levelEffect;
    this.#flightMotion = flightMotion;
    this.look = look;
    this.name = `${look.name} Lv. ${look.level}`;
    this.object = lease.model.object;
    this.object.name = `classic-mount-${look.key}`;
    this.object.userData.itemIndex = look.itemIndex;
    this.object.userData.visualItemIndex = look.visualItemIndex;
    this.object.userData.meshIndex = look.meshIndex;
    this.object.userData.skin = look.skin;
    this.object.userData.level = look.level;
    this.object.userData.refinement = look.level / 10;
    this.riderAnchor.name = `${look.key}-classic-seat-bone-${look.seatBone}`;
    (lease.model.bones[look.seatBone] ?? lease.model.object).add(this.riderAnchor);
    lease.model.setClassicTransform({
      yaw: -Math.PI / 2,
      scale: 0.9 * look.mountScale,
      mirrorModelZ: true,
    });
    this.play(["STAND01"]);
  }

  static async load(
    assets: ClassicAssetSource,
    lookKey = DEFAULT_MOUNT_LOOK_KEY,
  ): Promise<ClassicMount | null> {
    const look = mountLook(lookKey);
    const catalog = await MonsterCatalog.load(assets);
    const library = new ClassicSkinnedAssetLibrary(assets, catalog);
    const lease = await library.createInstance({
      skin: look.skin,
      family: look.family.visual,
      parts: look.parts.map((part, index) => ({
        name: `${look.key}-part-${index + 1}-${part.name}`,
        mesh: `player/mounts/${look.family.base}/${part.meshStem}.msh`,
        texture: `player/mounts/${look.family.base}/${part.textureStem}.dds`,
        alpha: part.alpha,
      })),
      actions: MOUNT_ACTIONS,
      initialAction: "STAND01",
    });
    if (!lease) return null;
    const levelEffect = await loadMountLevelEffect(
      assets,
      lease,
      look,
    ).catch(() => null);
    // The Griffin and Red Dragon rigs have different bone layouts, so copying
    // dr02's complete RUN clip would deform bd02. Only the authored vertical
    // root channel is transferable. This reproduces the Red Dragon's take-off
    // curve while Griffin keeps its own wings/legs animation.
    const flightMotion = look.key === "grifo"
      ? await loadRedDragonFlightMotion(assets).catch(() => null)
      : null;
    return new ClassicMount(lease, look, levelEffect, flightMotion);
  }

  setYaw(yaw: number): void {
    if (!this.#released) this.#lease.model.setClassicTransform({ yaw });
  }

  setMoving(moving: boolean): void {
    if (moving !== this.#moving) {
      this.#moving = moving;
      if (moving) this.#flightElapsed = 0;
    }
    this.play(moving ? ["RUN", "WALK"] : ["STAND01"]);
  }

  playIdle(restart = false): void {
    this.play(["STAND01"], restart);
  }

  playAttack(): void {
    this.play(["ATTACK1", "ATTACK2"], true);
  }

  playSkill(): void {
    this.play(["SKILL01", "ATTACK1"], true);
  }

  playHit(): void {
    this.play(["STRIKE"], true);
  }

  playDeath(): void {
    this.play(["DIE", "DEAD"], true);
  }

  playLevelUp(): void {
    this.#moving = false;
    this.play(["LEVELUP", "STAND01"], true);
  }

  setEffectsEnabled(enabled: boolean): void {
    if (this.#levelEffect) this.#levelEffect.enabled.value = enabled ? 1 : 0;
  }

  /**
   * TMHuman passes the caster animation index to the new mount TMSkinMesh.
   * Huntress MATT3 resolves to index 99, outside hs01's ten clips, therefore
   * SetAnimation leaves the new mount on index 0 (STAND01). Only m_dwFPS is
   * then copied from the rider; ch02 ANI matrices never animate the mount rig.
   */
  captureShadowBladeAnimation(
    riderAnimation: ClassicSkinnedAnimationSnapshot | null,
  ): ClassicMountAfterimageAnimationSnapshot | null {
    if (this.#released || !riderAnimation) return null;
    const animation = this.#lease.model.animationSnapshot("STAND01");
    return animation
      ? Object.freeze({
        animation,
        riderQuarterStepMs: riderAnimation.quarterStepMs,
      })
      : null;
  }

  createAfterimageAnimationController(
    cloneRoot: THREE.Object3D,
    snapshot: ClassicMountAfterimageAnimationSnapshot | null,
  ): ClassicSkinnedCloneAnimationController | null {
    return this.#released || !snapshot
      ? null
      : this.#lease.model.createCloneAnimationController(
        cloneRoot,
        snapshot.animation,
        snapshot.riderQuarterStepMs,
      );
  }

  update(deltaSeconds: number): void {
    if (this.#released) return;
    this.#lease.model.update(deltaSeconds);
    this.updateFlightMotion(deltaSeconds);
    if (this.#levelEffect) {
      // CMesh's skin shader feeds (serverTime % 10000) / 10000 to UV2.
      const progress = this.#levelEffect.uvProgress;
      progress.value = (progress.value + deltaSeconds / 10) % 1;
    }
  }

  release(): void {
    if (this.#released) return;
    this.#released = true;
    this.riderAnchor.clear();
    this.#lease.release();
    this.#levelEffect?.texture.dispose();
  }

  private play(actions: readonly string[], restart = false): void {
    if (this.#released || (!restart && this.#action !== null && actions.includes(this.#action))) return;
    for (const action of actions) {
      if (!this.#lease.model.play(action, restart)) continue;
      this.#action = action;
      return;
    }
  }

  private updateFlightMotion(deltaSeconds: number): void {
    const motion = this.#flightMotion;
    if (!motion) return;

    let targetHeight = 0;
    if (this.#moving) {
      this.#flightElapsed += deltaSeconds;
      const progress = sampleAnimationComponent(
        motion.animation,
        motion.boneSlot,
        14,
        this.#flightElapsed,
        motion.quarterStepSeconds,
      );
      targetHeight = Math.max(0, progress - motion.baselineZ) * motion.modelScale;
    }

    // The old client smooths flying-mount height corrections instead of
    // snapping them to the terrain. An exponential response keeps that same
    // short take-off/landing transition independent of the display refresh.
    const response = 1 - Math.exp(-Math.max(0, deltaSeconds) * 11);
    this.#flightHeight += (targetHeight - this.#flightHeight) * response;
    if (!this.#moving && Math.abs(this.#flightHeight) < 0.001) this.#flightHeight = 0;
    this.object.position.y = this.#flightHeight;
  }
}

async function loadMountLevelEffect(
  assets: ClassicAssetSource,
  lease: ClassicSkinnedInstanceLease,
  look: ClassicMountLookDefinition,
): Promise<MountLevelEffect | null> {
  const url = assets.effectTextureUrl(MOUNT_LEVEL_EFFECT_TEXTURE);
  if (!url) return null;
  const texture = await new ClassicDdsTextureLoader().loadAsync(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  const effect: MountLevelEffect = {
    texture,
    enabled: { value: 1 },
    uvProgress: { value: 0 },
  };
  const materials = new Map<THREE.MeshLambertMaterial, ClassicMountAlphaMode>();
  for (const partIndex of look.refinementParts) {
    const mesh = lease.model.meshes[partIndex];
    if (!mesh) continue;
    const alpha = look.parts[partIndex]?.alpha ?? "N";
    const entries = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of entries) {
      if (material instanceof THREE.MeshLambertMaterial) materials.set(material, alpha);
    }
  }
  for (const [material, alpha] of materials) applyMountLevelMaterial(material, effect, alpha);
  return effect;
}

function applyMountLevelMaterial(
  material: THREE.MeshLambertMaterial,
  effect: MountLevelEffect,
  alpha: ClassicMountAlphaMode,
): void {
  material.userData.classicMountLevelEffect = effect;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.wydMountLevelMap = { value: effect.texture };
    shader.uniforms.wydMountLevelEnabled = effect.enabled;
    shader.uniforms.wydMountLevelUvProgress = effect.uvProgress;
    const combine = alpha === "C"
      // D3DTOP_MODULATEALPHA_ADDCOLOR with ARG1=CURRENT/ARG2=TEXTURE.
      ? `min(wydMountBase + diffuseColor.a * wydMountLevel, vec3(1.0))`
      // D3DTOP_ADDSMOOTH: Arg1 + Arg2 - Arg1 * Arg2.
      : `wydMountBase + wydMountLevel - (wydMountBase * wydMountLevel)`;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <map_pars_fragment>",
        `#include <map_pars_fragment>
        uniform sampler2D wydMountLevelMap;
        uniform float wydMountLevelEnabled;
        uniform float wydMountLevelUvProgress;`,
      )
      .replace(
        "#include <opaque_fragment>",
        `#ifdef USE_MAP
          vec2 wydMountUv = vMapUv + vec2(wydMountLevelUvProgress);
          vec3 wydMountLevel = texture2D(wydMountLevelMap, wydMountUv).rgb;
          // skinmesh*.bin clamps the classic per-vertex light to 1.0 before
          // texture stage 0 executes MODULATE2X. Three's current Armia lights
          // intentionally exceed 1.0, so applying the 2x operation directly
          // to outgoingLight washes the animated refinement into solid yellow.
          // Recover the light term from the lit/base colors, keep the client's
          // 0.3 emissive floor, then perform the fixed-function operation.
          vec3 wydMountSafeDiffuse = max(diffuseColor.rgb, vec3(0.0001));
          vec3 wydMountClassicLight = clamp(
            outgoingLight / wydMountSafeDiffuse,
            vec3(0.3),
            vec3(1.0)
          );
          vec3 wydMountBase = min(
            diffuseColor.rgb * wydMountClassicLight * 2.0,
            vec3(1.0)
          );
          vec3 wydMountRefined = ${combine};
          outgoingLight = mix(outgoingLight, wydMountRefined, wydMountLevelEnabled);
        #endif
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => `wyd-mount-level120-multitexture-v4-${alpha}`;
  material.needsUpdate = true;
}

async function loadRedDragonFlightMotion(
  assets: ClassicAssetSource,
): Promise<MountFlightMotion | null> {
  const [idleResponse, runResponse] = await Promise.all([
    fetch(assets.dataUrl("player/mounts/dr02/dr020101.ani")),
    fetch(assets.dataUrl("player/mounts/dr02/dr020107.ani")),
  ]);
  if (!idleResponse.ok || !runResponse.ok) return null;
  const [idle, animation] = await Promise.all([
    idleResponse.arrayBuffer().then(parseAni),
    runResponse.arrayBuffer().then(parseAni),
  ]);
  const boneSlot = 3;
  if (idle.boneSlotCount <= boneSlot || animation.boneSlotCount <= boneSlot) return null;
  let baselineZ = 0;
  for (let tick = 0; tick < idle.tickCount; tick++) {
    baselineZ += idle.matrices[(tick * idle.boneSlotCount + boneSlot) * 16 + 14] ?? 0;
  }
  baselineZ /= idle.tickCount;
  return {
    animation,
    boneSlot,
    baselineZ,
    // TMSkinMesh::Render draws mounts at 0.9 * BASE_GetMountScale.
    modelScale: 0.9,
    // dr02 RUN uses dwSpeed=20 and the client interpolates four substeps/tick.
    quarterStepSeconds: 0.02,
  };
}

function sampleAnimationComponent(
  animation: AniAnimation,
  boneSlot: number,
  component: number,
  elapsedSeconds: number,
  quarterStepSeconds: number,
): number {
  const totalSubsteps = animation.tickCount * 4;
  const exactSubstep = elapsedSeconds / quarterStepSeconds;
  const wrapped = ((exactSubstep % totalSubsteps) + totalSubsteps) % totalSubsteps;
  const tick = Math.floor(wrapped / 4);
  const fraction = (wrapped - tick * 4) * 0.25;
  const nextTick = (tick + 1) % animation.tickCount;
  const first = (tick * animation.boneSlotCount + boneSlot) * 16 + component;
  const second = (nextTick * animation.boneSlotCount + boneSlot) * 16 + component;
  const a = animation.matrices[first] ?? 0;
  const b = animation.matrices[second] ?? a;
  return a + (b - a) * fraction;
}
