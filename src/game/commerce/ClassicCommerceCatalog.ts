export const CLASSIC_COMMERCE_CATALOG_URL = "/game-data/classic/commerce/catalog.json";

const CLASSIC_ITEM_COUNT = 6500;
const CLASSIC_SHOP_SLOT_COUNT = 27;
const CLASSIC_SHOP_CARRY_SLOTS = Object.freeze([
  0, 1, 2, 3, 4, 5, 6, 7, 8,
  27, 28, 29, 30, 31, 32, 33, 34, 35,
  54, 55, 56, 57, 58, 59, 60, 61, 62,
] as const);

export interface ClassicCommerceItemEffect {
  readonly effect: number;
  readonly value: number;
}

export interface ClassicCommerceCarryEffect extends ClassicCommerceItemEffect {
  /** Signed view of the exact two-byte STRUCT_BONUSEFFECT union. */
  readonly packed: number;
}

export interface ClassicCommerceItemRequirements {
  readonly level: number;
  readonly strength: number;
  readonly intelligence: number;
  readonly dexterity: number;
  readonly constitution: number;
}

/**
 * A value recovered from static classic-client data. It is never a purchase
 * quote and deliberately carries no tax, balance or transaction semantics.
 */
export interface ClassicStaticDisplayPrice {
  readonly amount: number;
  readonly authoritative: false;
  readonly usage: "display-only";
  readonly source: "ItemList.bin" | "classic-client-overrides";
}

export interface ClassicCommerceItem {
  readonly index: number;
  readonly name: string;
  readonly mesh: number;
  readonly texture: number;
  readonly visualEffect: number;
  readonly requirements: ClassicCommerceItemRequirements;
  readonly effects: readonly ClassicCommerceItemEffect[];
  readonly unique: number;
  readonly reserved: number;
  readonly position: number;
  readonly extra: number;
  readonly link: number;
  readonly grade: number;
  readonly staticBasePrice: ClassicStaticDisplayPrice;
  readonly staticDisplayPrice: ClassicStaticDisplayPrice;
}

export interface ClassicCommerceNpcTemplate {
  readonly templateKey: string;
  readonly name: string;
  readonly databaseFile: string;
  readonly merchantByte: number;
  /** Low-nibble role inferred from the recovered Merchant/Reserved corpus. */
  readonly inferredMerchantRole: number;
  readonly clientReservedByte: number;
  readonly inferredClientReservedRole: number;
  readonly merchantReservedRoleMatch: boolean;
  readonly inferredOrdinaryShop: boolean;
  readonly stockCount: number;
}

export interface ClassicResolvedCarrySlot {
  readonly displayIndex: number;
  readonly displayX: number;
  readonly displayY: number;
  readonly carrySlot: number;
  readonly itemIndex: number | null;
  readonly effects: readonly ClassicCommerceCarryEffect[];
  readonly item: ClassicCommerceItem | null;
  /** Static client display data only; never an authoritative purchase quote. */
  readonly staticDisplayPrice: ClassicStaticDisplayPrice | null;
}

export interface ClassicResolvedTemplateCarry {
  readonly template: ClassicCommerceNpcTemplate;
  /** Always the complete classic 27-entry display, including empty slots. */
  readonly slots: readonly ClassicResolvedCarrySlot[];
}

interface RawCatalogItemEffect {
  readonly effect: number;
  readonly value: number;
}

interface RawCatalogCarryEffect extends RawCatalogItemEffect {
  readonly packed: number;
}

interface RawCatalogItem {
  readonly index: number;
  readonly name: string;
  readonly mesh: number;
  readonly texture: number;
  readonly visualEffect: number;
  readonly requirements: ClassicCommerceItemRequirements;
  readonly effects: readonly RawCatalogItemEffect[];
  readonly basePrice: number;
  readonly price: number;
  readonly clientStaticPriceOverride: number | null;
  readonly itemPriceOverride: { readonly record: number; readonly price: number } | null;
  readonly unique: number;
  readonly reserved?: number;
  readonly position: number;
  readonly extra: number;
  readonly link?: number;
  readonly grade: number;
}

interface RawCatalogCarryItem {
  readonly itemIndex: number;
  readonly effects: readonly RawCatalogCarryEffect[];
}

interface RawCatalogTemplate {
  readonly key: string;
  readonly databaseFile: string;
  readonly name: string;
  readonly merchant: number;
  readonly merchantRole: number;
  readonly currentScoreReserved: number;
  readonly clientReservedRole: number;
  readonly merchantReservedRoleMatch: boolean;
  readonly ordinaryShopCandidate: boolean;
  readonly stockCount: number;
  readonly carry: readonly (RawCatalogCarryItem | null)[];
}

interface RawCarryLayoutSlot {
  readonly displayIndex: number;
  readonly displayX: number;
  readonly displayY: number;
  readonly carrySlot: number;
}

interface RawCommerceCatalog {
  readonly version: number;
  readonly counts: {
    readonly items: number;
    readonly commerceRelevantNpcTemplates: number;
    readonly ordinaryShopCandidates: number;
  };
  readonly shopCarryLayout: {
    readonly displayEntries: number;
    readonly packetEntries: number;
    readonly displayGridColumns: number;
    readonly slots: readonly RawCarryLayoutSlot[];
  };
  readonly items: readonly RawCatalogItem[];
  readonly npcTemplates: readonly RawCatalogTemplate[];
}

let catalogJob: Promise<ClassicCommerceCatalog> | null = null;
const EMPTY_CARRY_EFFECTS = Object.freeze([]) as readonly ClassicCommerceCarryEffect[];

/**
 * Lazy, cached and read-only view of the classic commerce catalog.
 * Importing this module performs no network request; callers must invoke
 * `load()` (or `loadClassicCommerceCatalog()`) explicitly.
 */
export class ClassicCommerceCatalog {
  readonly #items: readonly ClassicCommerceItem[];
  readonly #templatesByKey: ReadonlyMap<string, ClassicCommerceNpcTemplate>;
  readonly #carryByTemplateKey: ReadonlyMap<string, ClassicResolvedTemplateCarry>;

  private constructor(raw: RawCommerceCatalog) {
    const items = raw.items.map(normalizeItem);
    this.#items = Object.freeze(items);

    const templatesByKey = new Map<string, ClassicCommerceNpcTemplate>();
    const carryByTemplateKey = new Map<string, ClassicResolvedTemplateCarry>();
    const layout = raw.shopCarryLayout.slots;

    for (const rawTemplate of raw.npcTemplates) {
      const template = Object.freeze<ClassicCommerceNpcTemplate>({
        templateKey: rawTemplate.key,
        name: rawTemplate.name,
        databaseFile: rawTemplate.databaseFile,
        merchantByte: rawTemplate.merchant,
        inferredMerchantRole: rawTemplate.merchantRole,
        clientReservedByte: rawTemplate.currentScoreReserved,
        inferredClientReservedRole: rawTemplate.clientReservedRole,
        merchantReservedRoleMatch: rawTemplate.merchantReservedRoleMatch,
        inferredOrdinaryShop: rawTemplate.ordinaryShopCandidate,
        stockCount: rawTemplate.stockCount,
      });
      const slots = rawTemplate.carry.map((entry, index) => {
        const slotLayout = layout[index];
        if (!slotLayout) throw new Error(`Catalogo de comercio sem layout para o slot ${index}`);
        if (!entry) {
          return Object.freeze<ClassicResolvedCarrySlot>({
            ...slotLayout,
            itemIndex: null,
            effects: EMPTY_CARRY_EFFECTS,
            item: null,
            staticDisplayPrice: null,
          });
        }

        const item = items[entry.itemIndex];
        if (!item) throw new Error(`${rawTemplate.key}: item Carry ${entry.itemIndex} inexistente`);
        const effects = Object.freeze(entry.effects.map((effect) => Object.freeze({ ...effect })));
        return Object.freeze<ClassicResolvedCarrySlot>({
          ...slotLayout,
          itemIndex: entry.itemIndex,
          effects,
          item,
          staticDisplayPrice: item.staticDisplayPrice,
        });
      });
      const resolved = Object.freeze<ClassicResolvedTemplateCarry>({
        template,
        slots: Object.freeze(slots),
      });
      templatesByKey.set(template.templateKey, template);
      carryByTemplateKey.set(template.templateKey, resolved);
    }

    this.#templatesByKey = templatesByKey;
    this.#carryByTemplateKey = carryByTemplateKey;
  }

  static load(): Promise<ClassicCommerceCatalog> {
    if (catalogJob) return catalogJob;

    const job = (async () => {
      const response = await fetch(CLASSIC_COMMERCE_CATALOG_URL);
      if (!response.ok) {
        throw new Error(`Falha ao carregar catalogo de comercio classico (${response.status})`);
      }
      const raw = validateRawCatalog(await response.json());
      return new ClassicCommerceCatalog(raw);
    })();
    catalogJob = job;
    void job.catch(() => {
      if (catalogJob === job) catalogJob = null;
    });
    return job;
  }

  get itemCount(): number {
    return this.#items.length;
  }

  get templateCount(): number {
    return this.#templatesByKey.size;
  }

  item(index: number): ClassicCommerceItem | null {
    if (!Number.isInteger(index) || index < 0) return null;
    return this.#items[index] ?? null;
  }

  template(templateKey: string): ClassicCommerceNpcTemplate | null {
    return this.#templatesByKey.get(templateKey) ?? null;
  }

  resolveCarry(templateKey: string): ClassicResolvedTemplateCarry | null {
    return this.#carryByTemplateKey.get(templateKey) ?? null;
  }
}

/** Explicit lazy entry point; this function is the only intended boot boundary. */
export function loadClassicCommerceCatalog(): Promise<ClassicCommerceCatalog> {
  return ClassicCommerceCatalog.load();
}

function normalizeItem(raw: RawCatalogItem): ClassicCommerceItem {
  const hasClientOverride = raw.clientStaticPriceOverride !== null || raw.itemPriceOverride !== null;
  const requirements = Object.freeze({ ...raw.requirements });
  const effects = Object.freeze(raw.effects.map((effect) => Object.freeze({ ...effect })));
  return Object.freeze({
    index: raw.index,
    name: raw.name,
    mesh: raw.mesh,
    texture: raw.texture,
    visualEffect: raw.visualEffect,
    requirements,
    effects,
    unique: raw.unique,
    reserved: raw.reserved ?? 0,
    position: raw.position,
    extra: raw.extra,
    link: raw.link ?? 0,
    grade: raw.grade,
    staticBasePrice: staticDisplayPrice(raw.basePrice, "ItemList.bin"),
    staticDisplayPrice: staticDisplayPrice(
      raw.price,
      hasClientOverride ? "classic-client-overrides" : "ItemList.bin",
    ),
  });
}

function staticDisplayPrice(
  amount: number,
  source: ClassicStaticDisplayPrice["source"],
): ClassicStaticDisplayPrice {
  return Object.freeze({
    amount,
    authoritative: false,
    usage: "display-only",
    source,
  });
}

function validateRawCatalog(value: unknown): RawCommerceCatalog {
  const catalog = expectRecord(value, "catalogo");
  expectInteger(catalog.version, "catalogo.version", 1, 1);
  const counts = expectRecord(catalog.counts, "catalogo.counts");
  expectInteger(counts.items, "catalogo.counts.items", CLASSIC_ITEM_COUNT, CLASSIC_ITEM_COUNT);
  const declaredTemplates = expectInteger(
    counts.commerceRelevantNpcTemplates,
    "catalogo.counts.commerceRelevantNpcTemplates",
    0,
  );
  expectInteger(counts.ordinaryShopCandidates, "catalogo.counts.ordinaryShopCandidates", 0);

  const items = expectArray(catalog.items, "catalogo.items");
  if (items.length !== CLASSIC_ITEM_COUNT) {
    throw new Error(`Catalogo de comercio invalido: items possui ${items.length}, esperado ${CLASSIC_ITEM_COUNT}`);
  }
  for (let index = 0; index < items.length; index++) validateItem(items[index], index);

  const layout = expectRecord(catalog.shopCarryLayout, "catalogo.shopCarryLayout");
  expectInteger(layout.displayEntries, "catalogo.shopCarryLayout.displayEntries", CLASSIC_SHOP_SLOT_COUNT, CLASSIC_SHOP_SLOT_COUNT);
  expectInteger(layout.packetEntries, "catalogo.shopCarryLayout.packetEntries", CLASSIC_SHOP_SLOT_COUNT, CLASSIC_SHOP_SLOT_COUNT);
  expectInteger(layout.displayGridColumns, "catalogo.shopCarryLayout.displayGridColumns", 5, 5);
  const layoutSlots = expectArray(layout.slots, "catalogo.shopCarryLayout.slots");
  if (layoutSlots.length !== CLASSIC_SHOP_SLOT_COUNT) {
    throw new Error(`Catalogo de comercio invalido: layout possui ${layoutSlots.length} slots`);
  }
  for (let index = 0; index < layoutSlots.length; index++) {
    const slot = expectRecord(layoutSlots[index], `layout.slots[${index}]`);
    expectInteger(slot.displayIndex, `layout.slots[${index}].displayIndex`, index, index);
    expectInteger(slot.displayX, `layout.slots[${index}].displayX`, index % 5, index % 5);
    expectInteger(slot.displayY, `layout.slots[${index}].displayY`, Math.floor(index / 5), Math.floor(index / 5));
    const expectedCarrySlot = CLASSIC_SHOP_CARRY_SLOTS[index];
    if (expectedCarrySlot === undefined) throw new Error(`Mapa Carry interno ausente em ${index}`);
    expectInteger(slot.carrySlot, `layout.slots[${index}].carrySlot`, expectedCarrySlot, expectedCarrySlot);
  }

  const templates = expectArray(catalog.npcTemplates, "catalogo.npcTemplates");
  if (templates.length !== declaredTemplates) {
    throw new Error(`Catalogo de comercio invalido: ${templates.length} templates, declarados ${declaredTemplates}`);
  }
  const templateKeys = new Set<string>();
  for (let index = 0; index < templates.length; index++) {
    const key = validateTemplate(templates[index], index);
    if (templateKeys.has(key)) throw new Error(`Catalogo de comercio invalido: template duplicado ${key}`);
    templateKeys.add(key);
  }

  return value as RawCommerceCatalog;
}

function validateItem(value: unknown, expectedIndex: number): void {
  const item = expectRecord(value, `items[${expectedIndex}]`);
  expectInteger(item.index, `items[${expectedIndex}].index`, expectedIndex, expectedIndex);
  expectString(item.name, `items[${expectedIndex}].name`);
  for (const field of ["mesh", "texture", "visualEffect", "basePrice", "price", "unique", "position", "extra", "grade"] as const) {
    expectInteger(item[field], `items[${expectedIndex}].${field}`);
  }
  if (item.reserved !== undefined) expectInteger(item.reserved, `items[${expectedIndex}].reserved`);
  if (item.link !== undefined) expectInteger(item.link, `items[${expectedIndex}].link`);
  const requirements = expectRecord(item.requirements, `items[${expectedIndex}].requirements`);
  for (const field of ["level", "strength", "intelligence", "dexterity", "constitution"] as const) {
    expectInteger(requirements[field], `items[${expectedIndex}].requirements.${field}`);
  }
  const effects = expectArray(item.effects, `items[${expectedIndex}].effects`);
  if (effects.length !== 12) throw new Error(`Catalogo de comercio invalido: item ${expectedIndex} sem 12 efeitos`);
  for (let effectIndex = 0; effectIndex < effects.length; effectIndex++) {
    const effect = expectRecord(effects[effectIndex], `items[${expectedIndex}].effects[${effectIndex}]`);
    expectInteger(effect.effect, `items[${expectedIndex}].effects[${effectIndex}].effect`);
    expectInteger(effect.value, `items[${expectedIndex}].effects[${effectIndex}].value`);
  }
  if (item.clientStaticPriceOverride !== null) {
    expectInteger(item.clientStaticPriceOverride, `items[${expectedIndex}].clientStaticPriceOverride`);
  }
  if (item.itemPriceOverride !== null) {
    const override = expectRecord(item.itemPriceOverride, `items[${expectedIndex}].itemPriceOverride`);
    expectInteger(override.record, `items[${expectedIndex}].itemPriceOverride.record`, 0);
    expectInteger(override.price, `items[${expectedIndex}].itemPriceOverride.price`);
  }
}

function validateTemplate(value: unknown, index: number): string {
  const template = expectRecord(value, `npcTemplates[${index}]`);
  const key = expectString(template.key, `npcTemplates[${index}].key`);
  expectString(template.databaseFile, `npcTemplates[${index}].databaseFile`);
  expectString(template.name, `npcTemplates[${index}].name`);
  for (const field of ["merchant", "merchantRole", "currentScoreReserved", "clientReservedRole", "stockCount"] as const) {
    expectInteger(template[field], `npcTemplates[${index}].${field}`, 0);
  }
  for (const field of ["merchantReservedRoleMatch", "ordinaryShopCandidate"] as const) {
    if (typeof template[field] !== "boolean") {
      throw new Error(`Catalogo de comercio invalido: npcTemplates[${index}].${field}`);
    }
  }
  const carry = expectArray(template.carry, `npcTemplates[${index}].carry`);
  if (carry.length !== CLASSIC_SHOP_SLOT_COUNT) {
    throw new Error(`Catalogo de comercio invalido: ${key} possui ${carry.length} slots Carry`);
  }
  for (let slot = 0; slot < carry.length; slot++) {
    const entry = carry[slot];
    if (entry === null) continue;
    const item = expectRecord(entry, `${key}.carry[${slot}]`);
    expectInteger(item.itemIndex, `${key}.carry[${slot}].itemIndex`, 1, CLASSIC_ITEM_COUNT - 1);
    const effects = expectArray(item.effects, `${key}.carry[${slot}].effects`);
    if (effects.length !== 3) throw new Error(`Catalogo de comercio invalido: ${key}.carry[${slot}] sem 3 efeitos`);
    for (let effectIndex = 0; effectIndex < effects.length; effectIndex++) {
      const effect = expectRecord(effects[effectIndex], `${key}.carry[${slot}].effects[${effectIndex}]`);
      expectInteger(effect.effect, `${key}.carry[${slot}].effects[${effectIndex}].effect`, 0, 255);
      expectInteger(effect.value, `${key}.carry[${slot}].effects[${effectIndex}].value`, 0, 255);
      expectInteger(effect.packed, `${key}.carry[${slot}].effects[${effectIndex}].packed`, -32768, 32767);
    }
  }
  return key;
}

function expectRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Catalogo de comercio invalido: ${field}`);
  }
  return value as Record<string, unknown>;
}

function expectArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`Catalogo de comercio invalido: ${field}`);
  return value;
}

function expectString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`Catalogo de comercio invalido: ${field}`);
  return value;
}

function expectInteger(value: unknown, field: string, minimum = -Infinity, maximum = Infinity): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`Catalogo de comercio invalido: ${field}`);
  }
  return value as number;
}
