import type {
  ClassicCommerceCarryEffect,
  ClassicCommerceItem,
  ClassicCommerceItemEffect,
  ClassicResolvedCarrySlot,
  ClassicResolvedTemplateCarry,
} from "../game/commerce/ClassicCommerceCatalog";

export const CLASSIC_NPC_SHOP_VISUAL_CELLS = 40;
export const CLASSIC_NPC_SHOP_CARRY_CELLS = 27;
export const CLASSIC_ITEM_ICON_CATALOG_URL = "/game-data/classic/ui/item-icons.json";

export type ClassicNpcShopGridState = "clear" | "loading" | "ready" | "error";

export interface ClassicNpcShopSelection {
  readonly templateKey: string;
  readonly slot: ClassicResolvedCarrySlot;
  readonly item: ClassicCommerceItem;
}

export interface ClassicNpcShopGridOptions {
  readonly iconCatalogUrl?: string;
  /** Selection is presentation-only and is intended for a future 3D preview. */
  readonly onSelectItem?: (selection: ClassicNpcShopSelection) => void;
}

interface ClassicItemIconCatalog {
  readonly version: number;
  readonly cellSize: number;
  readonly columns: number;
  readonly iconsPerAtlas: number;
  readonly atlases: readonly string[];
  readonly itemToIcon: readonly number[];
}

interface ResolvedClassicItemIcon {
  readonly url: string;
  readonly cellSize: number;
  readonly columns: number;
  readonly column: number;
  readonly row: number;
}

const iconCatalogJobs = new Map<string, Promise<ClassicItemIconCatalog>>();
const priceFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

/**
 * Reusable, read-only renderer for the 40 visual cells authored by Store2.
 * It exposes selection only as a preview signal and intentionally contains no
 * purchase, sale, balance, tax or inventory-mutation API.
 */
export class ClassicNpcShopGrid {
  onSelectItem: ((selection: ClassicNpcShopSelection) => void) | null;

  readonly #container: HTMLElement;
  readonly #iconCatalogUrl: string;
  readonly #cells: readonly HTMLButtonElement[];
  #state: ClassicNpcShopGridState = "clear";
  #error: string | null = null;
  #renderGeneration = 0;
  #activeCarry: ClassicResolvedTemplateCarry | null = null;
  #selectedDisplayIndex: number | null = null;

  constructor(container: HTMLElement, options: ClassicNpcShopGridOptions = {}) {
    this.#container = container;
    this.#iconCatalogUrl = options.iconCatalogUrl ?? CLASSIC_ITEM_ICON_CATALOG_URL;
    this.onSelectItem = options.onSelectItem ?? null;
    this.#cells = Object.freeze(Array.from(
      { length: CLASSIC_NPC_SHOP_VISUAL_CELLS },
      (_, displayIndex) => this.createCell(displayIndex),
    ));

    this.#container.replaceChildren(...this.#cells);
    this.#container.setAttribute("role", "grid");
    this.#container.setAttribute("aria-rowcount", "8");
    this.#container.setAttribute("aria-colcount", "5");
    this.#container.setAttribute("aria-label", "Itens da loja clássica");
    this.clear();
  }

  get state(): ClassicNpcShopGridState {
    return this.#state;
  }

  get error(): string | null {
    return this.#error;
  }

  /** Keeps all 40 cells mounted while resetting them to an empty grid. */
  clear(): void {
    this.ensureMounted();
    this.#renderGeneration++;
    this.#activeCarry = null;
    this.#selectedDisplayIndex = null;
    for (const cell of this.#cells) this.clearCell(cell);
    this.setState("clear");
  }

  /** Public loading state for an owner that starts catalog resolution first. */
  setLoading(): void {
    this.ensureMounted();
    this.#renderGeneration++;
    this.#activeCarry = null;
    this.#selectedDisplayIndex = null;
    for (const cell of this.#cells) this.clearCell(cell);
    this.setState("loading");
  }

  /** Public failure state; no additional DOM node is added to the 40 cells. */
  setError(error: unknown): void {
    this.ensureMounted();
    this.#renderGeneration++;
    this.#activeCarry = null;
    this.#selectedDisplayIndex = null;
    for (const cell of this.#cells) this.clearCell(cell);
    this.setState("error", errorMessage(error));
  }

  /**
   * Renders item metadata immediately, then lazily resolves the classic icon
   * atlas. Stale icon requests cannot overwrite a newer shop or `clear()`.
   */
  async render(carry: ClassicResolvedTemplateCarry): Promise<void> {
    this.ensureMounted();
    const validationError = validateCarry(carry);
    if (validationError) {
      this.setError(validationError);
      return;
    }

    const generation = ++this.#renderGeneration;
    this.#activeCarry = carry;
    this.#selectedDisplayIndex = null;
    this.setState("loading");
    for (let displayIndex = 0; displayIndex < this.#cells.length; displayIndex++) {
      const cell = this.#cells[displayIndex];
      if (!cell) continue;
      const slot = displayIndex < CLASSIC_NPC_SHOP_CARRY_CELLS
        ? carry.slots[displayIndex] ?? null
        : null;
      this.renderCellMetadata(cell, displayIndex, slot);
    }

    try {
      const icons = await loadItemIconCatalog(this.#iconCatalogUrl);
      if (generation !== this.#renderGeneration || this.#activeCarry !== carry) return;
      for (let displayIndex = 0; displayIndex < CLASSIC_NPC_SHOP_CARRY_CELLS; displayIndex++) {
        const cell = this.#cells[displayIndex];
        const slot = carry.slots[displayIndex];
        if (!cell || !slot?.item) continue;
        this.renderCellIcon(cell, resolveItemIcon(icons, slot.item.index, this.#iconCatalogUrl));
      }
      this.setState("ready");
    } catch (error) {
      if (generation !== this.#renderGeneration || this.#activeCarry !== carry) return;
      // Item names and metadata remain usable when only the icon atlas fails.
      this.setState("error", errorMessage(error));
    }
  }

  private createCell(displayIndex: number): HTMLButtonElement {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "npc-interaction-slot classic-npc-shop-cell is-empty";
    cell.dataset.displayIndex = String(displayIndex);
    cell.setAttribute("role", "gridcell");
    cell.setAttribute("aria-rowindex", String(Math.floor(displayIndex / 5) + 1));
    cell.setAttribute("aria-colindex", String((displayIndex % 5) + 1));
    cell.addEventListener("click", () => this.selectCell(displayIndex));
    return cell;
  }

  /**
   * Cargo and shop share the authored NPC grid host. Cargo replaces its
   * children while open, so a returning shop must explicitly remount the
   * original 40 Store2 cells before changing their state.
   */
  private ensureMounted(): void {
    const mounted = this.#container.childElementCount === this.#cells.length
      && this.#cells.every((cell, index) => this.#container.children.item(index) === cell);
    if (!mounted) this.#container.replaceChildren(...this.#cells);
  }

  private clearCell(cell: HTMLButtonElement): void {
    const displayIndex = Number(cell.dataset.displayIndex ?? -1);
    cell.replaceChildren();
    cell.classList.remove("has-item", "has-classic-icon", "is-selected", "is-icon-missing");
    cell.classList.add("is-empty");
    cell.disabled = true;
    cell.title = "";
    cell.style.removeProperty("background-image");
    cell.style.removeProperty("background-position");
    cell.style.removeProperty("background-size");
    cell.style.removeProperty("background-repeat");
    cell.removeAttribute("data-item-index");
    cell.setAttribute("aria-selected", "false");
    cell.setAttribute("aria-label", `Espaço vazio ${displayIndex + 1} de ${CLASSIC_NPC_SHOP_VISUAL_CELLS}`);
  }

  private renderCellMetadata(
    cell: HTMLButtonElement,
    displayIndex: number,
    slot: ClassicResolvedCarrySlot | null,
  ): void {
    this.clearCell(cell);
    if (!slot?.item) return;

    const label = itemDescription(slot);
    const fallback = document.createElement("span");
    fallback.className = "classic-npc-shop-item-fallback";
    fallback.textContent = itemInitials(slot.item.name);
    fallback.setAttribute("aria-hidden", "true");
    cell.appendChild(fallback);
    cell.classList.remove("is-empty");
    cell.classList.add("has-item");
    cell.disabled = false;
    cell.dataset.itemIndex = String(slot.item.index);
    cell.title = label;
    cell.setAttribute("aria-label", label.replaceAll("\n", ". "));
    cell.setAttribute("aria-selected", String(displayIndex === this.#selectedDisplayIndex));
  }

  private renderCellIcon(cell: HTMLButtonElement, icon: ResolvedClassicItemIcon | null): void {
    cell.classList.toggle("is-icon-missing", icon === null);
    if (!icon) return;
    cell.classList.add("has-classic-icon");
    cell.style.backgroundImage = `url("${icon.url}")`;
    cell.style.backgroundPosition = `${-icon.column * icon.cellSize}px ${-icon.row * icon.cellSize}px`;
    cell.style.backgroundSize = `${icon.columns * icon.cellSize}px auto`;
    cell.style.backgroundRepeat = "no-repeat";
    cell.firstElementChild?.remove();
  }

  private selectCell(displayIndex: number): void {
    const carry = this.#activeCarry;
    const slot = carry?.slots[displayIndex];
    if (!carry || !slot?.item || displayIndex >= CLASSIC_NPC_SHOP_CARRY_CELLS) return;

    if (this.#selectedDisplayIndex !== null) {
      const previous = this.#cells[this.#selectedDisplayIndex];
      previous?.classList.remove("is-selected");
      previous?.setAttribute("aria-selected", "false");
    }
    this.#selectedDisplayIndex = displayIndex;
    const selected = this.#cells[displayIndex];
    selected?.classList.add("is-selected");
    selected?.setAttribute("aria-selected", "true");
    this.onSelectItem?.({ templateKey: carry.template.templateKey, slot, item: slot.item });
  }

  private setState(state: ClassicNpcShopGridState, error: string | null = null): void {
    this.#state = state;
    this.#error = state === "error" ? (error ?? "Falha desconhecida") : null;
    this.#container.dataset.shopGridState = state;
    this.#container.classList.toggle("is-loading", state === "loading");
    this.#container.classList.toggle("has-error", state === "error");
    this.#container.setAttribute("aria-busy", String(state === "loading"));
    this.#container.setAttribute(
      "aria-label",
      state === "error"
        ? `Itens da loja clássica. Falha ao carregar ícones: ${this.#error}`
        : state === "loading"
          ? "Itens da loja clássica. Carregando ícones."
          : state === "clear"
            ? "Itens da loja clássica. Nenhuma loja selecionada."
            : "Itens da loja clássica. Preços estáticos não autoritativos.",
    );
  }
}

function itemDescription(slot: ClassicResolvedCarrySlot): string {
  const item = slot.item;
  if (!item) return "Espaço vazio";
  const requirements = item.requirements;
  const baseEffects = formatEffects(item.effects);
  const instanceEffects = formatCarryEffects(slot.effects);
  return [
    `${displayName(item.name)} · #${item.index}`,
    `Requisitos: nível ${requirements.level} · FOR ${requirements.strength} · INT ${requirements.intelligence} · DES ${requirements.dexterity} · CON ${requirements.constitution}`,
    `Efeitos do item: ${baseEffects}`,
    `Efeitos da instância: ${instanceEffects}`,
    `Preço estático (não autoritativo): ${priceFormatter.format(item.staticDisplayPrice.amount)}`,
  ].join("\n");
}

function formatEffects(effects: readonly ClassicCommerceItemEffect[]): string {
  const active = effects.filter((effect) => effect.effect !== 0 || effect.value !== 0);
  return active.length > 0
    ? active.map((effect) => `#${effect.effect}=${effect.value}`).join(", ")
    : "nenhum";
}

function formatCarryEffects(effects: readonly ClassicCommerceCarryEffect[]): string {
  const active = effects.filter((effect) => effect.effect !== 0 || effect.value !== 0);
  return active.length > 0
    ? active.map((effect) => `#${effect.effect}=${effect.value}`).join(", ")
    : "nenhum";
}

function displayName(name: string): string {
  return name.replaceAll("_", " ").trim() || "Item sem nome";
}

function itemInitials(name: string): string {
  const words = displayName(name).split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "?";
}

function validateCarry(carry: ClassicResolvedTemplateCarry): string | null {
  if (carry.slots.length !== CLASSIC_NPC_SHOP_CARRY_CELLS) {
    return `Carry ${carry.template.templateKey} possui ${carry.slots.length} slots; esperado ${CLASSIC_NPC_SHOP_CARRY_CELLS}`;
  }
  for (let displayIndex = 0; displayIndex < carry.slots.length; displayIndex++) {
    if (carry.slots[displayIndex]?.displayIndex !== displayIndex) {
      return `Carry ${carry.template.templateKey} fora de ordem no índice ${displayIndex}`;
    }
  }
  return null;
}

function loadItemIconCatalog(url: string): Promise<ClassicItemIconCatalog> {
  const cached = iconCatalogJobs.get(url);
  if (cached) return cached;

  const job = (async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return validateItemIconCatalog(await response.json());
  })();
  iconCatalogJobs.set(url, job);
  void job.catch(() => {
    if (iconCatalogJobs.get(url) === job) iconCatalogJobs.delete(url);
  });
  return job;
}

function validateItemIconCatalog(value: unknown): ClassicItemIconCatalog {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("item-icons.json inválido");
  }
  const catalog = value as Partial<ClassicItemIconCatalog>;
  if (
    catalog.version !== 1
    || !Number.isInteger(catalog.cellSize)
    || (catalog.cellSize ?? 0) <= 0
    || !Number.isInteger(catalog.columns)
    || (catalog.columns ?? 0) <= 0
    || !Number.isInteger(catalog.iconsPerAtlas)
    || (catalog.iconsPerAtlas ?? 0) <= 0
    || !Array.isArray(catalog.atlases)
    || catalog.atlases.some((atlas) => typeof atlas !== "string" || atlas.length === 0)
    || !Array.isArray(catalog.itemToIcon)
    || catalog.itemToIcon.some((icon) => !Number.isInteger(icon) || icon < -1)
  ) {
    throw new Error("item-icons.json incompatível");
  }
  return catalog as ClassicItemIconCatalog;
}

function resolveItemIcon(
  catalog: ClassicItemIconCatalog,
  itemIndex: number,
  catalogUrl: string,
): ResolvedClassicItemIcon | null {
  const globalIndex = catalog.itemToIcon[itemIndex] ?? -1;
  if (globalIndex < 0) return null;
  const atlasIndex = Math.floor(globalIndex / catalog.iconsPerAtlas);
  const atlas = catalog.atlases[atlasIndex];
  if (!atlas) return null;
  const localIndex = globalIndex % catalog.iconsPerAtlas;
  return {
    url: new URL(atlas, new URL(".", new URL(catalogUrl, document.baseURI))).href,
    cellSize: catalog.cellSize,
    columns: catalog.columns,
    column: localIndex % catalog.columns,
    row: Math.floor(localIndex / catalog.columns),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
