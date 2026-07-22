import * as THREE from "three";
import type { ClassicAssetSource } from "../assets/ClassicAssetSource";
import type { ClassicWorld } from "../world/ClassicWorld";
import { toScene, type WydPosition } from "../world/coordinates";
import { ClassicPlayerAvatar } from "./player/ClassicPlayerAvatar";
import { ClassicMount } from "./player/ClassicMount";

const WAYPOINT_REACHED_DISTANCE = 0.18;
const NAVIGATION_SUBSTEP = 0.45;

export class Player {
  readonly object = new THREE.Group();
  readonly position: { x: number; y: number };
  readonly #velocity = new THREE.Vector2();
  readonly #visualRoot = new THREE.Group();
  readonly #fallback: THREE.Mesh;
  readonly #marker: THREE.Mesh;
  #path: WydPosition[] = [];
  #pathIndex = 0;
  #speedBoost = false;
  #avatar: ClassicPlayerAvatar | null = null;
  #mount: ClassicMount | null = null;
  #mounted = false;
  #mountDesired = false;
  #avatarLoadGeneration = 0;
  #mountLoadGeneration = 0;
  #effectsEnabled = true;
  #avatarAction: string | null = null;
  #actionLockRemaining = 0;
  #deathElapsed = 0;
  #deathAnimationSeconds = 0;
  #dead = false;
  #disposed = false;

  get speed(): number { return this.#speedBoost ? 64 : (this.#mounted ? 13 : 8); }
  get speedBoost(): boolean { return this.#speedBoost; }
  get hasClassicAvatar(): boolean { return this.#avatar !== null; }
  get mounted(): boolean { return this.#mounted; }

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

  /** Replaces the loading capsule with the classic six-piece Huntress look. */
  async loadClassicAvatar(assets: ClassicAssetSource): Promise<boolean> {
    const generation = ++this.#avatarLoadGeneration;
    try {
      const avatar = await ClassicPlayerAvatar.load(assets);
      if (!avatar) return false;
      if (this.#disposed || generation !== this.#avatarLoadGeneration) {
        avatar.release();
        return false;
      }
      this.unloadClassicAvatar();
      this.#avatar = avatar;
      avatar.setEffectsEnabled(this.#effectsEnabled);
      this.#visualRoot.add(avatar.object);
      this.#fallback.visible = false;
      avatar.setYaw(this.currentClassicYaw());
      this.syncMountedVisuals();
      if (this.#dead) this.playDeath();
      else if (this.#velocity.lengthSq() > 0.02) this.playAvatarAction(["WALK"]);
      else this.playAvatarAction(["STAND01"]);
      return true;
    } catch {
      return false;
    }
  }

  /** Loads the mount once; R only toggles visibility afterwards. */
  async loadClassicMount(assets: ClassicAssetSource): Promise<boolean> {
    const generation = ++this.#mountLoadGeneration;
    try {
      const mount = await ClassicMount.load(assets);
      if (!mount) return false;
      if (this.#disposed || generation !== this.#mountLoadGeneration) {
        mount.release();
        return false;
      }
      this.unloadClassicMount();
      this.#mount = mount;
      this.#visualRoot.add(mount.object);
      mount.setYaw(this.currentClassicYaw());
      this.#mounted = this.#mountDesired;
      this.syncMountedVisuals();
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
    return this.#mountDesired;
  }

  setEffectsEnabled(enabled: boolean): void {
    this.#effectsEnabled = enabled;
    this.#avatar?.setEffectsEnabled(enabled);
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
    this.#visualRoot.remove(this.#mount.object);
    this.#mount.release();
    this.#mount = null;
    this.#mounted = false;
    this.syncMountedVisuals();
  }

  playAttack(): boolean {
    if (this.#dead) return false;
    const action = this.playAvatarAction(this.#mounted
      ? ["MATT1", "MATT2", "ATTACK1"]
      : ["ATTACK1", "ATTACK2", "STRIKE"], true);
    if (!action) return false;
    this.#actionLockRemaining = Math.max(0.25, Math.min(0.9, action.durationSeconds));
    return true;
  }

  playSkill(variant = 0): boolean {
    if (this.#dead) return false;
    const index = Math.max(1, Math.min(3, Math.trunc(variant) + 1));
    const action = this.playAvatarAction(this.#mounted
      ? [`MSKIL0${index}`, "MATT1", `SKILL0${index}`]
      : [`SKILL0${index}`, "ATTACK1"], true);
    if (!action) return false;
    this.#actionLockRemaining = Math.max(0.3, Math.min(1.1, action.durationSeconds));
    return true;
  }

  playHit(): boolean {
    if (this.#dead) return false;
    const action = this.playAvatarAction(this.#mounted ? ["MSTRIKE", "STRIKE"] : ["STRIKE"], true);
    if (!action) return false;
    this.#actionLockRemaining = Math.max(0.18, Math.min(0.65, action.durationSeconds));
    return true;
  }

  playDeath(): boolean {
    this.#dead = true;
    this.#path = [];
    this.#pathIndex = 0;
    this.#velocity.set(0, 0);
    this.#actionLockRemaining = 0;
    this.#deathElapsed = 0;
    const action = this.playAvatarAction(this.#mounted ? ["MDIE", "MDEAD", "DIE"] : ["DIE", "DEAD"], true);
    this.#deathAnimationSeconds = action?.name === "DIE" || action?.name === "MDIE" ? action.durationSeconds : 0;
    return action !== null;
  }

  playIdle(): void {
    this.#dead = false;
    this.#deathElapsed = 0;
    this.#deathAnimationSeconds = 0;
    this.#actionLockRemaining = 0;
    this.playAvatarAction(this.#mounted ? ["MSTND01", "STAND01"] : ["STAND01"]);
  }

  stop(): void {
    this.#path = [];
    this.#pathIndex = 0;
    this.#velocity.set(0, 0);
    if (!this.#dead) this.playIdle();
  }

  syncObject(): void {
    const scene = toScene(this.position, this.world.origin);
    this.object.position.set(scene.x, this.world.heightAt(this.position), scene.z);
  }

  moveTo(target: WydPosition): void {
    if (this.#dead) return;
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
    this.#velocity.set(0, 0);
    this.position.x = target.x;
    this.position.y = target.y;
    this.syncObject();
  }

  toggleSpeedBoost(): boolean {
    this.#speedBoost = !this.#speedBoost;
    return this.#speedBoost;
  }

  faceToward(target: WydPosition): void {
    const dx = target.x - this.position.x;
    const dy = target.y - this.position.y;
    if (dx * dx + dy * dy <= 1e-8) return;
    this.object.rotation.y = Math.atan2(dx, dy);
    this.#visualRoot.rotation.y = -this.object.rotation.y;
    const yaw = classicYawForVelocity(dx, dy);
    this.#avatar?.setYaw(yaw);
    this.#mount?.setYaw(yaw);
  }

  update(dt: number, keyboardDirection: THREE.Vector2): void {
    const deltaSeconds = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
    const beforeX = this.position.x;
    const beforeY = this.position.y;
    let desired = this.#dead ? new THREE.Vector2() : keyboardDirection.clone();
    let activeWaypoint: WydPosition | null = null;

    if (!this.#dead && desired.lengthSq() > 0) {
      this.#path = [];
      this.#pathIndex = 0;
    } else if (!this.#dead) {
      activeWaypoint = this.currentWaypoint();
      if (activeWaypoint) {
        desired.set(activeWaypoint.x - this.position.x, activeWaypoint.y - this.position.y);
        const distance = desired.length();
        if (distance > 0) desired.divideScalar(distance);
      }
    }

    const targetVelocity = desired.multiplyScalar(this.speed);
    if (activeWaypoint) {
      // TMHuman interpolates position linearly between route entries. Carrying
      // lateral velocity through every cell centre made click movement weave.
      this.#velocity.copy(targetVelocity);
    } else {
      const response = 1 - Math.exp(-deltaSeconds * 14);
      this.#velocity.lerp(targetVelocity, response);
    }
    let movementX = this.#velocity.x * deltaSeconds;
    let movementY = this.#velocity.y * deltaSeconds;
    if (activeWaypoint) {
      const toWaypointX = activeWaypoint.x - this.position.x;
      const toWaypointY = activeWaypoint.y - this.position.y;
      const waypointDistanceSquared = toWaypointX * toWaypointX + toWaypointY * toWaypointY;
      const movementLengthSquared = movementX * movementX + movementY * movementY;
      const movingToward = movementX * toWaypointX + movementY * toWaypointY > 0;
      if (movingToward && movementLengthSquared >= waypointDistanceSquared) {
        movementX = toWaypointX;
        movementY = toWaypointY;
      }
    }
    this.moveWithNavigation(movementX, movementY);
    this.currentWaypoint();

    const movedX = this.position.x - beforeX;
    const movedY = this.position.y - beforeY;
    const moving = movedX * movedX + movedY * movedY > 1e-6;
    if (moving) {
      this.object.rotation.y = Math.atan2(movedX, movedY);
      // GameApp reads object.rotation.y for the minimap. Cancel that parent
      // rotation for the classic model, whose basis receives the exact yaw.
      this.#visualRoot.rotation.y = -this.object.rotation.y;
      this.#avatar?.setYaw(classicYawForVelocity(movedX, movedY));
      this.#mount?.setYaw(classicYawForVelocity(movedX, movedY));
    }
    this.updateAvatar(deltaSeconds, moving);
    this.syncObject();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#avatarLoadGeneration++;
    this.#mountLoadGeneration++;
    this.unloadClassicAvatar();
    this.unloadClassicMount();
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

  private moveWithNavigation(deltaX: number, deltaY: number): void {
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
    } else if (this.#actionLockRemaining > 0) {
      this.#actionLockRemaining = Math.max(0, this.#actionLockRemaining - deltaSeconds);
    } else {
      this.playAvatarAction(this.#mounted
        ? [moving ? "MRUN" : "MSTND01", moving ? "MWALK" : "STAND01"]
        : [moving ? "RUN" : "STAND01", moving ? "WALK" : "STAND02"]);
    }
    avatar.update(deltaSeconds);
    if (this.#mounted) {
      this.#mount?.setMoving(moving);
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
    if (this.#velocity.lengthSq() <= 1e-6) return -Math.PI / 2;
    return classicYawForVelocity(this.#velocity.x, this.#velocity.y);
  }

  private syncMountedVisuals(): void {
    if (this.#mount) this.#mount.object.visible = this.#mounted;
    const riderHeight = this.#mounted ? 1.05 : 0;
    if (this.#avatar) this.#avatar.object.position.y = riderHeight;
    this.#fallback.position.y = 0.95 + riderHeight;
    if (!this.#dead) {
      this.#avatarAction = null;
      this.playAvatarAction(this.#mounted ? ["MSTND01", "STAND01"] : ["STAND01"]);
    }
  }
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
