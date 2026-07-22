import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { parseMsa } from "../../formats/classic/Msa";
import {
  createClassicD3DLocalMatrix,
  type ClassicBaseAttachmentTransform,
} from "../../render/characters/ClassicSkinnedModel";
import { ClassicSpectralForceWeaponEffect } from "../../render/effects/ClassicSpectralForceWeaponEffect";
import { ClassicDdsTextureLoader } from "../../render/textures/ClassicDdsTextureLoader";
import {
  ClassicSkinnedAssetLibrary,
  type ClassicSkinnedInstanceLease,
} from "../npcs/ClassicSkinnedAssetLibrary";
import { MonsterCatalog } from "../npcs/MonsterCatalog";
import {
  classicPlayerClass,
  type ClassicPlayerClassDefinition,
  type ClassicPlayerClassKey,
  type ClassicPlayerLookDefinition,
  type ClassicPlayerWeaponDefinition,
} from "./PlayerClasses";

const PLAYER_ACTIONS = [
  "STAND01", "STAND02", "WALK", "RUN", "ATTACK1", "ATTACK2", "ATTACK3",
  "SKILL01", "SKILL02", "SKILL03", "STRIKE", "DIE", "DEAD", "MERCHL", "HOLY",
  "LEVELUP",
  "MSTND01", "MWALK", "MRUN", "MATT1", "MATT2", "MATT3",
  "MSKIL01", "MSKIL02", "MSKIL03", "MSTRIKE", "MDIE", "MDEAD",
  "MMERCHL", "MHOLY", "MLVLUP",
] as const;

const MOUNTED_PLAYER_ACTIONS = PLAYER_ACTIONS.filter((action) => action.startsWith("M"));

const SKYTALOS_ANCIENT_ITEM_INDEX = 2551;
const SKYTALOS_REFINEMENT = 15;
const SKYTALOS_REFINEMENT_TEXTURE = 165;

interface ClassicRefinementState {
  readonly texture: THREE.Texture;
  readonly enabled: { value: number };
  readonly uvProgress: { value: number };
}

interface ClassicWeaponVisual {
  readonly object: THREE.Group;
  readonly refinement: ClassicRefinementState | null;
  readonly spectralForce: ClassicSpectralForceWeaponEffect | null;
}

export interface ClassicAvatarAction {
  readonly name: string;
  readonly durationSeconds: number;
}

export class ClassicPlayerAvatar {
  readonly object: THREE.Group;
  readonly templateKey: string;
  readonly playerClass: ClassicPlayerClassDefinition;
  readonly look: ClassicPlayerLookDefinition;
  readonly #lease: ClassicSkinnedInstanceLease;
  readonly #weapon: ClassicWeaponVisual | null;
  #weaponVisible = true;
  #mounted = false;
  #released = false;

  private constructor(
    lease: ClassicSkinnedInstanceLease,
    weapon: ClassicWeaponVisual | null,
    playerClass: ClassicPlayerClassDefinition,
    look: ClassicPlayerLookDefinition,
  ) {
    this.#lease = lease;
    this.#weapon = weapon;
    this.playerClass = playerClass;
    this.look = look;
    this.templateKey = `${playerClass.name}_${look.key}_${playerClass.defaultWeapon.key}`;
    this.object = lease.model.object;
    this.object.name = `classic-player-${playerClass.key}-${look.key}-${playerClass.defaultWeapon.key}`;
    lease.model.setClassicTransform({
      yaw: -Math.PI / 2,
      scale: 0.9,
      mirrorModelZ: true,
    });
  }

  static async load(
    assets: ClassicAssetSource,
    classKey: ClassicPlayerClassKey = "huntress",
    lookKey?: string,
  ): Promise<ClassicPlayerAvatar | null> {
    const playerClass = classicPlayerClass(classKey);
    const look = playerClass.looks.find((candidate) => candidate.key === lookKey)
      ?? playerClass.looks.find((candidate) => candidate.key === playerClass.defaultLookKey)
      ?? playerClass.selection.look;
    const catalog = await MonsterCatalog.load(assets);
    const library = new ClassicSkinnedAssetLibrary(assets, catalog);
    const lease = await library.createInstance({
      skin: playerClass.skin,
      parts: look.parts.map((part, index) => ({
        name: `${playerClass.key}-part-${index + 1}`,
        mesh: `player/meshes/${part.meshStem}.msh`,
        texture: `player/textures/${part.textureStem}.dds`,
        alpha: part.alpha,
      })),
      actions: PLAYER_ACTIONS,
      animationWeaponType: playerClass.defaultWeapon.animationWeaponType,
      animationWeaponTypeByAction: Object.fromEntries(
        MOUNTED_PLAYER_ACTIONS.map((action) => [
          action,
          playerClass.defaultWeapon.mountedAnimationWeaponType,
        ]),
      ),
      initialAction: "STAND02",
      actionVariant: playerClass.classIndex,
    });
    if (!lease) return null;
    const weapon = await attachClassicWeapon(assets, lease, playerClass.defaultWeapon).catch(() => null);
    return new ClassicPlayerAvatar(lease, weapon, playerClass, look);
  }

  setYaw(yaw: number): void {
    if (!this.#released && !this.#mounted) this.#lease.model.setClassicTransform({ yaw });
  }

  /** Attaches the rider to the exact m_OutMatrix bone and Render transform. */
  attachToMount(
    anchor: THREE.Object3D,
    transform: ClassicBaseAttachmentTransform,
  ): void {
    if (this.#released) return;
    anchor.add(this.object);
    resetObjectTransform(this.object);
    this.#mounted = true;
    this.#lease.model.setClassicBaseAttachment(transform);
  }

  attachOnFoot(parent: THREE.Object3D, yaw: number): void {
    if (this.#released) return;
    parent.add(this.object);
    resetObjectTransform(this.object);
    this.#mounted = false;
    this.#lease.model.setClassicTransform({
      yaw,
      scale: 0.9,
      mirrorModelZ: true,
    });
  }

  setEffectsEnabled(enabled: boolean): void {
    if (!this.#weapon) return;
    if (this.#weapon.refinement) this.#weapon.refinement.enabled.value = enabled ? 1 : 0;
    this.#weapon.spectralForce?.setEnabled(enabled);
  }

  setWeaponVisible(visible: boolean): void {
    this.#weaponVisible = visible;
    if (this.#weapon) this.#weapon.object.visible = visible;
  }

  /** DoubleCritical bit 3 starts SForce type 2 for the equipped WTYPE 101. */
  triggerSpectralForce(): void {
    if (!this.#released && this.#weaponVisible) this.#weapon?.spectralForce?.trigger();
  }

  play(actions: readonly string[], restart = false): ClassicAvatarAction | null {
    if (this.#released) return null;
    for (const name of actions) {
      if (!this.#lease.model.play(name, restart)) continue;
      return {
        name,
        durationSeconds: this.#lease.actionDurationSeconds(name) ?? 0,
      };
    }
    return null;
  }

  update(deltaSeconds: number): void {
    if (this.#released) return;
    this.#lease.model.update(deltaSeconds);
    if (this.#weapon) {
      // TMMesh::Render(1): (serverTime % 4000) / 4000 is added to U and V.
      const progress = this.#weapon.refinement?.uvProgress;
      if (progress) progress.value = (progress.value + deltaSeconds / 4) % 1;
      this.#weapon.spectralForce?.update(deltaSeconds);
    }
  }

  release(): void {
    if (this.#released) return;
    this.#released = true;
    if (this.#weapon) {
      this.#weapon.spectralForce?.dispose();
      disposeStaticGroup(this.#weapon.object);
    }
    this.#lease.release();
  }
}

async function attachClassicWeapon(
  assets: ClassicAssetSource,
  lease: ClassicSkinnedInstanceLease,
  weapon: ClassicPlayerWeaponDefinition,
): Promise<ClassicWeaponVisual> {
  if (weapon.key === "skytalos-ancient") return attachSkytalos(assets, lease);
  const meshResponse = await fetch(assets.dataUrl(`player/meshes/${weapon.meshStem}.msa`));
  if (!meshResponse.ok) throw new Error(`MSA de ${weapon.name} indisponível`);
  const model = parseMsa(await meshResponse.arrayBuffer());
  const texture = await new ClassicDdsTextureLoader().loadAsync(
    assets.dataUrl(`player/textures/${weapon.textureStem}.dds`),
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const materials = Array.from({ length: Math.max(1, model.textureNames.length) }, () => (
    new THREE.MeshLambertMaterial({
      name: `WYD ${weapon.name}`,
      map: texture,
      side: THREE.DoubleSide,
      alphaTest: weapon.alpha === "C" ? 0 : 0.25,
    })
  ));
  const mesh = new THREE.Mesh(model.geometry, materials);
  mesh.name = `weapon-${weapon.key}-${weapon.itemIndex}`;
  mesh.userData.itemIndex = weapon.itemIndex;
  mesh.userData.weaponType = weapon.weaponType;
  mesh.userData.refinement = 9;
  mesh.userData.ancient = true;
  mesh.castShadow = true;
  mesh.frustumCulled = false;

  const attachment = weapon.attachment;
  const holder = new THREE.Group();
  holder.name = `${weapon.key}-left-hand-anchor`;
  holder.matrixAutoUpdate = false;
  holder.matrix.copy(createClassicD3DLocalMatrix({
    x: attachment.x,
    y: attachment.y,
    z: attachment.z,
    yaw: THREE.MathUtils.degToRad(attachment.yawDegrees),
    pitch: THREE.MathUtils.degToRad(attachment.pitchDegrees),
    roll: THREE.MathUtils.degToRad(attachment.rollDegrees),
  }));
  holder.matrixWorldNeedsUpdate = true;
  holder.add(mesh);
  (lease.model.bones[attachment.boneIndex] ?? lease.model.object).add(holder);
  return { object: holder, refinement: null, spectralForce: null };
}

function resetObjectTransform(object: THREE.Object3D): void {
  object.position.set(0, 0, 0);
  object.rotation.set(0, 0, 0);
  object.scale.set(1, 1, 1);
  object.updateMatrix();
}

async function attachSkytalos(
  assets: ClassicAssetSource,
  lease: ClassicSkinnedInstanceLease,
): Promise<ClassicWeaponVisual> {
  const meshResponse = await fetch(assets.dataUrl("player/meshes/bow16.msa"));
  if (!meshResponse.ok) throw new Error("MSA do Skytalos indisponível");
  const model = parseMsa(await meshResponse.arrayBuffer());
  const refinementUrl = assets.effectTextureUrl(SKYTALOS_REFINEMENT_TEXTURE);
  if (!refinementUrl) throw new Error("Multitextura +15 do Skytalos indisponível");
  const loader = new ClassicDdsTextureLoader();
  const [texture, refinementTexture] = await Promise.all([
    loader.loadAsync(assets.dataUrl("player/textures/bow16.dds")),
    loader.loadAsync(refinementUrl),
  ]);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  refinementTexture.colorSpace = THREE.SRGBColorSpace;
  refinementTexture.anisotropy = 4;
  refinementTexture.wrapS = THREE.RepeatWrapping;
  refinementTexture.wrapT = THREE.RepeatWrapping;
  refinementTexture.needsUpdate = true;
  const refinement: ClassicRefinementState = {
    texture: refinementTexture,
    enabled: { value: 1 },
    uvProgress: { value: 0 },
  };
  const materials = Array.from({ length: Math.max(1, model.textureNames.length) }, () => (
    createSkytalosMaterial(texture, refinement)
  ));
  const bow = new THREE.Mesh(model.geometry, materials);
  bow.name = `weapon-skytalos-ancient-${SKYTALOS_ANCIENT_ITEM_INDEX}-plus-${SKYTALOS_REFINEMENT}`;
  bow.userData.itemIndex = SKYTALOS_ANCIENT_ITEM_INDEX;
  bow.userData.baseItemIndex = 826;
  bow.userData.refinement = SKYTALOS_REFINEMENT;
  bow.userData.refinementTexture = SKYTALOS_REFINEMENT_TEXTURE;
  bow.userData.ancient = true;
  bow.castShadow = true;
  bow.frustumCulled = false;

  // Equip[6] is copied into HUMAN_LOOKINFO::LeftMesh, whose struct position is
  // Mesh7. TMSkinMesh attaches part 7 to g_dwHandIndex[1][1] (bone 24).
  // CFrame then composes T(-.07, -.01, 0) * YPR(-15deg, -10deg, 180deg).
  const holder = new THREE.Group();
  holder.name = "left-hand-skytalos-anchor";
  holder.matrixAutoUpdate = false;
  holder.matrix.copy(createClassicD3DLocalMatrix({
    x: -0.07,
    y: -0.01,
    yaw: THREE.MathUtils.degToRad(-15),
    pitch: THREE.MathUtils.degToRad(-10),
    roll: Math.PI,
  }));
  holder.matrixWorldNeedsUpdate = true;
  holder.add(bow);
  // TMHuman copies TMMesh::m_fMaxZ into m_fSowrdLength. parseMsa mirrors the
  // classic Z axis, so the original positive max is the negated Three min.
  const classicMaxZ = Math.max(0, -(model.geometry.boundingBox?.min.z ?? 0));
  const spectralForce = await ClassicSpectralForceWeaponEffect
    .load(assets, classicMaxZ)
    .catch((error: unknown) => {
      console.warn("Força Espectral clássica indisponível", error);
      return null;
    });
  if (spectralForce) holder.add(spectralForce.object);
  (lease.model.bones[24] ?? lease.model.object).add(holder);
  return { object: holder, refinement, spectralForce };
}

function createSkytalosMaterial(
  baseTexture: THREE.Texture,
  refinement: ClassicRefinementState,
): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({
    name: "WYD Skytalos Ancient +15",
    map: baseTexture,
    side: THREE.DoubleSide,
    alphaTest: 0.25,
  });
  material.userData.classicRefinement = refinement;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.wydRefinementMap = { value: refinement.texture };
    shader.uniforms.wydRefinementEnabled = refinement.enabled;
    shader.uniforms.wydRefinementUvProgress = refinement.uvProgress;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <map_pars_fragment>",
        `#include <map_pars_fragment>
        uniform sampler2D wydRefinementMap;
        uniform float wydRefinementEnabled;
        uniform float wydRefinementUvProgress;`,
      )
      .replace(
        "#include <opaque_fragment>",
        `#ifdef USE_MAP
          vec2 wydRefinementUv = vMapUv + vec2(wydRefinementUvProgress);
          vec3 wydRefinement = texture2D(wydRefinementMap, wydRefinementUv).rgb;
          vec3 wydRefinedBase = min(outgoingLight * 2.0, vec3(1.0));
          vec3 wydRefinedColor = wydRefinedBase + wydRefinement
            - (wydRefinedBase * wydRefinement);
          outgoingLight = mix(outgoingLight, wydRefinedColor, wydRefinementEnabled);
        #endif
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => "wyd-skytalos-ancient-plus15-v2";
  return material;
}

function disposeStaticGroup(group: THREE.Group): void {
  const textures = new Set<THREE.Texture>();
  group.removeFromParent();
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Points)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      const textured = material as THREE.Material & { map?: THREE.Texture | null };
      if (textured.map) textures.add(textured.map);
      const refinement = material.userData.classicRefinement as ClassicRefinementState | undefined;
      if (refinement) textures.add(refinement.texture);
      material.dispose();
    }
  });
  for (const texture of textures) texture.dispose();
}
