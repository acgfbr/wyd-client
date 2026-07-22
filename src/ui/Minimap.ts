import type { ClassicAssetSource } from "../assets/ClassicAssetSource";
import { FIELD_WORLD_SIZE, type WydPosition } from "../world/coordinates";

export class Minimap {
  readonly #context: CanvasRenderingContext2D;
  readonly #background: HTMLCanvasElement;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    background: HTMLCanvasElement,
    private readonly column: number,
    private readonly row: number,
  ) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D indisponível");
    this.#context = context;
    this.#background = background;
  }

  static async load(assets: ClassicAssetSource, canvas: HTMLCanvasElement, column: number, row: number, file: string): Promise<Minimap> {
    const buffer = await assets.loadMinimap(file);
    return new Minimap(canvas, decodeWyt(buffer), column, row);
  }

  update(position: WydPosition, yaw: number): void {
    const width = this.canvas.width;
    const height = this.canvas.height;
    this.#context.clearRect(0, 0, width, height);
    this.#context.drawImage(this.#background, 0, 0, width, height);
    const localX = (position.x - this.column * FIELD_WORLD_SIZE) / FIELD_WORLD_SIZE;
    const localY = (position.y - this.row * FIELD_WORLD_SIZE) / FIELD_WORLD_SIZE;
    const x = localX * width;
    // WYT is a bottom-origin TGA. After decoding it to canvas coordinates,
    // increasing WYD Y moves upward on the map, not downward.
    const y = (1 - localY) * height;
    this.#context.save();
    this.#context.translate(x, y);
    this.#context.rotate(-yaw + Math.PI / 2);
    this.#context.beginPath();
    this.#context.moveTo(0, -8);
    this.#context.lineTo(5.5, 6);
    this.#context.lineTo(0, 3.5);
    this.#context.lineTo(-5.5, 6);
    this.#context.closePath();
    this.#context.fillStyle = "#ffe077";
    this.#context.strokeStyle = "#221904";
    this.#context.lineWidth = 2;
    this.#context.stroke();
    this.#context.fill();
    this.#context.restore();
  }
}

function decodeWyt(buffer: ArrayBuffer): HTMLCanvasElement {
  const view = new DataView(buffer);
  const wrapper = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (wrapper !== "WT10") throw new Error("WYT inválido");
  const base = 4;
  const idLength = view.getUint8(base);
  const imageType = view.getUint8(base + 2);
  const width = view.getUint16(base + 12, true);
  const height = view.getUint16(base + 14, true);
  const bits = view.getUint8(base + 16);
  const topOrigin = (view.getUint8(base + 17) & 0x20) !== 0;
  if (imageType !== 2 || bits !== 24) throw new Error(`WYT não suportado: tipo ${imageType}, ${bits} bits`);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D indisponível");
  const image = context.createImageData(width, height);
  const source = new Uint8Array(buffer);
  const pixelStart = base + 18 + idLength;
  for (let sourceY = 0; sourceY < height; sourceY++) {
    const targetY = topOrigin ? sourceY : height - 1 - sourceY;
    for (let x = 0; x < width; x++) {
      const input = pixelStart + (sourceY * width + x) * 3;
      const output = (targetY * width + x) * 4;
      image.data[output] = source[input + 2] ?? 0;
      image.data[output + 1] = source[input + 1] ?? 0;
      image.data[output + 2] = source[input] ?? 0;
      image.data[output + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}
