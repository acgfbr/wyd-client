import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { parseAni, type AniAnimation } from "../../formats/classic/Ani";
import { parseBon, type BonSkeleton } from "../../formats/classic/Bon";
import { parseMsh, type MshModel } from "../../formats/classic/Msh";
import { ClassicSkinnedModel, type ClassicSkinnedPart } from "../../render/characters/ClassicSkinnedModel";
import { ClassicDdsTextureLoader } from "../../render/textures/ClassicDdsTextureLoader";
import type { MonsterCatalog, MonsterTemplate, MonsterVisualFamily } from "./MonsterCatalog";

// Parsed assets are cheap to reuse but were previously retained for every map
// visited during the whole session. These LRU ceilings cover the current spawn
// window comfortably while bounding long exploration sessions. Live models
// keep direct references to their clips; evicting a cache entry never invalidates
// an actor that is already materialized.
const MAX_BUFFER_CACHE_ENTRIES = 256;
const MAX_SKELETON_CACHE_ENTRIES = 48;
const MAX_MESH_CACHE_ENTRIES = 192;
const MAX_ANIMATION_CACHE_ENTRIES = 256;
const MAX_DEFINITION_CACHE_ENTRIES = 64;

export interface ClassicSkinnedLookPart {
  readonly name?: string;
  readonly mesh: string;
  readonly texture: string | null;
  /** MeshTextureList cAlpha. `C` is rendered opaque without alpha test. */
  readonly alpha?: string | null;
}

/** Generic request shared by NPCs, monsters and future TMTree instances. */
export interface ClassicSkinnedLook {
  readonly skin: number;
  readonly parts: readonly ClassicSkinnedLookPart[];
  /** Allows player-only rigs that are not referenced by any NPC generator. */
  readonly family?: MonsterVisualFamily;
  readonly actions?: readonly string[];
  readonly initialAction?: string;
  /** Index selected by TMHuman::CheckWeapon for the classic animation bank. */
  readonly animationWeaponType?: number;
  /** Per-action overrides used when classic state changes select another bank. */
  readonly animationWeaponTypeByAction?: Readonly<Record<string, number>>;
  readonly actionVariant?: number;
  /** Overrides TMSkinMesh::m_dwFPS for rigs such as TMFloat (80 ms). */
  readonly quarterStepMs?: number;
}

export interface ClassicSkinnedInstanceLease {
  readonly model: ClassicSkinnedModel;
  readonly availableActions: readonly string[];
  actionDurationSeconds(name: string): number | null;
  /** Idempotent: frees per-instance geometry and releases shared GPU assets. */
  release(): void;
}

interface ParsedPart {
  readonly name?: string;
  readonly model: MshModel;
  readonly texture: string | null;
  readonly alpha: string | null;
}

interface ParsedDefinition {
  readonly skin: number;
  readonly skeleton: BonSkeleton;
  readonly parts: readonly ParsedPart[];
  readonly clips: readonly {
    readonly name: string;
    readonly animation: AniAnimation;
    readonly quarterStepMs: number;
    readonly loop: boolean;
  }[];
  readonly initialClip: string | null;
}

interface MaterialEntry {
  references: number;
  readonly promise: Promise<{ readonly material: THREE.MeshLambertMaterial; readonly texture: THREE.Texture | null }>;
}

/**
 * Lazy classic skin asset cache. Parsed CPU data remains reusable; GPU
 * materials/textures are reference-counted and disappear with the last actor.
 */
export class ClassicSkinnedAssetLibrary {
  readonly #dds = new ClassicDdsTextureLoader();
  readonly #buffers = new Map<string, Promise<ArrayBuffer | null>>();
  readonly #skeletons = new Map<string, Promise<BonSkeleton | null>>();
  readonly #meshes = new Map<string, Promise<MshModel | null>>();
  readonly #animations = new Map<string, Promise<AniAnimation | null>>();
  readonly #definitions = new Map<string, Promise<ParsedDefinition | null>>();
  readonly #materials = new Map<string, MaterialEntry>();

  constructor(
    private readonly assets: ClassicAssetSource,
    private readonly catalog: MonsterCatalog,
  ) {}

  createTemplateInstance(templateIndex: number): Promise<ClassicSkinnedInstanceLease | null> {
    const template = this.catalog.template(templateIndex);
    if (!template?.visual) return Promise.resolve(null);
    const animationWeaponType = classicNpcAnimationWeaponType(template, this.catalog);
    return this.createInstance({
      skin: template.visual.skin,
      parts: template.visual.parts.map((part) => ({
        name: `part-${part[0]}`,
        mesh: part[4],
        texture: part[5],
        alpha: part[6],
      })),
      actions: ["STAND01", "WALK", "ATTACK1", "STRIKE", "DIE", "DEAD"],
      initialAction: "STAND01",
      actionVariant: animationVariant(template),
      ...(animationWeaponType === undefined ? {} : { animationWeaponType }),
    });
  }

  dispose(): void {
    const materials = [...this.#materials.values()];
    this.#materials.clear();
    this.#buffers.clear();
    this.#skeletons.clear();
    this.#meshes.clear();
    this.#animations.clear();
    this.#definitions.clear();
    for (const entry of materials) {
      entry.references = 0;
      void entry.promise.then(({ material, texture }) => {
        material.dispose();
        texture?.dispose();
      }).catch(() => undefined);
    }
  }

  async createInstance(look: ClassicSkinnedLook): Promise<ClassicSkinnedInstanceLease | null> {
    const definition = await this.definition(look);
    if (!definition) return null;

    const materialKeys: string[] = [];
    try {
      const parts: ClassicSkinnedPart[] = [];
      for (const part of definition.parts) {
        const key = `${part.texture ?? `fallback:${definition.skin}`}|alpha:${part.alpha ?? "?"}`;
        const material = await this.retainMaterial(key, part.texture, definition.skin, part.alpha);
        materialKeys.push(key);
        parts.push({ name: part.name, model: part.model, material });
      }
      const model = new ClassicSkinnedModel({
        skeleton: definition.skeleton,
        parts,
        clips: definition.clips.map((clip) => ({
          name: clip.name,
          animation: clip.animation,
          quarterStepMs: clip.quarterStepMs,
          loop: clip.loop,
        })),
        initialClip: definition.initialClip ?? undefined,
        mirrorModelZ: true,
        axisMode: definition.skin >= 45 && definition.skin <= 57 ? "late" : "standard",
      });
      const actionDurations = new Map(definition.clips.map((clip) => [
        clip.name,
        (clip.animation.tickCount * 4 * clip.quarterStepMs) / 1_000,
      ]));
      let released = false;
      return {
        model,
        availableActions: [...actionDurations.keys()],
        actionDurationSeconds: (name) => actionDurations.get(name) ?? null,
        release: () => {
          if (released) return;
          released = true;
          model.object.removeFromParent();
          for (const mesh of model.meshes) {
            // WebGLRenderer lazily creates a boneTexture for larger rigs.
            // Geometry/material disposal does not release that GPU texture;
            // every streamed actor or BM re-summon owns its Skeleton instance.
            mesh.skeleton.dispose();
            mesh.geometry.dispose();
          }
          for (const key of materialKeys) this.releaseMaterial(key);
        },
      };
    } catch {
      for (const key of materialKeys) this.releaseMaterial(key);
      return null;
    }
  }

  private definition(look: ClassicSkinnedLook): Promise<ParsedDefinition | null> {
    const actions = [...new Set(look.actions?.length ? look.actions : ["STAND01"])];
    const actionVariant = Math.max(0, Math.min(3, Math.trunc(look.actionVariant ?? 0)));
    const animationWeaponTypeOverrides = Object.entries(look.animationWeaponTypeByAction ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([action, weaponType]) => `${action}:${weaponType}`)
      .join(",");
    const key = [
      look.skin,
      actions.join(","),
      look.initialAction ?? "",
      look.quarterStepMs ?? "source-fps",
      look.animationWeaponType ?? "base",
      animationWeaponTypeOverrides,
      actionVariant,
      ...look.parts.map((part) => `${part.mesh}>${part.texture ?? "-"}>${part.alpha ?? "?"}`),
    ].join("|");
    return cachedPromise(
      this.#definitions,
      key,
      MAX_DEFINITION_CACHE_ENTRIES,
      () => this.loadDefinition(look, actions, actionVariant).catch(() => null),
    );
  }

  private async loadDefinition(
    look: ClassicSkinnedLook,
    actions: readonly string[],
    actionVariant: number,
  ): Promise<ParsedDefinition | null> {
    const family = look.family ?? this.catalog.visualFamily(look.skin);
    if (!family?.skeleton || look.parts.length === 0) return null;
    const skeleton = await this.skeleton(family.skeleton);
    if (!skeleton) return null;
    const weaponAnimationTable = look.animationWeaponType === undefined
      && !look.animationWeaponTypeByAction
      ? null
      : buildClassicWeaponAnimationTable(family, look.skin);

    const parts = (await Promise.all(look.parts.map(async (part): Promise<ParsedPart | null> => {
      const model = await this.mesh(part.mesh);
      if (!model || model.influenceCount < 1) return null;
      return { name: part.name, model, texture: part.texture, alpha: part.alpha ?? null };
    }))).filter((part): part is ParsedPart => part !== null);
    if (parts.length === 0) return null;

    const clips = (await Promise.all(actions.map(async (action) => {
      const actionValues = family.actions?.[action];
      if (!actionValues && action !== "STAND01") return null;
      const pairOffset = actionValues && actionValues.length >= 9 ? actionVariant * 2 : 0;
      const clipSlot = actionValues?.[pairOffset] ?? actionValues?.[0] ?? 0;
      const quarterStepMs = Math.max(
        1,
        look.quarterStepMs ?? actionValues?.[pairOffset + 1] ?? actionValues?.[1] ?? 20,
      );
      const animationWeaponType = look.animationWeaponTypeByAction?.[action]
        ?? look.animationWeaponType;
      const clipPath = (animationWeaponType === undefined
        ? family.clips[clipSlot]
        : (weaponAnimationTable?.[animationWeaponType]?.[clipSlot]
          ?? family.clips[clipSlot]))
        ?? (action === "STAND01" ? family.clips.find((entry) => entry !== null) : null)
        ?? null;
      const animation = clipPath ? await this.animation(clipPath) : null;
      return animation ? {
        name: action,
        animation,
        quarterStepMs,
        loop: action === "STAND01"
          || action === "STAND02"
          || action === "WALK"
          || action === "RUN"
          || action === "MSTND01"
          || action === "MSTND02"
          || action === "MWALK"
          || action === "MRUN",
      } : null;
    }))).filter((clip): clip is NonNullable<typeof clip> => clip !== null);
    return {
      skin: look.skin,
      skeleton,
      parts,
      clips,
      initialClip: clips.some((clip) => clip.name === look.initialAction)
        ? (look.initialAction ?? null)
        : (clips[0]?.name ?? null),
    };
  }

  private buffer(file: string): Promise<ArrayBuffer | null> {
    return cachedPromise(
      this.#buffers,
      file,
      MAX_BUFFER_CACHE_ENTRIES,
      () => fetch(this.assets.dataUrl(file))
        .then((response) => response.ok ? response.arrayBuffer() : null)
        .catch(() => null),
    );
  }

  private skeleton(file: string): Promise<BonSkeleton | null> {
    return cachedPromise(
      this.#skeletons,
      file,
      MAX_SKELETON_CACHE_ENTRIES,
      () => this.buffer(file).then((buffer) => buffer ? parseBon(buffer) : null).catch(() => null),
    );
  }

  private mesh(file: string): Promise<MshModel | null> {
    return cachedPromise(
      this.#meshes,
      file,
      MAX_MESH_CACHE_ENTRIES,
      () => this.buffer(file).then((buffer) => buffer ? parseMsh(buffer) : null).catch(() => null),
    );
  }

  private animation(file: string): Promise<AniAnimation | null> {
    return cachedPromise(
      this.#animations,
      file,
      MAX_ANIMATION_CACHE_ENTRIES,
      () => this.buffer(file).then((buffer) => buffer ? parseAni(buffer) : null).catch(() => null),
    );
  }

  private async retainMaterial(
    key: string,
    textureFile: string | null,
    skin: number,
    alpha: string | null,
  ): Promise<THREE.MeshLambertMaterial> {
    let entry = this.#materials.get(key);
    if (!entry) {
      entry = { references: 0, promise: this.loadMaterial(textureFile, skin, alpha) };
      this.#materials.set(key, entry);
    }
    entry.references++;
    return (await entry.promise).material;
  }

  private releaseMaterial(key: string): void {
    const entry = this.#materials.get(key);
    if (!entry) return;
    entry.references = Math.max(0, entry.references - 1);
    if (entry.references !== 0) return;
    this.#materials.delete(key);
    void entry.promise.then(({ material, texture }) => {
      material.dispose();
      texture?.dispose();
    }).catch(() => undefined);
  }

  private async loadMaterial(textureFile: string | null, skin: number, alpha: string | null): Promise<{
    readonly material: THREE.MeshLambertMaterial;
    readonly texture: THREE.Texture | null;
  }> {
    const texture = textureFile
      ? await this.#dds.loadAsync(this.assets.dataUrl(textureFile)).catch(() => null)
      : null;
    if (texture) {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
    }
    return {
      texture,
      material: new THREE.MeshLambertMaterial({
        map: texture,
        color: texture ? 0xffffff : fallbackColor(skin),
        // CMesh::Render disables D3DRS_ALPHATESTENABLE only for cAlpha 'C'.
        // Dragon alpha in this mode is lighting data, not cutout transparency.
        alphaTest: alpha === "C" ? 0 : 0.35,
        side: THREE.DoubleSide,
      }),
    };
  }
}

function cachedPromise<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  maximumEntries: number,
  create: () => Promise<T>,
): Promise<T> {
  const existing = cache.get(key);
  if (existing) {
    // Map insertion order gives us a compact LRU without a second index.
    cache.delete(key);
    cache.set(key, existing);
    return existing;
  }

  const promise = create();
  cache.set(key, promise);
  while (cache.size > maximumEntries) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return promise;
}

/**
 * Rebuilds MeshManager::m_sAnimationArray for the two classic player rigs.
 * ANI filenames encode `(weaponType + 1) * 100 + (motion + 1)`. The client
 * first fans the base bank out at 137 and then lets each weapon bank override
 * it; sparse attack banks also inherit the last supplied attack animation.
 */
function buildClassicWeaponAnimationTable(
  family: MonsterVisualFamily,
  skin: number,
): (string | null)[][] {
  const weaponCount = 60;
  const motionCount = 56;
  const table = Array.from({ length: weaponCount }, () => (
    Array<string | null>(motionCount).fill(null)
  ));
  const baseName = family.base.replace(/^.*[\\/]/, "").toLowerCase();

  for (const clip of family.clips) {
    if (!clip) continue;
    const fileName = clip.replace(/^.*[\\/]/, "").toLowerCase();
    if (!fileName.startsWith(baseName) || !fileName.endsWith(".ani")) continue;
    const encodedText = fileName.slice(baseName.length, -4);
    if (!/^\d{4}$/.test(encodedText)) continue;
    const encoded = Number(encodedText);
    const weapon = Math.floor(encoded / 100) - 1;
    const motion = encoded % 100 - 1;
    if (weapon < 0 || weapon >= weaponCount || motion < 0 || motion >= motionCount) continue;

    table[weapon]![motion] = clip;
    if ((skin === 0 || skin === 1) && motion >= 4 && motion < 9) {
      for (let inherited = motion + 1; inherited < 10; inherited++) {
        table[weapon]![inherited] = clip;
      }
    }
    if ((skin === 0 || skin === 1) && motion >= 25 && motion < 29) {
      for (let inherited = motion + 1; inherited < 30; inherited++) {
        table[weapon]![inherited] = clip;
      }
    }
    if (skin === 1 && weapon === 2 && motion === 4) {
      for (let inherited = 0; inherited < 4; inherited++) {
        table[weapon]![inherited] = table[1]![inherited] ?? null;
      }
    }
    if ((skin === 0 && encoded === 138) || (skin === 1 && encoded === 137)) {
      for (let targetWeapon = 1; targetWeapon < weaponCount; targetWeapon++) {
        for (let targetMotion = 0; targetMotion < motionCount; targetMotion++) {
          table[targetWeapon]![targetMotion] = table[0]![targetMotion] ?? null;
        }
      }
    }
  }
  return table;
}

function animationVariant(template: MonsterTemplate): number {
  return Math.max(0, Math.min(3, Math.trunc(template.characterClass ?? 0)));
}

/**
 * Unmounted branches of TMHuman::CheckWeapon for the four humanoid rigs.
 * Other monster skins leave m_nWeaponTypeIndex at the constructor default and
 * continue using the family action table directly.
 */
function classicNpcAnimationWeaponType(
  template: MonsterTemplate,
  catalog: MonsterCatalog,
): number | undefined {
  const skin = template.visual?.skin;
  if (skin === undefined || skin < 0 || skin > 4 || skin === 3) return undefined;
  const equipment = template.equipment ?? [];
  const left = catalog.item(equipment[6 * 7] ?? 0);
  const right = catalog.item(equipment[7 * 7] ?? 0);
  const leftType = left?.weaponType ?? 0;
  const rightType = right?.weaponType ?? 0;
  const leftPosition = left?.weaponPosition ?? 0;
  const rightPosition = right?.weaponPosition ?? 0;

  if (skin === 0) {
    if (leftType === 0 && rightPosition === 128) return 2;
    if (leftPosition === 192 && rightPosition === 192) return 4;
    if ([1, 11, 61, 31].includes(leftType)) {
      if (rightType === 0 || rightPosition === 128) return 1;
      if (rightPosition === 196) return 4;
    } else if ([2, 12, 62].includes(leftType)) {
      if (rightPosition === 128) return 3;
      if (rightType === 0) return 5;
      if (rightPosition === 196) return 4;
    } else if (leftType === 3 || leftType === 63) return 6;
    else if (leftType === 13 && leftPosition === 64) return 7;
    else if ([21, 22, 23].includes(leftType) && leftPosition === 64) return 8;
    else if ([102, 103].includes(leftType) && leftPosition === 64) return 10;
    else if (leftType === 104 && leftPosition === 64) return 9;
    else if (leftType === 101) return 3;
    else if (leftType === 32 || leftType === 33) return 5;
    return 0;
  }

  if (skin === 1) {
    if (leftType === 0 && rightPosition === 128) return 2;
    if (leftPosition === 192 && rightPosition === 192) return 4;
    if (leftType === 3 || leftType === 63) return 10;
    if ([1, 11, 61, 2, 12, 62, 31].includes(leftType)) {
      if (rightType === 0) return 1;
      if (rightPosition === 128) return 3;
      if (rightPosition === 196) return 4;
    } else if ([21, 22, 23].includes(leftType)) return 5;
    else if ([102, 103].includes(leftType) && leftPosition === 64) return 3;
    else if (leftType === 13) return 7;
    else if ([32, 33].includes(leftType) && leftPosition === 64) return 9;
    else if (leftType === 101 && leftPosition === 64) return 6;
    return 0;
  }

  if (skin === 2) {
    if (leftType === 101) return 1;
    if (leftType === 12) return 2;
    if (rightPosition === 128 || leftType === 1 || leftType === 11) return 5;
    if ([13, 21].includes(leftType)) return 3;
    if ([31, 32, 33].includes(leftType)) return 4;
    return 0;
  }

  if ([1, 11, 61].includes(leftType)) return 1;
  if ([21, 22, 23, 13].includes(leftType)) return 2;
  if ([102, 103].includes(leftType)) return 3;
  return 0;
}

function fallbackColor(skin: number): THREE.Color {
  return new THREE.Color().setHSL((skin * 0.071) % 1, 0.3, 0.46);
}
