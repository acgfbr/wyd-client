import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { ClassicSkinnedCloneAnimationController } from "./ClassicSkinnedModel";

const SHADOW_BLADE_COLOR = new THREE.Color().setRGB(0.5, 0.3, 0.2);

export interface ClassicSkinnedAfterimage {
  readonly object: THREE.Group;
  update(deltaSeconds: number): void;
  setClassicYaw(yaw: number): void;
  setIntensity(intensity: number): void;
  dispose(): void;
}

export interface ClassicSkinnedAfterimageOptions {
  /** Subtrees such as the mounted rider or live SForce must not be duplicated. */
  readonly excludedObjectNames?: ReadonlySet<string>;
  /** Created before pruning, while source/clone traversal order is identical. */
  readonly animationControllerFactory?: (
    cloneRoot: THREE.Group,
  ) => ClassicSkinnedCloneAnimationController | null;
  /** Fixed-function RGB multiplier used by the originating TMEffectSkinMesh. */
  readonly color?: THREE.ColorRepresentation;
}

/**
 * Builds a short-lived pose clone without duplicating textures/geometries.
 *
 * SkeletonUtils remaps every SkinnedMesh to cloned bones. Materials are the
 * only GPU resources owned by the afterimage: they reproduce EF_BRIGHT and
 * the `(0.5, 0.3, 0.2)` start colour used by TMEffectSkinMesh for skill #88.
 */
export function createClassicSkinnedAfterimage(
  source: THREE.Group,
  options: ClassicSkinnedAfterimageOptions = {},
): ClassicSkinnedAfterimage | null {
  const excluded = options.excludedObjectNames ?? new Set<string>();
  const effectColor = new THREE.Color(options.color ?? SHADOW_BLADE_COLOR);
  source.updateWorldMatrix(true, true);

  // SkeletonUtils retains the concrete Group root but exposes Object3D in its
  // declaration, so restore the source's narrower type here.
  const object = cloneSkeleton(source) as THREE.Group;
  const animationController = options.animationControllerFactory?.(object) ?? null;
  pruneExcludedSubtrees(object, excluded);

  const materials: THREE.MeshBasicMaterial[] = [];
  const skeletons = new Set<THREE.Skeleton>();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
    const owned = sourceMaterials.map((material) => {
      const next = createAfterimageMaterial(
        material,
        child.geometry.hasAttribute("color"),
        effectColor,
      );
      materials.push(next);
      return next;
    });
    child.material = Array.isArray(child.material) ? owned : owned[0]!;
    child.castShadow = false;
    child.receiveShadow = false;
    child.frustumCulled = false;
    child.renderOrder = 14;
    if (child instanceof THREE.SkinnedMesh) skeletons.add(child.skeleton);
  });

  const worldPosition = new THREE.Vector3();
  const worldQuaternion = new THREE.Quaternion();
  const worldScale = new THREE.Vector3();
  source.matrixWorld.decompose(worldPosition, worldQuaternion, worldScale);
  object.matrixAutoUpdate = true;
  object.position.copy(worldPosition);
  object.quaternion.copy(worldQuaternion);
  object.scale.copy(worldScale);
  object.updateMatrix();
  object.name = "classic-huntress-shadow-blade-afterimage";

  let disposed = false;
  const setIntensity = (intensity: number): void => {
    const value = THREE.MathUtils.clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1);
    for (const material of materials) material.color.copy(effectColor).multiplyScalar(value);
    object.visible = value > 0.001;
  };

  setIntensity(1);
  animationController?.update(0);
  object.updateMatrixWorld(true);

  return {
    object,
    update: (deltaSeconds: number) => {
      if (!disposed) animationController?.update(deltaSeconds);
    },
    setClassicYaw: (yaw: number) => {
      if (!disposed) animationController?.setClassicYaw(yaw);
    },
    setIntensity,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      object.removeFromParent();
      for (const skeleton of skeletons) skeleton.dispose();
      for (const material of materials) material.dispose();
    },
  };
}

function createAfterimageMaterial(
  source: THREE.Material,
  vertexColors: boolean,
  color: THREE.Color,
): THREE.MeshBasicMaterial {
  const textured = source as THREE.Material & {
    readonly map?: THREE.Texture | null;
    readonly alphaMap?: THREE.Texture | null;
    readonly side?: THREE.Side;
  };
  const material = new THREE.MeshBasicMaterial({
    name: "WYD Lâmina das Sombras #88",
    map: textured.map ?? null,
    alphaMap: textured.alphaMap ?? null,
    color,
    vertexColors,
    transparent: true,
    opacity: 1,
    alphaTest: 0,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: textured.side ?? THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
  material.forceSinglePass = true;
  return material;
}

function pruneExcludedSubtrees(root: THREE.Object3D, excluded: ReadonlySet<string>): void {
  const visit = (node: THREE.Object3D): void => {
    for (const child of [...node.children]) {
      if (excluded.has(child.name)) node.remove(child);
      else visit(child);
    }
  };
  visit(root);
}
