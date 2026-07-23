export type ItemRarity = "common" | "uncommon" | "rare" | "epic";

/** Slots lógicos do equipamento clássico, independentes da posição visual no HUD. */
export const EQUIPMENT_SLOTS = [
  "helmet",
  "armor",
  "pants",
  "gloves",
  "boots",
  "leftHand",
  "rightHand",
  "ring",
  "necklace",
  "orb",
  "cabuncle",
  "costume",
  "familiar",
  "mount",
  "cape",
] as const;

export type EquipmentSlot = typeof EQUIPMENT_SLOTS[number];

export interface InventoryItem {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly rarity: ItemRarity;
  readonly maxStack: number;
  readonly value: number;
  readonly kind: "consumable" | "equipment" | "material" | "quest";
  /** Slot aceito por este equipamento. Ausente para itens que não podem ser equipados. */
  readonly equipSlot?: EquipmentSlot;
  /** ItemList index used to resolve the exact classic icon atlas cell. */
  readonly classicIndex?: number;
  /** MeshList type rendered by the optional shared-renderer inventory preview. */
  readonly previewModelType?: number;
  /** Refinamento dinâmico do STRUCT_ITEM (sSanc), exibido como no grid clássico. */
  readonly refinement?: number;
  readonly ancient?: boolean;
  /** Segunda textura usada pelo passe clássico MODULATE2X + ADDSMOOTH. */
  readonly refinementTextureIndex?: number;
  readonly heal?: number;
  readonly mana?: number;
}

export interface InventoryStack {
  readonly item: InventoryItem;
  quantity: number;
}

export type EquipmentSnapshot = Readonly<Record<
  EquipmentSlot,
  Readonly<InventoryStack> | null
>>;

export type PrimaryAttribute = "str" | "int" | "dex" | "con";

export interface PlayerPrimaryAttributes {
  readonly str: number;
  readonly int: number;
  readonly dex: number;
  readonly con: number;
}

export interface OfflineProgressionOptions {
  /** Frontend-only mock until the authoritative server progression is available. */
  readonly attributePointsPerLevel?: number;
}

export interface PlayerSnapshot {
  readonly name: string;
  readonly level: number;
  readonly experience: number;
  readonly nextLevelExperience: number;
  readonly totalExperience: number;
  readonly nextLevelTotalExperience: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly mp: number;
  readonly maxMp: number;
  readonly attack: number;
  readonly defense: number;
  readonly primaryAttributes: PlayerPrimaryAttributes;
  readonly freeAttributePoints: number;
  readonly offlineAttributePointsPerLevel: number;
  readonly coins: number;
  readonly alive: boolean;
  readonly inventory: readonly (Readonly<InventoryStack> | null)[];
  /**
   * Visible classic cargo slots for this frontend session only. They are not
   * persisted or populated until an authoritative server is connected.
   */
  readonly cargo: readonly (Readonly<InventoryStack> | null)[];
  readonly equipment: EquipmentSnapshot;
}

export interface RewardSummary {
  readonly levelsGained: number;
  readonly levelUps: number;
  readonly experienceAdded: number;
  readonly coinsAdded: number;
  readonly attackGained: number;
  readonly attributePointsGained: number;
}

export const INVENTORY_BAG_COUNT = 4;
export const INVENTORY_BAG_SIZE = 15;
export const INVENTORY_SIZE = INVENTORY_BAG_COUNT * INVENTORY_BAG_SIZE;
/** Three classic cargo pages, each rendered as a 5 x 8 grid. */
export const CARGO_PAGE_COUNT = 3;
export const CARGO_PAGE_SIZE = 40;
/**
 * The original structure reserves MAX_CARGO=128, but TMFieldScene exposes
 * only indices 0..119 through its three pages. Keep this session state equal
 * to the visible client contract instead of exposing the eight hidden slots.
 */
export const CARGO_VISIBLE_SIZE = CARGO_PAGE_COUNT * CARGO_PAGE_SIZE;
const OFFLINE_ATTACK_PER_LEVEL = 3;
/** Explicit frontend mock; callers may override it through OfflineProgressionOptions. */
export const DEFAULT_OFFLINE_ATTRIBUTE_POINTS_PER_LEVEL = 5;
const MAX_CLASSIC_LEVEL = 400;

/**
 * Exact cumulative g_pNextLevel[403] table from the decompiled classic
 * Basedef.h. Displayed level N reaches N + 1 at index N.
 */
export const CLASSIC_CUMULATIVE_EXPERIENCE = [
  0, 500, 1124, 1826, 2610, 3480, 4440, 5494, 6646, 7900,
  9260, 10893, 12817, 15050, 17610, 20515, 23783, 27432, 31480, 35945,
  40845, 46251, 52187, 58677, 65745, 73415, 81711, 90657, 100277, 110595,
  121635, 133647, 146671, 160747, 175915, 192215, 209687, 228371, 248307, 269535,
  292095, 316151, 341751, 368943, 397775, 428295, 460551, 494591, 530463, 568215,
  607895, 649715, 693731, 739999, 788575, 839515, 892875, 948711, 1007079, 1068035,
  1131635, 1198670, 1269230, 1343405, 1421285, 1502960, 1588520, 1678055, 1771655, 1869410,
  1971410, 2078255, 2190055, 2306920, 2428960, 2556285, 2689005, 2827230, 2971070, 3120635,
  3276035, 3438521, 3608249, 3785375, 3970055, 4162445, 4362701, 4570979, 4787435, 5012225,
  5245505, 5488163, 5740379, 6002333, 6274205, 6556175, 6848423, 7151129, 7464473, 7788635,
  8123795, 8460174, 8797774, 9136597, 9476645, 9817920, 10160424, 10504159, 10849127, 11195330,
  11542770, 11892311, 12243959, 12597720, 12953600, 13311605, 13671741, 14034014, 14398430, 14764995,
  15133715, 15508850, 15890450, 16278565, 16673245, 17074540, 17482500, 17897175, 18318615, 18746870,
  19181990, 19625811, 20078403, 20539836, 21010180, 21489505, 21977881, 22475378, 22982066, 23498015,
  24023295, 24559110, 25105558, 25662737, 26230745, 26809680, 27399640, 28000723, 28613027, 29236650,
  29871690, 30517485, 31174125, 31841700, 32520300, 33210015, 33910935, 34623150, 35346750, 36081825,
  36828465, 37587867, 38360139, 39145389, 39943725, 40755255, 41580087, 42418329, 43270089, 44135475,
  45014595, 45904870, 46806370, 47719165, 48643325, 49578920, 50526020, 51484695, 52455015, 53437050,
  54430870, 55439542, 56463162, 57501826, 58555630, 59624670, 60709042, 61808842, 62924166, 64055110,
  65201770, 66366010, 67547930, 68747630, 69965210, 71200770, 72454410, 73726230, 75016330, 76324810,
  77651770, 78985354, 80325578, 81672458, 83026010, 84386250, 85753194, 87126858, 88507258, 89894410,
  91288330, 92693002, 94108458, 95534730, 96971850, 98419850, 99878762, 101348618, 102829450, 104321290,
  105824170, 107352234, 108905674, 110484682, 112089450, 113720170, 115377034, 117060234, 118769962, 120506410,
  122269770, 124065890, 125895058, 127757562, 129653690, 131583730, 133547970, 135546698, 137580202, 139648770,
  141752690, 143928178, 146176386, 148498466, 150895570, 153368850, 155919458, 158548546, 161257266, 164046770,
  166918210, 169956978, 173167682, 176554930, 180123330, 205345890, 209100050, 212902550, 216753470, 220652890,
  224600890, 228597550, 232642950, 236737170, 240880290, 245072390, 249313550, 253603850, 257943370, 262332190,
  266770390, 271258050, 275795250, 280382070, 285018590, 289904810, 295042730, 300434350, 306081670, 311986690,
  318151410, 324577830, 331267950, 338223770, 345447290, 354039310, 364049830, 375528850, 388526370, 403092390,
  419276910, 437129930, 456701450, 476272970, 495844490, 515416010, 534987530, 554559050, 574130570, 593702090,
  613273610, 632845130, 652416650, 671988170, 691559690, 711131210, 730702730, 750274250, 769845770, 789417290,
  808988810, 828560330, 848131850, 867703370, 887274890, 906846410, 926417930, 945989450, 965560970, 985132490,
  1004704010, 1024275530, 1043847050, 1063418570, 1082990090, 1102561610, 1122133130, 1141704650, 1161276170, 1180847690,
  1200419210, 1222705731, 1244995262, 1267288477, 1289622601, 1311966887, 1334333102, 1356724650, 1379151914, 1401651370,
  1424151231, 1448674779, 1473220997, 1497782544, 1522364697, 1546957043, 1571581919, 1596243411, 1620925875, 1645647464,
  1670373305, 1710373305, 1770373305, 1870373305, 2000000000, 2039000000, 2078000000, 2117000000, 2156000000, 2195000000,
  2234000000, 2273000000, 2312000000, 2351000000, 2390000000, 2429000000, 2468000000, 2507000000, 2546000000, 2585000000,
  2624000000, 2663000000, 2702000000, 2741000000, 2780000000, 2819000000, 2858000000, 2897000000, 2936000000, 3000000000,
  3043000000, 3086000000, 3129000000, 3172000000, 3215000000, 3258000000, 3301000000, 3344000000, 3387000000, 3430000000,
  3473000000, 3516000000, 3559000000, 3602000000, 3645000000, 3688000000, 3731000000, 3774000000, 3817000000, 4000000000,
  4100000000, 4200000000, 4290000000,
] as const;

/** Client-side progression used while the server layer intentionally stays out of scope. */
export class PlayerState {
  readonly #listeners = new Set<(snapshot: PlayerSnapshot) => void>();
  readonly #inventory: (InventoryStack | null)[] = Array.from({ length: INVENTORY_SIZE }, () => null);
  /** Offline/session-only cargo: intentionally empty, unseeded and unpersisted. */
  readonly #cargo: (InventoryStack | null)[] = Array.from({ length: CARGO_VISIBLE_SIZE }, () => null);
  readonly #equipment = createEmptyEquipment();
  #level = 1;
  #experience = 0;
  #hp = 260;
  #maxHp = 260;
  #mp = 280;
  #maxMp = 280;
  #attack = 52;
  #defense = 14;
  #primaryAttributes: Record<PrimaryAttribute, number> = { str: 8, int: 8, dex: 12, con: 8 };
  #freeAttributePoints = 0;
  readonly #attributePointsPerLevel: number;
  #coins = 0;
  #name: string;

  constructor(name = "Aventureiro", options: OfflineProgressionOptions = {}) {
    this.#name = name;
    this.#attributePointsPerLevel = clampWholeNumber(
      options.attributePointsPerLevel ?? DEFAULT_OFFLINE_ATTRIBUTE_POINTS_PER_LEVEL,
      0,
      100,
    );
    this.addItem({
      key: "classic-item-400",
      name: "Poção de Cura",
      description: "Recupera 50 pontos de HP.",
      rarity: "common",
      maxStack: 50,
      value: 150,
      kind: "consumable",
      classicIndex: 400,
      previewModelType: 53,
      heal: 50,
    }, 5, false);
    this.addItem({
      key: "classic-item-405",
      name: "Poção de Mana",
      description: "Recupera 50 pontos de MP.",
      rarity: "common",
      maxStack: 50,
      value: 200,
      kind: "consumable",
      // UseMPotion accepts the classic 405..409 family; 405 is its first tier.
      classicIndex: 405,
      previewModelType: 56,
      mana: 50,
    }, 5, false);
    const skytalos: InventoryItem = {
      key: "skytalos-ancient-2551-plus15",
      name: "Skytalos(Anct) +15",
      description: "Arco Ancient da Huntress · Item #2551 · refinação +15 · equipado.",
      rarity: "epic",
      maxStack: 1,
      value: 280_000,
      kind: "equipment",
      equipSlot: "leftHand",
      classicIndex: 2551,
      previewModelType: 762,
      refinement: 15,
      ancient: true,
      refinementTextureIndex: 165,
    };
    const mulherKalintz: InventoryItem = {
      key: "costume-mulher-kalintz-4156",
      name: "Mulher Kalintz",
      description: "Traje clássico feminino · Item #4156 · padrão da Huntress.",
      rarity: "epic",
      maxStack: 1,
      value: 350_000,
      kind: "equipment",
      equipSlot: "costume",
      classicIndex: 4156,
      previewModelType: 2883,
    };
    const unicornio: InventoryItem = {
      key: "mount-unicornio-2381-level-120",
      name: "Unicórnio Lv. 120",
      description: "Montaria clássica da Huntress · Item #2381 · nível 120.",
      rarity: "epic",
      maxStack: 1,
      value: 500_000,
      kind: "equipment",
      equipSlot: "mount",
      classicIndex: 2381,
    };
    const griupan: InventoryItem = {
      key: "familiar-griupan-1726",
      name: "Griupan",
      description: "Familiar clássico com efeito de nível 5 · Item #1726.",
      rarity: "rare",
      maxStack: 1,
      value: 250_000,
      kind: "equipment",
      equipSlot: "familiar",
      classicIndex: 1726,
    };
    this.#equipment.leftHand = { item: skytalos, quantity: 1 };
    this.#equipment.costume = { item: mulherKalintz, quantity: 1 };
    this.#equipment.mount = { item: unicornio, quantity: 1 };
    this.#equipment.familiar = { item: griupan, quantity: 1 };
  }

  get snapshot(): PlayerSnapshot {
    const levelStartExperience = this.#level <= 1
      ? classicCumulativeExperienceAt(0)
      : classicCumulativeExperienceAt(this.#level - 1);
    const nextLevelTotalExperience = classicCumulativeExperienceAt(this.#level);
    return {
      name: this.#name,
      level: this.#level,
      experience: Math.max(0, this.#experience - levelStartExperience),
      nextLevelExperience: Math.max(0, nextLevelTotalExperience - levelStartExperience),
      totalExperience: this.#experience,
      nextLevelTotalExperience,
      hp: this.#hp,
      maxHp: this.#maxHp,
      mp: this.#mp,
      maxMp: this.#maxMp,
      attack: this.#attack,
      defense: this.#defense,
      primaryAttributes: { ...this.#primaryAttributes },
      freeAttributePoints: this.#freeAttributePoints,
      offlineAttributePointsPerLevel: this.#attributePointsPerLevel,
      coins: this.#coins,
      alive: this.#hp > 0,
      inventory: this.#inventory.map((stack) => stack ? { item: stack.item, quantity: stack.quantity } : null),
      cargo: this.#cargo.map((stack) => stack ? { item: stack.item, quantity: stack.quantity } : null),
      equipment: snapshotEquipment(this.#equipment),
    };
  }

  setName(name: string): void {
    const next = name.trim();
    if (!next || next === this.#name) return;
    this.#name = next;
    this.emit();
  }

  subscribe(listener: (snapshot: PlayerSnapshot) => void): () => void {
    this.#listeners.add(listener);
    listener(this.snapshot);
    return () => this.#listeners.delete(listener);
  }

  /** Atomically spends free offline points and emits one consistent snapshot. */
  allocatePrimaryAttribute(attribute: PrimaryAttribute, amount = 1): boolean {
    if (!isPrimaryAttribute(attribute) || !Number.isInteger(amount) || amount <= 0) return false;
    if (this.#hp <= 0 || this.#freeAttributePoints < amount) return false;
    const current = this.#primaryAttributes[attribute];
    if (!Number.isSafeInteger(current + amount)) return false;
    this.#primaryAttributes[attribute] = current + amount;
    this.#freeAttributePoints -= amount;
    this.emit();
    return true;
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
    const initialAttack = this.#attack;
    this.#experience += experienceAdded;
    this.#coins += coinsAdded;
    while (this.#level < MAX_CLASSIC_LEVEL) {
      const cumulativeThreshold = classicCumulativeExperienceAt(this.#level);
      if (this.#experience < cumulativeThreshold) break;
      this.#level++;
      this.#maxHp += 22 + Math.floor(this.#level * 1.4);
      this.#maxMp += 12 + Math.floor(this.#level * 0.8);
      // Mock autoritativo do frontend enquanto o servidor está fora do escopo.
      this.#attack += OFFLINE_ATTACK_PER_LEVEL;
      this.#defense += 2;
      this.#freeAttributePoints += this.#attributePointsPerLevel;
      this.#hp = this.#maxHp;
      this.#mp = this.#maxMp;
    }
    this.emit();
    const levelsGained = this.#level - initialLevel;
    return {
      levelsGained,
      levelUps: levelsGained,
      experienceAdded,
      coinsAdded,
      attackGained: this.#attack - initialAttack,
      attributePointsGained: levelsGained * this.#attributePointsPerLevel,
    };
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

  /** Moves, merges or swaps two positions in the flattened four-bag inventory. */
  moveInventoryItem(from: number, to: number): boolean {
    if (!isInventorySlot(from) || !isInventorySlot(to)) return false;
    return this.moveStack(this.#inventory, from, this.#inventory, to);
  }

  /**
   * Moves, merges or swaps two of the 120 visible cargo positions.
   * Cargo is an offline/session-only frontend mirror; no persistence, gold,
   * tax or server transaction is implied by this operation.
   */
  moveCargoItem(from: number, to: number): boolean {
    if (!isCargoSlot(from) || !isCargoSlot(to)) return false;
    return this.moveStack(this.#cargo, from, this.#cargo, to);
  }

  /** Atomically moves, merges or swaps an inventory stack into visible cargo. */
  transferInventoryToCargo(inventorySlot: number, cargoSlot: number): boolean {
    if (!isInventorySlot(inventorySlot) || !isCargoSlot(cargoSlot)) return false;
    return this.moveStack(this.#inventory, inventorySlot, this.#cargo, cargoSlot);
  }

  /** Atomically moves, merges or swaps a visible cargo stack into inventory. */
  transferCargoToInventory(cargoSlot: number, inventorySlot: number): boolean {
    if (!isCargoSlot(cargoSlot) || !isInventorySlot(inventorySlot)) return false;
    return this.moveStack(this.#cargo, cargoSlot, this.#inventory, inventorySlot);
  }

  /** Equips an item and atomically puts the previous occupant back in its bag slot. */
  equipInventorySlot(slot: number): boolean {
    if (!isInventorySlot(slot)) return false;
    const stack = this.#inventory[slot];
    const equipmentSlot = stack?.item.equipSlot;
    if (
      !stack
      || stack.item.kind !== "equipment"
      || !isEquipmentSlot(equipmentSlot)
    ) return false;

    const previouslyEquipped = this.#equipment[equipmentSlot];
    this.#equipment[equipmentSlot] = stack;
    this.#inventory[slot] = previouslyEquipped;
    this.emit();
    return true;
  }

  /**
   * Returns an equipped item to a preferred free position, or the first free
   * position in any bag. A full inventory leaves both sides untouched.
   */
  unequipEquipmentSlot(slot: EquipmentSlot, preferredBagSlot?: number): boolean {
    if (!isEquipmentSlot(slot)) return false;
    if (preferredBagSlot !== undefined && !isInventorySlot(preferredBagSlot)) return false;
    const equipped = this.#equipment[slot];
    if (!equipped) return false;

    const destination = preferredBagSlot !== undefined && !this.#inventory[preferredBagSlot]
      ? preferredBagSlot
      : this.#inventory.findIndex((stack) => stack === null);
    if (destination < 0) return false;

    this.#inventory[destination] = equipped;
    this.#equipment[slot] = null;
    this.emit();
    return true;
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

  /**
   * Synchronous container transaction used by inventory and session cargo.
   * All validation happens before this helper; it commits a transfer, merge or
   * swap before emitting exactly one snapshot, so no intermediate state leaks.
   */
  private moveStack(
    sourceSlots: (InventoryStack | null)[],
    sourceIndex: number,
    destinationSlots: (InventoryStack | null)[],
    destinationIndex: number,
  ): boolean {
    const source = sourceSlots[sourceIndex];
    if (!source) return false;
    if (sourceSlots === destinationSlots && sourceIndex === destinationIndex) return true;

    const destination = destinationSlots[destinationIndex];
    if (!destination) {
      destinationSlots[destinationIndex] = source;
      sourceSlots[sourceIndex] = null;
      this.emit();
      return true;
    }

    if (destination.item.key === source.item.key) {
      const maxStack = normalizedMaxStack(destination.item.maxStack);
      const moved = Math.min(source.quantity, Math.max(0, maxStack - destination.quantity));
      if (moved > 0) {
        destination.quantity += moved;
        source.quantity -= moved;
        if (source.quantity <= 0) sourceSlots[sourceIndex] = null;
        this.emit();
        return true;
      }
    }

    sourceSlots[sourceIndex] = destination;
    destinationSlots[destinationIndex] = source;
    this.emit();
    return true;
  }

  private emit(): void {
    const snapshot = this.snapshot;
    for (const listener of this.#listeners) listener(snapshot);
  }
}

function clampReward(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function clampWholeNumber(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function isPrimaryAttribute(value: string): value is PrimaryAttribute {
  return value === "str" || value === "int" || value === "dex" || value === "con";
}

function isInventorySlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 0 && slot < INVENTORY_SIZE;
}

function isCargoSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 0 && slot < CARGO_VISIBLE_SIZE;
}

function normalizedMaxStack(maxStack: number): number {
  if (!Number.isFinite(maxStack)) return 1;
  return Math.max(1, Math.trunc(maxStack));
}

function isEquipmentSlot(value: unknown): value is EquipmentSlot {
  return typeof value === "string" && (EQUIPMENT_SLOTS as readonly string[]).includes(value);
}

function createEmptyEquipment(): Record<EquipmentSlot, InventoryStack | null> {
  return Object.fromEntries(EQUIPMENT_SLOTS.map((slot) => [slot, null])) as Record<
    EquipmentSlot,
    InventoryStack | null
  >;
}

function snapshotEquipment(
  equipment: Readonly<Record<EquipmentSlot, InventoryStack | null>>,
): EquipmentSnapshot {
  const snapshot = createEmptyEquipment();
  for (const slot of EQUIPMENT_SLOTS) {
    const stack = equipment[slot];
    snapshot[slot] = stack ? { item: stack.item, quantity: stack.quantity } : null;
  }
  return snapshot;
}

function classicCumulativeExperienceAt(levelIndex: number): number {
  const index = Math.max(0, Math.min(CLASSIC_CUMULATIVE_EXPERIENCE.length - 1, Math.trunc(levelIndex)));
  return CLASSIC_CUMULATIVE_EXPERIENCE[index] ?? 0;
}
