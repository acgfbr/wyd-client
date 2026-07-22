export class BinaryReader {
  readonly #view: DataView;
  #offset = 0;

  constructor(buffer: ArrayBuffer) {
    this.#view = new DataView(buffer);
  }

  get offset(): number { return this.#offset; }
  get remaining(): number { return this.#view.byteLength - this.#offset; }

  uint8(): number {
    this.#require(1);
    return this.#view.getUint8(this.#offset++);
  }

  int8(): number {
    this.#require(1);
    return this.#view.getInt8(this.#offset++);
  }

  uint32LE(): number {
    this.#require(4);
    const value = this.#view.getUint32(this.#offset, true);
    this.#offset += 4;
    return value;
  }

  ascii(length: number): string {
    this.#require(length);
    const bytes = new Uint8Array(this.#view.buffer, this.#view.byteOffset + this.#offset, length);
    this.#offset += length;
    return new TextDecoder("ascii").decode(bytes);
  }

  #require(length: number): void {
    if (length < 0 || this.#offset + length > this.#view.byteLength) {
      throw new RangeError(`Leitura de ${length} byte(s) fora do buffer no offset ${this.#offset}`);
    }
  }
}

