import type { TrnBlock } from "../formats/classic/Trn";
import { parseTrn } from "../formats/classic/Trn";
import type { MapObjectRecord } from "../formats/classic/Dat";
import { parseDat } from "../formats/classic/Dat";
import {
  parseAttributeMap,
  parseObjectMasks,
  type ClassicNavigationData,
} from "../formats/classic/NavigationData";

export interface ClassicNavigationAssetEntry {
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface ClassicManifest {
  readonly defaultMap: string;
  readonly maps: Record<string, { readonly label: string; readonly spawn: readonly [number, number]; readonly centerBlock: readonly [number, number] }>;
  readonly fields: readonly { readonly file: string; readonly column: number; readonly row: number; readonly objectFile?: string; readonly minimapFile?: string }[];
  readonly textures: Record<string, { readonly file: string; readonly alpha: string }>;
  readonly effectTextures: Record<string, { readonly file: string; readonly alpha: string }>;
  readonly waterTextures: Record<string, { readonly file: string; readonly alpha: string }>;
  readonly objectModels: Record<string, { readonly file: string; readonly textures: readonly (string | null)[] }>;
  readonly navigation: {
    readonly attributeMap: ClassicNavigationAssetEntry & { readonly baseChecksum: number };
    readonly objectMasks: ClassicNavigationAssetEntry & { readonly encryptedChecksum: number };
  };
  readonly monsters: {
    readonly catalog: string;
    readonly skeletons: string;
    readonly meshes: string;
    readonly animations: string;
    readonly textures: string;
  };
}

export class ClassicAssetSource {
  static readonly base = "/game-data/classic";
  #navigationJob: Promise<ClassicNavigationData> | null = null;
  constructor(readonly manifest: ClassicManifest) {}

  static async load(): Promise<ClassicAssetSource> {
    const response = await fetch(`${ClassicAssetSource.base}/manifest.json`);
    if (!response.ok) throw new Error("Assets não importados. Execute: bun run import:classic");
    return new ClassicAssetSource(await response.json() as ClassicManifest);
  }

  async loadField(file: string): Promise<TrnBlock> {
    const response = await fetch(`${ClassicAssetSource.base}/fields/${file}`);
    if (!response.ok) throw new Error(`Falha ao carregar ${file}`);
    return parseTrn(await response.arrayBuffer());
  }

  textureUrl(index: number): string | null {
    const entry = this.manifest.textures[String(index)];
    return entry ? `${ClassicAssetSource.base}/${entry.file}` : null;
  }

  effectTextureUrl(index: number): string | null {
    const entry = this.manifest.effectTextures[String(index)];
    return entry ? `${ClassicAssetSource.base}/${entry.file}` : null;
  }

  waterTextureUrl(index: number): string | null {
    const entry = this.manifest.waterTextures[String(index)];
    return entry ? `${ClassicAssetSource.base}/${entry.file}` : null;
  }

  async loadObjects(file: string): Promise<readonly MapObjectRecord[]> {
    const response = await fetch(`${ClassicAssetSource.base}/objects/${file}`);
    if (!response.ok) throw new Error(`Falha ao carregar ${file}`);
    return parseDat(await response.arrayBuffer());
  }

  /** Loaded and validated once; per-Field mask composition remains in ClassicWorld. */
  loadNavigation(): Promise<ClassicNavigationData> {
    if (!this.#navigationJob) {
      const { attributeMap, objectMasks } = this.manifest.navigation;
      this.#navigationJob = Promise.all([
        this.loadDataFile(attributeMap),
        this.loadDataFile(objectMasks),
      ]).then(([attributeBuffer, objectBuffer]) => ({
        attributes: parseAttributeMap(attributeBuffer, attributeMap.baseChecksum),
        objectMasks: parseObjectMasks(objectBuffer, objectMasks.encryptedChecksum),
      })).catch((error: unknown) => {
        this.#navigationJob = null;
        throw error;
      });
    }
    return this.#navigationJob;
  }

  async loadMinimap(file: string): Promise<ArrayBuffer> {
    const response = await fetch(`${ClassicAssetSource.base}/minimaps/${file}`);
    if (!response.ok) throw new Error(`Falha ao carregar ${file}`);
    return response.arrayBuffer();
  }

  async loadModel(type: number): Promise<{ buffer: ArrayBuffer; textures: readonly (string | null)[] } | null> {
    const entry = this.manifest.objectModels[String(type)];
    if (!entry) return null;
    const response = await fetch(`${ClassicAssetSource.base}/${entry.file}`);
    if (!response.ok) throw new Error(`Falha ao carregar modelo ${type}`);
    return { buffer: await response.arrayBuffer(), textures: entry.textures };
  }

  dataUrl(file: string): string {
    return `${ClassicAssetSource.base}/${file}`;
  }

  private async loadDataFile(entry: ClassicNavigationAssetEntry): Promise<ArrayBuffer> {
    const response = await fetch(this.dataUrl(entry.file));
    if (!response.ok) throw new Error(`Falha ao carregar ${entry.file}`);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength !== entry.bytes) {
      throw new Error(`${entry.file} possui ${buffer.byteLength} bytes; manifesto declara ${entry.bytes}`);
    }
    return buffer;
  }
}
