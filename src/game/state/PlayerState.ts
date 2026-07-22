export type ItemRarity = "common" | "uncommon" | "rare" | "epic";

export interface InventoryItem {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly rarity: ItemRarity;
  readonly maxStack: number;
  readonly value: number;
  readonly kind: "consumable" | "equipment" | "material" | "quest";
  readonly heal?: number;
  readonly mana?: number;
}

export interface InventoryStack {
  readonly item: InventoryItem;
  quantity: number;
}

export interface PlayerSnapshot {
  readonly name: string;
  readonly level: number;
  readonly experience: number;
  readonly nextLevelExperience: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly mp: number;
  readonly maxMp: number;
  readonly attack: number;
  readonly defense: number;
  readonly coins: number;
  readonly alive: boolean;
  readonly inventory: readonly (Readonly<InventoryStack> | null)[];
}

export interface RewardSummary {
  readonly levelsGained: number;
  readonly experienceAdded: number;
  readonly coinsAdded: number;
}

const INVENTORY_SIZE = 30;

/** Client-side progression used while the server layer intentionally stays out of scope. */
export class PlayerState {
  readonly #listeners = new Set<(snapshot: PlayerSnapshot) => void>();
  readonly #inventory: (InventoryStack | null)[] = Array.from({ length: INVENTORY_SIZE }, () => null);
  #level = 1;
  #experience = 0;
  #hp = 260;
  #maxHp = 260;
  #mp = 280;
  #maxMp = 280;
  #attack = 52;
  #defense = 14;
  #coins = 0;

  constructor(readonly name = "Aventureiro") {
    this.addItem({
      key: "pocao-cura-pequena",
      name: "Poção de Cura",
      description: "Recupera 60 pontos de HP.",
      rarity: "common",
      maxStack: 50,
      value: 35,
      kind: "consumable",
      heal: 60,
    }, 5, false);
    this.addItem({
      key: "skytalos-ancient-2551-plus15",
      name: "Skytalos(Anct) +15",
      description: "Arco Ancient da Huntress · Item #2551 · refinação +15 · equipado.",
      rarity: "epic",
      maxStack: 1,
      value: 280_000,
      kind: "equipment",
    }, 1, false);
    this.addItem({
      key: "costume-succubus-4181",
      name: "Conjunto Succubus",
      description: "Traje clássico feminino · Item #4181 · equipado.",
      rarity: "epic",
      maxStack: 1,
      value: 350_000,
      kind: "equipment",
    }, 1, false);
  }

  get snapshot(): PlayerSnapshot {
    return {
      name: this.name,
      level: this.#level,
      experience: this.#experience,
      nextLevelExperience: experienceForNextLevel(this.#level),
      hp: this.#hp,
      maxHp: this.#maxHp,
      mp: this.#mp,
      maxMp: this.#maxMp,
      attack: this.#attack,
      defense: this.#defense,
      coins: this.#coins,
      alive: this.#hp > 0,
      inventory: this.#inventory.map((stack) => stack ? { item: stack.item, quantity: stack.quantity } : null),
    };
  }

  subscribe(listener: (snapshot: PlayerSnapshot) => void): () => void {
    this.#listeners.add(listener);
    listener(this.snapshot);
    return () => this.#listeners.delete(listener);
  }

  takeDamage(rawDamage: number): number {
    if (!this.snapshot.alive || !Number.isFinite(rawDamage) || rawDamage <= 0) return 0;
    const applied = Math.max(1, Math.round(rawDamage - this.#defense * 0.45));
    const before = this.#hp;
    this.#hp = Math.max(0, this.#hp - applied);
    this.emit();
    return before - this.#hp;
  }

  heal(amount: number): number {
    if (!Number.isFinite(amount) || amount <= 0 || !this.snapshot.alive) return 0;
    const before = this.#hp;
    this.#hp = Math.min(this.#maxHp, this.#hp + Math.round(amount));
    if (this.#hp !== before) this.emit();
    return this.#hp - before;
  }

  restoreMana(amount: number): number {
    if (!Number.isFinite(amount) || amount <= 0 || !this.snapshot.alive) return 0;
    const before = this.#mp;
    this.#mp = Math.min(this.#maxMp, this.#mp + Math.round(amount));
    if (this.#mp !== before) this.emit();
    return this.#mp - before;
  }

  spendMana(amount: number): boolean {
    const cost = Math.max(0, Math.round(amount));
    if (!this.snapshot.alive || this.#mp < cost) return false;
    if (cost === 0) return true;
    this.#mp -= cost;
    this.emit();
    return true;
  }

  revive(): void {
    this.#hp = this.#maxHp;
    this.#mp = this.#maxMp;
    this.emit();
  }

  grantRewards(experience: number, coins = 0): RewardSummary {
    const experienceAdded = clampReward(experience, 0, 2_000_000);
    const coinsAdded = clampReward(coins, 0, 50_000_000);
    const initialLevel = this.#level;
    this.#experience += experienceAdded;
    this.#coins += coinsAdded;
    while (this.#level < 400) {
      const required = experienceForNextLevel(this.#level);
      if (this.#experience < required) break;
      this.#experience -= required;
      this.#level++;
      this.#maxHp += 22 + Math.floor(this.#level * 1.4);
      this.#maxMp += 12 + Math.floor(this.#level * 0.8);
      this.#attack += 3;
      this.#defense += 2;
      this.#hp = this.#maxHp;
      this.#mp = this.#maxMp;
    }
    this.emit();
    return { levelsGained: this.#level - initialLevel, experienceAdded, coinsAdded };
  }

  addItem(item: InventoryItem, quantity = 1, notify = true): number {
    let remaining = Math.max(0, Math.trunc(quantity));
    if (remaining === 0) return 0;
    for (const stack of this.#inventory) {
      if (!stack || stack.item.key !== item.key || stack.quantity >= item.maxStack) continue;
      const accepted = Math.min(remaining, item.maxStack - stack.quantity);
      stack.quantity += accepted;
      remaining -= accepted;
      if (remaining === 0) break;
    }
    for (let slot = 0; remaining > 0 && slot < this.#inventory.length; slot++) {
      if (this.#inventory[slot]) continue;
      const accepted = Math.min(remaining, item.maxStack);
      this.#inventory[slot] = { item, quantity: accepted };
      remaining -= accepted;
    }
    const added = Math.max(0, Math.trunc(quantity)) - remaining;
    if (notify && added > 0) this.emit();
    return added;
  }

  useInventorySlot(slot: number): boolean {
    const stack = this.#inventory[slot];
    if (!stack || stack.item.kind !== "consumable" || !this.snapshot.alive) return false;
    let consumed = false;
    if (stack.item.heal && this.#hp < this.#maxHp) {
      this.#hp = Math.min(this.#maxHp, this.#hp + stack.item.heal);
      consumed = true;
    }
    if (stack.item.mana && this.#mp < this.#maxMp) {
      this.#mp = Math.min(this.#maxMp, this.#mp + stack.item.mana);
      consumed = true;
    }
    if (!consumed) return false;
    stack.quantity--;
    if (stack.quantity <= 0) this.#inventory[slot] = null;
    this.emit();
    return true;
  }

  private emit(): void {
    const snapshot = this.snapshot;
    for (const listener of this.#listeners) listener(snapshot);
  }
}

function experienceForNextLevel(level: number): number {
  return Math.round(650 + level * level * 145 + level * 310);
}

function clampReward(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}
