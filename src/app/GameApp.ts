import * as THREE from "three";
import { ClassicAssetSource } from "../assets/ClassicAssetSource";
import { WydCamera } from "../camera/WydCamera";
import { Player } from "../game/Player";
import {
  ClassSkillSystem,
  type ClassSkill,
  type ClassicClassKey,
} from "../game/combat/ClassSkills";
import {
  beastMasterSummonForSkill,
  type BeastMasterSummonDefinition,
} from "../game/combat/BeastMasterSummons";
import { SPECTRAL_FORCE } from "../game/combat/SpectralForce";
import type {
  ClassicMonsterAttackEvent,
  ClassicMonsterDropEvent,
  ClassicMonsterSnapshot,
  ClassicSpawnManager,
} from "../game/npcs/ClassicSpawnManager";
import { GameInput } from "../input/GameInput";
import { ClassicWorld } from "../world/ClassicWorld";
import { FIELD_WORLD_SIZE, fieldAt, toScene, toWyd, type WydPosition } from "../world/coordinates";
import { Minimap } from "../ui/Minimap";
import { GameHud } from "../ui/GameHud";
import { PlayerState } from "../game/state/PlayerState";
import { ClassicBeastMasterSummon } from "../game/player/ClassicBeastMasterSummon";
import {
  DEFAULT_HUNTRESS_LOOK_KEY,
} from "../game/player/HuntressLooks";
import {
  CLASSIC_PLAYER_CLASSES,
  classicPlayerClass,
} from "../game/player/PlayerClasses";
import {
  DEFAULT_MOUNT_LOOK_KEY,
  MOUNT_LOOKS,
  mountLook,
} from "../game/player/MountLooks";
import { HuntressCombatEffects } from "../render/effects/HuntressCombatEffects";
import { ClassicDamageNumbers } from "../render/effects/ClassicDamageNumbers";
import { ClassicHuntressSkillEffects } from "../render/effects/ClassicHuntressSkillEffects";
import { ClassicEtherealExplosionEffect } from "../render/effects/ClassicEtherealExplosionEffect";
import { configureClassicDdsTextureSupport } from "../render/textures/ClassicDdsTextureLoader";
import {
  connectedFieldRegions,
  fieldKey,
  fieldMapIdentity,
  formatFieldName,
  formatMapOptionName,
  formatRegionTitle,
  type ClassicFieldEntry,
} from "../world/regions";

const ARMIA_SPAWN = { x: 2100, y: 2100 } as const;
const CLICK_MARKER_LIFETIME = 0.72;
const HELD_GROUND_UPDATE_SECONDS = 0.2;
const HELD_GROUND_DESTINATION_EPSILON = 0.08;

interface PendingBowAttack {
  readonly spawns: ClassicSpawnManager;
  readonly targetId: string;
  readonly damage: number;
  readonly critical: boolean;
  readonly classKey: ClassicClassKey;
  remainingSeconds: number;
}

interface PendingSkillEvent {
  remainingSeconds: number;
  readonly execute: () => void;
}

type HeldGroundMode = "target" | "ground";

export class GameApp {
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(45, 1, 0.966, 1200);
  readonly #cameraRig = new WydCamera(this.#camera);
  readonly #renderer: THREE.WebGLRenderer;
  readonly #mobileGpuProfile: boolean;
  readonly #pixelRatio: number;
  readonly #clock = new THREE.Clock();
  readonly #raycaster = new THREE.Raycaster();
  readonly #clickMarker = createClickMarker();
  readonly #heldGroundPointer = new THREE.Vector2();
  readonly #input: GameInput;
  readonly #hud = new GameHud();
  readonly #playerState = new PlayerState("Huntress");
  #skills = new ClassSkillSystem("huntress");
  #activeClassKey: ClassicClassKey = "huntress";
  readonly #combatEffects = new HuntressCombatEffects();
  readonly #skillEffects: ClassicHuntressSkillEffects;
  readonly #etherealExplosionEffects: ClassicEtherealExplosionEffect;
  readonly #damageNumbers: ClassicDamageNumbers;
  #assets?: ClassicAssetSource;
  #player?: Player;
  #world?: ClassicWorld;
  #minimap?: Minimap;
  #currentFieldKey = "";
  #minimapLoadId = 0;
  #teleportId = 0;
  #streamingPaused = false;
  #boundSpawns: ClassicSpawnManager | null = null;
  #spawnUnsubscribers: (() => void)[] = [];
  #selectedTargetId: string | null = null;
  #attackCooldown = 0;
  #attackSequence = 0;
  readonly #pendingBowAttacks: PendingBowAttack[] = [];
  readonly #pendingSkillEvents: PendingSkillEvent[] = [];
  readonly #buffVisualPulseRemaining = new Map<number, number>();
  #targetApproachCooldown = 0;
  #respawnRemaining = 0;
  #autoCombat = false;
  #queuedSkillSlot: number | null = null;
  #macroDecisionCooldown = 0;
  #macroSkillCursor = 0;
  #effectsEnabled = true;
  #clickMarkerElapsed = CLICK_MARKER_LIFETIME;
  #heldGroundUpdateRemaining = 0;
  #heldGroundDestination: WydPosition | null = null;
  #heldGroundMode: HeldGroundMode | null = null;
  #outfitLoadId = 0;
  #classLoadId = 0;
  #mountLoadId = 0;
  #summonGeneration = 0;
  readonly #beastMasterSummons = new Map<number, ClassicBeastMasterSummon>();

  constructor(private readonly container: HTMLElement) {
    this.#mobileGpuProfile = isAppleMobileDevice();
    this.#renderer = new THREE.WebGLRenderer({
      antialias: !this.#mobileGpuProfile,
      powerPreference: this.#mobileGpuProfile ? "default" : "high-performance",
    });
    const textureSupport = configureClassicDdsTextureSupport(this.#renderer);
    const reducedGpuProfile = this.#mobileGpuProfile || textureSupport.mode === "cpu-rgba";
    this.#pixelRatio = Math.min(window.devicePixelRatio, reducedGpuProfile ? 1 : 2);
    this.#renderer.setPixelRatio(this.#pixelRatio);
    this.#renderer.shadowMap.enabled = !reducedGpuProfile;
    this.#renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.#renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.#renderer.domElement.className = "game-canvas";
    this.#renderer.domElement.addEventListener("webglcontextlost", this.webglContextLost);
    this.#renderer.domElement.addEventListener("webglcontextrestored", this.webglContextRestored);
    this.container.appendChild(this.#renderer.domElement);
    this.#skillEffects = new ClassicHuntressSkillEffects(this.#scene);
    this.#etherealExplosionEffects = new ClassicEtherealExplosionEffect(this.#scene);
    this.#damageNumbers = new ClassicDamageNumbers(this.container);
    this.#input = new GameInput(this.#renderer.domElement);
    this.#input.onGroundClick = this.groundClick;
    this.#input.onCameraRotate = (yaw, pitch) => this.#cameraRig.rotate(yaw, pitch);
    this.#input.onZoom = (delta) => this.#cameraRig.zoom(delta);
    this.#input.onSpeedToggle = () => {
      if (!this.#player) return;
      this.breakInvisibility();
      const active = this.#player.toggleSpeedBoost();
      document.querySelector("#speed-boost")?.classList.toggle("is-active", active);
      if (active) {
        this.#playerState.revive();
        this.#respawnRemaining = 0;
        this.#player.playIdle();
        this.#hud.addLog("MODO G · invencível, sem colisão e velocidade extrema.", "system");
      } else {
        this.#hud.addLog("Modo G desativado.", "system");
      }
    };
    this.#input.onInventoryToggle = () => this.#hud.toggleInventory();
    this.#input.onSkillMenuToggle = () => this.#hud.toggleSkills();
    this.#input.onMountToggle = () => this.toggleMount();
    this.#input.onAutoCombatToggle = () => this.toggleAutoCombat();
    this.#input.onEffectsToggle = () => this.toggleEffects();
    this.#input.onSkill = (slot) => this.requestSkill(slot);
    this.#hud.onCatalogSkillUse = (classicIndex) => this.requestCatalogSkill(classicIndex);
    this.#hud.bindPlayer(this.#playerState);
    this.#hud.configureSkills(this.#skills.skills, (slot) => this.requestSkill(slot));
    this.#hud.addLog("Armia carregada. Explore o mundo clássico.", "system");
    if (reducedGpuProfile) {
      document.documentElement.dataset.wydRenderProfile = "mobile";
      this.#hud.addLog(
        textureSupport.mode === "cpu-rgba"
          ? "Compatibilidade móvel · DDS convertido para RGBA."
          : "Compatibilidade móvel · render econômico ativo.",
        "system",
      );
    }
    window.addEventListener("resize", this.resize);
    this.resize();
  }

  async start(): Promise<void> {
    const assets = await ClassicAssetSource.load();
    this.#assets = assets;
    // Small optional payload loaded alongside the world; combat keeps its
    // procedural fallback until the classic critical resources are ready.
    void this.#combatEffects.prepareClassic(assets);
    void this.#skillEffects.prepareClassic(assets);
    void this.#etherealExplosionEffects.prepareClassic(assets);
    this.configureMapSelector(assets);
    this.configureClassSelector();
    this.configureOutfitSelector();
    this.configureMountSelector();
    const map = assets.manifest.maps[assets.manifest.defaultMap];
    if (!map) throw new Error("Mapa padrão não definido");
    const spawn = { x: map.spawn[0], y: map.spawn[1] };
    const world = new ClassicWorld(assets, spawn);
    // O boot aguarda apenas o TRN atual. DAT, modelos e vizinhos entram sem
    // bloquear a primeira imagem.
    await world.ensureCurrent(spawn, true);
    this.#world = world;
    world.setEffectsEnabled(this.#effectsEnabled);
    this.#scene.add(world.object);
    this.#player = new Player(world, spawn);
    this.#player.setEffectsEnabled(this.#effectsEnabled);
    this.#scene.add(this.#player.object);
    void this.#player.loadClassicAvatar(assets, "huntress", DEFAULT_HUNTRESS_LOOK_KEY).then((loaded) => {
      const status = document.querySelector<HTMLElement>("#outfit-status");
      if (!loaded) {
        if (status) status.textContent = "Visual indisponível";
        return;
      }
      const select = document.querySelector<HTMLSelectElement>("#outfit-select");
      if (select) select.value = this.#player?.avatarLookKey ?? DEFAULT_HUNTRESS_LOOK_KEY;
      if (status) status.textContent = this.#player?.avatarLookName ?? "Traje equipado";
    }).catch((error: unknown) => {
      console.warn("Avatar clássico indisponível; mantendo fallback", error);
    });
    void this.#player.loadClassicFamiliar(assets).then((loaded) => {
      if (!loaded) console.warn("Familiar Griupan clássico indisponível");
    }).catch((error: unknown) => {
      console.warn("Familiar Griupan clássico indisponível", error);
    });
    void this.#player.loadClassicMount(assets, DEFAULT_MOUNT_LOOK_KEY).then((loaded) => {
      const select = document.querySelector<HTMLSelectElement>("#mount-select");
      const status = document.querySelector<HTMLElement>("#mount-select-status");
      if (!loaded) {
        if (status) status.textContent = "Montarias indisponíveis";
        this.#hud.addLog("A montaria clássica não pôde ser carregada.", "system");
        return;
      }
      if (select) select.value = this.#player?.mountLookKey ?? DEFAULT_MOUNT_LOOK_KEY;
      if (status) status.textContent = this.#player?.mountName ?? "Montaria equipada";
      if (this.#player?.mounted) this.#hud.setMounted(true, this.#player.mountName ?? "Montaria Lv. 120");
    }).catch((error: unknown) => {
      console.warn("Montaria clássica indisponível", error);
    });
    this.activateField(spawn, true);
    this.#scene.add(this.#clickMarker);
    this.#scene.add(this.#combatEffects.object);
    this.configureScene();
    document.querySelector("#loading")?.classList.add("is-hidden");
    this.#renderer.setAnimationLoop(this.frame);
  }

  private configureScene(): void {
    const sky = new THREE.Color(0x8da6bd);
    this.#scene.background = sky;
    this.#scene.fog = new THREE.Fog(sky, 95, 310);
    this.#scene.add(new THREE.HemisphereLight(0xdce9f5, 0x473d2c, 1.4));
    const sun = new THREE.DirectionalLight(0xffe7be, 2.2);
    sun.position.set(-35, 75, -28);
    sun.castShadow = !this.#mobileGpuProfile;
    if (!this.#mobileGpuProfile) {
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.left = -75;
      sun.shadow.camera.right = 75;
      sun.shadow.camera.top = 75;
      sun.shadow.camera.bottom = -75;
    }
    this.#scene.add(sun);
    this.#camera.position.set(20, 24, 27);
  }

  private readonly frame = (): void => {
    const dt = Math.min(this.#clock.getDelta(), 0.05);
    this.updateClickMarker(dt);
    const wasInvisible = this.#skills.hasBuff(95);
    this.#skills.update(dt);
    this.#combatEffects.update(dt);
    this.#etherealExplosionEffects.update(dt);
    this.#damageNumbers.update(dt);
    this.updatePendingSkillEvents(dt);
    if (wasInvisible && !this.#skills.hasBuff(95)) this.#player?.setInvisible(false);
    this.#hud.setBuffs(this.#skills.activeBuffs());
    for (const skill of this.#skills.skills) {
      this.#hud.setSkillCooldown(skill.slot, this.#skills.remaining(skill.slot), this.#skills.ratio(skill.slot));
    }
    if (this.#player) {
      const mouseForward = this.#input.dualButtonForward();
      this.#cameraRig.rotate(this.#input.rotationAxis() * dt * 1.7);
      if (!this.#streamingPaused) {
        this.updateHeldGroundDestination(dt, mouseForward);
        const keyboard = this.#input.movement();
        if (keyboard.x !== 0 || keyboard.y !== 0 || mouseForward) this.breakInvisibility();
        const movement = new THREE.Vector2();
        if (this.#playerState.snapshot.alive) {
          const axes = this.#cameraRig.groundAxes();
          if (mouseForward) {
            // MMO chord: camera-forward steering while right-drag continues
            // changing yaw. Convert scene X/Z axes back to logical WYD X/Y.
            movement.set(axes.forward.x, -axes.forward.y);
          } else {
            const sceneDirection = axes.right
              .multiplyScalar(keyboard.x)
              .add(axes.forward.multiplyScalar(keyboard.y));
            movement.set(sceneDirection.x, -sceneDirection.y);
          }
        }
        this.#player.update(dt, movement);
        this.#world?.update(dt, this.#player.position);
      }
      this.bindSpawnGameplay();
      this.updateCombat(dt, mouseForward);
      this.updateBeastMasterSummons(dt);
      this.#cameraRig.update(this.#player.object.position, dt);
      this.activateField(this.#player.position);
      const coordinates = document.querySelector<HTMLElement>("#coordinates");
      if (coordinates) coordinates.textContent = `${Math.floor(this.#player.position.x)}, ${Math.floor(this.#player.position.y)}`;
      this.#minimap?.update(this.#player.position, this.#player.object.rotation.y);
    }
    this.updatePersistentBuffEffects(dt);
    this.#skillEffects.update(dt);
    this.#renderer.render(this.#scene, this.#camera);
  };

  private readonly groundClick = (pointer: THREE.Vector2): void => {
    if (!this.#world || !this.#player) {
      this.#heldGroundMode = null;
      return;
    }
    this.#raycaster.setFromCamera(pointer, this.#camera);
    const hits = this.#raycaster.intersectObject(this.#world.object, true);
    const spawns = this.#world.spawns;
    for (const candidate of hits) {
      const target = spawns?.targetFromObject(candidate.object);
      if (!target?.alive) continue;
      this.#heldGroundMode = "target";
      this.#heldGroundDestination = null;
      this.selectTarget(target);
      return;
    }
    const hit = hits.find((candidate) => !spawns?.targetFromObject(candidate.object));
    if (!hit) {
      this.#heldGroundMode = null;
      this.#heldGroundDestination = null;
      return;
    }
    this.#heldGroundMode = "ground";
    this.selectTarget(null);
    this.breakInvisibility();
    this.moveToGroundHit(hit, undefined, true);
    this.#heldGroundUpdateRemaining = HELD_GROUND_UPDATE_SECONDS;
  };

  private updateHeldGroundDestination(deltaSeconds: number, mouseForward: boolean): void {
    if (!this.#input.primaryHeld()) {
      this.#heldGroundUpdateRemaining = 0;
      this.#heldGroundDestination = null;
      this.#heldGroundMode = null;
      return;
    }
    // The chord owns movement while active. Preserve L's mode so releasing R
    // can resume the same ground drag without fabricating another click.
    if (mouseForward) {
      this.#heldGroundUpdateRemaining = 0;
      this.#heldGroundDestination = null;
      return;
    }
    if (
      !this.#world
      || !this.#player
      || !this.#playerState.snapshot.alive
      || !this.#input.heldGroundPointer(this.#heldGroundPointer)
    ) {
      this.#heldGroundUpdateRemaining = 0;
      return;
    }

    this.#heldGroundUpdateRemaining -= deltaSeconds;
    if (this.#heldGroundUpdateRemaining > 0) return;
    this.#heldGroundUpdateRemaining += HELD_GROUND_UPDATE_SECONDS;
    if (this.#heldGroundUpdateRemaining <= 0) {
      this.#heldGroundUpdateRemaining = HELD_GROUND_UPDATE_SECONDS;
    }

    this.#raycaster.setFromCamera(this.#heldGroundPointer, this.#camera);
    const hits = this.#raycaster.intersectObject(this.#world.object, true);
    const spawns = this.#world.spawns;
    let liveTarget: ClassicMonsterSnapshot | null = null;
    for (const candidate of hits) {
      const target = spawns?.targetFromObject(candidate.object);
      if (!target?.alive) continue;
      liveTarget = target;
      break;
    }
    // Retail m_bMoveing semantics: a press on a target waits while still over
    // a living target, then permanently becomes ground navigation after
    // dragging away. A press that began on ground ignores crossed targets.
    if (this.#heldGroundMode === "target" && liveTarget) {
      if (liveTarget.id !== this.#selectedTargetId) this.selectTarget(liveTarget);
      return;
    }
    const hit = hits.find((candidate) => !spawns?.targetFromObject(candidate.object));
    if (!hit) return;
    const transitionedToGround = this.#heldGroundMode !== "ground";
    if (transitionedToGround) this.#heldGroundMode = "ground";
    const destination = toWyd(hit.point.x, hit.point.z, this.#world.origin);
    const previous = this.#heldGroundDestination;
    if (
      previous
      && Math.hypot(destination.x - previous.x, destination.y - previous.y)
        < HELD_GROUND_DESTINATION_EPSILON
    ) return;

    if (this.#selectedTargetId !== null) this.selectTarget(null);
    this.breakInvisibility();
    this.moveToGroundHit(hit, destination, transitionedToGround);
  }

  private moveToGroundHit(
    hit: THREE.Intersection<THREE.Object3D>,
    destination?: WydPosition,
    showMarker = false,
  ): void {
    if (!this.#world || !this.#player) return;
    const resolvedDestination = destination
      ?? toWyd(hit.point.x, hit.point.z, this.#world.origin);
    this.#player.moveTo(resolvedDestination);
    this.#heldGroundDestination = { ...resolvedDestination };
    if (!showMarker) return;
    this.#clickMarker.position.set(hit.point.x, hit.point.y + 0.06, hit.point.z);
    this.#clickMarker.scale.setScalar(0.72);
    const material = this.#clickMarker.material as THREE.MeshBasicMaterial;
    material.opacity = 0.85;
    this.#clickMarker.visible = true;
    this.#clickMarkerElapsed = 0;
  }

  private updateClickMarker(deltaSeconds: number): void {
    if (!this.#clickMarker.visible) return;
    this.#clickMarkerElapsed += deltaSeconds;
    const progress = Math.min(1, this.#clickMarkerElapsed / CLICK_MARKER_LIFETIME);
    const eased = 1 - (1 - progress) * (1 - progress);
    this.#clickMarker.scale.setScalar(0.72 + eased * 0.58);
    (this.#clickMarker.material as THREE.MeshBasicMaterial).opacity = (1 - progress) * 0.85;
    if (progress >= 1) this.#clickMarker.visible = false;
  }

  private bindSpawnGameplay(): void {
    const spawns = this.#world?.spawns ?? null;
    if (!spawns || spawns === this.#boundSpawns) return;
    this.#pendingBowAttacks.length = 0;
    for (const unsubscribe of this.#spawnUnsubscribers) unsubscribe();
    this.#spawnUnsubscribers = [
      spawns.on("monsterAttack", (event) => this.receiveMonsterAttack(event)),
      spawns.on("drop", (event) => this.receiveMonsterDrop(event)),
      spawns.on("death", ({ target, respawnInSeconds }) => {
        if (this.#selectedTargetId === target.id) this.#hud.setTarget(target);
        this.#hud.addLog(`${target.name} derrotado · volta em ${Math.ceil(respawnInSeconds)}s.`, "reward");
      }),
      spawns.on("respawn", ({ target }) => {
        if (this.#selectedTargetId === target.id) this.#hud.setTarget(target);
      }),
      spawns.on("hit", ({ target }) => {
        if (this.#selectedTargetId === target.id) this.#hud.setTarget(target);
      }),
    ];
    this.#boundSpawns = spawns;
  }

  private updateCombat(deltaSeconds: number, manualMouseForward = false): void {
    if (!this.#player || !this.#world) return;
    if (!this.#playerState.snapshot.alive) {
      this.#pendingBowAttacks.length = 0;
      this.#pendingSkillEvents.length = 0;
      this.#respawnRemaining -= deltaSeconds;
      if (this.#respawnRemaining <= 0) this.respawnPlayer();
      return;
    }

    this.#attackCooldown = Math.max(0, this.#attackCooldown - deltaSeconds);
    this.#targetApproachCooldown = Math.max(0, this.#targetApproachCooldown - deltaSeconds);
    this.#macroDecisionCooldown = Math.max(0, this.#macroDecisionCooldown - deltaSeconds);
    if (!this.#boundSpawns) return;
    this.updatePendingBowAttacks(deltaSeconds);
    // Preserve target selection/HUD but do not let combat face-lock the avatar
    // sideways while the two-button steering gesture owns locomotion.
    if (manualMouseForward) return;

    let target = this.#selectedTargetId ? this.#boundSpawns.snapshot(this.#selectedTargetId) : null;
    if (this.#autoCombat && (!target?.alive || !target.hostile)) {
      target = this.acquireNearestTarget();
    }
    if (!target) return;
    this.#hud.setTarget(target);
    if (!target.alive || !target.hostile) return;

    if (this.#autoCombat && this.#queuedSkillSlot === null && this.#macroDecisionCooldown <= 0) {
      const offensive = this.#skills.skills.filter((skill) => skill.target === "enemy");
      for (let offset = 0; offset < offensive.length; offset++) {
        const index = (this.#macroSkillCursor + offset) % offensive.length;
        const skill = offensive[index]!;
        if (this.#skills.remaining(skill.slot) > 0 || this.#playerState.snapshot.mp < skill.mana) continue;
        this.#queuedSkillSlot = skill.slot;
        this.#macroSkillCursor = (index + 1) % offensive.length;
        break;
      }
      this.#macroDecisionCooldown = 2.1;
    }

    const dx = target.position.x - this.#player.position.x;
    const dy = target.position.y - this.#player.position.y;
    const distance = Math.hypot(dx, dy);
    const queuedSkill = this.#queuedSkillSlot === null
      ? null
      : this.#skills.skill(this.#queuedSkillSlot);
    const basicRange = this.#activeClassKey === "huntress"
      ? 13.5
      : (this.#activeClassKey === "foema" ? 7 : 2.35);
    const attackRange = (queuedSkill?.range || basicRange)
      + (this.#activeClassKey === "huntress" && SPECTRAL_FORCE.alwaysLearned
        ? SPECTRAL_FORCE.attackRangeBonus
        : 0);
    if (distance > attackRange) {
      if (this.#targetApproachCooldown <= 0) {
        const standOff = Math.max(1.2, attackRange - 0.85);
        this.#player.moveTo({
          x: target.position.x - (dx / distance) * standOff,
          y: target.position.y - (dy / distance) * standOff,
        });
        this.#targetApproachCooldown = 0.22;
      }
      return;
    }
    this.#player.faceToward(target.position);

    if (queuedSkill) {
      this.#queuedSkillSlot = null;
      this.castSkill(queuedSkill, target);
      return;
    }
    if (this.#attackCooldown > 0) return;

    const player = this.#playerState.snapshot;
    const sequence = ++this.#attackSequence;
    const variance = 0.87 + ((Math.imul(sequence, 1_103_515_245) >>> 24) / 255) * 0.28;
    const criticalRoll = (Math.imul(sequence, 2_654_435_761) >>> 0) / 4_294_967_296;
    const critical = criticalRoll < 0.35;
    const damage = Math.max(1, Math.round(player.attack * variance * (critical ? 1.65 : 1)));
    this.breakInvisibility();
    // Reaching bow range ends the approach before the take starts. This keeps
    // the mounted animal planted during the release instead of letting the
    // remaining stand-off waypoint trigger its RUN/take-off curve mid-shot.
    this.#player.stop();
    this.#player.faceToward(target.position);
    const attack = this.#player.playAttack();
    if (!attack) return;
    this.#attackCooldown = 0.72;
    this.#pendingBowAttacks.push({
      spawns: this.#boundSpawns,
      targetId: target.id,
      damage,
      critical,
      classKey: this.#activeClassKey,
      remainingSeconds: attack.releaseDelaySeconds,
    });
  }

  private updatePendingBowAttacks(deltaSeconds: number): void {
    if (!this.#player) return;
    for (let index = this.#pendingBowAttacks.length - 1; index >= 0; index--) {
      const attack = this.#pendingBowAttacks[index]!;
      attack.remainingSeconds -= deltaSeconds;
      if (attack.remainingSeconds > 0) continue;
      this.#pendingBowAttacks.splice(index, 1);
      if (attack.spawns !== this.#boundSpawns) continue;
      const target = attack.spawns.snapshot(attack.targetId);
      if (!target?.alive || !target.hostile) continue;

      const from = this.combatPoint(this.#player.position, 1.26);
      const to = this.combatPoint(target.position, 0.85);
      const applyHit = () => {
        const result = attack.spawns.strikeTarget(attack.targetId, attack.damage);
        if (!result.ok) return;
        this.#damageNumbers.show(
          this.#camera,
          this.combatPoint(result.target.position, 1),
          result.damage,
          attack.critical,
        );
        if (attack.critical) this.#combatEffects.criticalImpact(to);
        else this.#combatEffects.burst(to, 0xd8e8ff, 0.65);
        this.#hud.addLog(
          `${attack.critical ? "CRÍTICO · " : ""}${result.damage} em ${result.target.name}.`,
          "damage",
        );
      };
      if (attack.classKey === "huntress" || attack.classKey === "foema") {
        const color = attack.classKey === "huntress" ? 0xe7cf86 : 0xc8a4ff;
        this.#combatEffects.shoot(from, to, color, applyHit, 1, 50);
      } else {
        this.#combatEffects.burst(to, attack.classKey === "transknight" ? 0xa9eaff : 0xff713d, 0.72);
        applyHit();
      }
    }
  }

  private toggleMount(): void {
    if (!this.#player) return;
    this.breakInvisibility();
    const active = this.#player.toggleMount();
    const name = this.#player.mountName ?? "Montaria Lv. 120";
    this.#hud.setMounted(active, name);
    this.#hud.addLog(active ? `Montado em ${name}.` : "Montaria recolhida.", "system");
  }

  private toggleEffects(): void {
    this.#effectsEnabled = !this.#effectsEnabled;
    this.#world?.setEffectsEnabled(this.#effectsEnabled);
    this.#player?.setEffectsEnabled(this.#effectsEnabled);
    this.#combatEffects.setEnabled(this.#effectsEnabled);
    this.#skillEffects.setEnabled(this.#effectsEnabled);
    this.#etherealExplosionEffects.setEnabled(this.#effectsEnabled);
    const status = document.querySelector<HTMLElement>("#effects-status");
    status?.classList.toggle("is-active", this.#effectsEnabled);
    const label = status?.querySelector("span");
    if (label) label.textContent = this.#effectsEnabled ? "FX ON" : "FX OFF";
    this.#hud.addLog(
      this.#effectsEnabled
        ? "Efeitos visuais ativados."
        : "Efeitos visuais desativados · modo econômico.",
      "system",
    );
  }

  private toggleAutoCombat(): void {
    this.#autoCombat = !this.#autoCombat;
    this.#hud.setAutoCombat(this.#autoCombat);
    if (!this.#autoCombat) {
      this.#queuedSkillSlot = null;
      this.#hud.addLog("Macro de combate desativado.", "system");
      return;
    }
    this.#hud.addLog("Macro ativo · buscando hostis e alternando skills.", "system");
    this.acquireNearestTarget();
  }

  private requestSkill(slot: number): void {
    const skill = this.#skills.skill(slot);
    if (!skill || !this.#playerState.snapshot.alive) return;
    if (skill.kind === "summon") {
      this.castSummonSkill(skill);
      return;
    }
    if (skill.target === "self") {
      this.castBuffSkill(skill);
      return;
    }
    if (this.#skills.remaining(slot) > 0) {
      this.#hud.addLog(`${skill.name} recarrega em ${this.#skills.remaining(slot).toFixed(1)}s.`, "system");
      return;
    }
    if (this.#playerState.snapshot.mp < skill.mana) {
      this.#hud.addLog(`MP insuficiente para ${skill.name}.`, "system");
      return;
    }
    this.#queuedSkillSlot = slot;
    if (!this.#selectedTargetId) this.acquireNearestTarget();
  }

  private requestCatalogSkill(classicIndex: number): void {
    const skill = this.#skills.skills.find((candidate) => candidate.classicIndex === classicIndex);
    if (!skill) return;
    this.requestSkill(skill.slot);
  }

  private castSummonSkill(skill: ClassSkill): void {
    if (
      !this.#player
      || !this.#assets
      || this.#activeClassKey !== "beastmaster"
      || skill.kind !== "summon"
    ) return;
    const definition = beastMasterSummonForSkill(skill.classicIndex);
    if (!definition) return;
    const started = this.#skills.start(skill.slot, this.#playerState);
    if (!started.ok) {
      this.#hud.addLog(started.reason === "mana"
        ? `MP insuficiente para ${skill.name}.`
        : `${skill.name} recarrega em ${this.#skills.remaining(skill.slot).toFixed(1)}s.`, "system");
      return;
    }

    this.breakInvisibility();
    this.#player.stop();
    const timing = this.#player.playClassSkill(skill);
    this.#attackCooldown = Math.max(
      this.#attackCooldown,
      Math.max(0.42, (timing?.animationDurationSeconds ?? 0.54) - 0.12),
    );
    const owner = this.#player.position;
    const angle = definition.skill.instanceValue * 2.399963229728653;
    const spawn = {
      x: owner.x + Math.cos(angle) * 2.1,
      y: owner.y + Math.sin(angle) * 2.1,
    };
    const generation = this.#summonGeneration;
    const loadJob = ClassicBeastMasterSummon.load(definition, spawn, this.#assets);
    const delay = timing?.effectDelaySeconds ?? 0.5;
    this.scheduleSkillEvent(delay, () => {
      void loadJob.then((summon) => {
        if (!summon) {
          this.#hud.addLog(`${definition.name} não pôde ser materializado.`, "system");
          return;
        }
        if (
          generation !== this.#summonGeneration
          || this.#activeClassKey !== "beastmaster"
          || !this.#player
          || !this.#world
        ) {
          summon.release();
          return;
        }
        this.#beastMasterSummons.get(skill.classicIndex)?.release();
        this.#beastMasterSummons.set(skill.classicIndex, summon);
        this.#scene.add(summon.object);
        summon.update(0, this.#player.position, null, this.summonEnvironment(), () => undefined);
        this.#combatEffects.burst(summon.object.position, skill.color, 1.2);
        this.#hud.addLog(`${definition.name} foi evocado.`, "system");
      }).catch((error: unknown) => {
        console.warn(`Evocação ${definition.key} indisponível`, error);
        this.#hud.addLog(`${definition.name} não pôde ser materializado.`, "system");
      });
    });
    this.#hud.addLog(`${skill.name} · ${skill.mana} MP.`, "system");
  }

  private castSkill(skill: ClassSkill, target: ClassicMonsterSnapshot): void {
    if (!this.#player || !this.#boundSpawns || skill.target !== "enemy") return;
    const started = this.#skills.start(skill.slot, this.#playerState);
    if (!started.ok) {
      if (started.reason === "mana") this.#hud.addLog(`MP insuficiente para ${skill.name}.`, "system");
      return;
    }
    this.breakInvisibility();
    this.#player.stop();
    this.#player.faceToward(target.position);
    const timing = this.#player.playClassSkill(skill);
    // Every offensive local route carries DoubleCritical bit 3 while the
    // passive #101 is learned; self buffs deliberately do not trigger it.
    if (this.#activeClassKey === "huntress" && SPECTRAL_FORCE.alwaysLearned) {
      this.#player.triggerSpectralForce();
    }
    this.#attackCooldown = Math.max(
      this.#attackCooldown,
      Math.max(0.42, (timing?.animationDurationSeconds ?? 0.54) - 0.12),
    );
    const spawns = this.#boundSpawns;
    const targetId = target.id;
    const from = this.combatPoint(this.#player.position, 1.25);
    const delay = timing?.effectDelaySeconds ?? 0.5;

    this.scheduleSkillEvent(delay, () => {
      if (spawns !== this.#boundSpawns) return;
      const currentTarget = spawns.snapshot(targetId);
      if (!currentTarget?.alive || !currentTarget.hostile) return;
      const targetBase = this.combatPoint(currentTarget.position, 0);

      if (skill.classKey === "huntress" && (skill.classicIndex === 72 || skill.classicIndex === 80)) {
        this.#skillEffects.playAttackBurst(skill.classicIndex, targetBase);
        if (this.#effectsEnabled) this.#cameraRig.quake(1);
        this.applySkillImpact(skill, targetId, targetBase, false);
        return;
      }

      if (skill.classKey === "huntress" && skill.kind === "shadow") {
        // #88 has no arrow in the original; its five skinned clones are the
        // next isolated VFX port, so keep gameplay at the correct 500 ms.
        this.applySkillImpact(skill, targetId, targetBase, true);
        return;
      }

      const to = this.combatPoint(currentTarget.position, 0.8);
      if (skill.classKey === "huntress" && skill.classicIndex === 86) {
        this.#etherealExplosionEffects.playEtherealExplosion(from, to, () => {
          if (
            spawns !== this.#boundSpawns
            || !this.#playerState.snapshot.alive
            || this.#streamingPaused
            || !spawns.snapshot(targetId)?.alive
          ) return;
          this.applySkillImpact(skill, targetId, targetBase, false);
        });
        return;
      }
      if (skill.kind === "area" || skill.classKey === "transknight") {
        this.#combatEffects.burst(
          targetBase,
          skill.color,
          Math.max(0.9, Math.min(2.5, skill.radius || 0.9)),
        );
        if (skill.classicIndex === 23 && this.#effectsEnabled) this.#cameraRig.quake(1);
        this.applySkillImpact(skill, targetId, targetBase, false);
        return;
      }
      const arrowCount = skill.kind === "volley" ? 3 : (skill.classKey === "huntress" ? 5 : 1);
      this.#combatEffects.shoot(
        from,
        to,
        skill.color,
        () => this.applySkillImpact(skill, targetId, targetBase, true),
        arrowCount,
      );
    });
    this.#hud.addLog(`${skill.name} · ${skill.mana} MP.`, "system");
  }

  private castBuffSkill(skill: ClassSkill): void {
    if (!this.#player || skill.kind !== "buff") return;
    const started = this.#skills.start(skill.slot, this.#playerState);
    if (!started.ok) {
      this.#hud.addLog(started.reason === "mana"
        ? `MP insuficiente para ${skill.name}.`
        : `${skill.name} ainda está recarregando.`, "system");
      return;
    }
    if (skill.classicIndex !== 95) this.breakInvisibility();
    this.#player.stop();
    const timing = this.#player.playClassSkill(skill);
    this.#attackCooldown = Math.max(
      this.#attackCooldown,
      Math.max(0.42, (timing?.animationDurationSeconds ?? 0.54) - 0.12),
    );
    const delay = timing?.effectDelaySeconds ?? 0.5;
    this.scheduleSkillEvent(delay, () => {
      if (!this.#player || !this.#playerState.snapshot.alive) return;
      const active = this.#skills.activateBuff(skill);
      if (!active) return;
      if (skill.classicIndex === 76) this.#skillEffects.playImmunityCast(this.#player.object.position);
      if (skill.classicIndex === 81) this.#skillEffects.playSoulLinkCast(this.#player.object.position);
      this.#buffVisualPulseRemaining.set(skill.classicIndex, 0);
      if (skill.classicIndex === 95) this.#player.setInvisible(true);
      if (skill.classKey !== "huntress") {
        this.#combatEffects.burst(this.#player.object.position, skill.color, 1.15);
      }
      this.#hud.addLog(`${skill.name} ativo por ${active.durationSeconds}s.`, "system");
    });
    this.#hud.addLog(`${skill.name} · ${skill.mana} MP.`, "system");
  }

  private applySkillImpact(
    skill: ClassSkill,
    primaryTargetId: string,
    position: THREE.Vector3,
    showFallbackEffect: boolean,
  ): void {
    if (!this.#boundSpawns || !this.#player) return;
    const primary = this.#boundSpawns.snapshot(primaryTargetId);
    const targets = primary ? this.selectSkillTargets(skill, primary) : [];
    let totalDamage = 0;
    for (const target of targets) {
      const variance = 0.92 + ((Math.imul(++this.#attackSequence, 1_664_525) >>> 25) / 127) * 0.16;
      const damage = Math.max(1, Math.round(
        this.#playerState.snapshot.attack * skill.damageCoefficient * variance,
      ));
      const result = this.#boundSpawns.strikeTarget(target.id, damage);
      if (result.ok) {
        totalDamage += result.damage;
        this.#damageNumbers.show(
          this.#camera,
          this.combatPoint(result.target.position, 1),
          result.damage,
          false,
        );
      }
    }
    if (showFallbackEffect) {
      this.#combatEffects.burst(position, skill.color, Math.max(0.8, Math.min(3, skill.radius || 0.8)));
    }
    if (totalDamage > 0) this.#hud.addLog(`${skill.name}: ${totalDamage} de dano${targets.length > 1 ? ` em ${targets.length} alvos` : ""}.`, "damage");
  }

  private selectSkillTargets(
    skill: ClassSkill,
    primary: ClassicMonsterSnapshot,
  ): ClassicMonsterSnapshot[] {
    if (!this.#boundSpawns || !this.#player) return [];
    if (skill.kind === "volley" || skill.kind === "area") {
      return this.#boundSpawns.snapshots()
        .filter((candidate) => candidate.alive && candidate.hostile && (
          Math.hypot(
            candidate.position.x - primary.position.x,
            candidate.position.y - primary.position.y,
          ) <= skill.radius
        ))
        .sort((left, right) => left.id === primary.id ? -1 : (right.id === primary.id ? 1 : left.id.localeCompare(right.id)))
        .slice(0, skill.maxTargets);
    }
    if (skill.kind === "cone") {
      const origin = this.#player.position;
      const facingX = primary.position.x - origin.x;
      const facingY = primary.position.y - origin.y;
      const facingLength = Math.max(1e-6, Math.hypot(facingX, facingY));
      const minimumDot = Math.cos(Math.PI / 4);
      return this.#boundSpawns.snapshots()
        .filter((candidate) => {
          if (!candidate.alive || !candidate.hostile) return false;
          const dx = candidate.position.x - origin.x;
          const dy = candidate.position.y - origin.y;
          const distance = Math.hypot(dx, dy);
          if (distance > skill.range || distance <= 1e-6) return false;
          return (dx * facingX + dy * facingY) / (distance * facingLength) >= minimumDot;
        })
        .sort((left, right) => {
          const leftDistance = Math.hypot(left.position.x - origin.x, left.position.y - origin.y);
          const rightDistance = Math.hypot(right.position.x - origin.x, right.position.y - origin.y);
          return leftDistance - rightDistance || left.id.localeCompare(right.id);
        })
        .slice(0, skill.maxTargets);
    }
    return primary.alive && primary.hostile ? [primary] : [];
  }

  private scheduleSkillEvent(delaySeconds: number, execute: () => void): void {
    this.#pendingSkillEvents.push({
      remainingSeconds: Math.max(0, delaySeconds),
      execute,
    });
  }

  private updatePendingSkillEvents(deltaSeconds: number): void {
    for (let index = this.#pendingSkillEvents.length - 1; index >= 0; index--) {
      const event = this.#pendingSkillEvents[index]!;
      event.remainingSeconds -= deltaSeconds;
      if (event.remainingSeconds > 0) continue;
      this.#pendingSkillEvents.splice(index, 1);
      event.execute();
    }
  }

  private updatePersistentBuffEffects(deltaSeconds: number): void {
    const player = this.#player;
    if (!player || !this.#effectsEnabled || !this.#playerState.snapshot.alive) {
      this.#buffVisualPulseRemaining.clear();
      this.#skillEffects.syncPersistentBuffs(null, {
        immunity: false,
        soulLink: false,
        mounted: false,
        ownerYaw: 0,
      });
      return;
    }
    const active = this.#skills.activeBuffs();
    const activeIndices = new Set(active.map((buff) => buff.classicIndex));
    for (const classicIndex of this.#buffVisualPulseRemaining.keys()) {
      if (!activeIndices.has(classicIndex)) this.#buffVisualPulseRemaining.delete(classicIndex);
    }

    this.#skillEffects.syncPersistentBuffs(player.object.position, {
      immunity: activeIndices.has(76),
      soulLink: activeIndices.has(81),
      mounted: player.mounted,
      ownerYaw: player.object.rotation.y,
    });

    const playerBase = player.object.position;
    for (const buff of active) {
      const interval = buff.classicIndex === 75
        ? 1
        : (buff.classKey === "huntress" ? 0 : 2.4);
      if (interval === 0) continue;
      const remaining = (this.#buffVisualPulseRemaining.get(buff.classicIndex) ?? 0) - deltaSeconds;
      if (remaining > 0) {
        this.#buffVisualPulseRemaining.set(buff.classicIndex, remaining);
        continue;
      }
      if (buff.classicIndex === 75) this.#skillEffects.playEnchantIce(playerBase);
      else {
        const skill = this.#skills.skills.find((candidate) => candidate.classicIndex === buff.classicIndex);
        if (skill) this.#combatEffects.burst(playerBase, skill.color, 0.68);
      }
      this.#buffVisualPulseRemaining.set(buff.classicIndex, interval);
    }
  }

  private breakInvisibility(): void {
    if (!this.#skills.removeBuff(95)) return;
    this.#player?.setInvisible(false);
    this.#hud.setBuffs(this.#skills.activeBuffs());
    this.#hud.addLog("Invisibilidade desfeita pela ação.", "system");
  }

  private acquireNearestTarget(): ClassicMonsterSnapshot | null {
    if (!this.#player || !this.#boundSpawns) return null;
    let nearest: ClassicMonsterSnapshot | null = null;
    let nearestDistance = 32;
    for (const target of this.#boundSpawns.snapshots()) {
      if (!target.alive || !target.hostile) continue;
      const distance = Math.hypot(target.position.x - this.#player.position.x, target.position.y - this.#player.position.y);
      if (distance >= nearestDistance) continue;
      nearest = target;
      nearestDistance = distance;
    }
    if (nearest && nearest.id !== this.#selectedTargetId) this.selectTarget(nearest);
    return nearest;
  }

  private combatPoint(position: WydPosition, heightOffset: number): THREE.Vector3 {
    if (!this.#world) return new THREE.Vector3();
    const scene = toScene(position, this.#world.origin);
    return new THREE.Vector3(scene.x, this.#world.heightAt(position) + heightOffset, scene.z);
  }

  private selectTarget(target: ClassicMonsterSnapshot | null): void {
    this.#selectedTargetId = target?.id ?? null;
    this.#attackCooldown = 0;
    this.#targetApproachCooldown = 0;
    this.#hud.setTarget(target);
    this.#clickMarker.visible = false;
  }

  private receiveMonsterAttack(event: ClassicMonsterAttackEvent): void {
    // Invisible actors are not selectable by mobs in the classic client. This
    // is distinct from invulnerability: any action removes affect 28 first.
    if (this.#player?.speedBoost || this.#skills.hasBuff(95)) return;
    if (!this.#playerState.snapshot.alive) return;
    const damage = this.#playerState.takeDamage(event.damage);
    playOptionalPlayerAction(this.#player, "playHit");
    this.#hud.addLog(`${event.attacker.name} causou ${damage} de dano.`, "damage");
    if (this.#playerState.snapshot.alive) return;
    this.#pendingBowAttacks.length = 0;
    this.#pendingSkillEvents.length = 0;
    this.#skills.clearBuffs();
    this.#buffVisualPulseRemaining.clear();
    this.#skillEffects.clear();
    this.#etherealExplosionEffects.clear();
    this.#player?.setInvisible(false);
    this.#respawnRemaining = 4.5;
    this.#selectedTargetId = null;
    this.#hud.setTarget(null);
    playOptionalPlayerAction(this.#player, "playDeath");
    this.#hud.addLog("Você morreu · retornando a Armia…", "system");
  }

  private receiveMonsterDrop(event: ClassicMonsterDropEvent): void {
    const rewards = this.#playerState.grantRewards(event.experience, event.coin);
    const parts = [`+${rewards.experienceAdded.toLocaleString("pt-BR")} EXP`];
    if (rewards.coinsAdded > 0) parts.push(`+${rewards.coinsAdded.toLocaleString("pt-BR")} gold`);
    this.#hud.addLog(parts.join(" · "), "reward");
    if (rewards.levelsGained > 0) {
      const snapshot = this.#playerState.snapshot;
      this.#hud.addLog(
        `LEVEL UP · nível ${snapshot.level} · ATQ +${rewards.attackGained} (total ${snapshot.attack})!`,
        "reward",
      );
    }

    if (event.seed % 100 < 34) {
      const added = this.#playerState.addItem({
        key: "pocao-cura-pequena",
        name: "Poção de Cura",
        description: "Recupera 60 pontos de HP.",
        rarity: "common",
        maxStack: 50,
        value: 35,
        kind: "consumable",
        heal: 60,
      });
      if (added > 0) this.#hud.addLog("Drop: Poção de Cura.", "reward");
    }
    if (event.seed % 29 === 0) {
      const added = this.#playerState.addItem({
        key: "fragmento-wyd",
        name: "Fragmento de Oriharucon",
        description: "Material raro encontrado em monstros.",
        rarity: "rare",
        maxStack: 20,
        value: 800,
        kind: "material",
      });
      if (added > 0) this.#hud.addLog("Drop raro: Fragmento de Oriharucon.", "reward");
    }
  }

  private respawnPlayer(): void {
    if (!this.#player || !this.#world) return;
    // Resolve/cancel any presentation callback while the actor is still dead,
    // so a blade that was in flight cannot deal damage during respawn.
    this.#etherealExplosionEffects.clear();
    this.#playerState.revive();
    this.#pendingBowAttacks.length = 0;
    this.#pendingSkillEvents.length = 0;
    this.#skills.clearBuffs();
    this.#buffVisualPulseRemaining.clear();
    this.#skillEffects.clear();
    this.#player.setInvisible(false);
    this.#damageNumbers.clear();
    this.#player.teleport(ARMIA_SPAWN);
    playOptionalPlayerAction(this.#player, "playIdle");
    this.#cameraRig.update(this.#player.object.position, 1);
    this.#hud.addLog("Você retornou a Armia.", "system");
    void this.#world.ensureCurrent(ARMIA_SPAWN, true).catch(console.error);
  }

  private readonly resize = (): void => {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
    this.#renderer.setSize(width, height, false);
    this.#damageNumbers.resize(width, height, this.#pixelRatio);
  };

  private readonly webglContextLost = (event: Event): void => {
    event.preventDefault();
    this.#streamingPaused = true;
    this.#renderer.setAnimationLoop(null);
    const loading = document.querySelector<HTMLElement>("#loading");
    loading?.classList.remove("is-hidden");
    const status = document.querySelector<HTMLElement>("#loading-status");
    if (status) {
      status.textContent = "A memória gráfica foi reiniciada. Recarregue a página para voltar a Armia.";
    }
  };

  private readonly webglContextRestored = (): void => {
    window.location.reload();
  };

  private configureMapSelector(assets: ClassicAssetSource): void {
    const select = document.querySelector<HTMLSelectElement>("#map-select");
    if (!select) return;
    const regions = connectedFieldRegions(assets.manifest.fields);
    const groups = regions.map((region) => {
      const group = document.createElement("optgroup");
      const count = `${region.fields.length} ${region.fields.length === 1 ? "Field" : "Fields"}`;
      group.label = `${formatRegionTitle(region)} · ${count}`;
      for (const field of region.fields) {
        const option = document.createElement("option");
        option.value = fieldKey(field.column, field.row);
        option.textContent = formatMapOptionName(field.column, field.row);
        group.appendChild(option);
      }
      return group;
    });
    select.replaceChildren(...groups);
    select.value = fieldKey(16, 16);
    select.addEventListener("change", this.mapSelectionChanged);
    const count = document.querySelector<HTMLElement>("#map-count");
    if (count) count.textContent = `${assets.manifest.fields.length} mapas · ${regions.length} regiões conectadas`;
  }

  private configureClassSelector(): void {
    const select = document.querySelector<HTMLSelectElement>("#player-class-select");
    if (!select) return;
    select.replaceChildren(...CLASSIC_PLAYER_CLASSES.map((definition) => {
      const option = document.createElement("option");
      option.value = definition.key;
      option.textContent = definition.name;
      return option;
    }));
    select.value = this.#activeClassKey;
    select.addEventListener("change", () => this.requestPlayerClass(select.value));
    this.syncClassControls();
  }

  private requestPlayerClass(classKey: string): void {
    const definition = CLASSIC_PLAYER_CLASSES.find((candidate) => candidate.key === classKey);
    const select = document.querySelector<HTMLSelectElement>("#player-class-select");
    const status = document.querySelector<HTMLElement>("#player-class-status");
    if (!definition || !select) {
      this.#hud.setActiveSkillClass(this.#activeClassKey);
      return;
    }
    if (definition.key === this.#activeClassKey) {
      select.value = this.#activeClassKey;
      this.#hud.setActiveSkillClass(this.#activeClassKey);
      return;
    }
    if (!this.#assets || !this.#player) return;

    const previousKey = this.#activeClassKey;
    const requestId = ++this.#classLoadId;
    this.#outfitLoadId++;
    select.disabled = true;
    const outfit = document.querySelector<HTMLSelectElement>("#outfit-select");
    if (outfit) outfit.disabled = true;
    if (status) status.textContent = `Carregando ${definition.name}…`;
    void this.#player.loadClassicAvatar(
      this.#assets,
      definition.key,
      definition.defaultLookKey,
    ).then((loaded) => {
      if (requestId !== this.#classLoadId) return;
      if (!loaded) {
        select.value = previousKey;
        this.#hud.setActiveSkillClass(previousKey);
        if (status) status.textContent = `${classicPlayerClass(previousKey).name} · falha ao trocar`;
        this.syncClassControls();
        this.#hud.addLog(`${definition.name} não pôde ser carregado.`, "system");
        return;
      }

      this.#activeClassKey = definition.key;
      this.#skills.clear();
      this.#skills = new ClassSkillSystem(definition.key);
      this.#pendingBowAttacks.length = 0;
      this.#pendingSkillEvents.length = 0;
      this.#queuedSkillSlot = null;
      this.#macroSkillCursor = 0;
      this.#buffVisualPulseRemaining.clear();
      this.#skillEffects.clear();
      this.#etherealExplosionEffects.clear();
      this.#player?.setInvisible(false);
      this.#playerState.setName(definition.name);
      this.#hud.configureSkills(this.#skills.skills, (slot) => this.requestSkill(slot));
      this.#hud.setBuffs([]);
      this.#hud.setActiveSkillClass(definition.key);
      select.value = definition.key;
      if (status) status.textContent = `${definition.name} · ${definition.defaultWeapon.name}`;
      this.syncClassControls();
      this.#hud.addLog(`${definition.name} equipado com ${definition.defaultWeapon.name}.`, "system");
    }).finally(() => {
      if (requestId === this.#classLoadId) {
        select.disabled = false;
      }
    });
  }

  private syncClassControls(): void {
    const definition = classicPlayerClass(this.#activeClassKey);
    const identity = document.querySelector<HTMLElement>(".player-identity small");
    this.populateOutfitSelector();
    if (identity) identity.textContent = definition.defaultWeapon.name;
  }

  private configureOutfitSelector(): void {
    const select = document.querySelector<HTMLSelectElement>("#outfit-select");
    if (!select) return;
    select.addEventListener("change", this.outfitChanged);
    this.populateOutfitSelector();
  }

  private populateOutfitSelector(): void {
    const select = document.querySelector<HTMLSelectElement>("#outfit-select");
    const status = document.querySelector<HTMLElement>("#outfit-status");
    const label = document.querySelector<HTMLElement>("#outfit-label");
    if (!select) return;
    const definition = classicPlayerClass(this.#activeClassKey);
    if (label) label.textContent = `Traje ${definition.name}`;
    select.replaceChildren(...definition.looks.map((look) => {
      const option = document.createElement("option");
      option.value = look.key;
      option.textContent = look.name;
      return option;
    }));
    const currentLook = this.#player?.avatarClassKey === definition.key
      ? this.#player.avatarLookKey
      : definition.defaultLookKey;
    select.value = definition.looks.some((look) => look.key === currentLook)
      ? currentLook
      : definition.defaultLookKey;
    select.disabled = false;
    const selected = definition.looks.find((look) => look.key === select.value);
    if (status) status.textContent = selected?.name ?? definition.selection.look.name;
  }

  private readonly outfitChanged = (): void => {
    const select = document.querySelector<HTMLSelectElement>("#outfit-select");
    const status = document.querySelector<HTMLElement>("#outfit-status");
    if (!select || !this.#assets || !this.#player) return;
    const definition = classicPlayerClass(this.#activeClassKey);
    const requestedKey = select.value;
    const requestedLook = definition.looks.find((look) => look.key === requestedKey)
      ?? definition.looks.find((look) => look.key === definition.defaultLookKey)
      ?? definition.selection.look;
    const requestId = ++this.#outfitLoadId;
    select.disabled = true;
    if (status) status.textContent = `Vestindo ${requestedLook.name}…`;
    void this.#player.loadClassicAvatar(this.#assets, definition.key, requestedLook.key).then((loaded) => {
      if (requestId !== this.#outfitLoadId) return;
      select.value = this.#player?.avatarLookKey ?? definition.defaultLookKey;
      if (loaded) {
        if (status) status.textContent = requestedLook.name;
        this.#hud.addLog(`${requestedLook.name} equipado.`, "system");
      } else {
        if (status) status.textContent = "Falha ao carregar o traje";
        this.#hud.addLog(`${requestedLook.name} não pôde ser carregado.`, "system");
      }
    }).finally(() => {
      if (requestId === this.#outfitLoadId) select.disabled = false;
    });
  };

  private configureMountSelector(): void {
    const select = document.querySelector<HTMLSelectElement>("#mount-select");
    if (!select) return;
    select.replaceChildren(...MOUNT_LOOKS.map((look) => {
      const option = document.createElement("option");
      option.value = look.key;
      option.textContent = `${look.name} · Lv. ${look.level}`;
      return option;
    }));
    select.value = DEFAULT_MOUNT_LOOK_KEY;
    select.addEventListener("change", this.mountChanged);
  }

  private readonly mountChanged = (): void => {
    const select = document.querySelector<HTMLSelectElement>("#mount-select");
    const status = document.querySelector<HTMLElement>("#mount-select-status");
    if (!select || !this.#assets || !this.#player) return;
    const requestedKey = select.value;
    const requestedLook = mountLook(requestedKey);
    const requestId = ++this.#mountLoadId;
    select.disabled = true;
    if (status) status.textContent = `Selando ${requestedLook.name}…`;
    void this.#player.loadClassicMount(this.#assets, requestedKey).then((loaded) => {
      if (requestId !== this.#mountLoadId) return;
      select.value = this.#player?.mountLookKey ?? DEFAULT_MOUNT_LOOK_KEY;
      if (loaded) {
        const name = this.#player?.mountName ?? `${requestedLook.name} Lv. ${requestedLook.level}`;
        if (status) status.textContent = name;
        if (this.#player?.mounted) this.#hud.setMounted(true, name);
        this.#hud.addLog(`${name} selecionado.`, "system");
      } else {
        if (status) status.textContent = this.#player?.mountName ?? "Falha ao carregar a montaria";
        this.#hud.addLog(`${requestedLook.name} não pôde ser carregado.`, "system");
      }
    }).finally(() => {
      if (requestId === this.#mountLoadId) select.disabled = false;
    });
  };

  private readonly mapSelectionChanged = (): void => {
    const select = document.querySelector<HTMLSelectElement>("#map-select");
    if (!select || !this.#assets) return;
    const entry = this.#assets.manifest.fields.find((field) => fieldKey(field.column, field.row) === select.value);
    if (entry) void this.teleportTo(entry);
  };

  private async teleportTo(entry: ClassicFieldEntry): Promise<void> {
    if (!this.#world || !this.#player) return;
    const requestId = ++this.#teleportId;
    const select = document.querySelector<HTMLSelectElement>("#map-select");
    const selector = document.querySelector<HTMLElement>("#map-teleport");
    const status = document.querySelector<HTMLElement>("#map-load-status");
    const mapName = fieldMapIdentity(entry.column, entry.row).name;
    if (select) select.disabled = true;
    selector?.classList.add("is-loading");
    if (status) status.textContent = `Carregando ${mapName}…`;
    this.#streamingPaused = true;
    this.#pendingBowAttacks.length = 0;
    this.#pendingSkillEvents.length = 0;
    this.#skillEffects.clear();
    this.#etherealExplosionEffects.clear();
    this.#damageNumbers.clear();

    const destination = isArmia(entry)
      ? { ...ARMIA_SPAWN }
      : fieldCenter(entry.column, entry.row);
    try {
      await this.#world.ensureCurrent(destination, true);
      if (requestId !== this.#teleportId) return;
      this.#player.teleport(destination);
      this.#cameraRig.update(this.#player.object.position, 1);
      this.#clickMarker.visible = false;
      this.activateField(destination, true);
      if (status) status.textContent = `${mapName} conectado`;
    } catch (error) {
      console.error(error);
      if (status) status.textContent = `Falha ao carregar ${mapName}`;
    } finally {
      if (requestId === this.#teleportId) {
        this.#streamingPaused = false;
        if (this.#player) this.#world?.update(0, this.#player.position);
        if (select) select.disabled = false;
        selector?.classList.remove("is-loading");
      }
    }
  }

  private activateField(position: WydPosition, force = false): void {
    const coordinates = fieldAt(position);
    const key = fieldKey(coordinates.column, coordinates.row);
    if (!force && key === this.#currentFieldKey) return;
    this.#currentFieldKey = key;

    const entry = this.#assets?.manifest.fields.find((field) => field.column === coordinates.column && field.row === coordinates.row);
    const identity = fieldMapIdentity(coordinates.column, coordinates.row);
    const name = identity.name;
    const location = document.querySelector<HTMLElement>("#location-name");
    if (location) location.textContent = name;
    const minimapLabel = document.querySelector<HTMLElement>("#minimap-field");
    if (minimapLabel) {
      minimapLabel.textContent = entry
        ? `${name} · ${formatFieldName(entry.column, entry.row)}`
        : `${name} · sem dados`;
    }
    const select = document.querySelector<HTMLSelectElement>("#map-select");
    if (select) {
      if (entry) select.value = key;
      else select.selectedIndex = -1;
    }

    void this.switchMinimap(entry);
  }

  private async switchMinimap(entry: ClassicFieldEntry | undefined): Promise<void> {
    const requestId = ++this.#minimapLoadId;
    this.#minimap = undefined;
    const canvas = document.querySelector<HTMLCanvasElement>("#minimap");
    if (!canvas) return;
    drawMinimapPlaceholder(canvas, entry?.minimapFile ? "CARREGANDO" : "SEM MINIMAPA");
    if (!entry?.minimapFile || !this.#assets) return;

    try {
      const minimap = await Minimap.load(this.#assets, canvas, entry.column, entry.row, entry.minimapFile);
      if (requestId !== this.#minimapLoadId) return;
      this.#minimap = minimap;
      if (this.#player) minimap.update(this.#player.position, this.#player.object.rotation.y);
    } catch (error) {
      if (requestId !== this.#minimapLoadId) return;
      console.error(error);
      drawMinimapPlaceholder(canvas, "MINIMAPA INDISPONÍVEL");
    }
  }
}

function isArmia(field: ClassicFieldEntry): boolean {
  return isArmiaCoordinates(field.column, field.row);
}

function isArmiaCoordinates(column: number, row: number): boolean {
  return column === 16 && row === 16;
}

function fieldCenter(column: number, row: number): WydPosition {
  return {
    x: column * FIELD_WORLD_SIZE + FIELD_WORLD_SIZE / 2,
    y: row * FIELD_WORLD_SIZE + FIELD_WORLD_SIZE / 2,
  };
}

function isAppleMobileDevice(): boolean {
  const userAgent = navigator.userAgent;
  return /iPhone|iPad|iPod/i.test(userAgent)
    // iPadOS desktop mode identifies itself as Macintosh.
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function drawMinimapPlaceholder(canvas: HTMLCanvasElement, label: string): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.fillStyle = "#080b0d";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(208, 177, 106, .18)";
  context.strokeRect(8.5, 8.5, canvas.width - 17, canvas.height - 17);
  context.fillStyle = "rgba(217, 193, 136, .55)";
  context.font = "600 10px Inter, sans-serif";
  context.textAlign = "center";
  context.fillText(label, canvas.width / 2, canvas.height / 2 + 3);
}

function createClickMarker(): THREE.Mesh {
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.7, 24),
    new THREE.MeshBasicMaterial({ color: 0x8fffa6, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
  );
  marker.rotation.x = -Math.PI / 2;
  marker.visible = false;
  return marker;
}

function playOptionalPlayerAction(
  player: Player | undefined,
  action: "playAttack" | "playHit" | "playDeath" | "playIdle",
): void {
  const animated = player as Player & Partial<Record<typeof action, () => void>> | undefined;
  animated?.[action]?.();
}
