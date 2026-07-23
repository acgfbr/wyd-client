export const CLASSIC_CACHE_NAME = "wyd-classic-assets-v1";
const CACHE_INDEX_URL = "/game-data/classic/precache-armia.json";
const CACHE_METADATA_URL = "/.wyd-cache/classic-initial.json";
const CACHE_SCHEMA = 1;

interface ClassicPrecacheIndex {
  readonly version: number;
  readonly key: string;
  readonly label: string;
  readonly totalBytes: number;
  readonly assets: readonly {
    readonly url: string;
    readonly bytes: number;
  }[];
}

interface CacheMetadata {
  readonly schema: number;
  readonly key: string;
  readonly completedAt: string;
  readonly assetCount: number;
  readonly totalBytes: number;
}

export interface ClassicCacheProgress {
  readonly phase: "checking" | "downloading" | "ready" | "unsupported";
  readonly label: string;
  readonly completedAssets: number;
  readonly totalAssets: number;
  readonly loadedBytes: number;
  readonly totalBytes: number;
  readonly currentAsset: string | null;
  readonly persistent: boolean | null;
}

export interface ClassicCacheResult {
  readonly status: "ready" | "updated" | "partial" | "skipped" | "unsupported";
  readonly label: string;
  readonly completedAssets: number;
  readonly totalAssets: number;
  readonly failedAssets: number;
  readonly totalBytes: number;
  readonly persistent: boolean | null;
}

export async function clearClassicInitialCache(): Promise<boolean> {
  if (typeof window === "undefined" || !("caches" in window)) return false;
  return caches.delete(CLASSIC_CACHE_NAME).catch(() => false);
}

interface PrepareClassicCacheOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ClassicCacheProgress) => void;
}

/**
 * Persists the authored Armia startup package before the Three.js world asks
 * for it. CacheStorage is a network cache only: parsed objects and GPU textures
 * remain governed by the existing streaming/LRU lifecycle.
 */
export async function prepareClassicInitialCache(
  options: PrepareClassicCacheOptions = {},
): Promise<ClassicCacheResult> {
  const onProgress = options.onProgress ?? (() => undefined);
  if (
    typeof window === "undefined"
    || !("caches" in window)
    || !("serviceWorker" in navigator)
  ) {
    onProgress(emptyProgress("unsupported", "Cache persistente indisponível"));
    return emptyResult("unsupported", "Armia");
  }

  onProgress(emptyProgress("checking", "Verificando pacote local"));
  await registerClassicCacheWorker();
  const indexResponse = await fetch(CACHE_INDEX_URL, { cache: "no-store", signal: options.signal });
  if (!indexResponse.ok) {
    return emptyResult("unsupported", "Armia");
  }
  const index = await indexResponse.json() as ClassicPrecacheIndex;
  validateIndex(index);

  let cache = await caches.open(CLASSIC_CACHE_NAME);
  const metadata = await readMetadata(cache);
  let persistent: boolean | null = null;
  if (navigator.storage?.persisted) {
    persistent = await navigator.storage.persisted().catch(() => false);
  }

  if (
    metadata?.schema === CACHE_SCHEMA
    && metadata.key === index.key
    && metadata.assetCount === index.assets.length
    && metadata.totalBytes === index.totalBytes
  ) {
    onProgress({
      phase: "ready",
      label: `${index.label} disponível no cache`,
      completedAssets: index.assets.length,
      totalAssets: index.assets.length,
      loadedBytes: index.totalBytes,
      totalBytes: index.totalBytes,
      currentAsset: null,
      persistent,
    });
    return {
      status: "ready",
      label: index.label,
      completedAssets: index.assets.length,
      totalAssets: index.assets.length,
      failedAssets: 0,
      totalBytes: index.totalBytes,
      persistent,
    };
  }

  if (metadata && metadata.key !== index.key) {
    await caches.delete(CLASSIC_CACHE_NAME);
    cache = await caches.open(CLASSIC_CACHE_NAME);
  }
  if (persistent === false && navigator.storage?.persist) {
    persistent = await navigator.storage.persist().catch(() => false);
  }
  if (navigator.storage?.estimate) {
    const estimate = await navigator.storage.estimate().catch(() => null);
    const availableBytes = estimate?.quota !== undefined
      ? estimate.quota - (estimate.usage ?? 0)
      : Number.POSITIVE_INFINITY;
    // Keep a small margin for CacheStorage bookkeeping. The game still boots
    // through the normal network path when the origin has too little space.
    if (availableBytes < index.totalBytes * 1.05) {
      onProgress({
        phase: "unsupported",
        label: "Espaço local insuficiente · carregando pela rede",
        completedAssets: 0,
        totalAssets: index.assets.length,
        loadedBytes: 0,
        totalBytes: index.totalBytes,
        currentAsset: null,
        persistent,
      });
      return {
        status: "skipped",
        label: index.label,
        completedAssets: 0,
        totalAssets: index.assets.length,
        failedAssets: 0,
        totalBytes: index.totalBytes,
        persistent,
      };
    }
  }

  const inFlightBytes = new Map<string, number>();
  let completedAssets = 0;
  let completedBytes = 0;
  let failedAssets = 0;
  const concurrency = isAppleMobileDevice() ? 3 : 6;
  let cursor = 0;

  const emit = (currentAsset: string | null) => {
    let activeBytes = 0;
    for (const bytes of inFlightBytes.values()) activeBytes += bytes;
    onProgress({
      phase: "downloading",
      label: `Preparando ${index.label} para jogar`,
      completedAssets,
      totalAssets: index.assets.length,
      loadedBytes: Math.min(index.totalBytes, completedBytes + activeBytes),
      totalBytes: index.totalBytes,
      currentAsset,
      persistent,
    });
  };
  emit(null);

  const worker = async () => {
    while (cursor < index.assets.length && !options.signal?.aborted) {
      const asset = index.assets[cursor++]!;
      const request = new Request(asset.url, { credentials: "same-origin" });
      try {
        const cached = await cache.match(request);
        if (cached) {
          completedAssets++;
          completedBytes += asset.bytes;
          emit(asset.url);
          continue;
        }

        const response = await fetch(request, { signal: options.signal });
        if (!response.ok) throw new Error(`${response.status} ${asset.url}`);
        inFlightBytes.set(asset.url, 0);
        const cacheJob = cache.put(request, response.clone());
        if (response.body) {
          const reader = response.body.getReader();
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            inFlightBytes.set(asset.url, (inFlightBytes.get(asset.url) ?? 0) + chunk.value.byteLength);
            emit(asset.url);
          }
        } else {
          await response.arrayBuffer();
          inFlightBytes.set(asset.url, asset.bytes);
        }
        await cacheJob;
        inFlightBytes.delete(asset.url);
        completedAssets++;
        completedBytes += asset.bytes;
        emit(asset.url);
      } catch (error) {
        inFlightBytes.delete(asset.url);
        if (options.signal?.aborted) break;
        failedAssets++;
        console.warn(`Cache inicial ignorou ${asset.url}`, error);
        emit(asset.url);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  if (!options.signal?.aborted && failedAssets === 0 && completedAssets === index.assets.length) {
    await writeMetadata(cache, {
      schema: CACHE_SCHEMA,
      key: index.key,
      completedAt: new Date().toISOString(),
      assetCount: index.assets.length,
      totalBytes: index.totalBytes,
    });
    onProgress({
      phase: "ready",
      label: `${index.label} armazenada · próximas visitas serão mais rápidas`,
      completedAssets,
      totalAssets: index.assets.length,
      loadedBytes: index.totalBytes,
      totalBytes: index.totalBytes,
      currentAsset: null,
      persistent,
    });
    return {
      status: "updated",
      label: index.label,
      completedAssets,
      totalAssets: index.assets.length,
      failedAssets,
      totalBytes: index.totalBytes,
      persistent,
    };
  }

  return {
    status: options.signal?.aborted ? "skipped" : "partial",
    label: index.label,
    completedAssets,
    totalAssets: index.assets.length,
    failedAssets,
    totalBytes: index.totalBytes,
    persistent,
  };
}

async function registerClassicCacheWorker(): Promise<void> {
  const registration = await navigator.serviceWorker.register(
    `/wyd-cache-sw.js?v=${CACHE_SCHEMA}`,
    { scope: "/" },
  );
  await navigator.serviceWorker.ready;
  if (navigator.serviceWorker.controller || registration.active === null) return;
  await Promise.race([
    new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
    }),
    new Promise<void>((resolve) => window.setTimeout(resolve, 1_500)),
  ]);
}

function validateIndex(index: ClassicPrecacheIndex): void {
  if (
    index.version !== 1
    || typeof index.key !== "string"
    || !Array.isArray(index.assets)
    || !Number.isFinite(index.totalBytes)
  ) throw new Error("Índice do cache inicial inválido");
  for (const asset of index.assets) {
    if (
      !asset.url.startsWith("/game-data/classic/")
      || !Number.isFinite(asset.bytes)
      || asset.bytes < 0
    ) throw new Error("Asset inválido no cache inicial");
  }
}

async function readMetadata(cache: Cache): Promise<CacheMetadata | null> {
  const response = await cache.match(CACHE_METADATA_URL);
  if (!response) return null;
  return response.json().catch(() => null) as Promise<CacheMetadata | null>;
}

async function writeMetadata(cache: Cache, metadata: CacheMetadata): Promise<void> {
  await cache.put(CACHE_METADATA_URL, new Response(JSON.stringify(metadata), {
    headers: { "content-type": "application/json" },
  }));
}

function emptyProgress(
  phase: ClassicCacheProgress["phase"],
  label: string,
): ClassicCacheProgress {
  return {
    phase,
    label,
    completedAssets: 0,
    totalAssets: 0,
    loadedBytes: 0,
    totalBytes: 0,
    currentAsset: null,
    persistent: null,
  };
}

function emptyResult(
  status: ClassicCacheResult["status"],
  label: string,
): ClassicCacheResult {
  return {
    status,
    label,
    completedAssets: 0,
    totalAssets: 0,
    failedAssets: 0,
    totalBytes: 0,
    persistent: null,
  };
}

function isAppleMobileDevice(): boolean {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
