import * as THREE from "three";
import type { InventoryItem } from "../../game/state/PlayerState";
import type { ModelLibrary } from "../objects/ModelLibrary";

const PREVIEW_TURN_RADIANS_PER_SECOND = 0.72;
const PREVIEW_MODEL_SPAN = 2.7;

/**
 * Renders a second scene into the main canvas underneath a transparent DOM
 * viewport. Static MSA prototypes stay retained once per type until dispose.
 */
export class ClassicInventoryPreview {
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(34, 1, 0.05, 100);
  readonly #content = new THREE.Group();
  readonly #retained = new Map<number, Promise<THREE.Group | null>>();
  readonly #instances = new Map<number, THREE.Group>();
  #active: THREE.Group | null = null;
  #selectedKey: string | null = null;
  #selectionGeneration = 0;
  #disposed = false;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly models: ModelLibrary,
    private readonly root: HTMLElement,
    private readonly viewport: HTMLElement,
  ) {
    this.#scene.name = "classic-inventory-preview";
    this.#scene.background = new THREE.Color(0x070a0b);
    this.#scene.add(this.#content);
    this.#scene.add(new THREE.HemisphereLight(0xe8f3ff, 0x443522, 2.25));
    const key = new THREE.DirectionalLight(0xffdfae, 3.1);
    key.position.set(-3, 5, 4);
    this.#scene.add(key);
    const rim = new THREE.DirectionalLight(0x7db9ff, 1.5);
    rim.position.set(4, 1, -3);
    this.#scene.add(rim);
    this.#camera.position.set(0, 0.15, 5.2);
    this.#camera.lookAt(0, 0, 0);
  }

  setItem(item: InventoryItem | null): void {
    if (this.#disposed) return;
    const selectedKey = item ? `${item.key}:${item.previewModelType ?? "sprite"}` : null;
    if (selectedKey === this.#selectedKey) return;
    this.#selectedKey = selectedKey;
    const generation = ++this.#selectionGeneration;
    this.setActive(null);
    this.root.classList.remove("is-model", "is-loading", "is-fallback");
    if (!item) return;
    const type = item.previewModelType;
    if (type === undefined) {
      this.root.classList.add("is-fallback");
      return;
    }
    const cachedInstance = this.#instances.get(type);
    if (cachedInstance) {
      this.setActive(cachedInstance);
      return;
    }
    this.root.classList.add("is-loading");
    void this.retain(type).then((prototype) => {
      if (this.#disposed || generation !== this.#selectionGeneration) return;
      this.root.classList.remove("is-loading");
      if (!prototype) {
        this.root.classList.add("is-fallback");
        return;
      }
      const model = prototype.clone(true);
      model.name = `inventory-preview-mesh-${type}`;
      if (!fitModel(model)) {
        this.root.classList.add("is-fallback");
        return;
      }
      // Rotate a centered parent pivot; rotating the offset mesh itself would
      // orbit around the MSA authoring origin instead of spinning in place.
      const instance = new THREE.Group();
      instance.name = `inventory-preview-model-${type}`;
      instance.add(model);
      this.#instances.set(type, instance);
      this.setActive(instance);
    });
  }

  update(deltaSeconds: number): void {
    if (!this.#active || this.#disposed) return;
    this.#active.rotation.y = THREE.MathUtils.euclideanModulo(
      this.#active.rotation.y + Math.max(0, deltaSeconds) * PREVIEW_TURN_RADIANS_PER_SECOND,
      Math.PI * 2,
    );
  }

  /** Call immediately after the main world render. */
  render(): void {
    if (
      this.#disposed
      || !this.#active
      || !this.root.classList.contains("is-inventory-visible")
      || !this.root.classList.contains("has-item")
      || getComputedStyle(this.viewport).visibility !== "visible"
    ) return;

    const canvasRect = this.renderer.domElement.getBoundingClientRect();
    const viewportRect = this.viewport.getBoundingClientRect();
    const left = Math.max(canvasRect.left, viewportRect.left);
    const right = Math.min(canvasRect.right, viewportRect.right);
    const top = Math.max(canvasRect.top, viewportRect.top);
    const bottom = Math.min(canvasRect.bottom, viewportRect.bottom);
    if (right <= left || bottom <= top || canvasRect.width <= 0 || canvasRect.height <= 0) return;

    // WebGLRenderer applies its pixel ratio inside setViewport/setScissor;
    // these coordinates must remain in canvas CSS pixels (not drawing-buffer pixels).
    const x = Math.floor(left - canvasRect.left);
    const y = Math.floor(canvasRect.bottom - bottom);
    const width = Math.max(1, Math.ceil(right - left));
    const height = Math.max(1, Math.ceil(bottom - top));
    this.#camera.aspect = viewportRect.width / Math.max(1, viewportRect.height);
    this.#camera.updateProjectionMatrix();

    const previousViewport = this.renderer.getViewport(new THREE.Vector4());
    const previousScissor = this.renderer.getScissor(new THREE.Vector4());
    const previousScissorTest = this.renderer.getScissorTest();
    const previousAutoClear = this.renderer.autoClear;
    const previousRenderTarget = this.renderer.getRenderTarget();
    try {
      this.renderer.setRenderTarget(null);
      this.renderer.setViewport(x, y, width, height);
      this.renderer.setScissor(x, y, width, height);
      this.renderer.setScissorTest(true);
      this.renderer.autoClear = true;
      this.renderer.render(this.#scene, this.#camera);
    } finally {
      this.renderer.setRenderTarget(previousRenderTarget);
      this.renderer.setViewport(previousViewport);
      this.renderer.setScissor(previousScissor);
      this.renderer.setScissorTest(previousScissorTest);
      this.renderer.autoClear = previousAutoClear;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#selectionGeneration++;
    this.setActive(null);
    for (const type of this.#retained.keys()) this.models.release(type);
    this.#retained.clear();
    this.#instances.clear();
    this.#scene.clear();
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
    if (instance) {
      this.#content.add(instance);
      this.root.classList.add("is-model");
      this.root.classList.remove("is-fallback", "is-loading");
    } else {
      this.root.classList.remove("is-model");
    }
  }
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
