export const CLASSIC_ALCHEMY_CATALOG_URL = "/game-data/classic/ui/alchemy.json";

export interface ClassicAlchemyItem {
  readonly itemIndex: number;
  readonly effects: readonly {
    readonly effect: number;
    readonly value: number;
    readonly extendedValue: number;
  }[];
}

export interface ClassicAlchemyRequirement {
  readonly access: number;
  readonly index: number;
}

export interface ClassicAlchemyRecipe {
  readonly index: number;
  readonly npcHead: number;
  readonly npcX: number;
  readonly npcY: number;
  readonly result: ClassicAlchemyItem;
  readonly messageId: number;
  readonly requirements: readonly ClassicAlchemyRequirement[];
  readonly cost: number;
}

export interface ClassicAlchemyNeed {
  readonly index: number;
  readonly textId: number;
  readonly quantity: number;
  readonly item: ClassicAlchemyItem;
  readonly acceptedItemIndices: readonly number[];
  readonly classOptions: readonly number[];
  readonly positionOptions: readonly number[];
}

interface RawClassicAlchemyCatalog {
  readonly version: 1;
  readonly source: "Mixlist.bin";
  readonly recipes: readonly ClassicAlchemyRecipe[];
  readonly needs: readonly ClassicAlchemyNeed[];
}

let catalogJob: Promise<ClassicAlchemyCatalog> | null = null;

export class ClassicAlchemyCatalog {
  readonly recipes: readonly ClassicAlchemyRecipe[];
  readonly #needs: readonly ClassicAlchemyNeed[];

  private constructor(raw: RawClassicAlchemyCatalog) {
    this.recipes = Object.freeze(raw.recipes.map((recipe) => Object.freeze({
      ...recipe,
      result: freezeItem(recipe.result),
      requirements: Object.freeze(recipe.requirements.map((requirement) => Object.freeze({ ...requirement }))),
    })));
    this.#needs = Object.freeze(raw.needs.map((need) => Object.freeze({
      ...need,
      item: freezeItem(need.item),
      acceptedItemIndices: Object.freeze([...need.acceptedItemIndices]),
      classOptions: Object.freeze([...need.classOptions]),
      positionOptions: Object.freeze([...need.positionOptions]),
    })));
  }

  static load(): Promise<ClassicAlchemyCatalog> {
    if (catalogJob) return catalogJob;
    const job = fetch(CLASSIC_ALCHEMY_CATALOG_URL)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Falha ao carregar Mixlist.bin (${response.status})`);
        return new ClassicAlchemyCatalog(validateCatalog(await response.json()));
      });
    catalogJob = job;
    void job.catch(() => {
      if (catalogJob === job) catalogJob = null;
    });
    return job;
  }

  /** ResultItemListSet(0, 0, 0), including the #87 branch learned by default. */
  huntressRecipes(): readonly ClassicAlchemyRecipe[] {
    return this.recipes.filter((recipe) => (
      recipe.npcHead === 0
      && recipe.npcX === 0
      && recipe.npcY === 0
      && recipe.result.itemIndex > 0
    ));
  }

  need(index: number): ClassicAlchemyNeed | null {
    return Number.isInteger(index) && index >= 0 ? this.#needs[index] ?? null : null;
  }
}

export function loadClassicAlchemyCatalog(): Promise<ClassicAlchemyCatalog> {
  return ClassicAlchemyCatalog.load();
}

function freezeItem(item: ClassicAlchemyItem): ClassicAlchemyItem {
  return Object.freeze({
    itemIndex: item.itemIndex,
    effects: Object.freeze(item.effects.map((effect) => Object.freeze({ ...effect }))),
  });
}

function validateCatalog(value: unknown): RawClassicAlchemyCatalog {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Catálogo de alquimia inválido");
  const raw = value as Partial<RawClassicAlchemyCatalog>;
  if (raw.version !== 1 || raw.source !== "Mixlist.bin") throw new Error("Versão de alquimia inválida");
  if (!Array.isArray(raw.recipes) || raw.recipes.length !== 100) throw new Error("Mixlist sem 100 receitas");
  if (!Array.isArray(raw.needs) || raw.needs.length !== 100) throw new Error("Mixlist sem 100 requisitos");
  return raw as RawClassicAlchemyCatalog;
}
