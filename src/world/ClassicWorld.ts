import * as THREE from "three";
import type { ClassicAssetSource } from "../assets/ClassicAssetSource";
import type { MapObjectRecord } from "../formats/classic/Dat";
import type { TrnBlock, TrnTile } from "../formats/classic/Trn";
import { TRN_SIDE } from "../formats/classic/Trn";
import { createTerrainBlockMesh } from "../render/terrain/TerrainBlockMesh";
import { TerrainMaterialLibrary } from "../render/terrain/TerrainMaterialLibrary";
import { MapObjects } from "../render/objects/MapObjects";
import { ClassicSpawnManager } from "../game/npcs/ClassicSpawnManager";
import {
  FIELD_WORLD_SIZE,
  HEIGHT_SCALE,
  TILE_WORLD_SIZE,
  fieldAt,
  type WydPosition,
} from "./coordinates";
import { composeClassicCollisionMask } from "./navigation/ClassicCollisionMask";
import {
  CLASSIC_BLOCKED_MASK,
  CLASSIC_MAX_STEP_HEIGHT,
  ClassicNavigation,
  type ClassicCollisionMask,
} from "./navigation/ClassicNavigation";
import { fieldKey } from "./regions";

// O Field mede 128 unidades. A base de 28 ganha ate 32 unidades somente na
// direcao do movimento; com G isso antecipa 0,5 s sem trazer o vizinho oposto.
// A margem de 42 preserva a histerese de descarregamento em baixa velocidade.
const PREFETCH_MARGIN = 28;
const RELEASE_MARGIN = 42;
const PREFETCH_LOOKAHEAD_SECONDS = 0.5;
const MAX_PREDICTIVE_LEAD = 32;
const ZERO_STREAMING_LEAD = { x: 0, y: 0 } as const;

export class ClassicWorld {
  readonly object = new THREE.Group();
  readonly navigation: ClassicNavigation;
  readonly #blocks = new Map<string, TrnBlock>();
  readonly #collisionMasks = new Map<string, ClassicCollisionMask>();
  readonly #terrainMeshes = new Map<string, THREE.Group>();
  readonly #loadedFields = new Set<string>();
  readonly #loadJobs = new Map<string, Promise<void>>();
  readonly #loadControllers = new Map<string, AbortController>();
  readonly #objectJobs = new Map<string, Promise<void>>();
  readonly #objectReady = new Set<string>();
  readonly #fieldGenerations = new Map<string, number>();
  readonly #availableFields = new Map<
    string,
    ClassicAssetSource["manifest"]["fields"][number]
  >();
  readonly #materials: TerrainMaterialLibrary;
  readonly #mapObjects: MapObjects;
  #spawns: ClassicSpawnManager | null = null;
  #spawnStartJob: Promise<void> | null = null;
  #lastStreamingPosition: WydPosition;
  #desiredFields = new Set<string>();
  #activeFieldKey = "";

  /** Camada viva de NPCs/monstros; fica nula apenas durante o boot assíncrono. */
  get spawns(): ClassicSpawnManager | null {
    return this.#spawns;
  }

  constructor(
    private readonly assets: ClassicAssetSource,
    readonly origin: WydPosition,
  ) {
    this.#lastStreamingPosition = { ...origin };
    this.navigation = new ClassicNavigation({
      terrainAt: (column, row) => this.#blocks.get(fieldKey(column, row)),
      collisionMaskAt: (column, row) =>
        this.#collisionMasks.get(fieldKey(column, row)),
    });
    this.#materials = new TerrainMaterialLibrary(assets);
    this.#mapObjects = new MapObjects(assets, origin, (position) =>
      this.heightAt(position),
    );
    for (const field of assets.manifest.fields) {
      this.#availableFields.set(fieldKey(field.column, field.row), field);
    }
    this.object.name = "classic-world";
    this.object.add(this.#mapObjects.object);
  }

  setEffectsEnabled(enabled: boolean): void {
    this.#mapObjects.setEffectsEnabled(enabled);
  }

  /**
   * Garante somente o terreno do Field atual. Em teleportes, reset=true
   * invalida o streaming anterior; objetos continuam entrando em background.
   */
  async ensureCurrent(position: WydPosition, reset = false): Promise<void> {
    this.#lastStreamingPosition = { ...position };
    const center = fieldAt(position);
    const key = fieldKey(center.column, center.row);
    const entry = this.#availableFields.get(key);
    this.#activeFieldKey = key;
    if (reset) {
      this.setDesiredFields(entry ? new Set([key]) : new Set());
      // Cancela imediatamente os atores do Field anterior enquanto o novo TRN
      // ainda esta chegando; evita NPCs suspensos durante teleportes.
      this.#spawns?.update(0, position);
    } else {
      this.updateStreaming(position);
    }
    if (!entry) return;

    // Um job antigo pode estar terminando justamente quando um teleporte volta
    // a desejar o mesmo Field. O pequeno loop garante que o centro foi de fato
    // montado, sem jamais aguardar os objetos ou os vizinhos.
    while (this.#desiredFields.has(key) && !this.#loadedFields.has(key)) {
      await this.loadField(entry);
      if (!this.#loadedFields.has(key)) await Promise.resolve();
    }
    if (this.#loadedFields.has(key)) {
      this.startSpawnSubsystem();
      this.#spawns?.update(0, position);
    }
  }

  /** Advances terrain streaming and the independently loaded creature layer. */
  update(deltaSeconds: number, position: WydPosition): void {
    const previous = this.#lastStreamingPosition;
    this.#lastStreamingPosition = { ...position };
    this.updateStreaming(
      position,
      predictiveLead(previous, position, deltaSeconds),
    );
    this.#spawns?.update(deltaSeconds, position);
  }

  /**
   * Chamado a cada frame. Mantem o centro e apenas os vizinhos cardinais nas
   * faixas de borda. Ate a margem preditiva maxima (60) e menor que meio Field,
   * portanto no maximo dois vizinhos (um por eixo) ficam desejados ao mesmo
   * tempo.
   */
  updateStreaming(
    position: WydPosition,
    lead: WydPosition = ZERO_STREAMING_LEAD,
  ): void {
    const center = fieldAt(position);
    const centerKey = fieldKey(center.column, center.row);
    this.#activeFieldKey = centerKey;
    const desired = new Set<string>();
    const centerEntry = this.#availableFields.get(centerKey);
    if (centerEntry) desired.add(centerKey);

    const localX = position.x - center.column * FIELD_WORLD_SIZE;
    const localY = position.y - center.row * FIELD_WORLD_SIZE;
    const candidates = [
      {
        column: center.column - 1,
        row: center.row,
        distance: localX,
        predictiveLead: Math.max(0, -lead.x),
      },
      {
        column: center.column + 1,
        row: center.row,
        distance: FIELD_WORLD_SIZE - localX,
        predictiveLead: Math.max(0, lead.x),
      },
      {
        column: center.column,
        row: center.row - 1,
        distance: localY,
        predictiveLead: Math.max(0, -lead.y),
      },
      {
        column: center.column,
        row: center.row + 1,
        distance: FIELD_WORLD_SIZE - localY,
        predictiveLead: Math.max(0, lead.y),
      },
    ];
    for (const candidate of candidates) {
      const key = fieldKey(candidate.column, candidate.row);
      if (!this.#availableFields.has(key)) continue;
      const resident = this.#loadedFields.has(key) || this.#loadJobs.has(key);
      const predictiveMargin = PREFETCH_MARGIN + candidate.predictiveLead;
      // A margem ampliada vale apenas na direcao atual. Depois de cruzar a
      // borda, o Field anterior volta imediatamente a usar RELEASE_MARGIN.
      const margin = resident
        ? Math.max(RELEASE_MARGIN, predictiveMargin)
        : predictiveMargin;
      if (candidate.distance <= margin)
        desired.add(key);
    }
    this.setDesiredFields(desired);

    // Centro sempre tem prioridade. Se ainda esta baixando, os vizinhos so
    // serao solicitados por um frame posterior, depois que ele estiver pronto.
    if (centerEntry && !this.#loadedFields.has(centerKey)) {
      if (!this.#loadJobs.has(centerKey)) {
        void this.loadField(centerEntry).catch((error: unknown) => {
          console.error(`Falha ao carregar Field ${centerKey}`, error);
        });
      }
      return;
    }
    for (const key of desired) {
      if (
        key === centerKey ||
        this.#loadedFields.has(key) ||
        this.#loadJobs.has(key)
      )
        continue;
      const entry = this.#availableFields.get(key);
      if (!entry) continue;
      void this.loadField(entry).catch((error: unknown) => {
        console.error(`Falha no prefetch do Field ${key}`, error);
      });
    }
  }

  /** Compatibilidade com chamadas antigas: nao volta a carregar uma grade 3x3. */
  async loadAround(position: WydPosition, _radius = 1): Promise<void> {
    await this.ensureCurrent(position);
    this.update(0, position);
  }

  private startSpawnSubsystem(): void {
    if (this.#spawns || this.#spawnStartJob) return;
    const job = ClassicSpawnManager.create(this.assets, {
      origin: this.origin,
      heightAt: (position) => this.heightAt(position),
      isFieldLoaded: (column, row) =>
        this.#loadedFields.has(fieldKey(column, row)),
      isWalkable: (position) =>
        this.navigation.sample(position).walkability === "walkable",
    })
      .then((spawns) => {
        this.#spawns = spawns;
        this.object.add(spawns.object);
        spawns.update(0, this.#lastStreamingPosition);
      })
      .catch((error: unknown) => {
        // O mundo continua utilizavel mesmo se o pacote opcional estiver ausente.
        console.warn("Camada de monstros indisponivel", error);
      })
      .finally(() => {
        if (this.#spawnStartJob === job) this.#spawnStartJob = null;
      });
    this.#spawnStartJob = job;
  }

  private loadField(
    entry: ClassicAssetSource["manifest"]["fields"][number],
  ): Promise<void> {
    const key = fieldKey(entry.column, entry.row);
    if (this.#loadedFields.has(key)) return Promise.resolve();
    const activeJob = this.#loadJobs.get(key);
    if (activeJob) return activeJob;

    const controller = new AbortController();
    const job = (async () => {
      let block: TrnBlock;
      let records: readonly MapObjectRecord[];
      let navigationData: Awaited<ReturnType<ClassicAssetSource["loadNavigation"]>>;
      try {
        [block, records, navigationData] = await Promise.all([
          this.assets.loadField(entry.file, controller.signal),
          entry.objectFile
            ? this.assets.loadObjects(entry.objectFile, controller.signal)
            : Promise.resolve([]),
          this.assets.loadNavigation(),
        ]);
      } catch (error) {
        // Trocas rapidas de Field e teleportes cancelam downloads que ja nao
        // podem ser montados. Nao trate essa liberacao intencional como falha.
        if (controller.signal.aborted) return;
        throw error;
      }
      if (!this.#desiredFields.has(key)) return;
      const collisionMask = composeClassicCollisionMask(
        block,
        records,
        navigationData,
      );
      this.#blocks.set(key, block);
      this.#collisionMasks.set(key, collisionMask);
      this.#loadedFields.add(key);
      const generation = (this.#fieldGenerations.get(key) ?? 0) + 1;
      this.#fieldGenerations.set(key, generation);
      this.stitchAndRefresh(block);
      if (entry.objectFile) {
        this.startObjectLoad(entry, generation, records);
      }
    })().finally(() => {
      if (this.#loadJobs.get(key) === job) this.#loadJobs.delete(key);
      if (this.#loadControllers.get(key) === controller) {
        this.#loadControllers.delete(key);
      }
    });
    this.#loadJobs.set(key, job);
    this.#loadControllers.set(key, controller);
    return job;
  }

  private startObjectLoad(
    entry: ClassicAssetSource["manifest"]["fields"][number],
    generation: number,
    records: readonly MapObjectRecord[],
  ): void {
    if (!entry.objectFile) return;
    const key = fieldKey(entry.column, entry.row);
    if (this.#objectReady.has(key) || this.#objectJobs.has(key)) return;

    const job = (async () => {
      if (!this.isCurrentGeneration(key, generation)) return;
      await this.#mapObjects.addBlock(entry.column, entry.row, records);
      if (!this.isCurrentGeneration(key, generation)) {
        this.#mapObjects.removeBlock(entry.column, entry.row);
        return;
      }
      this.#objectReady.add(key);
    })()
      .catch((error: unknown) => {
        console.error(`Falha ao carregar objetos do Field ${key}`, error);
      })
      .finally(() => {
        if (this.#objectJobs.get(key) !== job) return;
        this.#objectJobs.delete(key);
        const currentGeneration = this.#fieldGenerations.get(key);
        // Se o Field saiu e voltou enquanto o DAT/modelos ainda carregavam, o
        // job antigo foi cancelado logicamente e reiniciamos para a geracao nova.
        if (
          currentGeneration !== undefined &&
          currentGeneration !== generation &&
          this.#loadedFields.has(key) &&
          this.#desiredFields.has(key) &&
          !this.#objectReady.has(key)
        ) {
          // O DAT e imutavel. Reaproveitar os registros ja decodificados evita
          // um terceiro fetch quando o Field sai e volta durante addBlock.
          this.startObjectLoad(entry, currentGeneration, records);
        }
      });
    this.#objectJobs.set(key, job);
  }

  private isCurrentGeneration(key: string, generation: number): boolean {
    return (
      this.#fieldGenerations.get(key) === generation &&
      this.#loadedFields.has(key) &&
      this.#desiredFields.has(key)
    );
  }

  private setDesiredFields(desired: Set<string>): void {
    this.#desiredFields = desired;
    for (const [key, controller] of this.#loadControllers) {
      if (!desired.has(key)) controller.abort();
    }
    let removedAny = false;
    for (const key of [...this.#loadedFields]) {
      if (desired.has(key)) continue;
      this.unloadField(key);
      removedAny = true;
    }
    if (removedAny) this.#materials.prune(this.#blocks.values());
  }

  private unloadField(key: string): void {
    const entry = this.#availableFields.get(key);
    const terrain = this.#terrainMeshes.get(key);
    if (terrain) {
      this.#terrainMeshes.delete(key);
      this.object.remove(terrain);
      terrain.traverse((child) => {
        if (child instanceof THREE.Mesh) child.geometry.dispose();
      });
    }
    this.#blocks.delete(key);
    this.#collisionMasks.delete(key);
    this.#loadedFields.delete(key);
    this.#objectReady.delete(key);
    this.#fieldGenerations.set(key, (this.#fieldGenerations.get(key) ?? 0) + 1);
    if (entry) this.#mapObjects.removeBlock(entry.column, entry.row);
  }

  /**
   * Reproduz TMGround::Attach: a primeira coluna/linha do bloco seguinte usa
   * a altura e a cor da última coluna/linha do anterior. Os TRN isolados não
   * são perfeitamente coincidentes; sem esta solda aparece o céu nas emendas.
   */
  private stitchAndRefresh(block: TrnBlock): void {
    const changed = new Set<TrnBlock>([block]);
    const left = this.#blocks.get(fieldKey(block.column - 1, block.row));
    const right = this.#blocks.get(fieldKey(block.column + 1, block.row));
    const up = this.#blocks.get(fieldKey(block.column, block.row - 1));
    const down = this.#blocks.get(fieldKey(block.column, block.row + 1));

    if (left) copyColumn(left, TRN_SIDE - 1, block, 0);
    if (right) {
      copyColumn(block, TRN_SIDE - 1, right, 0);
      changed.add(right);
    }
    if (up) copyRow(up, TRN_SIDE - 1, block, 0);
    if (down) {
      copyRow(block, TRN_SIDE - 1, down, 0);
      changed.add(down);
    }

    for (const changedBlock of changed) this.rebuildTerrain(changedBlock);
  }

  private rebuildTerrain(block: TrnBlock): void {
    const key = fieldKey(block.column, block.row);
    const previous = this.#terrainMeshes.get(key);
    if (previous) {
      this.object.remove(previous);
      previous.traverse((child) => {
        if (child instanceof THREE.Mesh) child.geometry.dispose();
      });
    }
    const terrain = createTerrainBlockMesh(block, this.origin, this.#materials);
    this.#terrainMeshes.set(key, terrain);
    this.object.add(terrain);
  }

  heightAt(position: WydPosition): number {
    const field = fieldAt(position);
    const key = fieldKey(field.column, field.row);
    const block = this.#blocks.get(key);
    if (!block) return 0;
    const localX =
      (position.x - field.column * FIELD_WORLD_SIZE) / TILE_WORLD_SIZE;
    const localY =
      (position.y - field.row * FIELD_WORLD_SIZE) / TILE_WORLD_SIZE;
    const x0 = Math.max(0, Math.min(TRN_SIDE - 1, Math.floor(localX)));
    const y0 = Math.max(0, Math.min(TRN_SIDE - 1, Math.floor(localY)));
    const x1 = Math.min(TRN_SIDE - 1, x0 + 1);
    const y1 = Math.min(TRN_SIDE - 1, y0 + 1);
    const tx = localX - x0;
    const ty = localY - y0;
    const h00 = block.tiles[y0 * TRN_SIDE + x0]?.height ?? 0;
    const h10 = block.tiles[y0 * TRN_SIDE + x1]?.height ?? h00;
    const h01 = block.tiles[y1 * TRN_SIDE + x0]?.height ?? h00;
    const h11 = block.tiles[y1 * TRN_SIDE + x1]?.height ?? h00;
    const raw =
      tx + ty <= 1
        ? h00 + tx * (h10 - h00) + ty * (h01 - h00)
        : (1 - tx) * h01 + (1 - ty) * h10 + (tx + ty - 1) * h11;
    const terrainHeight = raw * HEIGHT_SCALE;
    const collision = this.#collisionMasks.get(key);
    const collisionHeight = collision?.complete
      ? collisionHeightAt(collision.values, position, field.column, field.row)
      : null;
    // Actor movement in the classic client follows GroundGetMask, which is
    // where bridge decks are stamped. Keep the rendered TRN when that mask is
    // merely its coarser terrain approximation.
    return collisionHeight === null
      ? terrainHeight
      : Math.max(terrainHeight, collisionHeight);
  }
}

function predictiveLead(
  previous: WydPosition,
  current: WydPosition,
  deltaSeconds: number,
): WydPosition {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
    return ZERO_STREAMING_LEAD;
  }
  const scale = PREFETCH_LOOKAHEAD_SECONDS / deltaSeconds;
  return {
    x: THREE.MathUtils.clamp(
      (current.x - previous.x) * scale,
      -MAX_PREDICTIVE_LEAD,
      MAX_PREDICTIVE_LEAD,
    ),
    y: THREE.MathUtils.clamp(
      (current.y - previous.y) * scale,
      -MAX_PREDICTIVE_LEAD,
      MAX_PREDICTIVE_LEAD,
    ),
  };
}

function collisionHeightAt(
  values: ArrayLike<number>,
  position: WydPosition,
  fieldColumn: number,
  fieldRow: number,
): number | null {
  const localX = Math.max(
    0,
    Math.min(FIELD_WORLD_SIZE - 1, position.x - fieldColumn * FIELD_WORLD_SIZE),
  );
  const localY = Math.max(
    0,
    Math.min(FIELD_WORLD_SIZE - 1, position.y - fieldRow * FIELD_WORLD_SIZE),
  );
  const x0 = Math.floor(localX);
  const y0 = Math.floor(localY);
  const x1 = Math.min(FIELD_WORLD_SIZE - 1, x0 + 1);
  const y1 = Math.min(FIELD_WORLD_SIZE - 1, y0 + 1);
  const tx = localX - x0;
  const ty = localY - y0;
  const base = signedMask(values[y0 * FIELD_WORLD_SIZE + x0] ?? 0);
  if (base >= CLASSIC_BLOCKED_MASK) return null;
  // 126/127 are collision sentinels, not elevated surfaces. A steep adjacent
  // cell also cannot belong to the same classic route segment (strict MH=8).
  const surface = (x: number, y: number): number => {
    const value = signedMask(values[y * FIELD_WORLD_SIZE + x] ?? base);
    return value >= CLASSIC_BLOCKED_MASK ||
      Math.abs(value - base) >= CLASSIC_MAX_STEP_HEIGHT
      ? base
      : value;
  };
  const h00 = base;
  const h10 = surface(x1, y0);
  const h01 = surface(x0, y1);
  const h11 = surface(x1, y1);
  return (
    (h00 * (1 - tx) * (1 - ty) +
      h10 * tx * (1 - ty) +
      h01 * (1 - tx) * ty +
      h11 * tx * ty) *
    HEIGHT_SCALE
  );
}

function signedMask(value: number): number {
  const byte = value & 0xff;
  return byte > 127 ? byte - 256 : byte;
}

function copyColumn(
  source: TrnBlock,
  sourceColumn: number,
  target: TrnBlock,
  targetColumn: number,
): void {
  for (let row = 0; row < TRN_SIDE; row++) {
    copyHeightAndColor(
      source,
      row * TRN_SIDE + sourceColumn,
      target,
      row * TRN_SIDE + targetColumn,
    );
  }
}

function copyRow(
  source: TrnBlock,
  sourceRow: number,
  target: TrnBlock,
  targetRow: number,
): void {
  for (let column = 0; column < TRN_SIDE; column++) {
    copyHeightAndColor(
      source,
      sourceRow * TRN_SIDE + column,
      target,
      targetRow * TRN_SIDE + column,
    );
  }
}

function copyHeightAndColor(
  source: TrnBlock,
  sourceIndex: number,
  target: TrnBlock,
  targetIndex: number,
): void {
  const sourceTile = source.tiles[sourceIndex];
  const targetTile = target.tiles[targetIndex];
  if (!sourceTile || !targetTile) return;
  const mutableTiles = target.tiles as TrnTile[];
  mutableTiles[targetIndex] = {
    ...targetTile,
    height: sourceTile.height,
    colorArgb: sourceTile.colorArgb,
  };
}
