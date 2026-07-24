import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { parseMsa } from "../../formats/classic/Msa";
import {
  createClassicD3DLocalMatrix,
  type ClassicBaseAttachmentTransform,
  type ClassicSkinnedAnimationSnapshot,
  type ClassicSkinnedCloneAnimationController,
} from "../../render/characters/ClassicSkinnedModel";
import { ClassicSpectralForceWeaponEffect } from "../../render/effects/ClassicSpectralForceWeaponEffect";
import { ClassicDdsTextureLoader } from "../../render/textures/ClassicDdsTextureLoader";
import {
  ClassicSkinnedAssetLibrary,
  type ClassicSkinnedInstanceLease,
} from "../npcs/ClassicSkinnedAssetLibrary";
import { MonsterCatalog } from "../npcs/MonsterCatalog";
import type {
  ClassicEquippedWeaponVisual,
  ClassicPlayerWeaponLoadout,
  ClassicWeaponSide,
} from "./ClassicPlayerWeaponCatalog";
import type { ClassicEquippedMantuaVisual } from "./ClassicPlayerMantuaCatalog";
import {
  classicPlayerClass,
  classicPlayerWeaponForSkin,
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
  readonly side: ClassicWeaponSide;
  readonly object: THREE.Group;
  readonly effectLength: number;
  readonly refinement: ClassicRefinementState | null;
  readonly spectralForce: ClassicSpectralForceWeaponEffect | null;
}

/** World-space copy of the live weapon segment used by fixed-function trails. */
export interface ClassicWeaponEffectSegmentSample {
  side: "left" | "right";
  readonly base: THREE.Vector3;
  readonly tip: THREE.Vector3;
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
  readonly #weapons: readonly ClassicWeaponVisual[];
  readonly #mantua: ClassicSkinnedInstanceLease | null;
  readonly #mantuaDefinition: ClassicEquippedMantuaVisual | null;
  readonly #effectiveSkin: number;
  readonly #boneSampleA = new THREE.Vector3();
  readonly #boneSampleB = new THREE.Vector3();
  #weaponVisible = true;
  #mounted = false;
  #released = false;

  private constructor(
    lease: ClassicSkinnedInstanceLease,
    weapons: readonly ClassicWeaponVisual[],
    mantua: ClassicSkinnedInstanceLease | null,
    mantuaDefinition: ClassicEquippedMantuaVisual | null,
    effectiveSkin: number,
    playerClass: ClassicPlayerClassDefinition,
    look: ClassicPlayerLookDefinition,
  ) {
    this.#lease = lease;
    this.#weapons = weapons;
    this.#mantua = mantua;
    this.#mantuaDefinition = mantuaDefinition;
    this.#effectiveSkin = effectiveSkin;
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
    requestedLook?: string | ClassicPlayerLookDefinition,
    weaponLoadout?: ClassicPlayerWeaponLoadout,
    mantuaDefinition?: ClassicEquippedMantuaVisual | null,
  ): Promise<ClassicPlayerAvatar | null> {
    const playerClass = classicPlayerClass(classKey);
    const look = typeof requestedLook === "object"
      ? requestedLook
      : playerClass.looks.find((candidate) => candidate.key === requestedLook)
        ?? playerClass.looks.find((candidate) => candidate.key === playerClass.defaultLookKey)
        ?? playerClass.selection.look;
    const skin = look.skinOverride ?? playerClass.skin;
    const catalog = await MonsterCatalog.load(assets);
    const library = new ClassicSkinnedAssetLibrary(assets, catalog);
    const lease = await library.createInstance({
      skin,
      parts: look.parts.map((part, index) => ({
        name: `${playerClass.key}-part-${index + 1}`,
        mesh: `player/meshes/${part.meshStem}.msh`,
        texture: `player/textures/${part.textureStem}.dds`,
        alpha: part.alpha,
      })),
      actions: PLAYER_ACTIONS,
      animationWeaponType: weaponLoadout?.animationWeaponType
        ?? playerClass.defaultWeapon.animationWeaponType,
      animationWeaponTypeByAction: Object.fromEntries(
        MOUNTED_PLAYER_ACTIONS.map((action) => [
          action,
          weaponLoadout?.mountedAnimationWeaponType
            ?? playerClass.defaultWeapon.mountedAnimationWeaponType,
        ]),
      ),
      initialAction: "STAND02",
      actionVariant: playerClass.classIndex,
    });
    if (!lease) return null;
    const mantua = mantuaDefinition
      ? await library.createMantuaInstance(
          mantuaDefinition.itemIndex,
          mantuaDefinition.textureIndex,
        ).catch(() => null)
      : null;
    if (mantua && mantuaDefinition) {
      attachClassicPlayerMantua(lease, mantua, skin, mantuaDefinition);
    }
    const weapons = weaponLoadout === undefined
      ? [
          await attachClassicWeapon(
            assets,
            lease,
            classicPlayerWeaponForSkin(playerClass.defaultWeapon, skin),
          ).catch(() => null),
        ].filter((weapon): weapon is ClassicWeaponVisual => weapon !== null)
      : (await Promise.all(
          [weaponLoadout.left, weaponLoadout.right].flatMap((weapon) => (
            weapon
              ? [attachEquippedClassicWeapon(assets, lease, skin, weapon, weaponLoadout.left?.modelType)
                  .catch(() => null)]
              : []
          )),
        )).filter((weapon): weapon is ClassicWeaponVisual => weapon !== null);
    return new ClassicPlayerAvatar(
      lease,
      weapons,
      mantua,
      mantuaDefinition ?? null,
      skin,
      playerClass,
      look,
    );
  }

  setYaw(yaw: number): void {
    if (!this.#released && !this.#mounted) this.#lease.model.setClassicTransform({ yaw });
  }

  /** Attaches the rider to the exact m_OutMatrix bone and Render transform. */
  attachToMount(
    anchor: THREE.Object3D,
    transform: ClassicBaseAttachmentTransform,
    mountSkin?: number,
  ): void {
    if (this.#released) return;
    anchor.add(this.object);
    resetObjectTransform(this.object);
    this.#mounted = true;
    this.#lease.model.setClassicBaseAttachment(transform);
    this.syncMantuaPlacement(mountSkin);
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
    this.syncMantuaPlacement();
  }

  setEffectsEnabled(enabled: boolean): void {
    for (const weapon of this.#weapons) {
      if (weapon.refinement) weapon.refinement.enabled.value = enabled ? 1 : 0;
      weapon.spectralForce?.setEnabled(enabled);
    }
  }

  setWeaponVisible(visible: boolean): void {
    this.#weaponVisible = visible;
    for (const weapon of this.#weapons) weapon.object.visible = visible;
  }

  /** DoubleCritical bit 3 starts SForce type 2 for the equipped WTYPE 101. */
  triggerSpectralForce(): void {
    if (!this.#released && this.#weaponVisible) {
      for (const weapon of this.#weapons) weapon.spectralForce?.trigger();
    }
  }

  sampleWeaponEffectSegments(out: ClassicWeaponEffectSegmentSample[]): number {
    if (this.#released || !this.#weaponVisible) return 0;
    let count = 0;
    for (const weapon of this.#weapons) {
      if (!weapon.object.visible) continue;
      let sample = out[count];
      if (!sample) {
        sample = { side: weapon.side, base: new THREE.Vector3(), tip: new THREE.Vector3() };
        out[count] = sample;
      } else {
        (sample as { side: ClassicWeaponSide }).side = weapon.side;
      }
      weapon.object.updateWorldMatrix(true, false);
      sample.base.set(0, 0, 0).applyMatrix4(weapon.object.matrixWorld);
      // TMEffectSWSwing shortens m_fMaxZ by 0.1 before choosing one of ten slots.
      sample.tip
        .set(0, 0, -Math.max(0, weapon.effectLength - 0.1))
        .applyMatrix4(weapon.object.matrixWorld);
      count++;
    }
    return count;
  }

  /**
   * TMSkillSpChange motion type 10 follows the midpoint of m_vecTempPos[1/2],
   * but keeps the vertical component of bone 1 (the duplicated source operand
   * in the retail client is intentional).
   */
  sampleSpiritChangeWingAnchor(out: THREE.Vector3): THREE.Vector3 {
    if (this.#released) return out.copy(this.object.position);
    const first = this.#lease.model.bones[1];
    const second = this.#lease.model.bones[2];
    if (!first || !second) return this.object.getWorldPosition(out);
    this.object.updateWorldMatrix(true, true);
    first.getWorldPosition(this.#boneSampleA);
    second.getWorldPosition(this.#boneSampleB);
    return out.set(
      (this.#boneSampleA.x + this.#boneSampleB.x) * 0.5,
      this.#boneSampleA.y,
      (this.#boneSampleA.z + this.#boneSampleB.z) * 0.5,
    );
  }

  currentAnimationSnapshot(): ClassicSkinnedAnimationSnapshot | null {
    return this.#released ? null : this.#lease.model.currentAnimationSnapshot();
  }

  createAfterimageAnimationController(
    cloneRoot: THREE.Object3D,
    animation: ClassicSkinnedAnimationSnapshot | null,
  ): ClassicSkinnedCloneAnimationController | null {
    return this.#released
      ? null
      : this.#lease.model.createCloneAnimationController(cloneRoot, animation);
  }

  play(actions: readonly string[], restart = false): ClassicAvatarAction | null {
    if (this.#released) return null;
    for (const name of actions) {
      if (!this.#lease.model.play(name, restart)) continue;
      this.#mantua?.model.play(classicMantuaAction(name, this.#mounted), restart);
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
    this.#mantua?.model.update(deltaSeconds);
    for (const weapon of this.#weapons) {
      // TMMesh::Render(1): (serverTime % 4000) / 4000 is added to U and V.
      const progress = weapon.refinement?.uvProgress;
      if (progress) progress.value = (progress.value + deltaSeconds / 4) % 1;
      weapon.spectralForce?.update(deltaSeconds);
    }
  }

  release(): void {
    if (this.#released) return;
    this.#released = true;
    for (const weapon of this.#weapons) {
      weapon.spectralForce?.dispose();
      disposeStaticGroup(weapon.object);
    }
    this.#mantua?.release();
    this.#lease.release();
  }

  private syncMantuaPlacement(mountSkin?: number): void {
    if (!this.#mantua || !this.#mantuaDefinition) return;
    this.#mantua.model.setClassicBaseAttachment(classicPlayerMantuaTransform(
      this.#effectiveSkin,
      this.#mantuaDefinition,
      mountSkin,
    ));
  }
}

const CLASSIC_PLAYER_MANTUA_LENGTHS = [
  [0.09, 0.08, 0.06, 0.07, 0.08, 0.08, 0.08, 0.065, 0.065, 0.055, 0.055, 0.01, 0.08, 0, 0.02, 0.01, 0.01, 0.035, 0.1, 0.03],
  [0.1, 0.1, 0.1, 0.1, 0.1, 0.08, 0.1, 0.1, 0.1, 0.11, 0.1, 0.08, 0.09, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.08],
  [0.08, 0.06, 0.05, 0.07, 0.05, 0.08, 0.08, 0.05, 0, 0.11, 0.08, 0.06, 0.055, 0, 0, 0, 0, 0, 0.1, 0.01],
  [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.08, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.08],
] as const;

function attachClassicPlayerMantua(
  body: ClassicSkinnedInstanceLease,
  mantua: ClassicSkinnedInstanceLease,
  effectiveSkin: number,
  definition: ClassicEquippedMantuaVisual,
): void {
  const boneIndex = effectiveSkin === 1 ? 6 : 6;
  const anchor = body.model.bones[boneIndex] ?? body.model.object;
  anchor.add(mantua.model.object);
  mantua.model.setClassicBaseAttachment(
    classicPlayerMantuaTransform(effectiveSkin, definition),
  );
}

function classicPlayerMantuaTransform(
  effectiveSkin: number,
  definition: ClassicEquippedMantuaVisual,
  mountSkin?: number,
): ClassicBaseAttachmentTransform {
  let length: number;
  let scale: number;
  let length2: number;
  if (definition.headItemIndex === 22 || definition.headItemIndex === 23) {
    length = 0.07;
    scale = 1.2;
    length2 = -0.2;
  } else if (definition.headItemIndex === 24) {
    length = 0;
    scale = 1.2;
    length2 = 0;
  } else if (definition.headItemIndex === 25) {
    length = 0.01;
    scale = 1;
    length2 = 0.05;
  } else if (definition.headItemIndex === 26) {
    length = 0.07;
    scale = 1.2;
    length2 = 0.05;
  } else {
    const onceReduced = definition.coatMesh < 40
      ? definition.coatMesh
      : definition.coatMesh - 40;
    const coatSlot = onceReduced >= 0 && onceReduced < 20
      ? onceReduced
      : ((definition.coatMesh % 40) + 40) % 40;
    length = CLASSIC_PLAYER_MANTUA_LENGTHS[definition.classRow]?.[coatSlot] ?? 0;
    scale = effectiveSkin === 1 ? 0.9 : 1;
    length2 = 0;
    if (definition.itemIndex >= 3_197 && definition.itemIndex <= 3_199) {
      length = 0.11;
      length2 = 0.05;
    } else if (
      definition.itemIndex === 573
      || definition.itemIndex === 1_767
      || definition.itemIndex === 1_770
    ) {
      length = 0.15;
      length2 = 0.05;
    }
  }
  return {
    length,
    scale,
    length2,
    yaw: -Math.PI / 2,
    pitch: -Math.PI + classicMantuaMountPitchOffset(mountSkin),
  };
}

function classicMantuaMountPitchOffset(skin: number | undefined): number {
  if (skin === 25) return 0.1;
  if (skin === 28 || skin === 31) return 0.15;
  if (skin === 29 || skin === 40) return 0.18;
  if (skin === 39 || skin === 30) return 0.25;
  if (skin === 38) return 0.26;
  if (skin === 20) return 0.5;
  return 0;
}

function classicMantuaAction(bodyAction: string, mounted: boolean): string {
  if (mounted) return "MOUNT";
  if (bodyAction.includes("RUN")) return "RUN";
  if (bodyAction.includes("STAND")) return "STAND01";
  return "WALK";
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
  const effectLength = Math.max(0, -(model.geometry.boundingBox?.min.z ?? 0));
  return { side: "left", object: holder, effectLength, refinement: null, spectralForce: null };
}

async function attachEquippedClassicWeapon(
  assets: ClassicAssetSource,
  lease: ClassicSkinnedInstanceLease,
  skin: number,
  weapon: ClassicEquippedWeaponVisual,
  leftModelType?: number,
): Promise<ClassicWeaponVisual> {
  if (weapon.itemIndex === SKYTALOS_ANCIENT_ITEM_INDEX && weapon.side === "left") {
    return attachSkytalos(assets, lease);
  }
  const source = await assets.loadModel(weapon.modelType);
  if (!source) throw new Error(`Modelo de ${weapon.name} (#${weapon.modelType}) indisponível`);
  const model = parseMsa(source.buffer);
  const loader = new ClassicDdsTextureLoader();
  const textureJobs = new Map<string, Promise<THREE.Texture | null>>();
  const loadTexture = (file: string): Promise<THREE.Texture | null> => {
    let job = textureJobs.get(file);
    if (job) return job;
    job = loader.loadAsync(assets.dataUrl(file)).then((texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      return texture;
    }).catch(() => null);
    textureJobs.set(file, job);
    return job;
  };
  const textures = await Promise.all(source.textures.map((file) => (
    file || weapon.fallbackTexture
      ? loadTexture(file ?? weapon.fallbackTexture!)
      : Promise.resolve(null)
  )));
  const refinement = weapon.ancient && weapon.refinementTextureIndex !== null
    ? await loadWeaponRefinementState(assets, loader, weapon.refinementTextureIndex)
    : null;
  const materialCount = Math.max(1, model.textureNames.length, textures.length);
  const materials = Array.from({ length: materialCount }, (_, index) => {
    const texture = textures[index] ?? textures[0] ?? null;
    const alpha = source.textureAlphas[index]
      ?? source.textureAlphas[0]
      ?? weapon.fallbackAlpha
      ?? "N";
    const material = new THREE.MeshLambertMaterial({
      name: `WYD ${weapon.name}`,
      map: texture,
      color: texture ? 0xffffff : 0x8d8d8d,
      side: THREE.DoubleSide,
      alphaTest: alpha === "N" ? 0 : 0.25,
      transparent: alpha !== "N",
      depthWrite: true,
    });
    if (refinement && texture) configureClassicWeaponRefinement(material, refinement);
    return material;
  });
  const mesh = new THREE.Mesh(model.geometry, materials);
  mesh.name = `weapon-${weapon.side}-${weapon.itemIndex}-${weapon.modelType}`;
  mesh.userData.itemIndex = weapon.itemIndex;
  mesh.userData.weaponType = weapon.weaponType;
  mesh.userData.refinement = weapon.refinement;
  mesh.userData.ancient = weapon.ancient;
  mesh.userData.mirroredFromLeft = weapon.mirroredFromLeft === true;
  mesh.castShadow = true;
  mesh.frustumCulled = false;

  const attachment = classicHandAttachment(
    skin,
    weapon.side,
    weapon.weaponType === 41,
    leftModelType,
  );
  const holder = new THREE.Group();
  holder.name = `${weapon.side}-hand-${weapon.itemIndex}-anchor`;
  holder.matrixAutoUpdate = false;
  holder.matrix.copy(createClassicD3DLocalMatrix(attachment.transform));
  holder.matrixWorldNeedsUpdate = true;
  holder.add(mesh);
  (lease.model.bones[attachment.boneIndex] ?? lease.model.object).add(holder);
  const effectLength = Math.max(0, -(model.geometry.boundingBox?.min.z ?? 0));
  return {
    side: weapon.side,
    object: holder,
    effectLength,
    refinement,
    spectralForce: null,
  };
}

function classicHandAttachment(
  skin: number,
  side: ClassicWeaponSide,
  rotateClaw: boolean,
  leftModelType?: number,
): {
  readonly boneIndex: number;
  readonly transform: Parameters<typeof createClassicD3DLocalMatrix>[0];
} {
  const femaleRig = skin === 1;
  const detail = femaleRig ? 0.07 : 0.1;
  if (side === "right") {
    // CFrame::Render g_dwHandIndex[skin][0]. The shield offset intentionally
    // checks LOOK Mesh7 (the left common mesh) in the retail client.
    const shieldOffset = leftModelType !== undefined
      && leftModelType > 1700
      && leftModelType <= 1800
      ? -0.05
      : 0;
    return {
      boneIndex: femaleRig ? 18 : 19,
      transform: {
        x: -detail,
        y: shieldOffset + 0.01,
        yaw: Math.PI,
      },
    };
  }
  if (rotateClaw) {
    return {
      boneIndex: femaleRig ? 24 : 25,
      transform: {
        x: -detail,
        y: 0.01,
        yaw: Math.PI,
      },
    };
  }
  return {
    boneIndex: femaleRig ? 24 : 25,
    transform: {
      x: -detail,
      y: -0.01,
      yaw: femaleRig ? THREE.MathUtils.degToRad(-15) : 0,
      pitch: femaleRig ? THREE.MathUtils.degToRad(-10) : 0,
      roll: Math.PI,
    },
  };
}

async function loadWeaponRefinementState(
  assets: ClassicAssetSource,
  loader: ClassicDdsTextureLoader,
  textureIndex: number,
): Promise<ClassicRefinementState | null> {
  const url = assets.effectTextureUrl(textureIndex);
  if (!url) return null;
  return loader.loadAsync(url).then((texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    return {
      texture,
      enabled: { value: 1 },
      uvProgress: { value: 0 },
    };
  }).catch(() => null);
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
  return {
    side: "left",
    object: holder,
    effectLength: classicMaxZ,
    refinement,
    spectralForce,
  };
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
  configureClassicWeaponRefinement(material, refinement);
  return material;
}

function configureClassicWeaponRefinement(
  material: THREE.MeshLambertMaterial,
  refinement: ClassicRefinementState,
): void {
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
  material.customProgramCacheKey = () => "wyd-classic-weapon-refinement-v3";
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
