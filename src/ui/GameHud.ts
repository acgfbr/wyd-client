import type {
  InventoryItem,
  PlayerSnapshot,
  PlayerState,
  PrimaryAttribute,
} from "../game/state/PlayerState";

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
}

export interface BuffHudEntry {
  readonly classicIndex: number;
  readonly name: string;
  readonly iconIndex: number;
  readonly durationSeconds: number;
  readonly remainingSeconds: number;
}

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
  readonly #target = requireElement<HTMLElement>("#target-status");
  readonly #targetName = requireElement<HTMLElement>("#target-name");
  readonly #targetLevel = requireElement<HTMLElement>("#target-level");
  readonly #targetHp = requireElement<HTMLElement>("#target-hp-fill");
  readonly #inventory = requireElement<HTMLElement>("#inventory-panel");
  readonly #inventoryGrid = requireElement<HTMLElement>("#inventory-grid");
  readonly #inventoryPreview = requireElement<HTMLElement>("#inventory-preview");
  readonly #characterPanel = requireElement<HTMLElement>("#character-panel");
  readonly #combatLog = requireElement<HTMLElement>("#combat-log");
  readonly #buffStatus = requireElement<HTMLElement>("#buff-status");
  readonly #skillPanel = requireElement<HTMLElement>("#skill-panel");
  readonly #skillCatalogGrid = requireElement<HTMLElement>("#skill-catalog-grid");
  readonly #skillCatalogStatus = requireElement<HTMLElement>("#skill-catalog-status");
  readonly #skillClassSelect = requireElement<HTMLSelectElement>("#skill-class-select");
  #state: PlayerState | null = null;
  #unsubscribe: (() => void) | null = null;
  #lastSnapshot: PlayerSnapshot | null = null;
  #buffSignature = "";
  #skillCatalog: ClassicSkillCatalog | null = null;
  #skillCatalogJob: Promise<void> | null = null;
  #itemIconCatalog: ClassicItemIconCatalog | null = null;
  #itemIconCatalogJob: Promise<ClassicItemIconCatalog | null> | null = null;
  #activeClassKey = "huntress";
  #runtimeSkillIndices = new Set<number>();

  constructor() {
    document.querySelector<HTMLElement>("[data-inventory-close]")?.addEventListener("click", () => {
      this.toggleInventory(false);
    });
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

  toggleInventory(force?: boolean): boolean {
    const visible = force ?? !this.#inventory.classList.contains("is-visible");
    this.#inventory.classList.toggle("is-visible", visible);
    this.#inventoryPreview.classList.toggle("is-inventory-visible", visible);
    if (!visible) this.setInventoryPreview(null);
    return visible;
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

  addLog(message: string, tone: "normal" | "damage" | "reward" | "system" = "normal"): void {
    const line = document.createElement("p");
    line.className = `combat-log-line is-${tone}`;
    line.textContent = message;
    this.#combatLog.appendChild(line);
    while (this.#combatLog.childElementCount > 7) this.#combatLog.firstElementChild?.remove();
  }

  configureSkills(skills: readonly SkillHudEntry[], onUse: (slot: number) => void): void {
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
        button.title = `${slot} · espaço de skill vazio`;
        button.setAttribute("aria-label", button.title);
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
      button.title = `${skill.slot} · ${skill.name} · ${skill.mana} MP`;
      button.setAttribute("aria-label", button.title);
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
    const entries = buffs.map((buff) => {
      const element = document.createElement("div");
      element.className = "classic-buff";
      element.title = `${buff.name} · ${Math.max(0, buff.remainingSeconds).toFixed(1)}s`;
      element.setAttribute("aria-label", element.title);
      const icon = document.createElement("i");
      const iconIndex = Math.max(0, Math.min(152, Math.trunc(buff.iconIndex)));
      icon.style.setProperty("--buff-icon-x", `${-(iconIndex % 16) * 24}px`);
      icon.style.setProperty("--buff-icon-y", `${-Math.floor(iconIndex / 16) * 24}px`);
      const time = document.createElement("small");
      time.textContent = String(Math.max(0, Math.ceil(buff.remainingSeconds)));
      const ratio = buff.durationSeconds <= 0
        ? 0
        : Math.max(0, Math.min(1, buff.remainingSeconds / buff.durationSeconds));
      element.style.setProperty("--buff-remaining", String(ratio));
      element.append(icon, time);
      return element;
    });
    this.#buffStatus.replaceChildren(...entries);
    this.#buffStatus.classList.toggle("is-visible", entries.length > 0);
  }

  setAutoCombat(active: boolean): void {
    const element = document.querySelector<HTMLElement>("#auto-combat");
    element?.classList.toggle("is-active", active);
    const label = element?.querySelector<HTMLElement>("span");
    if (label) label.textContent = active ? "Auto ON" : "Auto OFF";
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
        column.appendChild(createSkillCatalogEntry(
          skill,
          false,
          canUse ? () => this.onCatalogSkillUse?.(skill.index) : undefined,
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
    this.renderInventory(snapshot);
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
        if (this.#lastSnapshot) this.renderInventory(this.#lastSnapshot);
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
    setText("#inventory-preview-name", item?.name ?? "Passe sobre um item");
    setText("#inventory-preview-kind", item
      ? `${inventoryKindLabel(item.kind)} · ${item.previewModelType ? `mesh ${item.previewModelType}` : "sem modelo"}`
      : "Preview clássico 3D");
    const fallback = document.querySelector<HTMLElement>("#inventory-preview-fallback");
    if (fallback) {
      const icon = item ? this.resolveInventoryIcon(item) : null;
      fallback.style.backgroundImage = icon ? `url("/game-data/classic/ui/${icon.atlas}")` : "";
      fallback.style.backgroundPosition = icon
        ? `${-icon.column * icon.cellSize * 4}px ${-icon.row * icon.cellSize * 4}px`
        : "";
      fallback.style.backgroundSize = icon
        ? `${icon.columns * icon.cellSize * 4}px auto`
        : "";
      fallback.classList.toggle("has-classic-icon", icon !== null);
      fallback.textContent = icon || !item ? "" : item.name.slice(0, 2).toUpperCase();
    }
    this.onInventoryPreview?.(item);
  }

  private renderInventory(snapshot: PlayerSnapshot): void {
    const cells = snapshot.inventory.map((stack, index) => {
      const button = document.createElement("button");
      button.className = `inventory-slot${stack ? ` rarity-${stack.item.rarity}` : ""}`;
      button.type = "button";
      button.dataset.slot = String(index);
      if (!stack) {
        button.setAttribute("aria-label", `Espaço vazio ${index + 1}`);
        button.addEventListener("pointerenter", () => this.setInventoryPreview(null));
        return button;
      }
      const icon = this.createInventoryIcon(stack.item);
      const quantity = document.createElement("small");
      quantity.textContent = stack.quantity > 1 ? String(stack.quantity) : "";
      button.title = `${stack.item.name}\n${stack.item.description}`;
      button.setAttribute("aria-label", `${stack.item.name}, quantidade ${stack.quantity}`);
      button.append(icon, quantity);
      button.addEventListener("pointerenter", () => this.setInventoryPreview(stack.item));
      button.addEventListener("pointerleave", () => {
        if (document.activeElement !== button) this.setInventoryPreview(null);
      });
      button.addEventListener("focus", () => this.setInventoryPreview(stack.item));
      button.addEventListener("blur", () => {
        if (!button.matches(":hover")) this.setInventoryPreview(null);
      });
      button.addEventListener("dblclick", () => {
        if (this.#state?.useInventorySlot(index)) this.addLog(`${stack.item.name} utilizado.`, "system");
      });
      return button;
    });
    this.#inventoryGrid.replaceChildren(...cells);
  }

  private createInventoryIcon(item: InventoryItem): HTMLElement {
    const fallback = document.createElement("span");
    fallback.className = "inventory-item-mark";
    fallback.textContent = item.name.slice(0, 2).toUpperCase();
    const resolved = this.resolveInventoryIcon(item);
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
    const catalog = this.#itemIconCatalog;
    if (!catalog || item.classicIndex === undefined) return null;
    const globalIndex = catalog.itemToIcon[item.classicIndex] ?? -1;
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
}

function createSkillCatalogEntry(
  skill: ClassicSkillCatalogEntry,
  learned = false,
  onUse?: () => void,
): HTMLElement {
  const entry = document.createElement("article");
  entry.className = `skill-catalog-entry is-${skill.kind}${skill.category === "master" ? " is-master" : ""}${learned ? " is-learned" : ""}${onUse ? " is-castable" : ""}`;
  entry.title = `#${skill.index} · ${skill.name}\nMP ${skill.manaSpent} · delay ${skill.delaySeconds}s · alcance ${skill.range}`;
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
  details.textContent = `${kind}${learned ? " · APRENDIDA" : ""} · MP ${skill.manaSpent} · CD ${skill.delaySeconds}s · R ${skill.range}${onUse ? " · USAR" : ""}`;
  copy.append(name, details);
  const index = document.createElement("b");
  index.textContent = `#${skill.index}`;
  entry.append(icon, copy, index);
  if (onUse) {
    entry.tabIndex = 0;
    entry.setAttribute("role", "button");
    entry.setAttribute("aria-label", `Usar ${skill.name}`);
    entry.addEventListener("click", onUse);
    entry.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onUse();
    });
  }
  return entry;
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`HUD: elemento ${selector} ausente`);
  return element;
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

const PRIMARY_ATTRIBUTES = ["str", "int", "dex", "con"] as const satisfies readonly PrimaryAttribute[];

function formatNumber(value: number): string {
  return Math.max(0, Math.trunc(value)).toLocaleString("pt-BR");
}

function inventoryKindLabel(kind: InventoryItem["kind"]): string {
  switch (kind) {
    case "consumable": return "Consumível";
    case "equipment": return "Equipamento";
    case "material": return "Material";
    case "quest": return "Missão";
  }
}
