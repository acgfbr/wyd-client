import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { parseMsa } from "../../formats/classic/Msa";
import { createClassicD3DLocalMatrix } from "../characters/ClassicSkinnedModel";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";

const MODEL_TYPES = [501, 502] as const;
const TEXTURE_INDEX = 202;
const NORMAL_PULSE_SECONDS = 1;
const KHEPRA_PULSE_SECONDS = 3;
const VISIBLE_PROGRESS = 0.05;
const MAX_INTENSITY = 0.5;
const HORIZONTAL_SCALE = 1.3;
const HEIGHT_OFFSET = 0.6;
const MODEL_501_X_OFFSET = -0.5;
const PASSED_YAW = THREE.MathUtils.degToRad(-30);
// TMMesh::Render subtracts another 90 degrees from the passed -30 degree pitch.
const EFFECT_PITCH = THREE.MathUtils.degToRad(-120);

export interface FoemaCancellationTargetContext {
  /** Logical target feet, equivalent to TMObject::m_fHeight. */
  readonly targetFeet: THREE.Vector3;
  /** Exact m_vecSkinPos equivalent selected while the target is mounted. */
  readonly targetSkinAnchor: THREE.Vector3;
  readonly mounted: boolean;
  /** TMHuman::m_vecPickSize[m_nSkinMeshType].x multiplied by actor scale. */
  readonly cancelScale: number;
  /** Class 56 without FaceMesh uses the retail three-second Khepra branch. */
  readonly khepra?: boolean;
  /** Character skin and, when mounted, mount roots that receive m_cCancel tint. */
  readonly tintRoots?: readonly THREE.Object3D[];
}

interface CancellationResources {
  readonly texture: THREE.Texture;
  readonly geometry501: THREE.BufferGeometry;
  readonly geometry502: THREE.BufferGeometry;
}

interface CancellationMeshVisual {
  readonly holder: THREE.Group;
  readonly rotation: THREE.Group;
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly xOffset: number;
}

interface MutableCancellationContext {
  readonly targetFeet: THREE.Vector3;
  readonly targetSkinAnchor: THREE.Vector3;
  mounted: boolean;
  cancelScale: number;
  khepra: boolean;
  tintRoots: THREE.Object3D[];
}

interface TintMaterialClone {
  readonly original: THREE.Material;
  readonly clone: THREE.Material;
}

interface TintBinding {
  readonly mesh: THREE.Mesh;
  readonly original: THREE.Material | THREE.Material[];
  readonly tinted: THREE.Material | THREE.Material[];
  readonly clones: readonly TintMaterialClone[];
}

/**
 * Presentation-only port of Foema #47, Cancelamento.
 *
 * The retail client has no dedicated event/cast burst for skill 47: the
 * TMHuman effect-event dispatcher jumps from 46 to 48/49. The visible state is
 * authoritative affect 32 (`m_cCancel`). While that state is present,
 * TMHuman.cpp retriggers a type-4 TMSkillMagicShield every second and
 * TMSkillMagicShield.cpp renders common models 501/502 with effect texture 202.
 * Khepra uses the same pair with a three-second pulse and a small random
 * vertical offset.
 *
 * `syncPersistent` also ports SetColorMaterial's red m_cCancel tint. This web
 * client shares cached actor materials, so tintable materials are cloned only
 * for the affected target and the exact original material references are put
 * back when the affect ends. Gameplay chance, duration, packet authority and
 * the consumable restrictions remain outside this renderer.
 *
 * There is intentionally no `play()` method: retail has no #47 one-shot visual.
 */
export class ClassicFoemaCancellationEffects {
  readonly object = new THREE.Group();
  readonly #dds = new ClassicDdsTextureLoader();
  readonly #pulseRoot = new THREE.Group();
  readonly #visuals: CancellationMeshVisual[] = [];
  readonly #tintBindings = new Map<THREE.Mesh, TintBinding>();
  #resources: CancellationResources | null = null;
  #material: THREE.MeshBasicMaterial | null = null;
  #context: MutableCancellationContext | null = null;
  #persistentRequested = false;
  #pulseActive = false;
  #pulseElapsed = 0;
  #pulseDuration = NORMAL_PULSE_SECONDS;
  #verticalOffset = 0;
  #randomState = 0;
  #preload: Promise<void> | null = null;
  #enabled = true;
  #disposed = false;

  constructor(parent: THREE.Object3D) {
    this.object.name = "classic-foema-cancellation-effects";
    this.#pulseRoot.name = "classic-foema-cancellation-persistent-501-502-202";
    this.#pulseRoot.visible = false;
    this.object.add(this.#pulseRoot);
    parent.add(this.object);
  }

  /** Loads common models 501/502 and EffectTextureList entry 202 once. */
  async prepareClassic(assets: ClassicAssetSource): Promise<void> {
    if (this.#disposed || this.#resources) return;
    if (this.#preload) return this.#preload;

    const job = this.loadClassicResources(assets)
      .then((resources) => {
        if (this.#disposed) {
          disposeResources(resources);
          return;
        }
        try {
          this.installResources(resources);
          this.#resources = resources;
          if (this.#persistentRequested && this.#context) this.startPulse();
        } catch (error) {
          this.disposeInstallation();
          disposeResources(resources);
          throw error;
        }
      })
      .catch((error: unknown) => {
        console.warn("Efeito classico #47 Cancelamento da Foema indisponivel.", error);
      })
      .finally(() => {
        this.#preload = null;
      });
    this.#preload = job;
    return job;
  }

  /**
   * Copies the affected target's current visual anchors and authoritative state.
   * Removing only `active` restores the red tint immediately but lets an
   * already-started pulse finish, matching the independent retail controller.
   */
  syncPersistent(
    target: FoemaCancellationTargetContext | null,
    active: boolean,
  ): void {
    if (this.#disposed) return;
    if (!target || !isFiniteTargetContext(target)) {
      this.stopPersistent(true);
      this.#context = null;
      this.restoreAllTintBindings();
      return;
    }

    const previousKhepra = this.#context?.khepra ?? false;
    if (!this.#context) {
      this.#context = {
        targetFeet: target.targetFeet.clone(),
        targetSkinAnchor: target.targetSkinAnchor.clone(),
        mounted: target.mounted,
        cancelScale: target.cancelScale,
        khepra: target.khepra === true,
        tintRoots: [...(target.tintRoots ?? [])],
      };
    } else {
      this.#context.targetFeet.copy(target.targetFeet);
      this.#context.targetSkinAnchor.copy(target.targetSkinAnchor);
      this.#context.mounted = target.mounted;
      this.#context.cancelScale = target.cancelScale;
      this.#context.khepra = target.khepra === true;
      this.#context.tintRoots = [...(target.tintRoots ?? [])];
    }

    const nextRequested = this.#enabled && active;
    if (nextRequested) {
      // SetColorMaterial returns before m_cCancel for Khepra, so its innate
      // material branch is deliberately not replaced by the normal red tint.
      if (this.#context.khepra) this.restoreAllTintBindings();
      else this.reconcileTintBindings(this.#context.tintRoots);
    } else {
      this.restoreAllTintBindings();
    }

    if (
      nextRequested
      && this.#resources
      && (!this.#persistentRequested || previousKhepra !== this.#context.khepra)
    ) {
      this.startPulse();
    }
    this.#persistentRequested = nextRequested;
    this.updatePulseTransform();
  }

  update(deltaSeconds: number): void {
    if (this.#disposed || !this.#enabled) return;
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;

    if (this.#persistentRequested && this.#context && !this.#context.khepra) {
      this.reconcileTintBindings(this.#context.tintRoots);
    }

    if (!this.#resources || !this.#context || !this.#material) {
      this.hidePulse();
      return;
    }

    if (!this.#pulseActive) {
      if (!this.#persistentRequested) {
        this.hidePulse();
        return;
      }
      this.startPulse();
    } else if (delta > 0) {
      this.#pulseElapsed += delta;
      if (this.#pulseElapsed > this.#pulseDuration) {
        if (this.#persistentRequested) {
          this.startPulse();
        } else {
          this.#pulseActive = false;
          this.hidePulse();
          return;
        }
      }
    }

    this.updatePulseTransform();
  }

  setEnabled(enabled: boolean): void {
    if (this.#disposed || this.#enabled === enabled) return;
    this.#enabled = enabled;
    this.object.visible = enabled;
    if (!enabled) this.clear();
  }

  clear(): void {
    this.stopPersistent(true);
    this.#context = null;
    this.restoreAllTintBindings();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clear();
    this.disposeInstallation();
    if (this.#resources) disposeResources(this.#resources);
    this.#resources = null;
    this.object.removeFromParent();
    this.object.clear();
  }

  private installResources(resources: CancellationResources): void {
    this.#material = createCancellationMaterial(resources.texture);
    this.#visuals.push(
      this.createVisual(501, resources.geometry501, MODEL_501_X_OFFSET),
      this.createVisual(502, resources.geometry502, 0),
    );
  }

  private createVisual(
    type: (typeof MODEL_TYPES)[number],
    geometry: THREE.BufferGeometry,
    xOffset: number,
  ): CancellationMeshVisual {
    const holder = new THREE.Group();
    const rotation = new THREE.Group();
    const mesh = new THREE.Mesh(geometry, this.#material!);
    holder.name = `classic-foema-cancellation-model-${type}-holder`;
    rotation.name = `classic-foema-cancellation-model-${type}-rotation`;
    mesh.name = `classic-foema-cancellation-model-${type}-texture-${TEXTURE_INDEX}`;
    rotation.matrixAutoUpdate = false;
    mesh.renderOrder = 8;
    holder.visible = false;
    rotation.add(mesh);
    holder.add(rotation);
    this.#pulseRoot.add(holder);
    return { holder, rotation, mesh, xOffset };
  }

  private startPulse(): void {
    const context = this.#context;
    if (!this.#resources || !context) return;
    this.#pulseElapsed = 0;
    this.#pulseDuration = context.khepra
      ? KHEPRA_PULSE_SECONDS
      : NORMAL_PULSE_SECONDS;
    this.#verticalOffset = context.khepra
      ? -(this.nextClassicRandom(50) * 0.01)
      : 0;
    this.#pulseActive = true;
    this.hidePulse();
  }

  private updatePulseTransform(): void {
    const context = this.#context;
    const material = this.#material;
    if (!context || !material || !this.#pulseActive) return;

    const progress = THREE.MathUtils.clamp(
      this.#pulseElapsed / this.#pulseDuration,
      0,
      1,
    );
    const intensity = Math.abs(Math.sin(progress * Math.PI)) * MAX_INTENSITY;
    const visible = progress >= VISIBLE_PROGRESS && progress <= 1;
    const anchor = context.mounted ? context.targetSkinAnchor : context.targetFeet;
    const cancelScale = context.mounted ? 1 : context.cancelScale;
    const horizontalScale = HORIZONTAL_SCALE * cancelScale;
    const y = (this.#verticalOffset + HEIGHT_OFFSET) * cancelScale;
    const angle = progress * Math.PI * 2;

    this.#pulseRoot.position.copy(anchor);
    this.#pulseRoot.visible = visible;
    material.color.setRGB(intensity, intensity, intensity);
    // The retail baseline texture stage selects texture alpha. Although type 4
    // also rewrites vertex A, that channel is not selected for this TMMesh pass.
    material.opacity = 1;

    for (const visual of this.#visuals) {
      visual.holder.position.set(visual.xOffset, y, 0);
      visual.holder.scale.set(horizontalScale, 1, horizontalScale);
      // TMMesh composes row-vector R*S*T. The hierarchy below is its converted
      // column-vector T*S*R, preserving horizontal-only m_fScaleH exactly.
      visual.rotation.matrix.copy(createClassicD3DLocalMatrix({
        yaw: PASSED_YAW,
        pitch: EFFECT_PITCH,
        roll: Math.PI - angle,
      }));
      visual.rotation.matrixWorldNeedsUpdate = true;
      visual.holder.visible = visible;
    }
  }

  private stopPersistent(immediate: boolean): void {
    this.#persistentRequested = false;
    if (!immediate && this.#pulseActive) return;
    this.#pulseActive = false;
    this.#pulseElapsed = 0;
    this.hidePulse();
  }

  private hidePulse(): void {
    this.#pulseRoot.visible = false;
    for (const visual of this.#visuals) visual.holder.visible = false;
  }

  private reconcileTintBindings(roots: readonly THREE.Object3D[]): void {
    const desired = collectTintableMeshes(roots);

    for (const [mesh, binding] of this.#tintBindings) {
      if (desired.has(mesh) && mesh.material === binding.tinted) {
        applyBindingTint(binding);
        continue;
      }
      this.releaseTintBinding(binding);
      this.#tintBindings.delete(mesh);
    }

    for (const mesh of desired) {
      if (this.#tintBindings.has(mesh)) continue;
      const binding = createTintBinding(mesh);
      if (!binding) continue;
      this.#tintBindings.set(mesh, binding);
      mesh.material = binding.tinted;
      applyBindingTint(binding);
    }
  }

  private restoreAllTintBindings(): void {
    for (const binding of this.#tintBindings.values()) this.releaseTintBinding(binding);
    this.#tintBindings.clear();
  }

  private releaseTintBinding(binding: TintBinding): void {
    if (binding.mesh.material === binding.tinted) {
      binding.mesh.material = binding.original;
    }
    for (const entry of binding.clones) entry.clone.dispose();
  }

  private disposeInstallation(): void {
    this.hidePulse();
    this.#visuals.length = 0;
    this.#pulseRoot.clear();
    this.#material?.dispose();
    this.#material = null;
  }

  private nextClassicRandom(modulus: number): number {
    // Deterministic local stand-in for the retail process-wide rand() call.
    this.#randomState = (Math.imul(this.#randomState, 1_103_515_245) + 12_345) >>> 0;
    return (this.#randomState >>> 16) % modulus;
  }

  private async loadClassicResources(
    assets: ClassicAssetSource,
  ): Promise<CancellationResources> {
    const results = await Promise.allSettled([
      this.loadEffectTexture(assets),
      loadEffectGeometry(assets, 501),
      loadEffectGeometry(assets, 502),
    ] as const);
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) {
      for (const result of results) {
        if (result.status === "fulfilled") result.value.dispose();
      }
      throw failure.reason;
    }
    return {
      texture: settledValue(results[0]),
      geometry501: settledValue(results[1]),
      geometry502: settledValue(results[2]),
    };
  }

  private async loadEffectTexture(assets: ClassicAssetSource): Promise<THREE.Texture> {
    const url = assets.effectTextureUrl(TEXTURE_INDEX);
    if (!url) throw new Error(`Textura de efeito ${TEXTURE_INDEX} ausente do manifesto`);
    const texture = await this.#dds.loadAsync(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  }
}

function createCancellationMaterial(texture: THREE.Texture): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: 0x000000,
    transparent: true,
    opacity: 1,
    depthTest: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.SrcAlphaFactor,
    blendDstAlpha: THREE.OneFactor,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
  material.forceSinglePass = true;
  return material;
}

function collectTintableMeshes(roots: readonly THREE.Object3D[]): Set<THREE.Mesh> {
  const meshes = new Set<THREE.Mesh>();
  for (const root of roots) {
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !containsTintableMaterial(mesh.material)) return;
      meshes.add(mesh);
    });
  }
  return meshes;
}

function containsTintableMaterial(material: THREE.Material | THREE.Material[]): boolean {
  return Array.isArray(material)
    ? material.some(isTintableMaterial)
    : isTintableMaterial(material);
}

function isTintableMaterial(material: THREE.Material): boolean {
  const candidate = material as THREE.Material & {
    readonly color?: THREE.Color;
    readonly isMeshLambertMaterial?: boolean;
    readonly isMeshPhongMaterial?: boolean;
    readonly isMeshStandardMaterial?: boolean;
    readonly isMeshToonMaterial?: boolean;
  };
  return candidate.color?.isColor === true
    && (
      candidate.isMeshLambertMaterial === true
      || candidate.isMeshPhongMaterial === true
      || candidate.isMeshStandardMaterial === true
      || candidate.isMeshToonMaterial === true
    );
}

function createTintBinding(mesh: THREE.Mesh): TintBinding | null {
  const original = mesh.material;
  const clones: TintMaterialClone[] = [];
  const cloneMaterial = (material: THREE.Material): THREE.Material => {
    if (!isTintableMaterial(material)) return material;
    const clone = material.clone();
    // Material.clone() does not retain instance-level shader hooks in every
    // Three revision. Ancient/refinement materials must keep their scrolling
    // multitexture while the cancellation tint is active.
    clone.onBeforeCompile = material.onBeforeCompile;
    clone.customProgramCacheKey = material.customProgramCacheKey;
    clone.name = material.name ? `${material.name} [Cancelamento]` : "Cancelamento";
    clones.push({ original: material, clone });
    return clone;
  };
  const tinted = Array.isArray(original)
    ? original.map(cloneMaterial)
    : cloneMaterial(original);
  return clones.length > 0 ? { mesh, original, tinted, clones } : null;
}

function applyBindingTint(binding: TintBinding): void {
  for (const entry of binding.clones) applyCancellationTint(entry.clone, entry.original);
}

function applyCancellationTint(target: THREE.Material, source: THREE.Material): void {
  const tinted = target as THREE.Material & {
    readonly color: THREE.Color;
    readonly emissive?: THREE.Color;
    readonly specular?: THREE.Color;
  };
  const base = source as THREE.Material & { readonly color: THREE.Color };
  const red = base.color.r * 0.4 + 0.2;
  const green = base.color.g * 0.4;
  const blue = base.color.b * 0.4;
  tinted.color.setRGB(red, green, blue);
  tinted.emissive?.setRGB(red, green, blue);
  tinted.specular?.setRGB(red, green, blue);
}

async function loadEffectGeometry(
  assets: ClassicAssetSource,
  type: (typeof MODEL_TYPES)[number],
): Promise<THREE.BufferGeometry> {
  const source = await assets.loadModel(type);
  if (!source) throw new Error(`Modelo classico ${type} ausente do manifesto`);
  return parseMsa(source.buffer).geometry;
}

function settledValue<T>(result: PromiseSettledResult<T>): T {
  if (result.status === "rejected") throw result.reason;
  return result.value;
}

function disposeResources(resources: CancellationResources): void {
  resources.texture.dispose();
  resources.geometry501.dispose();
  resources.geometry502.dispose();
}

function isFiniteVector(position: THREE.Vector3): boolean {
  return Number.isFinite(position.x)
    && Number.isFinite(position.y)
    && Number.isFinite(position.z);
}

function isFiniteTargetContext(context: FoemaCancellationTargetContext): boolean {
  return isFiniteVector(context.targetFeet)
    && isFiniteVector(context.targetSkinAnchor)
    && Number.isFinite(context.cancelScale)
    && context.cancelScale > 0;
}
