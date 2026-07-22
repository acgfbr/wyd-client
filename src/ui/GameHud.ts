import type { PlayerSnapshot, PlayerState } from "../game/state/PlayerState";

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
}

export class GameHud {
  readonly #target = requireElement<HTMLElement>("#target-status");
  readonly #targetName = requireElement<HTMLElement>("#target-name");
  readonly #targetLevel = requireElement<HTMLElement>("#target-level");
  readonly #targetHp = requireElement<HTMLElement>("#target-hp-fill");
  readonly #inventory = requireElement<HTMLElement>("#inventory-panel");
  readonly #inventoryGrid = requireElement<HTMLElement>("#inventory-grid");
  readonly #combatLog = requireElement<HTMLElement>("#combat-log");
  #state: PlayerState | null = null;
  #unsubscribe: (() => void) | null = null;
  #lastSnapshot: PlayerSnapshot | null = null;

  constructor() {
    document.querySelector<HTMLElement>("[data-inventory-close]")?.addEventListener("click", () => {
      this.toggleInventory(false);
    });
  }

  bindPlayer(state: PlayerState): void {
    this.#unsubscribe?.();
    this.#state = state;
    this.#unsubscribe = state.subscribe((snapshot) => this.renderPlayer(snapshot));
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
    for (const skill of skills) {
      const button = document.querySelector<HTMLButtonElement>(`#skill-slot-${skill.slot}`);
      if (!button) continue;
      button.title = `${skill.slot} · ${skill.name} · ${skill.mana} MP`;
      button.setAttribute("aria-label", button.title);
      const name = button.querySelector<HTMLElement>(".skill-name");
      if (name) name.textContent = skill.shortName;
      button.onclick = () => onUse(skill.slot);
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
    this.renderInventory(snapshot);
  }

  private renderInventory(snapshot: PlayerSnapshot): void {
    const cells = snapshot.inventory.map((stack, index) => {
      const button = document.createElement("button");
      button.className = `inventory-slot${stack ? ` rarity-${stack.item.rarity}` : ""}`;
      button.type = "button";
      button.dataset.slot = String(index);
      if (!stack) {
        button.setAttribute("aria-label", `Espaço vazio ${index + 1}`);
        return button;
      }
      const initial = document.createElement("span");
      initial.className = "inventory-item-mark";
      initial.textContent = stack.item.name.slice(0, 2).toUpperCase();
      const quantity = document.createElement("small");
      quantity.textContent = stack.quantity > 1 ? String(stack.quantity) : "";
      button.title = `${stack.item.name}\n${stack.item.description}`;
      button.setAttribute("aria-label", `${stack.item.name}, quantidade ${stack.quantity}`);
      button.append(initial, quantity);
      button.addEventListener("dblclick", () => {
        if (this.#state?.useInventorySlot(index)) this.addLog(`${stack.item.name} utilizado.`, "system");
      });
      return button;
    });
    this.#inventoryGrid.replaceChildren(...cells);
  }
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
