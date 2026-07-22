import * as THREE from "three";
import type { AniAnimation } from "../../formats/classic/Ani";
import type { BonSkeleton } from "../../formats/classic/Bon";
import type { MshModel } from "../../formats/classic/Msh";

const D3D_TO_THREE_NEGATIVE_COMPONENTS = new Set([2, 6, 8, 9, 11, 14]);

export interface ClassicMatrixClip {
  readonly name: string;
  readonly animation: AniAnimation;
  /**
   * Milliseconds per interpolation quarter-step from AniSound4.txt.
   * A source ANI tick therefore lasts `quarterStepMs * 4`.
   */
  readonly quarterStepMs?: number;
  readonly loop?: boolean;
}

export interface ClassicSkinnedPart {
  readonly name?: string;
  readonly model: MshModel;
  readonly material: THREE.Material;
}

/** Immutable CPU-side clip reference safe to reuse in a short-lived clone. */
export interface ClassicSkinnedAnimationSnapshot {
  readonly name: string;
  readonly animation: AniAnimation;
  readonly quarterStepMs: number;
  readonly loop: boolean;
}

export interface ClassicSkinnedCloneAnimationController {
  /** Advances a private clock; it never reads the live actor pose again. */
  update(deltaSeconds: number): void;
  /** Applies the original TMSkinMesh yaw transform to the cloned basis. */
  setClassicYaw(yaw: number): void;
}

export interface ClassicSkinnedModelOptions {
  readonly skeleton: BonSkeleton;
  readonly parts: readonly ClassicSkinnedPart[];
  readonly clips?: readonly ClassicMatrixClip[];
  readonly initialClip?: string;
  /** Regular monsters/characters use the old client's Z mirror. */
  readonly mirrorModelZ?: boolean;
  /** Bone types 45-57 use a different base-axis branch in TMSkinMesh. */
  readonly axisMode?: "standard" | "late";
}

export interface ClassicTransform {
  /** Classic logical yaw, in radians (the value stored in m_vAngle.y). */
  readonly yaw?: number;
  /** Classic model pitch, in radians (the value stored in m_vAngle.x). */
  readonly pitch?: number;
  readonly roll?: number;
  readonly scale?: number | Readonly<THREE.Vector3>;
  readonly mirrorModelZ?: boolean;
  readonly axisMode?: "standard" | "late";
}

export interface ClassicD3DLocalTransform {
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  readonly yaw?: number;
  readonly pitch?: number;
  readonly roll?: number;
}

export interface ClassicBaseAttachmentTransform {
  /** First argument passed to TMSkinMesh::Render (translated on classic Y). */
  readonly length: number;
  /** Second argument passed to TMSkinMesh::Render. */
  readonly scale: number;
  /** Third argument passed to TMSkinMesh::Render (translated on classic X). */
  readonly length2: number;
  /** Rotation stored in m_matMantua before the Render translation. */
  readonly yaw: number;
  readonly pitch: number;
  readonly roll?: number;
}

/**
 * Builds a Three.js local matrix from the row-vector transform used by D3DX.
 * CFrame composes hand offsets as Translation * YawPitchRoll, so expressing
 * that operation here avoids lossy Euler-order guesses at attachment sites.
 */
export function createClassicD3DLocalMatrix(
  transform: ClassicD3DLocalTransform,
): THREE.Matrix4 {
  const translation = rowTranslation(
    transform.x ?? 0,
    transform.y ?? 0,
    transform.z ?? 0,
  );
  const rotation = d3dYawPitchRoll(
    transform.yaw ?? 0,
    transform.pitch ?? 0,
    transform.roll ?? 0,
  );
  const result = new THREE.Matrix4();
  setConvertedD3DMatrix(result, rowMultiply(translation, rotation));
  return result;
}

/**
 * Live Three.js instance of a classic BON + ANI + one-or-more MSH parts.
 *
 * Every MSH part receives its own Skeleton because inverse-bind matrices are
 * stored per MSH. The Skeleton objects share the same Bone nodes, which keeps
 * multipart monsters exact without baking one part's offsets into another.
 */
export class ClassicSkinnedModel {
  readonly object = new THREE.Group();
  readonly meshes: readonly THREE.SkinnedMesh[];
  /** Frames resolved by CFrame::FindFrame for MSH palette ids. */
  readonly bones: readonly THREE.Bone[];
  /** Targets of ANI slots (m_pframeToAnimate), including the distinct slot 0. */
  readonly animationBones: readonly THREE.Bone[];
  /** The unanimated CFrame(0) created before the BON records are loaded. */
  readonly syntheticRoot: THREE.Bone;

  readonly #basis = new THREE.Group();
  readonly #rig = new THREE.Group();
  readonly #clips = new Map<string, ClassicSkinnedAnimationSnapshot>();
  #currentClip: ClassicSkinnedAnimationSnapshot | null = null;
  #elapsedMilliseconds = 0;
  #axisMode: "standard" | "late";
  #mirrorModelZ: boolean;
  #yaw = 0;
  #pitch = 0;
  #roll = 0;
  #scale = new THREE.Vector3(1, 1, 1);

  constructor(options: ClassicSkinnedModelOptions) {
    if (options.parts.length === 0) throw new Error("Modelo skinned sem partes MSH");

    this.object.name = "classic-skinned-model";
    this.#basis.name = "classic-model-basis";
    this.#basis.matrixAutoUpdate = false;
    this.#rig.name = "classic-skeleton-root";
    this.object.add(this.#basis);
    this.#basis.add(this.#rig);

    this.#axisMode = options.axisMode ?? "standard";
    this.#mirrorModelZ = options.mirrorModelZ ?? true;

    const slotCount = requiredBoneSlotCount(options);
    const animationBones = Array.from({ length: slotCount }, (_, id) => {
      const bone = new THREE.Bone();
      bone.name = id === 0 ? "animation-bone-0" : `bone-${id}`;
      bone.matrixAutoUpdate = false;
      bone.matrix.identity();
      return bone;
    });

    // TMSkinMesh creates a synthetic CFrame(0), then BON's (-1, 0) record
    // creates another frame with id 0 and overwrites only animation slot 0.
    // FindFrame(0), used by hierarchy construction and MSH palettes, keeps
    // resolving to the synthetic root because it is tested before children.
    const syntheticRoot = new THREE.Bone();
    syntheticRoot.name = "synthetic-root-0";
    syntheticRoot.matrixAutoUpdate = false;
    syntheticRoot.matrix.identity();
    this.#rig.add(syntheticRoot);

    const paletteBones = animationBones.slice();
    paletteBones[0] = syntheticRoot;
    this.syntheticRoot = syntheticRoot;
    this.bones = paletteBones;
    this.animationBones = animationBones;
    buildBoneHierarchy(syntheticRoot, animationBones, options.skeleton);

    const meshes = options.parts.map((part, partIndex) => {
      if (part.model.influenceCount < 1) {
        throw new Error(`Parte MSH ${part.name ?? partIndex} nao possui skinning`);
      }
      const geometry = createClassicSkinnedGeometry(part.model);
      const inverses = createPartBoneInverses(part.model, paletteBones.length);
      const skeleton = new THREE.Skeleton(paletteBones, inverses);
      const mesh = new THREE.SkinnedMesh(geometry, part.material);
      mesh.name = part.name ?? `msh-part-${partIndex}`;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Supplying the bind matrix is important: omitting it makes Three
      // recalculate and discard the inverse-bind matrices read from MSH.
      mesh.bind(skeleton, new THREE.Matrix4());
      this.#rig.add(mesh);
      return mesh;
    });
    this.meshes = meshes;

    for (const source of options.clips ?? []) {
      const clip = this.normaliseClip(source);
      if (clip.animation.boneSlotCount > animationBones.length) {
        throw new Error(`Clip ${clip.name} usa ${clip.animation.boneSlotCount} bones; rig possui ${animationBones.length}`);
      }
      this.#clips.set(clip.name, clip);
    }

    this.setClassicTransform();
    const initial = options.initialClip ? this.#clips.get(options.initialClip) : this.#clips.values().next().value;
    if (initial) {
      this.#currentClip = initial;
      this.applyPose(initial, 0, 0, 0);
    }
  }

  get currentClip(): string | null {
    return this.#currentClip?.name ?? null;
  }

  /**
   * TMEffectSkinMesh receives the actor's SetAnimation pointer and FPS, then
   * starts its own clock at zero. Returning the parsed clip reference (not the
   * live elapsed time) reproduces that ownership without duplicating CPU data.
   */
  currentAnimationSnapshot(): ClassicSkinnedAnimationSnapshot | null {
    return this.#currentClip;
  }

  /** Returns an immutable clip owned by this exact rig instance. */
  animationSnapshot(name: string): ClassicSkinnedAnimationSnapshot | null {
    return this.#clips.get(name) ?? null;
  }

  /**
   * Binds an independent classic ANI sampler to an exact SkeletonUtils clone
   * of this model. A snapshot from another model is rejected: classic ANI
   * matrices are rig-specific and cannot safely be transferred by bone slot.
   * `quarterStepMsOverride` mirrors the few client paths that copy only FPS.
   */
  createCloneAnimationController(
    cloneRoot: THREE.Object3D,
    animation: ClassicSkinnedAnimationSnapshot | null = this.#currentClip,
    quarterStepMsOverride?: number,
  ): ClassicSkinnedCloneAnimationController | null {
    if (!animation || this.#clips.get(animation.name) !== animation) return null;
    if (
      quarterStepMsOverride !== undefined
      && (!Number.isFinite(quarterStepMsOverride) || quarterStepMsOverride <= 0)
    ) return null;
    const playback = quarterStepMsOverride === undefined
      ? animation
      : { ...animation, quarterStepMs: quarterStepMsOverride };
    const sourceNodes: THREE.Object3D[] = [];
    const cloneNodes: THREE.Object3D[] = [];
    this.object.traverse((node) => sourceNodes.push(node));
    cloneRoot.traverse((node) => cloneNodes.push(node));
    if (sourceNodes.length !== cloneNodes.length) return null;

    const clones = new Map<THREE.Object3D, THREE.Object3D>();
    for (let index = 0; index < sourceNodes.length; index++) {
      clones.set(sourceNodes[index]!, cloneNodes[index]!);
    }
    const animationBones = this.animationBones.map((bone) => {
      const clone = clones.get(bone);
      return clone instanceof THREE.Bone ? clone : null;
    });
    if (animationBones.some((bone) => bone === null)) return null;
    const basis = clones.get(this.#basis);
    if (!basis) return null;

    let elapsedMilliseconds = 0;
    const scale = this.#scale.clone();
    const pitch = this.#pitch;
    const roll = this.#roll;
    const mirrorModelZ = this.#mirrorModelZ;
    const axisMode = this.#axisMode;
    const applyYaw = (yaw: number): void => {
      setClassicBasisMatrix(
        basis.matrix,
        yaw,
        pitch,
        roll,
        scale,
        mirrorModelZ,
        axisMode,
      );
      basis.matrixAutoUpdate = false;
      basis.matrixWorldNeedsUpdate = true;
    };
    applyClassicAnimationAt(animationBones, playback, 0);
    applyYaw(this.#yaw);

    return {
      update: (deltaSeconds: number) => {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
        elapsedMilliseconds += deltaSeconds * 1_000;
        applyClassicAnimationAt(animationBones, playback, elapsedMilliseconds);
      },
      setClassicYaw: (yaw: number) => {
        if (Number.isFinite(yaw)) applyYaw(yaw);
      },
    };
  }

  play(name: string, restart = false): boolean {
    const clip = this.#clips.get(name);
    if (!clip) return false;
    if (this.#currentClip === clip && !restart) return true;
    this.#currentClip = clip;
    this.#elapsedMilliseconds = 0;
    this.applyPose(clip, 0, clip.animation.tickCount > 1 ? 1 : 0, 0);
    return true;
  }

  /** Advances animation using the original client's four quarter-steps/tick. */
  update(deltaSeconds: number): void {
    const clip = this.#currentClip;
    if (!clip || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    this.#elapsedMilliseconds += deltaSeconds * 1_000;
    applyClassicAnimationAt(this.animationBones, clip, this.#elapsedMilliseconds);
  }

  /**
   * Recreates the exact base transform from TMSkinMesh::Render. This is the
   * transform that turns the authored Z-up model upright; omitting it lays
   * monsters flat on the terrain.
   */
  setClassicTransform(transform: ClassicTransform = {}): void {
    this.#yaw = transform.yaw ?? this.#yaw;
    this.#pitch = transform.pitch ?? this.#pitch;
    this.#roll = transform.roll ?? this.#roll;
    this.#axisMode = transform.axisMode ?? this.#axisMode;
    this.#mirrorModelZ = transform.mirrorModelZ ?? this.#mirrorModelZ;

    const scale = transform.scale;
    if (typeof scale === "number") this.#scale.setScalar(scale);
    else if (scale) this.#scale.copy(scale);

    setClassicBasisMatrix(
      this.#basis.matrix,
      this.#yaw,
      this.#pitch,
      this.#roll,
      this.#scale,
      this.#mirrorModelZ,
      this.#axisMode,
    );
    this.#basis.matrixWorldNeedsUpdate = true;
  }

  /**
   * Recreates TMSkinMesh's `m_bBaseMat` branch used by mounted riders and
   * mantles: `m_matMantua * Translation(fLen2, fLen, 0) * Scale`.
   * The parent Object3D must represent the source `m_BaseMatrix` bone.
   */
  setClassicBaseAttachment(transform: ClassicBaseAttachmentTransform): void {
    const rotation = d3dYawPitchRoll(
      transform.yaw,
      transform.pitch,
      transform.roll ?? 0,
    );
    const translation = rowTranslation(transform.length2, transform.length, 0);
    const scale = rowScale(transform.scale, transform.scale, transform.scale);
    const local = rowMultiply(rowMultiply(rotation, translation), scale);
    setConvertedD3DMatrix(this.#basis.matrix, local);
    this.#basis.matrixWorldNeedsUpdate = true;
  }

  normaliseClip(source: ClassicMatrixClip): ClassicSkinnedAnimationSnapshot {
    const quarterStepMs = source.quarterStepMs ?? 20;
    if (!source.name || !Number.isFinite(quarterStepMs) || quarterStepMs <= 0) {
      throw new Error(`Clip classico invalido: ${source.name}`);
    }
    return Object.freeze({
      name: source.name,
      animation: source.animation,
      quarterStepMs,
      loop: source.loop ?? true,
    });
  }

  private applyPose(
    clip: ClassicSkinnedAnimationSnapshot,
    tick: number,
    nextTick: number,
    fraction: number,
  ): void {
    applyClassicPose(this.animationBones, clip, tick, nextTick, fraction);
  }
}

function applyClassicAnimationAt(
  bones: readonly (THREE.Bone | null)[],
  clip: ClassicSkinnedAnimationSnapshot,
  elapsedMilliseconds: number,
): void {
  const animation = clip.animation;
  const totalSubsteps = Math.max(1, animation.tickCount * 4);
  let substep = Math.max(0, Math.floor(elapsedMilliseconds / clip.quarterStepMs));
  if (clip.loop) substep %= totalSubsteps;
  else substep = Math.min(substep, totalSubsteps - 1);

  const tick = Math.floor(substep / 4);
  const fraction = (substep & 3) * 0.25;
  const nextTick = tick + 1 < animation.tickCount ? tick + 1 : (clip.loop ? 0 : tick);
  applyClassicPose(bones, clip, tick, nextTick, fraction);
}

function applyClassicPose(
  bones: readonly (THREE.Bone | null)[],
  clip: ClassicSkinnedAnimationSnapshot,
  tick: number,
  nextTick: number,
  fraction: number,
): void {
  const animation = clip.animation;
  for (let boneSlot = 0; boneSlot < bones.length; boneSlot++) {
    const bone = bones[boneSlot];
    if (!bone) continue;
    if (boneSlot >= animation.boneSlotCount) {
      bone.matrix.identity();
      bone.matrixWorldNeedsUpdate = true;
      continue;
    }

    const first = (tick * animation.boneSlotCount + boneSlot) * 16;
    const second = (nextTick * animation.boneSlotCount + boneSlot) * 16;
    const elements = bone.matrix.elements;
    for (let component = 0; component < 16; component++) {
      const a = animation.matrices[first + component] ?? 0;
      const b = animation.matrices[second + component] ?? a;
      const value = a + (b - a) * fraction;
      elements[component] = D3D_TO_THREE_NEGATIVE_COMPONENTS.has(component) ? -value : value;
    }
    bone.matrixWorldNeedsUpdate = true;
  }
}

function setClassicBasisMatrix(
  target: THREE.Matrix4,
  classicYaw: number,
  classicPitch: number,
  classicRoll: number,
  scale: Readonly<THREE.Vector3>,
  mirrorModelZ: boolean,
  axisMode: "standard" | "late",
): void {
  const yaw = classicYaw + (axisMode === "standard" ? -Math.PI / 2 : Math.PI / 2);
  const pitch = classicPitch + (axisMode === "standard" ? -Math.PI / 2 : 0);
  const rotation = d3dYawPitchRoll(yaw, pitch, classicRoll);
  const scaleMatrix = rowScale(
    scale.x,
    scale.y,
    scale.z * (mirrorModelZ ? -1 : 1),
  );
  setConvertedD3DMatrix(target, rowMultiply(rotation, scaleMatrix));
}

/** Builds RH Three.js geometry while preserving the MSH's four skin lanes. */
export function createClassicSkinnedGeometry(model: MshModel): THREE.BufferGeometry {
  if (model.influenceCount < 1) throw new Error("MSH sem influencias nao pode criar SkinnedMesh");
  const positions = model.positions.slice();
  const normals = model.normals?.slice() ?? null;
  const uvs = model.uvs?.slice() ?? new Float32Array(model.vertexCount * 2);
  const skinIndices = new Uint16Array(model.vertexCount * 4);
  const skinWeights = new Float32Array(model.vertexCount * 4);

  for (let vertex = 0; vertex < model.vertexCount; vertex++) {
    positions[vertex * 3 + 2] = -(positions[vertex * 3 + 2] ?? 0);
    if (normals) normals[vertex * 3 + 2] = -(normals[vertex * 3 + 2] ?? 0);

    let weightSum = 0;
    for (let lane = 0; lane < 4; lane++) {
      const attributeIndex = vertex * 4 + lane;
      const paletteSlot = model.paletteIndices[attributeIndex] ?? 0;
      const boneId = model.paletteBoneIds[paletteSlot] ?? 0;
      skinIndices[attributeIndex] = boneId;
      const weight = lane < model.influenceCount ? Math.max(0, model.skinWeights[attributeIndex] ?? 0) : 0;
      skinWeights[attributeIndex] = weight;
      weightSum += weight;
    }
    if (weightSum <= 1e-8) {
      skinWeights[vertex * 4] = 1;
    } else if (Math.abs(weightSum - 1) > 1e-7) {
      for (let lane = 0; lane < 4; lane++) {
        const index = vertex * 4 + lane;
        skinWeights[index] = (skinWeights[index] ?? 0) / weightSum;
      }
    }
  }

  // Reflecting Z changes handedness, so reverse every triangle once.
  const indices = model.indices.slice();
  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const second = indices[triangle + 1] ?? 0;
    indices[triangle + 1] = indices[triangle + 2] ?? 0;
    indices[triangle + 2] = second;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", normals
    ? new THREE.Float32BufferAttribute(normals, 3)
    : new THREE.Float32BufferAttribute(new Float32Array(model.vertexCount * 3), 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
  geometry.setIndex(new THREE.Uint16BufferAttribute(indices, 1));
  if (!normals) geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function requiredBoneSlotCount(options: ClassicSkinnedModelOptions): number {
  let count = options.skeleton.slotCount;
  for (const clip of options.clips ?? []) count = Math.max(count, clip.animation.boneSlotCount);
  for (const part of options.parts) {
    for (const boneId of part.model.paletteBoneIds) count = Math.max(count, boneId + 1);
  }
  if (count === 0 || count > 1_024) throw new Error(`Rig com ${count} slots de bone`);
  return count;
}

function buildBoneHierarchy(syntheticRoot: THREE.Bone, bones: THREE.Bone[], skeleton: BonSkeleton): void {
  const recordById = new Map<number, { parentId: number }>();
  for (const record of skeleton.bones) {
    // Duplicate ids exist in two late-game skeletons. A single Three.Bone
    // cannot reproduce both tree nodes; matching m_pframeToAnimate means the
    // last record is the animation target.
    recordById.set(record.id, record);
  }

  for (let id = 0; id < bones.length; id++) {
    const bone = bones[id];
    if (!bone) continue;
    const parentId = recordById.get(id)?.parentId ?? -1;
    // The old loader maps -1 to id 0, and FindFrame(0) always returns the
    // synthetic root rather than BON's animated frame 0.
    const parent = parentId <= 0
      ? syntheticRoot
      : (parentId < bones.length && parentId !== id ? bones[parentId] : null);
    if (parent && !wouldCreateCycle(id, parentId, recordById)) parent.add(bone);
    else syntheticRoot.add(bone);
  }
}

function wouldCreateCycle(id: number, parentId: number, records: ReadonlyMap<number, { parentId: number }>): boolean {
  const visited = new Set<number>([id]);
  let current = parentId;
  while (current >= 0) {
    if (visited.has(current)) return true;
    visited.add(current);
    current = records.get(current)?.parentId ?? -1;
  }
  return false;
}

function createPartBoneInverses(model: MshModel, boneCount: number): THREE.Matrix4[] {
  const inverses = Array.from({ length: boneCount }, () => new THREE.Matrix4());
  for (let palette = 0; palette < model.paletteMatrices.length; palette++) {
    const boneId = model.paletteBoneIds[palette];
    const source = model.paletteMatrices[palette];
    if (boneId === undefined || !source || boneId >= boneCount) {
      throw new Error(`Paleta MSH ${palette} aponta para bone ${boneId}`);
    }
    setConvertedD3DMatrix(inverses[boneId]!, source);
  }
  return inverses;
}

/** Converts a D3DX row-vector matrix with C*M^T*C, C=diag(1,1,-1,1). */
function setConvertedD3DMatrix(target: THREE.Matrix4, source: ArrayLike<number>): void {
  const elements = target.elements;
  for (let component = 0; component < 16; component++) {
    const value = source[component] ?? 0;
    elements[component] = D3D_TO_THREE_NEGATIVE_COMPONENTS.has(component) ? -value : value;
  }
}

function d3dYawPitchRoll(yaw: number, pitch: number, roll: number): number[] {
  // D3DX row-vector order: roll, then pitch, then yaw.
  return rowMultiply(rowMultiply(rowRotationZ(roll), rowRotationX(pitch)), rowRotationY(yaw));
}

function rowMultiply(left: ArrayLike<number>, right: ArrayLike<number>): number[] {
  const result = new Array<number>(16).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 4; column++) {
      let value = 0;
      for (let inner = 0; inner < 4; inner++) {
        value += (left[row * 4 + inner] ?? 0) * (right[inner * 4 + column] ?? 0);
      }
      result[row * 4 + column] = value;
    }
  }
  return result;
}

function rowRotationX(angle: number): number[] {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [1, 0, 0, 0, 0, cosine, sine, 0, 0, -sine, cosine, 0, 0, 0, 0, 1];
}

function rowRotationY(angle: number): number[] {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [cosine, 0, -sine, 0, 0, 1, 0, 0, sine, 0, cosine, 0, 0, 0, 0, 1];
}

function rowRotationZ(angle: number): number[] {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [cosine, sine, 0, 0, -sine, cosine, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function rowScale(x: number, y: number, z: number): number[] {
  return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
}

function rowTranslation(x: number, y: number, z: number): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}
