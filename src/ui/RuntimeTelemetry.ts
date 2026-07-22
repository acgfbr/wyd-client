interface ChromiumPerformanceMemory {
  readonly usedJSHeapSize?: number;
}

type PerformanceWithOptionalMemory = Performance & {
  readonly memory?: ChromiumPerformanceMemory;
};

const SAMPLE_INTERVAL_MS = 1_000;
const BYTES_PER_MEBIBYTE = 1024 * 1024;

/** Lightweight, one-second aggregate of the existing animation loop. */
export class RuntimeTelemetry {
  readonly #fps = requireElement("#telemetry-fps");
  readonly #memory = requireElement("#telemetry-memory");
  readonly #thread = requireElement("#telemetry-thread");
  #sampleStartedAt: number | null = null;
  #frameStartedAt: number | null = null;
  #frameCount = 0;
  #synchronousFrameMilliseconds = 0;

  begin(): void {
    const now = performance.now();
    if (this.#sampleStartedAt === null) this.#sampleStartedAt = now;
    this.#frameStartedAt = now;
  }

  end(): void {
    const now = performance.now();
    if (this.#frameStartedAt === null || this.#sampleStartedAt === null) return;
    this.#synchronousFrameMilliseconds += Math.max(0, now - this.#frameStartedAt);
    this.#frameStartedAt = null;
    this.#frameCount++;
    const elapsed = now - this.#sampleStartedAt;
    if (elapsed < SAMPLE_INTERVAL_MS) return;

    const fps = this.#frameCount * 1000 / elapsed;
    const averageFrameMilliseconds = this.#frameCount > 0
      ? this.#synchronousFrameMilliseconds / this.#frameCount
      : 0;
    // This is only the measured occupancy of our rAF callback on the main
    // thread. It deliberately does not claim system/process CPU utilization.
    const mainThreadProxy = Math.max(
      0,
      Math.min(100, this.#synchronousFrameMilliseconds / elapsed * 100),
    );
    this.#fps.textContent = fps < 10 ? fps.toFixed(1) : String(Math.round(fps));
    this.#memory.textContent = formatUsedHeap();
    this.#thread.textContent = `${averageFrameMilliseconds.toFixed(1)} ms · ${Math.round(mainThreadProxy)}%`;

    this.#sampleStartedAt = now;
    this.#frameCount = 0;
    this.#synchronousFrameMilliseconds = 0;
  }
}

function formatUsedHeap(): string {
  const used = (performance as PerformanceWithOptionalMemory).memory?.usedJSHeapSize;
  if (!Number.isFinite(used) || used === undefined || used < 0) return "—";
  return `${Math.round(used / BYTES_PER_MEBIBYTE)} MB`;
}

function requireElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Telemetria: elemento ${selector} ausente`);
  return element;
}
