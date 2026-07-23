import type { WydPosition } from "../world/coordinates";

interface ClassicAudioCatalog {
  readonly sounds: readonly {
    readonly index: number;
    readonly channels: number;
    readonly file: string;
  }[];
  readonly music: readonly {
    readonly index: number;
    readonly file: string;
  }[];
}

const AUDIO_ROOT = "/game-data/classic/";

/**
 * Lazy browser bridge for DS_SOUND_MANAGER/CSoundManager data.
 * Nothing is downloaded until a user gesture unlocks audio or a SFX is used.
 */
export class ClassicAudio {
  readonly #music = new Audio();
  readonly #voices = new Set<HTMLAudioElement>();
  #catalogPromise: Promise<ClassicAudioCatalog | null> | null = null;
  #unlocked = false;
  #disposed = false;
  #requestedMusicIndex: number | null = null;
  #activeMusicIndex: number | null = null;

  constructor() {
    this.#music.loop = true;
    this.#music.preload = "none";
    this.#music.volume = 0.18;
    window.addEventListener("pointerdown", this.unlock, { capture: true });
    window.addEventListener("keydown", this.unlock, { capture: true });
  }

  updateMusic(position: WydPosition, attribute: number | null): void {
    const index = classicMusicIndex(position, attribute);
    if (index === this.#requestedMusicIndex) return;
    this.#requestedMusicIndex = index;
    if (this.#unlocked) void this.playRequestedMusic();
  }

  async playSound(index: number, volume = 0.32): Promise<boolean> {
    if (this.#disposed) return false;
    const catalog = await this.loadCatalog();
    const entry = catalog?.sounds.find((candidate) => candidate.index === index);
    if (!entry || this.#disposed) return false;
    const voice = new Audio(classicAudioUrl(entry.file));
    voice.preload = "auto";
    voice.volume = Math.max(0, Math.min(1, volume));
    this.#voices.add(voice);
    const release = () => {
      this.#voices.delete(voice);
      voice.removeEventListener("ended", release);
      voice.removeEventListener("error", release);
    };
    voice.addEventListener("ended", release);
    voice.addEventListener("error", release);
    try {
      await voice.play();
      return true;
    } catch {
      release();
      return false;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    window.removeEventListener("pointerdown", this.unlock, { capture: true });
    window.removeEventListener("keydown", this.unlock, { capture: true });
    this.#music.pause();
    this.#music.removeAttribute("src");
    this.#music.load();
    for (const voice of this.#voices) {
      voice.pause();
      voice.removeAttribute("src");
      voice.load();
    }
    this.#voices.clear();
  }

  private readonly unlock = (): void => {
    if (this.#unlocked || this.#disposed) return;
    this.#unlocked = true;
    window.removeEventListener("pointerdown", this.unlock, { capture: true });
    window.removeEventListener("keydown", this.unlock, { capture: true });
    void this.playRequestedMusic();
  };

  private async playRequestedMusic(): Promise<void> {
    const requested = this.#requestedMusicIndex;
    if (!this.#unlocked || this.#disposed || requested === null) return;
    if (requested === this.#activeMusicIndex && !this.#music.paused) return;
    const catalog = await this.loadCatalog();
    if (this.#disposed || requested !== this.#requestedMusicIndex) return;
    const entry = catalog?.music.find((candidate) => candidate.index === requested);
    if (!entry) return;
    this.#activeMusicIndex = requested;
    this.#music.src = classicAudioUrl(entry.file);
    try {
      await this.#music.play();
    } catch {
      // Browsers can still reject a synthetic/non-trusted gesture. Keep the
      // requested index so the next real input retries without breaking boot.
      this.#activeMusicIndex = null;
      this.#unlocked = false;
      window.addEventListener("pointerdown", this.unlock, { capture: true });
      window.addEventListener("keydown", this.unlock, { capture: true });
    }
  }

  private loadCatalog(): Promise<ClassicAudioCatalog | null> {
    if (!this.#catalogPromise) {
      this.#catalogPromise = fetch(`${AUDIO_ROOT}audio/catalog.json`)
        .then(async (response) => response.ok ? response.json() as Promise<ClassicAudioCatalog> : null)
        .catch(() => null);
    }
    return this.#catalogPromise;
  }
}

/** Exact non-war routing recovered from TMFieldScene.cpp:6780-7055. */
export function classicMusicIndex(position: WydPosition, attribute: number | null): number {
  const x = Math.floor(position.x);
  const y = Math.floor(position.y);
  const column = x >> 7;
  const row = y >> 7;
  const inTown = attribute !== null && (attribute & 1) !== 0;

  if (inTown) {
    if (inRect(x, y, 1036, 1700, 1088, 1774)) return 8;
    const village = classicVillageAt(x, y);
    // The retail client aliases Erion (2) to Armia (0).
    const musicVillage = village === 2 ? 0 : village;
    return musicVillage === null ? 1 : 2 * musicVillage + 1;
  }

  if (row < 25) {
    if (column >= 8 && column <= 12 && row >= 11 && row <= 14) return 9;
    if (column > 26 && column < 31 && row > 20 && row < 25) return 9;
    if (x > 1664 && x < 1792 && y > 1536 && y < 1920) return 6;
    return inRect(x, y, 2048, 1792, 2688, 2304) ? 4 : 2;
  }

  if (column < 16 && column > 8 && row > 25) return 7;
  if (column === 18 && row === 30) return 12;
  if (column > 16 && column < 20 && row > 29) return 11;
  if (column === 31 && row === 31) return 6;
  return 5;
}

function classicVillageAt(x: number, y: number): number | null {
  // Town extents from g_pGuildZone in Basedef.cpp.
  const zones = [
    [2052, 2052, 2171, 2163],
    [2432, 1672, 2675, 1767],
    [2448, 1966, 2476, 2024],
    [3605, 3090, 3690, 3260],
    [1036, 1700, 1072, 1760],
  ] as const;
  const index = zones.findIndex(([left, top, right, bottom]) => inRect(x, y, left, top, right, bottom));
  return index >= 0 ? index : null;
}

function inRect(
  x: number,
  y: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): boolean {
  return x >= left && x < right && y >= top && y < bottom;
}

function classicAudioUrl(file: string): string {
  return `${AUDIO_ROOT}${file.split("/").map(encodeURIComponent).join("/")}`;
}
