import * as THREE from "three";
import type { ClassicAssetSource } from "../assets/ClassicAssetSource";
import type { ClassicWorld } from "../world/ClassicWorld";
import { toScene, type WydPosition } from "../world/coordinates";
import type { ClassSkill } from "./combat/ClassSkills";
import { ClassicPlayerAvatar } from "./player/ClassicPlayerAvatar";
import { ClassicMount } from "./player/ClassicMount";
import { ClassicFamiliar } from "./player/ClassicFamiliar";
import { DEFAULT_HUNTRESS_LOOK_KEY } from "./player/HuntressLooks";
import { DEFAULT_MOUNT_LOOK_KEY } from "./player/MountLooks";
import type { ClassicPlayerClassKey } from "./player/PlayerClasses";

const WAYPOINT_REACHED_DISTANCE = 0.18;
const NAVIGATION_SUBSTEP = 0.45;
const MANUAL_DETOUR_HEADING_DOT = 0.9238795; // cos(22.5°)
const MANUAL_DETOUR_MAX_PATH_CELLS = 5;
const MANUAL_DETOUR_MAX_VISITED = 24;
// OnPacketAttack schedules WTYPE 101 / SkillIndex 151 for the first rendered
// frame after 200 ms. This is time-based in the client, not an ANI percentage.
const CLASSIC_BOW_RELEASE_DELAY_SECONDS = 0.2;
// TMHuman ends a non-looping motion two ANI ticks before the raw clip end.
// Huntress bow clips run at 15 ms per quarter-step: 2 * 4 * 15 ms.
const CLASSIC_BOW_ACTION_END_TRIM_SECONDS = 0.12;

export interface PlayerAttackTiming {
  readonly actionName: string | null;
  readonly releaseDelaySeconds: number;
  readonly animationDurationSeconds: number;
}

export interface PlayerSkillTiming {
  readonly actionName: string | null;
  /** TMFieldScene dispatches the Huntress VFX 500 ms after the cast starts. */
  readonly effectDelaySeconds: number;
  readonly animationDurationSeconds: number;
}

export class Player {
  readonly object = new THREE.Group();
  readonly position: { x: number; y: number };
  readonly #velocity = new THREE.Vector2();
  readonly #visualRoot = new THREE.Group();
  readonly #fallback: THREE.Mesh;
  readonly #marker: THREE.Mesh;
  #path: WydPosition[] = [];
  #pathIndex = 0;
  #manualDetour: WydPosition[] = [];
  #manualDetourIndex = 0;
  readonly #manualDetourHeading = new THREE.Vector2();
  #speedBoost = false;
  #avatar: ClassicPlayerAvatar | null = null;
  #mount: ClassicMount | null = null;
  #familiar: ClassicFamiliar | null = null;
  #mounted = false;
  #mountDesired = false;
  #avatarLoadGeneration = 0;
  #mountLoadGeneration = 0;
  #familiarLoadGeneration = 0;
  #effectsEnabled = true;
  #weaponVisible = true;
  #invisible = false;
  #avatarAction: string | null = null;
  #avatarClassKey: ClassicPlayerClassKey = "huntress";
  #avatarLookKey = DEFAULT_HUNTRESS_LOOK_KEY;
  #mountLookKey = DEFAULT_MOUNT_LOOK_KEY;
  #classicYaw = -Math.PI / 2;
  #actionLockRemaining = 0;
  #attackMotionIndex = 0;
  #deathElapsed = 0;
  #deathAnimationSeconds = 0;
  #dead = false;
  #disposed = false;

  get speed(): number { return this.#speedBoost ? 64 : (this.#mounted ? 13 : 8); }
  get speedBoost(): boolean { return this.#speedBoost; }
  get hasClassicAvatar(): boolean { return this.#avatar !== null; }
  get hasClassicMount(): boolean { return this.#mount !== null; }
  get hasClassicFamiliar(): boolean { return this.#familiar !== null; }
  get mounted(): boolean { return this.#mounted; }
  get avatarClassKey(): ClassicPlayerClassKey { return this.#avatar?.playerClass.key ?? this.#avatarClassKey; }
  get avatarClassName(): string { return this.#avatar?.playerClass.name ?? "Huntress"; }
  get avatarLookKey(): string { return this.#avatar?.look.key ?? this.#avatarLookKey; }
  get avatarLookName(): string | null { return this.#avatar?.look.name ?? null; }
  get mountLookKey(): string { return this.#mount?.look.key ?? this.#mountLookKey; }
  get mountName(): string | null { return this.#mount?.name ?? null; }
  get invisible(): boolean { return this.#invisible; }

  constructor(private readonly world: ClassicWorld, spawn: WydPosition) {
    this.position = { ...spawn };
    this.object.name = "player";
    this.#visualRoot.name = "player-visual-root";
    this.object.add(this.#visualRoot);

    this.#fallback = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.42, 0.9, 6, 10),
      new THREE.MeshStandardMaterial({ color: 0x8b2331, roughness: 0.65, metalness: 0.25 }),
    );
    this.#fallback.name = "player-loading-fallback";
    this.#fallback.position.y = 0.95;
    this.#fallback.castShadow = true;
    this.#visualRoot.add(this.#fallback);

    this.#marker = new THREE.Mesh(
      new THREE.RingGeometry(0.65, 0.77, 32),
      new THREE.MeshBasicMaterial({ color: 0xe7c66d, side: THREE.DoubleSide }),
    );
    this.#marker.name = "player-selection-ring";
    this.#marker.rotation.x = -Math.PI / 2;
    this.#marker.position.y = 0.04;
    this.object.add(this.#marker);
    this.syncObject();
  }

  /** Replaces the loading capsule with one of the four classic player rigs. */
  async loadClassicAvatar(
    assets: ClassicAssetSource,
    classKey: ClassicPlayerClassKey = this.#avatarClassKey,
    lookKey?: string,
  ): Promise<boolean> {
    const generation = ++this.#avatarLoadGeneration;
    try {
      const requestedLook = lookKey ?? (classKey === this.#avatarClassKey ? this.#avatarLookKey : undefined);
      const avatar = await ClassicPlayerAvatar.load(assets, classKey, requestedLook);
      if (!avatar) return false;
      if (this.#disposed || generation !== this.#avatarLoadGeneration) {
        avatar.release();
        return false;
      }
      this.unloadClassicAvatar();
      this.#avatar = avatar;
      this.#avatarClassKey = avatar.playerClass.key;
      this.#avatarLookKey = avatar.look.key;
      avatar.setEffectsEnabled(this.#effectsEnabled);
      avatar.setWeaponVisible(this.#weaponVisible);
      this.#fallback.visible = false;
      avatar.setYaw(this.currentClassicYaw());
      this.syncMountedVisuals();
      this.applyInvisibility();
      if (this.#dead) this.playDeath();
      else if (this.#velocity.lengthSq() > 0.02) this.playAvatarAction(["WALK"]);
      else this.playAvatarAction(["STAND02", "STAND01"]);
      return true;
    } catch {
      return false;
    }
  }

  /** Loads or swaps the selected classic mount; R only toggles it afterwards. */
  async loadClassicMount(
    assets: ClassicAssetSource,
    lookKey = this.#mountLookKey,
  ): Promise<boolean> {
    const generation = ++this.#mountLoadGeneration;
    try {
      const mount = await ClassicMount.load(assets, lookKey);
      if (!mount) return false;
      if (this.#disposed || generation !== this.#mountLoadGeneration) {
        mount.release();
        return false;
      }
      this.unloadClassicMount();
      this.#mount = mount;
      this.#mountLookKey = mount.look.key;
      this.#visualRoot.add(mount.object);
      mount.setEffectsEnabled(this.#effectsEnabled);
      mount.setYaw(this.currentClassicYaw());
      this.#mounted = this.#mountDesired;
      this.syncMountedVisuals();
      this.applyInvisibility();
      return true;
    } catch {
      return false;
    }
  }

  /** Equip[13] item 1726. This follower is independent from the mount slot. */
  async loadClassicFamiliar(assets: ClassicAssetSource): Promise<boolean> {
    const generation = ++this.#familiarLoadGeneration;
    try {
      const familiar = await ClassicFamiliar.load(assets, this.position.x);
      if (!familiar) return false;
      if (this.#disposed || generation !== this.#familiarLoadGeneration) {
        familiar.release();
        return false;
      }
      this.unloadClassicFamiliar();
      this.#familiar = familiar;
      this.#visualRoot.add(familiar.object);
      familiar.setEffectsEnabled(this.#effectsEnabled);
      familiar.update(0, this.currentClassicYaw());
      this.applyInvisibility();
      return true;
    } catch {
      return false;
    }
  }

  toggleMount(): boolean {
    if (this.#dead) return this.#mounted;
    this.#mountDesired = !this.#mountDesired;
    this.#mounted = this.#mountDesired && this.#mount !== null;
    this.syncMountedVisuals();
    return this.#mounted;
  }

  setEffectsEnabled(enabled: boolean): void {
    this.#effectsEnabled = enabled;
    this.#avatar?.setEffectsEnabled(enabled);
    this.#mount?.setEffectsEnabled(enabled);
    this.#familiar?.setEffectsEnabled(enabled);
  }

  setWeaponVisible(visible: boolean): void {
    this.#weaponVisible = visible;
    this.#avatar?.setWeaponVisible(visible);
  }

  /** The local player remains visible as a translucent shadow, like m_cShadow. */
  setInvisible(active: boolean): void {
    if (this.#invisible === active) return;
    this.#invisible = active;
    this.applyInvisibility();
  }

  unloadClassicAvatar(): void {
    if (!this.#avatar) {
      if (!this.#disposed) this.#fallback.visible = true;
      return;
    }
    this.#visualRoot.remove(this.#avatar.object);
    this.#avatar.release();
    this.#avatar = null;
    this.#avatarAction = null;
    if (!this.#disposed) this.#fallback.visible = true;
  }

  unloadClassicMount(): void {
    if (!this.#mount) return;
    this.#avatar?.attachOnFoot(this.#visualRoot, this.currentClassicYaw());
    this.#visualRoot.remove(this.#mount.object);
    this.#mount.release();
    this.#mount = null;
    this.#mounted = false;
    this.syncMountedVisuals();
  }

  unloadClassicFamiliar(): void {
    if (!this.#familiar) return;
    this.#visualRoot.remove(this.#familiar.object);
    this.#familiar.release();
    this.#familiar = null;
  }

  /** Invalidates an in-flight load before removing the equipped mount. */
  removeClassicMount(): void {
    this.#mountLoadGeneration++;
    this.#mountDesired = false;
    this.unloadClassicMount();
  }

  /** Invalidates an in-flight load before removing the equipped familiar. */
  removeClassicFamiliar(): void {
    this.#familiarLoadGeneration++;
    this.unloadClassicFamiliar();
  }

  playAttack(): PlayerAttackTiming | null {
    if (this.#dead) return null;
    // The field client cycles Motion 5, 6, 4. Bow banks intentionally inherit
    // their sole authored attack into the missing slots, but retaining the
    // motion sequence also keeps future weapons faithful.
    this.#attackMotionIndex = (this.#attackMotionIndex + 1) % 3;
    const motion = this.#attackMotionIndex + 1;
    const primary = this.#mounted ? `MATT${motion}` : `ATTACK${motion}`;
    const action = this.playAvatarAction(this.#mounted
      ? [primary, "MATT1", "MATT2", "MATT3", "ATTACK1"]
      : [primary, "ATTACK1", "ATTACK2", "ATTACK3", "STRIKE"], true);
    // Força Espectral is permanently learned in this offline client. The
    // retail outgoing attack sets DoubleCritical |= 8, which OnPacketAttack
    // turns into the WTYPE-101 SForce effect on the weapon matrix.
    this.#avatar?.triggerSpectralForce();
    // Mounted combat animates the rider with MATT, but must not start the
    // mount's locomotion/attack clip or preserve a previous take-off curve.
    // Keep the animal planted while the Huntress releases the shot.
    if (this.#mounted) this.#mount?.setMoving(false);
    if (action) {
      this.#actionLockRemaining = Math.max(
        0.25,
        action.durationSeconds - CLASSIC_BOW_ACTION_END_TRIM_SECONDS,
      );
    }
    return {
      actionName: action?.name ?? null,
      releaseDelaySeconds: CLASSIC_BOW_RELEASE_DELAY_SECONDS,
      animationDurationSeconds: action?.durationSeconds ?? 0,
    };
  }

  playSkill(variant = 0): boolean {
    if (this.#dead) return false;
    const index = Math.max(1, Math.min(3, Math.trunc(variant) + 1));
    const action = this.playAvatarAction(this.#mounted
      ? [`MSKIL0${index}`, "MATT1", `SKILL0${index}`]
      : [`SKILL0${index}`, "ATTACK1"], true);
    if (!action) return false;
    if (this.#mounted) this.#mount?.setMoving(false);
    this.#actionLockRemaining = Math.max(0.3, Math.min(1.1, action.durationSeconds));
    return true;
  }

  playHuntressSkill(classicIndex: number): PlayerSkillTiming | null {
    if (this.#dead) return null;
    const action = this.playAvatarAction(huntressSkillActions(classicIndex, this.#mounted), true);
    if (this.#mounted) this.#mount?.setMoving(false);
    if (action) {
      this.#actionLockRemaining = Math.max(
        0.3,
        action.durationSeconds - CLASSIC_BOW_ACTION_END_TRIM_SECONDS,
      );
    }
    return {
      actionName: action?.name ?? null,
      effectDelaySeconds: 0.5,
      animationDurationSeconds: action?.durationSeconds ?? 0,
    };
  }

  playClassSkill(skill: Pick<ClassSkill, "classicIndex" | "action1" | "action2">): PlayerSkillTiming | null {
    if (this.#dead) return null;
    const actions = this.#avatarClassKey === "huntress"
      ? huntressSkillActions(skill.classicIndex, this.#mounted)
      : classSkillActions(skill, this.#avatarClassKey, this.#mounted);
    const action = this.playAvatarAction(actions, true);
    if (this.#mounted) this.#mount?.setMoving(false);
    if (action) {
      this.#actionLockRemaining = Math.max(
        0.3,
        action.durationSeconds - CLASSIC_BOW_ACTION_END_TRIM_SECONDS,
      );
    }
    return {
      actionName: action?.name ?? null,
      effectDelaySeconds: 0.5,
      animationDurationSeconds: action?.durationSeconds ?? 0,
    };
  }

  triggerSpectralForce(): void {
    if (!this.#dead) this.#avatar?.triggerSpectralForce();
  }

  playHit(): boolean {
    if (this.#dead) return false;
    const action = this.playAvatarAction(this.#mounted ? ["MSTRIKE", "STRIKE"] : ["STRIKE"], true);
    if (!action) return false;
    if (this.#mounted) this.#mount?.playHit();
    this.#actionLockRemaining = Math.max(0.18, Math.min(0.65, action.durationSeconds));
    return true;
  }

  /** Mirrors TMHuman::SetAnimation(ECMOTION_LEVELUP, 0) for the local actor. */
  playLevelUp(): boolean {
    if (this.#dead) return false;
    this.#velocity.set(0, 0);
    const action = this.playAvatarAction(
      this.#mounted ? ["MLVLUP", "LEVELUP"] : ["LEVELUP"],
      true,
    );
    if (!action) return false;
    if (this.#mounted) this.#mount?.playLevelUp();
    this.#actionLockRemaining = Math.max(0.3, action.durationSeconds);
    return true;
  }

  playDeath(): boolean {
    this.#dead = true;
    this.#path = [];
    this.#pathIndex = 0;
    this.clearManualDetour();
    this.#velocity.set(0, 0);
    this.#actionLockRemaining = 0;
    this.#deathElapsed = 0;
    const action = this.playAvatarAction(this.#mounted ? ["MDIE", "MDEAD", "DIE"] : ["DIE", "DEAD"], true);
    if (this.#mounted) this.#mount?.playDeath();
    this.#deathAnimationSeconds = action?.name === "DIE" || action?.name === "MDIE" ? action.durationSeconds : 0;
    return action !== null;
  }

  playIdle(): void {
    this.#dead = false;
    this.#deathElapsed = 0;
    this.#deathAnimationSeconds = 0;
    this.#actionLockRemaining = 0;
    this.playAvatarAction(this.#mounted ? ["MSTND01", "STAND01"] : ["STAND02", "STAND01"]);
    if (this.#mounted) this.#mount?.playIdle();
  }

  stop(): void {
    this.#path = [];
    this.#pathIndex = 0;
    this.clearManualDetour();
    this.#velocity.set(0, 0);
    if (!this.#dead) this.playIdle();
  }

  syncObject(): void {
    const scene = toScene(this.position, this.world.origin);
    this.object.position.set(scene.x, this.world.heightAt(this.position), scene.z);
  }

  moveTo(target: WydPosition): void {
    if (this.#dead) return;
    this.clearManualDetour();
    // G é também o modo de exploração do cliente web: atravessa qualquer
    // máscara/objeto e segue reto até o ponto escolhido.
    if (this.#speedBoost) {
      this.#path = [{ ...target }];
      this.#pathIndex = 0;
      return;
    }

    // The classic client advances along a stable route segment. Avoid running
    // A* (and visiting every cell centre) when the clicked point has a clear
    // mask/height-valid line from the current position.
    if (this.world.navigation.canTravelDirectly(this.position, target)) {
      this.#path = [{ ...target }];
      this.#pathIndex = 0;
      return;
    }

    const result = this.world.navigation.findPath(this.position, target, {
      allowDiagonal: true,
      maxVisited: 65_536,
    });
    if (result.status !== "found" && result.status !== "already-there") {
      this.#path = [];
      this.#pathIndex = 0;
      return;
    }

    const points = result.points.slice(1).map((cell) => ({ x: cell.x + 0.5, y: cell.y + 0.5 }));
    const finalSample = this.world.navigation.sample(target);
    if (finalSample.walkability === "walkable") {
      const last = points[points.length - 1];
      if (last && Math.floor(last.x) === finalSample.cell.x && Math.floor(last.y) === finalSample.cell.y) {
        points[points.length - 1] = { ...target };
      } else {
        points.push({ ...target });
      }
    }
    this.#path = this.simplifyClickPath(points);
    this.#pathIndex = 0;
  }

  teleport(target: WydPosition): void {
    this.#path = [];
    this.#pathIndex = 0;
    this.clearManualDetour();
    this.#velocity.set(0, 0);
    this.position.x = target.x;
    this.position.y = target.y;
    this.syncObject();
  }

  toggleSpeedBoost(): boolean {
    this.#speedBoost = !this.#speedBoost;
    this.clearManualDetour();
    return this.#speedBoost;
  }

  faceToward(target: WydPosition): void {
    const dx = target.x - this.position.x;
    const dy = target.y - this.position.y;
    if (dx * dx + dy * dy <= 1e-8) return;
    this.object.rotation.y = Math.atan2(dx, dy);
    this.#visualRoot.rotation.y = -this.object.rotation.y;
    const yaw = classicYawForVelocity(dx, dy);
    this.#classicYaw = yaw;
    this.#avatar?.setYaw(yaw);
    this.#mount?.setYaw(yaw);
  }

  update(dt: number, keyboardDirection: THREE.Vector2): void {
    const deltaSeconds = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
    const beforeX = this.position.x;
    const beforeY = this.position.y;
    let desired = this.#dead ? new THREE.Vector2() : keyboardDirection.clone();
    let activeWaypoint: WydPosition | null = null;
    let manualWaypoint: WydPosition | null = null;
    const hasManualInput = !this.#dead && desired.lengthSq() > 0;

    if (hasManualInput) {
      this.#path = [];
      this.#pathIndex = 0;
      manualWaypoint = this.manualDetourWaypoint(desired);
      if (manualWaypoint) {
        desired.set(manualWaypoint.x - this.position.x, manualWaypoint.y - this.position.y);
        const distance = desired.length();
        if (distance > 0) desired.divideScalar(distance);
      }
    } else if (!this.#dead) {
      this.clearManualDetour();
      activeWaypoint = this.currentWaypoint();
      if (activeWaypoint) {
        desired.set(activeWaypoint.x - this.position.x, activeWaypoint.y - this.position.y);
        const distance = desired.length();
        if (distance > 0) desired.divideScalar(distance);
      }
    } else {
      this.clearManualDetour();
    }

    const movementWaypoint = manualWaypoint ?? activeWaypoint;
    const targetVelocity = desired.multiplyScalar(this.speed);
    if (movementWaypoint) {
      // TMHuman interpolates position linearly between route entries. Carrying
      // lateral velocity through every cell centre made click movement weave.
      this.#velocity.copy(targetVelocity);
    } else {
      const response = 1 - Math.exp(-deltaSeconds * 14);
      this.#velocity.lerp(targetVelocity, response);
    }
    let movementX = this.#velocity.x * deltaSeconds;
    let movementY = this.#velocity.y * deltaSeconds;
    if (movementWaypoint) {
      const toWaypointX = movementWaypoint.x - this.position.x;
      const toWaypointY = movementWaypoint.y - this.position.y;
      const waypointDistanceSquared = toWaypointX * toWaypointX + toWaypointY * toWaypointY;
      const movementLengthSquared = movementX * movementX + movementY * movementY;
      const movingToward = movementX * toWaypointX + movementY * toWaypointY > 0;
      if (movingToward && movementLengthSquared >= waypointDistanceSquared) {
        movementX = toWaypointX;
        movementY = toWaypointY;
      }
    }
    this.moveWithNavigation(movementX, movementY, hasManualInput && manualWaypoint === null);
    this.currentWaypoint();
    this.currentManualDetourWaypoint();

    const movedX = this.position.x - beforeX;
    const movedY = this.position.y - beforeY;
    const moving = movedX * movedX + movedY * movedY > 1e-6;
    if (moving) {
      this.object.rotation.y = Math.atan2(movedX, movedY);
      // GameApp reads object.rotation.y for the minimap. Cancel that parent
      // rotation for the classic model, whose basis receives the exact yaw.
      this.#visualRoot.rotation.y = -this.object.rotation.y;
      this.#classicYaw = classicYawForVelocity(movedX, movedY);
      this.#avatar?.setYaw(this.#classicYaw);
      this.#mount?.setYaw(this.#classicYaw);
    }
    this.updateAvatar(deltaSeconds, moving);
    this.syncObject();
    this.#familiar?.update(deltaSeconds, this.#classicYaw);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#avatarLoadGeneration++;
    this.#mountLoadGeneration++;
    this.#familiarLoadGeneration++;
    this.unloadClassicAvatar();
    this.unloadClassicMount();
    this.unloadClassicFamiliar();
    this.#fallback.geometry.dispose();
    disposeMaterial(this.#fallback.material);
    this.#marker.geometry.dispose();
    disposeMaterial(this.#marker.material);
    this.object.removeFromParent();
    this.object.clear();
  }

  private currentWaypoint(): WydPosition | null {
    while (this.#pathIndex < this.#path.length) {
      const waypoint = this.#path[this.#pathIndex]!;
      if (Math.hypot(waypoint.x - this.position.x, waypoint.y - this.position.y) > WAYPOINT_REACHED_DISTANCE) {
        return waypoint;
      }
      this.position.x = waypoint.x;
      this.position.y = waypoint.y;
      this.#pathIndex++;
    }
    if (this.#path.length > 0) {
      this.#path = [];
      this.#pathIndex = 0;
      this.#velocity.set(0, 0);
    }
    return null;
  }

  private manualDetourWaypoint(inputDirection: THREE.Vector2): WydPosition | null {
    if (this.#manualDetour.length === 0) return null;
    const inputLength = inputDirection.length();
    if (
      inputLength <= 1e-8
      || inputDirection.dot(this.#manualDetourHeading) / inputLength < MANUAL_DETOUR_HEADING_DOT
    ) {
      this.clearManualDetour();
      return null;
    }
    return this.currentManualDetourWaypoint();
  }

  private currentManualDetourWaypoint(): WydPosition | null {
    while (this.#manualDetourIndex < this.#manualDetour.length) {
      const waypoint = this.#manualDetour[this.#manualDetourIndex]!;
      if (Math.hypot(waypoint.x - this.position.x, waypoint.y - this.position.y) > WAYPOINT_REACHED_DISTANCE) {
        return waypoint;
      }
      this.position.x = waypoint.x;
      this.position.y = waypoint.y;
      this.#manualDetourIndex++;
    }
    if (this.#manualDetour.length > 0) {
      const headingX = this.#manualDetourHeading.x;
      const headingY = this.#manualDetourHeading.y;
      this.clearManualDetour();
      // The last leg returns from the side lane and therefore has lateral
      // velocity. Resume the held heading immediately instead of drifting
      // into the opposite bridge edge while interpolation decays that vector.
      this.#velocity.set(headingX * this.speed, headingY * this.speed);
    }
    return null;
  }

  private clearManualDetour(): void {
    this.#manualDetour = [];
    this.#manualDetourIndex = 0;
    this.#manualDetourHeading.set(0, 0);
  }

  /**
   * The classic mask is flat, so a submerged prop can punch one blocked cell
   * through a walkable bridge deck. Click routes already skirt that cell; for
   * held/manual movement, create the same tiny detour only when the blocker is
   * one cell thick and a complete cardinal lane around it is authoritative.
   */
  private beginManualMicroDetour(from: WydPosition, deltaX: number, deltaY: number): boolean {
    if (this.#manualDetour.length > 0) return false;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    let axisX = 0;
    let axisY = 0;
    if (absX >= absY * 2 && absX > 1e-8) axisX = Math.sign(deltaX);
    else if (absY >= absX * 2 && absY > 1e-8) axisY = Math.sign(deltaY);
    else return false;

    const navigation = this.world.navigation;
    const current = navigation.sample(from);
    const blocked = navigation.sample({ x: from.x + deltaX, y: from.y + deltaY });
    if (
      current.walkability !== "walkable"
      || blocked.walkability !== "blocked"
      || !current.authoritative
      || !blocked.authoritative
      || blocked.cell.x !== current.cell.x + axisX
      || blocked.cell.y !== current.cell.y + axisY
    ) return false;

    const beyond = { x: blocked.cell.x + axisX, y: blocked.cell.y + axisY };
    const goal = axisX !== 0
      ? { x: beyond.x + 0.5, y: from.y }
      : { x: from.x, y: beyond.y + 0.5 };
    const goalSample = navigation.sample(goal);
    if (goalSample.walkability !== "walkable" || !goalSample.authoritative) return false;

    // A short A* result proves this is a local prop, not a wall whose end is
    // somewhere off-screen. The explicit cardinal lane below then guarantees
    // continuous substeps never clip a blocked corner.
    const path = navigation.findPath(from, goal, {
      allowDiagonal: true,
      maxVisited: MANUAL_DETOUR_MAX_VISITED,
    });
    if (path.status !== "found" || path.points.length > MANUAL_DETOUR_MAX_PATH_CELLS) return false;

    const perpendicularX = -axisY;
    const perpendicularY = axisX;
    const staysLocal = path.points.every((point) => {
      const relativeX = point.x - current.cell.x;
      const relativeY = point.y - current.cell.y;
      const forward = relativeX * axisX + relativeY * axisY;
      const lateral = Math.abs(relativeX * perpendicularX + relativeY * perpendicularY);
      return forward >= 0 && forward <= 2 && lateral <= 1;
    });
    if (!staysLocal) return false;

    for (const side of [-1, 1] as const) {
      const sideX = perpendicularX * side;
      const sideY = perpendicularY * side;
      const currentSide = { x: current.cell.x + sideX, y: current.cell.y + sideY };
      const blockedSide = { x: blocked.cell.x + sideX, y: blocked.cell.y + sideY };
      const beyondSide = { x: beyond.x + sideX, y: beyond.y + sideY };
      if (
        !navigation.canStep(cellCenter(current.cell), cellCenter(currentSide))
        || !navigation.canStep(cellCenter(currentSide), cellCenter(blockedSide))
        || !navigation.canStep(cellCenter(blockedSide), cellCenter(beyondSide))
        || !navigation.canStep(cellCenter(beyondSide), cellCenter(beyond))
      ) continue;

      // Stay inside the current cell while entering the side lane. Without
      // this inset, a player already at x=.99/y=.99 can cross the blocked edge
      // before crossing into the safe adjacent cell.
      const approach = axisX !== 0
        ? {
            x: current.cell.x + (axisX > 0 ? 0.82 : 0.18),
            y: currentSide.y + 0.5,
          }
        : {
            x: currentSide.x + 0.5,
            y: current.cell.y + (axisY > 0 ? 0.82 : 0.18),
          };
      const route = [approach, cellCenter(blockedSide), cellCenter(beyondSide), goal];
      let anchor = from;
      let continuous = true;
      for (const waypoint of route) {
        if (!navigation.canTravelDirectly(anchor, waypoint)) {
          continuous = false;
          break;
        }
        anchor = waypoint;
      }
      if (!continuous) continue;

      this.#manualDetour = route;
      this.#manualDetourIndex = 0;
      this.#manualDetourHeading.set(axisX, axisY);
      return true;
    }
    return false;
  }

  private moveAlongManualDetour(maxDistance: number): boolean {
    const waypoint = this.currentManualDetourWaypoint();
    if (!waypoint || maxDistance <= 1e-8) return false;
    const dx = waypoint.x - this.position.x;
    const dy = waypoint.y - this.position.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 1e-8) return false;
    const scale = Math.min(1, maxDistance / distance);
    const candidate = {
      x: this.position.x + dx * scale,
      y: this.position.y + dy * scale,
    };
    if (!this.world.navigation.canStep(this.position, candidate)) return false;
    this.position.x = candidate.x;
    this.position.y = candidate.y;
    return true;
  }

  private simplifyClickPath(points: readonly WydPosition[]): WydPosition[] {
    if (points.length < 2) return points.map((point) => ({ ...point }));

    const simplified: WydPosition[] = [];
    let anchor: WydPosition = this.position;
    let firstCandidate = 0;
    while (firstCandidate < points.length) {
      let farthest = firstCandidate;
      for (let candidate = points.length - 1; candidate > firstCandidate; candidate--) {
        if (this.world.navigation.canTravelDirectly(anchor, points[candidate]!)) {
          farthest = candidate;
          break;
        }
      }
      const waypoint = points[farthest]!;
      simplified.push({ ...waypoint });
      anchor = waypoint;
      firstCandidate = farthest + 1;
    }
    return simplified;
  }

  private moveWithNavigation(
    deltaX: number,
    deltaY: number,
    allowManualMicroDetour = false,
  ): void {
    const distance = Math.hypot(deltaX, deltaY);
    if (distance <= 1e-8) return;
    if (this.#speedBoost) {
      this.position.x += deltaX;
      this.position.y += deltaY;
      return;
    }
    const steps = Math.max(1, Math.ceil(distance / NAVIGATION_SUBSTEP));
    const stepX = deltaX / steps;
    const stepY = deltaY / steps;
    for (let step = 0; step < steps; step++) {
      const from = { ...this.position };
      const candidate = { x: from.x + stepX, y: from.y + stepY };
      if (this.world.navigation.canStep(from, candidate)) {
        this.position.x = candidate.x;
        this.position.y = candidate.y;
        continue;
      }

      // Smooth wall slide, still validating every crossed cell.
      const horizontal = { x: from.x + stepX, y: from.y };
      const vertical = { x: from.x, y: from.y + stepY };
      const canHorizontal = Math.abs(stepX) > 1e-8 && this.world.navigation.canStep(from, horizontal);
      const canVertical = Math.abs(stepY) > 1e-8 && this.world.navigation.canStep(from, vertical);
      if (canHorizontal && (!canVertical || Math.abs(stepX) >= Math.abs(stepY))) {
        this.position.x = horizontal.x;
      } else if (canVertical) {
        this.position.y = vertical.y;
      } else if (
        allowManualMicroDetour
        && this.beginManualMicroDetour(from, stepX, stepY)
      ) {
        this.moveAlongManualDetour(Math.hypot(stepX, stepY));
        break;
      }
    }
  }

  private updateAvatar(deltaSeconds: number, moving: boolean): void {
    const avatar = this.#avatar;
    if (!avatar) return;
    if (this.#dead) {
      this.#deathElapsed += deltaSeconds;
      if (
        this.#avatarAction === "DIE"
        && this.#deathElapsed >= this.#deathAnimationSeconds
      ) {
        this.playAvatarAction(this.#mounted ? ["MDEAD", "MDIE", "DEAD"] : ["DEAD", "DIE"]);
      }
    } else if (this.#actionLockRemaining > 0 && !moving) {
      this.#actionLockRemaining = Math.max(0, this.#actionLockRemaining - deltaSeconds);
    } else {
      // Movement is an explicit action interrupt. In particular, the macro can
      // acquire its next target while the previous bow take is still locked;
      // carrying that lock into locomotion made the rider and mount slide in
      // their idle/attack poses until the clip elapsed.
      this.#actionLockRemaining = 0;
      this.playAvatarAction(this.#mounted
        ? [moving ? "MRUN" : "MSTND01", moving ? "MWALK" : "STAND01"]
        : [moving ? "RUN" : "STAND02", moving ? "WALK" : "STAND01"]);
    }
    avatar.update(deltaSeconds);
    if (this.#mounted) {
      // Preserve non-looping mount actions (notably LEVELUP/STRIKE) while the
      // matching rider action is locked. Real movement clears the lock in the
      // branch above and still switches both actors to locomotion immediately.
      if (!this.#dead && (moving || this.#actionLockRemaining <= 0)) {
        this.#mount?.setMoving(moving);
      }
      this.#mount?.update(deltaSeconds);
    }
  }

  private playAvatarAction(actions: readonly string[], restart = false): ReturnType<ClassicPlayerAvatar["play"]> {
    const avatar = this.#avatar;
    if (!avatar) return null;
    if (!restart && this.#avatarAction !== null && actions.includes(this.#avatarAction)) {
      return { name: this.#avatarAction, durationSeconds: 0 };
    }
    const action = avatar.play(actions, restart);
    if (action) this.#avatarAction = action.name;
    return action;
  }

  private currentClassicYaw(): number {
    return this.#classicYaw;
  }

  private syncMountedVisuals(): void {
    if (this.#mount) this.#mount.object.visible = this.#mounted;
    if (this.#avatar) {
      if (this.#mounted && this.#mount) {
        this.#avatar.attachToMount(
          this.#mount.riderAnchor,
          this.#mount.look.riderAttachment,
        );
      }
      else this.#avatar.attachOnFoot(this.#visualRoot, this.currentClassicYaw());
    }
    // Loading fallback only; the real rider follows hs01 bone 4 above.
    this.#fallback.position.y = this.#mounted ? 1.8 : 0.95;
    if (!this.#dead) {
      this.#avatarAction = null;
      this.playAvatarAction(this.#mounted ? ["MSTND01", "STAND01"] : ["STAND02", "STAND01"]);
      if (this.#mounted) this.#mount?.playIdle(true);
    }
    this.applyInvisibility();
  }

  private applyInvisibility(): void {
    const materials = new Set<THREE.Material>();
    this.#visualRoot.traverse((child) => {
      if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Points)) return;
      const entries = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of entries) materials.add(material);
    });
    for (const material of materials) {
      const stored = material.userData.wydInvisibilityBase as InvisibilityMaterialState | undefined;
      const base = stored ?? {
        transparent: material.transparent,
        opacity: material.opacity,
        depthWrite: material.depthWrite,
      };
      if (!stored) material.userData.wydInvisibilityBase = base;
      material.transparent = this.#invisible || base.transparent;
      material.opacity = this.#invisible ? Math.min(base.opacity, 0.38) : base.opacity;
      material.depthWrite = this.#invisible ? false : base.depthWrite;
      material.needsUpdate = true;
    }
  }
}

interface InvisibilityMaterialState {
  readonly transparent: boolean;
  readonly opacity: number;
  readonly depthWrite: boolean;
}

function cellCenter(cell: WydPosition): WydPosition {
  return { x: Math.floor(cell.x) + 0.5, y: Math.floor(cell.y) + 0.5 };
}

function huntressSkillActions(classicIndex: number, mounted: boolean): readonly string[] {
  if (mounted) {
    // Act2 mounted slot 7 maps to MATT3; slot 8 maps to MSKIL01.
    if (classicIndex === 72 || classicIndex === 75 || classicIndex === 80 || classicIndex === 81 || classicIndex === 88) {
      return ["MATT3", "MATT2", "MATT1"];
    }
    return ["MSKIL01", "MATT3", "MATT1"];
  }
  switch (classicIndex) {
    case 72:
    case 80:
      // Act2=8 / ECMOTION_ATTACK04 resolves to Mage row SKILL02.
      return ["SKILL02", "ATTACK1"];
    case 76:
      return ["MERCHL", "SKILL03", "ATTACK1"];
    case 81:
      // Action2=9/7: ATTACK05 resolves to SKILL03 on foot and MATT3 mounted.
      return ["SKILL03", "SKILL02", "ATTACK1"];
    case 88:
      return ["HOLY", "SKILL02", "ATTACK1"];
    default:
      // Act2=9/10 (ATTACK05/06) inherit the authored bow SKILL03 clip.
      return ["SKILL03", "SKILL02", "ATTACK1"];
  }
}

function classSkillActions(
  skill: Pick<ClassSkill, "action1" | "action2">,
  classKey: ClassicPlayerClassKey,
  mounted: boolean,
): readonly string[] {
  const sequence = classKey === "foema" || classKey === "huntress"
    ? skill.action2
    : skill.action1;
  const value = sequence[mounted ? 3 : 0] ?? 0;
  const authored = classicSkillMotion(value - 1, mounted);
  if (mounted) return authored
    ? [authored, "MSKIL01", "MATT3", "MATT1"]
    : ["MSKIL01", "MATT3", "MATT1"];
  return authored
    ? [authored, "SKILL03", "SKILL02", "SKILL01", "ATTACK1"]
    : ["SKILL03", "SKILL02", "SKILL01", "ATTACK1"];
}

function classicSkillMotion(motion: number, mounted: boolean): string | null {
  const base = new Map<number, string>([
    [4, "ATTACK1"], [5, "ATTACK2"], [6, "ATTACK3"],
    [7, "SKILL01"], [8, "SKILL02"], [9, "SKILL03"],
    [18, "MERCHL"], [23, "HOLY"],
  ]).get(motion) ?? null;
  if (!mounted || !base) return base;
  const mountedActions: Readonly<Record<string, string>> = {
    ATTACK1: "MATT1",
    ATTACK2: "MATT2",
    ATTACK3: "MATT3",
    SKILL01: "MSKIL01",
    SKILL02: "MSKIL02",
    SKILL03: "MSKIL03",
    MERCHL: "MMERCHL",
    HOLY: "MHOLY",
  };
  return mountedActions[base] ?? null;
}

function classicYawForVelocity(dx: number, dy: number): number {
  return -(Math.atan2(dx, dy) + Math.PI / 2);
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    for (const entry of material) entry.dispose();
  } else {
    material.dispose();
  }
}
