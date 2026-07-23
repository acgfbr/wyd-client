import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { ClassicBeastMasterBuffEffects } from "./ClassicBeastMasterBuffEffects";
import type { BeastMasterBuffVisualContext } from "./ClassicBeastMasterBuffEffects";
import { ClassicBeastMasterDragonEffects } from "./ClassicBeastMasterDragonEffects";
import { ClassicBeastMasterFairyEffects } from "./ClassicBeastMasterFairyEffects";
import {
  ClassicBeastMasterGaiaEffects,
  type ClassicGroundHeightSampler,
} from "./ClassicBeastMasterGaiaEffects";
import { ClassicBeastMasterWeakenEffects } from "./ClassicBeastMasterWeakenEffects";
import {
  ClassicBeastMasterVengefulSpiritEffects,
  type BeastMasterVengefulSpiritVisualTarget,
} from "./ClassicBeastMasterVengefulSpiritEffects";

export type ClassicBeastMasterAttackIndex = 48 | 49 | 50 | 51 | 52 | 55;
export type ClassicBeastMasterBuffIndex = 53 | 54;
export type { BeastMasterBuffVisualContext, BeastMasterVengefulSpiritVisualTarget };

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
  readonly #weakenEffects: ClassicBeastMasterWeakenEffects;
  readonly #gaiaEffects: ClassicBeastMasterGaiaEffects;
  readonly #vengefulSpiritEffects: ClassicBeastMasterVengefulSpiritEffects;
  readonly #buffEffects: ClassicBeastMasterBuffEffects;
  #enabled = true;
  #disposed = false;

  constructor(scene: THREE.Object3D) {
    this.object.name = "classic-beastmaster-skill-effects";
    this.#dragonEffects = new ClassicBeastMasterDragonEffects(this.object);
    this.#fairyEffects = new ClassicBeastMasterFairyEffects(this.object);
    this.#weakenEffects = new ClassicBeastMasterWeakenEffects(this.object);
    this.#gaiaEffects = new ClassicBeastMasterGaiaEffects(this.object);
    this.#vengefulSpiritEffects = new ClassicBeastMasterVengefulSpiritEffects(this.object);
    this.#buffEffects = new ClassicBeastMasterBuffEffects(this.object);
    scene.add(this.object);
  }

  async prepareClassic(assets: ClassicAssetSource): Promise<void> {
    if (this.#disposed) return;
    const results = await Promise.allSettled([
      this.#dragonEffects.prepareClassic(assets),
      this.#fairyEffects.prepareClassic(assets),
      this.#weakenEffects.prepareClassic(assets),
      this.#gaiaEffects.prepareClassic(assets),
      this.#vengefulSpiritEffects.prepareClassic(assets),
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
    groundHeightAt?: ClassicGroundHeightSampler,
  ): boolean {
    if (classicIndex === 48 || classicIndex === 49) {
      // Recognised skills stay on their dedicated path even while assets are
      // still warming or FX are disabled; gameplay must never fall through to
      // the generic arrow renderer because a presentation resource is late.
      this.#dragonEffects.play(classicIndex, casterFeet, targetFeet, followTarget);
      return true;
    }
    if (classicIndex === 50) {
      this.#fairyEffects.play(
        casterFeet,
        targetFeet,
        casterClassicYaw,
        followTarget,
      );
      return true;
    }
    if (classicIndex === 51) {
      this.#weakenEffects.play(casterFeet, targetFeet, followTarget);
      return true;
    }
    if (classicIndex === 52) {
      if (groundHeightAt) this.#gaiaEffects.play(casterFeet, targetFeet, groundHeightAt);
      return true;
    }
    return false;
  }

  playVengefulSpirit(
    centerFeet: THREE.Vector3,
    affectedTargets: readonly BeastMasterVengefulSpiritVisualTarget[],
  ): boolean {
    this.#vengefulSpiritEffects.play(centerFeet, affectedTargets);
    return true;
  }

  playBuffCast(classicIndex: number, ownerFeet: THREE.Vector3): boolean {
    if (classicIndex === 53 || classicIndex === 54) {
      this.#buffEffects.playCast(classicIndex, ownerFeet);
      return true;
    }
    // Master indices never enter TMHuman's classic VFX event dispatcher.
    // These are server-owned state/tick buffs, not missing particles.
    return classicIndex === 224 || classicIndex === 225 || classicIndex === 235;
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
    this.#weakenEffects.setEnabled(enabled);
    this.#gaiaEffects.setEnabled(enabled);
    this.#vengefulSpiritEffects.setEnabled(enabled);
    this.#buffEffects.setEnabled(enabled);
    if (!enabled) this.clear();
  }

  update(deltaSeconds: number): void {
    if (this.#disposed || !this.#enabled) return;
    this.#dragonEffects.update(deltaSeconds);
    this.#fairyEffects.update(deltaSeconds);
    this.#weakenEffects.update(deltaSeconds);
    this.#gaiaEffects.update(deltaSeconds);
    this.#vengefulSpiritEffects.update(deltaSeconds);
    this.#buffEffects.update(deltaSeconds);
  }

  clear(): void {
    this.#dragonEffects.clear();
    this.#fairyEffects.clear();
    this.#weakenEffects.clear();
    this.#gaiaEffects.clear();
    this.#vengefulSpiritEffects.clear();
    this.#buffEffects.clear();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#dragonEffects.dispose();
    this.#fairyEffects.dispose();
    this.#weakenEffects.dispose();
    this.#gaiaEffects.dispose();
    this.#vengefulSpiritEffects.dispose();
    this.#buffEffects.dispose();
    this.object.removeFromParent();
    this.object.clear();
  }
}
