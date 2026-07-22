import * as THREE from "three";

interface Glyph {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface FloatingDamageNumber {
  readonly text: string;
  readonly critical: boolean;
  readonly startX: number;
  readonly startY: number;
  readonly widthRatio: number;
  readonly heightRatio: number;
  readonly durationSeconds: number;
  elapsedSeconds: number;
}

const YELLOW_DIGITS: readonly Glyph[] = [
  { x: 0, y: 60, width: 26, height: 29 },
  { x: 27, y: 60, width: 14, height: 29 },
  { x: 41, y: 60, width: 23, height: 29 },
  { x: 64, y: 60, width: 21, height: 29 },
  { x: 85, y: 60, width: 22, height: 29 },
  { x: 107, y: 60, width: 20, height: 29 },
  { x: 127, y: 60, width: 22, height: 29 },
  { x: 150, y: 60, width: 21, height: 29 },
  { x: 171, y: 60, width: 23, height: 29 },
  { x: 194, y: 60, width: 24, height: 29 },
];

// UITextureSetList.txt [Orange_Number], set 141. Its atlas is deliberately
// split across two rows and does not share Yellow_Number's glyph order.
const ORANGE_DIGITS: readonly Glyph[] = [
  { x: 133, y: 216, width: 36, height: 40 },
  { x: 0, y: 175, width: 26, height: 42 },
  { x: 26, y: 175, width: 35, height: 42 },
  { x: 61, y: 175, width: 30, height: 42 },
  { x: 91, y: 175, width: 36, height: 42 },
  { x: 127, y: 176, width: 35, height: 41 },
  { x: 0, y: 216, width: 31, height: 40 },
  { x: 31, y: 216, width: 31, height: 40 },
  { x: 62, y: 216, width: 32, height: 40 },
  { x: 95, y: 216, width: 35, height: 40 },
];

const NORMAL_LIFETIME_SECONDS = 1;
const CRITICAL_LIFETIME_SECONDS = 2.1;

/**
 * Screen-space recreation of TMFont3's type 3 and type 5 damage numbers.
 * BASE_Get3DTo2DPos is sampled once when the hit arrives; the number then
 * follows the original fixed 2D trajectory instead of tracking the actor.
 */
export class ClassicDamageNumbers {
  readonly canvas = document.createElement("canvas");
  readonly #context: CanvasRenderingContext2D;
  readonly #atlas = new Image();
  readonly #entries: FloatingDamageNumber[] = [];
  #cssWidth = 1;
  #cssHeight = 1;
  #pixelRatio = 1;

  constructor(container: HTMLElement) {
    const context = this.canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Canvas 2D indisponível para números de dano");
    this.#context = context;
    this.canvas.className = "classic-damage-number-layer";
    this.canvas.setAttribute("aria-hidden", "true");
    this.#atlas.decoding = "async";
    this.#atlas.src = "/game-data/classic/ui/damage-numbers.png";
    container.appendChild(this.canvas);
  }

  show(
    camera: THREE.Camera,
    worldPosition: THREE.Vector3,
    value: number,
    critical: boolean,
  ): void {
    const damage = Math.max(0, Math.min(999_999_999, Math.trunc(value)));
    if (damage <= 0) return;
    const projected = worldPosition.clone().project(camera);
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || projected.z < -1 || projected.z > 1) {
      return;
    }
    const widthRatio = this.#cssWidth / 800;
    const heightRatio = this.#cssHeight / 600;
    const screenX = (projected.x * 0.5 + 0.5) * this.#cssWidth;
    const screenY = (-projected.y * 0.5 + 0.5) * this.#cssHeight;
    this.#entries.push({
      text: String(damage),
      critical,
      // TMFont3's direction 9 moves critical damage 50 screen pixels left.
      // The original client intentionally does not apply its width ratio here.
      startX: screenX - (critical ? 50 : 0),
      // TMFieldScene offsets damage dealt by +30 px and a critical by +60 px
      // at 800x600 before handing the coordinates to TMFont3.
      startY: screenY + (critical ? 60 : 30) * heightRatio,
      widthRatio,
      heightRatio,
      durationSeconds: critical ? CRITICAL_LIFETIME_SECONDS : NORMAL_LIFETIME_SECONDS,
      elapsedSeconds: 0,
    });
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.#cssWidth = Math.max(1, Math.round(width));
    this.#cssHeight = Math.max(1, Math.round(height));
    this.#pixelRatio = Math.max(1, Math.min(2, pixelRatio));
    this.canvas.width = Math.round(this.#cssWidth * this.#pixelRatio);
    this.canvas.height = Math.round(this.#cssHeight * this.#pixelRatio);
    this.canvas.style.width = `${this.#cssWidth}px`;
    this.canvas.style.height = `${this.#cssHeight}px`;
    this.#context.setTransform(this.#pixelRatio, 0, 0, this.#pixelRatio, 0, 0);
  }

  update(deltaSeconds: number): void {
    this.#context.clearRect(0, 0, this.#cssWidth, this.#cssHeight);
    const dt = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    for (let index = this.#entries.length - 1; index >= 0; index--) {
      const entry = this.#entries[index]!;
      entry.elapsedSeconds += dt;
      const progress = entry.elapsedSeconds / entry.durationSeconds;
      if (progress >= 1) {
        this.#entries.splice(index, 1);
        continue;
      }
      // TMFont3 keeps both variants hidden for the first 30% of their life.
      if (progress < 0.3 || !this.#atlas.complete || this.#atlas.naturalWidth === 0) continue;
      this.draw(entry, progress);
    }
  }

  clear(): void {
    this.#entries.length = 0;
    this.#context.clearRect(0, 0, this.#cssWidth, this.#cssHeight);
  }

  dispose(): void {
    this.clear();
    this.#atlas.src = "";
    this.canvas.remove();
  }

  private draw(entry: FloatingDamageNumber, progress: number): void {
    const glyphs = entry.critical ? ORANGE_DIGITS : YELLOW_DIGITS;
    const layoutScale = entry.critical ? 1.1 : 0.7;
    const speed = Math.floor(entry.durationSeconds * 1_000 / 700);
    const visualProgress = (progress - 0.3) / 0.7;
    const fade = visualProgress >= 0.8
      ? 1 - Math.min(1, (visualProgress - 0.8) / 0.2)
      : 1;
    let animatedScale: number;
    if (entry.critical) {
      const fadePhase = visualProgress >= 0.8
        ? (visualProgress - 0.8) / 0.2
        : 0;
      const criticalScale = fadePhase >= 0.25 ? 1 : ((0.25 - fadePhase) * 2 + 1);
      animatedScale = Math.sin(progress * Math.PI) * criticalScale;
    } else {
      animatedScale = (progress + 0.2) * 0.7;
    }
    const centerY = entry.startY - speed * progress
      * (entry.critical ? 120 : 100) * entry.heightRatio;
    const halfLength = entry.text.length * 0.5 - 1;
    let advance = 0;

    this.#context.save();
    this.#context.globalAlpha = Math.max(0, fade);
    for (let index = 0; index < entry.text.length; index++) {
      const digit = Number(entry.text[index]);
      const glyph = glyphs[digit];
      if (!glyph) continue;
      const relative = halfLength === 0 ? 0 : (index - halfLength) / halfLength;
      const curve = entry.critical
        ? (-relative * glyph.width * halfLength) * (1.3 - animatedScale)
        : (-relative * glyph.width * halfLength) * 0.3 * (0.55 - animatedScale);
      const centerX = entry.startX
        + advance
        + curve * entry.widthRatio
        - (entry.text[index] === "1" ? 3 * entry.heightRatio : 0);
      const width = glyph.width * animatedScale * entry.widthRatio;
      const height = glyph.height * animatedScale * entry.widthRatio;
      this.#context.drawImage(
        this.#atlas,
        glyph.x,
        glyph.y,
        glyph.width,
        glyph.height,
        centerX - width * 0.5,
        centerY - height * 0.5,
        width,
        height,
      );
      advance += glyph.width * layoutScale * entry.widthRatio;
    }
    this.#context.restore();
  }
}
