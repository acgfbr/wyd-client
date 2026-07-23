import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import {
  BEAST_MASTER_TRANSFORMATION_ACTIONS,
  type BeastMasterTransformationDefinition,
} from "../combat/BeastMasterTransformations";
import {
  ClassicSkinnedAssetLibrary,
  type ClassicSkinnedInstanceLease,
} from "../npcs/ClassicSkinnedAssetLibrary";
import { MonsterCatalog } from "../npcs/MonsterCatalog";

const sharedLibraries = new WeakMap<ClassicAssetSource, Promise<ClassicSkinnedAssetLibrary>>();

export interface ClassicTransformationAction {
  readonly name: string;
  readonly durationSeconds: number;
}

/** Exact alternate TMSkinMesh used while a BeastMaster form affect is active. */
export class ClassicBeastMasterTransformation {
  readonly object: THREE.Group;
  readonly definition: BeastMasterTransformationDefinition;
  readonly #lease: ClassicSkinnedInstanceLease;
  #released = false;

  private constructor(
    definition: BeastMasterTransformationDefinition,
    lease: ClassicSkinnedInstanceLease,
  ) {
    this.definition = definition;
    this.#lease = lease;
    this.object = lease.model.object;
    this.object.name = `classic-bm-transformation-${definition.key}`;
    this.object.userData.beastMasterTransformation = true;
    this.object.userData.skillIndex = definition.classicIndex;
    this.object.userData.itemClass = definition.itemClass;
    this.object.userData.skin = definition.skin;
    lease.model.setClassicTransform({
      yaw: -Math.PI / 2,
      scale: definition.scale,
      mirrorModelZ: true,
    });
  }

  static async load(
    assets: ClassicAssetSource,
    definition: BeastMasterTransformationDefinition,
  ): Promise<ClassicBeastMasterTransformation | null> {
    const library = await sharedLibrary(assets);
    const lease = await library.createInstance({
      skin: definition.skin,
      family: definition.family,
      parts: definition.parts.map((part) => ({
        name: `${definition.key}-${part.part}-${part.name}`,
        mesh: part.mesh,
        texture: part.texture,
        alpha: part.alpha,
      })),
      actions: BEAST_MASTER_TRANSFORMATION_ACTIONS,
      initialAction: "STAND01",
    });
    return lease ? new ClassicBeastMasterTransformation(definition, lease) : null;
  }

  setYaw(yaw: number): void {
    if (!this.#released) this.#lease.model.setClassicTransform({ yaw });
  }

  play(actions: readonly string[], restart = false): ClassicTransformationAction | null {
    if (this.#released) return null;
    for (const name of actions) {
      if (!this.#lease.model.play(name, restart)) continue;
      return {
        name,
        durationSeconds: this.#lease.actionDurationSeconds(name) ?? 0,
      };
    }
    return null;
  }

  update(deltaSeconds: number): void {
    if (!this.#released) this.#lease.model.update(deltaSeconds);
  }

  release(): void {
    if (this.#released) return;
    this.#released = true;
    this.#lease.release();
  }
}

function sharedLibrary(assets: ClassicAssetSource): Promise<ClassicSkinnedAssetLibrary> {
  const cached = sharedLibraries.get(assets);
  if (cached) return cached;
  const job = MonsterCatalog.load(assets)
    .then((catalog) => new ClassicSkinnedAssetLibrary(assets, catalog));
  sharedLibraries.set(assets, job);
  void job.catch(() => {
    if (sharedLibraries.get(assets) === job) sharedLibraries.delete(assets);
  });
  return job;
}
