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

export interface ClassicAmbientSoundSource {
  readonly soundIndex: number;
  readonly position: WydPosition;
  readonly radius: number;
  readonly volume: number;
}

const AUDIO_ROOT = "/game-data/classic/";
const MAX_SIMULTANEOUS_SFX_VOICES = 28;

/**
 * Effect-event sounds recovered from TMHuman.cpp and the TMSkill* controllers.
 * Some classic effects intentionally start two samples in the same frame.
 */
const CLASSIC_SKILL_SOUNDS: Readonly<Record<number, readonly number[]>> = {
  2: [160],
  6: [178],
  8: [160],
  10: [160],
  11: [168],
  12: [160],
  16: [167],
  17: [155],
  18: [160],
  19: [160],
  20: [153],
  21: [156],
  24: [161],
  25: [4],
  26: [159],
  27: [158],
  28: [160],
  29: [158],
  30: [38],
  32: [155],
  34: [154, 160],
  37: [105],
  38: [155],
  41: [159],
  43: [159],
  44: [159],
  46: [36],
  51: [167, 157],
  54: [159],
  55: [38],
  72: [160],
  73: [159],
  75: [174],
  80: [171],
  85: [37],
  88: [160],
  90: [169],
};

const CLASSIC_SKILL_IMPACT_SOUNDS: Readonly<Record<number, readonly number[]>> = {
  7: [26],
  24: [154],
  38: [154],
};

/**
 * Lazy browser bridge for DS_SOUND_MANAGER/CSoundManager data.
 * Nothing is downloaded until a user gesture unlocks audio or a SFX is used.
 */
export class ClassicAudio {
  readonly #music = new Audio();
  readonly #voices = new Set<HTMLAudioElement>();
  readonly #ambientLoops = new Map<number, HTMLAudioElement>();
  readonly #ambientLoads = new Set<number>();
  #ambientDesired = new Map<number, number>();
  #catalogPromise: Promise<ClassicAudioCatalog | null> | null = null;
  #unlocked = false;
  #disposed = false;
  // WYD installations commonly start with BGM disabled. SFX remain enabled.
  #musicEnabled = false;
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
    if (this.#unlocked && this.#musicEnabled) void this.playRequestedMusic();
  }

  get musicEnabled(): boolean {
    return this.#musicEnabled;
  }

  toggleMusic(): boolean {
    this.#musicEnabled = !this.#musicEnabled;
    if (!this.#musicEnabled) {
      this.#music.pause();
      return false;
    }
    if (this.#unlocked) void this.playRequestedMusic();
    return true;
  }

  playBasicAttack(classKey: string, sequence: number): void {
    // PlayAttackSound in TMHuman.cpp switches by equipped weapon type. These
    // are the weapon families currently equipped by the offline class presets.
    const pair = classKey === "huntress"
      ? [137, 138]
      : classKey === "foema"
        ? [131, 132]
        : classKey === "transknight"
          ? [124, 125]
          : [128, 129];
    void this.playSound(pair[Math.abs(sequence) % pair.length]!, 0.28);
  }

  playPlayerAction(classKey: string, action: "hit" | "death", mounted: boolean): void {
    // AniSound4: Mage is skin 1; TK/BM/Huntress use the Knight action table.
    const soundIndex = classKey === "foema"
      ? (action === "hit" ? 21 : 17)
      : action === "hit"
        ? 22
        : mounted
          ? 12
          : 21;
    void this.playSound(soundIndex, action === "death" ? 0.38 : 0.3);
  }

  playSpatialSound(
    index: number,
    source: WydPosition,
    listener: WydPosition,
    maximumDistance = 36,
    volume = 0.32,
  ): void {
    const distance = Math.hypot(source.x - listener.x, source.y - listener.y);
    if (distance >= maximumDistance) return;
    const attenuation = 1 - distance / Math.max(0.01, maximumDistance);
    void this.playSound(index, volume * attenuation * attenuation);
  }

  updateAmbient(
    sources: readonly ClassicAmbientSoundSource[],
    listener: WydPosition,
  ): void {
    const desired = new Map<number, number>();
    for (const source of sources) {
      const distance = Math.hypot(
        source.position.x - listener.x,
        source.position.y - listener.y,
      );
      if (distance >= source.radius) continue;
      const attenuation = 1 - distance / Math.max(0.01, source.radius);
      const volume = source.volume * attenuation * attenuation;
      desired.set(source.soundIndex, Math.max(volume, desired.get(source.soundIndex) ?? 0));
    }
    this.#ambientDesired = desired;
    for (const [index, loop] of this.#ambientLoops) {
      const volume = desired.get(index);
      if (volume === undefined || volume <= 0.002) {
        releaseAudio(loop);
        this.#ambientLoops.delete(index);
        continue;
      }
      loop.volume = Math.min(1, volume);
    }
    if (!this.#unlocked || this.#disposed) return;
    for (const index of desired.keys()) {
      if (this.#ambientLoops.has(index) || this.#ambientLoads.has(index)) continue;
      void this.startAmbientLoop(index);
    }
  }

  playSkill(classicIndex: number): void {
    this.playSoundSet(CLASSIC_SKILL_SOUNDS[classicIndex], 0.3);
  }

  playSkillImpact(classicIndex: number): void {
    this.playSoundSet(CLASSIC_SKILL_IMPACT_SOUNDS[classicIndex], 0.27);
  }

  playLevelUp(): void {
    // Generic remote-player level-up sample used by TMHuman when the focused
    // model has no authored LEVELUP sound in AniSound4.
    void this.playSound(158, 0.34);
  }

  async playSound(index: number, volume = 0.32): Promise<boolean> {
    if (this.#disposed) return false;
    const catalog = await this.loadCatalog();
    const entry = catalog?.sounds.find((candidate) => candidate.index === index);
    if (!entry || this.#disposed) return false;
    const sameSound = [...this.#voices].filter(
      (voice) => voice.dataset.classicSoundIndex === String(index),
    );
    if (sameSound.length >= Math.max(1, entry.channels)) return false;
    if (this.#voices.size >= MAX_SIMULTANEOUS_SFX_VOICES) {
      const oldest = this.#voices.values().next().value;
      if (oldest) {
        releaseAudio(oldest);
        this.#voices.delete(oldest);
      }
    }
    const voice = new Audio(classicAudioUrl(entry.file));
    voice.dataset.classicSoundIndex = String(index);
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
    for (const loop of this.#ambientLoops.values()) releaseAudio(loop);
    this.#ambientLoops.clear();
    this.#ambientLoads.clear();
    this.#ambientDesired.clear();
    for (const voice of this.#voices) {
      releaseAudio(voice);
    }
    this.#voices.clear();
  }

  private readonly unlock = (): void => {
    if (this.#unlocked || this.#disposed) return;
    this.#unlocked = true;
    window.removeEventListener("pointerdown", this.unlock, { capture: true });
    window.removeEventListener("keydown", this.unlock, { capture: true });
    if (this.#musicEnabled) void this.playRequestedMusic();
    for (const index of this.#ambientDesired.keys()) {
      if (!this.#ambientLoops.has(index) && !this.#ambientLoads.has(index)) {
        void this.startAmbientLoop(index);
      }
    }
  };

  private async playRequestedMusic(): Promise<void> {
    const requested = this.#requestedMusicIndex;
    if (!this.#unlocked || !this.#musicEnabled || this.#disposed || requested === null) return;
    if (requested === this.#activeMusicIndex && !this.#music.paused) return;
    if (requested === this.#activeMusicIndex && this.#music.src) {
      try {
        await this.#music.play();
      } catch {
        // A later trusted gesture will retry through unlock.
      }
      return;
    }
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

  private playSoundSet(indices: readonly number[] | undefined, volume: number): void {
    if (!indices) return;
    for (const index of indices) void this.playSound(index, volume);
  }

  private async startAmbientLoop(index: number): Promise<void> {
    this.#ambientLoads.add(index);
    try {
      const catalog = await this.loadCatalog();
      const volume = this.#ambientDesired.get(index);
      const entry = catalog?.sounds.find((candidate) => candidate.index === index);
      if (
        !entry
        || volume === undefined
        || volume <= 0.002
        || !this.#unlocked
        || this.#disposed
        || this.#ambientLoops.has(index)
      ) return;
      const loop = new Audio(classicAudioUrl(entry.file));
      loop.preload = "auto";
      loop.loop = true;
      loop.volume = Math.min(1, volume);
      try {
        await loop.play();
        if (this.#disposed || !this.#ambientDesired.has(index)) {
          releaseAudio(loop);
          return;
        }
        this.#ambientLoops.set(index, loop);
      } catch {
        releaseAudio(loop);
      }
    } finally {
      this.#ambientLoads.delete(index);
    }
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

function releaseAudio(audio: HTMLAudioElement): void {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}
