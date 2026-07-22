import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { deflateSync } from "node:zlib";

const projectRoot = path.resolve(import.meta.dirname, "..");
const clientRoot = path.resolve(process.argv[2] ?? path.join(projectRoot, "../tjs/Origem"));
const outputRoot = path.join(projectRoot, "public/game-data/classic/ui");

const textures = [
  ["NUI/main.wyt", "main.png"],
  ["NUI/mainparts.wyt", "mainparts.png"],
  ["NUI/mainchat.wyt", "mainchat.png"],
  ["UI/Inventory2.wyt", "inventory.png"],
  ["UI/InventoryBox2.wyt", "inventory-slots.png"],
  ["UI/MainBox2.wyt", "mainbox.png"],
  ["UI/hppro.wyt", "status-bars.png"],
];

await mkdir(outputRoot, { recursive: true });
for (const [sourceName, outputName] of textures) {
  const source = path.join(clientRoot, ...sourceName.split("/"));
  await writeFile(path.join(outputRoot, outputName), decodeWyt(await readFile(source)));
}
await copyFile(path.join(clientRoot, "UI", "FontNanum.ttf"), path.join(outputRoot, "FontNanum.ttf"));

console.log(`Importadas ${textures.length} texturas e a fonte clássica em ${outputRoot}`);

function decodeWyt(wyt) {
  if (wyt.length < 22 || wyt.subarray(0, 4).toString("ascii") !== "WT10") {
    throw new Error("WYT inválido: wrapper WT10 ausente");
  }
  const base = 4;
  const idLength = wyt[base];
  const imageType = wyt[base + 2];
  const width = wyt.readUInt16LE(base + 12);
  const height = wyt.readUInt16LE(base + 14);
  const bits = wyt[base + 16];
  const descriptor = wyt[base + 17];
  if (imageType !== 2 || (bits !== 24 && bits !== 32)) {
    throw new Error(`WYT não suportado: tipo ${imageType}, ${bits} bits`);
  }

  const bytesPerPixel = bits / 8;
  const pixelStart = base + 18 + idLength;
  const requiredBytes = width * height * bytesPerPixel;
  if (pixelStart + requiredBytes > wyt.length) throw new Error("WYT truncado");
  const topOrigin = (descriptor & 0x20) !== 0;
  const rightOrigin = (descriptor & 0x10) !== 0;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);

  for (let sourceY = 0; sourceY < height; sourceY++) {
    const targetY = topOrigin ? sourceY : height - 1 - sourceY;
    const rowStart = targetY * (width * 4 + 1);
    scanlines[rowStart] = 0;
    for (let sourceX = 0; sourceX < width; sourceX++) {
      const targetX = rightOrigin ? width - 1 - sourceX : sourceX;
      const input = pixelStart + (sourceY * width + sourceX) * bytesPerPixel;
      const output = rowStart + 1 + targetX * 4;
      scanlines[output] = wyt[input + 2];
      scanlines[output + 1] = wyt[input + 1];
      scanlines[output + 2] = wyt[input];
      scanlines[output + 3] = bytesPerPixel === 4 ? wyt[input + 3] : 255;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}
