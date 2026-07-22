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
  ["UI/character2.wyt", "character.png"],
  ["UI/MainBox2.wyt", "mainbox.png"],
  ["UI/hppro.wyt", "status-bars.png"],
  ["UI/number.wyt", "damage-numbers.png"],
  ["UI/number2.wyt", "magic-damage-numbers.png"],
  ["UI/Skill2.wyt", "skills.png"],
  ["UI/SkillMaster2.wyt", "master-skills.png"],
  ["UI/NewAmul.wyt", "skill-icons.png"],
  // NPC interaction surfaces from the same PC 7.54 client. Keeping these
  // atlases intact lets the web UI reproduce the authored panel geometry
  // without fabricating a replacement skin.
  ["UI/MessageBox2.wyt", "message-box.png"],
  ["UI/Store2.wyt", "store.png"],
  ["UI/Storage2.wyt", "storage.png"],
  ["UI/Quest2.wyt", "quest.png"],
  ["UI/PotalUI.wyt", "portal.png"],
  ["UI/PotalOldUI.wyt", "portal-old.png"],
];
const itemIconAtlases = Array.from({ length: 14 }, (_, index) => {
  const suffix = String(index + 1).padStart(2, "0");
  return [`UI/itemicon${suffix}.wyt`, `itemicon${suffix}.png`];
});

await mkdir(outputRoot, { recursive: true });
for (const [sourceName, outputName] of textures) {
  const source = path.join(clientRoot, ...sourceName.split("/"));
  // NewAmul is the sole legacy grayscale atlas. TextureManager loads it with
  // an opaque-black color key; keep that established mask while restricting
  // the new truecolor color-key path to itemicon01..14 below.
  await writeFile(path.join(outputRoot, outputName), decodeWyt(await readFile(source), {
    blackColorKey: sourceName.endsWith("NewAmul.wyt"),
  }));
}
for (const [sourceName, outputName] of itemIconAtlases) {
  const source = path.join(clientRoot, ...sourceName.split("/"));
  await writeFile(path.join(outputRoot, outputName), decodeWyt(await readFile(source), {
    allowProprietaryWrapper: sourceName.endsWith("itemicon07.wyt"),
    blackColorKey: true,
  }));
}

const itemIconTable = await readFile(path.join(clientRoot, "itemicon.bin"));
if (itemIconTable.length % 4 !== 0) {
  throw new Error(`itemicon.bin possui ${itemIconTable.length} bytes; esperado múltiplo de 4`);
}
// Basedef.cpp declares `g_itemicon[6500]` and reads the file directly into the
// zero-initialised global array. Some shipped clients contain a short table, so
// reproduce the implicit zero-filled tail instead of exposing `undefined`.
const itemToIcon = Array.from({ length: 6500 }, (_, itemIndex) => {
  const offset = itemIndex * 4;
  const oneBasedIcon = offset + 4 <= itemIconTable.length ? itemIconTable.readInt32LE(offset) : 0;
  return oneBasedIcon > 0 ? oneBasedIcon - 1 : -1;
});
const itemIconManifest = {
  version: 1,
  cellSize: 35,
  columns: 10,
  iconsPerAtlas: 100,
  atlases: itemIconAtlases.map(([, outputName]) => outputName),
  itemToIcon,
};
await writeFile(
  path.join(outputRoot, "item-icons.json"),
  `${JSON.stringify(itemIconManifest)}\n`,
);
await copyFile(path.join(clientRoot, "UI", "FontNanum.ttf"), path.join(outputRoot, "FontNanum.ttf"));

console.log(
  `Importadas ${textures.length} texturas de UI, ${itemIconAtlases.length} atlas de itens, `
  + `${itemToIcon.filter((icon) => icon >= 0).length} mapeamentos e a fonte clássica em ${outputRoot}`,
);

function decodeWyt(wyt, options = {}) {
  const { allowProprietaryWrapper = false, blackColorKey = false } = options;
  const hasStandardWrapper = wyt.subarray(0, 4).toString("ascii") === "WT10";
  if (wyt.length < 22 || (!hasStandardWrapper && !allowProprietaryWrapper)) {
    throw new Error("WYT inválido: wrapper WT10 ausente");
  }
  // WYT is a four-byte client wrapper followed by an ordinary TGA stream.
  // itemicon07 in this client has a proprietary four-byte marker (00 4b 6d 4b)
  // but the payload at byte four follows the exact same TGA layout.
  const base = 4;
  const idLength = wyt[base];
  const colorMapType = wyt[base + 1];
  const imageType = wyt[base + 2];
  const width = wyt.readUInt16LE(base + 12);
  const height = wyt.readUInt16LE(base + 14);
  const bits = wyt[base + 16];
  const descriptor = wyt[base + 17];
  const trueColor = (imageType === 2 || imageType === 10) && (bits === 24 || bits === 32);
  const grayscale = imageType === 3 && bits === 8;
  if (colorMapType !== 0 || !trueColor && !grayscale || width === 0 || height === 0) {
    throw new Error(`WYT não suportado: tipo ${imageType}, ${bits} bits`);
  }

  const bytesPerPixel = bits / 8;
  const pixelStart = base + 18 + idLength;
  const pixelCount = width * height;
  const pixels = imageType === 10
    ? decodeTgaRle(wyt, pixelStart, pixelCount, bytesPerPixel)
    : wyt.subarray(pixelStart, pixelStart + pixelCount * bytesPerPixel);
  if (pixels.length !== pixelCount * bytesPerPixel) throw new Error("WYT truncado");
  const topOrigin = (descriptor & 0x20) !== 0;
  const rightOrigin = (descriptor & 0x10) !== 0;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);

  for (let sourceY = 0; sourceY < height; sourceY++) {
    const targetY = topOrigin ? sourceY : height - 1 - sourceY;
    const rowStart = targetY * (width * 4 + 1);
    scanlines[rowStart] = 0;
    for (let sourceX = 0; sourceX < width; sourceX++) {
      const targetX = rightOrigin ? width - 1 - sourceX : sourceX;
      const input = (sourceY * width + sourceX) * bytesPerPixel;
      const output = rowStart + 1 + targetX * 4;
      if (grayscale) {
        const luminance = pixels[input];
        scanlines[output] = luminance;
        scanlines[output + 1] = luminance;
        scanlines[output + 2] = luminance;
        scanlines[output + 3] = blackColorKey && luminance === 0 ? 0 : 255;
      } else {
        const red = pixels[input + 2];
        const green = pixels[input + 1];
        const blue = pixels[input];
        scanlines[output] = red;
        scanlines[output + 1] = green;
        scanlines[output + 2] = blue;
        scanlines[output + 3] = blackColorKey && red === 0 && green === 0 && blue === 0
          ? 0
          : bytesPerPixel === 4 ? pixels[input + 3] : 255;
      }
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

function decodeTgaRle(source, start, pixelCount, bytesPerPixel) {
  const output = Buffer.alloc(pixelCount * bytesPerPixel);
  let input = start;
  let outputPixel = 0;
  while (outputPixel < pixelCount) {
    if (input >= source.length) throw new Error("WYT RLE truncado no cabeçalho do pacote");
    const packet = source[input++];
    const count = (packet & 0x7f) + 1;
    if (outputPixel + count > pixelCount) throw new Error("WYT RLE excede a quantidade de pixels");
    if ((packet & 0x80) !== 0) {
      if (input + bytesPerPixel > source.length) throw new Error("WYT RLE truncado no pixel repetido");
      const pixel = source.subarray(input, input + bytesPerPixel);
      input += bytesPerPixel;
      for (let index = 0; index < count; index++) {
        pixel.copy(output, (outputPixel + index) * bytesPerPixel);
      }
    } else {
      const byteCount = count * bytesPerPixel;
      if (input + byteCount > source.length) throw new Error("WYT RLE truncado no pacote literal");
      source.copy(output, outputPixel * bytesPerPixel, input, input + byteCount);
      input += byteCount;
    }
    outputPixel += count;
  }
  return output;
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
