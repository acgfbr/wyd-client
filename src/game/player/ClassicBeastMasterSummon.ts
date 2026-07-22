import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { toScene, type WydPosition } from "../../world/coordinates";
import {
  BEAST_MASTER_SUMMON_ACTIONS,
  type BeastMasterSummonDefinition,
} from "../combat/BeastMasterSummons";
import type { ClassicMonsterSnapshot } from "../npcs/ClassicMonsterGameplay";
import {
  ClassicSkinnedAssetLibrary,
  type ClassicSkinnedInstanceLease,
} from "../npcs/ClassicSkinnedAssetLibrary";
import { MonsterCatalog } from "../npcs/MonsterCatalog";

const OWNER_FOLLOW_START_DISTANCE = 4;
const OWNER_FOLLOW_STOP_DISTANCE = 2;
const OWNER_TELEPORT_DISTANCE = 25;
const TARGET_LEASH_FROM_OWNER = 22;
const TARGET_ATTACK_DISTANCE = 1.5;
const ATTACK_COOLDOWN_SECONDS = 1.2;
const STRIKE_DELAY_SECONDS = 0.45;
const WALK_SPEED = 4.6;
const RUN_SPEED = 7.2;
const sharedLibraries = new WeakMap<ClassicAssetSource, Promise<ClassicSkinnedAssetLibrary>>();

export interface BeastMasterSummonEnvironment {
  readonly origin: WydPosition;
  heightAt(position: WydPosition): number;
  isWalkable?(position: WydPosition): boolean;
}

export type BeastMasterSummonStrikeCallback = (
  target: ClassicMonsterSnapshot,
  definition: BeastMasterSummonDefinition,
) => void;

interface PendingStrike {
  readonly target: ClassicMonsterSnapshot;
  remainingSeconds: number;
}

/**
 * One server-style BeastMaster invocation backed by the original BON/MSH/ANI
 * files. Ownership, lifetime and replacement stay with GameApp; this class is
 * only the visual actor and its small offline follow/attack simulation.
 */
export class ClassicBeastMasterSummon {
  readonly object = new THREE.Group();
  readonly definition: BeastMasterSummonDefinition;
  readonly #lease: ClassicSkinnedInstanceLease;
  readonly #position: { x: number; y: number };
  #yaw = -Math.PI / 2;
  #currentAction: string | null = null;
  #attackSequence = 0;
  #attackCooldownRemaining = 0;
  #actionLockRemaining = 0;
  #pendingStrike: PendingStrike | null = null;
  #released = false;

  private constructor(
    definition: BeastMasterSummonDefinition,
    lease: ClassicSkinnedInstanceLease,
    spawn: WydPosition,
  ) {
    this.definition = definition;
    this.#lease = lease;
    this.#position = { ...spawn };
    const phaseSeed = Math.abs(Math.sin(spawn.x * 12.9898 + spawn.y * 78.233));
    this.#attackSequence = Math.floor(phaseSeed * 3);
    this.#attackCooldownRemaining = 0.15 + phaseSeed * 0.65;
    this.object.name = `classic-bm-summon-${definition.key}`;
    this.object.userData.beastMasterSummon = true;
    this.object.userData.summonKey = definition.key;
    this.object.userData.skillIndex = definition.skill.classicIndex;
    this.object.userData.itemIndex = definition.visualItemIndex;
    this.object.userData.skillItemIndex = definition.skill.itemIndex;
    this.object.add(lease.model.object);
    lease.model.setClassicTransform({
      yaw: this.#yaw,
      scale: 0.9,
      mirrorModelZ: true,
    });
    const levelUpDuration = this.play(["LEVELUP", "STAND01"], true) ?? 0;
    this.#actionLockRemaining = Math.max(0.45, Math.min(1.1, levelUpDuration));
  }

  static async load(
    definition: BeastMasterSummonDefinition,
    spawn: WydPosition,
    assets: ClassicAssetSource,
  ): Promise<ClassicBeastMasterSummon | null> {
    const library = await sharedLibrary(assets);
    const lease = await library.createInstance({
      skin: definition.skin,
      family: definition.family.visual,
      parts: definition.parts.map((part) => ({
        name: `${definition.key}-${part.part}-${part.name}`,
        mesh: part.mesh,
        texture: part.texture,
        alpha: part.alpha,
      })),
      actions: BEAST_MASTER_SUMMON_ACTIONS,
      initialAction: "LEVELUP",
    });
    return lease ? new ClassicBeastMasterSummon(definition, lease, spawn) : null;
  }

  get position(): WydPosition {
    return this.#position;
  }

  get isReady(): boolean {
    return !this.#released;
  }

  update(
    deltaSeconds: number,
    ownerPosition: WydPosition,
    target: ClassicMonsterSnapshot | null,
    environment: BeastMasterSummonEnvironment,
    onStrike: BeastMasterSummonStrikeCallback,
  ): void {
    if (this.#released) return;
    const delta = Number.isFinite(deltaSeconds)
      ? Math.max(0, Math.min(deltaSeconds, 0.1))
      : 0;

    this.#attackCooldownRemaining = Math.max(0, this.#attackCooldownRemaining - delta);
    this.#actionLockRemaining = Math.max(0, this.#actionLockRemaining - delta);
    this.advancePendingStrike(delta, onStrike);

    const ownerDistance = distance(this.#position, ownerPosition);
    if (ownerDistance > OWNER_TELEPORT_DISTANCE) {
      this.teleportNearOwner(ownerPosition, environment);
      this.#actionLockRemaining = 0;
      this.#pendingStrike = null;
      this.setMovingAction("STAND01");
    }

    const validTarget = target?.alive
      && target.hostile
      && distance(ownerPosition, target.position) <= TARGET_LEASH_FROM_OWNER
      ? target
      : null;

    if (this.#actionLockRemaining > 0) {
      if (validTarget) this.face(validTarget.position, delta);
    } else if (validTarget) {
      this.updateCombat(delta, validTarget, environment);
    } else {
      this.updateFollowing(delta, ownerPosition, environment);
    }

    this.#lease.model.update(delta);
    this.syncSceneTransform(environment);
  }

  release(): void {
    if (this.#released) return;
    this.#released = true;
    this.#pendingStrike = null;
    this.object.removeFromParent();
    this.object.clear();
    this.#lease.release();
  }

  private updateCombat(
    deltaSeconds: number,
    target: ClassicMonsterSnapshot,
    environment: BeastMasterSummonEnvironment,
  ): void {
    const targetDistance = distance(this.#position, target.position);
    if (targetDistance > TARGET_ATTACK_DISTANCE) {
      this.moveToward(
        target.position,
        TARGET_ATTACK_DISTANCE * 0.88,
        deltaSeconds,
        targetDistance > 7 ? "RUN" : "WALK",
        environment,
      );
      return;
    }

    this.setMovingAction("STAND01");
    this.face(target.position, deltaSeconds);
    if (this.#attackCooldownRemaining > 0) return;

    const action = `ATTACK${this.#attackSequence % 3 + 1}`;
    this.#attackSequence++;
    const duration = this.play([action, "ATTACK1", "ATTACK2", "ATTACK3"], true) ?? 0.55;
    this.#actionLockRemaining = Math.max(0.55, Math.min(0.95, duration));
    this.#attackCooldownRemaining = ATTACK_COOLDOWN_SECONDS;
    this.#pendingStrike = { target, remainingSeconds: STRIKE_DELAY_SECONDS };
  }

  private updateFollowing(
    deltaSeconds: number,
    ownerPosition: WydPosition,
    environment: BeastMasterSummonEnvironment,
  ): void {
    const ownerDistance = distance(this.#position, ownerPosition);
    if (ownerDistance <= OWNER_FOLLOW_START_DISTANCE) {
      this.setMovingAction("STAND01");
      return;
    }
    this.moveToward(
      ownerPosition,
      OWNER_FOLLOW_STOP_DISTANCE,
      deltaSeconds,
      ownerDistance > 8 ? "RUN" : "WALK",
      environment,
    );
  }

  private moveToward(
    target: WydPosition,
    stopDistance: number,
    deltaSeconds: number,
    action: "WALK" | "RUN",
    environment: BeastMasterSummonEnvironment,
  ): void {
    const dx = target.x - this.#position.x;
    const dy = target.y - this.#position.y;
    const currentDistance = Math.hypot(dx, dy);
    const remaining = currentDistance - stopDistance;
    if (remaining <= 0.05 || currentDistance <= 1e-5) {
      this.setMovingAction("STAND01");
      return;
    }

    const speed = action === "RUN" ? RUN_SPEED : WALK_SPEED;
    const travel = Math.min(remaining, speed * deltaSeconds);
    const candidate = {
      x: this.#position.x + dx / currentDistance * travel,
      y: this.#position.y + dy / currentDistance * travel,
    };
    if (environment.isWalkable && !environment.isWalkable(candidate)) {
      this.setMovingAction("STAND01");
      return;
    }

    this.#position.x = candidate.x;
    this.#position.y = candidate.y;
    this.faceVelocity(dx, dy, deltaSeconds);
    this.setMovingAction(action);
  }

  private teleportNearOwner(
    ownerPosition: WydPosition,
    environment: BeastMasterSummonEnvironment,
  ): void {
    const angle = (this.definition.skill.instanceValue * 2.399963229728653) % (Math.PI * 2);
    const nearby = {
      x: ownerPosition.x + Math.cos(angle) * OWNER_FOLLOW_STOP_DISTANCE,
      y: ownerPosition.y + Math.sin(angle) * OWNER_FOLLOW_STOP_DISTANCE,
    };
    const destination = !environment.isWalkable || environment.isWalkable(nearby)
      ? nearby
      : ownerPosition;
    this.#position.x = destination.x;
    this.#position.y = destination.y;
  }

  private face(target: WydPosition, deltaSeconds: number): void {
    this.faceVelocity(target.x - this.#position.x, target.y - this.#position.y, deltaSeconds);
  }

  private faceVelocity(dx: number, dy: number, deltaSeconds: number): void {
    if (dx * dx + dy * dy <= 1e-8) return;
    const targetYaw = classicYawForVelocity(dx, dy);
    this.#yaw = smoothAngle(this.#yaw, targetYaw, Math.min(1, deltaSeconds * 12));
    this.#lease.model.setClassicTransform({ yaw: this.#yaw });
  }

  private advancePendingStrike(
    deltaSeconds: number,
    onStrike: BeastMasterSummonStrikeCallback,
  ): void {
    const pending = this.#pendingStrike;
    if (!pending) return;
    pending.remainingSeconds -= deltaSeconds;
    if (pending.remainingSeconds > 0) return;
    this.#pendingStrike = null;
    if (pending.target.alive && pending.target.hostile) onStrike(pending.target, this.definition);
  }

  private setMovingAction(action: "STAND01" | "WALK" | "RUN"): void {
    this.play([action, action === "RUN" ? "WALK" : "STAND01"]);
  }

  private play(actions: readonly string[], restart = false): number | null {
    if (!restart && this.#currentAction !== null && actions.includes(this.#currentAction)) {
      return this.#lease.actionDurationSeconds(this.#currentAction);
    }
    for (const action of actions) {
      if (!this.#lease.model.play(action, restart)) continue;
      this.#currentAction = action;
      return this.#lease.actionDurationSeconds(action) ?? 0;
    }
    return null;
  }

  private syncSceneTransform(environment: BeastMasterSummonEnvironment): void {
    const scene = toScene(this.#position, environment.origin);
    this.object.position.set(
      scene.x,
      environment.heightAt(this.#position),
      scene.z,
    );
  }
}

/** TMHuman::MoveTo -> SetAngle -> TMSkinMesh classic yaw conversion. */
function classicYawForVelocity(dx: number, dy: number): number {
  return -(Math.atan2(dx, dy) + Math.PI / 2);
}

function smoothAngle(current: number, target: number, amount: number): number {
  const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + difference * amount;
}

function distance(left: WydPosition, right: WydPosition): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function sharedLibrary(assets: ClassicAssetSource): Promise<ClassicSkinnedAssetLibrary> {
  const cached = sharedLibraries.get(assets);
  if (cached) return cached;
  const job = MonsterCatalog.load(assets).then((catalog) => new ClassicSkinnedAssetLibrary(assets, catalog));
  sharedLibraries.set(assets, job);
  void job.catch(() => {
    if (sharedLibraries.get(assets) === job) sharedLibraries.delete(assets);
  });
  return job;
}
