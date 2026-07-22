import * as THREE from "three";
import { ClassicAssetSource } from "../assets/ClassicAssetSource";
import { WydCamera } from "../camera/WydCamera";
import { Player } from "../game/Player";
import {
  HUNTRESS_SKILLS,
  HuntressSkillSystem,
  type HuntressSkill,
} from "../game/combat/HuntressSkills";
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
import {
  DEFAULT_HUNTRESS_LOOK_KEY,
  HUNTRESS_LOOKS,
  huntressLook,
} from "../game/player/HuntressLooks";
import {
  DEFAULT_MOUNT_LOOK_KEY,
  MOUNT_LOOKS,
  mountLook,
} from "../game/player/MountLooks";
import { HuntressCombatEffects } from "../render/effects/HuntressCombatEffects";
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

export class GameApp {
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(45, 1, 0.966, 1200);
  readonly #cameraRig = new WydCamera(this.#camera);
  readonly #renderer: THREE.WebGLRenderer;
  readonly #clock = new THREE.Clock();
  readonly #raycaster = new THREE.Raycaster();
  readonly #clickMarker = createClickMarker();
  readonly #input: GameInput;
  readonly #hud = new GameHud();
  readonly #playerState = new PlayerState("Huntress");
  readonly #skills = new HuntressSkillSystem();
  readonly #combatEffects = new HuntressCombatEffects();
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
  #targetApproachCooldown = 0;
  #respawnRemaining = 0;
  #autoCombat = false;
  #queuedSkillSlot: number | null = null;
  #skillInvulnerabilityRemaining = 0;
  #macroDecisionCooldown = 0;
  #macroSkillCursor = 0;
  #effectsEnabled = true;
  #clickMarkerElapsed = CLICK_MARKER_LIFETIME;
  #outfitLoadId = 0;
  #mountLoadId = 0;

  constructor(private readonly container: HTMLElement) {
    this.#renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.shadowMap.enabled = true;
    this.#renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.#renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.#renderer.domElement.className = "game-canvas";
    this.container.appendChild(this.#renderer.domElement);
    this.#input = new GameInput(this.#renderer.domElement);
    this.#input.onGroundClick = this.groundClick;
    this.#input.onCameraRotate = (yaw, pitch) => this.#cameraRig.rotate(yaw, pitch);
    this.#input.onZoom = (delta) => this.#cameraRig.zoom(delta);
    this.#input.onSpeedToggle = () => {
      if (!this.#player) return;
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
    this.#input.onMountToggle = () => this.toggleMount();
    this.#input.onAutoCombatToggle = () => this.toggleAutoCombat();
    this.#input.onEffectsToggle = () => this.toggleEffects();
    this.#input.onSkill = (slot) => this.requestSkill(slot);
    this.#hud.bindPlayer(this.#playerState);
    this.#hud.configureSkills(HUNTRESS_SKILLS, (slot) => this.requestSkill(slot));
    this.#hud.addLog("Armia carregada. Explore o mundo clássico.", "system");
    window.addEventListener("resize", this.resize);
    this.resize();
  }

  async start(): Promise<void> {
    const assets = await ClassicAssetSource.load();
    this.#assets = assets;
    this.configureMapSelector(assets);
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
    void this.#player.loadClassicAvatar(assets, DEFAULT_HUNTRESS_LOOK_KEY).then((loaded) => {
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
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -75;
    sun.shadow.camera.right = 75;
    sun.shadow.camera.top = 75;
    sun.shadow.camera.bottom = -75;
    this.#scene.add(sun);
    this.#camera.position.set(20, 24, 27);
  }

  private readonly frame = (): void => {
    const dt = Math.min(this.#clock.getDelta(), 0.05);
    this.updateClickMarker(dt);
    this.#skills.update(dt);
    this.#combatEffects.update(dt);
    this.#skillInvulnerabilityRemaining = Math.max(0, this.#skillInvulnerabilityRemaining - dt);
    for (const skill of HUNTRESS_SKILLS) {
      this.#hud.setSkillCooldown(skill.slot, this.#skills.remaining(skill.slot), this.#skills.ratio(skill.slot));
    }
    if (this.#player) {
      this.#cameraRig.rotate(this.#input.rotationAxis() * dt * 1.7);
      if (!this.#streamingPaused) {
        const input = this.#input.movement();
        const axes = this.#cameraRig.groundAxes();
        const sceneDirection = axes.right.multiplyScalar(input.x).add(axes.forward.multiplyScalar(input.y));
        const movement = this.#playerState.snapshot.alive
          ? new THREE.Vector2(sceneDirection.x, -sceneDirection.y)
          : new THREE.Vector2();
        this.#player.update(dt, movement);
        this.#world?.update(dt, this.#player.position);
      }
      this.bindSpawnGameplay();
      this.updateCombat(dt);
      this.#cameraRig.update(this.#player.object.position, dt);
      this.activateField(this.#player.position);
      const coordinates = document.querySelector<HTMLElement>("#coordinates");
      if (coordinates) coordinates.textContent = `${Math.floor(this.#player.position.x)}, ${Math.floor(this.#player.position.y)}`;
      this.#minimap?.update(this.#player.position, this.#player.object.rotation.y);
    }
    this.#renderer.render(this.#scene, this.#camera);
  };

  private readonly groundClick = (pointer: THREE.Vector2): void => {
    if (!this.#world || !this.#player) return;
    this.#raycaster.setFromCamera(pointer, this.#camera);
    const hits = this.#raycaster.intersectObject(this.#world.object, true);
    for (const candidate of hits) {
      const target = this.#world.spawns?.targetFromObject(candidate.object);
      if (!target) continue;
      this.selectTarget(target);
      return;
    }
    const hit = hits[0];
    if (!hit) return;
    this.selectTarget(null);
    this.#player.moveTo(toWyd(hit.point.x, hit.point.z, this.#world.origin));
    this.#clickMarker.position.set(hit.point.x, hit.point.y + 0.06, hit.point.z);
    this.#clickMarker.scale.setScalar(0.72);
    const material = this.#clickMarker.material as THREE.MeshBasicMaterial;
    material.opacity = 0.85;
    this.#clickMarker.visible = true;
    this.#clickMarkerElapsed = 0;
  };

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

  private updateCombat(deltaSeconds: number): void {
    if (!this.#player || !this.#world) return;
    if (!this.#playerState.snapshot.alive) {
      this.#respawnRemaining -= deltaSeconds;
      if (this.#respawnRemaining <= 0) this.respawnPlayer();
      return;
    }

    this.#attackCooldown = Math.max(0, this.#attackCooldown - deltaSeconds);
    this.#targetApproachCooldown = Math.max(0, this.#targetApproachCooldown - deltaSeconds);
    this.#macroDecisionCooldown = Math.max(0, this.#macroDecisionCooldown - deltaSeconds);
    if (!this.#boundSpawns) return;

    let target = this.#selectedTargetId ? this.#boundSpawns.snapshot(this.#selectedTargetId) : null;
    if (this.#autoCombat && (!target?.alive || !target.hostile)) {
      target = this.acquireNearestTarget();
    }
    if (!target) return;
    this.#hud.setTarget(target);
    if (!target.alive || !target.hostile) return;

    if (this.#autoCombat && this.#queuedSkillSlot === null && this.#macroDecisionCooldown <= 0) {
      const offensive = HUNTRESS_SKILLS.filter((skill) => skill.kind !== "defense");
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
      : (HUNTRESS_SKILLS.find((skill) => skill.slot === this.#queuedSkillSlot) ?? null);
    const attackRange = queuedSkill?.range || 13.5;
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
    const critical = sequence % 13 === 0;
    const damage = Math.max(1, Math.round(player.attack * variance * (critical ? 1.65 : 1)));
    this.#attackCooldown = 0.72;
    this.#player.playAttack();
    const from = this.combatPoint(this.#player.position, 1.2);
    const to = this.combatPoint(target.position, 0.85);
    const targetId = target.id;
    this.#combatEffects.shoot(from, to, 0xe7cf86, () => {
      const result = this.#boundSpawns?.strikeTarget(targetId, damage);
      if (!result?.ok) return;
      this.#combatEffects.burst(to, critical ? 0xffc554 : 0xd8e8ff, critical ? 1.1 : 0.65);
      this.#hud.addLog(`${critical ? "CRÍTICO · " : ""}${result.damage} em ${result.target.name}.`, "damage");
    });
  }

  private toggleMount(): void {
    if (!this.#player) return;
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
    const skill = HUNTRESS_SKILLS.find((candidate) => candidate.slot === slot);
    if (!skill || !this.#playerState.snapshot.alive) return;
    if (skill.kind === "defense") {
      this.castDefensiveSkill(skill);
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

  private castSkill(skill: HuntressSkill, target: ClassicMonsterSnapshot): void {
    if (!this.#player || !this.#boundSpawns) return;
    const started = this.#skills.start(skill.slot, this.#playerState);
    if (!started.ok) {
      if (started.reason === "mana") this.#hud.addLog(`MP insuficiente para ${skill.name}.`, "system");
      return;
    }
    this.#player.playSkill((skill.slot - 1) % 3);
    this.#attackCooldown = Math.max(this.#attackCooldown, 0.42);
    const from = this.combatPoint(this.#player.position, 1.25);
    const to = this.combatPoint(target.position, 0.8);
    const arrowCount = skill.kind === "area" ? 3 : (skill.kind === "poison" ? 2 : 1);
    this.#combatEffects.shoot(from, to, skill.color, () => this.applySkillImpact(skill, target.id, to), arrowCount);
    this.#hud.addLog(`${skill.name} · ${skill.mana} MP.`, "system");
  }

  private castDefensiveSkill(skill: HuntressSkill): void {
    if (!this.#player) return;
    const started = this.#skills.start(skill.slot, this.#playerState);
    if (!started.ok) {
      this.#hud.addLog(started.reason === "mana"
        ? `MP insuficiente para ${skill.name}.`
        : `${skill.name} ainda está recarregando.`, "system");
      return;
    }
    this.#skillInvulnerabilityRemaining = 3;
    this.#player.playSkill(2);
    this.#combatEffects.burst(this.combatPoint(this.#player.position, 0.05), skill.color, 1.4);
    this.#hud.addLog(`${skill.name} · invulnerável por 3s.`, "system");
  }

  private applySkillImpact(skill: HuntressSkill, primaryTargetId: string, position: THREE.Vector3): void {
    if (!this.#boundSpawns || !this.#player) return;
    const primary = this.#boundSpawns.snapshot(primaryTargetId);
    const center = primary?.position;
    const targets = skill.radius > 0 && center
      ? this.#boundSpawns.snapshots().filter((candidate) => (
        candidate.alive
        && candidate.hostile
        && Math.hypot(candidate.position.x - center.x, candidate.position.y - center.y) <= skill.radius
      )).slice(0, 8)
      : (primary ? [primary] : []);
    let totalDamage = 0;
    for (const target of targets) {
      const variance = 0.92 + ((Math.imul(++this.#attackSequence, 1_664_525) >>> 25) / 127) * 0.16;
      const damage = Math.max(1, Math.round(this.#playerState.snapshot.attack * skill.power * variance));
      const result = this.#boundSpawns.strikeTarget(target.id, damage);
      if (result.ok) totalDamage += result.damage;
    }
    this.#combatEffects.burst(position, skill.color, Math.max(0.8, skill.radius || 0.8));
    if (totalDamage > 0) this.#hud.addLog(`${skill.name}: ${totalDamage} de dano${targets.length > 1 ? ` em ${targets.length} alvos` : ""}.`, "damage");
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
    if (this.#player?.speedBoost || this.#skillInvulnerabilityRemaining > 0) return;
    if (!this.#playerState.snapshot.alive) return;
    const damage = this.#playerState.takeDamage(event.damage);
    playOptionalPlayerAction(this.#player, "playHit");
    this.#hud.addLog(`${event.attacker.name} causou ${damage} de dano.`, "damage");
    if (this.#playerState.snapshot.alive) return;
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
    if (rewards.levelsGained > 0) this.#hud.addLog(`LEVEL UP · nível ${this.#playerState.snapshot.level}!`, "reward");

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
    this.#playerState.revive();
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

  private configureOutfitSelector(): void {
    const select = document.querySelector<HTMLSelectElement>("#outfit-select");
    if (!select) return;
    select.replaceChildren(...HUNTRESS_LOOKS.map((look) => {
      const option = document.createElement("option");
      option.value = look.key;
      option.textContent = look.name;
      return option;
    }));
    select.value = DEFAULT_HUNTRESS_LOOK_KEY;
    select.addEventListener("change", this.outfitChanged);
  }

  private readonly outfitChanged = (): void => {
    const select = document.querySelector<HTMLSelectElement>("#outfit-select");
    const status = document.querySelector<HTMLElement>("#outfit-status");
    if (!select || !this.#assets || !this.#player) return;
    const requestedKey = select.value;
    const requestedLook = huntressLook(requestedKey);
    const requestId = ++this.#outfitLoadId;
    select.disabled = true;
    if (status) status.textContent = `Vestindo ${requestedLook.name}…`;
    void this.#player.loadClassicAvatar(this.#assets, requestedKey).then((loaded) => {
      if (requestId !== this.#outfitLoadId) return;
      select.value = this.#player?.avatarLookKey ?? DEFAULT_HUNTRESS_LOOK_KEY;
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
