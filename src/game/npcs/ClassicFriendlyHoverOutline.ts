import * as THREE from "three";

const CLASSIC_FRIENDLY_OUTLINE_COLOR = 0x45e36a;
// NDC thickness measured against the viewport height. Keeping the expansion in
// clip space makes the halo readable at every camera zoom without inflating
// multipart rigs from unrelated pivots.
const CLASSIC_FRIENDLY_OUTLINE_THICKNESS = 0.006;

function configureOutlineVertexExpansion(material: THREE.MeshBasicMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float classicFriendlyOutlineThickness;`,
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>

// transformedNormal already contains morphing, skinning and the model-view
// normal matrix. BackSide defines FLIP_SIDED, so undo that sign before using
// the normal as the outward screen-space direction.
vec2 classicFriendlyOutlineDirection = -(
  projectionMatrix * vec4( transformedNormal, 0.0 )
).xy;

// projectionMatrix[1][1] / projectionMatrix[0][0] is the viewport aspect for
// the symmetric perspective camera used by the game. Normalising in that
// metric keeps horizontal and vertical borders visually the same thickness.
float classicFriendlyOutlineAspect = abs(
  projectionMatrix[1][1] / projectionMatrix[0][0]
);
float classicFriendlyOutlineLength = length(
  classicFriendlyOutlineDirection * vec2( classicFriendlyOutlineAspect, 1.0 )
);

if ( classicFriendlyOutlineLength > 0.00001 ) {
  gl_Position.xy += classicFriendlyOutlineDirection
    * ( classicFriendlyOutlineThickness / classicFriendlyOutlineLength )
    * gl_Position.w;
}`,
      );
    shader.uniforms.classicFriendlyOutlineThickness = {
      value: CLASSIC_FRIENDLY_OUTLINE_THICKNESS,
    };
  };
  material.customProgramCacheKey = () => "classic-friendly-hover-outline-screen-v1";
}

export interface ClassicFriendlyHoverOutline {
  setColor(color: THREE.ColorRepresentation): void;
  dispose(): void;
}

export interface ClassicActorOutlineOptions {
  readonly color?: THREE.ColorRepresentation;
  readonly opacity?: number;
  readonly name?: string;
}

/**
 * Builds a thin post-skinning back-face silhouette around the live parts. Each
 * outline mesh shares its source geometry and Skeleton, so ANI updates remain
 * free; only the tiny unlit material and draw call exist while an NPC is hot.
 */
export function createClassicFriendlyHoverOutline(
  sources: readonly THREE.SkinnedMesh[],
  options: ClassicActorOutlineOptions = {},
): ClassicFriendlyHoverOutline | null {
  const material = new THREE.MeshBasicMaterial({
    color: options.color ?? CLASSIC_FRIENDLY_OUTLINE_COLOR,
    side: THREE.BackSide,
    transparent: true,
    opacity: options.opacity ?? 0.82,
    depthTest: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  configureOutlineVertexExpansion(material);
  const outlines: THREE.SkinnedMesh[] = [];

  for (const source of sources) {
    const outline = new THREE.SkinnedMesh(source.geometry, material);
    outline.name = options.name ?? "classic-friendly-hover-outline";
    outline.bindMode = source.bindMode;
    outline.bind(source.skeleton, source.bindMatrix);
    outline.frustumCulled = false;
    outline.castShadow = false;
    outline.receiveShadow = false;
    outline.renderOrder = source.renderOrder + 1;
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
    setColor: (color) => {
      if (!disposed) material.color.set(color);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const outline of outlines) outline.removeFromParent();
      material.dispose();
    },
  };
}
