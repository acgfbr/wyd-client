import * as THREE from "three";
import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { FIELD_WORLD_SIZE, fieldAt, toScene, type WydPosition } from "../../world/coordinates";
import { fieldKey } from "../../world/regions";
import { ClassicSkinnedAssetLibrary, type ClassicSkinnedInstanceLease } from "./ClassicSkinnedAssetLibrary";
import {
  createClassicFriendlyHoverOutline,
  type ClassicFriendlyHoverOutline,
} from "./ClassicFriendlyHoverOutline";
import type {
  ClassicMonsterAttackEvent,
  ClassicActorSoundEvent,
  ClassicMonsterEventListener,
  ClassicMonsterEventMap,
  ClassicMonsterEventName,
  ClassicMonsterSnapshot,
  ClassicStrikeResult,
} from "./ClassicMonsterGameplay";
import {
  classicNpcHeadItemIndex,
  classicNpcInteractionCode,
  classifyClassicNpcInteraction,
} from "./ClassicNpcInteraction";
import { MonsterCatalog, type MonsterGenerator, type MonsterTemplate } from "./MonsterCatalog";

export type {
  ClassicActorSoundEvent,
  ClassicMonsterAttackEvent,
  ClassicMonsterDeathEvent,
  ClassicMonsterDropEvent,
  ClassicMonsterEventListener,
  ClassicMonsterEventMap,
  ClassicMonsterEventName,
  ClassicMonsterHitEvent,
  ClassicNpcInteractionKind,
  ClassicMonsterRespawnEvent,
  ClassicMonsterSnapshot,
  ClassicStrikeResult,
} from "./ClassicMonsterGameplay";

const MAX_ACTORS_PER_FIELD = 40;
const MATERIALIZE_BATCH = 4;
const DENSE_FIELD_RESELECT_DISTANCE = 24;
// Creature assets start before ClassicWorld requests the neighbouring TRN
// (28 units). At G speed (64 u/s), 56 units still leaves ~0.88 s to prepare
// the ten worst-case materialization batches before crossing the Field edge.
const ADJACENT_FIELD_PRELOAD_DISTANCE = 56;
const ADJACENT_FIELD_RELEASE_DISTANCE = 64;
const TARGET_ID_USER_DATA_KEY = "classicMonsterTargetId";
const FRIENDLY_IDLE_MIN_RADIUS = 1;
const FRIENDLY_IDLE_MAX_RADIUS = 1.75;
const FRIENDLY_IDLE_HARD_RADIUS = 2.25;
const FRIENDLY_IDLE_NAVIGATION_STEP = 0.25;
const HOSTILE_HOVER_OUTLINE_COLOR = 0xff5b4d;
const HOSTILE_SELECTED_OUTLINE_COLOR = 0xffd45a;
const ACTOR_SOUND_DISTANCE = 36;
const LOOPING_SOUND_ACTIONS = new Set([
  "STAND01",
  "STAND02",
  "WALK",
  "RUN",
  "MSTND01",
  "MSTND02",
  "MWALK",
  "MRUN",
]);

export interface ClassicSpawnEnvironment {
  readonly origin: WydPosition;
  heightAt(position: WydPosition): number;
  isFieldLoaded(column: number, row: number): boolean;
  /** Optional future bridge to the client's collision/navigation grid. */
  isWalkable?(position: WydPosition): boolean;
  /** Optional offline player-health bridge; attacks are emitted regardless. */
  damagePlayer?(event: ClassicMonsterAttackEvent): void;
}

interface SpawnSpec {
  readonly generator: MonsterGenerator;
  readonly templateIndex: number;
  readonly position: WydPosition;
  readonly routeOffset: WydPosition;
  readonly ordinal: number;
}

interface RouteWaypoint extends WydPosition {
  readonly waitSeconds: number;
}

type RouteMode = "stationary" | "loop" | "reset" | "ping-pong";
type ActorAiMode = "route" | "chase" | "return";

interface PersistentLifeState {
  hp: number;
  maxHp: number;
  deadAtSeconds: number | null;
  respawnAtSeconds: number | null;
  deathCount: number;
}

interface SpawnedActor {
  readonly id: string;
  readonly name: string;
  readonly templateIndex: number;
  readonly template: MonsterTemplate;
  readonly generator: MonsterGenerator;
  readonly object: THREE.Group;
  readonly lease: ClassicSkinnedInstanceLease;
  readonly position: { x: number; y: number };
  readonly spawnPosition: WydPosition;
  readonly homePosition: WydPosition;
  readonly life: PersistentLifeState;
  readonly hostile: boolean;
  readonly route: readonly RouteWaypoint[];
  readonly routeMode: RouteMode;
  waypointIndex: number;
  direction: 1 | -1;
  waitRemaining: number;
  resetAfterWait: boolean;
  moving: boolean;
  yaw: number;
  currentAction: string | null;
  soundAction: string | null;
  nextActionSoundAt: number;
  actionLockRemaining: number;
  hitFlashRemaining: number;
  freezeRemainingSeconds: number;
  cancellationRemainingSeconds: number;
  readonly affectMaterials: ActorAffectMaterial[];
  friendlyOutline: ClassicFriendlyHoverOutline | null;
  hostileOutline: ClassicFriendlyHoverOutline | null;
  aiMode: ActorAiMode;
  nextAttackAtSeconds: number;
  attackCount: number;
  readonly speed: number;
  readonly perceptionRadius: number;
  readonly leashRadius: number;
  readonly attackRange: number;
  readonly attackCooldownSeconds: number;
  readonly attackDamage: number;
  readonly experienceReward: number;
  readonly coinReward: number;
  readonly animationPhaseSeconds: number;
  readonly collisionRadius: number;
  readonly separationSeed: number;
  readonly idleWanderRadius: number | null;
  readonly label: THREE.Sprite;
  readonly labelTexture: THREE.CanvasTexture;
  readonly labelMaterial: THREE.SpriteMaterial;
}

interface ActorAffectMaterial {
  readonly mesh: THREE.SkinnedMesh;
  readonly original: THREE.MeshLambertMaterial;
  readonly material: THREE.MeshLambertMaterial;
}

interface StreamedSpawnField {
  readonly key: string;
  readonly column: number;
  readonly row: number;
  readonly group: THREE.Group;
  readonly actors: SpawnedActor[];
  generation: number;
  job: Promise<void> | null;
  selectionAnchor: WydPosition;
}

/** Streams classic NPCs/monsters for the current Field and nearby cardinal Fields. */
export class ClassicSpawnManager {
  readonly object = new THREE.Group();
  readonly #assets: ClassicSkinnedAssetLibrary;
  readonly #availableFields = new Set<string>();
  #activeFieldKey = "";
  #activeColumn = -1;
  #activeRow = -1;
  #generation = 0;
  readonly #fields = new Map<string, StreamedSpawnField>();
  #actors: SpawnedActor[] = [];
  readonly #actorsById = new Map<string, SpawnedActor>();
  #friendlyHoverId: string | null = null;
  #hostileHoverId: string | null = null;
  #selectedHostileId: string | null = null;
  readonly #lifeStates = new Map<string, PersistentLifeState>();
  readonly #listeners = new Map<
    ClassicMonsterEventName,
    Set<(event: ClassicMonsterEventMap[ClassicMonsterEventName]) => void>
  >();
  readonly #routeEpochMilliseconds = performance.now();

  private constructor(
    private readonly catalog: MonsterCatalog,
    assets: ClassicAssetSource,
    private readonly environment: ClassicSpawnEnvironment,
  ) {
    this.#assets = new ClassicSkinnedAssetLibrary(assets, catalog);
    for (const field of assets.manifest.fields) {
      this.#availableFields.add(fieldKey(field.column, field.row));
    }
    this.object.name = "classic-npcs-and-monsters";
  }

  static async create(
    assets: ClassicAssetSource,
    environment: ClassicSpawnEnvironment,
  ): Promise<ClassicSpawnManager> {
    return new ClassicSpawnManager(await MonsterCatalog.load(assets), assets, environment);
  }

  dispose(): void {
    for (const key of [...this.#fields.keys()]) this.cancelField(key);
    this.#actors.length = 0;
    this.#actorsById.clear();
    this.#friendlyHoverId = null;
    this.#hostileHoverId = null;
    this.#selectedHostileId = null;
    this.#listeners.clear();
    this.object.removeFromParent();
    this.object.clear();
  }

  snapshot(id: string): ClassicMonsterSnapshot | null {
    const actor = this.#actorsById.get(id);
    return actor ? actorSnapshot(actor) : null;
  }

  snapshots(): readonly ClassicMonsterSnapshot[] {
    return this.#actors.map(actorSnapshot);
  }

  /** Remaining local affect-32 lifetime used by its state-owned renderer. */
  classicCancellationRemaining(id: string): number {
    const actor = this.#actorsById.get(id);
    if (!actor || !isActorAlive(actor)) return 0;
    return actor.cancellationRemainingSeconds;
  }

  targetFromObject(object: THREE.Object3D | null): ClassicMonsterSnapshot | null {
    for (let current = object; current; current = current.parent) {
      const id = current.userData[TARGET_ID_USER_DATA_KEY];
      if (typeof id === "string") return this.snapshot(id);
      if (current === this.object) break;
    }
    return null;
  }

  /** Keeps at most one short-lived green silhouette for a friendly mouse-over. */
  setFriendlyHover(id: string | null): void {
    if (id === this.#friendlyHoverId) {
      const current = id ? this.#actorsById.get(id) : null;
      if (
        id === null
        || (
          current?.friendlyOutline
          && !current.hostile
          && isActorAlive(current)
          && current.object.parent?.visible !== false
        )
      ) return;
    }

    const previousId = this.#friendlyHoverId;
    this.#friendlyHoverId = null;
    if (previousId) {
      const previous = this.#actorsById.get(previousId);
      if (previous) disposeActorFriendlyOutline(previous);
    }
    if (!id) return;

    const actor = this.#actorsById.get(id);
    if (
      !actor
      || actor.hostile
      || !isActorAlive(actor)
      || actor.object.parent?.visible === false
    ) return;
    const outline = createClassicFriendlyHoverOutline(actor.lease.model.meshes);
    if (!outline) return;
    actor.friendlyOutline = outline;
    this.#friendlyHoverId = id;
  }

  /** Red while hovered; gold remains after click while the hostile is selected. */
  setHostileHover(id: string | null): void {
    const actor = id ? this.#actorsById.get(id) : null;
    const next = actor?.hostile && isActorAlive(actor) ? actor.id : null;
    if (next === this.#hostileHoverId) {
      if (next) this.refreshHostileOutline(next);
      return;
    }
    const previous = this.#hostileHoverId;
    this.#hostileHoverId = next;
    if (previous) this.refreshHostileOutline(previous);
    if (next) this.refreshHostileOutline(next);
  }

  /** Selection is presentation-only; combat ownership remains in GameApp. */
  setSelectedHostile(id: string | null): void {
    const actor = id ? this.#actorsById.get(id) : null;
    const next = actor?.hostile && isActorAlive(actor) ? actor.id : null;
    if (next === this.#selectedHostileId) {
      if (next) this.refreshHostileOutline(next);
      return;
    }
    const previous = this.#selectedHostileId;
    this.#selectedHostileId = next;
    if (previous) this.refreshHostileOutline(previous);
    if (next) this.refreshHostileOutline(next);
  }

  private refreshHostileOutline(id: string): void {
    const actor = this.#actorsById.get(id);
    if (!actor) return;
    const selected = this.#selectedHostileId === id;
    const hovered = this.#hostileHoverId === id;
    const visible = actor.object.parent?.visible !== false;
    if (!actor.hostile || !isActorAlive(actor) || !visible || (!selected && !hovered)) {
      disposeActorHostileOutline(actor);
      return;
    }
    const color = selected ? HOSTILE_SELECTED_OUTLINE_COLOR : HOSTILE_HOVER_OUTLINE_COLOR;
    if (actor.hostileOutline) {
      actor.hostileOutline.setColor(color);
      return;
    }
    actor.hostileOutline = createClassicFriendlyHoverOutline(actor.lease.model.meshes, {
      color,
      opacity: selected ? 0.92 : 0.86,
      name: "classic-hostile-target-outline",
    });
  }

  on<K extends ClassicMonsterEventName>(
    type: K,
    listener: ClassicMonsterEventListener<K>,
  ): () => void {
    const listeners = this.#listeners.get(type) ?? new Set();
    this.#listeners.set(type, listeners);
    const erased = listener as unknown as (event: ClassicMonsterEventMap[ClassicMonsterEventName]) => void;
    listeners.add(erased);
    return () => listeners.delete(erased);
  }

  strikeTarget(id: string, damage: number): ClassicStrikeResult {
    const actor = this.#actorsById.get(id);
    if (!actor) return { ok: false, id, reason: "not-found" };
    if (!isActorAlive(actor)) return { ok: false, id, reason: "dead" };
    if (!Number.isFinite(damage) || damage <= 0) return { ok: false, id, reason: "invalid-damage" };

    const appliedDamage = Math.max(1, Math.min(actor.life.hp, Math.trunc(damage)));
    actor.life.hp -= appliedDamage;
    actor.hitFlashRemaining = 0.18;
    updateStatusSprite(actor);
    const nowSeconds = this.routeClockSeconds();
    let death: { readonly respawnInSeconds: number; readonly dropSeed: number } | null = null;
    if (actor.life.hp > 0) {
      const strikeDuration = playActorAction(actor, ["STRIKE"], true);
      actor.actionLockRemaining = Math.min(0.65, strikeDuration ?? 0.2);
    } else {
      death = this.killActor(actor, nowSeconds);
    }

    const target = actorSnapshot(actor);
    this.emit("hit", { target, damage: appliedDamage, remainingHp: actor.life.hp });
    if (death) {
      this.emit("death", { target, killer: "player", respawnInSeconds: death.respawnInSeconds });
      this.emit("drop", {
        source: target,
        position: { ...actor.position },
        experience: actor.experienceReward,
        coin: actor.coinReward,
        seed: death.dropSeed,
      });
    }
    return { ok: true, target, damage: appliedDamage, killed: !target.alive };
  }

  /**
   * Client-visible portion of affect 1/value 2. Server movement remains out of
   * scope; locally we preserve TMHuman's blue material and 1.15x frame period.
   */
  applyClassicFreeze(id: string, durationSeconds: number): boolean {
    const actor = this.#actorsById.get(id);
    if (!actor || !isActorAlive(actor) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      return false;
    }
    actor.freezeRemainingSeconds = Math.max(actor.freezeRemainingSeconds, durationSeconds);
    applyActorAffectMaterial(actor);
    return true;
  }

  /** Client-visible affect 32: red material while Cancelamento is active. */
  applyClassicCancellation(id: string, durationSeconds: number): boolean {
    const actor = this.#actorsById.get(id);
    if (!actor || !isActorAlive(actor) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      return false;
    }
    actor.cancellationRemainingSeconds = Math.max(
      actor.cancellationRemainingSeconds,
      durationSeconds,
    );
    applyActorAffectMaterial(actor);
    return true;
  }

  private emit<K extends ClassicMonsterEventName>(type: K, event: ClassicMonsterEventMap[K]): void {
    const listeners = this.#listeners.get(type);
    if (!listeners) return;
    for (const listener of listeners) listener(event);
  }

  private killActor(
    actor: SpawnedActor,
    nowSeconds: number,
  ): { readonly respawnInSeconds: number; readonly dropSeed: number } {
    if (this.#friendlyHoverId === actor.id) this.setFriendlyHover(null);
    actor.life.hp = 0;
    if (this.#hostileHoverId === actor.id) this.#hostileHoverId = null;
    this.refreshHostileOutline(actor.id);
    actor.life.deathCount++;
    actor.life.deadAtSeconds = nowSeconds;
    const respawnInSeconds = deterministicRespawnSeconds(actor);
    actor.life.respawnAtSeconds = nowSeconds + respawnInSeconds;
    actor.moving = false;
    actor.aiMode = "route";
    actor.actionLockRemaining = 0;
    actor.hitFlashRemaining = 0;
    clearActorAffects(actor);
    actor.object.visible = true;
    actor.lease.model.object.scale.setScalar(1);
    actor.label.visible = false;
    playActorAction(actor, ["DIE", "DEAD", "STAND01"], true);
    return {
      respawnInSeconds,
      dropSeed: spawnHash(actor.generator, actor.life.deathCount + 1_009),
    };
  }

  update(deltaSeconds: number, playerPosition: WydPosition): void {
    this.syncStreaming(playerPosition);
    if (this.#friendlyHoverId) {
      const hovered = this.#actorsById.get(this.#friendlyHoverId);
      if (
        !hovered
        || hovered.hostile
        || !isActorAlive(hovered)
        || hovered.object.parent?.visible === false
      ) this.setFriendlyHover(null);
    }
    if (this.#hostileHoverId) {
      const hovered = this.#actorsById.get(this.#hostileHoverId);
      if (
        !hovered
        || !hovered.hostile
        || !isActorAlive(hovered)
        || hovered.object.parent?.visible === false
      ) this.setHostileHover(null);
      else this.refreshHostileOutline(hovered.id);
    }
    if (this.#selectedHostileId) this.refreshHostileOutline(this.#selectedHostileId);
    const animateDistanceSquared = FIELD_WORLD_SIZE * FIELD_WORLD_SIZE * 2.25;
    const nowSeconds = this.routeClockSeconds();
    const previousPositions = this.#actors.map((actor) => ({ ...actor.position }));
    for (const actor of this.#actors) {
      this.updateActorGameplay(
        actor,
        deltaSeconds,
        playerPosition,
        nowSeconds,
        actor.object.parent?.visible !== false,
      );
    }
    const isWalkable = this.environment.isWalkable
      ? (position: WydPosition) => this.environment.isWalkable?.(position) ?? true
      : undefined;
    resolveActorSeparation(this.#actors, deltaSeconds, isWalkable);
    constrainFriendlyIdleActors(this.#actors, this.environment);
    for (let actorIndex = 0; actorIndex < this.#actors.length; actorIndex++) {
      const actor = this.#actors[actorIndex]!;
      const previous = previousPositions[actorIndex]!;
      const movedX = actor.position.x - previous.x;
      const movedY = actor.position.y - previous.y;
      if (isActorAlive(actor) && actor.moving && movedX * movedX + movedY * movedY > 1e-6) {
        const targetYaw = classicYawForVelocity(movedX, movedY);
        actor.yaw = smoothAngle(actor.yaw, targetYaw, Math.min(1, Math.max(0, deltaSeconds) * 10));
        actor.lease.model.setClassicTransform({ yaw: actor.yaw });
      }
      const dx = actor.position.x - playerPosition.x;
      const dy = actor.position.y - playerPosition.y;
      const distanceSquared = dx * dx + dy * dy;
      const fieldVisible = actor.object.parent?.visible !== false;
      if (fieldVisible && actor.object.visible && distanceSquared <= animateDistanceSquared) {
        // m_cFreeze multiplies the classic frame period by 1.15, therefore the
        // equivalent elapsed animation time is divided by the same factor.
        actor.lease.model.update(actor.freezeRemainingSeconds > 0 ? deltaSeconds / 1.15 : deltaSeconds);
      }
      this.updateActorSound(actor, nowSeconds, playerPosition, fieldVisible);
      actor.label.visible = fieldVisible && isActorAlive(actor) && distanceSquared <= 40 * 40;
      updateHitFeedback(actor, deltaSeconds);
      updateActorAffects(actor, deltaSeconds);
      const scene = toScene(actor.position, this.environment.origin);
      actor.object.position.x = scene.x;
      actor.object.position.z = scene.z;
      // A preloaded neighbour has no TRN/collision height yet. Keep its last
      // vertical value while hidden and resolve the authoritative height on
      // the very frame its terrain becomes resident.
      if (fieldVisible) actor.object.position.y = this.environment.heightAt(actor.position);
    }
  }

  private updateActorSound(
    actor: SpawnedActor,
    nowSeconds: number,
    listenerPosition: WydPosition,
    fieldVisible: boolean,
  ): void {
    const action = actor.currentAction;
    if (action !== actor.soundAction) {
      actor.soundAction = action;
      actor.nextActionSoundAt = nowSeconds;
    }
    if (
      !action
      || !fieldVisible
      || !actor.object.visible
      || nowSeconds < actor.nextActionSoundAt
      || distanceBetween(actor.position, listenerPosition) > ACTOR_SOUND_DISTANCE
    ) return;
    const family = actor.template.visual
      ? this.catalog.visualFamily(actor.template.visual.skin)
      : null;
    const values = family?.actions?.[action];
    const soundIndex = values?.[values.length - 1] ?? 0;
    if (!Number.isFinite(soundIndex) || soundIndex <= 0) {
      actor.nextActionSoundAt = Number.POSITIVE_INFINITY;
      return;
    }
    const event: ClassicActorSoundEvent = {
      source: actorSnapshot(actor),
      action,
      soundIndex: Math.trunc(soundIndex),
      position: { ...actor.position },
    };
    this.emit("actorSound", event);
    actor.nextActionSoundAt = LOOPING_SOUND_ACTIONS.has(action)
      ? nowSeconds + Math.max(0.3, actor.lease.actionDurationSeconds(action) ?? 0.8)
      : Number.POSITIVE_INFINITY;
  }

  private updateActorGameplay(
    actor: SpawnedActor,
    deltaSeconds: number,
    playerPosition: WydPosition,
    nowSeconds: number,
    canEngagePlayer: boolean,
  ): void {
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(deltaSeconds, 0.1)) : 0;
    if (!isActorAlive(actor)) {
      if (actor.life.respawnAtSeconds !== null && actor.life.respawnAtSeconds <= nowSeconds) {
        this.respawnActor(actor, nowSeconds);
      } else {
        applyDeadActorVisual(actor, nowSeconds);
      }
      return;
    }
    if (delta <= 0) return;

    actor.actionLockRemaining = Math.max(0, actor.actionLockRemaining - delta);
    if (!actor.hostile) {
      if (actor.actionLockRemaining <= 0) {
        advanceActor(actor, delta, actor.idleWanderRadius === null ? undefined : this.environment);
      }
      return;
    }
    if (!canEngagePlayer) {
      // Preloaded/retained Fields keep their autonomous route clock alive, but
      // an invisible creature must never acquire or damage the player before
      // its terrain and navigation are authoritative.
      if (actor.aiMode !== "route") {
        resetActorRoute(actor);
        actor.aiMode = "route";
      }
      if (actor.actionLockRemaining <= 0) advanceActor(actor, delta);
      return;
    }
    this.updateHostileActor(actor, delta, playerPosition, nowSeconds);
  }

  private updateHostileActor(
    actor: SpawnedActor,
    deltaSeconds: number,
    playerPosition: WydPosition,
    nowSeconds: number,
  ): void {
    const playerDistance = distanceBetween(actor.position, playerPosition);
    const playerFromHome = distanceBetween(actor.homePosition, playerPosition);
    const actorFromHome = distanceBetween(actor.homePosition, actor.position);

    if (actor.aiMode === "route" && playerDistance <= actor.perceptionRadius) actor.aiMode = "chase";
    if (actor.aiMode === "chase" && (playerFromHome > actor.leashRadius || actorFromHome > actor.leashRadius)) {
      actor.aiMode = "return";
    }

    if (actor.aiMode === "return") {
      const movement = moveActorToward(
        actor,
        actor.homePosition,
        deltaSeconds,
        1.1,
        this.environment.isWalkable
          ? (position) => this.environment.isWalkable?.(position) ?? true
          : undefined,
      );
      if (movement !== "arrived") return;
      resetActorRoute(actor);
      actor.aiMode = "route";
      return;
    }

    if (actor.aiMode !== "chase") {
      if (actor.actionLockRemaining <= 0) advanceActor(actor, deltaSeconds);
      return;
    }

    if (actor.actionLockRemaining > 0) {
      actor.moving = false;
      faceActor(actor, playerPosition, deltaSeconds);
      return;
    }
    if (playerDistance > actor.attackRange) {
      moveActorToward(
        actor,
        playerPosition,
        deltaSeconds,
        1.12,
        this.environment.isWalkable
          ? (position) => this.environment.isWalkable?.(position) ?? true
          : undefined,
      );
      return;
    }

    setActorMoving(actor, false);
    faceActor(actor, playerPosition, deltaSeconds);
    if (nowSeconds < actor.nextAttackAtSeconds) return;
    const animationDuration = playActorAction(actor, ["ATTACK1", "STRIKE", "STAND01"], true);
    actor.actionLockRemaining = Math.min(0.9, animationDuration ?? 0.45);
    actor.attackCount++;
    const damageSeed = spawnHash(actor.generator, actor.attackCount + 1_301);
    const damageScale = 0.85 + ((damageSeed & 0xff) / 255) * 0.3;
    const damage = Math.max(1, Math.min(1_000_000, Math.round(actor.attackDamage * damageScale)));
    const event: ClassicMonsterAttackEvent = {
      attacker: actorSnapshot(actor),
      playerPosition: { ...playerPosition },
      damage,
      distance: playerDistance,
    };
    this.emit("monsterAttack", event);
    this.environment.damagePlayer?.(event);
    const cooldownScale = 0.9 + (((damageSeed >>> 8) & 0xff) / 255) * 0.2;
    actor.nextAttackAtSeconds = nowSeconds + actor.attackCooldownSeconds * cooldownScale;
  }

  private respawnActor(actor: SpawnedActor, nowSeconds: number): void {
    actor.life.hp = actor.life.maxHp;
    actor.life.deadAtSeconds = null;
    actor.life.respawnAtSeconds = null;
    actor.position.x = actor.spawnPosition.x;
    actor.position.y = actor.spawnPosition.y;
    actor.aiMode = "route";
    actor.actionLockRemaining = 0;
    actor.hitFlashRemaining = 0;
    clearActorAffects(actor);
    actor.object.visible = true;
    actor.lease.model.object.scale.setScalar(1);
    resetActorRoute(actor);
    playActorAction(actor, ["STAND01"], true);
    actor.lease.model.update(actor.animationPhaseSeconds);
    actor.nextAttackAtSeconds = nowSeconds + 0.5 + stableUnit(actor.separationSeed >>> 7) * 0.8;
    updateStatusSprite(actor);
    if (this.#selectedHostileId === actor.id || this.#hostileHoverId === actor.id) {
      this.refreshHostileOutline(actor.id);
    }
    this.emit("respawn", { target: actorSnapshot(actor) });
  }

  private syncStreaming(playerPosition: WydPosition): void {
    const field = fieldAt(playerPosition);
    const key = fieldKey(field.column, field.row);
    if (key !== this.#activeFieldKey) {
      this.#activeFieldKey = key;
      this.#activeColumn = field.column;
      this.#activeRow = field.row;
    }

    const desiredFields = cardinalSpawnFields(field.column, field.row, playerPosition);
    for (const desiredKey of [...desiredFields.keys()]) {
      if (!this.#availableFields.has(desiredKey)) desiredFields.delete(desiredKey);
    }

    // A margem maior para liberar e menor para solicitar evita que uma pequena
    // oscilacao na emenda fique recriando dezenas de meshes. O grupo pode ficar
    // materializado, mas oculto, enquanto seu TRN ainda nao esta residente.
    for (const streamed of this.#fields.values()) {
      if (desiredFields.has(streamed.key)) continue;
      const cardinalDistance = Math.abs(streamed.column - field.column) + Math.abs(streamed.row - field.row);
      if (
        cardinalDistance <= 1
        && distanceToFieldBounds(playerPosition, streamed.column, streamed.row)
          <= ADJACENT_FIELD_RELEASE_DISTANCE
      ) {
        desiredFields.set(streamed.key, { column: streamed.column, row: streamed.row });
      }
    }

    for (const [desiredKey, desired] of desiredFields) {
      const streamed = this.#fields.get(desiredKey);
      if (streamed) {
        streamed.group.visible = this.environment.isFieldLoaded(desired.column, desired.row);
        this.syncDenseFieldSelection(streamed, playerPosition, desiredKey === key);
        continue;
      }
      // CPU/GPU assets are prepared before ClassicWorld requests the TRN. The
      // field group stays hidden until isFieldLoaded becomes true, so no actor
      // can float at height zero while terrain/navigation are unavailable.
      this.startField(desired.column, desired.row, playerPosition);
    }

    for (const streamedKey of [...this.#fields.keys()]) {
      if (!desiredFields.has(streamedKey)) this.cancelField(streamedKey);
    }
  }

  private startField(column: number, row: number, playerPosition: WydPosition): void {
    const key = fieldKey(column, row);
    if (this.#fields.has(key)) return;
    const generators = this.catalog.generatorsForField(column, row);
    if (generators.length === 0) return;

    const group = new THREE.Group();
    group.name = `spawns-${key}`;
    group.visible = this.environment.isFieldLoaded(column, row);
    const streamed: StreamedSpawnField = {
      key,
      column,
      row,
      group,
      actors: [],
      generation: ++this.#generation,
      job: null,
      selectionAnchor: { ...playerPosition },
    };
    this.#fields.set(key, streamed);
    this.object.add(group);
    this.startMaterialization(streamed, generators, playerPosition);
  }

  private syncDenseFieldSelection(
    streamed: StreamedSpawnField,
    playerPosition: WydPosition,
    isPrimaryField: boolean,
  ): void {
    // Enquanto ainda e apenas prefetch, acompanhe a ancora sem trocar o lote.
    // Assim atravessar a borda nao provoca uma segunda carga imediatamente.
    if (!isPrimaryField) {
      streamed.selectionAnchor = { ...playerPosition };
      return;
    }
    const generators = this.catalog.generatorsForField(streamed.column, streamed.row);
    const movedSinceSelection = Math.hypot(
      playerPosition.x - streamed.selectionAnchor.x,
      playerPosition.y - streamed.selectionAnchor.y,
    );
    if (
      generators.length <= MAX_ACTORS_PER_FIELD
      || movedSinceSelection < DENSE_FIELD_RESELECT_DISTANCE
      || streamed.job !== null
    ) return;

    this.cancelField(streamed.key);
    this.startField(streamed.column, streamed.row, playerPosition);
  }

  private startMaterialization(
    streamed: StreamedSpawnField,
    generators: readonly MonsterGenerator[],
    playerPosition: WydPosition,
  ): void {
    const generation = ++this.#generation;
    streamed.generation = generation;
    streamed.selectionAnchor = { ...playerPosition };
    const specs = selectSpawnSpecs(generators, playerPosition);

    const job = (async () => {
      for (let offset = 0; offset < specs.length; offset += MATERIALIZE_BATCH) {
        const batch = specs.slice(offset, offset + MATERIALIZE_BATCH);
        const actors = await Promise.all(batch.map((spec) => this.createActor(spec)));
        if (!this.isCurrent(streamed, generation)) {
          for (const actor of actors) if (actor) this.releaseActor(actor);
          return;
        }
        for (const actor of actors) {
          if (!actor) continue;
          // Alguns bancos antigos repetem um generator na tabela de dois
          // Fields. O id classico e global; jamais materializamos sua copia.
          if (this.#actorsById.has(actor.id)) {
            this.releaseActor(actor);
            continue;
          }
          streamed.actors.push(actor);
          this.#actors.push(actor);
          this.#actorsById.set(actor.id, actor);
          streamed.group.add(actor.object);
        }
        if (offset + MATERIALIZE_BATCH < specs.length) await nextFrame();
      }
    })().catch(() => undefined).finally(() => {
      if (streamed.job === job) streamed.job = null;
    });
    streamed.job = job;
  }

  private async createActor(spec: SpawnSpec): Promise<SpawnedActor | null> {
    const template = this.catalog.template(spec.templateIndex);
    if (!template || template.missing || !template.visual) return null;
    const lease = await this.#assets.createTemplateInstance(spec.templateIndex);
    if (!lease) return null;
    try {
      const id = stableActorId(spec);
      const name = template.name.replaceAll("_", " ");
      const maxHp = classicMaximumHp(template);
      const nowSeconds = this.routeClockSeconds();
      const life = this.lifeStateFor(id, maxHp, nowSeconds);
      const experienceReward = classicReward(template.experience, 2_000_000_000);
      const coinReward = classicReward(template.coin, 100_000_000);
      const hostile = (template.merchant ?? 0) === 0 && experienceReward > 0;
      const scale = classicMobScale(template);
      const movementTemplate = this.catalog.template(spec.generator.leaderTemplate) ?? template;
      const authoredRoute = routeForSpawn(spec);
      const authoredRouteMode = routeModeFor(spec.generator, authoredRoute);
      const enablesFriendlyIdle = !hostile
        && spec.generator.routeType !== 0
        && authoredRouteMode === "stationary";
      const route = enablesFriendlyIdle
        ? friendlyIdleRouteForSpawn(spec, authoredRoute, this.environment)
        : authoredRoute;
      const routeMode = routeModeFor(spec.generator, route, enablesFriendlyIdle);
      const animationPhaseSeconds = classicAnimationPhase(spec);
      const initialYaw = spawnYaw(spec);
      lease.model.setClassicTransform({
        yaw: initialYaw,
        scale,
        mirrorModelZ: true,
      });
      lease.model.update(animationPhaseSeconds);
      lease.model.object.updateMatrixWorld(true);
      const collisionRadius = classicCollisionRadius(lease.model.object);
      const ai = classicAiProfile(spec, template, collisionRadius);
      const actor = new THREE.Group();
      actor.name = `spawn-${spec.generator.id}-${template.key}-${spec.ordinal}`;
      actor.userData[TARGET_ID_USER_DATA_KEY] = id;
      actor.add(lease.model.object);
      const label = createStatusSprite(template, lease.model.object, scale);
      actor.add(label.sprite);
      for (const mesh of lease.model.meshes) mesh.userData[TARGET_ID_USER_DATA_KEY] = id;
      const spawned: SpawnedActor = {
        id,
        name,
        templateIndex: spec.templateIndex,
        template,
        generator: spec.generator,
        object: actor,
        lease,
        position: { ...spec.position },
        spawnPosition: { ...spec.position },
        homePosition: { ...(route[0] ?? spec.position) },
        life,
        hostile,
        route,
        routeMode,
        waypointIndex: route.length > 1 ? 1 : 0,
        direction: 1,
        waitRemaining: route[0]?.waitSeconds ?? 0,
        resetAfterWait: false,
        moving: false,
        yaw: initialYaw,
        currentAction: lease.model.currentClip,
        soundAction: null,
        nextActionSoundAt: nowSeconds,
        actionLockRemaining: 0,
        hitFlashRemaining: 0,
        freezeRemainingSeconds: 0,
        cancellationRemainingSeconds: 0,
        affectMaterials: [],
        friendlyOutline: null,
        hostileOutline: null,
        aiMode: "route",
        nextAttackAtSeconds: nowSeconds + ai.initialAttackDelaySeconds,
        attackCount: 0,
        speed: classicRouteSpeed(movementTemplate, spec.generator),
        perceptionRadius: ai.perceptionRadius,
        leashRadius: ai.leashRadius,
        attackRange: ai.attackRange,
        attackCooldownSeconds: ai.attackCooldownSeconds,
        attackDamage: ai.attackDamage,
        experienceReward,
        coinReward,
        animationPhaseSeconds,
        collisionRadius,
        separationSeed: spawnHash(spec.generator, spec.ordinal + 401),
        idleWanderRadius: enablesFriendlyIdle && routeMode !== "stationary"
          ? FRIENDLY_IDLE_HARD_RADIUS
          : null,
        label: label.sprite,
        labelTexture: label.texture,
        labelMaterial: label.material,
      };
      if (isActorAlive(spawned)) seekActorRoute(spawned, nowSeconds);
      else applyDeadActorVisual(spawned, nowSeconds);
      updateStatusSprite(spawned);
      const scene = toScene(spawned.position, this.environment.origin);
      actor.position.set(scene.x, this.environment.heightAt(spawned.position), scene.z);
      return spawned;
    } catch {
      lease.release();
      return null;
    }
  }

  private isCurrent(streamed: StreamedSpawnField, generation: number): boolean {
    return streamed.generation === generation
      && this.#fields.get(streamed.key) === streamed
      && streamed.group.parent === this.object;
  }

  private releaseActor(actor: SpawnedActor): void {
    if (this.#friendlyHoverId === actor.id && actor.friendlyOutline) {
      this.#friendlyHoverId = null;
    }
    if (this.#hostileHoverId === actor.id) this.#hostileHoverId = null;
    if (this.#selectedHostileId === actor.id) this.#selectedHostileId = null;
    disposeActor(actor);
    // Most life entries are pristine and need not accumulate while the player
    // explores many maps. Preserve only gameplay-relevant state (damage/death
    // history); it is reconciled against the global clock when loaded again.
    if (this.#actorsById.has(actor.id)) return;
    const life = this.#lifeStates.get(actor.id);
    if (
      life === actor.life
      && life.hp === life.maxHp
      && life.deadAtSeconds === null
      && life.respawnAtSeconds === null
      && life.deathCount === 0
    ) {
      this.#lifeStates.delete(actor.id);
    }
  }

  private lifeStateFor(id: string, maxHp: number, nowSeconds: number): PersistentLifeState {
    let life = this.#lifeStates.get(id);
    if (!life) {
      life = { hp: maxHp, maxHp, deadAtSeconds: null, respawnAtSeconds: null, deathCount: 0 };
      this.#lifeStates.set(id, life);
      return life;
    }
    life.maxHp = maxHp;
    if (life.respawnAtSeconds !== null && life.respawnAtSeconds <= nowSeconds) {
      life.hp = maxHp;
      life.deadAtSeconds = null;
      life.respawnAtSeconds = null;
    } else {
      life.hp = Math.max(0, Math.min(maxHp, life.hp));
    }
    return life;
  }

  private routeClockSeconds(): number {
    return Math.max(0, (performance.now() - this.#routeEpochMilliseconds) * 0.001);
  }

  private cancelField(key: string): void {
    const streamed = this.#fields.get(key);
    if (!streamed) return;
    this.#fields.delete(key);
    streamed.generation = ++this.#generation;
    streamed.job = null;
    this.object.remove(streamed.group);
    streamed.group.clear();
    const removed = new Set(streamed.actors);
    for (const actor of streamed.actors) {
      if (this.#actorsById.get(actor.id) === actor) this.#actorsById.delete(actor.id);
      this.releaseActor(actor);
    }
    streamed.actors.length = 0;
    this.#actors = this.#actors.filter((actor) => !removed.has(actor));
  }
}

function cardinalSpawnFields(
  column: number,
  row: number,
  position: WydPosition,
): Map<string, { readonly column: number; readonly row: number }> {
  const desired = new Map<string, { readonly column: number; readonly row: number }>();
  const add = (candidateColumn: number, candidateRow: number): void => {
    desired.set(fieldKey(candidateColumn, candidateRow), { column: candidateColumn, row: candidateRow });
  };
  add(column, row);

  const localX = position.x - column * FIELD_WORLD_SIZE;
  const localY = position.y - row * FIELD_WORLD_SIZE;
  if (localX <= ADJACENT_FIELD_PRELOAD_DISTANCE) add(column - 1, row);
  if (FIELD_WORLD_SIZE - localX <= ADJACENT_FIELD_PRELOAD_DISTANCE) add(column + 1, row);
  if (localY <= ADJACENT_FIELD_PRELOAD_DISTANCE) add(column, row - 1);
  if (FIELD_WORLD_SIZE - localY <= ADJACENT_FIELD_PRELOAD_DISTANCE) add(column, row + 1);
  return desired;
}

function distanceToFieldBounds(position: WydPosition, column: number, row: number): number {
  const minimumX = column * FIELD_WORLD_SIZE;
  const maximumX = minimumX + FIELD_WORLD_SIZE;
  const minimumY = row * FIELD_WORLD_SIZE;
  const maximumY = minimumY + FIELD_WORLD_SIZE;
  const dx = Math.max(minimumX - position.x, 0, position.x - maximumX);
  const dy = Math.max(minimumY - position.y, 0, position.y - maximumY);
  return Math.hypot(dx, dy);
}

function selectSpawnSpecs(
  generators: readonly MonsterGenerator[],
  playerPosition: WydPosition,
): readonly SpawnSpec[] {
  const sorted = [...generators].sort((left, right) => {
    const distance = generatorDistanceSquared(left, playerPosition) - generatorDistanceSquared(right, playerPosition);
    return distance || left.id - right.id;
  });
  const specs: SpawnSpec[] = [];
  for (const generator of sorted) {
    if (generator.start.x === null || generator.start.y === null || generator.leaderTemplate < 0) continue;
    const start = { x: generator.start.x, y: generator.start.y };
    appendUniqueSpawnSpec(specs, generator, generator.leaderTemplate, start, { x: 0, y: 0 }, 0);
    const followerCount = deterministicFollowerCount(generator);
    for (let follower = 0; follower < followerCount && specs.length < MAX_ACTORS_PER_FIELD; follower++) {
      const ordinal = follower + 1;
      const routeOffset = followerOffset(generator, follower);
      appendUniqueSpawnSpec(
        specs,
        generator,
        generator.followerTemplate >= 0 ? generator.followerTemplate : generator.leaderTemplate,
        { x: start.x + routeOffset.x, y: start.y + routeOffset.y },
        routeOffset,
        ordinal,
      );
    }
    if (specs.length >= MAX_ACTORS_PER_FIELD) break;
  }
  return specs;
}

function appendUniqueSpawnSpec(
  specs: SpawnSpec[],
  generator: MonsterGenerator,
  templateIndex: number,
  desiredPosition: WydPosition,
  desiredRouteOffset: WydPosition,
  ordinal: number,
): void {
  const position = uniqueSpawnPosition(desiredPosition, generator, ordinal, specs);
  specs.push({
    generator,
    templateIndex,
    position,
    routeOffset: {
      x: desiredRouteOffset.x + position.x - desiredPosition.x,
      y: desiredRouteOffset.y + position.y - desiredPosition.y,
    },
    ordinal,
  });
}

function uniqueSpawnPosition(
  desired: WydPosition,
  generator: MonsterGenerator,
  ordinal: number,
  existing: readonly SpawnSpec[],
): WydPosition {
  const minimumDistance = 1.15;
  const isFree = (candidate: WydPosition): boolean => existing.every((entry) => {
    const dx = entry.position.x - candidate.x;
    const dy = entry.position.y - candidate.y;
    return dx * dx + dy * dy >= minimumDistance * minimumDistance;
  });
  if (isFree(desired)) return desired;

  const seed = spawnHash(generator, ordinal + 457);
  const baseAngle = ((seed & 0xffff) / 0xffff) * Math.PI * 2;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let attempt = 1; attempt <= 24; attempt++) {
    const radius = 0.75 + Math.floor((attempt - 1) / 7) * 0.65;
    const angle = baseAngle + attempt * goldenAngle;
    const candidate = {
      x: desired.x + Math.cos(angle) * radius,
      y: desired.y + Math.sin(angle) * radius,
    };
    if (isFree(candidate)) return candidate;
  }
  return desired;
}

function deterministicFollowerCount(generator: MonsterGenerator): number {
  if (generator.maxNumMob <= 1) return 0;
  const capacity = Math.max(0, generator.maxNumMob - 1);
  if (generator.maxGroup <= 0 && generator.minGroup <= 0) return Math.min(1, capacity);
  const low = Math.max(0, Math.min(generator.minGroup, generator.maxGroup));
  const high = Math.max(low, generator.maxGroup);
  const selected = low + (spawnHash(generator, 0) % (high - low + 1));
  return Math.min(2, capacity, selected);
}

function followerOffset(generator: MonsterGenerator, follower: number): WydPosition {
  const seed = spawnHash(generator, follower + 1);
  const angle = ((seed & 0xffff) / 0xffff) * Math.PI * 2;
  const maximumRadius = Math.max(0.8, Math.min(4, generator.start.range || 2));
  const radius = maximumRadius * (0.45 + (((seed >>> 16) & 0xff) / 255) * 0.5);
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

function generatorDistanceSquared(generator: MonsterGenerator, position: WydPosition): number {
  if (generator.start.x === null || generator.start.y === null) return Infinity;
  const dx = generator.start.x - position.x;
  const dy = generator.start.y - position.y;
  return dx * dx + dy * dy;
}

function spawnHash(generator: MonsterGenerator, ordinal: number): number {
  const x = Math.trunc(generator.start.x ?? 0);
  const y = Math.trunc(generator.start.y ?? 0);
  let value = (generator.id * 0x45d9f3b) ^ (x * 0x119de1f3) ^ (y * 0x3449f5) ^ (ordinal * 0x27d4eb2d);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}

function stableActorId(spec: SpawnSpec): string {
  const x = Math.round((spec.generator.start.x ?? 0) * 10);
  const y = Math.round((spec.generator.start.y ?? 0) * 10);
  const destinationX = Math.round((spec.generator.destination.x ?? 0) * 10);
  const destinationY = Math.round((spec.generator.destination.y ?? 0) * 10);
  return `classic-${spec.generator.id}-${x}-${y}-${destinationX}-${destinationY}-${spec.templateIndex}-${spec.ordinal}`;
}

function stableUnit(seed: number): number {
  return (seed >>> 0) / 0x1_0000_0000;
}

function actorSnapshot(actor: SpawnedActor): ClassicMonsterSnapshot {
  const interactionCode = classicNpcInteractionCode(actor.template);
  const headItemIndex = classicNpcHeadItemIndex(actor.template);
  return {
    id: actor.id,
    name: actor.name,
    generatorId: actor.generator.id,
    templateIndex: actor.templateIndex,
    templateKey: actor.template.key,
    interactionCode,
    headItemIndex,
    interactionKind: classifyClassicNpcInteraction(interactionCode, headItemIndex),
    position: { ...actor.position },
    hp: actor.life.hp,
    maxHp: actor.life.maxHp,
    alive: isActorAlive(actor),
    hostile: actor.hostile,
  };
}

function isActorAlive(actor: SpawnedActor): boolean {
  return actor.life.deadAtSeconds === null && actor.life.hp > 0;
}

function classicMaximumHp(template: MonsterTemplate): number {
  const raw = template.currentScore?.[5] ?? template.baseScore?.[5] ?? 1;
  return Math.max(1, Math.min(50_000_000, Math.trunc(Number.isFinite(raw) ? raw : 1)));
}

function classicReward(value: number | undefined, maximum: number): number {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) return 0;
  return Math.min(maximum, Math.trunc(value ?? 0));
}

function classicAiProfile(
  spec: SpawnSpec,
  template: MonsterTemplate,
  collisionRadius: number,
): {
  readonly perceptionRadius: number;
  readonly leashRadius: number;
  readonly attackRange: number;
  readonly attackCooldownSeconds: number;
  readonly attackDamage: number;
  readonly initialAttackDelaySeconds: number;
} {
  const seed = spawnHash(spec.generator, spec.ordinal + 607);
  const perceptionRadius = 9 + stableUnit(seed) * 5;
  const leashRadius = Math.max(18, Math.min(34, perceptionRadius + 8 + spec.generator.start.range * 0.25));
  const rawDamage = template.currentScore?.[2] ?? template.baseScore?.[2] ?? 1;
  return {
    perceptionRadius,
    leashRadius,
    attackRange: Math.max(1.15, Math.min(2.5, collisionRadius + 0.75)),
    attackCooldownSeconds: 1.35 + stableUnit(seed >>> 9) * 0.95,
    attackDamage: Math.max(1, Math.min(1_000_000, Math.trunc(Number.isFinite(rawDamage) ? rawDamage : 1))),
    initialAttackDelaySeconds: 0.35 + stableUnit(seed >>> 17) * 0.85,
  };
}

function spawnYaw(spec: SpawnSpec): number {
  const destination = spec.generator.destination;
  const start = spec.generator.start;
  if (destination.x !== null && destination.y !== null && start.x !== null && start.y !== null) {
    const dx = destination.x - start.x;
    const dy = destination.y - start.y;
    if (dx * dx + dy * dy > 0.01) return classicYawForVelocity(dx, dy);
  }
  const direction = ((spawnHash(spec.generator, spec.ordinal) & 0xffff) / 0xffff) * Math.PI * 2;
  return -(direction + Math.PI / 2);
}

function routeForSpawn(spec: SpawnSpec): readonly RouteWaypoint[] {
  const sourcePoints = [spec.generator.start, ...spec.generator.segments, spec.generator.destination];
  const route: RouteWaypoint[] = [];
  for (let sourceIndex = 0; sourceIndex < sourcePoints.length; sourceIndex++) {
    const point = sourcePoints[sourceIndex]!;
    if (point.x === null || point.y === null) continue;
    const rangeOffset = sourceIndex === 0
      ? { x: 0, y: 0 }
      : waypointRangeOffset(spec.generator, sourceIndex, point.range);
    const waypoint = {
      x: point.x + rangeOffset.x + spec.routeOffset.x,
      y: point.y + rangeOffset.y + spec.routeOffset.y,
      waitSeconds: variedRouteWait(point.wait, spec.generator, sourceIndex),
    };
    const previous = route[route.length - 1];
    if (previous && Math.hypot(previous.x - waypoint.x, previous.y - waypoint.y) < 0.05) continue;
    route.push(waypoint);
  }

  // Muitos spawns de campo fornecem um unico centro + Range. O servidor
  // escolhe alvos dentro dele; uma pequena sequencia estavel reproduz esse
  // wander sem RNG por frame e mantem seguidores na mesma formacao.
  if (route.length === 1 && spec.generator.routeType !== 0 && spec.generator.start.range >= 3) {
    const center = route[0]!;
    const radiusLimit = Math.min(8, spec.generator.start.range);
    for (let point = 0; point < 3; point++) {
      const seed = spawnHash(spec.generator, point + 41);
      const angle = ((seed & 0xffff) / 0xffff) * Math.PI * 2;
      const radius = radiusLimit * (0.4 + (((seed >>> 16) & 0xff) / 255) * 0.55);
      route.push({
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
        waitSeconds: variedRouteWait(spec.generator.start.wait, spec.generator, point + 41),
      });
    }
  }
  return route;
}

/**
 * The classic client only consumes movement selected by the server. Until the
 * network layer exists, this is a deliberately small, deterministic offline
 * presentation policy for friendly NPCs whose NPCGener route was being
 * collapsed to stationary; it is not client-side retail AI.
 */
function friendlyIdleRouteForSpawn(
  spec: SpawnSpec,
  authoredRoute: readonly RouteWaypoint[],
  environment: ClassicSpawnEnvironment,
): readonly RouteWaypoint[] {
  const home = authoredRoute[0];
  if (!home) return authoredRoute;

  const authoredTarget = authoredRoute[1];
  if (authoredTarget) {
    const boundedTarget = boundWaypointToHome(authoredTarget, home, FRIENDLY_IDLE_MAX_RADIUS);
    if (
      distanceBetween(home, boundedTarget) >= 0.05
      && isLoadedRouteSegmentNavigable(home, boundedTarget, environment)
    ) {
      return [home, boundedTarget];
    }
  }

  const candidates: RouteWaypoint[] = [];
  for (let slot = 0; slot < 2; slot++) {
    const candidate = friendlyIdleCandidate(spec, home, slot, candidates, environment);
    if (candidate) candidates.push(candidate);
  }
  if (candidates.length === 0) return [home];
  if (candidates.length === 1) return [home, candidates[0]!];
  return [home, candidates[0]!, { ...home }, candidates[1]!];
}

function friendlyIdleCandidate(
  spec: SpawnSpec,
  home: RouteWaypoint,
  slot: number,
  existing: readonly RouteWaypoint[],
  environment: ClassicSpawnEnvironment,
): RouteWaypoint | null {
  for (let attempt = 0; attempt < 8; attempt++) {
    const salt = spec.ordinal * 37 + slot * 101 + attempt + 1_701;
    const angleSeed = spawnHash(spec.generator, salt);
    const radiusSeed = spawnHash(spec.generator, salt + 53);
    const angle = stableUnit(angleSeed) * Math.PI * 2;
    const radius = FRIENDLY_IDLE_MIN_RADIUS
      + stableUnit(radiusSeed) * (FRIENDLY_IDLE_MAX_RADIUS - FRIENDLY_IDLE_MIN_RADIUS);
    const candidate: RouteWaypoint = {
      x: home.x + Math.cos(angle) * radius,
      y: home.y + Math.sin(angle) * radius,
      waitSeconds: friendlyIdleWait(spec.generator.start.wait, spec.generator, salt),
    };
    if (existing.some((point) => distanceBetween(point, candidate) < 0.65)) continue;
    if (isLoadedRouteSegmentNavigable(home, candidate, environment)) return candidate;
  }
  return null;
}

function boundWaypointToHome(
  waypoint: RouteWaypoint,
  home: WydPosition,
  maximumDistance: number,
): RouteWaypoint {
  const dx = waypoint.x - home.x;
  const dy = waypoint.y - home.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= maximumDistance || distance <= 1e-5) return waypoint;
  return {
    x: home.x + (dx / distance) * maximumDistance,
    y: home.y + (dy / distance) * maximumDistance,
    waitSeconds: waypoint.waitSeconds,
  };
}

function routeModeFor(
  generator: MonsterGenerator,
  route: readonly RouteWaypoint[],
  allowFriendlyIdle = false,
): RouteMode {
  if (generator.routeType === 0 || route.length < 2) return "stationary";
  const directDistance = Math.hypot(
    (generator.destination.x ?? generator.start.x ?? 0) - (generator.start.x ?? 0),
    (generator.destination.y ?? generator.start.y ?? 0) - (generator.start.y ?? 0),
  );
  // Em NPCGener, uma linha curta sem segmentos costuma apenas codificar a
  // orientacao do lojista/guarda, nao uma patrulha visivel.
  if (
    !allowFriendlyIdle
    && generator.segments.length === 0
    && generator.start.range < 3
    && directDistance <= 2.5
  ) return "stationary";
  if (generator.routeType === 1) return "reset";
  if (generator.routeType === 2) return "loop";
  return "ping-pong";
}

function advanceActor(
  actor: SpawnedActor,
  deltaSeconds: number,
  routeEnvironment?: ClassicSpawnEnvironment,
): void {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || actor.routeMode === "stationary" || actor.route.length < 2) {
    setActorMoving(actor, false);
    return;
  }
  if (
    routeEnvironment
    && !isLoadedRoutePositionNavigable(actor.position, routeEnvironment)
  ) {
    if (isLoadedRoutePositionNavigable(actor.homePosition, routeEnvironment)) resetActorRoute(actor);
    else setActorMoving(actor, false);
    return;
  }
  advanceActorState(actor, Math.min(deltaSeconds, 0.1), 8, routeEnvironment);
}

type MoveTowardResult = "moving" | "arrived" | "blocked";

function moveActorToward(
  actor: SpawnedActor,
  target: WydPosition,
  deltaSeconds: number,
  speedScale: number,
  isWalkable?: (position: WydPosition) => boolean,
): MoveTowardResult {
  const dx = target.x - actor.position.x;
  const dy = target.y - actor.position.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= 0.12) {
    actor.position.x = target.x;
    actor.position.y = target.y;
    setActorMoving(actor, false);
    return "arrived";
  }
  setActorMoving(actor, true);
  const travel = Math.min(distance, actor.speed * speedScale * Math.max(0, Math.min(deltaSeconds, 0.1)));
  const candidate = {
    x: actor.position.x + (dx / distance) * travel,
    y: actor.position.y + (dy / distance) * travel,
  };
  if (isWalkable && !isWalkable(candidate)) {
    setActorMoving(actor, false);
    return "blocked";
  }
  actor.position.x = candidate.x;
  actor.position.y = candidate.y;
  return travel >= distance ? "arrived" : "moving";
}

function faceActor(actor: SpawnedActor, target: WydPosition, deltaSeconds: number): void {
  const dx = target.x - actor.position.x;
  const dy = target.y - actor.position.y;
  if (dx * dx + dy * dy <= 1e-6) return;
  const targetYaw = classicYawForVelocity(dx, dy);
  actor.yaw = smoothAngle(actor.yaw, targetYaw, Math.min(1, Math.max(0, deltaSeconds) * 12));
  actor.lease.model.setClassicTransform({ yaw: actor.yaw });
}

function distanceBetween(left: WydPosition, right: WydPosition): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function advanceActorState(
  actor: SpawnedActor,
  seconds: number,
  maximumSteps: number,
  routeEnvironment?: ClassicSpawnEnvironment,
): void {
  let remaining = seconds;
  for (let step = 0; step < maximumSteps && remaining > 1e-5; step++) {
    if (actor.resetAfterWait && actor.waitRemaining <= 1e-5) {
      const start = actor.route[0]!;
      actor.position.x = start.x;
      actor.position.y = start.y;
      actor.waypointIndex = 1;
      actor.resetAfterWait = false;
      actor.waitRemaining = start.waitSeconds;
    }
    if (actor.waitRemaining > 0) {
      const consumed = Math.min(actor.waitRemaining, remaining);
      actor.waitRemaining -= consumed;
      remaining -= consumed;
      setActorMoving(actor, false);
      if (actor.waitRemaining > 1e-5) return;
      if (actor.resetAfterWait) {
        const start = actor.route[0]!;
        actor.position.x = start.x;
        actor.position.y = start.y;
        actor.waypointIndex = 1;
        actor.resetAfterWait = false;
        actor.waitRemaining = start.waitSeconds;
        continue;
      }
    }

    const target = actor.route[actor.waypointIndex];
    if (!target) {
      setActorMoving(actor, false);
      return;
    }
    const dx = target.x - actor.position.x;
    const dy = target.y - actor.position.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0.02) {
      actor.position.x = target.x;
      actor.position.y = target.y;
      actor.waitRemaining = target.waitSeconds;
      advanceWaypoint(actor);
      if (actor.waitRemaining > 0) setActorMoving(actor, false);
      continue;
    }

    setActorMoving(actor, true);
    const travel = Math.min(distance, actor.speed * remaining);
    const candidate = {
      x: actor.position.x + (dx / distance) * travel,
      y: actor.position.y + (dy / distance) * travel,
    };
    if (
      routeEnvironment
      && !isLoadedRouteSegmentNavigable(actor.position, candidate, routeEnvironment)
    ) {
      handleFriendlyIdleBlocked(actor, target);
      return;
    }
    actor.position.x = candidate.x;
    actor.position.y = candidate.y;
    if (travel < distance) {
      remaining = 0;
    } else {
      remaining -= distance / actor.speed;
      actor.waitRemaining = target.waitSeconds;
      advanceWaypoint(actor);
      if (actor.waitRemaining > 0) setActorMoving(actor, false);
    }
  }
}

function handleFriendlyIdleBlocked(actor: SpawnedActor, blockedTarget: RouteWaypoint): void {
  setActorMoving(actor, false);
  const targetIsHome = distanceBetween(blockedTarget, actor.homePosition) < 0.05;
  if (targetIsHome) {
    actor.waitRemaining = actor.route[0]?.waitSeconds ?? 0;
    advanceWaypoint(actor);
    return;
  }

  actor.waypointIndex = nextHomeWaypointIndex(actor);
  actor.waitRemaining = 0;
  actor.resetAfterWait = false;
}

function nextHomeWaypointIndex(actor: SpawnedActor): number {
  for (let offset = 1; offset <= actor.route.length; offset++) {
    const index = (actor.waypointIndex + offset) % actor.route.length;
    const waypoint = actor.route[index];
    if (waypoint && distanceBetween(waypoint, actor.homePosition) < 0.05) return index;
  }
  return 0;
}

function seekActorRoute(actor: SpawnedActor, worldAgeSeconds: number): void {
  if (actor.routeMode === "stationary" || actor.route.length < 2) {
    setActorMoving(actor, false);
    return;
  }
  const start = actor.route[0]!;
  actor.position.x = start.x;
  actor.position.y = start.y;
  actor.waypointIndex = 1;
  actor.direction = 1;
  actor.waitRemaining = start.waitSeconds;
  actor.resetAfterWait = false;
  setActorMoving(actor, false);

  const cycleSeconds = routeCycleSeconds(actor);
  if (cycleSeconds <= 1e-5) return;
  const stablePhase = (actor.separationSeed / 0x1_0000_0000) * cycleSeconds;
  const phaseSeconds = (Math.max(0, worldAgeSeconds) + stablePhase) % cycleSeconds;
  advanceActorState(actor, phaseSeconds, 64);

  if (actor.moving) {
    const target = actor.route[actor.waypointIndex];
    if (target) {
      const dx = target.x - actor.position.x;
      const dy = target.y - actor.position.y;
      if (dx * dx + dy * dy > 1e-6) {
        actor.yaw = classicYawForVelocity(dx, dy);
        actor.lease.model.setClassicTransform({ yaw: actor.yaw });
      }
    }
  }
}

function routeCycleSeconds(actor: SpawnedActor): number {
  let forwardDistance = 0;
  for (let index = 1; index < actor.route.length; index++) {
    const previous = actor.route[index - 1]!;
    const current = actor.route[index]!;
    forwardDistance += Math.hypot(current.x - previous.x, current.y - previous.y);
  }
  const travelForward = forwardDistance / actor.speed;
  if (actor.routeMode === "reset") {
    return travelForward + actor.route.reduce((sum, point) => sum + point.waitSeconds, 0);
  }
  if (actor.routeMode === "loop") {
    const first = actor.route[0]!;
    const last = actor.route[actor.route.length - 1]!;
    const closingTravel = Math.hypot(first.x - last.x, first.y - last.y) / actor.speed;
    return travelForward + closingTravel + actor.route.reduce((sum, point) => sum + point.waitSeconds, 0);
  }
  const endpointWait = (actor.route[0]?.waitSeconds ?? 0)
    + (actor.route[actor.route.length - 1]?.waitSeconds ?? 0);
  const internalWait = actor.route.slice(1, -1).reduce((sum, point) => sum + point.waitSeconds * 2, 0);
  return travelForward * 2 + endpointWait + internalWait;
}

function advanceWaypoint(actor: SpawnedActor): void {
  const last = actor.route.length - 1;
  if (actor.routeMode === "loop") {
    actor.waypointIndex = (actor.waypointIndex + 1) % actor.route.length;
    return;
  }
  if (actor.routeMode === "reset") {
    if (actor.waypointIndex >= last) actor.resetAfterWait = true;
    else actor.waypointIndex++;
    return;
  }
  if (actor.waypointIndex >= last) actor.direction = -1;
  else if (actor.waypointIndex <= 0) actor.direction = 1;
  actor.waypointIndex += actor.direction;
}

function setActorMoving(actor: SpawnedActor, moving: boolean): void {
  const action = moving ? "WALK" : "STAND01";
  if (actor.moving === moving && actor.currentAction === action) return;
  actor.moving = moving;
  if (playActorAction(actor, [action]) !== null) {
    // `play` restarts at zero. Give every actor a stable phase so equal mobs
    // do not march or idle in lockstep after changing action.
    actor.lease.model.update(actor.animationPhaseSeconds);
  }
}

function playActorAction(actor: SpawnedActor, actions: readonly string[], restart = false): number | null {
  for (const action of actions) {
    if (!actor.lease.model.play(action, restart)) continue;
    actor.currentAction = action;
    return actor.lease.actionDurationSeconds(action) ?? 0;
  }
  return null;
}

function resetActorRoute(actor: SpawnedActor): void {
  const start = actor.route[0] ?? actor.spawnPosition;
  actor.position.x = start.x;
  actor.position.y = start.y;
  actor.waypointIndex = actor.route.length > 1 ? 1 : 0;
  actor.direction = 1;
  actor.waitRemaining = actor.route[0]?.waitSeconds ?? 0;
  actor.resetAfterWait = false;
  setActorMoving(actor, false);
}

function deterministicRespawnSeconds(actor: SpawnedActor): number {
  const seed = spawnHash(actor.generator, actor.life.deathCount + 1_151);
  return 8 + stableUnit(seed) * 7;
}

function applyDeadActorVisual(actor: SpawnedActor, nowSeconds: number): void {
  actor.moving = false;
  actor.label.visible = false;
  actor.lease.model.object.scale.setScalar(1);
  const deadAt = actor.life.deadAtSeconds ?? nowSeconds;
  const elapsed = Math.max(0, nowSeconds - deadAt);
  const dieDuration = actor.lease.actionDurationSeconds("DIE") ?? 0;
  if (elapsed < dieDuration) playActorAction(actor, ["DIE", "DEAD", "STAND01"]);
  else playActorAction(actor, ["DEAD", "DIE", "STAND01"]);
  const respawnDelay = Math.max(0, (actor.life.respawnAtSeconds ?? nowSeconds) - deadAt);
  const corpseSeconds = Math.min(respawnDelay, Math.max(1.5, dieDuration + 1.25));
  actor.object.visible = elapsed < corpseSeconds;
}

function classicRouteSpeed(template: MonsterTemplate, generator: MonsterGenerator): number {
  const attackRun = template.currentScore?.[4] ?? template.baseScore?.[4] ?? 1;
  const movementTier = Math.max(1, Math.trunc(attackRun) & 0x0f);
  const base = Math.min(3.6, 1.45 + movementTier * 0.18);
  // Members of one formation share speed, while different generators receive
  // clearly different deterministic cadence.
  const jitter = 0.82 + ((spawnHash(generator, 73) & 0xff) / 255) * 0.36;
  return base * jitter;
}

/**
 * TMHuman::MoveTo stores atan2(dx,dy)+PI/2 in m_fWantAngle, then SetAngle
 * forwards its negative to TMSkinMesh::m_vAngle.y. ClassicSkinnedModel takes
 * that latter value. In particular: +X => -PI and +Y => -PI/2.
 */
function classicYawForVelocity(dx: number, dy: number): number {
  return -(Math.atan2(dx, dy) + Math.PI / 2);
}

function smoothAngle(current: number, target: number, amount: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * amount;
}

function classicAnimationPhase(spec: SpawnSpec): number {
  return ((spawnHash(spec.generator, spec.ordinal + 149) & 0xffff) / 0xffff) * 2.4;
}

function variedRouteWait(wait: number, generator: MonsterGenerator, waypoint: number): number {
  const base = classicWaitSeconds(wait);
  if (base <= 0) return 0;
  const seed = spawnHash(generator, waypoint + 211);
  return base * (0.72 + ((seed & 0xff) / 255) * 0.56);
}

function friendlyIdleWait(wait: number, generator: MonsterGenerator, waypoint: number): number {
  const authored = variedRouteWait(wait, generator, waypoint);
  if (authored > 0) return authored;
  // A single legacy merchant has no authored wait at all. Keep the offline
  // stroll visibly idle/walk instead of turning that exceptional row into a
  // perpetual pacing loop.
  return 0.7 + stableUnit(spawnHash(generator, waypoint + 257)) * 0.7;
}

function waypointRangeOffset(generator: MonsterGenerator, waypoint: number, range: number): WydPosition {
  if (!Number.isFinite(range) || range <= 0) return { x: 0, y: 0 };
  const seed = spawnHash(generator, waypoint + 307);
  const angle = ((seed & 0xffff) / 0xffff) * Math.PI * 2;
  const radiusLimit = Math.min(12, range);
  const radius = radiusLimit * (0.25 + (((seed >>> 16) & 0xff) / 255) * 0.7);
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

function classicCollisionRadius(model: THREE.Object3D): number {
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  const horizontalExtent = Math.max(size.x, size.z);
  return Math.max(0.55, Math.min(1.35, horizontalExtent * 0.28));
}

function resolveActorSeparation(
  actors: readonly SpawnedActor[],
  deltaSeconds: number,
  isWalkable?: (position: WydPosition) => boolean,
): void {
  if (actors.length < 2 || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
  const pushX = new Float32Array(actors.length);
  const pushY = new Float32Array(actors.length);

  for (let leftIndex = 0; leftIndex < actors.length; leftIndex++) {
    const left = actors[leftIndex]!;
    if (!isActorAlive(left)) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < actors.length; rightIndex++) {
      const right = actors[rightIndex]!;
      if (!isActorAlive(right)) continue;
      let dx = right.position.x - left.position.x;
      let dy = right.position.y - left.position.y;
      let distance = Math.hypot(dx, dy);
      const actualDistance = distance;
      const minimumDistance = left.collisionRadius + right.collisionRadius;
      if (distance >= minimumDistance) continue;

      if (distance <= 1e-5) {
        const seed = (left.separationSeed ^ right.separationSeed) >>> 0;
        const angle = ((seed & 0xffff) / 0xffff) * Math.PI * 2;
        dx = Math.cos(angle);
        dy = Math.sin(angle);
        distance = 1;
      }
      const normalX = dx / distance;
      const normalY = dy / distance;
      const overlap = Math.min(minimumDistance - actualDistance, 0.5);
      const leftStationary = left.routeMode === "stationary" && left.aiMode === "route";
      const rightStationary = right.routeMode === "stationary" && right.aiMode === "route";

      if (leftStationary && !rightStationary) {
        pushX[rightIndex] = (pushX[rightIndex] ?? 0) + normalX * overlap;
        pushY[rightIndex] = (pushY[rightIndex] ?? 0) + normalY * overlap;
      } else if (!leftStationary && rightStationary) {
        pushX[leftIndex] = (pushX[leftIndex] ?? 0) - normalX * overlap;
        pushY[leftIndex] = (pushY[leftIndex] ?? 0) - normalY * overlap;
      } else {
        const half = overlap * 0.5;
        pushX[leftIndex] = (pushX[leftIndex] ?? 0) - normalX * half;
        pushY[leftIndex] = (pushY[leftIndex] ?? 0) - normalY * half;
        pushX[rightIndex] = (pushX[rightIndex] ?? 0) + normalX * half;
        pushY[rightIndex] = (pushY[rightIndex] ?? 0) + normalY * half;
      }
    }
  }

  const maximumPush = Math.min(0.24, Math.max(0.025, deltaSeconds * 2.4));
  for (let index = 0; index < actors.length; index++) {
    const actor = actors[index]!;
    if (!isActorAlive(actor)) continue;
    let x = pushX[index] ?? 0;
    let y = pushY[index] ?? 0;
    const length = Math.hypot(x, y);
    if (length > maximumPush) {
      x = (x / length) * maximumPush;
      y = (y / length) * maximumPush;
    }
    if (x * x + y * y <= 1e-8) continue;
    const candidate = { x: actor.position.x + x, y: actor.position.y + y };
    // Actor separation is intentionally independent of static collision. Once
    // the decoded client walkability grid is exposed, this hook prevents a
    // separation nudge from crossing it; no fake wall rules are invented here.
    if (isWalkable && !isWalkable(candidate)) continue;
    actor.position.x = candidate.x;
    actor.position.y = candidate.y;
  }
}

function constrainFriendlyIdleActors(
  actors: readonly SpawnedActor[],
  environment: ClassicSpawnEnvironment,
): void {
  for (const actor of actors) {
    const maximumDistance = actor.idleWanderRadius;
    if (!isActorAlive(actor) || maximumDistance === null) continue;
    const dx = actor.position.x - actor.homePosition.x;
    const dy = actor.position.y - actor.homePosition.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= maximumDistance || distance <= 1e-5) continue;

    const clamped = {
      x: actor.homePosition.x + (dx / distance) * maximumDistance,
      y: actor.homePosition.y + (dy / distance) * maximumDistance,
    };
    const fallback = isLoadedRoutePositionNavigable(clamped, environment)
      ? clamped
      : actor.homePosition;
    actor.position.x = fallback.x;
    actor.position.y = fallback.y;
    actor.waypointIndex = nextHomeWaypointIndex(actor);
    actor.waitRemaining = 0;
    actor.resetAfterWait = false;
    setActorMoving(actor, false);
  }
}

function isLoadedRouteSegmentNavigable(
  from: WydPosition,
  to: WydPosition,
  environment: ClassicSpawnEnvironment,
): boolean {
  const distance = distanceBetween(from, to);
  const steps = Math.max(1, Math.ceil(distance / FRIENDLY_IDLE_NAVIGATION_STEP));
  for (let step = 1; step <= steps; step++) {
    const amount = step / steps;
    if (!isLoadedRoutePositionNavigable({
      x: from.x + (to.x - from.x) * amount,
      y: from.y + (to.y - from.y) * amount,
    }, environment)) return false;
  }
  return true;
}

function isLoadedRoutePositionNavigable(
  position: WydPosition,
  environment: ClassicSpawnEnvironment,
): boolean {
  const field = fieldAt(position);
  // Neighbour actors are intentionally materialized before their TRN. An
  // unloaded sample is unknown, not a wall; it is checked once the Field is
  // resident instead of freezing all preloaded NPCs at their spawn point.
  if (!environment.isFieldLoaded(field.column, field.row)) return true;
  return environment.isWalkable?.(position) ?? true;
}

function classicWaitSeconds(wait: number): number {
  return Math.max(0, Math.min(2.5, wait * 0.1));
}

function classicMobScale(template: MonsterTemplate): number {
  const constitution = template.baseScore?.[12] ?? template.currentScore?.[12] ?? 0;
  return Math.max(0.12, Math.min(5, 0.9 * (1 + constitution / 2_000)));
}

function createStatusSprite(
  template: MonsterTemplate,
  model: THREE.Object3D,
  scale: number,
): { readonly sprite: THREE.Sprite; readonly texture: THREE.CanvasTexture; readonly material: THREE.SpriteMaterial } {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  drawStatusCanvas(
    canvas,
    template.name.replaceAll("_", " "),
    classicMaximumHp(template),
    classicMaximumHp(template),
  );
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.name = "monster-name-and-hp";
  sprite.scale.set(4, 1, 1);
  sprite.renderOrder = 1_000;
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const modelTop = Number.isFinite(bounds.max.y) ? bounds.max.y : 2.2 * scale;
  sprite.position.y = Math.max(1.5, Math.min(10, modelTop + 0.55));
  return { sprite, texture, material };
}

function drawStatusCanvas(canvas: HTMLCanvasElement, name: string, hp: number, maximumHp: number): void {
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = "600 18px Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineWidth = 4;
    context.strokeStyle = "rgba(0, 0, 0, .9)";
    context.strokeText(name, 128, 18, 238);
    context.fillStyle = "#f6f1dc";
    context.fillText(name, 128, 18, 238);
    const safeMaximumHp = Math.max(1, maximumHp);
    const safeHp = Math.max(0, Math.min(safeMaximumHp, hp));
    const width = 148;
    const x = (canvas.width - width) / 2;
    context.fillStyle = "rgba(4, 6, 5, .88)";
    context.fillRect(x - 2, 37, width + 4, 12);
    context.fillStyle = "#2b5434";
    context.fillRect(x, 39, width, 8);
    context.fillStyle = "#39df64";
    context.fillRect(x, 39, width * (safeHp / safeMaximumHp), 8);
  }
}

function updateStatusSprite(actor: SpawnedActor): void {
  const canvas = actor.labelTexture.image as HTMLCanvasElement;
  if (!canvas || typeof canvas.getContext !== "function") return;
  drawStatusCanvas(canvas, actor.name, actor.life.hp, actor.life.maxHp);
  actor.labelTexture.needsUpdate = true;
}

function updateHitFeedback(actor: SpawnedActor, deltaSeconds: number): void {
  if (!isActorAlive(actor) || actor.hitFlashRemaining <= 0) {
    actor.hitFlashRemaining = 0;
    actor.lease.model.object.scale.setScalar(1);
    return;
  }
  actor.hitFlashRemaining = Math.max(0, actor.hitFlashRemaining - Math.max(0, deltaSeconds));
  const progress = actor.hitFlashRemaining / 0.18;
  actor.lease.model.object.scale.setScalar(1 + Math.sin(progress * Math.PI) * 0.09);
}

function applyActorAffectMaterial(actor: SpawnedActor): void {
  if (actor.affectMaterials.length === 0) {
    for (const mesh of actor.lease.model.meshes) {
      const source = mesh.material;
      if (Array.isArray(source)) continue;
      if (!(source instanceof THREE.MeshLambertMaterial)) continue;
      const material = source.clone();
      mesh.material = material;
      actor.affectMaterials.push({
        mesh,
        original: source,
        material,
      });
    }
  }
  for (const entry of actor.affectMaterials) {
    if (actor.cancellationRemainingSeconds > 0) {
      // TMHuman::SetColorEffect affect 32: preserve 40% of the lit base,
      // then bias red by 0.2. Cancellation wins over freeze in the client.
      entry.material.color.setRGB(
        entry.original.color.r * 0.4 + 0.2,
        entry.original.color.g * 0.4,
        entry.original.color.b * 0.4,
      );
      entry.material.emissive.copy(entry.material.color);
    } else {
      // Affect 1/value 2 uses (0.0, 0.4, 0.9) for Diffuse/Emissive.
      entry.material.color.setRGB(0, 0.4, 0.9);
      entry.material.emissive.setRGB(0, 0.4, 0.9);
    }
  }
}

function updateActorAffects(actor: SpawnedActor, deltaSeconds: number): void {
  if (actor.freezeRemainingSeconds <= 0 && actor.cancellationRemainingSeconds <= 0) return;
  const delta = Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0);
  actor.freezeRemainingSeconds = Math.max(
    0,
    actor.freezeRemainingSeconds - delta,
  );
  actor.cancellationRemainingSeconds = Math.max(
    0,
    actor.cancellationRemainingSeconds - delta,
  );
  if (actor.freezeRemainingSeconds === 0 && actor.cancellationRemainingSeconds === 0) {
    restoreActorAffectMaterials(actor);
  } else {
    applyActorAffectMaterial(actor);
  }
}

function clearActorAffects(actor: SpawnedActor): void {
  actor.freezeRemainingSeconds = 0;
  actor.cancellationRemainingSeconds = 0;
  restoreActorAffectMaterials(actor);
}

function restoreActorAffectMaterials(actor: SpawnedActor): void {
  for (const entry of actor.affectMaterials) {
    entry.mesh.material = entry.original;
    entry.material.dispose();
  }
  actor.affectMaterials.length = 0;
}

function disposeActorFriendlyOutline(actor: SpawnedActor): void {
  actor.friendlyOutline?.dispose();
  actor.friendlyOutline = null;
}

function disposeActorHostileOutline(actor: SpawnedActor): void {
  actor.hostileOutline?.dispose();
  actor.hostileOutline = null;
}

function disposeActor(actor: SpawnedActor): void {
  actor.object.removeFromParent();
  disposeActorFriendlyOutline(actor);
  disposeActorHostileOutline(actor);
  restoreActorAffectMaterials(actor);
  actor.lease.release();
  actor.labelMaterial.dispose();
  actor.labelTexture.dispose();
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
