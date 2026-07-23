import type { ClassicAssetSource } from "../../assets/ClassicAssetSource";
import { FIELD_WORLD_SIZE } from "../../world/coordinates";
import { fieldKey } from "../../world/regions";

export type MonsterScore = readonly number[];
export type MonsterVisualPart = readonly [
  part: number,
  item: number,
  meshIndex: number,
  textureIndex: number,
  mesh: string,
  texture: string | null,
  /** MeshTextureList cAlpha: C disables alpha test in the classic CMesh. */
  alpha: string | null,
];

export interface MonsterTemplateVisual {
  readonly skin: number;
  readonly itemClass: number;
  readonly parts: readonly MonsterVisualPart[];
}

export interface MonsterTemplate {
  readonly key: string;
  readonly name: string;
  readonly missing?: boolean;
  readonly databaseFile?: string;
  readonly clan?: number;
  readonly merchant?: number;
  readonly guild?: number;
  readonly characterClass?: number;
  readonly coin?: number;
  readonly experience?: number;
  readonly home?: readonly [number, number];
  readonly baseScore?: MonsterScore;
  readonly currentScore?: MonsterScore;
  /** Sixteen seven-value item records, using the schema in catalog.equipment. */
  readonly equipment?: readonly number[];
  readonly learnedSkill?: number;
  readonly bonuses?: readonly number[];
  readonly visual?: MonsterTemplateVisual;
}

export interface MonsterVisualFamily {
  readonly base: string;
  readonly declaredParts: number;
  readonly meshParts: readonly number[];
  readonly skeleton: string | null;
  /** ValidIndex order; action tables address this array by slot. */
  readonly clips: readonly (string | null)[];
  readonly actionSet?: string;
  readonly actions?: Readonly<Record<string, readonly number[]>>;
}

export interface CatalogSkinnedObjectVariant {
  readonly mesh0: number;
  readonly skin0: number;
  readonly mesh: string;
  readonly texture: string | null;
  readonly alpha: string | null;
  /** Classic TMLeaf uses texture 10 in the Hekalotia field rectangle. */
  readonly regionalTexture?: string | null;
  readonly regionalAlpha?: string | null;
}

export interface CatalogSkinnedObject {
  readonly kind: "tree" | "leaf" | "ship" | "butterfly" | "fish" | "float";
  readonly skin: number;
  readonly variants: readonly CatalogSkinnedObjectVariant[];
}

export interface MonsterRoutePoint {
  readonly x: number | null;
  readonly y: number | null;
  readonly range: number;
  readonly wait: number;
  readonly action: number | null;
}

export interface MonsterGenerator {
  readonly id: number;
  readonly minuteGenerate: number | null;
  readonly maxNumMob: number;
  readonly minGroup: number;
  readonly maxGroup: number;
  readonly leaderTemplate: number;
  readonly followerTemplate: number;
  readonly routeType: number;
  readonly formation: number;
  readonly start: MonsterRoutePoint;
  readonly segments: readonly MonsterRoutePoint[];
  readonly destination: MonsterRoutePoint;
}

interface RawMonsterCatalog {
  readonly version: number;
  readonly generatorColumns: readonly string[];
  readonly templates: readonly MonsterTemplate[];
  readonly items: readonly {
    readonly index: number;
    readonly name: string;
    readonly mesh: number;
    readonly texture: number;
    readonly visualEffect: number;
    readonly itemClass: number | null;
  }[];
  readonly visualFamilies: Readonly<Record<string, MonsterVisualFamily>>;
  readonly skinnedObjects?: Readonly<Record<string, CatalogSkinnedObject>>;
  readonly generators: readonly (readonly (number | null)[])[];
  readonly unresolvedTemplates: readonly string[];
}

const catalogJobs = new WeakMap<ClassicAssetSource, Promise<MonsterCatalog>>();

/** Typed, indexed view over the compact importer JSON. */
export class MonsterCatalog {
  readonly templates: readonly MonsterTemplate[];
  readonly items: RawMonsterCatalog["items"];
  readonly generators: readonly MonsterGenerator[];
  readonly unresolvedTemplates: readonly string[];
  readonly #families = new Map<number, MonsterVisualFamily>();
  readonly #skinnedObjects = new Map<number, CatalogSkinnedObject>();
  readonly #generatorsByField = new Map<string, MonsterGenerator[]>();

  private constructor(raw: RawMonsterCatalog) {
    this.templates = raw.templates;
    this.items = raw.items;
    this.unresolvedTemplates = raw.unresolvedTemplates;
    for (const [skin, family] of Object.entries(raw.visualFamilies)) this.#families.set(Number(skin), family);
    for (const [type, look] of Object.entries(raw.skinnedObjects ?? {})) this.#skinnedObjects.set(Number(type), look);

    const column = new Map(raw.generatorColumns.map((name, index) => [name, index]));
    this.generators = raw.generators.map((row) => decodeGenerator(row, column));
    for (const generator of this.generators) {
      if (generator.start.x === null || generator.start.y === null) continue;
      const key = fieldKey(
        Math.floor(generator.start.x / FIELD_WORLD_SIZE),
        Math.floor(generator.start.y / FIELD_WORLD_SIZE),
      );
      const fieldGenerators = this.#generatorsByField.get(key) ?? [];
      fieldGenerators.push(generator);
      this.#generatorsByField.set(key, fieldGenerators);
    }
  }

  static async load(assets: ClassicAssetSource): Promise<MonsterCatalog> {
    const cached = catalogJobs.get(assets);
    if (cached) return cached;

    // Spawn, environment, player, familiar and mount all consume the same
    // immutable 850 KB catalog. Sharing the fetch + parsed object avoids five
    // simultaneous JSON graphs during the mobile boot.
    const job = (async () => {
      const response = await fetch(assets.dataUrl(assets.manifest.monsters.catalog));
      if (!response.ok) throw new Error(`Falha ao carregar catalogo de monstros (${response.status})`);
      const raw = await response.json() as RawMonsterCatalog;
      if (raw.version !== 1 || !Array.isArray(raw.generators) || !Array.isArray(raw.templates)) {
        throw new Error("Catalogo de monstros invalido");
      }
      return new MonsterCatalog(raw);
    })();
    catalogJobs.set(assets, job);
    void job.catch(() => {
      if (catalogJobs.get(assets) === job) catalogJobs.delete(assets);
    });
    return job;
  }

  template(index: number): MonsterTemplate | null {
    return this.templates[index] ?? null;
  }

  visualFamily(skin: number): MonsterVisualFamily | null {
    return this.#families.get(skin) ?? null;
  }

  skinnedObject(type: number): CatalogSkinnedObject | null {
    return this.#skinnedObjects.get(type) ?? null;
  }

  generatorsForField(column: number, row: number): readonly MonsterGenerator[] {
    return this.#generatorsByField.get(fieldKey(column, row)) ?? [];
  }

  hasGenerators(column: number, row: number): boolean {
    return this.#generatorsByField.has(fieldKey(column, row));
  }
}

function decodeGenerator(row: readonly (number | null)[], columns: ReadonlyMap<string, number>): MonsterGenerator {
  const value = (name: string, fallback = 0): number => {
    const index = columns.get(name);
    const result = index === undefined ? null : row[index];
    return typeof result === "number" && Number.isFinite(result) ? result : fallback;
  };
  const nullable = (name: string): number | null => {
    const index = columns.get(name);
    const result = index === undefined ? null : row[index];
    return typeof result === "number" && Number.isFinite(result) ? result : null;
  };
  const point = (prefix: string): MonsterRoutePoint => ({
    x: nullable(`${prefix}X`),
    y: nullable(`${prefix}Y`),
    range: value(`${prefix}Range`),
    wait: value(`${prefix}Wait`),
    action: nullable(`${prefix}Action`),
  });
  const segments = [point("Segment1"), point("Segment2"), point("Segment3")]
    .filter((entry) => entry.x !== null && entry.y !== null);
  return {
    id: value("id"),
    minuteGenerate: nullable("minuteGenerate"),
    maxNumMob: value("maxNumMob", 1),
    minGroup: value("minGroup"),
    maxGroup: value("maxGroup"),
    leaderTemplate: value("leaderTemplate", -1),
    followerTemplate: value("followerTemplate", -1),
    routeType: value("RouteType"),
    formation: value("Formation"),
    start: point("Start"),
    segments,
    destination: point("Dest"),
  };
}
