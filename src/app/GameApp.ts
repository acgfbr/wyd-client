import * as THREE from "three";
import { ClassicAssetSource } from "../assets/ClassicAssetSource";
import {
  clearClassicInitialCache,
  prepareClassicInitialCache,
  type ClassicCacheProgress,
} from "../assets/ClassicInitialCache";
import { WydCamera } from "../camera/WydCamera";
import { Player } from "../game/Player";
import { loadClassicCommerceCatalog } from "../game/commerce/ClassicCommerceCatalog";
import {
  ClassicGroundItemManager,
  OfflineClassicGroundItemGateway,
  offlineGroundItemToInventoryItem,
  type ClassicGroundItemSnapshot,
} from "../game/items";
import {
  ClassSkillSystem,
  type ClassSkill,
  type ClassicClassKey,
} from "../game/combat/ClassSkills";
import {
  nextAutoCombatMode,
  type AutoCombatMode,
  type AutoCombatPositionMode,
} from "../game/combat/AutoCombat";
import {
  beastMasterSummonForSkill,
  type BeastMasterSummonDefinition,
} from "../game/combat/BeastMasterSummons";
import {
  BEAST_MASTER_TRANSFORMATIONS,
  beastMasterTransformationForSkill,
} from "../game/combat/BeastMasterTransformations";
import { SPECTRAL_FORCE } from "../game/combat/SpectralForce";
import type {
  ClassicMonsterAttackEvent,
  ClassicMonsterDropEvent,
  ClassicMonsterSnapshot,
  ClassicSpawnManager,
} from "../game/npcs/ClassicSpawnManager";
import {
  CLASSIC_MASTER_CARB_BUFFS,
  grantClassicMasterCarbBuffs,
  isClassicMasterCarb,
} from "../game/npcs/ClassicMasterCarb";
import { findTriggeredClassicGroundPortalAt } from "../game/portals/ClassicGroundPortals";
import { GameInput } from "../input/GameInput";
import { ClassicWorld } from "../world/ClassicWorld";
import { FIELD_WORLD_SIZE, fieldAt, toScene, toWyd, type WydPosition } from "../world/coordinates";
import { Minimap } from "../ui/Minimap";
import { GameHud } from "../ui/GameHud";
import { RuntimeTelemetry } from "../ui/RuntimeTelemetry";
import { ClassicPlayerOverheadHud } from "../ui/ClassicPlayerOverheadHud";
import {
  INVENTORY_BAG_SIZE,
  PlayerState,
  classicGridHasPlacement,
  type InventoryItem,
  type PlayerSnapshot,
} from "../game/state/PlayerState";
import { ClassicBeastMasterSummon } from "../game/player/ClassicBeastMasterSummon";
import type { ClassicWeaponEffectSegmentSample } from "../game/player/ClassicPlayerAvatar";
import {
  DEFAULT_HUNTRESS_LOOK_KEY,
} from "../game/player/HuntressLooks";
import {
  CLASSIC_PLAYER_CLASSES,
  classicPlayerClass,
} from "../game/player/PlayerClasses";
import {
  classicBodyEquipmentIndices,
  classicBodyEquipmentLookKey,
  hasClassicBodyEquipment,
  loadClassicPlayerEquipmentCatalog,
} from "../game/player/ClassicPlayerEquipmentCatalog";
import { loadClassicPlayerWeaponCatalog } from "../game/player/ClassicPlayerWeaponCatalog";
import {
  DEFAULT_MOUNT_LOOK_KEY,
  MOUNT_LOOKS,
  mountLook,
} from "../game/player/MountLooks";
import { HuntressCombatEffects } from "../render/effects/HuntressCombatEffects";
import { ClassicDamageNumbers } from "../render/effects/ClassicDamageNumbers";
import { ClassicHuntressSkillEffects } from "../render/effects/ClassicHuntressSkillEffects";
import type { ClassicFoemaSkillEffects } from "../render/effects/ClassicFoemaSkillEffects";
import type { ClassicTransKnightSkillEffects } from "../render/effects/ClassicTransKnightSkillEffects";
import type { ClassicBeastMasterSkillEffects } from "../render/effects/ClassicBeastMasterSkillEffects";
import { ClassicEtherealExplosionEffect } from "../render/effects/ClassicEtherealExplosionEffect";
import { ClassicLevelUpEffects } from "../render/effects/ClassicLevelUpEffects";
import { ClassicInventoryPreview } from "../render/inventory/ClassicInventoryPreview";
import { configureClassicDdsTextureSupport } from "../render/textures/ClassicDdsTextureLoader";
import { ClassicAudio } from "../audio/ClassicAudio";
import {
  CLASSIC_TIMED_QUESTS,
  classicQuestResetSecondsRemaining,
  formatClassicQuestReset,
  isInsideClassicTimedQuest,
} from "../game/quests/ClassicTimedQuests";
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
const NPC_INTERACTION_DEBOUNCE_SECONDS = 1;
const NPC_HOVER_DIRTY_INTERVAL_SECONDS = 0.04;
const NPC_HOVER_REFRESH_INTERVAL_SECONDS = 0.12;
// TMHuman::MoveGet uses BASE_GetDistance <= 1. The offline client intentionally
// widens that interaction comfort to 3 cells, as requested, while preserving
// the same height/collision line check so walls and bridge layers still block.
const GROUND_ITEM_PICKUP_COOLDOWN_SECONDS = 1;
const OFFLINE_GROUND_ITEM_PICKUP_RANGE = 3;
const GROUND_ITEM_STREAM_RADIUS = 18;
// The server-owned retail expiration is unavailable in the recovered client.
// Bound only the offline residency so continuous C.C cannot retain unlimited
// models, canvases and model-library leases while farming one resident area.
const OFFLINE_GROUND_ITEM_RESIDENT_CAPACITY = 128;
const GROUND_ITEM_PICKUP_APPROACH_TIMEOUT_SECONDS = 12;
const GROUND_ITEM_PICKUP_STALL_TIMEOUT_SECONDS = 0.9;
const MACRO_UNREACHABLE_TARGET_COOLDOWN_SECONDS = 1.5;
const BEAST_MASTER_SUMMON_PACK_SIZE = 10;
// TMHuman's normal humanoid skin uses m_vecPickSize[1] = (0.4, 2.0).
// Player.classicScale supplies the retail 0.9 transform at runtime.
const CLASSIC_HUMANOID_PICK_WIDTH = 0.4;
const CLASSIC_HUMANOID_PICK_HEIGHT = 2;
// SkillData preserves AffectValue 10 but the client never reveals whether the
// server treats it as points or percent. The offline-only combat mock uses 10%
// until the authoritative server formula replaces this policy.
const BEAST_MASTER_WEAKEN_OFFLINE_RATIO = 0.1;

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
  readonly #npcHoverPointer = new THREE.Vector2();
  readonly #input: GameInput;
  readonly #hud = new GameHud();
  readonly #telemetry = new RuntimeTelemetry();
  readonly #audio = new ClassicAudio();
  readonly #playerOverhead: ClassicPlayerOverheadHud;
  readonly #playerState = new PlayerState("Huntress");
  #skills = new ClassSkillSystem("huntress");
  #activeClassKey: ClassicClassKey = "huntress";
  readonly #combatEffects = new HuntressCombatEffects();
  readonly #skillEffects: ClassicHuntressSkillEffects;
  #foemaSkillEffects: ClassicFoemaSkillEffects | null = null;
  #transKnightSkillEffects: ClassicTransKnightSkillEffects | null = null;
  #beastMasterSkillEffects: ClassicBeastMasterSkillEffects | null = null;
  readonly #classEffectLoads = new Map<ClassicClassKey, Promise<void>>();
  readonly #etherealExplosionEffects: ClassicEtherealExplosionEffect;
  readonly #levelUpEffects: ClassicLevelUpEffects;
  readonly #damageNumbers: ClassicDamageNumbers;
  #inventoryPreview: ClassicInventoryPreview | null = null;
  #groundItems: ClassicGroundItemManager | null = null;
  readonly #offlineGroundItems = new OfflineClassicGroundItemGateway();
  #assets?: ClassicAssetSource;
  #player?: Player;
  #world?: ClassicWorld;
  #minimap?: Minimap;
  #currentFieldKey = "";
  #minimapLoadId = 0;
  #questResetRenderedSecond = -1;
  #teleportId = 0;
  #streamingPaused = false;
  #boundSpawns: ClassicSpawnManager | null = null;
  #spawnUnsubscribers: (() => void)[] = [];
  #selectedTargetId: string | null = null;
  #activeNpcId: string | null = null;
  #pendingNpcId: string | null = null;
  #pendingGroundItemId: string | null = null;
  #groundItemPickupTargetId: string | null = null;
  #groundItemPickupJobId: string | null = null;
  #groundItemPickupJobToken = 0;
  #groundItemPickupCooldown = 0;
  #groundItemPickupGeneration = 0;
  #groundItemPickupApproachRemaining = 0;
  #groundItemPickupStallRemaining = 0;
  #groundItemPickupLastDistance = Number.POSITIVE_INFINITY;
  #groundItemPickupOwnsMovement = false;
  #groundItemLabelsVisible = false;
  readonly #offlineGroundItemResidency = new Set<string>();
  #npcOpenedInventory = false;
  #npcShopLoadId = 0;
  #npcInteractionCooldown = 0;
  #npcHoverRaycastCooldown = 0;
  #npcHoverRefreshRemaining = 0;
  #groundPortalOccupancyKey: string | null = null;
  #attackCooldown = 0;
  #attackSequence = 0;
  readonly #pendingBowAttacks: PendingBowAttack[] = [];
  readonly #pendingSkillEvents: PendingSkillEvent[] = [];
  readonly #buffVisualPulseRemaining = new Map<number, number>();
  readonly #weakenedMonsters = new Map<string, number>();
  readonly #weaponEffectSegments: ClassicWeaponEffectSegmentSample[] = [];
  readonly #playerSkinAnchor = new THREE.Vector3();
  readonly #spiritChangeAnchor = new THREE.Vector3();
  #foemaCancellationTargetId: string | null = null;
  #targetApproachCooldown = 0;
  #respawnRemaining = 0;
  #autoCombatMode: AutoCombatMode = "off";
  #queuedSkillSlot: number | null = null;
  #queuedSkillOrigin: "manual" | "macro" | null = null;
  #queuedGroundSkillSlot: number | null = null;
  #macroOwnsTarget = false;
  #macroDecisionCooldown = 0;
  readonly #macroUnreachableTargets = new Map<string, number>();
  #macroSkillCursor = 0;
  #macroSkillSlots = offensiveBarSkillSlots(this.#skills.skills);
  readonly #macroSkillSlotsByClass = new Map<ClassicClassKey, number[]>([
    ["huntress", [...this.#macroSkillSlots]],
  ]);
  #classSwitchInFlight = false;
  #autoCombatRecoveryThreshold = 30;
  #autoCombatMountThreshold = 30;
  #autoCombatPositionMode: AutoCombatPositionMode = "continuous";
  #autoCombatPositionAnchor: WydPosition | null = null;
  #autoCombatRecoveryCooldown = 0;
  #autoCombatSupportCooldown = 0;
  #autoCombatSupportCursor = 0;
  readonly #autoCombatSummonRefreshAt = new Map<number, number>();
  #effectsEnabled = true;
  #lastFootstepPosition: WydPosition | null = null;
  #footstepDistance = 0;
  #footstepCooldown = 0;
  #footstepSide: 0 | 1 = 0;
  #clickMarkerElapsed = CLICK_MARKER_LIFETIME;
  #heldGroundUpdateRemaining = 0;
  #heldGroundDestination: WydPosition | null = null;
  #heldGroundMode: HeldGroundMode | null = null;
  #outfitLoadId = 0;
  #classLoadId = 0;
  #mountLoadId = 0;
  #equipmentVisualSignature = "";
  #summonGeneration = 0;
  readonly #beastMasterSummons = new Map<number, ClassicBeastMasterSummon[]>();
  #disposed = false;

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
    this.#telemetry.setRenderInfo(this.#renderer.info);
    this.#renderer.domElement.addEventListener("webglcontextlost", this.webglContextLost);
    this.#renderer.domElement.addEventListener("webglcontextrestored", this.webglContextRestored);
    this.container.appendChild(this.#renderer.domElement);
    this.#skillEffects = new ClassicHuntressSkillEffects(this.#scene);
    this.#etherealExplosionEffects = new ClassicEtherealExplosionEffect(this.#scene);
    this.#levelUpEffects = new ClassicLevelUpEffects(this.#scene);
    this.#damageNumbers = new ClassicDamageNumbers(this.container);
    this.#playerOverhead = new ClassicPlayerOverheadHud(this.container);
    this.#input = new GameInput(this.#renderer.domElement);
    this.#input.onGroundClick = this.groundClick;
    this.#input.onGroundRelease = this.groundRelease;
    this.#input.onGroundReleaseCancelled = this.groundReleaseCancelled;
    this.#input.onCameraRotate = (yaw, pitch) => this.#cameraRig.rotate(yaw, pitch);
    this.#input.onZoom = (delta) => this.#cameraRig.zoom(delta);
    this.#input.onSpeedToggle = () => {
      if (!this.#player) return;
      this.closeNpcInteraction();
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
    this.#input.onCharacterToggle = () => this.#hud.toggleCharacter();
    this.#input.onSkillMenuToggle = () => this.#hud.toggleSkills();
    this.#input.onMountToggle = () => this.toggleMount();
    this.#input.onAutoCombatToggle = () => this.cycleAutoCombatMode();
    this.#input.onEffectsToggle = () => this.toggleEffects();
    const toggleMusic = () => {
      const enabled = this.#audio.toggleMusic();
      this.#hud.setAudioToggleState(enabled, this.#audio.soundEffectsEnabled);
      this.#hud.addLog(
        enabled ? "Música ativada (M)." : "Música desativada (M).",
        "system",
      );
    };
    const toggleSoundEffects = () => {
      const enabled = this.#audio.toggleSoundEffects();
      this.#hud.setAudioToggleState(this.#audio.musicEnabled, enabled);
      this.#hud.addLog(
        enabled
          ? "SFX ativados (B)."
          : "SFX desativados (B) · ataques, skills, buffs, passos e ambiente silenciados.",
        "system",
      );
    };
    this.#input.onMusicToggle = toggleMusic;
    this.#input.onSoundEffectsToggle = toggleSoundEffects;
    this.#hud.onMusicToggle = toggleMusic;
    this.#hud.onSoundEffectsToggle = toggleSoundEffects;
    this.#hud.onInitialCacheClear = async () => {
      const removed = await clearClassicInitialCache();
      this.#hud.addLog(
        removed
          ? "Pacote local de Armia removido. Ele será preparado novamente no próximo acesso."
          : "Nenhum pacote local de Armia estava armazenado.",
        "system",
      );
    };
    this.#hud.setAudioToggleState(
      this.#audio.musicEnabled,
      this.#audio.soundEffectsEnabled,
    );
    this.#input.onNearbyGroundItemPickup = () => this.pickupNearestGroundItem();
    this.#input.onGroundItemLabelsToggle = () => {
      this.#groundItemLabelsVisible = !this.#groundItemLabelsVisible;
      this.#groundItems?.setAllLabelsVisible(this.#groundItemLabelsVisible);
      this.#hud.addLog(
        this.#groundItemLabelsVisible
          ? "Nomes dos drops ativados (Z)."
          : "Nomes dos drops desativados (Z).",
        "system",
      );
    };
    this.#input.onSkill = (slot) => this.requestSkill(slot);
    this.#hud.onAutoCombatModeSelected = (mode) => this.setAutoCombatMode(mode);
    this.#hud.onAutoCombatSkillSlotsChanged = (slots) => this.setMacroSkillSlots(slots);
    this.#hud.onAutoCombatRecoveryThresholdChanged = (percentage) => {
      this.#autoCombatRecoveryThreshold = clampAutoCombatThreshold(percentage);
      this.syncAutoCombatAuxiliary();
    };
    this.#hud.onAutoCombatMountThresholdChanged = (percentage) => {
      this.#autoCombatMountThreshold = clampAutoCombatThreshold(percentage);
      this.syncAutoCombatAuxiliary();
    };
    this.#hud.onAutoCombatPositionModeSelected = (mode) => this.setAutoCombatPositionMode(mode);
    this.#hud.onChatSubmit = (message, channel) => {
      // A camada de rede continua fora do escopo: o fluxo e a apresentação
      // seguem o cliente, mas a mensagem é ecoada apenas no frontend local.
      this.#hud.addChatMessage(this.#playerState.snapshot.name, message, channel);
      this.#playerOverhead.showChat(message, channel);
    };
    this.#hud.onNpcInteractionClose = () => this.closeNpcInteraction();
    this.#hud.onGroundPortalConfirm = (portal) => {
      const destination = portal.labelPtBr?.trim() || `destino #${portal.messageStringId}`;
      this.#hud.addLog(
        `Portal para ${destination} confirmado localmente; teleporte, autorização e cobrança dependem do servidor e não foram executados.`,
        "system",
      );
    };
    this.#hud.onGroundPortalClose = () => undefined;
    this.#hud.onCatalogSkillUse = (classicIndex) => this.requestCatalogSkill(classicIndex);
    this.#hud.onExtractionRequest = (_slot, item) => {
      const skill = this.#skills.skills.find((candidate) => candidate.classicIndex === 83);
      if (
        !skill
        || skill.classKey !== "huntress"
        || this.#activeClassKey !== "huntress"
        || !this.#player
      ) return;
      // The local client echoes the action packet, but item mutation/result is
      // accepted only from the server. Preserve the pose without charging MP
      // or deleting the selected item in this offline build.
      this.#player.stop();
      this.#player.playClassSkill(skill);
      this.#hud.addLog(
        `Extração de ${item.name} confirmada localmente; custo e resultado dependem do servidor e nenhum item foi alterado.`,
        "system",
      );
    };
    this.#hud.bindPlayer(this.#playerState);
    this.#playerState.subscribe(this.playerEquipmentChanged);
    this.#playerState.subscribe((snapshot) => this.#playerOverhead.sync(snapshot));
    this.#hud.configureSkills(
      this.#skills.skills.map((skill) => ({ ...skill, offensive: isOffensiveBarSkill(skill) })),
      (slot) => this.requestSkill(slot),
    );
    this.#hud.setAutoCombat(this.#autoCombatMode, this.#macroSkillSlots);
    this.syncAutoCombatAuxiliary();
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
    const cacheAbort = new AbortController();
    const cacheSkip = document.querySelector<HTMLButtonElement>("#loading-cache-skip");
    const skipCache = () => cacheAbort.abort();
    cacheSkip?.addEventListener("click", skipCache);
    try {
      await prepareClassicInitialCache({
        signal: cacheAbort.signal,
        onProgress: updateBootCacheProgress,
      });
    } catch (error) {
      // CacheStorage, quota and service-worker restrictions are an optimization
      // boundary. They must never prevent the network-backed game from booting.
      console.warn("Cache inicial indisponível; seguindo pela rede", error);
      updateBootCacheProgress({
        phase: "unsupported",
        label: "Cache indisponível · carregando pela rede",
        completedAssets: 0,
        totalAssets: 0,
        loadedBytes: 0,
        totalBytes: 0,
        currentAsset: null,
        persistent: null,
      });
    } finally {
      cacheSkip?.removeEventListener("click", skipCache);
      if (cacheSkip) cacheSkip.hidden = true;
    }
    const loadingStatus = document.querySelector<HTMLElement>("#loading-status");
    if (loadingStatus) loadingStatus.textContent = "Montando terreno e objetos de Armia…";
    const assets = await ClassicAssetSource.load();
    this.#assets = assets;
    // Small optional payload loaded alongside the world; combat keeps its
    // procedural fallback until the classic critical resources are ready.
    void this.#combatEffects.prepareClassic(assets);
    void this.prepareClassSkillEffects(this.#activeClassKey);
    void this.#levelUpEffects.prepareClassic(assets);
    this.configureMapSelector(assets);
    this.configureClassSelector();
    this.configureOutfitSelector();
    this.configureMountSelector();
    const map = assets.manifest.maps[assets.manifest.defaultMap];
    if (!map) throw new Error("Mapa padrão não definido");
    const spawn = { x: map.spawn[0], y: map.spawn[1] };
    const world = new ClassicWorld(assets, spawn);
    // CacheStorage elimina downloads repetidos, mas não substitui a decodificação
    // e montagem do Three.js. No primeiro Field, espere também DAT, modelos,
    // água e efeitos para não revelar Armia com os prédios surgindo depois.
    await world.ensureCurrent(spawn, true, true);
    this.#world = world;
    this.#groundItems = new ClassicGroundItemManager(world, assets, {
      effectsEnabled: this.#effectsEnabled,
    });
    this.#groundItems.setAllLabelsVisible(this.#groundItemLabelsVisible);
    window.addEventListener("pagehide", this.pageHide);
    const previewRoot = document.querySelector<HTMLElement>("#inventory-preview");
    const previewViewport = document.querySelector<HTMLElement>("#inventory-preview-viewport");
    if (previewRoot && previewViewport) {
      this.#inventoryPreview = new ClassicInventoryPreview(
        this.#renderer,
        world.models,
        assets,
        previewRoot,
        previewViewport,
      );
      this.#inventoryPreview.setEffectsEnabled(this.#effectsEnabled);
      this.#hud.onInventoryPreview = (item) => this.#inventoryPreview?.setItem(item);
    }
    world.setEffectsEnabled(this.#effectsEnabled);
    this.#scene.add(world.object);
    this.#player = new Player(world, spawn);
    this.#player.setBeforeClassicVisualRelease(() => this.#skillEffects.clear());
    this.#player.setEffectsEnabled(this.#effectsEnabled);
    this.#scene.add(this.#player.object);
    const avatarReady = this.#player.loadClassicAvatar(assets, "huntress", DEFAULT_HUNTRESS_LOOK_KEY).then((loaded) => {
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
    const familiarReady = this.#player.loadClassicFamiliar(assets).then((loaded) => {
      if (!loaded) console.warn("Familiar Griupan clássico indisponível");
    }).catch((error: unknown) => {
      console.warn("Familiar Griupan clássico indisponível", error);
    });
    const mountReady = this.#player.loadClassicMount(assets, DEFAULT_MOUNT_LOOK_KEY).then((loaded) => {
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
    if (loadingStatus) loadingStatus.textContent = "Montando personagem e equipamentos…";
    await Promise.all([avatarReady, familiarReady, mountReady]);
    this.activateField(spawn, true);
    this.#scene.add(this.#clickMarker);
    this.#scene.add(this.#combatEffects.object);
    this.configureScene();
    this.#cameraRig.update(this.#player.object.position, 1);
    if (loadingStatus) loadingStatus.textContent = "Preparando a primeira imagem de Armia…";
    // WebGL envia texturas e compila materiais sob demanda. Esta renderização
    // ocorre atrás da tela opaca de boot e evita que o usuário veja esse upload.
    this.#renderer.render(this.#scene, this.#camera);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    document.querySelector("#loading")?.classList.add("is-hidden");
    this.#renderer.setAnimationLoop(this.frame);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#streamingPaused = true;
    this.#renderer.setAnimationLoop(null);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("pagehide", this.pageHide);
    this.#renderer.domElement.removeEventListener("webglcontextlost", this.webglContextLost);
    this.#renderer.domElement.removeEventListener("webglcontextrestored", this.webglContextRestored);
    this.#spawnUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
    for (const summons of this.#beastMasterSummons.values()) {
      for (const summon of summons) summon.release();
    }
    this.#beastMasterSummons.clear();
    this.#input.dispose();
    this.#inventoryPreview?.dispose();
    this.#inventoryPreview = null;
    this.#groundItems?.dispose();
    this.#groundItems = null;
    this.#playerOverhead.dispose();
    this.#player?.dispose();
    this.#player = undefined;
    this.#world?.dispose();
    this.#world = undefined;
    this.#combatEffects.dispose();
    this.#skillEffects.dispose();
    this.#foemaSkillEffects?.dispose();
    this.#foemaSkillEffects = null;
    this.#transKnightSkillEffects?.dispose();
    this.#transKnightSkillEffects = null;
    this.#beastMasterSkillEffects?.dispose();
    this.#beastMasterSkillEffects = null;
    this.#classEffectLoads.clear();
    this.#etherealExplosionEffects.dispose();
    this.#levelUpEffects.dispose();
    this.#damageNumbers.dispose();
    this.#audio.dispose();
    this.#renderer.dispose();
    this.#renderer.domElement.remove();
    this.#scene.clear();
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
    this.#telemetry.begin();
    const dt = Math.min(this.#clock.getDelta(), 0.05);
    this.updateClickMarker(dt);
    const wasInvisible = this.#skills.hasBuff(95);
    this.#skills.update(dt);
    this.updateMonsterAffects(dt);
    this.#combatEffects.update(dt);
    this.#etherealExplosionEffects.update(dt);
    this.#levelUpEffects.update(dt);
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
        if (keyboard.x !== 0 || keyboard.y !== 0 || mouseForward) {
          this.breakInvisibility();
          this.closeNpcInteraction();
          this.cancelGroundItemPickup();
        }
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
        this.updatePlayerFootsteps(dt);
        this.#audio.updateMusic(
          this.#player.position,
          this.#world?.attributeAt(this.#player.position) ?? null,
        );
        this.#audio.updateAmbient(
          this.#world?.ambientSoundSources() ?? [],
          this.#player.position,
        );
        this.#groundItems?.update(dt);
        this.updateGroundItemPickup(dt);
        this.updateGroundPortalPrompt();
      }
      this.bindSpawnGameplay();
      this.updateNpcHover(dt);
      this.updateCombat(dt, mouseForward);
      this.updateBeastMasterSummons(dt);
      this.#cameraRig.update(this.#player.object.position, dt);
      this.#playerOverhead.update(this.#camera, this.#player.object, this.#player.mounted);
      this.activateField(this.#player.position);
      const coordinates = document.querySelector<HTMLElement>("#coordinates");
      if (coordinates) coordinates.textContent = `${Math.floor(this.#player.position.x)}, ${Math.floor(this.#player.position.y)}`;
      this.updateQuestResetTracker(this.#player.position);
      this.#minimap?.update(this.#player.position, this.#player.object.rotation.y);
    }
    this.updatePersistentBuffEffects(dt);
    this.#skillEffects.update(dt);
    this.#foemaSkillEffects?.update(dt);
    this.#transKnightSkillEffects?.update(dt);
    this.#beastMasterSkillEffects?.update(dt);
    this.#inventoryPreview?.update(dt);
    this.#renderer.render(this.#scene, this.#camera);
    this.#inventoryPreview?.render();
    this.#telemetry.end();
  };

  private updateQuestResetTracker(playerPosition: WydPosition): void {
    const nowMilliseconds = Date.now();
    const renderedSecond = Math.floor(nowMilliseconds / 1_000);
    if (renderedSecond === this.#questResetRenderedSecond) return;
    this.#questResetRenderedSecond = renderedSecond;
    const resetText = formatClassicQuestReset(
      classicQuestResetSecondsRemaining(nowMilliseconds),
    );
    for (const quest of CLASSIC_TIMED_QUESTS) {
      const row = document.querySelector<HTMLElement>(
        `[data-quest-key="${quest.key}"]`,
      );
      if (!row) continue;
      row.classList.toggle("is-current", isInsideClassicTimedQuest(quest, playerPosition));
      const counter = row.querySelector<HTMLElement>("[data-quest-reset]");
      if (counter) counter.textContent = resetText;
    }
  }

  private readonly groundClick = (pointer: THREE.Vector2): void => {
    this.#pendingNpcId = null;
    this.#pendingGroundItemId = null;
    this.cancelGroundItemPickup();
    if (!this.#world || !this.#player || !this.#playerState.snapshot.alive) {
      this.#heldGroundMode = null;
      this.#heldGroundDestination = null;
      return;
    }
    this.#raycaster.setFromCamera(pointer, this.#camera);
    const hits = this.#raycaster.intersectObject(this.#world.object, true);
    const spawns = this.#world.spawns;
    const queuedGroundSkill = this.#queuedGroundSkillSlot === null
      ? null
      : this.#skills.skill(this.#queuedGroundSkillSlot);
    if (queuedGroundSkill?.target === "ground") {
      const groundHit = hits.find((candidate) => (
        !spawns?.targetFromObject(candidate.object)
        && !this.#groundItems?.itemFromObject(candidate.object)
      ));
      this.#heldGroundMode = null;
      this.#heldGroundDestination = null;
      if (groundHit) this.castGroundMovementSkill(queuedGroundSkill, groundHit);
      return;
    }
    for (const candidate of hits) {
      const target = spawns?.targetFromObject(candidate.object);
      if (!target) continue;
      // Any actor under the retail mouse-over owns this click, including a
      // dying one; never tunnel through its geometry to another actor/ground.
      if (!target.alive) {
        this.#heldGroundMode = null;
        this.#heldGroundDestination = null;
        return;
      }
      this.#heldGroundMode = "target";
      this.#heldGroundDestination = null;
      if (target.hostile) {
        this.closeNpcInteraction();
        this.selectTarget(target);
      } else {
        if (this.#activeNpcId && this.#activeNpcId !== target.id) this.closeNpcInteraction();
        if (this.#selectedTargetId !== null) this.selectTarget(null);
        this.#pendingNpcId = target.interactionKind === "none" ? null : target.id;
        this.#clickMarker.visible = false;
      }
      return;
    }
    for (const candidate of hits) {
      const item = this.#groundItems?.itemFromObject(candidate.object);
      if (!item) continue;
      this.#heldGroundMode = "target";
      this.#heldGroundDestination = null;
      this.#pendingGroundItemId = item.id;
      this.closeNpcInteraction();
      this.selectTarget(null);
      this.#clickMarker.visible = false;
      return;
    }
    const hit = hits.find((candidate) => (
      !spawns?.targetFromObject(candidate.object)
      && !this.#groundItems?.itemFromObject(candidate.object)
    ));
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

  private readonly groundRelease = (pointer: THREE.Vector2): void => {
    const pendingNpcId = this.#pendingNpcId;
    const pendingGroundItemId = this.#pendingGroundItemId;
    this.#pendingNpcId = null;
    this.#pendingGroundItemId = null;
    if (
      !this.#world
      || !this.#player
      || !this.#playerState.snapshot.alive
    ) return;
    this.#raycaster.setFromCamera(pointer, this.#camera);
    const spawns = this.#world.spawns;
    const hits = this.#raycaster.intersectObject(this.#world.object, true);

    if (pendingGroundItemId) {
      // Actors own the pointer before floor items, matching the retail pick
      // order and preventing a click from tunnelling through an NPC/monster.
      if (hits.some((candidate) => spawns?.targetFromObject(candidate.object))) return;
      for (const candidate of hits) {
        const item = this.#groundItems?.itemFromObject(candidate.object);
        if (!item) continue;
        if (item.id === pendingGroundItemId) this.requestGroundItemPickup(item);
        return;
      }
      return;
    }

    if (!pendingNpcId || !spawns || this.#npcInteractionCooldown > 0) return;
    for (const candidate of hits) {
      const npc = spawns.targetFromObject(candidate.object);
      if (!npc) continue;
      // The nearest actor owns the retail mouse-over hit; never tunnel through
      // a hostile/ordinary guard to interact with an NPC behind it.
      if (npc.id !== pendingNpcId || !npc.alive || npc.hostile) return;
      // Code zero/ordinary guards have no client-authored dialog mapping.
      // MouseClick_NPC simply returns for them, so do not fabricate speech.
      if (npc.interactionKind === "none") return;
      if (isClassicMasterCarb(npc)) {
        spawns.setFriendlyHover(null);
        this.#npcInteractionCooldown = NPC_INTERACTION_DEBOUNCE_SECONDS;
        this.selectTarget(null);
        this.#hud.setTarget(null);
        this.receiveMasterCarbBuffs();
        return;
      }
      const interactionWasVisible = this.#hud.npcInteractionVisible;
      const inventoryWasVisible = document.querySelector("#inventory-panel")?.classList.contains("is-visible") ?? false;
      if (!inventoryWasVisible) this.#npcOpenedInventory = true;
      else if (!interactionWasVisible) this.#npcOpenedInventory = false;
      spawns.setFriendlyHover(null);
      this.#npcInteractionCooldown = NPC_INTERACTION_DEBOUNCE_SECONDS;
      this.#activeNpcId = npc.id;
      this.selectTarget(null);
      this.#hud.setTarget(npc);
      this.#hud.toggleInventory(true);
      this.#hud.openNpcInteraction(npc);
      if (npc.interactionKind === "shop") {
        this.#hud.setNpcShopLoading();
        void this.loadNpcShopStock(npc);
      }
      return;
    }
  };

  private readonly groundReleaseCancelled = (): void => {
    this.#pendingNpcId = null;
    this.#pendingGroundItemId = null;
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
    let actorBlocksPointer = false;
    for (const candidate of hits) {
      const target = spawns?.targetFromObject(candidate.object);
      if (!target) continue;
      actorBlocksPointer = true;
      if (target.alive) liveTarget = target;
      break;
    }
    if (actorBlocksPointer && !liveTarget) return;
    let liveGroundItem: ClassicGroundItemSnapshot | null = null;
    if (!actorBlocksPointer) {
      for (const candidate of hits) {
        liveGroundItem = this.#groundItems?.itemFromObject(candidate.object) ?? null;
        if (liveGroundItem) break;
      }
    }
    // Retail m_bMoveing semantics: a press on a target waits while still over
    // a living target, then permanently becomes ground navigation after
    // dragging away. A press that began on ground ignores crossed targets.
    if (
      this.#heldGroundMode === "target"
      && this.#pendingGroundItemId
      && liveGroundItem?.id === this.#pendingGroundItemId
    ) return;
    if (this.#heldGroundMode === "target" && liveTarget && !this.#pendingGroundItemId) {
      if (liveTarget.hostile) {
        this.closeNpcInteraction();
        if (liveTarget.id !== this.#selectedTargetId) this.selectTarget(liveTarget);
      } else {
        if (this.#selectedTargetId !== null) this.selectTarget(null);
        if (this.#activeNpcId && this.#activeNpcId !== liveTarget.id) this.closeNpcInteraction();
      }
      return;
    }
    if (actorBlocksPointer && this.#heldGroundMode === "target") return;
    const hit = hits.find((candidate) => (
      !spawns?.targetFromObject(candidate.object)
      && !this.#groundItems?.itemFromObject(candidate.object)
    ));
    if (!hit) return;
    const transitionedToGround = this.#heldGroundMode !== "ground";
    if (transitionedToGround) this.#heldGroundMode = "ground";
    if (transitionedToGround) this.#pendingGroundItemId = null;
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
    this.closeNpcInteraction();
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

  private pickupNearestGroundItem(): void {
    const player = this.#player;
    const world = this.#world;
    const manager = this.#groundItems;
    if (
      !player
      || !world
      || !manager
      || !this.#playerState.snapshot.alive
      || this.#streamingPaused
    ) return;

    let nearest: ClassicGroundItemSnapshot | null = null;
    let nearestDistanceSquared = Number.POSITIVE_INFINITY;
    for (const item of manager.snapshots()) {
      if (!manager.isMaterialized(item.id) || !this.#offlineGroundItems.get(item.id)) continue;
      if (!isWithinGroundItemPickupRange(player.position, item.position)) continue;
      const center = centeredGroundItemPosition(item.position);
      const dx = center.x - player.position.x;
      const dy = center.y - player.position.y;
      const distanceSquared = dx * dx + dy * dy;
      if (
        distanceSquared < nearestDistanceSquared
        || (
          distanceSquared === nearestDistanceSquared
          && nearest !== null
          && item.id.localeCompare(nearest.id) < 0
        )
      ) {
        nearest = item;
        nearestDistanceSquared = distanceSquared;
      }
    }
    if (!nearest) return;
    this.cancelGroundItemPickup();
    this.requestGroundItemPickup(nearest);
    // Space is an explicit pickup action: start the local request immediately
    // instead of waiting for the next animation frame.
    this.updateGroundItemPickup(0);
  }

  private requestGroundItemPickup(item: ClassicGroundItemSnapshot): void {
    const player = this.#player;
    const world = this.#world;
    if (!player || !world || !this.#playerState.snapshot.alive) return;
    if (!this.#offlineGroundItems.get(item.id)) {
      this.#hud.addLog("Esse item depende da confirmação do servidor para ser coletado.", "system");
      return;
    }
    const center = centeredGroundItemPosition(item.position);
    const alreadyInRange = isWithinGroundItemPickupRange(player.position, item.position)
      && world.navigation.canTravelDirectly(player.position, center);
    if (!alreadyInRange && !this.moveToGroundItemPickupPosition(item)) {
      this.#hud.addLog("Não há rota válida até esse item.", "system");
      return;
    }
    this.closeNpcInteraction();
    this.selectTarget(null);
    this.breakInvisibility();
    this.#groundItemPickupTargetId = item.id;
    this.#groundItemPickupApproachRemaining = alreadyInRange
      ? 0
      : GROUND_ITEM_PICKUP_APPROACH_TIMEOUT_SECONDS;
    this.#groundItemPickupStallRemaining = alreadyInRange
      ? 0
      : GROUND_ITEM_PICKUP_STALL_TIMEOUT_SECONDS;
    this.#groundItemPickupLastDistance = alreadyInRange
      ? 0
      : Math.hypot(center.x - player.position.x, center.y - player.position.y);
    this.#groundItemPickupOwnsMovement = !alreadyInRange;
    this.#clickMarker.visible = false;
  }

  private moveToGroundItemPickupPosition(item: ClassicGroundItemSnapshot): boolean {
    const player = this.#player;
    const navigation = this.#world?.navigation;
    if (!player || !navigation) return false;
    const itemCenter = centeredGroundItemPosition(item.position);
    const itemCellX = Math.floor(item.position.x);
    const itemCellY = Math.floor(item.position.y);
    const candidates: WydPosition[] = [];
    for (let y = itemCellY - OFFLINE_GROUND_ITEM_PICKUP_RANGE; y <= itemCellY + OFFLINE_GROUND_ITEM_PICKUP_RANGE; y++) {
      for (let x = itemCellX - OFFLINE_GROUND_ITEM_PICKUP_RANGE; x <= itemCellX + OFFLINE_GROUND_ITEM_PICKUP_RANGE; x++) {
        const candidate = { x: x + 0.5, y: y + 0.5 };
        if (!isWithinGroundItemPickupRange(candidate, item.position)) continue;
        if (navigation.sample(candidate).walkability !== "walkable") continue;
        if (!navigation.canTravelDirectly(candidate, itemCenter)) continue;
        candidates.push(candidate);
      }
    }
    candidates.sort((left, right) => {
      const leftDistance = squaredDistance(left, player.position);
      const rightDistance = squaredDistance(right, player.position);
      if (leftDistance !== rightDistance) return leftDistance - rightDistance;
      return squaredDistance(left, itemCenter) - squaredDistance(right, itemCenter);
    });
    for (const candidate of candidates) {
      if (player.moveTo(candidate)) return true;
    }
    return false;
  }

  private updateGroundItemPickup(deltaSeconds: number): void {
    this.#groundItemPickupCooldown = Math.max(
      0,
      this.#groundItemPickupCooldown - deltaSeconds,
    );
    const manager = this.#groundItems;
    const player = this.#player;
    if (!manager || !player) return;

    // TMItem::Render releases objects outside the focused +/-18 cell square.
    // The offline gateway has no server capable of resending them, therefore
    // both its pending DTO and the visual are retired together here.
    for (const item of manager.snapshots()) {
      if (
        Math.abs(Math.floor(player.position.x) - Math.floor(item.position.x)) <= GROUND_ITEM_STREAM_RADIUS
        && Math.abs(Math.floor(player.position.y) - Math.floor(item.position.y)) <= GROUND_ITEM_STREAM_RADIUS
      ) continue;
      this.retireGroundItem(item.id);
    }

    const id = this.#groundItemPickupTargetId;
    if (!id) return;
    if (!this.#playerState.snapshot.alive || this.#streamingPaused) {
      this.cancelGroundItemPickup();
      return;
    }
    const item = manager.get(id);
    if (!item || !this.#offlineGroundItems.get(id)) {
      this.cancelGroundItemPickup();
      return;
    }
    if (!isWithinGroundItemPickupRange(player.position, item.position)) {
      const center = centeredGroundItemPosition(item.position);
      const distance = Math.hypot(center.x - player.position.x, center.y - player.position.y);
      this.#groundItemPickupApproachRemaining -= Math.max(0, deltaSeconds);
      if (distance + 0.04 < this.#groundItemPickupLastDistance) {
        this.#groundItemPickupLastDistance = distance;
        this.#groundItemPickupStallRemaining = GROUND_ITEM_PICKUP_STALL_TIMEOUT_SECONDS;
      } else if (!player.moving) {
        this.#groundItemPickupStallRemaining -= Math.max(0, deltaSeconds);
      }
      if (
        this.#groundItemPickupApproachRemaining <= 0
        || this.#groundItemPickupStallRemaining <= 0
      ) {
        this.cancelGroundItemPickup();
        this.#hud.addLog("A coleta foi cancelada porque o item não pôde ser alcançado.", "system");
      }
      return;
    }
    // MoveGet validates BASE_GetHitPosition(..., 8) before sending. The
    // navigation segment check uses the same classic max-height threshold and
    // prevents collection through a wall, blocked corner or bridge level.
    if (!this.#world?.navigation.canTravelDirectly(
      player.position,
      centeredGroundItemPosition(item.position),
    )) {
      this.cancelGroundItemPickup();
      this.#hud.addLog("A coleta foi cancelada porque a rota ficou bloqueada.", "system");
      return;
    }
    if (this.#groundItemPickupCooldown > 0 || this.#groundItemPickupJobId) return;
    void this.confirmGroundItemPickup(item);
  }

  private async confirmGroundItemPickup(item: ClassicGroundItemSnapshot): Promise<void> {
    const id = item.id;
    if (this.#groundItemPickupJobId || this.#groundItemPickupCooldown > 0) return;
    const jobToken = ++this.#groundItemPickupJobToken;
    const generation = ++this.#groundItemPickupGeneration;
    this.#groundItemPickupJobId = id;
    try {
      // MoveGet checks CanAddItemInEmpty before sending MSG_GetItem. The local
      // 1x1 potion mock can make the same capacity decision synchronously once
      // its exact ItemList DTO has been resolved.
      const inventoryItem = await offlineGroundItemToInventoryItem(item);
      if (
        generation !== this.#groundItemPickupGeneration
        || this.#groundItemPickupTargetId !== id
        || !this.#groundItems?.get(id)
        || !this.#offlineGroundItems.get(id)
      ) return;
      if (!canAcceptInventoryItem(this.#playerState.snapshot, inventoryItem)) {
        this.#groundItemPickupTargetId = null;
        const stopPickupRoute = this.#groundItemPickupOwnsMovement;
        this.#groundItemPickupOwnsMovement = false;
        if (stopPickupRoute) this.#player?.stop();
        this.#hud.addLog("Inventário cheio · libere um espaço para coletar o item.", "system");
        return;
      }

      // This is the offline equivalent of sending MSG_GetItem. Only the
      // returned delivery (our local CNFGetItem) is allowed to mutate Carry.
      this.#groundItemPickupCooldown = GROUND_ITEM_PICKUP_COOLDOWN_SECONDS;
      const delivery = await this.#offlineGroundItems.confirmPickup(id);
      if (!delivery) return;
      // A CNF means the server-side ground instance no longer exists. Remove
      // presentation even if a later local invariant check fails, otherwise a
      // dead, permanently uncollectable model would remain under the cursor.
      this.#groundItems?.remove(id);
      this.#offlineGroundItemResidency.delete(id);
      if (this.#groundItemPickupTargetId === id) this.#groundItemPickupTargetId = null;
      const stopPickupRoute = generation === this.#groundItemPickupGeneration
        && this.#groundItemPickupOwnsMovement;
      if (generation === this.#groundItemPickupGeneration) {
        this.#groundItemPickupOwnsMovement = false;
      }
      if (stopPickupRoute) this.#player?.stop();
      const added = this.#playerState.addItem(delivery.item, delivery.quantity);
      if (added !== delivery.quantity) {
        console.error(`Coleta ${id} confirmada sem espaço reservado no inventário`);
        this.#hud.addLog("Falha de consistência ao receber o item coletado.", "system");
        return;
      }
      this.#hud.addLog(`Coletado: ${delivery.item.name}.`, "reward");
      void this.#audio.playSound(31);
    } catch (error) {
      console.error("Falha ao coletar item do chão", error);
      if (generation === this.#groundItemPickupGeneration) {
        this.#groundItemPickupTargetId = null;
        const stopPickupRoute = this.#groundItemPickupOwnsMovement;
        this.#groundItemPickupOwnsMovement = false;
        if (stopPickupRoute) this.#player?.stop();
        this.#hud.addLog("Não foi possível coletar o item.", "system");
      }
    } finally {
      if (this.#groundItemPickupJobToken === jobToken) this.#groundItemPickupJobId = null;
    }
  }

  private cancelGroundItemPickup(): void {
    if (this.#groundItemPickupOwnsMovement) this.#player?.stop();
    this.#groundItemPickupGeneration++;
    this.#groundItemPickupTargetId = null;
    this.#groundItemPickupApproachRemaining = 0;
    this.#groundItemPickupStallRemaining = 0;
    this.#groundItemPickupLastDistance = Number.POSITIVE_INFINITY;
    this.#groundItemPickupOwnsMovement = false;
    this.#pendingGroundItemId = null;
  }

  private retireGroundItem(id: string): void {
    this.#groundItems?.remove(id);
    this.#offlineGroundItems.remove(id);
    this.#offlineGroundItemResidency.delete(id);
    if (this.#groundItemPickupTargetId === id || this.#pendingGroundItemId === id) {
      this.cancelGroundItemPickup();
    }
  }

  private clearGroundItems(): void {
    this.cancelGroundItemPickup();
    this.#groundItemPickupJobToken++;
    this.#groundItemPickupJobId = null;
    this.#groundItems?.clear();
    this.#offlineGroundItems.clear();
    this.#offlineGroundItemResidency.clear();
  }

  private updateNpcHover(deltaSeconds: number): void {
    this.#npcHoverRaycastCooldown = Math.max(0, this.#npcHoverRaycastCooldown - deltaSeconds);
    this.#npcHoverRefreshRemaining = Math.max(0, this.#npcHoverRefreshRemaining - deltaSeconds);
    const spawns = this.#world?.spawns ?? null;
    const groundItems = this.#groundItems;
    if (
      (!spawns && !groundItems)
      || !this.#player
      || !this.#playerState.snapshot.alive
      || this.#streamingPaused
    ) {
      this.clearNpcHover();
      return;
    }

    const forceRefresh = this.#npcHoverRefreshRemaining <= 0;
    if (this.#npcHoverRaycastCooldown > 0 && !forceRefresh) return;
    const pointerState = this.#input.consumeHoverPointer(this.#npcHoverPointer, forceRefresh);
    if (pointerState === null) return;
    this.#npcHoverRefreshRemaining = NPC_HOVER_REFRESH_INTERVAL_SECONDS;
    if (!pointerState) {
      spawns?.setFriendlyHover(null);
      spawns?.setHostileHover(null);
      groundItems?.setHovered(null);
      return;
    }

    this.#npcHoverRaycastCooldown = NPC_HOVER_DIRTY_INTERVAL_SECONDS;
    this.#raycaster.setFromCamera(this.#npcHoverPointer, this.#camera);
    let friendlyId: string | null = null;
    let hostileId: string | null = null;
    let actorOwnsHover = false;
    if (spawns) {
      const actorHits = this.#raycaster.intersectObject(spawns.object, true);
      for (const candidate of actorHits) {
        // Status sprites are presentation only; retail mouse-over belongs to the
        // skinned body beneath the label.
        if (candidate.object instanceof THREE.Sprite) continue;
        const target = spawns.targetFromObject(candidate.object);
        if (!target) continue;
        actorOwnsHover = true;
        if (target.alive && target.hostile) hostileId = target.id;
        else if (target.alive) friendlyId = target.id;
        // The nearest actor always owns the hover, even when it is hostile.
        break;
      }
    }
    spawns?.setFriendlyHover(friendlyId);
    spawns?.setHostileHover(hostileId);

    let groundItemId: string | null = null;
    if (!actorOwnsHover && groundItems) {
      const itemHits = this.#raycaster.intersectObject(groundItems.object, true);
      for (const candidate of itemHits) {
        const item = groundItems.itemFromObject(candidate.object);
        if (!item) continue;
        groundItemId = item.id;
        break;
      }
    }
    groundItems?.setHovered(groundItemId);
  }

  private clearNpcHover(): void {
    const worldSpawns = this.#world?.spawns ?? null;
    this.#boundSpawns?.setFriendlyHover(null);
    this.#boundSpawns?.setHostileHover(null);
    if (worldSpawns && worldSpawns !== this.#boundSpawns) {
      worldSpawns.setFriendlyHover(null);
      worldSpawns.setHostileHover(null);
    }
    this.#groundItems?.setHovered(null);
  }

  private bindSpawnGameplay(): void {
    const spawns = this.#world?.spawns ?? null;
    if (!spawns || spawns === this.#boundSpawns) return;
    this.#boundSpawns?.setFriendlyHover(null);
    this.#boundSpawns?.setHostileHover(null);
    this.#boundSpawns?.setSelectedHostile(null);
    this.#pendingBowAttacks.length = 0;
    this.#weakenedMonsters.clear();
    this.#macroUnreachableTargets.clear();
    for (const unsubscribe of this.#spawnUnsubscribers) unsubscribe();
    this.#spawnUnsubscribers = [
      spawns.on("monsterAttack", (event) => this.receiveMonsterAttack(event)),
      spawns.on("actorSound", (event) => {
        if (!this.#player) return;
        this.#audio.playSpatialSound(
          event.soundIndex,
          event.position,
          this.#player.position,
          36,
          0.34,
        );
      }),
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
    spawns.setSelectedHostile(this.#selectedTargetId);
  }

  private updateCombat(deltaSeconds: number, manualMouseForward = false): void {
    this.#npcInteractionCooldown = Math.max(0, this.#npcInteractionCooldown - deltaSeconds);
    if (!this.#player || !this.#world) return;
    if (this.#streamingPaused || this.#classSwitchInFlight) return;
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
    for (const [id, remaining] of this.#macroUnreachableTargets) {
      const next = remaining - deltaSeconds;
      if (next <= 0) this.#macroUnreachableTargets.delete(id);
      else this.#macroUnreachableTargets.set(id, next);
    }
    this.updateAutoCombatRecovery(deltaSeconds);
    if (!this.#boundSpawns) return;
    this.updatePendingBowAttacks(deltaSeconds);
    if (this.#activeNpcId) {
      const npc = this.#boundSpawns.snapshot(this.#activeNpcId);
      if (!npc?.alive || npc.hostile) {
        this.closeNpcInteraction();
      } else {
        this.#hud.setTarget(npc);
        return;
      }
    }
    if (this.#pendingNpcId) {
      const pendingNpc = this.#boundSpawns.snapshot(this.#pendingNpcId);
      if (!pendingNpc?.alive || pendingNpc.hostile || pendingNpc.interactionKind === "none") {
        this.#pendingNpcId = null;
      } else {
        // Mouse-down has identified an interactable NPC, but retail opens its
        // service on mouse-up. Pause macro acquisition during that short gap.
        return;
      }
    }
    // MoveGet owns locomotion until the item cell is reached and the pickup
    // acknowledgement arrives. Do not let C.C reacquire a monster meanwhile.
    if (this.#groundItemPickupTargetId) return;
    // Preserve target selection/HUD but do not let combat face-lock the avatar
    // sideways while the two-button steering gesture owns locomotion.
    if (manualMouseForward) return;
    const supportActionStarted = this.updateAutoCombatSupport(deltaSeconds);
    if (this.#autoCombatMode === "support" || supportActionStarted) return;

    let target = this.#selectedTargetId ? this.#boundSpawns.snapshot(this.#selectedTargetId) : null;
    const macroActive = this.#autoCombatMode !== "off";
    if (macroActive && (!target?.alive || !target.hostile)) {
      target = this.acquireNearestTarget(
        true,
        this.autoCombatAcquisitionRadius(),
        this.#autoCombatPositionMode === "fixed" ? this.#autoCombatPositionAnchor : null,
      );
      if (!target) this.selectTarget(null);
    }
    if (!target) {
      this.returnToAutoCombatAnchor();
      return;
    }
    if (
      macroActive
      && this.#autoCombatPositionMode === "fixed"
      && this.#autoCombatPositionAnchor
      && this.#macroOwnsTarget
      && Math.hypot(
        target.position.x - this.#autoCombatPositionAnchor.x,
        target.position.y - this.#autoCombatPositionAnchor.y,
      ) > 10
    ) {
      this.selectTarget(null);
      this.returnToAutoCombatAnchor();
      return;
    }
    this.#hud.setTarget(target);
    if (!target.alive || !target.hostile) return;

    const macroSkills = this.#autoCombatMode === "magic" ? this.macroOffensiveSkills() : [];
    if (
      this.#autoCombatMode === "magic"
      && this.#queuedSkillSlot === null
      && this.#macroDecisionCooldown <= 0
    ) {
      for (let offset = 0; offset < macroSkills.length; offset++) {
        const index = (this.#macroSkillCursor + offset) % macroSkills.length;
        const skill = macroSkills[index]!;
        if (this.#skills.remaining(skill.slot) > 0 || this.#playerState.snapshot.mp < skill.mana) continue;
        this.#queuedSkillSlot = skill.slot;
        this.#queuedSkillOrigin = "macro";
        this.#macroSkillCursor = (index + 1) % macroSkills.length;
        break;
      }
      this.#macroDecisionCooldown = 0.2;
    }

    const dx = target.position.x - this.#player.position.x;
    const dy = target.position.y - this.#player.position.y;
    const distance = Math.hypot(dx, dy);
    const queuedSkill = this.#queuedSkillSlot === null
      ? null
      : this.#skills.skill(this.#queuedSkillSlot);
    const macroRangeSkill = this.#autoCombatMode === "magic"
      ? macroSkills[this.#macroSkillCursor % Math.max(1, macroSkills.length)] ?? null
      : null;
    const basicRange = this.#activeClassKey === "huntress"
      ? 13.5
      : (this.#activeClassKey === "foema" ? 7 : 2.35);
    const attackRange = (queuedSkill?.range || macroRangeSkill?.range || basicRange)
      + (this.#activeClassKey === "huntress" && SPECTRAL_FORCE.alwaysLearned
        ? SPECTRAL_FORCE.attackRangeBonus
        : 0);
    if (distance > attackRange) {
      const macroControlsMovement = macroActive && this.#queuedSkillOrigin !== "manual";
      if (
        macroControlsMovement
        && this.#autoCombatMode === "magic"
        && this.#autoCombatPositionMode === "stationary"
      ) {
        // A short-range skill may be selected while another configured skill
        // can reach this same target. Discard only that macro decision and let
        // the next frame advance the rotation instead of reacquiring forever.
        if (queuedSkill && this.#queuedSkillOrigin === "macro") {
          this.#queuedSkillSlot = null;
          this.#queuedSkillOrigin = null;
          this.#macroDecisionCooldown = 0;
        }
        if (distance > this.autoCombatImmediateRange() && this.#macroOwnsTarget) {
          this.selectTarget(null);
        }
        this.#player.stop();
        return;
      }
      if (macroControlsMovement && this.#autoCombatPositionMode === "stationary") {
        if (this.#macroOwnsTarget) this.selectTarget(null);
        this.#player.stop();
        return;
      }
      if (this.#targetApproachCooldown <= 0) {
        const standOff = Math.max(1.2, attackRange - 0.85);
        const canApproach = this.#player.moveTo({
          x: target.position.x - (dx / distance) * standOff,
          y: target.position.y - (dy / distance) * standOff,
        });
        if (!canApproach && macroControlsMovement && this.#macroOwnsTarget) {
          this.#macroUnreachableTargets.set(
            target.id,
            MACRO_UNREACHABLE_TARGET_COOLDOWN_SECONDS,
          );
          if (this.#queuedSkillOrigin === "macro") {
            this.#queuedSkillSlot = null;
            this.#queuedSkillOrigin = null;
          }
          this.selectTarget(null);
          this.#macroDecisionCooldown = 0;
        }
        this.#targetApproachCooldown = 0.22;
      }
      return;
    }
    this.#player.faceToward(target.position);

    if (queuedSkill) {
      if (this.#attackCooldown > 0) return;
      this.#queuedSkillSlot = null;
      this.#queuedSkillOrigin = null;
      this.castSkill(queuedSkill, target);
      return;
    }
    // Retail g_GameAuto mode 2 calls AutoSkillUse only. Waiting for mana or a
    // cooldown must never silently turn the magical profile into MAutoAttack.
    if (this.#autoCombatMode === "magic") return;
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
    this.#audio.playBasicAttack(this.#activeClassKey, sequence);
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

  private updatePlayerFootsteps(deltaSeconds: number): void {
    if (!this.#player || !this.#world) return;
    const current = { ...this.#player.position };
    const previous = this.#lastFootstepPosition;
    this.#lastFootstepPosition = current;
    this.#footstepCooldown = Math.max(0, this.#footstepCooldown - deltaSeconds);
    if (!previous) return;
    const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
    if (distance > 4) {
      this.#footstepDistance = 0;
      return;
    }
    if (!this.#player.moving || !this.#playerState.snapshot.alive) {
      this.#footstepDistance = 0;
      return;
    }
    this.#footstepDistance += distance;
    const stride = this.#player.speedBoost ? 3.2 : this.#player.mounted ? 1.45 : 0.82;
    if (this.#footstepDistance < stride || this.#footstepCooldown > 0) return;
    this.#footstepDistance %= stride;
    const soundIndex = classicFootstepSound(
      this.#world.tileTypeAt(current),
      this.#footstepSide,
    );
    this.#footstepSide = this.#footstepSide === 0 ? 1 : 0;
    this.#footstepCooldown = this.#player.speedBoost ? 0.12 : this.#player.mounted ? 0.2 : 0.16;
    void this.#audio.playSound(soundIndex, this.#player.mounted ? 0.22 : 0.18);
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
    this.closeNpcInteraction();
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
    this.#foemaSkillEffects?.setEnabled(this.#effectsEnabled);
    this.#transKnightSkillEffects?.setEnabled(this.#effectsEnabled);
    this.#beastMasterSkillEffects?.setEnabled(this.#effectsEnabled);
    this.#etherealExplosionEffects.setEnabled(this.#effectsEnabled);
    this.#levelUpEffects.setEnabled(this.#effectsEnabled);
    this.#inventoryPreview?.setEffectsEnabled(this.#effectsEnabled);
    this.#groundItems?.setEffectsEnabled(this.#effectsEnabled);
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

  private cycleAutoCombatMode(): void {
    this.setAutoCombatMode(nextAutoCombatMode(this.#autoCombatMode));
  }

  private setAutoCombatMode(mode: AutoCombatMode): void {
    if (mode === this.#autoCombatMode) {
      this.#hud.setAutoCombat(mode, this.#macroSkillSlots);
      return;
    }
    this.closeNpcInteraction();
    this.#autoCombatMode = mode;
    this.#macroDecisionCooldown = 0;
    this.#macroSkillCursor = 0;
    this.#autoCombatSupportCooldown = 0;
    this.#autoCombatSupportCursor = 0;
    if (this.#queuedSkillOrigin === "macro") {
      this.#queuedSkillSlot = null;
      this.#queuedSkillOrigin = null;
    }
    if ((mode === "off" || mode === "support") && this.#macroOwnsTarget) {
      this.selectTarget(null);
      this.#player?.stop();
    }
    this.#hud.setAutoCombat(mode, this.#macroSkillSlots);
    if (mode === "off") {
      this.#hud.addLog("C.C desligado.", "system");
      return;
    }
    if (mode === "physical") {
      this.#hud.addLog("C.C físico · ataque básico automático.", "system");
    } else if (mode === "support") {
      this.#hud.addLog("C.C suporte · mantendo buffs e recuperação, sem atacar.", "system");
    } else if (this.#macroSkillSlots.length === 0) {
      this.#hud.addLog("C.C mágico sem skills ofensivas configuradas.", "system");
    } else {
      this.#hud.addLog("C.C mágico · usando a rotação configurada da barra.", "system");
    }
    if (mode === "support") return;
    if (!this.#selectedTargetId) {
      this.acquireNearestTarget(
        true,
        this.autoCombatAcquisitionRadius(),
        this.#autoCombatPositionMode === "fixed" ? this.#autoCombatPositionAnchor : null,
      );
    }
  }

  private syncAutoCombatAuxiliary(): void {
    this.#hud.setAutoCombatAuxiliary(
      this.#autoCombatRecoveryThreshold,
      this.#autoCombatMountThreshold,
      this.#autoCombatPositionMode,
    );
  }

  private setAutoCombatPositionMode(mode: AutoCombatPositionMode): void {
    this.#autoCombatPositionMode = mode;
    this.#autoCombatPositionAnchor = mode === "fixed" && this.#player
      ? { ...this.#player.position }
      : null;
    if (mode === "stationary") this.#player?.stop();
    this.syncAutoCombatAuxiliary();
    const description = mode === "continuous"
      ? "perseguição contínua"
      : (mode === "fixed" ? "posição fixa gravada" : "sem perseguição");
    this.#hud.addLog(`C.C · ${description}.`, "system");
  }

  private refreshAutoCombatPositionAnchor(position: WydPosition): void {
    if (this.#autoCombatPositionMode !== "fixed") return;
    this.#autoCombatPositionAnchor = { ...position };
  }

  private updateAutoCombatRecovery(deltaSeconds: number): void {
    this.#autoCombatRecoveryCooldown = Math.max(0, this.#autoCombatRecoveryCooldown - deltaSeconds);
    if (
      this.#autoCombatMode === "off"
      || this.#autoCombatRecoveryThreshold <= 0
      || this.#autoCombatRecoveryCooldown > 0
    ) return;
    const snapshot = this.#playerState.snapshot;
    const threshold = this.#autoCombatRecoveryThreshold / 100;
    const needsHp = snapshot.maxHp > 0 && snapshot.hp / snapshot.maxHp < threshold;
    const needsMp = snapshot.maxMp > 0 && snapshot.mp / snapshot.maxMp < threshold;
    if (!needsHp && !needsMp) return;
    // The client evaluates HP before MP. Keep that ordering even after the
    // player rearranges consumables between inventory bags.
    let slot = needsHp
      ? snapshot.inventory.findIndex((stack) => (
        stack?.item.kind === "consumable" && (stack.item.heal ?? 0) > 0
      ))
      : -1;
    if (slot < 0 && needsMp) {
      slot = snapshot.inventory.findIndex((stack) => (
        stack?.item.kind === "consumable" && (stack.item.mana ?? 0) > 0
      ));
    }
    if (slot < 0 || !this.#playerState.useInventorySlot(slot)) {
      this.#autoCombatRecoveryCooldown = 1;
      return;
    }
    this.#autoCombatRecoveryCooldown = 0.9;
    this.#hud.addLog("C.C usou uma poção de recuperação.", "system");
  }

  private updateAutoCombatSupport(deltaSeconds: number): boolean {
    this.#autoCombatSupportCooldown = Math.max(0, this.#autoCombatSupportCooldown - deltaSeconds);
    if (
      this.#autoCombatMode === "off"
      || this.#autoCombatSupportCooldown > 0
      || this.#attackCooldown > 0
    ) return false;
    const supportSkills = this.#skills.skills.filter((skill) => (
      skill.slot >= 1
      && skill.slot <= 9
      && (
        skill.kind === "summon"
        || (skill.kind === "buff" && AUTO_COMBAT_BUFF_CLASSIC_INDICES.has(skill.classicIndex))
      )
    ));
    for (let offset = 0; offset < supportSkills.length; offset++) {
      const index = (this.#autoCombatSupportCursor + offset) % supportSkills.length;
      const skill = supportSkills[index]!;
      if (this.#skills.remaining(skill.slot) > 0 || this.#playerState.snapshot.mp < skill.mana) continue;
      if (
        skill.kind === "summon"
        && (this.#beastMasterSummons.get(skill.classicIndex)?.length ?? 0) === BEAST_MASTER_SUMMON_PACK_SIZE
        && (this.#autoCombatSummonRefreshAt.get(skill.classicIndex) ?? 0) > performance.now()
      ) continue;
      const activeBuff = skill.kind === "buff" ? this.#skills.buff(skill.classicIndex) : null;
      if (activeBuff && activeBuff.remainingSeconds > 3) continue;
      this.#autoCombatSupportCursor = (index + 1) % supportSkills.length;
      this.#autoCombatSupportCooldown = 0.65;
      if (skill.kind === "summon") this.castSummonSkill(skill);
      else this.castBuffSkill(skill);
      return true;
    }
    this.#autoCombatSupportCooldown = 0.5;
    return false;
  }

  private setMacroSkillSlots(requestedSlots: readonly number[]): void {
    const allowed = new Set(offensiveBarSkillSlots(this.#skills.skills));
    const normalized: number[] = [];
    for (const slot of requestedSlots) {
      if (!allowed.has(slot) || normalized.includes(slot) || normalized.length >= 10) continue;
      normalized.push(slot);
    }
    this.#macroSkillSlots = normalized;
    this.#macroSkillSlotsByClass.set(this.#activeClassKey, [...normalized]);
    this.#macroSkillCursor = 0;
    this.#macroDecisionCooldown = 0;
    if (
      this.#queuedSkillOrigin === "macro"
      && (this.#queuedSkillSlot === null || !normalized.includes(this.#queuedSkillSlot))
    ) {
      this.#queuedSkillSlot = null;
      this.#queuedSkillOrigin = null;
    }
    this.#hud.setAutoCombat(this.#autoCombatMode, normalized);
  }

  private macroOffensiveSkills(): readonly ClassSkill[] {
    const bySlot = new Map(this.#skills.skills.map((skill) => [skill.slot, skill]));
    return this.#macroSkillSlots.flatMap((slot) => {
      const skill = bySlot.get(slot);
      return skill && isOffensiveBarSkill(skill) ? [skill] : [];
    });
  }

  private autoCombatImmediateRange(): number {
    const base = this.#autoCombatMode === "magic"
      ? Math.max(0, ...this.macroOffensiveSkills().map((skill) => skill.range))
      : (this.#activeClassKey === "huntress" ? 13.5 : (this.#activeClassKey === "foema" ? 7 : 2.35));
    return Math.max(1.2, base + (
      this.#activeClassKey === "huntress" && SPECTRAL_FORCE.alwaysLearned
        ? SPECTRAL_FORCE.attackRangeBonus
        : 0
    ));
  }

  private autoCombatAcquisitionRadius(): number {
    const immediate = this.autoCombatImmediateRange();
    if (this.#autoCombatPositionMode === "stationary") return immediate;
    if (this.#autoCombatMode === "magic" && this.macroOffensiveSkills().length === 0) {
      return immediate;
    }
    // The web `>>` profile is deliberately continuous: unlike stationary it
    // may acquire beyond attack range and hand the stand-off point to A*.
    return Math.max(24, immediate + 8);
  }

  private returnToAutoCombatAnchor(): void {
    if (
      this.#autoCombatMode === "off"
      || this.#autoCombatPositionMode !== "fixed"
      || !this.#autoCombatPositionAnchor
      || !this.#player
    ) return;
    const dx = this.#autoCombatPositionAnchor.x - this.#player.position.x;
    const dy = this.#autoCombatPositionAnchor.y - this.#player.position.y;
    if (Math.hypot(dx, dy) <= 0.65) return;
    if (this.#targetApproachCooldown <= 0) {
      this.#player.moveTo(this.#autoCombatPositionAnchor);
      this.#targetApproachCooldown = 0.35;
    }
  }

  private requestSkill(slot: number): void {
    const skill = this.#skills.skill(slot);
    if (!skill || !this.#playerState.snapshot.alive) return;
    this.closeNpcInteraction();
    if (skill.target === "ground") {
      if (this.#skills.remaining(slot) > 0) {
        this.#hud.addLog(
          `${skill.name} recarrega em ${this.#skills.remaining(slot).toFixed(1)}s.`,
          "system",
        );
        return;
      }
      if (this.#playerState.snapshot.mp < skill.mana) {
        this.#hud.addLog(`MP insuficiente para ${skill.name}.`, "system");
        return;
      }
      this.#queuedGroundSkillSlot = slot;
      this.#queuedSkillSlot = null;
      this.#queuedSkillOrigin = null;
      this.#hud.addLog(`${skill.name}: clique em uma posição no terreno.`, "system");
      return;
    }
    this.#queuedGroundSkillSlot = null;
    if (
      skill.classKey === "huntress"
      && skill.classicIndex === 83
      && skill.kind === "utility"
    ) {
      this.#hud.armExtraction();
      return;
    }
    if (
      skill.classKey === "huntress"
      && skill.classicIndex === 84
      && skill.kind === "utility"
    ) {
      // Retail returns from SkillUse before mana/cooldown/animation and opens
      // CItemMix directly. The combine request is a later server transaction.
      this.#hud.openAlchemy();
      this.#hud.addLog("Alquimia: receitas clássicas abertas em modo somente leitura.", "system");
      return;
    }
    if (skill.kind === "summon") {
      this.castSummonSkill(skill);
      return;
    }
    if (skill.target === "self") {
      if (skill.kind === "buff") this.castBuffSkill(skill);
      else this.castSelfAreaSkill(skill);
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
    this.#queuedSkillOrigin = "manual";
    if (!this.#selectedTargetId) this.acquireNearestTarget(false);
  }

  private castGroundMovementSkill(
    skill: ClassSkill,
    hit: THREE.Intersection<THREE.Object3D>,
  ): void {
    const player = this.#player;
    const world = this.#world;
    if (
      !player
      || !world
      || skill.classKey !== "huntress"
      || skill.classicIndex !== 73
      || skill.kind !== "movement"
      || skill.target !== "ground"
    ) return;
    const requested = toWyd(hit.point.x, hit.point.z, world.origin);
    const route = world.navigation.findPath(player.position, requested, {
      allowDiagonal: true,
      maxStepHeight: 8,
      maxVisited: 65_536,
    });
    if (
      route.status !== "found"
      || route.points.length <= 1
      || !route.authoritative
    ) {
      this.#hud.addLog("Ilusão: não há rota válida até essa posição.", "system");
      return;
    }
    const routeIndex = Math.min(8, route.points.length - 1);
    const routeCell = route.points[routeIndex]!;
    const destination = { x: routeCell.x + 0.5, y: routeCell.y + 0.5 };
    const started = this.#skills.start(skill.slot, this.#playerState);
    if (!started.ok) {
      this.#queuedGroundSkillSlot = null;
      this.#hud.addLog(
        started.reason === "mana"
          ? `MP insuficiente para ${skill.name}.`
          : `${skill.name} ainda está recarregando.`,
        "system",
      );
      return;
    }

    this.#queuedGroundSkillSlot = null;
    this.closeNpcInteraction();
    this.selectTarget(null);
    this.breakInvisibility();
    const departure = player.object.position.clone();
    if (this.#effectsEnabled) {
      this.#skillEffects.playIllusion(player.createIllusionAfterimages());
      this.#levelUpEffects.playTownPortalType2(departure);
    }
    this.#audio.playSkill(skill.classicIndex);
    player.teleport(destination);
    this.refreshAutoCombatPositionAnchor(destination);
    this.#clickMarker.visible = false;
    this.#attackCooldown = Math.max(this.#attackCooldown, 0.3);
    this.#hud.addLog(
      `${skill.name} · ${skill.mana} MP · ${routeIndex} passo${routeIndex === 1 ? "" : "s"}.`,
      "system",
    );
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
    // The retail C.C refreshes a live invocation only after roughly 80 s.
    // Tracking that window avoids rebuilding the same ten-model pack on every
    // skill cooldown while still allowing an immediate retry after a load loss.
    this.#autoCombatSummonRefreshAt.set(skill.classicIndex, performance.now() + 80_000);

    this.breakInvisibility();
    this.#player.stop();
    const timing = this.#player.playClassSkill(skill);
    this.#audio.playSkill(skill.classicIndex);
    this.#attackCooldown = Math.max(
      this.#attackCooldown,
      Math.max(0.42, (timing?.animationDurationSeconds ?? 0.54) - 0.12),
    );
    const owner = this.#player.position;
    const baseAngle = definition.skill.instanceValue * 2.399963229728653;
    const spawns = Array.from({ length: BEAST_MASTER_SUMMON_PACK_SIZE }, (_, index) => {
      const angle = baseAngle + index * Math.PI * 2 / BEAST_MASTER_SUMMON_PACK_SIZE;
      const radius = 2.1 + (index % 2) * 0.75;
      return {
        x: owner.x + Math.cos(angle) * radius,
        y: owner.y + Math.sin(angle) * radius,
      };
    });
    const generation = this.#summonGeneration;
    const delay = timing?.effectDelaySeconds ?? 0.5;
    this.scheduleSkillEvent(delay, () => {
      if (!this.#assets) return;
      const assets = this.#assets;
      void Promise.all(spawns.map((spawn) => (
        ClassicBeastMasterSummon.load(definition, spawn, assets)
      ))).then((loaded) => {
        const summons = loaded.filter((summon): summon is ClassicBeastMasterSummon => summon !== null);
        if (summons.length !== BEAST_MASTER_SUMMON_PACK_SIZE) {
          for (const summon of summons) summon.release();
          this.#hud.addLog(
            `${definition.name} não pôde formar o grupo completo de ${BEAST_MASTER_SUMMON_PACK_SIZE}.`,
            "system",
          );
          return;
        }
        if (
          generation !== this.#summonGeneration
          || this.#activeClassKey !== "beastmaster"
          || !this.#player
          || !this.#world
        ) {
          for (const summon of summons) summon.release();
          return;
        }
        for (const oldSummon of this.#beastMasterSummons.get(skill.classicIndex) ?? []) oldSummon.release();
        this.#beastMasterSummons.set(skill.classicIndex, summons);
        const environment = this.summonEnvironment();
        for (const summon of summons) {
          this.#scene.add(summon.object);
          summon.update(0, this.#player.position, null, environment, () => undefined);
          this.#levelUpEffects.playSummonSpawn(summon.object.position);
        }
        this.#hud.addLog(`${summons.length}× ${definition.name} evocados.`, "system");
      }).catch((error: unknown) => {
        console.warn(`Evocação ${definition.key} indisponível`, error);
        this.#hud.addLog(`${definition.name} não pôde ser materializado.`, "system");
      });
    });
    this.#hud.addLog(`${skill.name} · ${skill.mana} MP.`, "system");
  }

  private updateBeastMasterSummons(deltaSeconds: number): void {
    if (!this.#player || !this.#world || this.#activeClassKey !== "beastmaster") return;
    const target = this.beastMasterSummonTarget();
    const environment = this.summonEnvironment();
    for (const summons of this.#beastMasterSummons.values()) {
      for (let index = 0; index < summons.length; index++) {
        const summon = summons[index]!;
        const angle = summon.definition.skill.instanceValue * 2.399963229728653
          + index * Math.PI * 2 / Math.max(1, summons.length);
        const formationRadius = 1.65 + (index % 2) * 0.7;
        const ownerAnchor = {
          x: this.#player.position.x + Math.cos(angle) * formationRadius,
          y: this.#player.position.y + Math.sin(angle) * formationRadius,
        };
        const attackSpread = summon.definition.pickSize[0] * 0.5 + formationRadius * 0.55;
        const summonTarget = target ? {
          ...target,
          position: {
            x: target.position.x + Math.cos(angle) * attackSpread,
            y: target.position.y + Math.sin(angle) * attackSpread,
          },
        } : null;
        summon.update(
          deltaSeconds,
          ownerAnchor,
          summonTarget,
          environment,
          (snapshot, definition) => this.applyBeastMasterSummonStrike(snapshot.id, definition),
        );
      }
    }
  }

  private beastMasterSummonTarget(): ClassicMonsterSnapshot | null {
    if (!this.#player || !this.#boundSpawns) return null;
    const selected = this.#selectedTargetId ? this.#boundSpawns.snapshot(this.#selectedTargetId) : null;
    if (selected?.alive && selected.hostile) return selected;
    let nearest: ClassicMonsterSnapshot | null = null;
    let nearestDistance = 16;
    for (const candidate of this.#boundSpawns.snapshots()) {
      if (!candidate.alive || !candidate.hostile) continue;
      const distance = Math.hypot(
        candidate.position.x - this.#player.position.x,
        candidate.position.y - this.#player.position.y,
      );
      if (distance >= nearestDistance) continue;
      nearest = candidate;
      nearestDistance = distance;
    }
    return nearest;
  }

  private applyBeastMasterSummonStrike(
    targetId: string,
    definition: BeastMasterSummonDefinition,
  ): void {
    if (!this.#boundSpawns || !this.#playerState.snapshot.alive) return;
    const target = this.#boundSpawns.snapshot(targetId);
    if (!target?.alive || !target.hostile) return;
    const sequence = ++this.#attackSequence;
    const variance = 0.9 + ((Math.imul(sequence, 1_664_525) >>> 25) / 127) * 0.2;
    const coefficient = 0.22 + definition.skill.instanceValue * 0.035;
    const damage = Math.max(1, Math.round(this.#playerState.snapshot.attack * coefficient * variance));
    const result = this.#boundSpawns.strikeTarget(targetId, damage);
    if (!result.ok) return;
    const point = this.combatPoint(result.target.position, 0.9);
    this.#damageNumbers.show(this.#camera, point, result.damage, false);
    this.#combatEffects.burst(point, definition.skill.classicIndex === 62 ? 0x7653ff : 0x89e4a2, 0.55);
  }

  private summonEnvironment(): {
    readonly origin: WydPosition;
    heightAt(position: WydPosition): number;
    isWalkable(position: WydPosition): boolean;
  } {
    const world = this.#world!;
    return {
      origin: world.origin,
      heightAt: (position) => world.heightAt(position),
      isWalkable: (position) => world.navigation.sample(position).walkability === "walkable",
    };
  }

  private clearBeastMasterSummons(): void {
    this.#summonGeneration++;
    for (const summons of this.#beastMasterSummons.values()) {
      for (const summon of summons) summon.release();
    }
    this.#beastMasterSummons.clear();
    this.#autoCombatSummonRefreshAt.clear();
  }

  private castSelfAreaSkill(skill: ClassSkill): void {
    if (
      !this.#player
      || !this.#boundSpawns
      || skill.target !== "self"
      || skill.kind !== "area"
    ) return;
    const started = this.#skills.start(skill.slot, this.#playerState);
    if (!started.ok) {
      this.#hud.addLog(started.reason === "mana"
        ? `MP insuficiente para ${skill.name}.`
        : `${skill.name} ainda está recarregando.`, "system");
      return;
    }
    this.breakInvisibility();
    this.#player.stop();
    const timing = this.#player.playClassSkill(skill);
    this.#audio.playSkill(skill.classicIndex);
    this.#attackCooldown = Math.max(
      this.#attackCooldown,
      Math.max(0.42, (timing?.animationDurationSeconds ?? 0.54) - 0.12),
    );
    // TMFieldScene creates Flash/Judgement from the local packet echo rather
    // than waiting for TMHuman's shared effect-event delay.
    const immediateFoemaPacketEffect = skill.classKey === "foema"
      && (skill.classicIndex === 26 || skill.classicIndex === 30)
      && this.#foemaSkillEffects?.playCast(
        skill.classicIndex,
        this.#player.object.position,
      );
    const spawns = this.#boundSpawns;
    const delay = timing?.effectDelaySeconds ?? 0.5;
    this.scheduleSkillEvent(delay, () => {
      if (
        spawns !== this.#boundSpawns
        || !this.#player
        || !this.#playerState.snapshot.alive
      ) return;
      const casterBase = this.#player.object.position.clone();
      const handled = skill.classKey === "transknight"
        && this.#transKnightSkillEffects?.playAttack(skill.classicIndex, casterBase, casterBase);
      const handledFoema = skill.classKey === "foema" && (
        immediateFoemaPacketEffect
        || this.#foemaSkillEffects?.playCast(skill.classicIndex, casterBase)
      );
      if (!handled && !handledFoema) {
        this.#combatEffects.burst(
          casterBase,
          skill.color,
          Math.max(0.9, Math.min(2.5, skill.radius || 0.9)),
        );
      }
      if (
        skill.classKey === "foema"
        && (skill.classicIndex === 27 || skill.classicIndex === 29)
      ) {
        const healed = this.#playerState.heal(skill.instanceValue);
        this.#hud.addLog(
          healed > 0 ? `${skill.name}: +${healed} HP.` : `${skill.name}: HP já está cheio.`,
          "system",
        );
      }
      if (skill.damageCoefficient > 0) this.applySelfAreaSkillImpact(skill);
    });
    this.#hud.addLog(`${skill.name} · ${skill.mana} MP.`, "system");
  }

  private castSkill(skill: ClassSkill, target: ClassicMonsterSnapshot): void {
    if (skill.target === "self") {
      this.castSelfAreaSkill(skill);
      return;
    }
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
    this.#audio.playSkill(skill.classicIndex);
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
    const casterBase = this.combatPoint(this.#player.position, 0);
    const from = this.combatPoint(this.#player.position, 1.25);
    // TMFieldScene stores vecTo in the delayed effect event. Foema projectile
    // targets therefore remain the packet-time snapshot even if the mob moves
    // during the 500 ms cast; the caster start is sampled when the event fires.
    const foemaTargetSnapshot = skill.classKey === "foema"
      ? this.combatPoint(target.position, 0)
      : null;
    const beastMasterTargetSnapshot = skill.classKey === "beastmaster"
      ? this.combatPoint(target.position, 0)
      : null;
    const delay = timing?.effectDelaySeconds ?? 0.5;

    // #35/#36/#39 are instantiated directly by TMFieldScene::OnPacketAttack.
    // Their meteor controllers already contain the retail flight/delay timing,
    // so delaying this dispatch by TMHuman's shared 500 ms would be incorrect.
    if (
      skill.classKey === "foema"
      && (skill.classicIndex === 35 || skill.classicIndex === 36 || skill.classicIndex === 39)
    ) {
      const currentTarget = spawns.snapshot(targetId);
      if (currentTarget?.alive && currentTarget.hostile) {
        const targetBase = foemaTargetSnapshot ?? this.combatPoint(currentTarget.position, 0);
        this.#foemaSkillEffects?.playAttack(skill.classicIndex, casterBase, targetBase);
        this.applySkillImpact(skill, targetId, targetBase, false);
        if (skill.classicIndex === 36) {
          spawns.applyClassicFreeze(targetId, skill.affectTimeSeconds);
        }
      }
      this.#hud.addLog(`${skill.name} · ${skill.mana} MP.`, "system");
      return;
    }

    // #52/#55 are created directly inside TMFieldScene::OnPacketAttack; they
    // do not use TMHuman's shared +500 ms effect event.
    if (skill.classKey === "beastmaster" && (skill.classicIndex === 52 || skill.classicIndex === 55)) {
      const currentTarget = spawns.snapshot(targetId);
      if (currentTarget?.alive && currentTarget.hostile) {
        const targetBase = this.combatPoint(currentTarget.position, 0);
        if (skill.classicIndex === 52) {
          this.#beastMasterSkillEffects?.playAttack(
            52,
            casterBase,
            targetBase,
            this.#player.classicYaw,
            undefined,
            (sceneX, sceneZ) => {
              const world = this.#world;
              return world
                ? world.heightAt(toWyd(sceneX, sceneZ, world.origin))
                : targetBase.y;
            },
          );
          this.applySkillImpact(skill, targetId, targetBase, false);
        } else {
          // Select once so EffectStart actors and the offline damage packet use
          // exactly the same primary-first list of at most five entities.
          const targets = this.selectSkillTargets(skill, currentTarget);
          this.#beastMasterSkillEffects?.playVengefulSpirit(
            targetBase,
            targets.map((affected) => ({
              feet: this.combatPoint(affected.position, 0),
              followTarget: () => {
                if (spawns !== this.#boundSpawns) return null;
                const live = spawns.snapshot(affected.id);
                return live ? this.combatPoint(live.position, 0) : null;
              },
            })),
          );
          this.applySkillDamageToTargets(skill, targets);
        }
      }
      this.#hud.addLog(`${skill.name} · ${skill.mana} MP.`, "system");
      return;
    }

    // #4 sets m_cPunish immediately, then snapshots the actor's current pose
    // every 300 ms for 1.5 s. Mounted snapshots retain animal and rider.
    if (skill.classKey === "transknight" && skill.classicIndex === 4) {
      const currentTarget = spawns.snapshot(targetId);
      if (currentTarget?.alive && currentTarget.hostile) {
        this.applySkillImpact(
          skill,
          targetId,
          this.combatPoint(currentTarget.position, 0),
          false,
        );
      }
      for (let index = 1; index <= 5; index++) {
        this.scheduleSkillEvent(index * 0.3, () => {
          if (
            this.#activeClassKey !== "transknight"
            || !this.#player
            || !this.#playerState.snapshot.alive
          ) return;
          const afterimages = this.#player.createIllusionAfterimages();
          const effects = this.#transKnightSkillEffects;
          for (const afterimage of afterimages) {
            if (effects) effects.playFanaticismAfterimage(afterimage);
            else afterimage.dispose();
          }
          void this.#audio.playSound(160, 0.3);
        });
      }
      this.#hud.addLog(`${skill.name} · ${skill.mana} MP.`, "system");
      return;
    }

    // #6 is instantiated directly by TMFieldScene::OnPacketAttack. Its
    // TMEffectSpark endpoint follows the live TMObject for the whole 900 ms.
    if (skill.classKey === "transknight" && skill.classicIndex === 6) {
      const currentTarget = spawns.snapshot(targetId);
      if (currentTarget?.alive && currentTarget.hostile) {
        const targetBase = this.combatPoint(currentTarget.position, 0);
        this.#transKnightSkillEffects?.playAttack(
          6,
          casterBase,
          targetBase,
          () => {
            if (spawns !== this.#boundSpawns) return null;
            const liveTarget = spawns.snapshot(targetId);
            return liveTarget ? this.combatPoint(liveTarget.position, 0) : null;
          },
        );
        this.applySkillImpact(skill, targetId, targetBase, false);
      }
      this.#hud.addLog(`${skill.name} · ${skill.mana} MP.`, "system");
      return;
    }

    // #7 also lives in OnPacketAttack and creates one type-10001 TMArrow for
    // every ID carried by the area packet. Select once so VFX and offline
    // damage use the same primary-first list capped at eight records.
    if (skill.classKey === "transknight" && skill.classicIndex === 7) {
      const currentTarget = spawns.snapshot(targetId);
      if (currentTarget?.alive && currentTarget.hostile) {
        const targets = this.selectSkillTargets(skill, currentTarget);
        for (const affected of targets) {
          this.#transKnightSkillEffects?.playDestiny(
            casterBase,
            this.combatPoint(affected.position, 0),
            () => this.#audio.playSkillImpact(7),
          );
        }
        this.applySkillDamageToTargets(skill, targets);
      }
      this.#hud.addLog(`${skill.name} · ${skill.mana} MP.`, "system");
      return;
    }

    this.scheduleSkillEvent(delay, () => {
      if (spawns !== this.#boundSpawns) return;
      const currentTarget = spawns.snapshot(targetId);
      if (!currentTarget?.alive || !currentTarget.hostile) return;
      const targetBase = this.combatPoint(currentTarget.position, 0);

      if (skill.classKey === "foema" && skill.classicIndex === 47) {
        // SkillData carries no damage and the retail event dispatcher has no
        // one-shot branch for #47. Its presentation starts only when affect 32
        // is accepted; the offline monster is a visual stand-in for that
        // server-owned PvP target.
        if (spawns.applyClassicCancellation(targetId, skill.affectTimeSeconds)) {
          this.#foemaCancellationTargetId = targetId;
          this.#hud.addLog(
            `${skill.name}: affect visual por ${skill.affectTimeSeconds}s · resolução PvP depende do servidor.`,
            "system",
          );
        }
        return;
      }

      if (skill.classKey === "huntress" && (skill.classicIndex === 72 || skill.classicIndex === 80)) {
        this.#skillEffects.playAttackBurst(skill.classicIndex, targetBase);
        if (this.#effectsEnabled) this.#cameraRig.quake(1);
        this.applySkillImpact(skill, targetId, targetBase, false);
        return;
      }

      if (skill.classKey === "huntress" && skill.kind === "shadow") {
        // TMHuman.cpp:9308-9352: no arrow or generic impact. Five copies of
        // the current actor (only the animal while mounted) cross the exact
        // caster-to-target segment with motion type 6.
        // Capture the clip before impact: a synchronous level-up may replace
        // MATT3 with LEVELUP, while the heavy SkeletonUtils clones stay after
        // the authoritative gameplay operation.
        const afterimageSelection = this.#effectsEnabled
          ? this.#player?.captureShadowBladeAfterimageSelection() ?? null
          : null;
        this.applySkillImpact(skill, targetId, targetBase, false);
        if (this.#effectsEnabled && afterimageSelection) {
          try {
            this.#skillEffects.playShadowBlade(
              this.#player?.createShadowBladeAfterimages(afterimageSelection, 5) ?? [],
              targetBase,
            );
          } catch {
            // Presentation failure cannot delay or cancel the 500 ms hit.
          }
        }
        return;
      }

      if (
        skill.classKey === "foema"
        && this.#foemaSkillEffects?.playAttack(
          skill.classicIndex,
          this.combatPoint(this.#player!.position, 0),
          foemaTargetSnapshot ?? targetBase,
        )
      ) {
        this.applySkillImpact(skill, targetId, targetBase, false);
        return;
      }

      if (
        skill.classKey === "beastmaster"
        && skill.classicIndex === 51
      ) {
        this.#beastMasterSkillEffects?.playAttack(
          51,
          this.combatPoint(this.#player!.position, 0),
          beastMasterTargetSnapshot ?? targetBase,
          this.#player!.classicYaw,
          () => {
            if (spawns !== this.#boundSpawns) return null;
            const liveTarget = spawns.snapshot(targetId);
            return liveTarget ? this.combatPoint(liveTarget.position, 0) : null;
          },
        );
        this.applyMonsterWeaken(skill, this.selectSkillTargets(skill, currentTarget));
        return;
      }

      if (
        skill.classKey === "beastmaster"
        && this.#beastMasterSkillEffects?.playAttack(
          skill.classicIndex,
          this.combatPoint(this.#player!.position, 0),
          beastMasterTargetSnapshot ?? targetBase,
          this.#player!.classicYaw,
          () => {
            if (spawns !== this.#boundSpawns) return null;
            const liveTarget = spawns.snapshot(targetId);
            return liveTarget ? this.combatPoint(liveTarget.position, 0) : null;
          },
        )
      ) {
        // The classic client applies server damage independently of the
        // skinned projectile's travel/orbit lifetime.
        this.applySkillImpact(skill, targetId, targetBase, false);
        return;
      }

      if (skill.classKey === "transknight" && skill.classicIndex === 20) {
        const afterimage = spawns.createSoulAttackAfterimage(targetId);
        if (afterimage) {
          const effects = this.#transKnightSkillEffects;
          if (effects) effects.playSoulAttackAfterimage(afterimage);
          else afterimage.dispose();
        }
        this.applySkillImpact(skill, targetId, targetBase, false);
        return;
      }

      if (skill.classKey === "transknight" && skill.classicIndex === 17) {
        const remainingSwingSeconds = Math.max(
          0.15,
          (timing?.animationDurationSeconds ?? 1) - delay,
        );
        this.#transKnightSkillEffects?.playFlamingSword(
          (out) => this.#player?.sampleWeaponEffectSegments(out) ?? 0,
          remainingSwingSeconds,
        );
        this.applySkillImpact(skill, targetId, targetBase, false);
        return;
      }

      if (skill.classKey === "transknight" && skill.classicIndex === 22) {
        this.#transKnightSkillEffects?.playBash(
          targetBase,
          () => void this.#audio.playSound(154, 0.3),
          () => void this.#audio.playSound(155, 0.3),
        );
        this.applySkillImpact(skill, targetId, targetBase, false);
        return;
      }

      if (
        skill.classKey === "transknight"
        && this.#transKnightSkillEffects?.playAttack(
          skill.classicIndex,
          casterBase,
          targetBase,
          skill.classicIndex === 16
            ? () => {
                if (spawns !== this.#boundSpawns) return null;
                const liveTarget = spawns.snapshot(targetId);
                return liveTarget ? this.combatPoint(liveTarget.position, 0) : null;
              }
            : undefined,
        )
      ) {
        if (
          this.#effectsEnabled
          && (
            skill.classicIndex === 8
            || skill.classicIndex === 10
            || skill.classicIndex === 18
          )
        ) {
          this.#cameraRig.quake(2);
        }
        this.applySkillImpact(skill, targetId, targetBase, false);
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
      if (skill.kind === "area") {
        this.#combatEffects.burst(
          targetBase,
          skill.color,
          Math.max(0.9, Math.min(2.5, skill.radius || 0.9)),
        );
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
    if (skill.requiredWeaponType !== undefined) {
      const equipment = this.#playerState.snapshot.equipment;
      const equippedWeaponType = equipment.leftHand?.item.weaponType
        ?? equipment.rightHand?.item.weaponType
        ?? null;
      if (equippedWeaponType !== skill.requiredWeaponType) {
        const requiredName = skill.requiredWeaponType === 41
          ? "garras (WTYPE 41)"
          : `uma arma WTYPE ${skill.requiredWeaponType}`;
        this.#hud.addLog(
          `${skill.name}: equipe ${requiredName}. O Skytalos é WTYPE 101.`,
          "system",
        );
        return;
      }
    }
    const requestedTransformation = skill.classKey === "beastmaster"
      ? beastMasterTransformationForSkill(skill.classicIndex)
      : null;
    const costumeIndex = this.#playerState.snapshot.equipment.costume?.item.classicIndex ?? 0;
    if (
      requestedTransformation
      && costumeIndex >= 4150
      && costumeIndex <= 4199
    ) {
      // TMFieldScene::SkillUse rejects all five shapeshifts while a 4150..4199
      // costume occupies Equip[14]; keep the same rule before spending mana.
      this.#hud.addLog(`${skill.name}: remova o traje para se transformar.`, "system");
      return;
    }
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
    this.#audio.playSkill(skill.classicIndex);
    this.#attackCooldown = Math.max(
      this.#attackCooldown,
      Math.max(0.42, (timing?.animationDurationSeconds ?? 0.54) - 0.12),
    );
    // #45 is emitted by TMFieldScene as soon as its attack packet arrives;
    // unlike the actor-owned effect event, it does not wait the usual 500 ms.
    const immediateAthenaTouch = skill.classKey === "foema"
      && skill.classicIndex === 45
      && this.#foemaSkillEffects?.playCast(45, this.#player.object.position);
    const delay = timing?.effectDelaySeconds ?? 0.5;
    this.scheduleSkillEvent(delay, () => {
      if (!this.#player || !this.#playerState.snapshot.alive) return;
      const beastMasterTransformation = requestedTransformation;
      if (beastMasterTransformation) {
        for (const candidate of BEAST_MASTER_TRANSFORMATIONS) {
          if (candidate.classicIndex !== skill.classicIndex) {
            this.#skills.removeBuff(candidate.classicIndex);
          }
        }
      }
      const active = this.#skills.activateBuff(skill);
      if (!active) return;
      if (beastMasterTransformation && this.#assets) {
        void this.#player.syncClassicBeastMasterTransformation(
          this.#assets,
          beastMasterTransformation,
        ).then((loaded) => {
          if (!loaded) {
            this.#hud.addLog(
              `${beastMasterTransformation.name}: modelo clássico indisponível.`,
              "system",
            );
          }
        });
      }
      if (skill.classicIndex === 76) this.#skillEffects.playImmunityCast(this.#player.object.position);
      if (skill.classicIndex === 77) this.#skillEffects.playMeditationCast(this.#player.object.position);
      if (skill.classicIndex === 81) this.#skillEffects.playSoulLinkCast(this.#player.object.position);
      if (skill.classicIndex === 85) this.#levelUpEffects.playGoldenShield(this.#player.object.position);
      if (skill.classicIndex === 87) this.#skillEffects.playSpiritChangeCast();
      if (skill.classicIndex === 89 && this.#effectsEnabled) {
        const selection = this.#player.captureShadowBladeAfterimageSelection();
        this.#skillEffects.playEvasionCast(
          this.#player.createShadowBladeAfterimages(selection, 5, 0x4d4d4d),
        );
      }
      if (skill.classKey === "foema" && skill.classicIndex === 37) {
        this.#foemaSkillEffects?.playThunderCast(
          this.#player.object.position,
          this.#player.mounted,
        );
      }
      const handledFoemaEffect = skill.classKey === "foema" && (
        skill.classicIndex === 37
        || (skill.classicIndex === 45 && immediateAthenaTouch)
        || this.#foemaSkillEffects?.playCast(skill.classicIndex, this.#player.object.position)
      );
      this.#player.sampleClassicSkinAnchor(this.#playerSkinAnchor);
      const handledTransKnightEffect = skill.classKey === "transknight"
        && this.#transKnightSkillEffects?.playBuff(
          skill.classicIndex,
          this.#player.object.position,
          {
            skinAnchor: this.#playerSkinAnchor,
            mounted: this.#player.mounted,
            scale: this.#player.classicScale,
            classicYaw: this.#player.classicYaw,
          },
        );
      const handledBeastMasterEffect = skill.classKey === "beastmaster"
        && this.#beastMasterSkillEffects?.playBuffCast(
          skill.classicIndex,
          this.#player.object.position,
        );
      this.#buffVisualPulseRemaining.set(skill.classicIndex, 0);
      if (skill.classicIndex === 95) this.#player.setInvisible(true);
      if (
        skill.classKey !== "huntress"
        && !handledFoemaEffect
        && !handledTransKnightEffect
        && !handledBeastMasterEffect
      ) {
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
    this.applySkillDamageToTargets(skill, targets);
    if (targets.length > 0) this.#audio.playSkillImpact(skill.classicIndex);
    if (showFallbackEffect) {
      this.#combatEffects.burst(position, skill.color, Math.max(0.8, Math.min(3, skill.radius || 0.8)));
    }
  }

  private applySelfAreaSkillImpact(skill: ClassSkill): void {
    if (!this.#boundSpawns || !this.#player) return;
    const origin = this.#player.position;
    const targets = this.#boundSpawns.snapshots()
      .filter((candidate) => candidate.alive && candidate.hostile && (
        Math.hypot(candidate.position.x - origin.x, candidate.position.y - origin.y) <= skill.radius
      ))
      .sort((left, right) => {
        const leftDistance = Math.hypot(left.position.x - origin.x, left.position.y - origin.y);
        const rightDistance = Math.hypot(right.position.x - origin.x, right.position.y - origin.y);
        return leftDistance - rightDistance || left.id.localeCompare(right.id);
      })
      .slice(0, skill.maxTargets);
    this.applySkillDamageToTargets(skill, targets);
  }

  private applySkillDamageToTargets(
    skill: ClassSkill,
    targets: readonly ClassicMonsterSnapshot[],
  ): void {
    if (!this.#boundSpawns) return;
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
    if (totalDamage > 0) this.#hud.addLog(`${skill.name}: ${totalDamage} de dano${targets.length > 1 ? ` em ${targets.length} alvos` : ""}.`, "damage");
  }

  private applyMonsterWeaken(
    skill: ClassSkill,
    targets: readonly ClassicMonsterSnapshot[],
  ): void {
    const duration = Math.max(0, skill.affectTimeSeconds);
    if (duration <= 0) return;
    for (const target of targets) {
      this.#weakenedMonsters.set(
        target.id,
        Math.max(duration, this.#weakenedMonsters.get(target.id) ?? 0),
      );
    }
    if (targets.length > 0) {
      this.#hud.addLog(
        `${skill.name}: Ataque(-) ${skill.affectValue} por ${duration}s em ${targets.length} alvo${targets.length === 1 ? "" : "s"}.`,
        "system",
      );
    }
  }

  private updateMonsterAffects(deltaSeconds: number): void {
    for (const [targetId, remaining] of this.#weakenedMonsters) {
      const next = remaining - deltaSeconds;
      if (next > 0) this.#weakenedMonsters.set(targetId, next);
      else this.#weakenedMonsters.delete(targetId);
    }
  }

  private selectSkillTargets(
    skill: ClassSkill,
    primary: ClassicMonsterSnapshot,
  ): ClassicMonsterSnapshot[] {
    if (!this.#boundSpawns || !this.#player) return [];
    if (skill.classKey === "transknight" && skill.classicIndex === 16) {
      // TMFieldScene truncates the caster->target direction to {-1,0,1} and
      // appends only the first actor occupying the exact cell beyond target.
      const origin = this.#player.position;
      const targetCellX = Math.trunc(primary.position.x);
      const targetCellY = Math.trunc(primary.position.y);
      const directionX = Math.sign(targetCellX - Math.trunc(origin.x));
      const directionY = Math.sign(targetCellY - Math.trunc(origin.y));
      if (directionX === 0 && directionY === 0) return [primary];
      const behind = this.#boundSpawns.snapshots()
        .filter((candidate) => (
          candidate.id !== primary.id
          && candidate.alive
          && candidate.hostile
          && Math.trunc(candidate.position.x) === targetCellX + directionX
          && Math.trunc(candidate.position.y) === targetCellY + directionY
        ))
        .sort((left, right) => left.id.localeCompare(right.id))[0];
      return behind ? [primary, behind] : [primary];
    }
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
    this.syncFoemaCancellationEffect();
    const player = this.#player;
    if (!player || !this.#effectsEnabled || !this.#playerState.snapshot.alive) {
      this.#buffVisualPulseRemaining.clear();
      this.#skillEffects.syncPersistentBuffs(null, {
        immunity: false,
        soulLink: false,
        mounted: false,
        ownerYaw: 0,
      });
      this.#skillEffects.syncSpiritChangeOwner(null, null, 0);
      this.#foemaSkillEffects?.syncPersistentBuffs(null, {
        thunder: false,
        magicWeapon: false,
        magicShield: false,
        athenaTouch: false,
        manaControl: false,
        mounted: false,
        scaledPickHeight: 0,
        ownerSkinAnchor: null,
      });
      this.#transKnightSkillEffects?.syncPersistentBuffs(null);
      this.#beastMasterSkillEffects?.syncPersistentBuffs(null);
      return;
    }
    const active = this.#skills.activeBuffs();
    const activeIndices = new Set(active.map((buff) => buff.classicIndex));
    const activeBeastMasterTransformation = this.#activeClassKey === "beastmaster"
      ? active
        .map((buff) => beastMasterTransformationForSkill(buff.classicIndex))
        .find((definition) => definition !== null) ?? null
      : null;
    if (this.#assets) {
      void player.syncClassicBeastMasterTransformation(
        this.#assets,
        activeBeastMasterTransformation,
      );
    }
    for (const classicIndex of this.#buffVisualPulseRemaining.keys()) {
      if (!activeIndices.has(classicIndex)) this.#buffVisualPulseRemaining.delete(classicIndex);
    }

    this.#skillEffects.syncPersistentBuffs(player.object.position, {
      immunity: activeIndices.has(76),
      soulLink: activeIndices.has(81),
      mounted: player.mounted,
      ownerYaw: player.object.rotation.y,
    });
    player.sampleSpiritChangeWingAnchor(this.#spiritChangeAnchor);
    this.#skillEffects.syncSpiritChangeOwner(
      player.object.position,
      this.#spiritChangeAnchor,
      -player.classicYaw,
    );
    player.sampleClassicSkinAnchor(this.#playerSkinAnchor);
    this.#transKnightSkillEffects?.syncPersistentBuffs({
      ownerFeet: player.object.position,
      skinAnchor: this.#playerSkinAnchor,
      classicYaw: player.classicYaw,
      scale: player.classicScale,
      mounted: player.mounted,
      possessed: this.#activeClassKey === "transknight" && activeIndices.has(13),
    });
    const magicWeapon = this.#activeClassKey === "foema" && activeIndices.has(44);
    const weaponSegmentCount = magicWeapon
      ? player.sampleWeaponEffectSegments(this.#weaponEffectSegments)
      : 0;
    this.#foemaSkillEffects?.syncPersistentBuffs(player.object.position, {
      thunder: this.#activeClassKey === "foema" && activeIndices.has(37),
      magicWeapon,
      magicShield: this.#activeClassKey === "foema" && activeIndices.has(43),
      athenaTouch: this.#activeClassKey === "foema" && activeIndices.has(45),
      manaControl: this.#activeClassKey === "foema" && activeIndices.has(46),
      mounted: player.mounted,
      scaledPickHeight: CLASSIC_HUMANOID_PICK_HEIGHT * player.classicScale,
      ownerSkinAnchor: this.#playerSkinAnchor,
    }, this.#weaponEffectSegments, weaponSegmentCount);
    this.#beastMasterSkillEffects?.syncPersistentBuffs({
      ownerFeet: player.object.position,
      ownerSkinAnchor: this.#playerSkinAnchor,
      ownerClassicYaw: player.classicYaw,
      ownerScale: player.classicScale,
      mounted: player.mounted,
      elementalProtection: this.#activeClassKey === "beastmaster" && activeIndices.has(53),
      elementalStrength: this.#activeClassKey === "beastmaster" && activeIndices.has(54),
    });

    const playerBase = player.object.position;
    for (const buff of active) {
      const hasDedicatedFoemaVisual = buff.classKey === "foema"
        && (
          buff.classicIndex === 37
          || buff.classicIndex === 41
          || buff.classicIndex === 43
          || buff.classicIndex === 44
          || buff.classicIndex === 45
          || buff.classicIndex === 46
        );
      const hasDedicatedTransKnightVisual = buff.classKey === "transknight"
        && (
          buff.classicIndex === 3
          || buff.classicIndex === 5
          || buff.classicIndex === 11
          || buff.classicIndex === 13
        );
      const hasDedicatedBeastMasterVisual = buff.classKey === "beastmaster"
        && (buff.classicIndex === 53 || buff.classicIndex === 54);
      const interval = hasDedicatedFoemaVisual
        || hasDedicatedTransKnightVisual
        || hasDedicatedBeastMasterVisual
        ? 0
        : buff.classicIndex === 75
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

  private syncFoemaCancellationEffect(): void {
    const targetId = this.#foemaCancellationTargetId;
    const spawns = this.#boundSpawns;
    const player = this.#player;
    if (!this.#effectsEnabled || !targetId || !spawns || !player) {
      this.#foemaSkillEffects?.syncCancellation(null, false);
      return;
    }
    const target = spawns.snapshot(targetId);
    if (
      !target?.alive
      || spawns.classicCancellationRemaining(targetId) <= 0
    ) {
      this.#foemaCancellationTargetId = null;
      this.#foemaSkillEffects?.syncCancellation(null, false);
      return;
    }
    const targetFeet = this.combatPoint(target.position, 0);
    this.#foemaSkillEffects?.syncCancellation({
      targetFeet,
      targetSkinAnchor: targetFeet,
      mounted: false,
      // Cancelamento is a human-target PvP affect in retail. Until networking
      // exists, the selected monster proxies the exact normal-human pick width.
      cancelScale: CLASSIC_HUMANOID_PICK_WIDTH * player.classicScale,
    }, true);
  }

  private breakInvisibility(): void {
    if (!this.#skills.removeBuff(95)) return;
    this.#player?.setInvisible(false);
    this.#hud.setBuffs(this.#skills.activeBuffs());
    this.#hud.addLog("Invisibilidade desfeita pela ação.", "system");
  }

  private acquireNearestTarget(
    forMacro = false,
    radius = 32,
    anchor: WydPosition | null = null,
  ): ClassicMonsterSnapshot | null {
    if (!this.#player || !this.#boundSpawns) return null;
    let nearest: ClassicMonsterSnapshot | null = null;
    let nearestDistance = Math.max(0, radius);
    for (const target of this.#boundSpawns.snapshots()) {
      if (!target.alive || !target.hostile) continue;
      if (forMacro && this.#macroUnreachableTargets.has(target.id)) continue;
      if (anchor && Math.hypot(target.position.x - anchor.x, target.position.y - anchor.y) > 10) continue;
      const distance = Math.hypot(target.position.x - this.#player.position.x, target.position.y - this.#player.position.y);
      if (distance >= nearestDistance) continue;
      nearest = target;
      nearestDistance = distance;
    }
    if (nearest && nearest.id !== this.#selectedTargetId) this.selectTarget(nearest, forMacro);
    return nearest;
  }

  private combatPoint(position: WydPosition, heightOffset: number): THREE.Vector3 {
    if (!this.#world) return new THREE.Vector3();
    const scene = toScene(position, this.#world.origin);
    return new THREE.Vector3(scene.x, this.#world.heightAt(position) + heightOffset, scene.z);
  }

  private selectTarget(target: ClassicMonsterSnapshot | null, macroOwned = false): void {
    this.#selectedTargetId = target?.id ?? null;
    this.#macroOwnsTarget = target !== null && macroOwned;
    this.#targetApproachCooldown = 0;
    this.#hud.setTarget(target);
    const spawns = this.#world?.spawns ?? this.#boundSpawns;
    spawns?.setSelectedHostile(target?.hostile ? target.id : null);
    this.#clickMarker.visible = false;
  }

  /**
   * Mirrors the local half of the retail ground-portal flow. The trigger is
   * recognized from the untouched AttributeMap byte only while the avatar is
   * standing; destination resolution, charging and movement remain server
   * responsibilities.
   */
  private updateGroundPortalPrompt(): void {
    const player = this.#player;
    const world = this.#world;
    if (
      !player
      || !world
      || !this.#playerState.snapshot.alive
      || this.#classSwitchInFlight
    ) {
      this.resetGroundPortalPrompt();
      return;
    }

    const attribute = world.attributeAt(player.position);
    const portal = attribute === null
      ? undefined
      : findTriggeredClassicGroundPortalAt(player.position.x, player.position.y, attribute);
    if (!portal) {
      this.resetGroundPortalPrompt();
      return;
    }

    const occupancyKey = `${portal.x}:${portal.y}`;
    if (this.#groundPortalOccupancyKey === occupancyKey || !player.standing) return;

    // Commit occupancy before opening the modal so closing/confirming it does
    // not reopen every frame while the actor remains on the same trigger.
    this.#groundPortalOccupancyKey = occupancyKey;
    this.closeNpcInteraction();
    this.selectTarget(null);
    this.#hud.openGroundPortalPrompt(portal);
  }

  private resetGroundPortalPrompt(): void {
    this.#groundPortalOccupancyKey = null;
    this.#hud.closeGroundPortalPrompt();
  }

  private closeNpcInteraction(): void {
    if (
      this.#activeNpcId === null
      && this.#pendingNpcId === null
      && !this.#hud.npcInteractionVisible
    ) return;
    const closeNpcOwnedInventory = this.#npcOpenedInventory;
    this.#activeNpcId = null;
    this.#pendingNpcId = null;
    this.#npcOpenedInventory = false;
    this.#npcShopLoadId++;
    this.#hud.closeNpcInteraction();
    if (closeNpcOwnedInventory) this.#hud.toggleInventory(false);
    if (this.#selectedTargetId === null) this.#hud.setTarget(null);
  }

  private async loadNpcShopStock(npc: ClassicMonsterSnapshot): Promise<void> {
    const loadId = ++this.#npcShopLoadId;
    try {
      const catalog = await loadClassicCommerceCatalog();
      if (
        loadId !== this.#npcShopLoadId
        || this.#activeNpcId !== npc.id
        || !this.#hud.npcInteractionVisible
      ) return;

      const carry = catalog.resolveCarry(npc.templateKey);
      if (!carry) {
        this.#hud.setNpcShopError(`Estoque classico nao encontrado para ${npc.templateKey}.`);
        return;
      }
      await this.#hud.renderNpcShopCarry(carry);
    } catch (error) {
      if (
        loadId !== this.#npcShopLoadId
        || this.#activeNpcId !== npc.id
        || !this.#hud.npcInteractionVisible
      ) return;
      this.#hud.setNpcShopError(error);
    }
  }

  private receiveMasterCarbBuffs(): void {
    const activated = grantClassicMasterCarbBuffs(this.#skills);
    const expected = CLASSIC_MASTER_CARB_BUFFS.length;
    if (activated.length !== expected) {
      this.#hud.addLog(
        `Mestre Carb · ${activated.length}/${expected} buffs puderam ser aplicados.`,
        "system",
      );
      return;
    }
    this.#buffVisualPulseRemaining.clear();
    this.#player?.setInvisible(this.#skills.hasBuff(95));
    this.#hud.setBuffs(this.#skills.activeBuffs());
    this.#hud.addLog(`Mestre Carb · ${expected} buffs renovados por 15 min.`, "reward");
  }

  private receiveMonsterAttack(event: ClassicMonsterAttackEvent): void {
    // Invisible actors are not selectable by mobs in the classic client. This
    // is distinct from invulnerability: any action removes affect 28 first.
    if (this.#player?.speedBoost || this.#skills.hasBuff(95)) return;
    if (!this.#playerState.snapshot.alive) return;
    const weakened = (this.#weakenedMonsters.get(event.attacker.id) ?? 0) > 0;
    const incomingDamage = weakened
      ? Math.max(1, Math.round(event.damage * (1 - BEAST_MASTER_WEAKEN_OFFLINE_RATIO)))
      : event.damage;
    const damage = this.#playerState.takeDamage(incomingDamage);
    playOptionalPlayerAction(this.#player, "playHit");
    this.#hud.addLog(`${event.attacker.name} causou ${damage} de dano.`, "damage");
    if (this.#playerState.snapshot.alive) {
      this.#audio.playPlayerAction(this.#activeClassKey, "hit", this.#player?.mounted ?? false);
      return;
    }
    this.#pendingBowAttacks.length = 0;
    this.#pendingSkillEvents.length = 0;
    this.#weakenedMonsters.clear();
    this.#queuedSkillSlot = null;
    this.#queuedSkillOrigin = null;
    this.#queuedGroundSkillSlot = null;
    this.#skills.clearBuffs();
    this.clearBeastMasterSummons();
    this.#buffVisualPulseRemaining.clear();
    this.#skillEffects.clear();
    this.#foemaCancellationTargetId = null;
    this.#foemaSkillEffects?.clear();
    this.#transKnightSkillEffects?.clear();
    this.#beastMasterSkillEffects?.clear();
    this.#etherealExplosionEffects.clear();
    this.#player?.setInvisible(false);
    this.#respawnRemaining = 4.5;
    this.clearNpcHover();
    this.cancelGroundItemPickup();
    this.resetGroundPortalPrompt();
    this.closeNpcInteraction();
    this.#hud.closeAlchemy();
    this.#hud.cancelExtraction();
    this.selectTarget(null);
    playOptionalPlayerAction(this.#player, "playDeath");
    this.#audio.playPlayerAction(this.#activeClassKey, "death", this.#player?.mounted ?? false);
    this.#hud.addLog("Você morreu · retornando a Armia…", "system");
  }

  private receiveMonsterDrop(event: ClassicMonsterDropEvent): void {
    const rewards = this.#playerState.grantRewards(event.experience, event.coin);
    const parts = [`+${rewards.experienceAdded.toLocaleString("pt-BR")} EXP`];
    if (rewards.coinsAdded > 0) parts.push(`+${rewards.coinsAdded.toLocaleString("pt-BR")} gold`);
    this.#hud.addLog(parts.join(" · "), "reward");
    if (rewards.levelsGained > 0) {
      const snapshot = this.#playerState.snapshot;
      this.#player?.playLevelUp();
      this.#audio.playLevelUp();
      if (this.#player) this.#levelUpEffects.playLevelUp(this.#player.object.position);
      this.#hud.addLog(
        `LEVEL UP · nível ${snapshot.level} · ${rewards.attributePointsGained} pontos · ATQ +${rewards.attackGained} (total ${snapshot.attack})!`,
        "reward",
      );
    }

    // The recovered client contains ItemList presentation data but no server
    // monster drop tables. Keep the old potion demo explicitly isolated and
    // materialize it as MSG_CreateItem-style ground state instead of silently
    // inserting invented loot into Carry.
    const groundItem = this.#offlineGroundItems.receiveMonsterDrop(event);
    if (!groundItem) return;
    const manager = this.#groundItems;
    if (!manager) {
      this.#offlineGroundItems.remove(groundItem.id);
      return;
    }
    if (!this.#offlineGroundItemResidency.has(groundItem.id)) {
      while (this.#offlineGroundItemResidency.size >= OFFLINE_GROUND_ITEM_RESIDENT_CAPACITY) {
        const oldestId = this.#offlineGroundItemResidency.values().next().value;
        if (typeof oldestId !== "string") break;
        this.retireGroundItem(oldestId);
      }
    }
    this.#offlineGroundItemResidency.add(groundItem.id);
    void manager.upsert(groundItem).then(() => {
      if (!manager.get(groundItem.id) || !this.#offlineGroundItems.get(groundItem.id)) return;
      const metadata = manager.metadata(groundItem.id);
      if (!metadata || !manager.isMaterialized(groundItem.id)) {
        this.retireGroundItem(groundItem.id);
        this.#hud.addLog(`Drop #${groundItem.classicIndex} sem recurso visual importado.`, "system");
        return;
      }
      this.#hud.addLog(`Drop no chão: ${metadata.name}.`, "reward");
    });
  }

  private respawnPlayer(): void {
    if (!this.#player || !this.#world) return;
    this.resetGroundPortalPrompt();
    this.closeNpcInteraction();
    // Resolve/cancel any presentation callback while the actor is still dead,
    // so a blade that was in flight cannot deal damage during respawn.
    this.#etherealExplosionEffects.clear();
    this.#playerState.revive();
    this.#pendingBowAttacks.length = 0;
    this.#pendingSkillEvents.length = 0;
    this.#weakenedMonsters.clear();
    this.#queuedSkillSlot = null;
    this.#queuedSkillOrigin = null;
    this.#queuedGroundSkillSlot = null;
    this.selectTarget(null);
    this.#skills.clearBuffs();
    this.#buffVisualPulseRemaining.clear();
    this.#skillEffects.clear();
    this.#foemaCancellationTargetId = null;
    this.#foemaSkillEffects?.clear();
    this.#transKnightSkillEffects?.clear();
    this.#beastMasterSkillEffects?.clear();
    this.#player.setInvisible(false);
    this.#damageNumbers.clear();
    this.#player.teleport(ARMIA_SPAWN);
    this.refreshAutoCombatPositionAnchor(ARMIA_SPAWN);
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

  private readonly pageHide = (event: PageTransitionEvent): void => {
    // Safari/iOS fires pagehide before placing the live document in the
    // back-forward cache. Keep GPU resources alive for bfcache, but free the
    // full runtime on a real document unload.
    if (!event.persisted) this.dispose();
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

  /** Keeps complete class-specific rigs/textures out of mobile boot memory. */
  private async prepareClassSkillEffects(classKey: ClassicClassKey): Promise<void> {
    const assets = this.#assets;
    if (!assets || this.#disposed) return;
    if (classKey === "huntress") {
      await Promise.allSettled([
        this.#skillEffects.prepareClassic(assets),
        this.#etherealExplosionEffects.prepareClassic(assets),
      ]);
      return;
    }

    const existing = this.#classEffectLoads.get(classKey);
    if (existing) {
      await existing;
      return;
    }

    const load = this.loadClassSkillEffectRenderer(classKey, assets)
      .catch((error: unknown) => {
        console.warn(`Renderer de skills de ${classKey} indisponivel`, error);
      });
    this.#classEffectLoads.set(classKey, load);
    await load;
  }

  private async loadClassSkillEffectRenderer(
    classKey: Exclude<ClassicClassKey, "huntress">,
    assets: ClassicAssetSource,
  ): Promise<void> {
    if (classKey === "foema") {
      const { ClassicFoemaSkillEffects } = await import("../render/effects/ClassicFoemaSkillEffects");
      if (this.#disposed) return;
      const renderer = this.#foemaSkillEffects ?? new ClassicFoemaSkillEffects(this.#scene);
      this.#foemaSkillEffects = renderer;
      renderer.setEnabled(this.#effectsEnabled);
      await renderer.prepareClassic(assets);
      return;
    }
    if (classKey === "transknight") {
      const { ClassicTransKnightSkillEffects } = await import("../render/effects/ClassicTransKnightSkillEffects");
      if (this.#disposed) return;
      const renderer = this.#transKnightSkillEffects ?? new ClassicTransKnightSkillEffects(this.#scene);
      this.#transKnightSkillEffects = renderer;
      renderer.setEnabled(this.#effectsEnabled);
      await renderer.prepareClassic(assets);
      return;
    }
    const { ClassicBeastMasterSkillEffects } = await import("../render/effects/ClassicBeastMasterSkillEffects");
    if (this.#disposed) return;
    const renderer = this.#beastMasterSkillEffects ?? new ClassicBeastMasterSkillEffects(this.#scene);
    this.#beastMasterSkillEffects = renderer;
    renderer.setEnabled(this.#effectsEnabled);
    await renderer.prepareClassic(assets);
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
    this.#classSwitchInFlight = true;
    this.cancelGroundItemPickup();
    this.resetGroundPortalPrompt();
    this.closeNpcInteraction();
    this.#queuedGroundSkillSlot = null;
    if (this.#queuedSkillOrigin === "macro") {
      this.#queuedSkillSlot = null;
      this.#queuedSkillOrigin = null;
    }
    this.#outfitLoadId++;
    select.disabled = true;
    const outfit = document.querySelector<HTMLSelectElement>("#outfit-select");
    if (outfit) outfit.disabled = true;
    if (status) status.textContent = `Carregando ${definition.name}…`;
    void Promise.all([
      this.#player.loadClassicAvatar(
        this.#assets,
        definition.key,
        definition.defaultLookKey,
      ),
      this.prepareClassSkillEffects(definition.key),
    ]).then(([loaded]) => {
      if (requestId !== this.#classLoadId) return;
      if (!loaded) {
        select.value = previousKey;
        this.#hud.setActiveSkillClass(previousKey);
        if (status) status.textContent = `${classicPlayerClass(previousKey).name} · falha ao trocar`;
        this.syncClassControls();
        this.#hud.addLog(`${definition.name} não pôde ser carregado.`, "system");
        return;
      }

      const inheritedBuffs = this.#skills.exportBuffs();
      this.#activeClassKey = definition.key;
      this.clearBeastMasterSummons();
      this.#skills.clear();
      this.#skills = new ClassSkillSystem(definition.key, inheritedBuffs);
      this.#pendingBowAttacks.length = 0;
      this.#pendingSkillEvents.length = 0;
      this.#weakenedMonsters.clear();
      this.#queuedSkillSlot = null;
      this.#queuedSkillOrigin = null;
      this.#queuedGroundSkillSlot = null;
      this.#macroSkillCursor = 0;
      this.#macroDecisionCooldown = 0;
      this.#autoCombatSupportCursor = 0;
      this.#autoCombatSupportCooldown = 0;
      this.#buffVisualPulseRemaining.clear();
      this.#skillEffects.clear();
      this.#foemaCancellationTargetId = null;
      this.#foemaSkillEffects?.clear();
      this.#transKnightSkillEffects?.clear();
      this.#beastMasterSkillEffects?.clear();
      this.#etherealExplosionEffects.clear();
      this.#player?.setInvisible(this.#skills.hasBuff(95));
      this.#playerState.setName(definition.name);
      this.#hud.configureSkills(
        this.#skills.skills.map((skill) => ({ ...skill, offensive: isOffensiveBarSkill(skill) })),
        (slot) => this.requestSkill(slot),
      );
      this.#macroSkillSlots = [
        ...(this.#macroSkillSlotsByClass.get(definition.key) ?? offensiveBarSkillSlots(this.#skills.skills)),
      ];
      this.#macroSkillSlotsByClass.set(definition.key, [...this.#macroSkillSlots]);
      this.#hud.setAutoCombat(this.#autoCombatMode, this.#macroSkillSlots);
      this.#hud.setBuffs(this.#skills.activeBuffs());
      this.#hud.setActiveSkillClass(definition.key);
      select.value = definition.key;
      if (status) status.textContent = `${definition.name} · ${definition.defaultWeapon.name}`;
      this.syncClassControls();
      this.#equipmentVisualSignature = "";
      this.playerEquipmentChanged(this.#playerState.snapshot);
      this.#hud.addLog(`${definition.name} equipado com ${definition.defaultWeapon.name}.`, "system");
    }).finally(() => {
      if (requestId === this.#classLoadId) {
        this.#classSwitchInFlight = false;
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

  private readonly playerEquipmentChanged = (snapshot: PlayerSnapshot): void => {
    if (!this.#player || !this.#assets) return;
    const leftHand = snapshot.equipment.leftHand?.item ?? null;
    const rightHand = snapshot.equipment.rightHand?.item ?? null;
    const costume = snapshot.equipment.costume?.item ?? null;
    const mount = snapshot.equipment.mount?.item ?? null;
    const familiar = snapshot.equipment.familiar?.item ?? null;
    const signature = [
      snapshot.equipment.helmet?.item.key ?? "-",
      snapshot.equipment.armor?.item.key ?? "-",
      snapshot.equipment.pants?.item.key ?? "-",
      snapshot.equipment.gloves?.item.key ?? "-",
      snapshot.equipment.boots?.item.key ?? "-",
      leftHand
        ? `${leftHand.key}:${leftHand.refinement ?? 0}:${leftHand.ancient ? 1 : 0}:${leftHand.refinementTextureIndex ?? 0}`
        : "-",
      rightHand
        ? `${rightHand.key}:${rightHand.refinement ?? 0}:${rightHand.ancient ? 1 : 0}:${rightHand.refinementTextureIndex ?? 0}`
        : "-",
      costume?.key ?? "-",
      mount?.key ?? "-",
      familiar?.key ?? "-",
    ].join("|");
    if (signature === this.#equipmentVisualSignature) return;
    this.#equipmentVisualSignature = signature;

    const weaponVisible = leftHand !== null || rightHand !== null;
    this.#player.setWeaponVisible(weaponVisible);
    const desiredMount = MOUNT_LOOKS.find((look) => look.itemIndex === mount?.classicIndex) ?? null;
    if (!desiredMount) {
      this.#mountLoadId++;
      this.#player.removeClassicMount();
      this.#hud.setMounted(false);
      const status = document.querySelector<HTMLElement>("#mount-select-status");
      if (status) status.textContent = mount ? "Montaria incompatível" : "Nenhuma montaria equipada";
    } else if (!this.#player.hasClassicMount || this.#player.mountLookKey !== desiredMount.key) {
      const requestId = ++this.#mountLoadId;
      const status = document.querySelector<HTMLElement>("#mount-select-status");
      if (status) status.textContent = `Selando ${desiredMount.name}…`;
      void this.#player.loadClassicMount(this.#assets, desiredMount.key).then((loaded) => {
        if (requestId !== this.#mountLoadId) return;
        const select = document.querySelector<HTMLSelectElement>("#mount-select");
        if (select) select.value = this.#player?.mountLookKey ?? desiredMount.key;
        if (status) status.textContent = loaded
          ? this.#player?.mountName ?? `${desiredMount.name} Lv. ${desiredMount.level}`
          : "Falha ao equipar montaria";
      });
    }

    const wantsGriupan = familiar?.classicIndex === 1726;
    if (!wantsGriupan) {
      this.#player.removeClassicFamiliar();
    } else if (!this.#player.hasClassicFamiliar) {
      void this.#player.loadClassicFamiliar(this.#assets);
    }
    const definition = classicPlayerClass(this.#activeClassKey);
    const bodyEquipment = classicBodyEquipmentIndices(snapshot.equipment);
    const wantsBodyEquipment = !costume && hasClassicBodyEquipment(bodyEquipment);
    const desiredLookKey = costume
      ? definition.looks.find((look) => look.itemIndex === costume.classicIndex)?.key
        ?? definition.defaultLookKey
      : wantsBodyEquipment
        ? classicBodyEquipmentLookKey(definition.key, bodyEquipment)
      : definition.looks.find((look) => look.key === `${definition.key}-base`)?.key
        ?? definition.defaultLookKey;
    const requestId = ++this.#outfitLoadId;
    const select = document.querySelector<HTMLSelectElement>("#outfit-select");
    const status = document.querySelector<HTMLElement>("#outfit-status");
    if (select) select.disabled = true;
    if (status) {
      status.textContent = costume
        ? `Vestindo ${costume.name}…`
        : wantsBodyEquipment
          ? "Atualizando armadura…"
          : "Retirando traje…";
    }
    const lookRequest = wantsBodyEquipment
      ? loadClassicPlayerEquipmentCatalog(this.#assets)
        .then((catalog) => catalog.composeLook(definition, bodyEquipment))
      : Promise.resolve(desiredLookKey);
    const weaponRequest = loadClassicPlayerWeaponCatalog(this.#assets).then((catalog) => (
      catalog.composeLoadout(definition, { leftHand, rightHand })
    ));
    void Promise.all([lookRequest, weaponRequest]).then(([look, weapons]) => {
      if (requestId !== this.#outfitLoadId) return false;
      return this.#player?.loadClassicAvatar(
        this.#assets!,
        definition.key,
        look,
        weapons,
      ) ?? false;
    }).then((loaded) => {
      if (requestId !== this.#outfitLoadId) return;
      const current = this.#playerState.snapshot;
      this.#player?.setWeaponVisible(
        current.equipment.leftHand !== null || current.equipment.rightHand !== null,
      );
      if (!loaded) {
        if (status) status.textContent = "Falha ao atualizar equipamento";
        return;
      }
      if (select) {
        const currentLook = this.#player?.avatarLookKey ?? desiredLookKey;
        const selectable = definition.looks.some((look) => look.key === currentLook);
        select.value = selectable
          ? currentLook
          : definition.looks.find((look) => look.key === `${definition.key}-base`)?.key
            ?? definition.defaultLookKey;
      }
      if (status) status.textContent = this.#player?.avatarLookName ?? "Visual equipado";
    }).catch((error: unknown) => {
      if (requestId !== this.#outfitLoadId) return;
      console.warn("LOOK_INFO do equipamento indisponível", error);
      if (status) status.textContent = "Falha ao carregar armadura";
    }).finally(() => {
      if (requestId === this.#outfitLoadId && select) select.disabled = false;
    });
  };

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
    const equipment = this.#playerState.snapshot.equipment;
    void loadClassicPlayerWeaponCatalog(this.#assets)
      .then((catalog) => catalog.composeLoadout(definition, {
        leftHand: equipment.leftHand?.item ?? null,
        rightHand: equipment.rightHand?.item ?? null,
      }))
      .then((weapons) => this.#player?.loadClassicAvatar(
        this.#assets!,
        definition.key,
        requestedLook.key,
        weapons,
      ) ?? false)
      .then((loaded) => {
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
    this.#weakenedMonsters.clear();
    this.#queuedSkillSlot = null;
    this.#queuedSkillOrigin = null;
    this.#queuedGroundSkillSlot = null;
    this.cancelGroundItemPickup();
    this.clearNpcHover();
    this.resetGroundPortalPrompt();
    this.closeNpcInteraction();
    this.selectTarget(null);
    this.#skillEffects.clear();
    this.#foemaCancellationTargetId = null;
    this.#foemaSkillEffects?.clear();
    this.#transKnightSkillEffects?.clear();
    this.#beastMasterSkillEffects?.clear();
    this.#etherealExplosionEffects.clear();
    this.#damageNumbers.clear();

    const destination = isArmia(entry)
      ? { ...ARMIA_SPAWN }
      : fieldCenter(entry.column, entry.row);
    try {
      await this.#world.ensureCurrent(destination, true);
      if (requestId !== this.#teleportId) return;
      this.clearGroundItems();
      this.#player.teleport(destination);
      this.refreshAutoCombatPositionAnchor(destination);
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
    this.resetGroundPortalPrompt();
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

function updateBootCacheProgress(progress: ClassicCacheProgress): void {
  const status = document.querySelector<HTMLElement>("#loading-status");
  const root = document.querySelector<HTMLElement>("#loading-cache");
  const count = document.querySelector<HTMLElement>("#loading-cache-count");
  const bytes = document.querySelector<HTMLElement>("#loading-cache-bytes");
  const file = document.querySelector<HTMLElement>("#loading-cache-file");
  const skip = document.querySelector<HTMLButtonElement>("#loading-cache-skip");
  const ratio = progress.totalBytes > 0
    ? progress.loadedBytes / progress.totalBytes
    : progress.phase === "ready" ? 1 : 0;

  if (status) status.textContent = progress.label;
  root?.style.setProperty(
    "--classic-cache-progress",
    `${(Math.max(0, Math.min(1, ratio)) * 100).toFixed(2)}%`,
  );
  if (count) {
    count.textContent = progress.totalAssets > 0
      ? `${progress.completedAssets.toLocaleString("pt-BR")} / ${progress.totalAssets.toLocaleString("pt-BR")} arquivos`
      : progress.phase === "checking" ? "Verificando cache…" : "Cache opcional";
  }
  if (bytes) {
    const speed = bootCachePreparationSpeed(progress);
    bytes.textContent = progress.totalBytes > 0
      ? `${formatBootBytes(progress.loadedBytes)} / ${formatBootBytes(progress.totalBytes)}${speed}`
      : "—";
  }
  if (file) {
    file.textContent = progress.currentAsset
      ? readableBootAssetName(progress.currentAsset)
      : progress.phase === "ready"
        ? progress.persistent
          ? "Cache persistente confirmado pelo navegador"
          : "Cache pronto · sujeito à política de espaço do navegador"
        : progress.phase === "unsupported"
          ? "O jogo continuará normalmente usando a conexão"
          : "";
  }
  if (skip) skip.hidden = progress.phase !== "downloading";
}

let bootCacheStartTime = 0;
let bootCacheStartBytes = 0;

function bootCachePreparationSpeed(progress: ClassicCacheProgress): string {
  if (progress.phase === "checking") {
    bootCacheStartTime = 0;
    bootCacheStartBytes = 0;
    return "";
  }
  if (progress.phase !== "downloading") return "";
  if (bootCacheStartTime === 0) {
    bootCacheStartTime = performance.now();
    bootCacheStartBytes = progress.loadedBytes;
    return "";
  }
  const elapsedSeconds = (performance.now() - bootCacheStartTime) / 1_000;
  if (elapsedSeconds < 0.4) return "";
  const bytesPerSecond = Math.max(0, progress.loadedBytes - bootCacheStartBytes) / elapsedSeconds;
  return bytesPerSecond > 0 ? ` · ${formatBootBytes(bytesPerSecond)}/s` : "";
}

function formatBootBytes(bytes: number): string {
  const safeBytes = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  if (safeBytes < 1_024) return `${Math.round(safeBytes)} B`;
  if (safeBytes < 1_048_576) return `${(safeBytes / 1_024).toFixed(1)} KiB`;
  return `${(safeBytes / 1_048_576).toFixed(1)} MiB`;
}

function readableBootAssetName(url: string): string {
  const name = url.slice(url.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
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

function centeredGroundItemPosition(position: WydPosition): WydPosition {
  return { x: Math.floor(position.x) + 0.5, y: Math.floor(position.y) + 0.5 };
}

function isWithinGroundItemPickupRange(player: WydPosition, item: WydPosition): boolean {
  return classicGridDistance(player, item) <= OFFLINE_GROUND_ITEM_PICKUP_RANGE;
}

function classicGridDistance(left: WydPosition, right: WydPosition): number {
  const dx = Math.abs(Math.floor(left.x) - Math.floor(right.x));
  const dy = Math.abs(Math.floor(left.y) - Math.floor(right.y));
  if (dx <= 6 && dy <= 6) return CLASSIC_GRID_DISTANCE_TABLE[dy]![dx]!;
  return dx <= dy ? dy + 1 : dx + 1;
}

function squaredDistance(left: WydPosition, right: WydPosition): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

/** TMHuman::AnimationFrame surface pairs for the focused actor. */
function classicFootstepSound(tileType: number, side: 0 | 1): number {
  if (tileType === 1 || tileType === 11) return side === 0 ? 184 : 185;
  if (tileType === 8 || tileType === 9) return side === 0 ? 198 : 199;
  if (tileType === 4) return side === 0 ? 190 : 191;
  return side === 0 ? 192 : 193;
}

function canAcceptInventoryItem(snapshot: PlayerSnapshot, item: InventoryItem): boolean {
  const maxStack = Math.max(1, Math.trunc(item.maxStack));
  return snapshot.inventory.some((stack) => (
    stack?.item.key === item.key && stack.quantity < maxStack
  )) || classicGridHasPlacement(snapshot.inventory, item, INVENTORY_BAG_SIZE, 5);
}

const CLASSIC_GRID_DISTANCE_TABLE = Object.freeze([
  Object.freeze([0, 1, 2, 3, 4, 5, 6]),
  Object.freeze([1, 1, 2, 3, 4, 5, 6]),
  Object.freeze([2, 2, 3, 4, 4, 5, 6]),
  Object.freeze([3, 3, 4, 4, 5, 5, 6]),
  Object.freeze([4, 4, 4, 5, 5, 5, 6]),
  Object.freeze([5, 5, 5, 5, 5, 6, 6]),
  Object.freeze([6, 6, 6, 6, 6, 6, 6]),
] as const);

function createClickMarker(): THREE.Mesh {
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.7, 24),
    new THREE.MeshBasicMaterial({ color: 0x8fffa6, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
  );
  marker.rotation.x = -Math.PI / 2;
  marker.visible = false;
  return marker;
}

// Exact buff indices maintained by g_GameAuto in the audited 7.54 client.
// Invisibility #95 is intentionally absent: auto-casting it drains Huntress
// MP and the following offensive action cancels it immediately.
const AUTO_COMBAT_BUFF_CLASSIC_INDICES: ReadonlySet<number> = new Set([
  3, 5, 9, 11, 37, 41, 43, 44, 45, 46, 53, 54, 64,
  66, 68, 70, 71, 75, 76, 77, 81, 85, 87, 89, 92,
]);

function isOffensiveBarSkill(skill: ClassSkill): boolean {
  return skill.slot >= 1
    && skill.slot <= 9
    && (skill.target === "enemy" || skill.kind === "area")
    && skill.aggressive === 1
    && skill.damageCoefficient > 0;
}

function offensiveBarSkillSlots(skills: readonly ClassSkill[]): number[] {
  return skills
    .filter(isOffensiveBarSkill)
    .map((skill) => skill.slot)
    .slice(0, 10);
}

function clampAutoCombatThreshold(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(90, Math.round(value / 10) * 10));
}

function playOptionalPlayerAction(
  player: Player | undefined,
  action: "playAttack" | "playHit" | "playDeath" | "playIdle",
): void {
  const animated = player as Player & Partial<Record<typeof action, () => void>> | undefined;
  animated?.[action]?.();
}
