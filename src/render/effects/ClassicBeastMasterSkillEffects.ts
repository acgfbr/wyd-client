import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { ClassicBeastMasterBuffEffects } from "./ClassicBeastMasterBuffEffects";
import type { BeastMasterBuffVisualContext } from "./ClassicBeastMasterBuffEffects";
import { ClassicBeastMasterDragonEffects } from "./ClassicBeastMasterDragonEffects";
import { ClassicBeastMasterFairyEffects } from "./ClassicBeastMasterFairyEffects";

export type ClassicBeastMasterAttackIndex = 48 | 49 | 50;
export type ClassicBeastMasterBuffIndex = 53 | 54;
export type { BeastMasterBuffVisualContext };

/**
 * Bounded presentation facade for BeastMaster skills #48/#49/#50/#53/#54.
 *
 * The three helpers mirror the separate retail controllers: dr01 projectiles,
 * ag01 fairies and the two state-owned elemental buffs. Gameplay and damage
 * stay with GameApp; completing a visual never invokes an authoritative hit.
 */
export class ClassicBeastMasterSkillEffects {
  readonly object = new THREE.Group();
  readonly #dragonEffects: ClassicBeastMasterDragonEffects;
  readonly #fairyEffects: ClassicBeastMasterFairyEffects;
  readonly #buffEffects: ClassicBeastMasterBuffEffects;
  #enabled = true;
  #disposed = false;

  constructor(scene: THREE.Object3D) {
    this.object.name = "classic-beastmaster-skill-effects";
    this.#dragonEffects = new ClassicBeastMasterDragonEffects(this.object);
    this.#fairyEffects = new ClassicBeastMasterFairyEffects(this.object);
    this.#buffEffects = new ClassicBeastMasterBuffEffects(this.object);
    scene.add(this.object);
  }

  async prepareClassic(assets: ClassicAssetSource): Promise<void> {
    if (this.#disposed) return;
    const results = await Promise.allSettled([
      this.#dragonEffects.prepareClassic(assets),
      this.#fairyEffects.prepareClassic(assets),
      this.#buffEffects.prepareClassic(assets),
    ]);
    for (const result of results) {
      if (result.status === "rejected") {
        console.warn("Efeito clássico do BeastMaster indisponível; usando fallback.", result.reason);
      }
    }
  }

  playAttack(
    classicIndex: number,
    casterFeet: THREE.Vector3,
    targetFeet: THREE.Vector3,
    casterClassicYaw: number,
    followTarget?: () => THREE.Vector3 | null,
  ): boolean {
    if (classicIndex === 48 || classicIndex === 49) {
      return this.#dragonEffects.play(classicIndex, casterFeet, targetFeet, followTarget);
    }
    if (classicIndex === 50) {
      return this.#fairyEffects.play(
        casterFeet,
        targetFeet,
        casterClassicYaw,
        followTarget,
      );
    }
    return false;
  }

  playBuffCast(classicIndex: number, ownerFeet: THREE.Vector3): boolean {
    if (classicIndex !== 53 && classicIndex !== 54) return false;
    return this.#buffEffects.playCast(classicIndex, ownerFeet);
  }

  syncPersistentBuffs(context: BeastMasterBuffVisualContext | null): void {
    this.#buffEffects.syncPersistentBuffs(context);
  }

  setEnabled(enabled: boolean): void {
    if (this.#disposed || this.#enabled === enabled) return;
    this.#enabled = enabled;
    this.object.visible = enabled;
    this.#dragonEffects.setEnabled(enabled);
    this.#fairyEffects.setEnabled(enabled);
    this.#buffEffects.setEnabled(enabled);
    if (!enabled) this.clear();
  }

  update(deltaSeconds: number): void {
    if (this.#disposed || !this.#enabled) return;
    this.#dragonEffects.update(deltaSeconds);
    this.#fairyEffects.update(deltaSeconds);
    this.#buffEffects.update(deltaSeconds);
  }

  clear(): void {
    this.#dragonEffects.clear();
    this.#fairyEffects.clear();
    this.#buffEffects.clear();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#dragonEffects.dispose();
    this.#fairyEffects.dispose();
    this.#buffEffects.dispose();
    this.object.removeFromParent();
    this.object.clear();
  }
}
