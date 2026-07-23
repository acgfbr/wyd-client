import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import type { InventoryItem } from "../../game/state/PlayerState";
import type { ModelLibrary } from "../objects/ModelLibrary";
import { ClassicDdsTextureLoader } from "../textures/ClassicDdsTextureLoader";

// S3DObj::FrameMove2: uma volta completa a cada três segundos.
const PREVIEW_TURN_RADIANS_PER_SECOND = (Math.PI * 2) / 3;
const PREVIEW_MODEL_SPAN = 2.7;
// A bolsa pode referenciar milhares de itens. Manter uma cópia materializada
// de cada preview transformava a navegação pelo inventário em crescimento de
// memória GPU sem limite, especialmente caro no Safari/iOS.
const MAX_CACHED_PREVIEW_INSTANCES = 12;

interface PreviewRefinementState {
  readonly enabled: { value: number };
  readonly uvProgress: { value: number };
  readonly texture: THREE.Texture;
  readonly textureIndex: number;
}

/** Renders the selected mesh directly over its inventory slot, without a popup. */
export class ClassicInventoryPreview {
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(34, 1, 0.05, 100);
  readonly #content = new THREE.Group();
  readonly #renderer: THREE.WebGLRenderer | null;
  readonly #retained = new Map<number, Promise<THREE.Group | null>>();
  readonly #instances = new Map<string, THREE.Group>();
  readonly #refinementTextures = new Map<number, Promise<THREE.Texture | null>>();
  readonly #ownedMaterials = new Set<THREE.Material>();
  readonly #ownedTextures = new Set<THREE.Texture>();
  readonly #loader = new ClassicDdsTextureLoader();
  #active: THREE.Group | null = null;
  #activeRefinement: PreviewRefinementState | null = null;
  #selectedKey: string | null = null;
  #selectedModelType: number | null = null;
  #selectionGeneration = 0;
  #disposed = false;
  #effectsEnabled = true;
  #renderWidth = 0;
  #renderHeight = 0;

  constructor(
    sourceRenderer: THREE.WebGLRenderer,
    private readonly models: ModelLibrary,
    private readonly assets: ClassicAssetSource,
    private readonly root: HTMLElement,
    private readonly viewport: HTMLElement,
  ) {
    this.#scene.name = "classic-inventory-preview";
    this.#scene.background = null;
    this.#scene.add(this.#content);
    this.#scene.add(new THREE.HemisphereLight(0xe8f3ff, 0x443522, 0.45));
    const key = new THREE.DirectionalLight(0xffdfae, 0.65);
    key.position.set(-3, 5, 4);
    this.#scene.add(key);
    const rim = new THREE.DirectionalLight(0x7db9ff, 0.25);
    rim.position.set(4, 1, -3);
    this.#scene.add(rim);
    this.#camera.position.set(0, 0.15, 5.2);
    this.#camera.lookAt(0, 0, 0);

    let previewRenderer: THREE.WebGLRenderer | null = null;
    try {
      // O modelo precisa ficar acima da janela HTML do inventário. Um canvas
      // pequeno e transparente evita qualquer popup e mantém o 3D preso ao slot.
      previewRenderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "low-power",
      });
      previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      previewRenderer.outputColorSpace = sourceRenderer.outputColorSpace;
      previewRenderer.toneMapping = sourceRenderer.toneMapping;
      previewRenderer.toneMappingExposure = sourceRenderer.toneMappingExposure;
      previewRenderer.setClearColor(0x000000, 0);
      previewRenderer.domElement.className = "inventory-preview-canvas";
      previewRenderer.domElement.setAttribute("aria-hidden", "true");
      this.viewport.prepend(previewRenderer.domElement);
    } catch (error) {
      console.warn("Preview 3D integrado ao inventário indisponível", error);
    }
    this.#renderer = previewRenderer;
  }

  setItem(item: InventoryItem | null): void {
    if (this.#disposed) return;
    const selectedKey = item
      ? `${item.key}:${item.previewModelType ?? "sprite"}:${item.refinement ?? 0}:${Number(item.ancient ?? false)}:${item.refinementTextureIndex ?? 0}`
      : null;
    if (selectedKey === this.#selectedKey) return;
    this.#selectedKey = selectedKey;
    this.#selectedModelType = item?.previewModelType ?? null;
    const generation = ++this.#selectionGeneration;
    this.setActive(null);
    this.root.classList.remove("is-model", "is-loading", "is-fallback");
    if (!item) return;
    const cacheKey = selectedKey;
    if (!cacheKey) return;
    const type = item.previewModelType;
    if (type === undefined || !this.#renderer) {
      this.root.classList.add("is-fallback");
      return;
    }
    const cachedInstance = this.#instances.get(cacheKey);
    if (cachedInstance) {
      // A ordem de inserção do Map funciona como um LRU compacto.
      this.#instances.delete(cacheKey);
      this.#instances.set(cacheKey, cachedInstance);
      this.setActive(cachedInstance);
      return;
    }
    this.root.classList.add("is-loading");
    void this.retain(type).then(async (prototype) => {
      if (this.#disposed || generation !== this.#selectionGeneration) {
        this.releaseRetainedIfUnused(type);
        return;
      }
      this.root.classList.remove("is-loading");
      if (!prototype) {
        this.root.classList.add("is-fallback");
        return;
      }
      const model = prototype.clone(true);
      model.name = `inventory-preview-mesh-${type}`;
      await this.applyClassicUiMaterial(model, item);
      if (this.#disposed || generation !== this.#selectionGeneration) {
        this.releaseOwnedMaterials(model);
        return;
      }
      if (!fitModel(model)) {
        this.releaseOwnedMaterials(model);
        this.root.classList.add("is-fallback");
        return;
      }
      // Rotate a centered parent pivot; rotating the offset mesh itself would
      // orbit around the MSA authoring origin instead of spinning in place.
      const instance = new THREE.Group();
      instance.name = `inventory-preview-model-${type}`;
      instance.add(model);
      instance.userData.refinement = model.userData.refinement;
      instance.userData.previewModelType = type;
      this.#instances.set(cacheKey, instance);
      this.setActive(instance);
      this.trimInstanceCache();
    });
  }

  setEffectsEnabled(enabled: boolean): void {
    this.#effectsEnabled = enabled;
    for (const instance of this.#instances.values()) {
      const refinement = instance.userData.refinement as PreviewRefinementState | undefined;
      if (refinement) refinement.enabled.value = enabled ? 1 : 0;
    }
    this.root.classList.toggle("effects-disabled", !enabled);
  }

  update(deltaSeconds: number): void {
    if (!this.#active || this.#disposed) return;
    this.#active.rotation.y = THREE.MathUtils.euclideanModulo(
      this.#active.rotation.y + Math.max(0, deltaSeconds) * PREVIEW_TURN_RADIANS_PER_SECOND,
      Math.PI * 2,
    );
    if (this.#activeRefinement) {
      // TMMesh::Render(1) soma (serverTime % 4000) / 4000 em U e V.
      this.#activeRefinement.uvProgress.value = (
        this.#activeRefinement.uvProgress.value + Math.max(0, deltaSeconds) / 4
      ) % 1;
    }
  }

  /** Call immediately after the main world render. */
  render(): void {
    const renderer = this.#renderer;
    if (
      this.#disposed
      || !renderer
      || !this.#active
      || !this.root.classList.contains("has-item")
      || !this.root.classList.contains("is-inventory-visible")
      || !this.root.isConnected
    ) return;

    const width = Math.max(1, this.viewport.clientWidth);
    const height = Math.max(1, this.viewport.clientHeight);
    if (width !== this.#renderWidth || height !== this.#renderHeight) {
      this.#renderWidth = width;
      this.#renderHeight = height;
      renderer.setSize(width, height, false);
    }
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
    renderer.render(this.#scene, this.#camera);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#selectionGeneration++;
    this.setActive(null);
    for (const type of this.#retained.keys()) this.models.release(type);
    this.#retained.clear();
    this.#instances.clear();
    for (const material of this.#ownedMaterials) material.dispose();
    for (const texture of this.#ownedTextures) texture.dispose();
    this.#ownedMaterials.clear();
    this.#ownedTextures.clear();
    this.#refinementTextures.clear();
    this.#scene.clear();
    this.#renderer?.dispose();
    this.#renderer?.forceContextLoss();
    this.#renderer?.domElement.remove();
  }

  private retain(type: number): Promise<THREE.Group | null> {
    let retained = this.#retained.get(type);
    if (!retained) {
      retained = this.models.retain(type).catch((error: unknown) => {
        console.warn(`Preview clássico: mesh ${type} indisponível`, error);
        return null;
      });
      this.#retained.set(type, retained);
    }
    return retained;
  }

  private setActive(instance: THREE.Group | null): void {
    if (this.#active) this.#content.remove(this.#active);
    this.#active = instance;
    this.#activeRefinement = instance?.userData.refinement as PreviewRefinementState | undefined ?? null;
    this.root.classList.toggle("has-refinement", this.#activeRefinement !== null);
    if (instance) {
      this.#content.add(instance);
      this.root.classList.add("is-model");
      this.root.classList.remove("is-fallback", "is-loading");
    } else {
      this.root.classList.remove("is-model");
    }
  }

  private trimInstanceCache(): void {
    while (this.#instances.size > MAX_CACHED_PREVIEW_INSTANCES) {
      const oldest = this.#instances.entries().next().value as
        | [string, THREE.Group]
        | undefined;
      if (!oldest) return;
      const [key, instance] = oldest;
      // O item ativo normalmente é o mais novo. Esta guarda evita remover o
      // objeto visível caso a ordem seja alterada por uma chamada futura.
      if (instance === this.#active) {
        this.#instances.delete(key);
        this.#instances.set(key, instance);
        continue;
      }
      this.#instances.delete(key);
      this.releaseInstance(instance);
    }
  }

  private releaseInstance(instance: THREE.Group): void {
    instance.removeFromParent();
    this.releaseOwnedMaterials(instance);
    const type = instance.userData.previewModelType;
    if (typeof type === "number") this.releaseRetainedIfUnused(type);
    instance.clear();
  }

  private releaseRetainedIfUnused(type: number): void {
    if (this.#selectedModelType === type) return;
    for (const instance of this.#instances.values()) {
      if (instance.userData.previewModelType === type) return;
    }
    if (!this.#retained.delete(type)) return;
    this.models.release(type);
  }

  private async applyClassicUiMaterial(model: THREE.Group, item: InventoryItem): Promise<void> {
    const textureIndex = item.refinementTextureIndex;
    const refinementTexture = item.ancient && textureIndex !== undefined
      ? await this.loadRefinementTexture(textureIndex)
      : null;
    const refinement: PreviewRefinementState | null = refinementTexture && textureIndex !== undefined
      ? {
          enabled: { value: this.#effectsEnabled ? 1 : 0 },
          uvProgress: { value: 0 },
          texture: refinementTexture,
          textureIndex,
        }
      : null;

    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const source = Array.isArray(child.material) ? child.material : [child.material];
      const materials = source.map((entry) => {
        const material = entry.clone();
        if (material instanceof THREE.MeshLambertMaterial) {
          if (refinement) configureClassicRefinement(material, refinement);
        }
        this.#ownedMaterials.add(material);
        return material;
      });
      child.material = Array.isArray(child.material) ? materials : materials[0]!;
    });
    model.userData.refinement = refinement;
  }

  private loadRefinementTexture(index: number): Promise<THREE.Texture | null> {
    let job = this.#refinementTextures.get(index);
    if (job) return job;
    const url = this.assets.effectTextureUrl(index);
    if (!url) return Promise.resolve(null);
    job = this.#loader.loadAsync(url)
      .then((texture) => {
        if (this.#disposed) {
          texture.dispose();
          return null;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.needsUpdate = true;
        this.#ownedTextures.add(texture);
        return texture;
      })
      .catch((error: unknown) => {
        console.warn(`Preview clássico: multitextura ${index} indisponível`, error);
        return null;
      });
    this.#refinementTextures.set(index, job);
    return job;
  }

  private releaseOwnedMaterials(model: THREE.Object3D): void {
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (!this.#ownedMaterials.delete(material)) continue;
        material.dispose();
      }
    });
  }
}

/** Shader equivalente ao passe MODULATE2X + ADDSMOOTH do RenderForUI. */
function configureClassicRefinement(
  material: THREE.MeshLambertMaterial,
  refinement: PreviewRefinementState,
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
          vec3 wydRefinementColor = texture2D(wydRefinementMap, wydRefinementUv).rgb;
          vec3 wydModulate2x = min(outgoingLight * 2.0, vec3(1.0));
          vec3 wydAddSmooth = wydModulate2x + wydRefinementColor
            - (wydModulate2x * wydRefinementColor);
          outgoingLight = mix(outgoingLight, wydAddSmooth, wydRefinementEnabled);
        #endif
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => `wyd-inventory-refinement-${refinement.textureIndex}-v1`;
}

function fitModel(instance: THREE.Group): boolean {
  instance.position.set(0, 0, 0);
  instance.rotation.set(0, 0, 0);
  instance.scale.set(1, 1, 1);
  instance.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(instance);
  if (bounds.isEmpty()) return false;
  const size = bounds.getSize(new THREE.Vector3());
  const largest = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(largest) || largest <= 1e-5) return false;
  instance.scale.setScalar(PREVIEW_MODEL_SPAN / largest);
  instance.updateWorldMatrix(true, true);
  const fittedBounds = new THREE.Box3().setFromObject(instance);
  const center = fittedBounds.getCenter(new THREE.Vector3());
  instance.position.sub(center);
  return true;
}
