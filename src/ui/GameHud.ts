import {
  CARGO_PAGE_COUNT,
  CARGO_PAGE_SIZE,
  EQUIPMENT_SLOTS,
  INVENTORY_BAG_COUNT,
  INVENTORY_BAG_SIZE,
  classicGridAnchorAt,
  classicGridOccupiedCellCount,
  classicItemGridFootprint,
  type EquipmentSlot,
  type InventoryItem,
  type InventoryStack,
  type PlayerSnapshot,
  type PlayerState,
  type PrimaryAttribute,
} from "../game/state/PlayerState";
import {
  nextAutoCombatMode,
  nextAutoCombatPositionMode,
  type AutoCombatMode,
  type AutoCombatPositionMode,
} from "../game/combat/AutoCombat";
import type {
  ClassicMonsterSnapshot,
  ClassicNpcInteractionKind,
} from "../game/npcs/ClassicMonsterGameplay";
import type { ClassicGroundPortal } from "../game/portals/ClassicGroundPortals";
import { CLASSIC_SKILL_RUNTIME_BLOCKERS } from "../game/combat/ClassSkillBlockers";
import {
  loadClassicCommerceCatalog,
  type ClassicCommerceCatalog,
  type ClassicResolvedTemplateCarry,
} from "../game/commerce/ClassicCommerceCatalog";
import type {
  ClassicAlchemyCatalog,
  ClassicAlchemyRecipe,
} from "../game/items/ClassicAlchemyCatalog";
import { classicInventoryItemTooltip } from "./ClassicItemTooltip";
import { ClassicNpcShopGrid } from "./ClassicNpcShopGrid";
import {
  makeClassicWindowDraggable,
  type ClassicWindowDragController,
} from "./ClassicWindowDrag";
import { GameTooltip, setGameTooltip, type GameTooltipContent } from "./GameTooltip";

type InventoryItemSource =
  | { readonly kind: "inventory"; readonly slot: number }
  | { readonly kind: "cargo"; readonly slot: number }
  | { readonly kind: "equipment"; readonly slot: EquipmentSlot };

type InventoryPanelItemSource = Exclude<InventoryItemSource, { readonly kind: "cargo" }>;

interface InventoryPointerDrag {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly source: InventoryItemSource;
  readonly item: InventoryItem;
  readonly anchor: HTMLButtonElement;
  moved: boolean;
  ghost: HTMLElement | null;
}

export interface TargetHudSnapshot {
  readonly name: string;
  readonly level?: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly hostile: boolean;
}

export interface SkillHudEntry {
  readonly slot: number;
  readonly name: string;
  readonly shortName: string;
  readonly mana: number;
  readonly classicIndex?: number;
  /** True only for an aggressive enemy skill that actually occupies the bar. */
  readonly offensive?: boolean;
  readonly cooldownSeconds?: number;
  readonly runtimeDurationSeconds?: number;
  readonly range?: number;
  readonly kind?: string;
  readonly target?: "enemy" | "self" | "ground";
  readonly requiredWeaponType?: number;
}

export interface BuffHudEntry {
  readonly classicIndex: number;
  readonly name: string;
  readonly iconIndex: number;
  readonly durationSeconds: number;
  readonly remainingSeconds: number;
  readonly classKey?: string;
  readonly affectType?: number;
  readonly affectValue?: number;
}

export type ChatChannel = "general" | "party" | "guild";

interface ClassicSkillCatalogClass {
  readonly key: string;
  readonly name: string;
  readonly masteries: readonly string[];
  readonly skills: readonly number[];
  readonly masterSkills: readonly number[];
}

interface ClassicSkillCatalogEntry {
  readonly index: number;
  readonly name: string;
  readonly classKey: string | null;
  readonly category: "class" | "master" | "special";
  readonly mastery: number | null;
  readonly masterySlot: number | null;
  readonly kind: "active" | "buff" | "passive";
  readonly manaSpent: number;
  readonly delaySeconds: number;
  readonly range: number;
  readonly affectTimeSeconds?: number;
  readonly iconIndex: number | null;
}

interface ClassicSkillCatalog {
  readonly classes: readonly ClassicSkillCatalogClass[];
  readonly specialSkills?: readonly number[];
  readonly alwaysLearnedSkills?: readonly number[];
  readonly skills: readonly ClassicSkillCatalogEntry[];
}

interface ClassicItemIconCatalog {
  readonly version: number;
  readonly cellSize: number;
  readonly columns: number;
  readonly iconsPerAtlas: number;
  readonly atlases: readonly string[];
  readonly itemToIcon: readonly number[];
}

export class GameHud {
  onSkillClassSelected: ((classKey: string) => void) | null = null;
  onCatalogSkillUse: ((classicIndex: number) => void) | null = null;
  onInventoryPreview: ((item: InventoryItem | null) => void) | null = null;
  onAutoCombatModeSelected: ((mode: AutoCombatMode) => void) | null = null;
  onAutoCombatSkillSlotsChanged: ((slots: readonly number[]) => void) | null = null;
  onAutoCombatRecoveryThresholdChanged: ((percentage: number) => void) | null = null;
  onAutoCombatMountThresholdChanged: ((percentage: number) => void) | null = null;
  onAutoCombatPositionModeSelected: ((mode: AutoCombatPositionMode) => void) | null = null;
  onChatSubmit: ((message: string, channel: ChatChannel) => void) | null = null;
  onExtractionRequest: ((slot: number, item: InventoryItem) => void) | null = null;
  onNpcInteractionClose: (() => void) | null = null;
  onGroundPortalConfirm: ((portal: ClassicGroundPortal) => void) | null = null;
  onGroundPortalClose: ((portal: ClassicGroundPortal) => void) | null = null;
  readonly #target = requireElement<HTMLElement>("#target-status");
  readonly #targetName = requireElement<HTMLElement>("#target-name");
  readonly #targetLevel = requireElement<HTMLElement>("#target-level");
  readonly #targetHp = requireElement<HTMLElement>("#target-hp-fill");
  readonly #inventory = requireElement<HTMLElement>("#inventory-panel");
  readonly #inventoryGrid = requireElement<HTMLElement>("#inventory-grid");
  readonly #inventoryEquipment = requireElement<HTMLElement>("#inventory-equipment");
  readonly #inventoryBags = requireElement<HTMLElement>("#inventory-bags");
  readonly #inventoryPreview = requireElement<HTMLElement>("#inventory-preview");
  readonly #alchemyPanel = requireElement<HTMLElement>("#alchemy-panel");
  readonly #alchemyResults = requireElement<HTMLElement>("#alchemy-results");
  readonly #alchemyRequirements = requireElement<HTMLElement>("#alchemy-requirements");
  readonly #alchemyCost = requireElement<HTMLElement>("#alchemy-cost");
  readonly #alchemyStatus = requireElement<HTMLElement>("#alchemy-status");
  readonly #characterPanel = requireElement<HTMLElement>("#character-panel");
  readonly #combatLog = requireElement<HTMLElement>("#combat-log");
  readonly #chatShell = requireElement<HTMLElement>(".classic-chat-shell");
  readonly #chatInput = requireElement<HTMLInputElement>("#chat-message");
  readonly #chatChannelLabel = requireElement<HTMLButtonElement>("#chat-channel-label");
  readonly #gameMenu = requireElement<HTMLElement>("#game-menu-panel");
  readonly #ccPanel = requireElement<HTMLElement>("#cc-panel");
  readonly #ccSkillList = requireElement<HTMLElement>("#cc-skill-list");
  readonly #buffStatus = requireElement<HTMLElement>("#buff-status");
  readonly #skillPanel = requireElement<HTMLElement>("#skill-panel");
  readonly #skillCatalogGrid = requireElement<HTMLElement>("#skill-catalog-grid");
  readonly #skillCatalogStatus = requireElement<HTMLElement>("#skill-catalog-status");
  readonly #skillClassSelect = requireElement<HTMLSelectElement>("#skill-class-select");
  readonly #npcInteraction = requireElement<HTMLElement>("#npc-interaction");
  readonly #npcInteractionName = requireElement<HTMLElement>("#npc-interaction-name");
  readonly #npcInteractionKind = requireElement<HTMLElement>("#npc-interaction-kind");
  readonly #npcInteractionMessage = requireElement<HTMLElement>("#npc-interaction-message");
  readonly #npcInteractionSlots = requireElement<HTMLElement>("#npc-interaction-slots");
  readonly #npcInteractionAuthorityTitle = requireElement<HTMLElement>("#npc-interaction-authority-title");
  readonly #npcInteractionAuthorityDetail = requireElement<HTMLElement>("#npc-interaction-authority-detail");
  readonly #npcInteractionSource = requireElement<HTMLElement>("#npc-interaction-source");
  readonly #groundPortalPrompt = requireElement<HTMLElement>("#ground-portal-prompt");
  readonly #groundPortalPromptMessage = requireElement<HTMLElement>("#ground-portal-prompt-message");
  readonly #groundPortalPromptPrice = requireElement<HTMLElement>("#ground-portal-prompt-price");
  readonly #groundPortalConfirm = requireElement<HTMLButtonElement>("[data-ground-portal-confirm]");
  readonly #extractionPrompt = requireElement<HTMLElement>("#extraction-prompt");
  readonly #extractionPromptMessage = requireElement<HTMLElement>("#extraction-prompt-message");
  readonly #extractionPromptConfirm = requireElement<HTMLButtonElement>("[data-extraction-confirm]");
  readonly #npcShopGrid: ClassicNpcShopGrid;
  readonly #cargoPageNav: HTMLElement;
  readonly #cargoOfflineNotice: HTMLElement;
  readonly #inventoryWindowDrag: ClassicWindowDragController;
  readonly #alchemyWindowDrag: ClassicWindowDragController;
  readonly #characterWindowDrag: ClassicWindowDragController;
  readonly #skillWindowDrag: ClassicWindowDragController;
  readonly #npcWindowDrag: ClassicWindowDragController;
  #state: PlayerState | null = null;
  #unsubscribe: (() => void) | null = null;
  #lastSnapshot: PlayerSnapshot | null = null;
  #buffSignature = "";
  #skillCatalog: ClassicSkillCatalog | null = null;
  #skillCatalogJob: Promise<void> | null = null;
  #itemIconCatalog: ClassicItemIconCatalog | null = null;
  #itemIconCatalogJob: Promise<ClassicItemIconCatalog | null> | null = null;
  #classicCommerceCatalog: ClassicCommerceCatalog | null = null;
  #classicCommerceCatalogJob: Promise<ClassicCommerceCatalog | null> | null = null;
  #classicAlchemyCatalog: ClassicAlchemyCatalog | null = null;
  #classicAlchemyCatalogJob: Promise<ClassicAlchemyCatalog | null> | null = null;
  #selectedAlchemyRecipe: ClassicAlchemyRecipe | null = null;
  #inventorySignature = "";
  #cargoSignature = "";
  #activeInventoryBag = 0;
  #activeCargoPage = 0;
  #activeNpcInteractionKind: ClassicNpcInteractionKind = "none";
  #selectedInventorySource: InventoryItemSource | null = null;
  #selectedInventoryItemKey: string | null = null;
  #inventoryPointerDrag: InventoryPointerDrag | null = null;
  #suppressInventoryClick = false;
  #activeClassKey = "huntress";
  #runtimeSkillIndices = new Set<number>();
  #runtimeSkills: readonly SkillHudEntry[] = [];
  #autoCombatMode: AutoCombatMode = "off";
  #autoCombatSkillSlots: number[] = [];
  #autoCombatRecoveryThreshold = 30;
  #autoCombatMountThreshold = 30;
  #autoCombatPositionMode: AutoCombatPositionMode = "continuous";
  #chatChannel: ChatChannel = "general";
  #chatHistory: string[] = [];
  #chatHistoryCursor = 0;
  #activeGroundPortal: ClassicGroundPortal | null = null;
  #extractionArmed = false;
  #pendingExtraction: { readonly slot: number; readonly item: InventoryItem } | null = null;
  #groundPortalPreviousFocus: HTMLElement | null = null;
  #npcAnchorSnapFrame = 0;
  #activeNpcShopTemplateKey: string | null = null;

  constructor() {
    new GameTooltip(requireElement<HTMLElement>("#game-tooltip"));
    this.#npcShopGrid = new ClassicNpcShopGrid(this.#npcInteractionSlots);
    this.#cargoPageNav = createCargoPageNavigation();
    this.#cargoOfflineNotice = document.createElement("p");
    this.#cargoOfflineNotice.className = "classic-cargo-offline-notice";
    this.#cargoOfflineNotice.textContent = "Armazém offline desta sessão — reinicia ao recarregar";
    const npcSurface = requirePanelHandle(this.#npcInteraction, ".npc-interaction-surface");
    npcSurface.append(this.#cargoPageNav, this.#cargoOfflineNotice);
    for (const button of this.#cargoPageNav.querySelectorAll<HTMLButtonElement>("[data-cargo-page]")) {
      button.addEventListener("click", () => {
        const page = Number(button.dataset.cargoPage);
        if (Number.isInteger(page)) this.setActiveCargoPage(page);
      });
    }
    this.#npcWindowDrag = makeClassicWindowDraggable(
      this.#npcInteraction,
      requirePanelHandle(this.#npcInteraction, ".npc-interaction-surface > header"),
      {
        autoClampOnResize: false,
        onReset: () => this.positionNpcBesideInventory(),
      },
    );
    this.#inventoryWindowDrag = makeClassicWindowDraggable(
      this.#inventory,
      requirePanelHandle(this.#inventory, ":scope > header"),
      {
        onMove: () => this.positionNpcBesideInventory(),
        onReset: () => this.positionNpcBesideInventory(),
      },
    );
    this.#alchemyWindowDrag = makeClassicWindowDraggable(
      this.#alchemyPanel,
      requirePanelHandle(this.#alchemyPanel, ":scope > header"),
    );
    this.#characterWindowDrag = makeClassicWindowDraggable(
      this.#characterPanel,
      requirePanelHandle(this.#characterPanel, ":scope > header"),
    );
    this.#skillWindowDrag = makeClassicWindowDraggable(
      this.#skillPanel,
      requirePanelHandle(this.#skillPanel, ":scope > header"),
    );
    window.addEventListener("resize", this.reflowNpcInteraction);

    document.querySelector<HTMLElement>("[data-inventory-close]")?.addEventListener("click", () => {
      this.toggleInventory(false);
    });
    document.querySelector<HTMLElement>("[data-alchemy-close]")?.addEventListener("click", () => {
      this.closeAlchemy();
    });
    document.querySelector<HTMLElement>("[data-alchemy-combine]")?.addEventListener("click", () => {
      this.#alchemyStatus.textContent = this.#selectedAlchemyRecipe
        ? "A combinação exige validação, consumo e resultado do servidor; nenhum item foi alterado."
        : "Selecione uma receita antes de combinar.";
    });
    for (const button of this.#inventoryBags.querySelectorAll<HTMLButtonElement>("[data-inventory-bag]")) {
      button.addEventListener("click", () => {
        const bag = Number(button.dataset.inventoryBag);
        if (!Number.isInteger(bag) || bag < 0 || bag >= INVENTORY_BAG_COUNT) return;
        this.setActiveInventoryBag(bag);
      });
    }
    window.addEventListener("pointermove", this.inventoryPointerMove, { passive: false });
    window.addEventListener("pointerup", this.inventoryPointerUp, { passive: false });
    window.addEventListener("pointercancel", this.inventoryPointerCancel);
    document.querySelector<HTMLElement>("[data-character-close]")?.addEventListener("click", () => {
      this.toggleCharacter(false);
    });
    for (const attribute of PRIMARY_ATTRIBUTES) {
      document.querySelector<HTMLButtonElement>(`[data-character-attribute="${attribute}"]`)
        ?.addEventListener("click", () => this.#state?.allocatePrimaryAttribute(attribute));
    }
    document.querySelector<HTMLElement>("[data-skills-close]")?.addEventListener("click", () => {
      this.toggleSkills(false);
    });
    this.#skillClassSelect.addEventListener("change", () => {
      this.renderSkillCatalog();
      this.onSkillClassSelected?.(this.#skillClassSelect.value);
    });
    document.querySelector<HTMLButtonElement>("#hud-cc-button")?.addEventListener("click", () => {
      this.toggleAutoCombatPanel();
    });
    document.querySelector<HTMLButtonElement>("[data-cc-close]")?.addEventListener("click", () => {
      this.toggleAutoCombatPanel(false);
    });
    document.querySelector<HTMLButtonElement>("[data-cc-mode-cycle]")?.addEventListener("click", () => {
      this.onAutoCombatModeSelected?.(nextAutoCombatMode(this.#autoCombatMode));
    });
    document.querySelector<HTMLButtonElement>("#cc-recovery-cycle")?.addEventListener("click", () => {
      const next = this.#autoCombatRecoveryThreshold >= 90 ? 0 : this.#autoCombatRecoveryThreshold + 10;
      this.onAutoCombatRecoveryThresholdChanged?.(next);
    });
    document.querySelector<HTMLButtonElement>("#cc-mount-cycle")?.addEventListener("click", () => {
      const next = this.#autoCombatMountThreshold >= 90 ? 0 : this.#autoCombatMountThreshold + 10;
      this.onAutoCombatMountThresholdChanged?.(next);
    });
    document.querySelector<HTMLButtonElement>("#cc-position-cycle")?.addEventListener("click", () => {
      this.onAutoCombatPositionModeSelected?.(nextAutoCombatPositionMode(this.#autoCombatPositionMode));
    });
    document.querySelector<HTMLButtonElement>("#hud-menu-button")?.addEventListener("click", () => {
      this.toggleGameMenu();
    });
    document.querySelector<HTMLButtonElement>("[data-npc-interaction-close]")?.addEventListener("click", () => {
      this.requestNpcInteractionClose();
    });
    this.#groundPortalConfirm.addEventListener("click", () => {
      this.requestGroundPortalConfirm();
    });
    document.querySelector<HTMLButtonElement>("[data-ground-portal-cancel]")?.addEventListener("click", () => {
      this.requestGroundPortalClose();
    });
    this.#extractionPromptConfirm.addEventListener("click", () => {
      this.requestExtractionConfirm();
    });
    document.querySelector<HTMLButtonElement>("[data-extraction-cancel]")?.addEventListener("click", () => {
      this.closeExtractionPrompt(false);
    });
    document.querySelector<HTMLButtonElement>("[data-game-menu-close]")?.addEventListener("click", () => {
      this.toggleGameMenu(false);
    });
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-game-menu-action]")) {
      button.addEventListener("click", () => this.runGameMenuAction(button.dataset.gameMenuAction ?? ""));
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-chat-channel]")) {
      button.addEventListener("click", () => {
        const channel = parseChatChannel(button.dataset.chatChannel);
        if (channel) this.setChatChannel(channel);
      });
    }
    this.#chatChannelLabel.addEventListener("click", () => {
      const index = CHAT_CHANNELS.indexOf(this.#chatChannel);
      this.setChatChannel(CHAT_CHANNELS[(index + 1) % CHAT_CHANNELS.length] ?? "general");
      if (this.#chatShell.classList.contains("is-chatting")) this.#chatInput.focus();
    });
    this.#chatInput.addEventListener("keydown", this.chatInputKeyDown);
    window.addEventListener("keydown", this.chatGlobalKeyDown, true);
  }

  bindPlayer(state: PlayerState): void {
    this.#unsubscribe?.();
    this.#state = state;
    this.#unsubscribe = state.subscribe((snapshot) => this.renderPlayer(snapshot));
    void this.ensureItemIconCatalog();
  }

  setTarget(target: TargetHudSnapshot | null): void {
    this.#target.classList.toggle("is-visible", target !== null);
    if (!target) return;
    this.#target.classList.toggle("is-friendly", !target.hostile);
    this.#targetName.textContent = target.name.replaceAll("_", " ");
    this.#targetLevel.textContent = target.level ? `Lv. ${target.level}` : (target.hostile ? "MONSTRO" : "NPC");
    this.#targetHp.style.width = `${ratio(target.hp, target.maxHp) * 100}%`;
    setText("#target-hp-text", `${Math.max(0, target.hp)} / ${Math.max(0, target.maxHp)}`);
  }

  get npcInteractionVisible(): boolean {
    return this.#npcInteraction.classList.contains("is-visible");
  }

  openNpcInteraction(snapshot: ClassicMonsterSnapshot): void {
    if (this.#selectedInventorySource?.kind === "cargo") this.clearInventorySelection();
    this.#activeNpcInteractionKind = snapshot.interactionKind;
    const useInventoryAnchor = !this.#npcWindowDrag.userPositioned;
    this.#npcInteraction.classList.add("classic-window-layout-snap");
    if (useInventoryAnchor) this.#inventory.classList.add("classic-window-layout-snap");
    const presentation = NPC_INTERACTION_PRESENTATIONS[snapshot.interactionKind];
    this.#npcInteraction.classList.remove(...NPC_INTERACTION_KIND_CLASSES);
    this.#npcInteraction.classList.add(`is-${snapshot.interactionKind}`, "is-visible");
    this.#npcInteraction.setAttribute("aria-hidden", "false");
    this.#npcInteractionName.textContent = snapshot.name.replaceAll("_", " ");
    this.#npcInteractionKind.textContent = presentation.label;
    this.#npcInteractionMessage.textContent = presentation.message;
    this.#npcInteractionAuthorityTitle.textContent = presentation.authorityTitle;
    this.#npcInteractionAuthorityDetail.textContent = presentation.authorityDetail;
    this.#npcInteractionSource.textContent = [
      `Generator ${snapshot.generatorId}`,
      `template ${snapshot.templateIndex}:${snapshot.templateKey}`,
      `código ${snapshot.interactionCode}`,
      `head ${snapshot.headItemIndex}`,
    ].join(" · ");
    this.#activeNpcShopTemplateKey = snapshot.interactionKind === "shop"
      ? snapshot.templateKey
      : null;
    this.renderNpcInteractionSlots(snapshot.interactionKind);
    if (useInventoryAnchor) this.positionNpcBesideInventory();
    else this.#npcWindowDrag.clampToViewport();

    if (this.#npcAnchorSnapFrame) cancelAnimationFrame(this.#npcAnchorSnapFrame);
    this.#npcAnchorSnapFrame = requestAnimationFrame(() => {
      this.#npcAnchorSnapFrame = 0;
      this.#inventory.classList.remove("classic-window-layout-snap");
      this.#npcInteraction.classList.remove("classic-window-layout-snap");
    });
  }

  closeNpcInteraction(): void {
    if (this.#selectedInventorySource?.kind === "cargo") this.clearInventorySelection();
    this.#npcInteraction.classList.remove("is-visible");
    this.#npcInteraction.setAttribute("aria-hidden", "true");
    this.#activeNpcInteractionKind = "none";
    this.#activeNpcShopTemplateKey = null;
    this.#npcShopGrid.clear();
  }

  /** Clears stale stock and keeps the classic 40-cell shop grid mounted. */
  setNpcShopLoading(): void {
    if (!this.#activeNpcShopTemplateKey || !this.#npcInteraction.classList.contains("is-shop")) return;
    this.#npcShopGrid.setLoading();
    this.#npcInteractionMessage.textContent = "Carregando o estoque clássico deste NPC…";
    this.#npcInteractionAuthorityTitle.textContent = "Estoque clássico somente leitura";
    this.#npcInteractionAuthorityDetail.textContent =
      "O catálogo local preserva o Carry do NPC; comprar e vender continuam dependentes do servidor.";
  }

  /** Renders the recovered 27 Carry slots; the remaining 13 classic cells stay empty. */
  renderNpcShopCarry(carry: ClassicResolvedTemplateCarry): Promise<void> {
    if (
      !this.#activeNpcShopTemplateKey
      || carry.template.templateKey !== this.#activeNpcShopTemplateKey
      || !this.#npcInteraction.classList.contains("is-shop")
    ) {
      return Promise.resolve();
    }

    const itemCount = carry.slots.reduce((count, slot) => count + (slot.item ? 1 : 0), 0);
    this.#npcInteractionMessage.textContent = itemCount === 1
      ? "1 item recuperado do estoque clássico deste NPC."
      : `${itemCount} itens recuperados do estoque clássico deste NPC.`;
    this.#npcInteractionAuthorityTitle.textContent = "Estoque clássico somente leitura";
    this.#npcInteractionAuthorityDetail.textContent =
      "Itens e efeitos vêm de Carry/ItemList; os preços exibidos são estáticos e não autoritativos.";
    return this.#npcShopGrid.render(carry);
  }

  /** Leaves the 40 authored cells visible and reports a catalog-loading failure. */
  setNpcShopError(error: unknown = "Falha ao carregar o estoque clássico"): void {
    if (!this.#activeNpcShopTemplateKey || !this.#npcInteraction.classList.contains("is-shop")) return;
    this.#npcShopGrid.setError(error);
    const detail = error instanceof Error ? error.message : String(error);
    this.#npcInteractionMessage.textContent = `Não foi possível carregar o estoque: ${detail}`;
    this.#npcInteractionAuthorityTitle.textContent = "Estoque clássico indisponível";
    this.#npcInteractionAuthorityDetail.textContent =
      "Nenhuma compra, venda ou alteração de inventário foi executada.";
  }

  get groundPortalPromptVisible(): boolean {
    return this.#groundPortalPrompt.classList.contains("is-visible");
  }

  openGroundPortalPrompt(portal: ClassicGroundPortal): void {
    if (!this.groundPortalPromptVisible) {
      const focused = document.activeElement;
      this.#groundPortalPreviousFocus = focused instanceof HTMLElement
        && focused !== document.body
        && focused !== this.#chatInput
        ? focused
        : null;
    }

    this.closeChat(false);
    if (this.npcInteractionVisible) this.requestNpcInteractionClose();
    this.toggleGameMenu(false);
    this.toggleAutoCombatPanel(false);
    this.cancelInventoryPointerDrag();

    this.#activeGroundPortal = portal;
    const label = portal.labelPtBr?.trim() || `#${portal.messageStringId}`;
    this.#groundPortalPromptMessage.textContent = `Deseja ir para ${label}?`;

    const hasPrice = portal.price > 0;
    this.#groundPortalPromptPrice.textContent = hasPrice
      ? `A taxa de transferência é de ${Math.trunc(portal.price)} Bronze.`
      : "";
    this.#groundPortalPromptPrice.classList.toggle("is-visible", hasPrice);
    this.#groundPortalPromptPrice.setAttribute("aria-hidden", String(!hasPrice));
    this.#groundPortalPrompt.classList.add("is-visible");
    this.#groundPortalPrompt.setAttribute("aria-hidden", "false");
    this.#groundPortalConfirm.focus({ preventScroll: true });
  }

  closeGroundPortalPrompt(): void {
    if (!this.groundPortalPromptVisible && !this.#activeGroundPortal) return;
    this.#groundPortalPrompt.classList.remove("is-visible");
    this.#groundPortalPrompt.setAttribute("aria-hidden", "true");
    this.#groundPortalPromptPrice.classList.remove("is-visible");
    this.#groundPortalPromptPrice.setAttribute("aria-hidden", "true");
    this.#activeGroundPortal = null;

    const previousFocus = this.#groundPortalPreviousFocus;
    this.#groundPortalPreviousFocus = null;
    if (previousFocus?.isConnected && previousFocus.offsetParent !== null) {
      previousFocus.focus({ preventScroll: true });
    } else {
      this.#groundPortalConfirm.blur();
    }
  }

  toggleInventory(force?: boolean): boolean {
    const visible = force ?? !this.#inventory.classList.contains("is-visible");
    this.#inventory.classList.toggle("is-visible", visible);
    this.#inventoryPreview.classList.toggle("is-inventory-visible", visible);
    if (!visible) this.clearInventorySelection();
    return visible;
  }

  openAlchemy(): void {
    this.closeChat(false);
    this.toggleSkills(false);
    this.toggleGameMenu(false);
    this.toggleAutoCombatPanel(false);
    this.toggleInventory(true);
    this.#alchemyPanel.classList.add("is-visible");
    this.#alchemyPanel.setAttribute("aria-hidden", "false");
    this.#alchemyStatus.textContent = "Lendo as receitas de Mixlist.bin…";
    void Promise.all([
      this.ensureClassicAlchemyCatalog(),
      this.ensureClassicCommerceCatalog(),
      this.ensureItemIconCatalog(),
    ]).then(() => this.renderAlchemy());
  }

  closeAlchemy(): void {
    const wasVisible = this.#alchemyPanel.classList.contains("is-visible");
    this.#alchemyPanel.classList.remove("is-visible");
    this.#alchemyPanel.setAttribute("aria-hidden", "true");
    this.#selectedAlchemyRecipe = null;
    // SetVisibleMixPanel(0) also closes the inventory in the recovered client.
    if (wasVisible) this.toggleInventory(false);
  }

  armExtraction(): void {
    this.closeAlchemy();
    this.toggleSkills(false);
    this.toggleGameMenu(false);
    this.toggleAutoCombatPanel(false);
    this.toggleInventory(true);
    this.clearInventorySelection();
    this.#extractionArmed = true;
    this.#inventory.classList.add("is-extraction-armed");
    this.addLog("Extração: clique no item desejado dentro de uma das bolsas.", "system");
  }

  cancelExtraction(): void {
    this.closeExtractionPrompt(false);
    this.#extractionArmed = false;
    this.#inventory.classList.remove("is-extraction-armed");
  }

  toggleCharacter(force?: boolean): boolean {
    const visible = force ?? !this.#characterPanel.classList.contains("is-visible");
    this.#characterPanel.classList.toggle("is-visible", visible);
    this.#characterPanel.setAttribute("aria-hidden", String(!visible));
    return visible;
  }

  toggleSkills(force?: boolean): boolean {
    const visible = force ?? !this.#skillPanel.classList.contains("is-visible");
    this.#skillPanel.classList.toggle("is-visible", visible);
    if (visible) void this.ensureSkillCatalog();
    return visible;
  }

  toggleGameMenu(force?: boolean): boolean {
    const visible = force ?? !this.#gameMenu.classList.contains("is-visible");
    if (visible) this.toggleAutoCombatPanel(false);
    this.#gameMenu.classList.toggle("is-visible", visible);
    this.#gameMenu.setAttribute("aria-hidden", String(!visible));
    return visible;
  }

  toggleAutoCombatPanel(force?: boolean): boolean {
    const visible = force ?? !this.#ccPanel.classList.contains("is-visible");
    if (visible) this.toggleGameMenu(false);
    this.#ccPanel.classList.toggle("is-visible", visible);
    this.#ccPanel.setAttribute("aria-hidden", String(!visible));
    const button = document.querySelector<HTMLButtonElement>("#hud-cc-button");
    button?.setAttribute("aria-expanded", String(visible));
    if (visible) {
      this.addLog(
        `C.C · HP/MP ${this.#autoCombatRecoveryThreshold}% · montaria ${this.#autoCombatMountThreshold}%.`,
        "system",
      );
    }
    return visible;
  }

  addLog(message: string, tone: "normal" | "damage" | "reward" | "system" = "normal"): void {
    const line = document.createElement("p");
    line.className = `combat-log-line is-${tone}`;
    line.textContent = message;
    this.#combatLog.appendChild(line);
    this.trimChatLog();
  }

  addChatMessage(author: string, message: string, channel: ChatChannel = "general"): void {
    const text = message.trim();
    if (!text) return;
    const line = document.createElement("p");
    line.className = `combat-log-line is-chat is-chat-${channel}`;
    const prefix = document.createElement("strong");
    prefix.textContent = channel === "general"
      ? `[${author}]> `
      : `[${CHAT_CHANNEL_LABELS[channel]}] [${author}]> `;
    const content = document.createElement("span");
    content.textContent = text;
    line.append(prefix, content);
    this.#combatLog.appendChild(line);
    this.trimChatLog();
  }

  configureSkills(skills: readonly SkillHudEntry[], onUse: (slot: number) => void): void {
    this.#runtimeSkills = [...skills];
    this.#runtimeSkillIndices = new Set(skills.flatMap((skill) => (
      skill.classicIndex === undefined ? [] : [skill.classicIndex]
    )));
    for (let slot = 1; slot <= 9; slot++) {
      const button = document.querySelector<HTMLButtonElement>(`#skill-slot-${slot}`);
      if (!button) continue;
      const skill = skills.find((candidate) => candidate.slot === slot);
      const name = button.querySelector<HTMLElement>(".skill-name");
      const icon = button.querySelector<HTMLElement>(".quickslot-icon");
      if (!skill) {
        button.disabled = true;
        button.setAttribute("aria-label", `${slot} · espaço de skill vazio`);
        setGameTooltip(button, null);
        if (name) name.textContent = "";
        if (icon) {
          icon.classList.remove("is-classic-skill");
          icon.textContent = "";
          icon.style.removeProperty("--skill-icon-x");
          icon.style.removeProperty("--skill-icon-y");
        }
        button.onclick = null;
        this.setSkillCooldown(slot, 0, 0);
        continue;
      }
      button.disabled = false;
      button.setAttribute("aria-label", `${skill.slot} · ${skill.name} · ${skill.mana} MP`);
      setGameTooltip(button, skillTooltip(skill));
      if (name) name.textContent = skill.shortName;
      if (icon && skill.classicIndex !== undefined) {
        const iconIndex = Math.max(0, Math.min(152, Math.trunc(skill.classicIndex)));
        icon.classList.add("is-classic-skill");
        icon.textContent = "";
        icon.style.setProperty("--skill-icon-x", `${-(iconIndex % 16) * 21}px`);
        icon.style.setProperty("--skill-icon-y", `${-Math.floor(iconIndex / 16) * 21}px`);
      }
      button.onclick = () => onUse(skill.slot);
    }
    this.renderAutoCombatSkills();
    if (this.#skillCatalog) this.renderSkillCatalog();
  }

  setActiveSkillClass(classKey: string): void {
    this.#activeClassKey = classKey;
    if (this.#skillCatalog?.classes.some((entry) => entry.key === classKey)) {
      this.#skillClassSelect.value = classKey;
      this.renderSkillCatalog();
    }
  }

  setSkillCooldown(slot: number, remaining: number, ratioValue: number): void {
    const button = document.querySelector<HTMLButtonElement>(`#skill-slot-${slot}`);
    if (!button) return;
    const ratio = Math.max(0, Math.min(1, ratioValue));
    button.classList.toggle("is-cooling", remaining > 0.02);
    button.style.setProperty("--cooldown", String(ratio));
    const overlay = button.querySelector<HTMLElement>(".skill-cooldown");
    if (overlay) overlay.textContent = remaining > 0.05 ? remaining.toFixed(remaining < 1 ? 1 : 0) : "";
  }

  setBuffs(buffs: readonly BuffHudEntry[]): void {
    const signature = buffs
      .map((buff) => `${buff.classicIndex}:${Math.max(0, Math.ceil(buff.remainingSeconds))}`)
      .join("|");
    if (signature === this.#buffSignature) return;
    this.#buffSignature = signature;
    const current = new Map([...this.#buffStatus.querySelectorAll<HTMLElement>(".classic-buff")]
      .map((element) => [Number(element.dataset.buffIndex), element]));
    const entries = buffs.map((buff) => {
      const element = current.get(buff.classicIndex) ?? document.createElement("div");
      element.className = "classic-buff";
      element.dataset.buffIndex = String(buff.classicIndex);
      element.tabIndex = 0;
      element.setAttribute(
        "aria-label",
        `${buff.name}, ${Math.max(0, buff.remainingSeconds).toFixed(1)} segundos restantes`,
      );
      setGameTooltip(element, buffTooltip(buff));
      const icon = element.querySelector<HTMLElement>("i") ?? document.createElement("i");
      const iconIndex = Math.max(0, Math.min(152, Math.trunc(buff.iconIndex)));
      icon.style.setProperty("--buff-icon-x", `${-(iconIndex % 16) * 24}px`);
      icon.style.setProperty("--buff-icon-y", `${-Math.floor(iconIndex / 16) * 24}px`);
      const time = element.querySelector<HTMLElement>("small") ?? document.createElement("small");
      time.textContent = String(Math.max(0, Math.ceil(buff.remainingSeconds)));
      const ratio = buff.durationSeconds <= 0
        ? 0
        : Math.max(0, Math.min(1, buff.remainingSeconds / buff.durationSeconds));
      element.style.setProperty("--buff-remaining", String(ratio));
      if (!icon.isConnected || !time.isConnected) element.replaceChildren(icon, time);
      return element;
    });
    const sameOrder = entries.length === this.#buffStatus.children.length
      && entries.every((entry, index) => this.#buffStatus.children.item(index) === entry);
    if (!sameOrder) this.#buffStatus.replaceChildren(...entries);
    this.#buffStatus.classList.toggle("is-visible", entries.length > 0);
  }

  setAutoCombat(mode: AutoCombatMode, configuredSlots: readonly number[] = this.#autoCombatSkillSlots): void {
    this.#autoCombatMode = mode;
    const allowed = new Set(this.#runtimeSkills.filter(isMacroHudSkill).map((skill) => skill.slot));
    this.#autoCombatSkillSlots = configuredSlots
      .filter((slot, index, slots) => allowed.has(slot) && slots.indexOf(slot) === index)
      .slice(0, 10);
    const active = mode !== "off";
    const element = document.querySelector<HTMLElement>("#auto-combat");
    element?.classList.toggle("is-active", active);
    element?.setAttribute("data-cc-mode", mode);
    const label = element?.querySelector<HTMLElement>("span");
    if (label) label.textContent = AUTO_COMBAT_LABELS[mode].compact;
    const button = document.querySelector<HTMLButtonElement>("#hud-cc-button");
    button?.classList.toggle("is-active", active);
    button?.setAttribute("aria-pressed", String(active));
    button?.setAttribute("data-cc-mode", mode);
    if (button) button.title = `C.C · ${AUTO_COMBAT_LABELS[mode].title} · clique para configurar`;
    this.#ccPanel.setAttribute("data-cc-mode", mode);
    const modeButton = document.querySelector<HTMLButtonElement>("#cc-mode-cycle");
    if (modeButton) {
      modeButton.dataset.ccMode = mode;
      modeButton.setAttribute("aria-label", `Modo do C.C: ${AUTO_COMBAT_LABELS[mode].title}`);
      modeButton.title = `${AUTO_COMBAT_LABELS[mode].status} · clique para alternar`;
    }
    setText("#cc-mode-name", AUTO_COMBAT_LABELS[mode].title);
    setText("#cc-profile-status", AUTO_COMBAT_LABELS[mode].status);
    this.renderAutoCombatSkills();
  }

  setAutoCombatAuxiliary(
    recoveryThreshold: number,
    mountThreshold: number,
    positionMode: AutoCombatPositionMode,
  ): void {
    this.#autoCombatRecoveryThreshold = clampAutoCombatThreshold(recoveryThreshold);
    this.#autoCombatMountThreshold = clampAutoCombatThreshold(mountThreshold);
    this.#autoCombatPositionMode = positionMode;
    setText("#cc-recovery-value", String(this.#autoCombatRecoveryThreshold));
    setText("#cc-mount-value", String(this.#autoCombatMountThreshold));
    setText("#cc-position-name", AUTO_COMBAT_POSITION_LABELS[positionMode].title);
    const recovery = document.querySelector<HTMLButtonElement>("#cc-recovery-cycle");
    recovery?.setAttribute(
      "aria-label",
      `Recuperação automática em ${this.#autoCombatRecoveryThreshold} por cento`,
    );
    if (recovery) recovery.title = `HP/MP automático · ${this.#autoCombatRecoveryThreshold}%`;
    const mount = document.querySelector<HTMLButtonElement>("#cc-mount-cycle");
    mount?.setAttribute(
      "aria-label",
      `Montaria em ${this.#autoCombatMountThreshold} por cento`,
    );
    if (mount) mount.title = `HP/ração da montaria · ${this.#autoCombatMountThreshold}% · aguarda estado do servidor`;
    const position = document.querySelector<HTMLButtonElement>("#cc-position-cycle");
    if (position) {
      position.dataset.ccPosition = positionMode;
      position.setAttribute("aria-label", AUTO_COMBAT_POSITION_LABELS[positionMode].aria);
      position.title = AUTO_COMBAT_POSITION_LABELS[positionMode].aria;
    }
  }

  private renderAutoCombatSkills(): void {
    const candidates = this.#runtimeSkills
      .filter(isMacroHudSkill)
      .filter((skill, index, skills) => skills.findIndex((entry) => entry.slot === skill.slot) === index)
      .slice(0, 10);
    const bySlot = new Map(candidates.map((skill) => [skill.slot, skill]));
    const selectedSlots = this.#autoCombatSkillSlots.filter((slot) => bySlot.has(slot));
    const selected = new Set(selectedSlots);
    const ordered = [
      ...selectedSlots.flatMap((slot) => {
        const skill = bySlot.get(slot);
        return skill ? [skill] : [];
      }),
      ...candidates.filter((skill) => !selected.has(skill.slot)).sort((left, right) => left.slot - right.slot),
    ];
    setText("#cc-skill-count", `${selectedSlots.length} / 10`);
    if (ordered.length === 0) {
      const empty = document.createElement("p");
      empty.className = "cc-skill-empty";
      empty.textContent = "Esta barra não possui skills ofensivas disponíveis.";
      this.#ccSkillList.replaceChildren(empty);
      return;
    }

    const rows = ordered.map((skill) => {
      const enabled = selected.has(skill.slot);
      const selectedIndex = selectedSlots.indexOf(skill.slot);
      const row = document.createElement("article");
      row.className = `cc-skill-row${enabled ? " is-enabled" : ""}`;
      row.dataset.skillSlot = String(skill.slot);

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "cc-skill-toggle";
      toggle.setAttribute("aria-pressed", String(enabled));
      toggle.setAttribute("aria-label", `${enabled ? "Remover" : "Adicionar"} ${skill.name} da rotação`);
      toggle.title = toggle.getAttribute("aria-label") ?? "";
      toggle.textContent = enabled ? String(selectedIndex + 1) : "";
      toggle.addEventListener("click", () => {
        const next = enabled
          ? selectedSlots.filter((slot) => slot !== skill.slot)
          : [...selectedSlots, skill.slot].slice(0, 10);
        this.onAutoCombatSkillSlotsChanged?.(next);
      });

      const icon = document.createElement("i");
      icon.className = "cc-skill-icon";
      if (skill.classicIndex !== undefined) {
        const iconIndex = Math.max(0, Math.min(152, Math.trunc(skill.classicIndex)));
        icon.style.setProperty("--cc-skill-icon-x", `${-(iconIndex % 16) * 24}px`);
        icon.style.setProperty("--cc-skill-icon-y", `${-Math.floor(iconIndex / 16) * 24}px`);
      }

      const copy = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = skill.name;
      const details = document.createElement("small");
      details.textContent = `ATALHO ${skill.slot} · ${skill.mana} MP`;
      copy.append(name, details);

      const order = document.createElement("div");
      order.className = "cc-skill-order";
      const up = createMacroOrderButton("↑", `Subir ${skill.name}`, enabled && selectedIndex > 0, () => {
        const next = [...selectedSlots];
        [next[selectedIndex - 1], next[selectedIndex]] = [next[selectedIndex]!, next[selectedIndex - 1]!];
        this.onAutoCombatSkillSlotsChanged?.(next);
      });
      const down = createMacroOrderButton("↓", `Descer ${skill.name}`, enabled && selectedIndex < selectedSlots.length - 1, () => {
        const next = [...selectedSlots];
        [next[selectedIndex], next[selectedIndex + 1]] = [next[selectedIndex + 1]!, next[selectedIndex]!];
        this.onAutoCombatSkillSlotsChanged?.(next);
      });
      order.append(up, down);
      row.append(toggle, icon, copy, order);
      return row;
    });
    this.#ccSkillList.replaceChildren(...rows);
  }

  setMounted(active: boolean, name = "Javali"): void {
    const element = document.querySelector<HTMLElement>("#mount-status");
    element?.classList.toggle("is-active", active);
    const label = element?.querySelector<HTMLElement>("span");
    if (label) label.textContent = active ? name : "Montaria";
  }

  private async ensureSkillCatalog(): Promise<void> {
    if (this.#skillCatalog) {
      this.renderSkillCatalog();
      return;
    }
    if (this.#skillCatalogJob) return this.#skillCatalogJob;
    this.#skillCatalogStatus.textContent = "Lendo SkillData.bin…";
    const job = fetch("/game-data/classic/data/skills.json")
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        this.#skillCatalog = await response.json() as ClassicSkillCatalog;
        this.#skillClassSelect.replaceChildren(...this.#skillCatalog.classes.map((entry) => {
          const option = document.createElement("option");
          option.value = entry.key;
          option.textContent = entry.name;
          return option;
        }));
        this.#skillClassSelect.value = this.#skillCatalog.classes.some((entry) => entry.key === this.#activeClassKey)
          ? this.#activeClassKey
          : (this.#skillCatalog.classes[0]?.key ?? "");
        this.renderSkillCatalog();
      })
      .catch((error: unknown) => {
        console.warn("Catálogo clássico de skills indisponível", error);
        this.#skillCatalogStatus.textContent = "Execute bun run import:skills";
      })
      .finally(() => {
        this.#skillCatalogJob = null;
      });
    this.#skillCatalogJob = job;
    return job;
  }

  private renderSkillCatalog(): void {
    const catalog = this.#skillCatalog;
    if (!catalog) return;
    const selectedClass = catalog.classes.find((entry) => entry.key === this.#skillClassSelect.value)
      ?? catalog.classes[0];
    if (!selectedClass) return;
    const allowed = new Set([...selectedClass.skills, ...selectedClass.masterSkills]);
    const classSkills = catalog.skills.filter((skill) => allowed.has(skill.index));
    const specialIndexes = new Set(catalog.specialSkills
      ?? catalog.skills
        .filter((skill) => skill.category === "special" && skill.index <= 104)
        .map((skill) => skill.index));
    const specialSkills = catalog.skills
      .filter((skill) => specialIndexes.has(skill.index))
      .sort((left, right) => left.index - right.index);
    const alwaysLearned = new Set(catalog.alwaysLearnedSkills ?? [101]);
    const columns = [1, 2, 3].map((mastery) => {
      const column = document.createElement("section");
      column.className = "skill-mastery-column";
      const heading = document.createElement("h3");
      heading.textContent = selectedClass.masteries[mastery - 1] ?? `Linhagem ${mastery}`;
      column.appendChild(heading);
      const entries = classSkills
        .filter((skill) => skill.mastery === mastery)
        .sort((left, right) => (
          Number(left.category === "master") - Number(right.category === "master")
          || (left.masterySlot ?? 0) - (right.masterySlot ?? 0)
        ));
      for (const skill of entries) {
        const canUse = selectedClass.key === this.#activeClassKey && this.#runtimeSkillIndices.has(skill.index);
        const runtimeSkill = canUse
          ? this.#runtimeSkills.find((candidate) => candidate.classicIndex === skill.index)
          : undefined;
        column.appendChild(createSkillCatalogEntry(
          skill,
          false,
          canUse ? () => this.onCatalogSkillUse?.(skill.index) : undefined,
          runtimeSkill?.requiredWeaponType,
          CLASSIC_SKILL_RUNTIME_BLOCKERS[skill.index],
        ));
      }
      return column;
    });
    const specialColumn = document.createElement("section");
    specialColumn.className = "skill-mastery-column is-special";
    const specialHeading = document.createElement("h3");
    specialHeading.textContent = "Especiais / Passivas";
    specialColumn.appendChild(specialHeading);
    for (const skill of specialSkills) {
      const canUse = selectedClass.key === this.#activeClassKey && this.#runtimeSkillIndices.has(skill.index);
      specialColumn.appendChild(createSkillCatalogEntry(
        skill,
        alwaysLearned.has(skill.index),
        canUse ? () => this.onCatalogSkillUse?.(skill.index) : undefined,
        canUse
          ? this.#runtimeSkills.find((candidate) => candidate.classicIndex === skill.index)?.requiredWeaponType
          : undefined,
        CLASSIC_SKILL_RUNTIME_BLOCKERS[skill.index],
      ));
    }
    columns.push(specialColumn);
    this.#skillCatalogStatus.textContent = `${selectedClass.name} · ${classSkills.length + specialSkills.length} skills · dados do cliente clássico`;
    this.#skillCatalogGrid.replaceChildren(...columns);
  }

  private renderPlayer(snapshot: PlayerSnapshot): void {
    this.#lastSnapshot = snapshot;
    setText("#player-name", snapshot.name);
    setText("#player-level", `Lv. ${snapshot.level}`);
    setText("#player-hp-text", `${snapshot.hp} / ${snapshot.maxHp}`);
    setText("#player-mp-text", `${snapshot.mp} / ${snapshot.maxMp}`);
    setText("#player-exp-text", `${snapshot.experience} / ${snapshot.nextLevelExperience}`);
    setText("#player-coins", snapshot.coins.toLocaleString("pt-BR"));
    setWidth("#player-hp-fill", ratio(snapshot.hp, snapshot.maxHp));
    setWidth("#player-mp-fill", ratio(snapshot.mp, snapshot.maxMp));
    setWidth("#player-exp-fill", ratio(snapshot.experience, snapshot.nextLevelExperience));
    const playerPanel = document.querySelector<HTMLElement>(".player-status");
    playerPanel?.style.setProperty("--hp-empty", `${(1 - ratio(snapshot.hp, snapshot.maxHp)) * 100}%`);
    playerPanel?.style.setProperty("--mp-empty", `${(1 - ratio(snapshot.mp, snapshot.maxMp)) * 100}%`);
    const firstConsumable = snapshot.inventory.find((stack) => stack?.item.kind === "consumable");
    setText("#quickslot-1-count", firstConsumable ? String(firstConsumable.quantity) : "");
    this.renderCharacter(snapshot);
    this.updateInventory(snapshot);
    this.updateCargo(snapshot);
  }

  private renderCharacter(snapshot: PlayerSnapshot): void {
    setText("#character-name", snapshot.name);
    setText("#character-level", String(snapshot.level));
    setText("#character-points", String(snapshot.freeAttributePoints));
    setText("#character-exp-total", formatNumber(snapshot.totalExperience));
    setText("#character-exp-next", formatNumber(snapshot.nextLevelTotalExperience));
    setText("#character-exp-current", `${formatNumber(snapshot.experience)} / ${formatNumber(snapshot.nextLevelExperience)}`);
    setText("#character-hp", `${snapshot.hp} / ${snapshot.maxHp}`);
    setText("#character-mp", `${snapshot.mp} / ${snapshot.maxMp}`);
    setText("#character-attack", String(snapshot.attack));
    setText("#character-defense", String(snapshot.defense));
    setText("#character-coins", formatNumber(snapshot.coins));
    setText("#character-offline-note", `Frontend offline: +${snapshot.offlineAttributePointsPerLevel} pontos e +3 ATQ por nível`);
    for (const attribute of PRIMARY_ATTRIBUTES) {
      setText(`#character-${attribute}`, String(snapshot.primaryAttributes[attribute]));
      const button = document.querySelector<HTMLButtonElement>(`[data-character-attribute="${attribute}"]`);
      if (button) button.disabled = !snapshot.alive || snapshot.freeAttributePoints <= 0;
    }
    this.#characterPanel.classList.toggle("has-free-points", snapshot.freeAttributePoints > 0);
  }

  private ensureItemIconCatalog(): Promise<ClassicItemIconCatalog | null> {
    if (this.#itemIconCatalogJob) return this.#itemIconCatalogJob;
    this.#itemIconCatalogJob = fetch("/game-data/classic/ui/item-icons.json")
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const catalog = await response.json() as ClassicItemIconCatalog;
        if (
          catalog.cellSize !== 35
          || catalog.columns <= 0
          || catalog.iconsPerAtlas <= 0
          || !Array.isArray(catalog.atlases)
          || !Array.isArray(catalog.itemToIcon)
        ) {
          throw new Error("catálogo incompatível");
        }
        this.#itemIconCatalog = catalog;
        if (this.#lastSnapshot) this.updateInventory(this.#lastSnapshot, true);
        if (this.#lastSnapshot) this.updateCargo(this.#lastSnapshot, true);
        return catalog;
      })
      .catch((error: unknown) => {
        console.warn("Ícones clássicos do inventário indisponíveis", error);
        return null;
      });
    return this.#itemIconCatalogJob;
  }

  private setInventoryPreview(item: InventoryItem | null): void {
    this.#inventoryPreview.classList.toggle("has-item", item !== null);
    this.#inventoryPreview.setAttribute("aria-hidden", String(item === null));
    const fallback = document.querySelector<HTMLElement>("#inventory-preview-fallback");
    if (fallback) {
      const icon = item ? this.resolveInventoryIcon(item) : null;
      const scale = 3;
      fallback.style.backgroundImage = icon ? `url("/game-data/classic/ui/${icon.atlas}")` : "";
      fallback.style.backgroundPosition = icon
        ? `${-icon.column * icon.cellSize * scale}px ${-icon.row * icon.cellSize * scale}px`
        : "";
      fallback.style.backgroundSize = icon
        ? `${icon.columns * icon.cellSize * scale}px auto`
        : "";
      fallback.classList.toggle("has-classic-icon", icon !== null);
      fallback.textContent = icon || !item ? "" : item.name.slice(0, 2).toUpperCase();
    }
    this.onInventoryPreview?.(item);
  }

  private updateInventory(snapshot: PlayerSnapshot, force = false): void {
    const signature = inventorySnapshotSignature(snapshot.inventory, snapshot.equipment);
    if (!force && signature === this.#inventorySignature) return;
    this.#inventorySignature = signature;
    this.renderInventory(snapshot);
  }

  private updateCargo(snapshot: PlayerSnapshot, force = false): void {
    if (this.#activeNpcInteractionKind !== "cargo" || !this.npcInteractionVisible) return;
    const signature = `${this.#activeCargoPage}:${snapshot.cargo.map(inventoryStackSignature).join("|")}`;
    if (!force && signature === this.#cargoSignature) return;
    this.#cargoSignature = signature;
    this.renderCargo(snapshot);
  }

  private renderCargo(snapshot: PlayerSnapshot): void {
    const pageStart = this.#activeCargoPage * CARGO_PAGE_SIZE;
    const cells = Array.from({ length: CARGO_PAGE_SIZE }, (_, offset) => {
      const slot = pageStart + offset;
      const anchor = classicGridAnchorAt(snapshot.cargo, slot, CARGO_PAGE_SIZE, 5);
      const stack = anchor < 0 ? null : snapshot.cargo[anchor] ?? null;
      const cell = this.createCargoCell(anchor < 0 ? slot : anchor, stack);
      if (anchor >= 0 && anchor !== slot) {
        cell.replaceChildren();
        cell.classList.add("is-footprint-shadow");
        cell.setAttribute("aria-label", `${stack?.item.name ?? "Item"} ocupa este espaço`);
      }
      return cell;
    });
    this.#npcInteractionSlots.replaceChildren(...cells);
    this.#npcInteractionSlots.setAttribute("role", "grid");
    this.#npcInteractionSlots.setAttribute("aria-rowcount", "8");
    this.#npcInteractionSlots.setAttribute("aria-colcount", "5");
    this.#npcInteractionSlots.setAttribute(
      "aria-label",
      `Página ${this.#activeCargoPage + 1} do armazém offline, 40 espaços`,
    );
    this.#npcInteractionSlots.setAttribute("aria-hidden", "false");
    this.updateCargoPageButtons(snapshot);

    const selected = this.#selectedInventorySource;
    if (selected?.kind !== "cargo") return;
    const selectedStack = snapshot.cargo[selected.slot] ?? null;
    const selectedAnchor = this.findInventorySourceElement(selected);
    if (selectedStack?.item.key === this.#selectedInventoryItemKey && selectedAnchor) {
      selectedAnchor.classList.add("is-selected");
      selectedAnchor.setAttribute("aria-pressed", "true");
      this.setInventoryPreview(selectedStack.item);
    } else {
      this.clearInventorySelection();
    }
  }

  private createCargoCell(
    slot: number,
    stack: Readonly<InventoryStack> | null,
  ): HTMLButtonElement {
    const source = { kind: "cargo", slot } as const;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "npc-interaction-slot classic-cargo-cell";
    button.dataset.cargoSlot = String(slot);
    button.setAttribute("role", "gridcell");
    button.setAttribute("aria-rowindex", String(Math.floor((slot % CARGO_PAGE_SIZE) / 5) + 1));
    button.setAttribute("aria-colindex", String((slot % 5) + 1));

    if (!stack) {
      const label = `Espaço vazio ${slot % CARGO_PAGE_SIZE + 1} da página ${this.#activeCargoPage + 1}`;
      button.classList.add("is-empty");
      button.title = "Espaço vazio";
      button.setAttribute("aria-label", label);
      button.addEventListener("click", () => {
        if (this.consumeSuppressedInventoryClick()) return;
        this.handleInventoryCellClick(source, null, button);
      });
      return button;
    }

    button.classList.add("has-item", `rarity-${stack.item.rarity}`);
    button.setAttribute("aria-pressed", "false");
    button.setAttribute(
      "aria-label",
      `${stack.item.name}, quantidade ${stack.quantity}. ${stack.item.description}`,
    );
    setGameTooltip(button, this.inventoryTooltip(stack.item, stack.quantity));
    const icon = this.createInventoryIcon(stack.item);
    const quantity = document.createElement("small");
    quantity.textContent = stack.quantity > 1 ? String(stack.quantity) : "";
    const refinement = document.createElement("b");
    refinement.className = "inventory-item-refinement";
    refinement.textContent = stack.item.refinement ? `+${stack.item.refinement}` : "";
    refinement.classList.toggle("is-high", (stack.item.refinement ?? 0) > 9);
    button.append(icon, refinement, quantity);
    button.addEventListener("click", () => {
      if (this.consumeSuppressedInventoryClick()) return;
      this.handleInventoryCellClick(source, stack.item, button);
    });
    button.addEventListener("pointerdown", (event) => {
      this.beginInventoryPointerDrag(event, source, stack.item, button);
    });
    return button;
  }

  private updateCargoPageButtons(snapshot: PlayerSnapshot): void {
    for (const button of this.#cargoPageNav.querySelectorAll<HTMLButtonElement>("[data-cargo-page]")) {
      const page = Number(button.dataset.cargoPage);
      const used = classicGridOccupiedCellCount(snapshot.cargo, page, CARGO_PAGE_SIZE, 5);
      const active = page === this.#activeCargoPage;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      button.setAttribute("aria-label", `Abrir página ${page + 1}, ${used} de ${CARGO_PAGE_SIZE} espaços ocupados`);
      button.title = `Página ${page + 1} · ${used}/${CARGO_PAGE_SIZE}`;
    }
  }

  private setActiveCargoPage(page: number): void {
    if (page < 0 || page >= CARGO_PAGE_COUNT || page === this.#activeCargoPage) return;
    this.cancelInventoryPointerDrag();
    if (this.#selectedInventorySource?.kind === "cargo") this.clearInventorySelection();
    this.#activeCargoPage = page;
    this.#cargoSignature = "";
    if (this.#lastSnapshot) this.updateCargo(this.#lastSnapshot, true);
  }

  private renderInventory(snapshot: PlayerSnapshot): void {
    const bagStart = this.#activeInventoryBag * INVENTORY_BAG_SIZE;
    const bagCells = Array.from({ length: INVENTORY_BAG_SIZE }, (_, offset) => {
      const slot = bagStart + offset;
      const anchor = classicGridAnchorAt(snapshot.inventory, slot, INVENTORY_BAG_SIZE, 5);
      const stack = anchor < 0 ? null : snapshot.inventory[anchor] ?? null;
      const cell = this.createInventoryCell(
        { kind: "inventory", slot: anchor < 0 ? slot : anchor },
        stack,
      );
      if (anchor >= 0 && anchor !== slot) {
        cell.replaceChildren();
        cell.classList.add("is-footprint-shadow");
        cell.setAttribute("aria-label", `${stack?.item.name ?? "Item"} ocupa este espaço`);
      } else if (stack) {
        const footprint = classicItemGridFootprint(stack.item);
        cell.dataset.gridWidth = String(footprint.width);
        cell.dataset.gridHeight = String(footprint.height);
      }
      return cell;
    });
    const equipmentCells = EQUIPMENT_SLOTS.map((slot) => this.createInventoryCell(
      { kind: "equipment", slot },
      snapshot.equipment[slot],
    ));
    this.#inventoryGrid.replaceChildren(...bagCells);
    this.#inventoryEquipment.replaceChildren(...equipmentCells);
    this.updateInventoryBagButtons(snapshot);

    const selected = this.#selectedInventorySource;
    const selectedStack = selected ? inventoryStackAt(snapshot, selected) : null;
    const selectedAnchor = selected ? this.findInventorySourceElement(selected) : null;
    const selectedItem = selectedStack?.item.key === this.#selectedInventoryItemKey
      ? selectedStack.item
      : null;
    if (selectedItem) {
      if (selectedAnchor) {
        selectedAnchor.classList.add("is-selected");
        selectedAnchor.setAttribute("aria-pressed", "true");
      }
      this.setInventoryPreview(selectedItem);
    } else if (selected) {
      this.clearInventorySelection();
    }
  }

  private createInventoryCell(
    source: InventoryPanelItemSource,
    stack: Readonly<InventoryStack> | null,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = source.kind === "inventory" ? "inventory-slot" : "equipment-slot";
    if (source.kind === "inventory") {
      button.dataset.inventorySlot = String(source.slot);
    } else {
      button.dataset.equipmentSlot = source.slot;
    }
    if (!stack) {
      const label = source.kind === "inventory"
        ? `Espaço vazio ${source.slot % INVENTORY_BAG_SIZE + 1} da bolsa ${this.#activeInventoryBag + 1}`
        : `${EQUIPMENT_SLOT_LABELS[source.slot]} vazio`;
      button.setAttribute("aria-label", label);
      button.title = source.kind === "equipment" ? label : "Espaço vazio";
      button.addEventListener("click", () => {
        if (this.consumeSuppressedInventoryClick()) return;
        this.handleInventoryCellClick(source, null, button);
      });
      return button;
    }

    button.classList.add("has-item", `rarity-${stack.item.rarity}`);
    button.setAttribute(
      "aria-label",
      `${stack.item.name}, quantidade ${stack.quantity}. ${stack.item.description}`,
    );
    button.setAttribute("aria-pressed", "false");
    setGameTooltip(button, this.inventoryTooltip(stack.item, stack.quantity));

    const icon = this.createInventoryIcon(stack.item);
    const quantity = document.createElement("small");
    quantity.textContent = stack.quantity > 1 ? String(stack.quantity) : "";
    const refinement = document.createElement("b");
    refinement.className = "inventory-item-refinement";
    refinement.textContent = stack.item.refinement ? `+${stack.item.refinement}` : "";
    refinement.classList.toggle("is-high", (stack.item.refinement ?? 0) > 9);
    button.append(icon, refinement, quantity);

    button.addEventListener("click", () => {
      if (this.consumeSuppressedInventoryClick()) return;
      if (this.#extractionArmed && source.kind === "inventory") {
        this.openExtractionPrompt(source.slot, stack.item);
        return;
      }
      this.handleInventoryCellClick(source, stack.item, button);
    });
    button.addEventListener("pointerdown", (event) => {
      if (this.#extractionArmed && source.kind === "inventory") {
        event.preventDefault();
        return;
      }
      this.beginInventoryPointerDrag(event, source, stack.item, button);
    });
    button.addEventListener("dblclick", (event) => {
      event.preventDefault();
      if (this.#extractionArmed) return;
      if (source.kind === "inventory") {
        if (stack.item.kind === "equipment") {
          if (this.#state?.equipInventorySlot(source.slot)) {
            this.addLog(`${stack.item.name} equipado.`, "system");
          }
          return;
        }
        if (this.#state?.useInventorySlot(source.slot)) {
          this.addLog(`${stack.item.name} utilizado.`, "system");
        }
        return;
      }
      if (this.#state?.unequipEquipmentSlot(source.slot)) {
        this.addLog(`${stack.item.name} guardado no inventário.`, "system");
      }
    });
    return button;
  }

  private updateInventoryBagButtons(snapshot: PlayerSnapshot): void {
    for (const button of this.#inventoryBags.querySelectorAll<HTMLButtonElement>("[data-inventory-bag]")) {
      const bag = Number(button.dataset.inventoryBag);
      const used = classicGridOccupiedCellCount(snapshot.inventory, bag, INVENTORY_BAG_SIZE, 5);
      const active = bag === this.#activeInventoryBag;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      button.setAttribute("aria-label", `Abrir bolsa ${bag + 1}, ${used} de ${INVENTORY_BAG_SIZE} espaços ocupados`);
    }
  }

  private setActiveInventoryBag(bag: number): void {
    if (bag === this.#activeInventoryBag) return;
    this.cancelInventoryPointerDrag();
    this.#activeInventoryBag = bag;
    if (this.#lastSnapshot) this.renderInventory(this.#lastSnapshot);
  }

  private handleInventoryCellClick(
    destination: InventoryItemSource,
    destinationItem: InventoryItem | null,
    anchor: HTMLButtonElement,
  ): void {
    const selectedSource = this.#selectedInventorySource;
    if (selectedSource) {
      if (sameInventorySource(selectedSource, destination)) {
        this.clearInventorySelection();
        return;
      }
      const selectedItem = this.selectedInventoryItem();
      if (!selectedItem) {
        this.clearInventorySelection();
      } else {
        this.finishInventoryDrop(selectedSource, selectedItem, destination);
        return;
      }
    }
    if (destinationItem) this.selectInventoryItem(destination, destinationItem, anchor);
    else this.clearInventorySelection();
  }

  private selectInventoryItem(
    source: InventoryItemSource,
    item: InventoryItem,
    anchor: HTMLButtonElement,
    toggle = false,
  ): void {
    if (sameInventorySource(this.#selectedInventorySource, source) && this.#selectedInventoryItemKey === item.key) {
      if (toggle) {
        this.clearInventorySelection();
        return;
      }
      this.positionInventoryPreview(anchor);
      return;
    }
    this.#selectedInventorySource = source;
    this.#selectedInventoryItemKey = item.key;
    this.#inventory.classList.add("is-carrying");
    this.#npcInteraction.classList.add("is-carrying-item");
    for (const cell of this.inventorySourceElements()) {
      const selected = cell === anchor;
      cell.classList.toggle("is-selected", selected);
      if (cell.hasAttribute("aria-pressed")) cell.setAttribute("aria-pressed", String(selected));
    }
    this.positionInventoryPreview(anchor);
    this.setInventoryPreview(item);
  }

  private clearInventorySelection(): void {
    this.#selectedInventorySource = null;
    this.#selectedInventoryItemKey = null;
    this.#inventory.classList.remove("is-carrying");
    this.#npcInteraction.classList.remove("is-carrying-item");
    for (const cell of this.inventorySourceElements()) {
      if (!cell.classList.contains("is-selected")) continue;
      cell.classList.remove("is-selected");
      cell.setAttribute("aria-pressed", "false");
    }
    this.setInventoryPreview(null);
  }

  private selectedInventoryItem(): InventoryItem | null {
    const source = this.#selectedInventorySource;
    const snapshot = this.#lastSnapshot;
    if (!source || !snapshot) return null;
    const stack = inventoryStackAt(snapshot, source);
    return stack?.item.key === this.#selectedInventoryItemKey ? stack.item : null;
  }

  private findInventorySourceElement(source: InventoryItemSource): HTMLButtonElement | null {
    const selector = source.kind === "inventory"
      ? `[data-inventory-slot="${source.slot}"]`
      : source.kind === "cargo"
        ? `[data-cargo-slot="${source.slot}"]`
        : `[data-equipment-slot="${source.slot}"]`;
    const owner = source.kind === "cargo" ? this.#npcInteraction : this.#inventory;
    return owner.querySelector<HTMLButtonElement>(selector);
  }

  private inventorySourceElements(): readonly HTMLButtonElement[] {
    return [
      ...this.#inventory.querySelectorAll<HTMLButtonElement>(".inventory-slot, .equipment-slot"),
      ...this.#npcInteraction.querySelectorAll<HTMLButtonElement>(".classic-cargo-cell"),
    ];
  }

  private beginInventoryPointerDrag(
    event: PointerEvent,
    source: InventoryItemSource,
    item: InventoryItem,
    anchor: HTMLButtonElement,
  ): void {
    if (!event.isPrimary || event.button !== 0) return;
    this.cancelInventoryPointerDrag();
    this.#inventoryPointerDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      source,
      item,
      anchor,
      moved: false,
      ghost: null,
    };
    anchor.setPointerCapture?.(event.pointerId);
  }

  private readonly inventoryPointerMove = (event: PointerEvent): void => {
    const drag = this.#inventoryPointerDrag;
    if (!drag) {
      if (
        this.#selectedInventorySource
        && this.#inventory.classList.contains("is-visible")
        && event.pointerType !== "touch"
      ) {
        this.positionInventoryPreviewAt(event.clientX, event.clientY);
      }
      return;
    }
    if (drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 6) {
      drag.moved = true;
      drag.anchor.classList.add("is-drag-source");
      this.#inventory.classList.add("is-dragging");
      this.#npcInteraction.classList.add("is-item-dragging");
      this.clearInventorySelection();
      const ghostSource = this.findInventorySourceElement(drag.source) ?? drag.anchor;
      drag.ghost = ghostSource.cloneNode(true) as HTMLElement;
      drag.ghost.classList.remove("is-selected", "is-drag-source");
      drag.ghost.classList.add("inventory-drag-ghost");
      drag.ghost.removeAttribute("id");
      drag.ghost.setAttribute("aria-hidden", "true");
      document.body.appendChild(drag.ghost);
    }
    if (!drag.moved || !drag.ghost) return;
    event.preventDefault();
    drag.ghost.style.left = `${event.clientX + 9}px`;
    drag.ghost.style.top = `${event.clientY + 9}px`;
  };

  private readonly inventoryPointerUp = (event: PointerEvent): void => {
    const drag = this.#inventoryPointerDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved) {
      this.cancelInventoryPointerDrag();
      return;
    }
    event.preventDefault();
    this.#suppressInventoryClick = true;
    window.setTimeout(() => {
      this.#suppressInventoryClick = false;
    }, 0);
    const dropElement = document.elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-inventory-slot], [data-equipment-slot], [data-cargo-slot]") ?? null;
    const destination = dropElement ? inventorySourceFromElement(dropElement) : null;
    this.finishInventoryDrop(drag.source, drag.item, destination);
    this.cancelInventoryPointerDrag();
  };

  private readonly inventoryPointerCancel = (event: PointerEvent): void => {
    if (this.#inventoryPointerDrag?.pointerId === event.pointerId) this.cancelInventoryPointerDrag();
  };

  private finishInventoryDrop(
    source: InventoryItemSource,
    item: InventoryItem,
    destination: InventoryItemSource | null,
  ): boolean {
    if (!destination || sameInventorySource(source, destination)) return false;
    if (source.kind === "inventory" && destination.kind === "inventory") {
      const moved = this.#state?.moveInventoryItem(source.slot, destination.slot) ?? false;
      if (moved) this.addLog(`${item.name} movido.`, "system");
      return moved;
    }
    if (source.kind === "cargo" && destination.kind === "cargo") {
      const moved = this.#state?.moveCargoItem(source.slot, destination.slot) ?? false;
      if (moved) this.addLog(`${item.name} movido no armazém desta sessão.`, "system");
      return moved;
    }
    if (source.kind === "inventory" && destination.kind === "cargo") {
      const moved = this.#state?.transferInventoryToCargo(source.slot, destination.slot) ?? false;
      if (moved) this.addLog(`${item.name} guardado no armazém desta sessão.`, "system");
      return moved;
    }
    if (source.kind === "cargo" && destination.kind === "inventory") {
      const moved = this.#state?.transferCargoToInventory(source.slot, destination.slot) ?? false;
      if (moved) {
        this.addLog(
          `${item.name} retirado para a bolsa ${Math.floor(destination.slot / INVENTORY_BAG_SIZE) + 1}.`,
          "system",
        );
      }
      return moved;
    }
    if (source.kind === "inventory" && destination.kind === "equipment") {
      if (item.equipSlot !== destination.slot) {
        this.addLog(`${item.name} não pode ser equipado em ${EQUIPMENT_SLOT_LABELS[destination.slot]}.`, "system");
        return false;
      }
      const equipped = this.#state?.equipInventorySlot(source.slot) ?? false;
      if (equipped) this.addLog(`${item.name} equipado.`, "system");
      return equipped;
    }
    if (source.kind === "equipment" && destination.kind === "inventory") {
      const occupied = this.#lastSnapshot?.inventory[destination.slot] ?? null;
      if (occupied) {
        this.addLog("Escolha um espaço vazio para guardar o equipamento.", "system");
        return false;
      }
      const unequipped = this.#state?.unequipEquipmentSlot(source.slot, destination.slot) ?? false;
      if (unequipped) {
        this.addLog(`${item.name} guardado na bolsa ${Math.floor(destination.slot / INVENTORY_BAG_SIZE) + 1}.`, "system");
      }
      return unequipped;
    }
    if (source.kind === "equipment" || destination.kind === "equipment") {
      this.addLog("Retire o equipamento para uma bolsa antes de usar o armazém.", "system");
    }
    return false;
  }

  private cancelInventoryPointerDrag(): void {
    const drag = this.#inventoryPointerDrag;
    if (!drag) return;
    if (drag.anchor.hasPointerCapture?.(drag.pointerId)) drag.anchor.releasePointerCapture(drag.pointerId);
    drag.anchor.classList.remove("is-drag-source");
    drag.ghost?.remove();
    this.#inventory.classList.remove("is-dragging");
    this.#npcInteraction.classList.remove("is-item-dragging");
    this.#inventoryPointerDrag = null;
  }

  private consumeSuppressedInventoryClick(): boolean {
    if (!this.#suppressInventoryClick) return false;
    this.#suppressInventoryClick = false;
    return true;
  }

  private positionInventoryPreview(anchor: HTMLElement): void {
    const anchorRect = anchor.getBoundingClientRect();
    this.positionInventoryPreviewAt(
      anchorRect.left + anchorRect.width / 2,
      anchorRect.top + anchorRect.height / 2,
    );
  }

  private positionInventoryPreviewAt(clientX: number, clientY: number): void {
    const panelRect = this.#inventory.getBoundingClientRect();
    const scaleX = panelRect.width / Math.max(1, this.#inventory.offsetWidth);
    const scaleY = panelRect.height / Math.max(1, this.#inventory.offsetHeight);
    const left = (clientX - panelRect.left) / Math.max(scaleX, 0.001);
    const top = (clientY - panelRect.top) / Math.max(scaleY, 0.001);
    this.#inventoryPreview.style.setProperty("--inventory-preview-left", `${Math.round(left)}px`);
    this.#inventoryPreview.style.setProperty("--inventory-preview-top", `${Math.round(top)}px`);
  }

  private positionNpcBesideInventory(): void {
    if (!this.npcInteractionVisible || this.#npcWindowDrag.userPositioned) return;
    if (getComputedStyle(this.#inventory).visibility === "hidden") {
      this.#npcWindowDrag.clampToViewport();
      return;
    }

    const gap = 8;
    const padding = 4;
    const inventoryRect = this.#inventory.getBoundingClientRect();
    const npcRect = this.#npcInteraction.getBoundingClientRect();
    const leftCandidate = inventoryRect.left - gap - npcRect.width;
    const rightCandidate = inventoryRect.right + gap;
    let targetLeft = leftCandidate;

    if (leftCandidate < padding) {
      targetLeft = rightCandidate + npcRect.width <= window.innerWidth - padding
        ? rightCandidate
        : clamp(
          leftCandidate,
          padding,
          Math.max(padding, window.innerWidth - padding - npcRect.width),
        );
    }

    this.#npcWindowDrag.moveByViewport(
      targetLeft - npcRect.left,
      inventoryRect.top - npcRect.top,
    );
  }

  private readonly reflowNpcInteraction = (): void => {
    if (!this.npcInteractionVisible) return;
    if (this.#npcWindowDrag.userPositioned) this.#npcWindowDrag.clampToViewport();
    else this.positionNpcBesideInventory();
  };

  private renderNpcInteractionSlots(kind: ClassicNpcInteractionKind): void {
    this.#cargoSignature = "";
    this.#npcShopGrid.clear();
    this.#npcInteractionSlots.setAttribute("aria-hidden", String(kind !== "shop" && kind !== "cargo"));
    if (kind === "shop") {
      this.setNpcShopLoading();
      return;
    }
    if (kind === "cargo" && this.#lastSnapshot) this.updateCargo(this.#lastSnapshot, true);
  }

  private requestNpcInteractionClose(): void {
    if (!this.npcInteractionVisible) return;
    this.closeNpcInteraction();
    this.onNpcInteractionClose?.();
  }

  private requestGroundPortalConfirm(): void {
    const portal = this.#activeGroundPortal;
    if (!portal || !this.groundPortalPromptVisible) return;
    this.closeGroundPortalPrompt();
    this.onGroundPortalConfirm?.(portal);
  }

  private requestGroundPortalClose(): void {
    const portal = this.#activeGroundPortal;
    if (!portal || !this.groundPortalPromptVisible) return;
    this.closeGroundPortalPrompt();
    this.onGroundPortalClose?.(portal);
  }

  private openExtractionPrompt(slot: number, item: InventoryItem): void {
    if (!this.#extractionArmed) return;
    this.cancelInventoryPointerDrag();
    this.clearInventorySelection();
    this.#pendingExtraction = { slot, item };
    this.#extractionPromptMessage.textContent = `Deseja extrair ${item.name}?`;
    this.#extractionPrompt.classList.add("is-visible");
    this.#extractionPrompt.setAttribute("aria-hidden", "false");
    this.#extractionPromptConfirm.focus({ preventScroll: true });
  }

  private closeExtractionPrompt(cancelSelection: boolean): void {
    this.#extractionPrompt.classList.remove("is-visible");
    this.#extractionPrompt.setAttribute("aria-hidden", "true");
    this.#pendingExtraction = null;
    if (cancelSelection) this.cancelExtraction();
  }

  private requestExtractionConfirm(): void {
    const pending = this.#pendingExtraction;
    if (!pending || !this.#extractionPrompt.classList.contains("is-visible")) return;
    this.closeExtractionPrompt(false);
    this.#extractionArmed = false;
    this.#inventory.classList.remove("is-extraction-armed");
    this.onExtractionRequest?.(pending.slot, pending.item);
  }

  private readonly chatGlobalKeyDown = (event: KeyboardEvent): void => {
    if (this.#extractionPrompt.classList.contains("is-visible")) {
      if (event.code === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.requestExtractionConfirm();
        return;
      }
      if (event.code === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.closeExtractionPrompt(false);
      }
      return;
    }
    if (
      event.code === "Escape"
      && this.#extractionArmed
      && !isTextEntry(event.target)
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.cancelExtraction();
      this.addLog("Extração cancelada.", "system");
      return;
    }
    if (this.groundPortalPromptVisible) {
      const key = event.key.toLowerCase();
      if (event.code === "Enter" || key === "y") {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.requestGroundPortalConfirm();
        return;
      }
      if (event.code === "Escape" || key === "n") {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.requestGroundPortalClose();
        return;
      }
      if (event.code !== "Tab" && event.code !== "Space") {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (
      event.code === "Escape"
      && this.npcInteractionVisible
      && !isTextEntry(event.target)
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.requestNpcInteractionClose();
      return;
    }
    if (event.code === "Escape" && this.#ccPanel.classList.contains("is-visible")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.toggleAutoCombatPanel(false);
      return;
    }
    if (event.code === "Escape" && this.#gameMenu.classList.contains("is-visible")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.toggleGameMenu(false);
      return;
    }
    if (event.code !== "Enter" || event.repeat || isTextEntry(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.openChat();
  };

  private readonly chatInputKeyDown = (event: KeyboardEvent): void => {
    event.stopPropagation();
    if (event.code === "Escape") {
      event.preventDefault();
      this.closeChat(true);
      return;
    }
    if (event.code === "Enter") {
      event.preventDefault();
      this.submitChat();
      return;
    }
    if (event.code === "ArrowUp") {
      event.preventDefault();
      this.recallChatHistory(-1);
      return;
    }
    if (event.code === "ArrowDown") {
      event.preventDefault();
      this.recallChatHistory(1);
    }
  };

  private openChat(): void {
    this.toggleGameMenu(false);
    this.toggleAutoCombatPanel(false);
    this.#chatShell.classList.add("is-chatting");
    this.#chatHistoryCursor = this.#chatHistory.length;
    this.#chatInput.placeholder = "Digite a mensagem…";
    this.#chatInput.focus({ preventScroll: true });
  }

  private closeChat(clear: boolean): void {
    if (clear) this.#chatInput.value = "";
    this.#chatInput.blur();
    this.#chatShell.classList.remove("is-chatting");
    this.#chatInput.placeholder = "Pressione Enter para conversar";
    this.#chatHistoryCursor = this.#chatHistory.length;
  }

  private submitChat(): void {
    const raw = this.#chatInput.value.trim();
    if (!raw) {
      this.closeChat(true);
      return;
    }
    const parsed = parseClassicChatPrefix(raw, this.#chatChannel);
    if (!parsed.message) {
      this.closeChat(true);
      return;
    }
    this.setChatChannel(parsed.channel);
    if (this.#chatHistory.at(-1) !== raw) {
      this.#chatHistory.push(raw);
      while (this.#chatHistory.length > 5) this.#chatHistory.shift();
    }
    const author = this.#lastSnapshot?.name ?? "Jogador";
    if (this.onChatSubmit) this.onChatSubmit(parsed.message, parsed.channel);
    else this.addChatMessage(author, parsed.message, parsed.channel);
    this.closeChat(true);
  }

  private recallChatHistory(direction: -1 | 1): void {
    if (this.#chatHistory.length === 0) return;
    this.#chatHistoryCursor = Math.max(
      0,
      Math.min(this.#chatHistory.length, this.#chatHistoryCursor + direction),
    );
    this.#chatInput.value = this.#chatHistory[this.#chatHistoryCursor] ?? "";
    this.#chatInput.setSelectionRange(this.#chatInput.value.length, this.#chatInput.value.length);
  }

  private setChatChannel(channel: ChatChannel): void {
    this.#chatChannel = channel;
    this.#chatChannelLabel.textContent = CHAT_CHANNEL_LABELS[channel];
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-chat-channel]")) {
      const active = button.dataset.chatChannel === channel;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    }
  }

  private runGameMenuAction(action: string): void {
    this.toggleGameMenu(false);
    if (action === "character") this.toggleCharacter(true);
    if (action === "inventory") this.toggleInventory(true);
    if (action === "skills") this.toggleSkills(true);
    if (action === "macro") this.toggleAutoCombatPanel(true);
    if (action === "server") {
      this.addLog("Selecionar servidor aguarda a camada de rede.", "system");
    }
    if (action === "character-select") {
      this.addLog("Selecionar personagem aguarda sessão autoritativa do servidor.", "system");
    }
    if (action === "quit") {
      this.addLog("Encerrar a sessão ficará disponível com a camada de rede.", "system");
    }
  }

  private trimChatLog(): void {
    while (this.#combatLog.childElementCount > 10) this.#combatLog.firstElementChild?.remove();
  }

  private createInventoryIcon(item: InventoryItem): HTMLElement {
    const fallback = document.createElement("span");
    fallback.className = "inventory-item-mark";
    fallback.textContent = item.name.slice(0, 2).toUpperCase();
    const resolved = item.classicIndex === undefined ? null : this.resolveClassicItemIcon(item.classicIndex);
    if (!resolved) return fallback;
    const icon = document.createElement("span");
    icon.className = "inventory-item-icon";
    icon.style.backgroundImage = `url("/game-data/classic/ui/${resolved.atlas}")`;
    icon.style.backgroundPosition = `${-resolved.column * resolved.cellSize}px ${-resolved.row * resolved.cellSize}px`;
    icon.setAttribute("aria-hidden", "true");
    return icon;
  }

  private resolveInventoryIcon(item: InventoryItem): {
    readonly atlas: string;
    readonly column: number;
    readonly row: number;
    readonly cellSize: number;
    readonly columns: number;
  } | null {
    return item.classicIndex === undefined ? null : this.resolveClassicItemIcon(item.classicIndex);
  }

  private resolveClassicItemIcon(itemIndex: number): {
    readonly atlas: string;
    readonly column: number;
    readonly row: number;
    readonly cellSize: number;
    readonly columns: number;
  } | null {
    const catalog = this.#itemIconCatalog;
    if (!catalog) return null;
    const globalIndex = catalog.itemToIcon[itemIndex] ?? -1;
    if (globalIndex < 0) return null;
    const atlasIndex = Math.floor(globalIndex / catalog.iconsPerAtlas);
    const atlas = catalog.atlases[atlasIndex];
    if (!atlas) return null;
    const localIndex = globalIndex % catalog.iconsPerAtlas;
    return {
      atlas,
      column: localIndex % catalog.columns,
      row: Math.floor(localIndex / catalog.columns),
      cellSize: catalog.cellSize,
      columns: catalog.columns,
    };
  }

  private createClassicItemIcon(itemIndex: number, fallbackName: string): HTMLElement {
    const resolved = this.resolveClassicItemIcon(itemIndex);
    if (!resolved) {
      const fallback = document.createElement("span");
      fallback.className = "inventory-item-mark";
      fallback.textContent = fallbackName.slice(0, 2).toUpperCase();
      return fallback;
    }
    const icon = document.createElement("span");
    icon.className = "inventory-item-icon";
    icon.style.backgroundImage = `url("/game-data/classic/ui/${resolved.atlas}")`;
    icon.style.backgroundPosition = `${-resolved.column * resolved.cellSize}px ${-resolved.row * resolved.cellSize}px`;
    icon.setAttribute("aria-hidden", "true");
    return icon;
  }

  private renderAlchemy(): void {
    const alchemy = this.#classicAlchemyCatalog;
    const commerce = this.#classicCommerceCatalog;
    if (!alchemy || !commerce || !this.#itemIconCatalog) {
      this.#alchemyStatus.textContent = "Falha ao carregar os dados clássicos de alquimia.";
      return;
    }
    const recipes = alchemy.huntressRecipes();
    const cells = Array.from({ length: 24 }, (_, index) => {
      const recipe = recipes[index] ?? null;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `alchemy-result${recipe ? "" : " is-empty"}`;
      if (!recipe) {
        button.disabled = true;
        button.setAttribute("aria-label", "Receita vazia");
        return button;
      }
      const item = commerce.item(recipe.result.itemIndex);
      const name = item?.name || `Item #${recipe.result.itemIndex}`;
      button.append(this.createClassicItemIcon(recipe.result.itemIndex, name));
      button.setAttribute("aria-label", `Selecionar ${name}`);
      button.title = name;
      button.addEventListener("click", () => this.selectAlchemyRecipe(recipe, button));
      return button;
    });
    this.#alchemyResults.replaceChildren(...cells);
    this.#alchemyRequirements.replaceChildren();
    this.#alchemyCost.textContent = "0";
    this.#selectedAlchemyRecipe = null;
    this.#alchemyStatus.textContent = `${recipes.length} receitas de Alquimia recuperadas do cliente 7.54.`;
  }

  private selectAlchemyRecipe(recipe: ClassicAlchemyRecipe, anchor: HTMLButtonElement): void {
    const alchemy = this.#classicAlchemyCatalog;
    const commerce = this.#classicCommerceCatalog;
    if (!alchemy || !commerce) return;
    this.#selectedAlchemyRecipe = recipe;
    for (const button of this.#alchemyResults.querySelectorAll(".alchemy-result")) {
      button.classList.toggle("is-selected", button === anchor);
    }
    const requirements = recipe.requirements.slice(0, 8).map((requirement) => {
      const need = requirement.access === 0 ? null : alchemy.need(requirement.index);
      const itemIndex = requirement.access === 0
        ? requirement.index
        : (need?.item.itemIndex || need?.acceptedItemIndices[0] || 0);
      const item = itemIndex > 0 ? commerce.item(itemIndex) : null;
      const name = item?.name
        || (requirement.access === 2 ? `Sublista #${requirement.index}` : `Requisito #${requirement.index}`);
      const row = document.createElement("div");
      row.className = "alchemy-requirement";
      const icon = document.createElement("span");
      icon.className = "alchemy-requirement-icon";
      if (itemIndex > 0) icon.append(this.createClassicItemIcon(itemIndex, name));
      const copy = document.createElement("span");
      copy.textContent = name;
      const quantity = document.createElement("small");
      quantity.textContent = `0 / ${Math.max(1, need?.quantity ?? 1)}`;
      copy.append(quantity);
      row.append(icon, copy);
      return row;
    });
    this.#alchemyRequirements.replaceChildren(...requirements);
    this.#alchemyCost.textContent = formatNumber(recipe.cost);
    const result = commerce.item(recipe.result.itemIndex);
    this.#alchemyStatus.textContent =
      `${result?.name || `Item #${recipe.result.itemIndex}`} selecionado · resultado somente leitura.`;
  }

  private ensureClassicAlchemyCatalog(): Promise<ClassicAlchemyCatalog | null> {
    if (this.#classicAlchemyCatalog) return Promise.resolve(this.#classicAlchemyCatalog);
    if (this.#classicAlchemyCatalogJob) return this.#classicAlchemyCatalogJob;
    const job = import("../game/items/ClassicAlchemyCatalog")
      .then(({ loadClassicAlchemyCatalog }) => loadClassicAlchemyCatalog())
      .then((catalog) => {
        this.#classicAlchemyCatalog = catalog;
        return catalog;
      })
      .catch((error: unknown) => {
        console.warn("Falha ao carregar Mixlist.bin", error);
        return null;
      });
    this.#classicAlchemyCatalogJob = job;
    return job;
  }

  private inventoryTooltip(item: InventoryItem, quantity: number): GameTooltipContent {
    const classicMetadata = item.classicIndex === undefined
      ? null
      : this.#classicCommerceCatalog?.item(item.classicIndex) ?? null;
    if (!classicMetadata) void this.ensureClassicCommerceCatalog();
    return classicInventoryItemTooltip({
      item,
      quantity,
      metadata: classicMetadata,
      player: this.#lastSnapshot,
      activeClassKey: this.#activeClassKey,
    });
  }

  private ensureClassicCommerceCatalog(): Promise<ClassicCommerceCatalog | null> {
    if (this.#classicCommerceCatalog) return Promise.resolve(this.#classicCommerceCatalog);
    if (this.#classicCommerceCatalogJob) return this.#classicCommerceCatalogJob;
    const job = loadClassicCommerceCatalog()
      .then((catalog) => {
        this.#classicCommerceCatalog = catalog;
        if (this.#lastSnapshot) {
          this.updateInventory(this.#lastSnapshot, true);
          this.updateCargo(this.#lastSnapshot, true);
        }
        return catalog;
      })
      .catch((error: unknown) => {
        console.warn("Falha ao carregar catálogo clássico de comércio", error);
        return null;
      });
    this.#classicCommerceCatalogJob = job;
    return job;
  }
}

function createSkillCatalogEntry(
  skill: ClassicSkillCatalogEntry,
  learned = false,
  onUse?: () => void,
  requiredWeaponType?: number,
  blockedReason?: string,
): HTMLElement {
  const entry = document.createElement("article");
  entry.className = `skill-catalog-entry is-${skill.kind}${skill.category === "master" ? " is-master" : ""}${learned ? " is-learned" : ""}${onUse ? " is-castable" : ""}${blockedReason ? " is-server-blocked" : ""}`;
  entry.tabIndex = 0;
  setGameTooltip(entry, catalogSkillTooltip(skill, requiredWeaponType, blockedReason));
  const icon = document.createElement("i");
  if (skill.iconIndex !== null) {
    const iconIndex = Math.max(0, Math.min(152, Math.trunc(skill.iconIndex)));
    icon.style.setProperty("--catalog-icon-x", `${-(iconIndex % 16) * 32}px`);
    icon.style.setProperty("--catalog-icon-y", `${-Math.floor(iconIndex / 16) * 32}px`);
  } else {
    icon.classList.add("is-missing");
  }
  const copy = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = skill.name;
  const details = document.createElement("small");
  const kind = skill.kind === "active" ? "ATIVA" : (skill.kind === "buff" ? "BUFF" : "PASSIVA");
  details.textContent = `${kind}${learned ? " · APRENDIDA" : ""} · MP ${skill.manaSpent} · CD ${skill.delaySeconds}s · R ${skill.range}${onUse ? " · USAR" : ""}${blockedReason ? " · SERVIDOR" : ""}`;
  copy.append(name, details);
  const index = document.createElement("b");
  index.textContent = `#${skill.index}`;
  entry.append(icon, copy, index);
  if (onUse) {
    entry.setAttribute("role", "button");
    entry.setAttribute("aria-label", `Usar ${skill.name}`);
    entry.addEventListener("click", onUse);
    entry.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onUse();
    });
  } else {
    entry.setAttribute("aria-label", `${skill.name}, ${kind.toLocaleLowerCase("pt-BR")}`);
  }
  return entry;
}

function skillTooltip(skill: SkillHudEntry): GameTooltipContent {
  const lines = [
    `Atalho: ${skill.slot}`,
    `Tipo: ${skillKindLabel(skill.kind, skill.offensive)}`,
    `Custo: ${skill.mana} MP`,
  ];
  if (skill.cooldownSeconds !== undefined) lines.push(`Recarga: ${formatDuration(skill.cooldownSeconds)}`);
  if (skill.range !== undefined) lines.push(`Alcance: ${skill.range}`);
  if (skill.runtimeDurationSeconds !== undefined && skill.runtimeDurationSeconds > 0) {
    lines.push(`Duração: ${formatDuration(skill.runtimeDurationSeconds)}`);
  }
  if (skill.target) {
    const target = skill.target === "self"
      ? "próprio personagem"
      : (skill.target === "ground" ? "posição no terreno" : "inimigo");
    lines.push(`Alvo: ${target}`);
  }
  if (skill.requiredWeaponType !== undefined) {
    lines.push(`Arma exigida: ${classicWeaponTypeLabel(skill.requiredWeaponType)}`);
  }
  if (skill.classicIndex !== undefined) lines.push(`Skill clássica: #${skill.classicIndex}`);
  return {
    title: skill.name,
    description: skill.offensive ? "Skill ofensiva da barra ativa." : "Skill da barra ativa.",
    lines,
    tone: "skill",
  };
}

function classicWeaponTypeLabel(weaponType: number): string {
  if (weaponType === 41) return "Garras (WTYPE 41)";
  if (weaponType === 101) return "Arco (WTYPE 101)";
  return `WTYPE ${weaponType}`;
}

function catalogSkillTooltip(
  skill: ClassicSkillCatalogEntry,
  requiredWeaponType?: number,
  blockedReason?: string,
): GameTooltipContent {
  const kind = skill.kind === "active" ? "Ativa" : skill.kind === "buff" ? "Buff" : "Passiva";
  const category = skill.category === "master" ? "Mestre" : skill.category === "special" ? "Especial" : "Classe";
  const lines = [
    `Custo: ${skill.manaSpent} MP`,
    `Recarga: ${formatDuration(skill.delaySeconds)}`,
    `Alcance: ${skill.range}`,
  ];
  if ((skill.affectTimeSeconds ?? 0) > 0) lines.push(`Duração clássica: ${formatDuration(skill.affectTimeSeconds ?? 0)}`);
  if (requiredWeaponType !== undefined) {
    lines.push(`Arma exigida: ${classicWeaponTypeLabel(requiredWeaponType)}`);
  }
  if (blockedReason) lines.push(`Bloqueio atual: ${blockedReason}`);
  return {
    title: `${skill.name} · #${skill.index}`,
    description: `${kind} · ${category}`,
    lines,
    tone: skill.kind === "buff" ? "buff" : "skill",
  };
}

function buffTooltip(buff: BuffHudEntry): GameTooltipContent {
  const lines = [
    `Restante: ${formatDuration(Math.max(0, buff.remainingSeconds))}`,
    `Duração total: ${formatDuration(Math.max(0, buff.durationSeconds))}`,
    `Buff clássico: #${buff.classicIndex}`,
  ];
  if (buff.classKey) lines.push(`Classe de origem: ${buff.classKey}`);
  if ((buff.affectType ?? 0) !== 0 || (buff.affectValue ?? 0) !== 0) {
    lines.push(`Efeito clássico: #${buff.affectType ?? 0} = ${buff.affectValue ?? 0}`);
  }
  return {
    title: buff.name,
    description: "Buff ativo no personagem.",
    lines,
    tone: "buff",
  };
}

function inventoryItemTooltip(item: InventoryItem, quantity: number): GameTooltipContent {
  const lines = [
    `Tipo: ${inventoryItemKindLabel(item)}`,
    `Raridade: ${ITEM_RARITY_LABELS[item.rarity]}`,
  ];
  if (item.maxStack > 1 || quantity > 1) lines.push(`Quantidade: ${quantity} / ${item.maxStack}`);
  if (item.refinement !== undefined && item.refinement > 0) lines.push(`Refinação: +${item.refinement}`);
  if (item.ancient) lines.push("Ancient: ativo");
  if (item.heal !== undefined && item.heal > 0) lines.push(`Recuperação: +${item.heal} HP`);
  if (item.mana !== undefined && item.mana > 0) lines.push(`Recuperação: +${item.mana} MP`);
  if (item.value > 0) lines.push(`Valor: ${formatNumber(item.value)}`);
  if (item.classicIndex !== undefined) lines.push(`Item clássico: #${item.classicIndex}`);
  return {
    title: item.name,
    description: item.description,
    lines,
    tone: `item-${item.rarity}`,
  };
}

function skillKindLabel(kind: string | undefined, offensive: boolean | undefined): string {
  if (kind === "buff") return "Buff";
  if (kind === "summon") return "Evocação";
  if (kind === "area") return "Ataque em área";
  if (kind === "volley") return "Disparos múltiplos";
  if (kind === "cone") return "Ataque em cone";
  if (kind === "shadow") return "Ataque de sombra";
  if (kind === "direct") return "Ataque direto";
  if (kind === "utility") return "Utilidade";
  return offensive ? "Ofensiva" : "Ativa";
}

function inventoryItemKindLabel(item: InventoryItem): string {
  if (item.kind === "consumable") return "Consumível";
  if (item.kind === "material") return "Material";
  if (item.kind === "quest") return "Missão";
  return item.equipSlot ? `Equipamento · ${EQUIPMENT_SLOT_LABELS[item.equipSlot]}` : "Equipamento";
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, seconds);
  if (safe >= 60 && Number.isInteger(safe / 60)) return `${safe / 60} min`;
  return `${safe.toLocaleString("pt-BR", { maximumFractionDigits: safe < 10 ? 1 : 0 })} s`;
}

function createMacroOrderButton(
  label: string,
  ariaLabel: string,
  enabled: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.disabled = !enabled;
  button.setAttribute("aria-label", ariaLabel);
  button.title = ariaLabel;
  if (enabled) button.addEventListener("click", onClick);
  return button;
}

function isMacroHudSkill(skill: SkillHudEntry): boolean {
  return skill.slot >= 1 && skill.slot <= 9 && skill.offensive === true;
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`HUD: elemento ${selector} ausente`);
  return element;
}

function requirePanelHandle(panel: HTMLElement, selector: string): HTMLElement {
  const handle = panel.querySelector<HTMLElement>(selector);
  if (!handle) throw new Error(`HUD: cabeçalho ${selector} ausente em #${panel.id}`);
  return handle;
}

function setText(selector: string, value: string): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (element) element.textContent = value;
}

function setWidth(selector: string, value: number): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (element) element.style.width = `${value * 100}%`;
}

function ratio(value: number, maximum: number): number {
  return maximum <= 0 ? 0 : Math.max(0, Math.min(1, value / maximum));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

const PRIMARY_ATTRIBUTES = ["str", "int", "dex", "con"] as const satisfies readonly PrimaryAttribute[];
const CHAT_CHANNELS = ["general", "party", "guild"] as const satisfies readonly ChatChannel[];
const CHAT_CHANNEL_LABELS: Readonly<Record<ChatChannel, string>> = {
  general: "Todos",
  party: "Grupo",
  guild: "Guild",
};
const NPC_INTERACTION_KINDS = [
  "none",
  "shop",
  "cargo",
  "quest",
  "mix",
  "premium",
  "special",
] as const satisfies readonly ClassicNpcInteractionKind[];
const NPC_INTERACTION_KIND_CLASSES = NPC_INTERACTION_KINDS.map((kind) => `is-${kind}`);
const NPC_INTERACTION_PRESENTATIONS: Readonly<Record<ClassicNpcInteractionKind, {
  readonly label: string;
  readonly message: string;
  readonly authorityTitle: string;
  readonly authorityDetail: string;
}>> = {
  none: {
    label: "NPC",
    message: "Nenhuma ação clássica foi associada a este NPC pelos dados importados.",
    authorityTitle: "Interação sem conteúdo local",
    authorityDetail: "Nenhuma fala foi criada para substituir dados ausentes.",
  },
  shop: {
    label: "LOJA",
    message: "O catálogo da loja não está disponível no modo offline.",
    authorityTitle: "Loja somente leitura",
    authorityDetail: "Itens, quantidades e preços aguardam a resposta autoritativa do servidor.",
  },
  cargo: {
    label: "CARGO",
    message: "Armazém offline desta sessão — reinicia ao recarregar",
    authorityTitle: "Armazém local · 3 páginas × 40 slots",
    authorityDetail: "Os movimentos são locais e atômicos; sem gold, taxa, persistência ou regra inventada.",
  },
  quest: {
    label: "MISSÃO",
    message: "O estado e o texto desta missão aguardam dados autoritativos do servidor.",
    authorityTitle: "Missão identificada pelo cliente",
    authorityDetail: "Nenhum objetivo, recompensa ou fala foi inferido localmente.",
  },
  mix: {
    label: "COMBINAÇÃO",
    message: "Esta combinação depende das regras e do estado enviados pelo servidor clássico.",
    authorityTitle: "Serviço de combinação identificado",
    authorityDetail: "A operação permanece indisponível e não altera itens no modo offline.",
  },
  premium: {
    label: "PREMIUM",
    message: "Este serviço premium não possui autoridade no modo offline.",
    authorityTitle: "Serviço premium identificado",
    authorityDetail: "Nenhuma ação ou custo foi simulado sem os dados do servidor.",
  },
  special: {
    label: "SERVIÇO",
    message: "O cliente clássico escolhe esta ação usando também região e estado do servidor.",
    authorityTitle: "Interação especial identificada",
    authorityDetail: "A ação permanece somente leitura para evitar inventar comportamento.",
  },
};
const AUTO_COMBAT_LABELS: Readonly<Record<AutoCombatMode, {
  readonly compact: string;
  readonly title: string;
  readonly status: string;
}>> = {
  off: { compact: "C.C OFF", title: "desligado", status: "C.C desligado" },
  physical: { compact: "C.C FÍSICO", title: "dano físico", status: "Modo 1 · ataque físico automático" },
  magic: { compact: "C.C MÁGICO", title: "mágico", status: "Modo 2 · rotação de skills da barra" },
  support: { compact: "C.C SUPORTE", title: "suporte", status: "Modo 3 · buffs e recuperação, sem ataque" },
};
const AUTO_COMBAT_POSITION_LABELS: Readonly<Record<AutoCombatPositionMode, {
  readonly title: string;
  readonly aria: string;
}>> = {
  continuous: { title: "Contínua", aria: "Movimentação contínua" },
  fixed: { title: "Fixa", aria: "Movimentação fixa na posição atual" },
  stationary: { title: "Parada", aria: "Movimentação parada" },
};

function clampAutoCombatThreshold(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(90, Math.round(value / 10) * 10));
}
const EQUIPMENT_SLOT_LABELS: Readonly<Record<EquipmentSlot, string>> = {
  helmet: "Elmo",
  armor: "Armadura",
  pants: "Calça",
  gloves: "Luva",
  boots: "Bota",
  leftHand: "Mão esquerda",
  rightHand: "Mão direita",
  ring: "Anel",
  necklace: "Colar",
  orb: "Orbe",
  cabuncle: "Cabúnculo",
  costume: "Traje",
  familiar: "Familiar",
  mount: "Montaria",
  cape: "Mantua",
};
const ITEM_RARITY_LABELS: Readonly<Record<InventoryItem["rarity"], string>> = {
  common: "Comum",
  uncommon: "Incomum",
  rare: "Raro",
  epic: "Épico",
};

function parseChatChannel(value: string | undefined): ChatChannel | null {
  return CHAT_CHANNELS.find((channel) => channel === value) ?? null;
}

/** Prefixos mantidos pelo SEditableText clássico: '=' grupo e '-' guild. */
function parseClassicChatPrefix(
  raw: string,
  fallback: ChatChannel,
): { readonly channel: ChatChannel; readonly message: string } {
  if (raw.startsWith("=")) return { channel: "party", message: raw.slice(1).trim() };
  if (raw.startsWith("-")) return { channel: "guild", message: raw.replace(/^-{1,2}/, "").trim() };
  return { channel: fallback, message: raw };
}

function isTextEntry(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable);
}

function formatNumber(value: number): string {
  return Math.max(0, Math.trunc(value)).toLocaleString("pt-BR");
}

function sameInventorySource(
  left: InventoryItemSource | null,
  right: InventoryItemSource | null,
): boolean {
  return left?.kind === right?.kind && left?.slot === right?.slot;
}

function inventorySourceFromElement(element: HTMLElement): InventoryItemSource | null {
  if (element.dataset.inventorySlot !== undefined) {
    const slot = Number(element.dataset.inventorySlot);
    return Number.isInteger(slot) ? { kind: "inventory", slot } : null;
  }
  if (element.dataset.cargoSlot !== undefined) {
    const slot = Number(element.dataset.cargoSlot);
    return Number.isInteger(slot) ? { kind: "cargo", slot } : null;
  }
  const equipmentSlot = element.dataset.equipmentSlot;
  if (equipmentSlot && (EQUIPMENT_SLOTS as readonly string[]).includes(equipmentSlot)) {
    return { kind: "equipment", slot: equipmentSlot as EquipmentSlot };
  }
  return null;
}

function inventoryStackAt(
  snapshot: PlayerSnapshot,
  source: InventoryItemSource,
): Readonly<InventoryStack> | null {
  if (source.kind === "inventory") {
    const anchor = classicGridAnchorAt(snapshot.inventory, source.slot, INVENTORY_BAG_SIZE, 5);
    return anchor < 0 ? null : snapshot.inventory[anchor] ?? null;
  }
  if (source.kind === "cargo") {
    const anchor = classicGridAnchorAt(snapshot.cargo, source.slot, CARGO_PAGE_SIZE, 5);
    return anchor < 0 ? null : snapshot.cargo[anchor] ?? null;
  }
  return snapshot.equipment[source.slot];
}

function createCargoPageNavigation(): HTMLElement {
  const navigation = document.createElement("nav");
  navigation.className = "classic-cargo-pages";
  navigation.setAttribute("aria-label", "Páginas do armazém offline");
  for (let page = 0; page < CARGO_PAGE_COUNT; page++) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.cargoPage = String(page);
    button.setAttribute("aria-pressed", String(page === 0));
    button.setAttribute("aria-label", `Abrir página ${page + 1}`);
    button.title = `Página ${page + 1}`;
    button.textContent = String(page + 1);
    if (page === 0) button.classList.add("is-active");
    navigation.appendChild(button);
  }
  return navigation;
}

function inventoryStackSignature(stack: Readonly<InventoryStack> | null): string {
  return stack
    ? [
        stack.item.key,
        stack.quantity,
        stack.item.classicIndex ?? "",
        stack.item.previewModelType ?? "",
        stack.item.refinement ?? "",
        Number(stack.item.ancient ?? false),
        stack.item.refinementTextureIndex ?? "",
        stack.item.classicInstanceEffects
          ?.map((effect) => `${effect.effect},${effect.value},${effect.packed ?? ""}`)
          .join(";") ?? "",
      ].join(":")
    : "-";
}

function inventorySnapshotSignature(
  inventory: PlayerSnapshot["inventory"],
  equipment: PlayerSnapshot["equipment"],
): string {
  const inventorySignature = inventory.map(inventoryStackSignature).join("|");
  const equipmentSignature = EQUIPMENT_SLOTS
    .map((slot) => `${slot}:${inventoryStackSignature(equipment[slot])}`)
    .join("|");
  return `${inventorySignature}#${equipmentSignature}`;
}
