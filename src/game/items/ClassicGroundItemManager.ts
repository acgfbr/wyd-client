import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import {
  loadClassicCommerceCatalog,
  type ClassicCommerceItem,
} from "../commerce/ClassicCommerceCatalog";
import type { ClassicWorld } from "../../world/ClassicWorld";
import { toScene, type WydPosition } from "../../world/coordinates";
import { ClassicDdsTextureLoader } from "../../render/textures/ClassicDdsTextureLoader";
import type {
  ClassicGroundItemEffect,
  ClassicGroundItemEffects,
  ClassicGroundItemQuarterTurns,
  ClassicGroundItemSnapshot,
} from "./ClassicGroundItemTypes";

export const CLASSIC_GROUND_ITEM_ID_USER_DATA_KEY = "classicGroundItemId";

const CLASSIC_ITEM_COUNT = 6_500;
const CLASSIC_ITEM_EFFECT_TYPE = 38;
const CLASSIC_HP_RECOVERY_EFFECT_TYPE = 4;
const CLASSIC_ITEM_FLOOR_OFFSET = 0.1;
const CLASSIC_ITEM_LABEL_HEIGHT = 0.3;
const CLASSIC_GLOW_LOCAL_HEIGHT = 0.1;
const CLASSIC_GLOW_DIAMETER = 0.8;
const HALF_PI = Math.PI / 2;

export interface ClassicGroundItemMetadata {
  readonly classicIndex: number;
  readonly name: string;
  readonly mesh: number;
  readonly texture: number;
  readonly visualEffect: number;
  readonly grade: number;
  /** Result of BASE_GetItemAbility(item, EF38), including the three instance effects. */
  readonly itemType: number;
  readonly item: ClassicCommerceItem;
}

export interface ClassicGroundItemManagerOptions {
  /** Starts enabled just like the retail client. It can be changed later. */
  readonly effectsEnabled?: boolean;
  /**
   * The manager normally owns a child layer of ClassicWorld. Set this to false
   * only when an external scene graph owner will attach `object` itself.
   */
  readonly attachToWorld?: boolean;
}

interface GroundItemVisual {
  readonly root: THREE.Group;
  readonly model: THREE.Group;
  readonly hoverMeshes: readonly THREE.Mesh[];
  readonly label: THREE.Sprite;
  readonly labelTexture: THREE.CanvasTexture;
  readonly labelMaterial: THREE.SpriteMaterial;
  readonly glow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null;
  readonly glowPhase: number;
}

interface GroundItemEntry {
  readonly generation: number;
  readonly snapshot: ClassicGroundItemSnapshot;
  metadata: ClassicGroundItemMetadata | null;
  visual: GroundItemVisual | null;
  retainedMesh: number | null;
  retainReleased: boolean;
  job: Promise<void> | null;
}

/**
 * Client-side presentation of `MSG_CreateItem` ground items.
 *
 * TMFieldScene places ordinary items at Grid + 0.5, GroundGetMask * 0.1 + 0.1
 * and reflects its quarter-turn DirectX yaw into Three.js. TMItem keeps the
 * label hidden except during mouse-over and biases the material to white while
 * hot. This layer preserves those presentation rules but deliberately has no
 * pickup, drop, ownership or inventory mutation API.
 */
export class ClassicGroundItemManager {
  readonly object = new THREE.Group();

  readonly #entries = new Map<string, GroundItemEntry>();
  readonly #missingMeshes = new Set<number>();
  readonly #hoverMaterial = createHoverMaterial();
  readonly #hitGeometry = new THREE.BoxGeometry(1, 1, 1);
  readonly #hitMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    colorWrite: false,
  });
  readonly #glowGeometry = new THREE.PlaneGeometry(
    CLASSIC_GLOW_DIAMETER,
    CLASSIC_GLOW_DIAMETER,
  );
  #glowTexture: THREE.Texture = createRadialGlowTexture();
  readonly #glowMaterials = new Map<number, THREE.MeshBasicMaterial>();

  #generation = 0;
  #hoveredId: string | null = null;
  #labelsForced = false;
  #effectsEnabled: boolean;
  #elapsedSeconds = 0;
  #disposed = false;
  #attachedToWorld = false;

  constructor(
    private readonly world: ClassicWorld,
    private readonly assets: ClassicAssetSource,
    options: ClassicGroundItemManagerOptions = {},
  ) {
    this.object.name = "classic-ground-items";
    this.#effectsEnabled = options.effectsEnabled ?? true;
    if (options.attachToWorld !== false) {
      world.object.add(this.object);
      this.#attachedToWorld = true;
    }
    void this.loadClassicGlowTexture();
  }

  get size(): number {
    return this.#entries.size;
  }

  get effectsEnabled(): boolean {
    return this.#effectsEnabled;
  }

  get(id: string): ClassicGroundItemSnapshot | null {
    return this.#entries.get(id)?.snapshot ?? null;
  }

  /** True only after ItemList metadata and the retained MSA visual both exist. */
  isMaterialized(id: string): boolean {
    return this.#entries.get(id)?.visual != null;
  }

  snapshots(): readonly ClassicGroundItemSnapshot[] {
    return Object.freeze([...this.#entries.values()].map((entry) => entry.snapshot));
  }

  /** ItemList metadata becomes available once the lazy commerce catalog resolves. */
  metadata(id: string): ClassicGroundItemMetadata | null {
    return this.#entries.get(id)?.metadata ?? null;
  }

  /**
   * Inserts or replaces a visual. Awaiting is optional; stale asynchronous MSA
   * loads can never attach after a newer upsert/remove/clear.
   */
  upsert(snapshot: ClassicGroundItemSnapshot): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    const normalized = normalizeSnapshot(snapshot);
    const old = this.#entries.get(normalized.id);
    if (old) this.disposeEntry(old);

    const entry: GroundItemEntry = {
      generation: ++this.#generation,
      snapshot: normalized,
      metadata: null,
      visual: null,
      retainedMesh: null,
      retainReleased: false,
      job: null,
    };
    this.#entries.set(normalized.id, entry);
    const job = this.materialize(entry).catch((error: unknown) => {
      if (this.isCurrent(entry)) {
        console.warn(`Item clássico ${normalized.classicIndex} indisponível`, error);
      }
    }).finally(() => {
      if (entry.job === job) entry.job = null;
    });
    entry.job = job;
    return job;
  }

  remove(id: string): boolean {
    const entry = this.#entries.get(id);
    if (!entry) return false;
    this.#entries.delete(id);
    if (this.#hoveredId === id) this.#hoveredId = null;
    this.disposeEntry(entry);
    return true;
  }

  clear(): void {
    this.#generation++;
    this.#hoveredId = null;
    for (const entry of this.#entries.values()) this.disposeEntry(entry);
    this.#entries.clear();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clear();
    if (this.#attachedToWorld) this.object.removeFromParent();
    this.#attachedToWorld = false;
    this.object.clear();
    this.#hoverMaterial.dispose();
    this.#hitGeometry.dispose();
    this.#hitMaterial.dispose();
    this.#glowGeometry.dispose();
    for (const material of this.#glowMaterials.values()) material.dispose();
    this.#glowMaterials.clear();
    this.#glowTexture.dispose();
  }

  setEffectsEnabled(enabled: boolean): void {
    if (this.#disposed || enabled === this.#effectsEnabled) return;
    this.#effectsEnabled = enabled;
    for (const entry of this.#entries.values()) {
      if (entry.visual?.glow) entry.visual.glow.visible = enabled;
    }
  }

  /** Global hotkey state: reveal every resident ground-item name without hover. */
  setAllLabelsVisible(visible: boolean): void {
    if (this.#disposed || visible === this.#labelsForced) return;
    this.#labelsForced = visible;
    for (const entry of this.#entries.values()) {
      if (entry.visual) {
        entry.visual.label.visible = visible || entry.snapshot.id === this.#hoveredId;
      }
    }
  }

  /** The label is normally hidden; hover reveals it and a white emissive pass. */
  setHovered(id: string | null): void {
    if (this.#disposed) return;
    const next = id !== null && this.#entries.has(id) ? id : null;
    if (next === this.#hoveredId) return;
    if (this.#hoveredId) this.applyHover(this.#entries.get(this.#hoveredId), false);
    this.#hoveredId = next;
    if (next) this.applyHover(this.#entries.get(next), true);
  }

  itemFromObject(object: THREE.Object3D | null): ClassicGroundItemSnapshot | null {
    for (let current = object; current; current = current.parent) {
      const id = current.userData[CLASSIC_GROUND_ITEM_ID_USER_DATA_KEY];
      if (typeof id === "string") return this.get(id);
      if (current === this.object) break;
    }
    return null;
  }

  update(deltaSeconds: number): void {
    if (this.#disposed) return;
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    this.#elapsedSeconds = (this.#elapsedSeconds + delta) % 1_000;
    for (const entry of this.#entries.values()) {
      const visual = entry.visual;
      if (!visual) continue;
      // Terrain may arrive after MSG_CreateItem. Resampling keeps the item on
      // the authoritative bridge/terrain mask once its Field becomes resident.
      visual.root.position.y = this.world.heightAt(centeredPosition(entry.snapshot.position))
        + CLASSIC_ITEM_FLOOR_OFFSET;
      if (visual.glow && this.#effectsEnabled) {
        const pulse = 0.96 + Math.sin((this.#elapsedSeconds + visual.glowPhase) * 2.5) * 0.04;
        visual.glow.scale.setScalar(pulse);
      }
    }
  }

  private async materialize(entry: GroundItemEntry): Promise<void> {
    const catalog = await loadClassicCommerceCatalog();
    if (!this.isCurrent(entry)) return;
    const item = catalog.item(entry.snapshot.classicIndex);
    if (!item || item.index <= 0) {
      throw new Error(`ItemList não contém o índice ${entry.snapshot.classicIndex}`);
    }

    const itemType = classicItemAbility(item, entry.snapshot.effects, CLASSIC_ITEM_EFFECT_TYPE);
    entry.metadata = Object.freeze({
      classicIndex: item.index,
      name: displayItemName(item.name),
      mesh: item.mesh,
      texture: item.texture,
      visualEffect: item.visualEffect,
      grade: item.grade,
      itemType,
      item,
    });

    if (!Number.isInteger(item.mesh) || item.mesh < 0) {
      throw new Error(`ItemList #${item.index} possui mesh inválida (${item.mesh})`);
    }
    entry.retainedMesh = item.mesh;
    entry.retainReleased = false;
    const prototype = await this.world.models.retain(item.mesh).catch((error: unknown) => {
      this.releaseRetain(entry);
      throw error;
    });
    if (!this.isCurrent(entry)) return;
    if (!prototype) {
      this.releaseRetain(entry);
      if (!this.#missingMeshes.has(item.mesh)) {
        this.#missingMeshes.add(item.mesh);
        const imported = this.assets.manifest.objectModels[String(item.mesh)] !== undefined;
        console.warn(
          `Mesh clássica ${item.mesh} do item #${item.index} não foi materializada`
            + (imported ? "." : "; execute novamente bun run import:classic."),
        );
      }
      return;
    }

    const visual = this.createVisual(entry, prototype, entry.metadata);
    if (!this.isCurrent(entry)) {
      disposeVisual(visual);
      return;
    }
    entry.visual = visual;
    this.object.add(visual.root);
    this.applyTransform(entry);
    this.applyHover(entry, this.#hoveredId === entry.snapshot.id);
  }

  private createVisual(
    entry: GroundItemEntry,
    prototype: THREE.Group,
    metadata: ClassicGroundItemMetadata,
  ): GroundItemVisual {
    const id = entry.snapshot.id;
    const root = new THREE.Group();
    root.name = `ground-item-${id}`;
    markGroundItem(root, id);

    const model = prototype.clone(true);
    model.name = `ground-item-model-${metadata.mesh}`;
    const sourceMeshes: THREE.Mesh[] = [];
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      sourceMeshes.push(child);
      markGroundItem(child, id);
    });
    root.add(model);

    const hoverMeshes = sourceMeshes.map((source, index) => {
      const overlay = new THREE.Mesh(source.geometry, this.#hoverMaterial);
      overlay.name = `ground-item-hover-${index}`;
      overlay.visible = false;
      overlay.castShadow = false;
      overlay.receiveShadow = false;
      overlay.renderOrder = source.renderOrder + 1;
      overlay.raycast = () => undefined;
      source.add(overlay);
      return overlay;
    });

    const labelColor = metadata.itemType === 4 || metadata.itemType === 5
      ? "#ffffaa"
      : "#aaaaff";
    const labelResult = createItemLabel(metadata.name, labelColor);
    labelResult.sprite.position.y = CLASSIC_ITEM_LABEL_HEIGHT;
    labelResult.sprite.visible = false;
    root.add(labelResult.sprite);

    // TMItem::IsMouseOver uses a fixed crossed 1.2 x 0.7 rectangle instead of
    // the rendered triangles. An invisible box gives Three.js the same forgiving
    // hit area and remains available even for unusually thin item meshes.
    const hit = new THREE.Mesh(this.#hitGeometry, this.#hitMaterial);
    const radius = metadata.mesh === 1_607
      ? 1
      : entry.snapshot.classicIndex >= 3_145 && entry.snapshot.classicIndex <= 3_149
        ? 3
        : 0.6;
    const height = entry.snapshot.classicIndex >= 3_145 && entry.snapshot.classicIndex <= 3_149
      ? 3
      : 0.7;
    hit.name = "ground-item-pick-volume";
    hit.position.y = height / 2;
    hit.scale.set(radius * 2, height, radius * 2);
    markGroundItem(hit, id);
    root.add(hit);

    const glowColor = classicItemGlowColor(
      metadata.itemType,
      entry.snapshot.classicIndex,
      classicItemAbility(metadata.item, entry.snapshot.effects, CLASSIC_HP_RECOVERY_EFFECT_TYPE),
    );
    const glow = glowColor === null ? null : this.createGlow(glowColor);
    if (glow) {
      glow.visible = this.#effectsEnabled;
      root.add(glow);
    }

    return {
      root,
      model,
      hoverMeshes,
      label: labelResult.sprite,
      labelTexture: labelResult.texture,
      labelMaterial: labelResult.material,
      glow,
      glowPhase: stablePhase(id),
    };
  }

  private createGlow(color: number): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
    let material = this.#glowMaterials.get(color);
    if (!material) {
      material = new THREE.MeshBasicMaterial({
        color,
        map: this.#glowTexture,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      this.#glowMaterials.set(color, material);
    }
    const glow = new THREE.Mesh(this.#glowGeometry, material);
    glow.name = "ground-item-classic-ef38-glow";
    glow.position.y = CLASSIC_GLOW_LOCAL_HEIGHT;
    glow.rotation.x = -Math.PI / 2;
    glow.renderOrder = 2;
    glow.raycast = () => undefined;
    return glow;
  }

  private async loadClassicGlowTexture(): Promise<void> {
    const url = this.assets.effectTextureUrl(2);
    if (!url) return;
    const texture = await new ClassicDdsTextureLoader().loadAsync(url).catch((error: unknown) => {
      console.warn("Textura clássica #2 do brilho de item indisponível; usando fallback", error);
      return null;
    });
    if (!texture) return;
    if (this.#disposed) {
      texture.dispose();
      return;
    }
    texture.name = "classic-ground-item-effect-002";
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.offset.set(0.02, 0.98);
    texture.repeat.set(0.96, -0.96);
    texture.anisotropy = 4;
    texture.needsUpdate = true;

    const fallback = this.#glowTexture;
    this.#glowTexture = texture;
    for (const material of this.#glowMaterials.values()) {
      material.map = texture;
      material.needsUpdate = true;
    }
    fallback.dispose();
  }

  private applyTransform(entry: GroundItemEntry): void {
    const visual = entry.visual;
    if (!visual) return;
    const position = centeredPosition(entry.snapshot.position);
    const scene = toScene(position, this.world.origin);
    visual.root.position.set(
      scene.x,
      this.world.heightAt(position) + CLASSIC_ITEM_FLOOR_OFFSET,
      scene.z,
    );
    // DirectX yaw becomes negative after the WYD Z axis is reflected.
    visual.root.rotation.y = -entry.snapshot.rotateQuarterTurns * HALF_PI;
  }

  private applyHover(entry: GroundItemEntry | undefined, hovered: boolean): void {
    const visual = entry?.visual;
    if (!visual) return;
    visual.label.visible = hovered || this.#labelsForced;
    for (const overlay of visual.hoverMeshes) overlay.visible = hovered;
  }

  private isCurrent(entry: GroundItemEntry): boolean {
    return !this.#disposed
      && this.#entries.get(entry.snapshot.id) === entry
      && entry.generation <= this.#generation;
  }

  private disposeEntry(entry: GroundItemEntry): void {
    if (entry.visual) {
      disposeVisual(entry.visual);
      entry.visual = null;
    }
    this.releaseRetain(entry);
    entry.metadata = null;
  }

  private releaseRetain(entry: GroundItemEntry): void {
    if (entry.retainedMesh === null || entry.retainReleased) return;
    entry.retainReleased = true;
    this.world.models.release(entry.retainedMesh);
    entry.retainedMesh = null;
  }
}

function normalizeSnapshot(snapshot: ClassicGroundItemSnapshot): ClassicGroundItemSnapshot {
  if (!snapshot || typeof snapshot !== "object") throw new TypeError("Snapshot de item ausente");
  if (typeof snapshot.id !== "string" || snapshot.id.length === 0) {
    throw new TypeError("Item no chão precisa de id não vazio");
  }
  if (!Number.isInteger(snapshot.classicIndex) || snapshot.classicIndex <= 0 || snapshot.classicIndex >= CLASSIC_ITEM_COUNT) {
    throw new RangeError(`Índice clássico inválido: ${snapshot.classicIndex}`);
  }
  if (!isQuarterTurns(snapshot.rotateQuarterTurns)) {
    throw new RangeError(`Rotação clássica inválida: ${snapshot.rotateQuarterTurns}`);
  }
  if (!Number.isFinite(snapshot.position?.x) || !Number.isFinite(snapshot.position?.y)) {
    throw new TypeError("Posição do item precisa ser finita");
  }
  if (!Array.isArray(snapshot.effects) || snapshot.effects.length !== 3) {
    throw new TypeError("STRUCT_ITEM precisa de exatamente três efeitos de instância");
  }
  const effects = snapshot.effects.map(normalizeEffect) as unknown as ClassicGroundItemEffects;
  const owner = snapshot.owner;
  if (owner !== undefined && owner !== null && typeof owner !== "string" && typeof owner !== "number") {
    throw new TypeError("Owner do item precisa ser string, number, null ou ausente");
  }
  return Object.freeze({
    id: snapshot.id,
    classicIndex: snapshot.classicIndex,
    effects: Object.freeze(effects) as ClassicGroundItemEffects,
    position: Object.freeze({ x: snapshot.position.x, y: snapshot.position.y }),
    rotateQuarterTurns: snapshot.rotateQuarterTurns,
    ...(owner === undefined ? {} : { owner }),
    createFx: Boolean(snapshot.createFx),
  });
}

function normalizeEffect(effect: ClassicGroundItemEffect, index: number): ClassicGroundItemEffect {
  if (!effect || !Number.isInteger(effect.effect) || !Number.isInteger(effect.value)) {
    throw new TypeError(`Efeito de instância ${index} inválido`);
  }
  return Object.freeze({ effect: effect.effect, value: effect.value });
}

function isQuarterTurns(value: number): value is ClassicGroundItemQuarterTurns {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

function centeredPosition(position: WydPosition): WydPosition {
  return { x: position.x + 0.5, y: position.y + 0.5 };
}

function classicItemAbility(
  item: ClassicCommerceItem,
  instanceEffects: ClassicGroundItemEffects,
  effectType: number,
): number {
  let value = 0;
  for (const effect of item.effects) {
    if (effect.effect === effectType) value += effect.value;
  }
  for (const effect of instanceEffects) {
    if (effect.effect === effectType) value += effect.value;
  }
  return value;
}

function classicItemGlowColor(itemType: number, classicIndex: number, hpRecovery: number): number | null {
  switch (itemType) {
    case 1:
      if (hpRecovery <= 0) return 0x000066;
      return classicIndex === 1_739 ? 0xaa8888 : 0x660000;
    case 2:
    case 3:
      return 0x666600;
    case 4:
      return 0x774400;
    case 5:
      return 0x440077;
    case 10:
      return 0x006600;
    default:
      return null;
  }
}

function createHoverMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.44,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

function createItemLabel(
  text: string,
  color: string,
): { readonly sprite: THREE.Sprite; readonly texture: THREE.CanvasTexture; readonly material: THREE.SpriteMaterial } {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = "600 20px Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineWidth = 4;
    context.strokeStyle = "rgba(0, 0, 0, .9)";
    context.strokeText(text, 128, 16, 246);
    context.fillStyle = color;
    context.fillText(text, 128, 16, 246);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.name = "ground-item-name-label";
  sprite.scale.set(2.4, 0.3, 1);
  sprite.renderOrder = 1_200;
  sprite.raycast = () => undefined;
  return { sprite, texture, material };
}

function createRadialGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255, 255, 255, .95)");
    gradient.addColorStop(0.42, "rgba(255, 255, 255, .55)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function displayItemName(name: string): string {
  return name.replaceAll("_", " ").trim() || "Item sem nome";
}

function stablePhase(id: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 0xffff_ffff * Math.PI * 2;
}

function markGroundItem(object: THREE.Object3D, id: string): void {
  object.userData[CLASSIC_GROUND_ITEM_ID_USER_DATA_KEY] = id;
}

function disposeVisual(visual: GroundItemVisual): void {
  visual.root.removeFromParent();
  for (const overlay of visual.hoverMeshes) overlay.removeFromParent();
  visual.label.removeFromParent();
  visual.labelTexture.dispose();
  visual.labelMaterial.dispose();
  visual.root.clear();
}
