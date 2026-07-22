import * as THREE from "three";

const CLASSIC_FRIENDLY_OUTLINE_COLOR = 0x45e36a;
const CLASSIC_FRIENDLY_OUTLINE_SCALE = 1.035;

export interface ClassicFriendlyHoverOutline {
  dispose(): void;
}

/**
 * Builds a thin back-face silhouette around the live skinned parts. Each
 * outline mesh shares its source geometry and Skeleton, so ANI updates remain
 * free; only the tiny unlit material and draw call exist while an NPC is hot.
 */
export function createClassicFriendlyHoverOutline(
  sources: readonly THREE.SkinnedMesh[],
): ClassicFriendlyHoverOutline | null {
  const material = new THREE.MeshBasicMaterial({
    color: CLASSIC_FRIENDLY_OUTLINE_COLOR,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.72,
    depthTest: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const outlines: THREE.SkinnedMesh[] = [];

  for (const source of sources) {
    const outline = new THREE.SkinnedMesh(source.geometry, material);
    outline.name = "classic-friendly-hover-outline";
    outline.bindMode = source.bindMode;
    outline.bind(source.skeleton, source.bindMatrix);
    outline.scale.setScalar(CLASSIC_FRIENDLY_OUTLINE_SCALE);
    outline.frustumCulled = false;
    outline.castShadow = false;
    outline.receiveShadow = false;
    outline.renderOrder = source.renderOrder - 1;
    outline.raycast = () => undefined;
    source.add(outline);
    outlines.push(outline);
  }

  if (outlines.length === 0) {
    material.dispose();
    return null;
  }

  let disposed = false;
  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const outline of outlines) outline.removeFromParent();
      material.dispose();
    },
  };
}
