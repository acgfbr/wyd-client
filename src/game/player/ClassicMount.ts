import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import {
  ClassicSkinnedAssetLibrary,
  type ClassicSkinnedInstanceLease,
} from "../npcs/ClassicSkinnedAssetLibrary";
import { MonsterCatalog, type MonsterVisualFamily } from "../npcs/MonsterCatalog";

const UNICORN_LEVEL = 120;
const UNICORN_FAMILY: MonsterVisualFamily = {
  base: "hs01",
  declaredParts: 3,
  meshParts: [1, 2],
  skeleton: "player/mounts/unicorn/hs01.bon",
  clips: Array.from({ length: 10 }, (_, index) => `player/mounts/unicorn/hs01${String(101 + index).padStart(4, "0")}.ani`),
  actionSet: "horse",
  actions: {
    STAND01: [0, 34, 0],
    WALK: [1, 20, 0],
    RUN: [2, 15, 0],
    ATTACK1: [3, 20, 279],
    STRIKE: [6, 10, 280],
    DIE: [7, 30, 281],
    DEAD: [8, 20, 0],
  },
};

/** A real classic mount model kept loaded and toggled without another hitch. */
export class ClassicMount {
  readonly object: THREE.Group;
  readonly name: string;
  readonly #lease: ClassicSkinnedInstanceLease;
  #action: string | null = null;
  #released = false;

  private constructor(lease: ClassicSkinnedInstanceLease, name: string) {
    this.#lease = lease;
    this.name = name;
    this.object = lease.model.object;
    this.object.name = `classic-mount-${name.toLowerCase().replaceAll("_", "-")}`;
    lease.model.setClassicTransform({ yaw: -Math.PI / 2, scale: 0.9, mirrorModelZ: true });
    this.play(["STAND01"]);
  }

  static async load(assets: ClassicAssetSource): Promise<ClassicMount | null> {
    const catalog = await MonsterCatalog.load(assets);
    const library = new ClassicSkinnedAssetLibrary(assets, catalog);
    const lease = await library.createInstance({
      skin: 31,
      family: UNICORN_FAMILY,
      parts: [1, 2].map((part) => ({
        name: `unicorn-part-${part}`,
        mesh: `player/mounts/unicorn/hs01${String(part).padStart(2, "0")}19.msh`,
        texture: "player/mounts/unicorn/hs010119.dds",
        alpha: "N",
      })),
      actions: ["STAND01", "WALK", "RUN", "ATTACK1", "STRIKE", "DIE", "DEAD"],
      initialAction: "STAND01",
    });
    return lease ? new ClassicMount(lease, `Unicórnio Lv. ${UNICORN_LEVEL}`) : null;
  }

  setYaw(yaw: number): void {
    if (!this.#released) this.#lease.model.setClassicTransform({ yaw });
  }

  setMoving(moving: boolean): void {
    this.play(moving ? ["RUN", "WALK"] : ["STAND01"]);
  }

  update(deltaSeconds: number): void {
    if (!this.#released) this.#lease.model.update(deltaSeconds);
  }

  release(): void {
    if (this.#released) return;
    this.#released = true;
    this.#lease.release();
  }

  private play(actions: readonly string[]): void {
    if (this.#released || (this.#action !== null && actions.includes(this.#action))) return;
    for (const action of actions) {
      if (!this.#lease.model.play(action)) continue;
      this.#action = action;
      return;
    }
  }
}
