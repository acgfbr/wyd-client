import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const projectRoot = path.resolve(import.meta.dirname, "..");
const clientRoot = path.resolve(process.argv[2] ?? path.resolve(projectRoot, "../tjs/Origem"));
const serverDataRoot = path.resolve(process.argv[3] ?? path.join(path.dirname(clientRoot), "tools/data"));
const envRoot = path.join(clientRoot, "Env");
const outputRoot = path.join(projectRoot, "public/game-data/classic");
const fieldsRoot = path.join(outputRoot, "fields");
const texturesRoot = path.join(outputRoot, "textures/env");
const objectsRoot = path.join(outputRoot, "objects");
const minimapsRoot = path.join(outputRoot, "minimaps");
const modelsRoot = path.join(outputRoot, "models");
const modelTexturesRoot = path.join(modelsRoot, "textures");
const effectTexturesRoot = path.join(outputRoot, "textures/effects");
const waterTexturesRoot = path.join(outputRoot, "textures/water");
const monstersRoot = path.join(outputRoot, "monsters");
const navigationRoot = path.join(outputRoot, "navigation");
const monsterSkeletonsRoot = path.join(monstersRoot, "skeletons");
const monsterMeshesRoot = path.join(monstersRoot, "meshes");
const monsterAnimationsRoot = path.join(monstersRoot, "animations");
const monsterTexturesRoot = path.join(monstersRoot, "textures");
const fieldPattern = /^Field(\d{2})(\d{2})\.trn$/i;
const envRecordBytes = 528;
const tileCount = 64 * 64;
const tileBytes = 12;
// TMHouse does not store fountain/waterfall surfaces in the DAT. These meshes
// are selected indirectly from the owning structure in TMHouse::InitObject.
const houseWaterCompanions = new Map([
  [195, 196], [273, 280], [274, 281], [292, 293], [697, 698], [699, 700],
  [490, 491], [1520, 1521], [1526, 1527], [1535, 1536], [1695, 1696],
  [1665, 1666], [2005, 2006], [1993, 1994],
]);
// Resultado exato de BASE_DefineSkinMeshType, extraído do cliente clássico.
const skinByItemClass = new Map(Object.entries({
  1: 0, 2: 1, 4: 0, 8: 1, 16: 20, 17: 21, 18: 22, 19: 23, 20: 24,
  21: 2, 22: 25, 23: 26, 24: 27, 25: 2, 26: 3, 27: 28, 28: 29, 29: 6,
  30: 4, 31: 32, 32: 7, 33: 8, 34: 0, 35: 29, 36: 0, 37: 1, 38: 1,
  39: 0, 40: 0, 41: 69, 42: 30, 43: 31, 44: 33, 45: 23, 46: 11,
  47: 35, 48: 34, 49: 36, 50: 37, 51: 38, 52: 39, 53: 40, 54: 9,
  55: 10, 56: 41, 57: 12, 58: 42, 59: 43, 60: 0, 61: 1, 62: 5,
  63: 0, 64: 44, 66: 45, 67: 46, 68: 47, 69: 48, 70: 53, 71: 54,
  72: 55, 73: 56, 74: 57,
}).map(([itemClass, skin]) => [Number(itemClass), skin]));
const faceLookCopySkins = new Set([
  20, 39, 21, 22, 23, 24, 40, 3, 4, 25, 28, 29, 2, 6, 7, 8,
  30, 31, 33, 36, 12, 43, 10, 5, 45, 46, 47, 53, 54, 55, 56, 57,
]);

await mkdir(fieldsRoot, { recursive: true });
await mkdir(texturesRoot, { recursive: true });
await mkdir(objectsRoot, { recursive: true });
await mkdir(minimapsRoot, { recursive: true });
await mkdir(modelsRoot, { recursive: true });
await mkdir(modelTexturesRoot, { recursive: true });
await mkdir(effectTexturesRoot, { recursive: true });
await mkdir(waterTexturesRoot, { recursive: true });
await mkdir(monsterSkeletonsRoot, { recursive: true });
await mkdir(monsterMeshesRoot, { recursive: true });
await mkdir(monsterAnimationsRoot, { recursive: true });
await mkdir(monsterTexturesRoot, { recursive: true });
await mkdir(navigationRoot, { recursive: true });

const attributeMapSource = path.join(envRoot, "AttributeMap.dat");
const objectMasksSource = path.join(clientRoot, "object.bin");
const attributeMapData = await readFile(attributeMapSource);
const objectMasksData = await readFile(objectMasksSource);
const attributePayloadBytes = 1024 * 1024;
const objectMaskPayloadBytes = 2048 * 16 * 16;
if (attributeMapData.length !== attributePayloadBytes && attributeMapData.length !== attributePayloadBytes + 4) {
  throw new Error(`AttributeMap.dat possui ${attributeMapData.length} bytes; esperado ${attributePayloadBytes} ou ${attributePayloadBytes + 4}`);
}
if (objectMasksData.length !== objectMaskPayloadBytes + 4) {
  throw new Error(`object.bin possui ${objectMasksData.length} bytes; esperado ${objectMaskPayloadBytes + 4}`);
}
const attributeBaseChecksum = calculateBaseChecksum(attributeMapData.subarray(0, attributePayloadBytes));
if (attributeMapData.length === attributePayloadBytes + 4 && attributeMapData.readInt32LE(attributePayloadBytes) !== attributeBaseChecksum) {
  throw new Error("Checksum interno de AttributeMap.dat invalido");
}
const objectEncryptedChecksum = calculateObjectMaskChecksum(objectMasksData.subarray(0, objectMaskPayloadBytes));
if (objectMasksData.readInt32LE(objectMaskPayloadBytes) !== objectEncryptedChecksum) {
  throw new Error("Checksum interno de object.bin invalido");
}
await copyFile(attributeMapSource, path.join(navigationRoot, "AttributeMap.dat"));
await copyFile(objectMasksSource, path.join(navigationRoot, "object.bin"));
const navigation = {
  attributeMap: {
    file: "navigation/AttributeMap.dat",
    bytes: attributeMapData.length,
    sha256: sha256(attributeMapData),
    baseChecksum: attributeBaseChecksum,
  },
  objectMasks: {
    file: "navigation/object.bin",
    bytes: objectMasksData.length,
    sha256: sha256(objectMasksData),
    encryptedChecksum: objectEncryptedChecksum,
  },
};

const envList = await readFile(path.join(envRoot, "EnvTextureList3.bin"));
if (envList.length % envRecordBytes !== 0) throw new Error("EnvTextureList3.bin possui tamanho inesperado");

const textureRecords = Array.from({ length: envList.length / envRecordBytes }, (_, index) => {
  const start = index * envRecordBytes;
  const terminator = envList.indexOf(0, start);
  const end = terminator < start || terminator > start + 255 ? start + 255 : terminator;
  return {
    file: envList.subarray(start, end).toString("latin1").replaceAll("\\", path.sep),
    alpha: String.fromCharCode(envList[start + 510] ?? 0),
  };
});

const entries = await readdir(envRoot, { withFileTypes: true });
const fieldFiles = entries.filter((entry) => entry.isFile() && fieldPattern.test(entry.name)).map((entry) => entry.name).sort();
const fields = [];
const usedTextureIndices = new Set();
const usedObjectTypes = new Set();

for (const fileName of fieldFiles) {
  const match = fieldPattern.exec(fileName);
  if (!match) continue;
  const source = path.join(envRoot, fileName);
  const data = await readFile(source);
  const payload = 1 + (data[0] ?? 0) + 2;
  if (data.length !== payload + tileCount * tileBytes) throw new Error(`${fileName}: tamanho inválido`);
  for (let tile = 0; tile < tileCount; tile++) {
    const offset = payload + tile * tileBytes;
    usedTextureIndices.add((data[offset + 1] ?? 0) + 10);
    const background = data[offset + 3] ?? 0;
    if (background !== 0) usedTextureIndices.add(background + 256);
  }
  await copyFile(source, path.join(fieldsRoot, fileName));
  const objectFile = fileName.replace(/\.trn$/i, ".dat");
  const objectSource = path.join(envRoot, objectFile);
  const objectData = await readFile(objectSource).catch(() => null);
  const hasObjects = objectData !== null;
  if (objectData) {
    await copyFile(objectSource, path.join(objectsRoot, objectFile));
    for (let offset = 0; offset + 28 <= objectData.length;) {
      const type = objectData.readUInt32LE(offset);
      usedObjectTypes.add(type);
      offset += type >= 501 && type < 600 ? 36 : 28;
    }
  }
  const minimapFile = `m${match[1]}${match[2]}.wyt`;
  const hasMinimap = await copyFile(path.join(clientRoot, "UI", minimapFile), path.join(minimapsRoot, minimapFile)).then(() => true).catch(() => false);
  fields.push({
    file: fileName,
    column: Number(match[1]),
    row: Number(match[2]),
    ...(hasObjects ? { objectFile } : {}),
    ...(hasMinimap ? { minimapFile } : {}),
  });
}

const textures = {};
for (const index of [...usedTextureIndices].sort((a, b) => a - b)) {
  const record = textureRecords[index];
  if (!record?.file) continue;
  const source = path.join(clientRoot, record.file);
  const encoded = await readFile(source).catch(() => null);
  if (!encoded || encoded.length < 90 || path.extname(source).toLowerCase() !== ".wys") continue;
  const dds = Buffer.from(encoded.subarray(1));
  dds.write("DDS", 0, "ascii");
  dds.write(dds[84] === "2".charCodeAt(0) ? "DXT1" : "DXT3", 84, "ascii");
  const outputName = `${String(index).padStart(3, "0")}.dds`;
  await writeFile(path.join(texturesRoot, outputName), dds);
  textures[index] = { file: `textures/env/${outputName}`, alpha: record.alpha };
}

const meshListText = await readFile(path.join(clientRoot, "mesh", "MeshList.txt"), "latin1");
const meshList = new Map();
for (const line of meshListText.split(/\r?\n/)) {
  const match = line.trim().match(/^(\d+)\s+(.+)$/);
  if (match) meshList.set(Number(match[1]), match[2].trim().replaceAll("\\", path.sep));
}
const meshFiles = await caseInsensitiveFiles(path.join(clientRoot, "mesh"));
const effectFiles = await caseInsensitiveFiles(path.join(clientRoot, "Effect"));
const objectModels = {};

// TMSea uses four fixed slots from MeshTextureList rather than an MSA texture
// name (two outdoor layers and two dungeon layers).
const modelTextureList = await readFile(path.join(clientRoot, "mesh", "MeshTextureList.bin"));
if (modelTextureList.length % envRecordBytes !== 0) throw new Error("MeshTextureList.bin possui tamanho inesperado");
const modelTextureAlphaByFile = new Map();
for (let index = 0; index < modelTextureList.length / envRecordBytes; index++) {
  const start = index * envRecordBytes;
  const terminator = modelTextureList.indexOf(0, start);
  const end = terminator < start || terminator > start + 255 ? start + 255 : terminator;
  const listedFile = modelTextureList.subarray(start, end).toString("latin1").replaceAll("\\", path.sep);
  if (!listedFile) continue;
  modelTextureAlphaByFile.set(
    path.basename(listedFile).toLowerCase(),
    String.fromCharCode(modelTextureList[start + 510] ?? 0),
  );
}
const waterTextures = {};
for (const index of [1, 2, 3, 8, 9]) {
  const start = index * envRecordBytes;
  const terminator = modelTextureList.indexOf(0, start);
  const end = terminator < start || terminator > start + 255 ? start + 255 : terminator;
  const listedFile = modelTextureList.subarray(start, end).toString("latin1").replaceAll("\\", path.sep);
  const actualName = meshFiles.get(path.basename(listedFile).toLowerCase());
  if (!actualName) continue;
  const outputName = `${String(index).padStart(3, "0")}.dds`;
  await writeFile(path.join(waterTexturesRoot, outputName), decodeWys(await readFile(path.join(clientRoot, "mesh", actualName))));
  waterTextures[index] = {
    file: `textures/water/${outputName}`,
    alpha: String.fromCharCode(modelTextureList[start + 510] ?? 0),
  };
}

// O TMHouse 474 desenha a hélice como GetCommonMesh(dwObjType + 1), portanto
// o MSA 475 é uma dependência indireta e não aparece nos records DAT.
usedObjectTypes.add(475);
// TMArrow type 152 level 2 (Explosão Etérea) referencia estes modelos
// diretamente; eles também não aparecem nos records dos mapas.
usedObjectTypes.add(28); // Effect/plane.msa, aura animada 101..104
usedObjectTypes.add(863); // mesh/sword01.msa, lâmina do projétil
// Buffs persistentes da Huntress não aparecem em DAT: Imunidade e Ligação Espectral.
usedObjectTypes.add(12); // Effect/sphere2.msa
usedObjectTypes.add(2839); // Effect/unsole.msa
// Força Espectral (#101) renders the weapon-owned SForce layers from
// TMEffectSWSwing::Render. They are indirect dependencies, not DAT objects.
usedObjectTypes.add(10);
usedObjectTypes.add(19);
usedObjectTypes.add(20);
// Dependências de itens fora dos DAT: preview 3D e materialização de drops.
// São itens equipáveis/consumíveis/materiais e por isso não aparecem nos mapas.
usedObjectTypes.add(53); // mesh/hpotion1.msa
usedObjectTypes.add(56); // mesh/mpotion1.msa
usedObjectTypes.add(61); // mesh/oriharukon.msa — Poeira de Oriharucon #412
usedObjectTypes.add(62); // mesh/laktererium.msa — Poeira de Lactolerium #413
usedObjectTypes.add(762); // mesh/bow16.msa
usedObjectTypes.add(2883); // mesh/valkyrie.msa
// TMEffectStart (used by Beast Master summon materialization) resolves this
// common mesh directly and replaces its first texture with effect slot 52.
usedObjectTypes.add(703); // Effect/start.msa
// Class skill renderers resolve these effect meshes directly rather than from
// a Field DAT. Keep the dependency set beside the other indirect VFX so a
// clean clone receives the same runtime assets from `bun run import:classic`.
usedObjectTypes.add(701); // Effect/arrow.msa — Foema Flecha Mágica
usedObjectTypes.add(702); // Effect/FireBall.msa — Golpe Duplo / Fênix
usedObjectTypes.add(704); // Effect/energy01.msa — Escudo Mágico
usedObjectTypes.add(705); // Effect/energy02.msa — Escudo Mágico
usedObjectTypes.add(706); // Effect/icefreeze1.msa — Lâmina Congelada
usedObjectTypes.add(707); // Effect/icefreeze2.msa — Tempestade de Gelo
usedObjectTypes.add(708); // Effect/icespear.msa — Lança de Gelo / Nevasca
// Fúria de Gaia (#52) encadeia os sete segmentos de TMSkillFreezeBlade e
// sobrescreve a textura de todos eles com mesh/stone01.wys.
for (let type = 712; type <= 718; type++) usedObjectTypes.add(type);
usedObjectTypes.add(2838); // Effect/crarmor.msa — Armadura Crítica
usedObjectTypes.add(2840); // Effect/destiny.msa — Destino
for (const [ownerType, waterType] of houseWaterCompanions) {
  if (usedObjectTypes.has(ownerType)) usedObjectTypes.add(waterType);
}

for (const type of [...usedObjectTypes].sort((a, b) => a - b)) {
  const listedPath = meshList.get(type);
  if (!listedPath) continue;
  const isEffect = listedPath.toLowerCase().startsWith(`effect${path.sep}`);
  const sourceDir = isEffect ? path.join(clientRoot, "Effect") : path.join(clientRoot, "mesh");
  const directoryFiles = isEffect ? effectFiles : meshFiles;
  const sourceName = path.basename(listedPath);
  const actualName = directoryFiles.get(sourceName.toLowerCase());
  if (!actualName) continue;
  const msa = await readFile(path.join(sourceDir, actualName));
  const outputName = `${type}.msa`;
  await writeFile(path.join(modelsRoot, outputName), msa);
  const textureNames = readMsaTextureNames(msa);
  const modelTextures = [];
  for (const textureName of textureNames) {
    // Effect MSAs commonly embed root-relative Windows names (for example
    // "\\spec01"). Normalise separators before basename resolution.
    const normalizedTextureName = textureName.replaceAll("\\", path.sep);
    const baseName = path.basename(
      normalizedTextureName,
      path.extname(normalizedTextureName),
    );
    const wysName = directoryFiles.get(`${baseName}.wys`.toLowerCase());
    if (!wysName) {
      modelTextures.push(null);
      continue;
    }
    const encoded = await readFile(path.join(sourceDir, wysName));
    const dds = decodeWys(encoded);
    const textureOutput = `${isEffect ? "effect" : "mesh"}-${baseName.toLowerCase()}.dds`;
    await writeFile(path.join(modelTexturesRoot, textureOutput), dds);
    modelTextures.push(`models/textures/${textureOutput}`);
  }
  objectModels[type] = { file: `models/${outputName}`, textures: modelTextures };
}

// EffectTextureList.bin uses the same 528-byte on-disk records as the
// environment list. Import every referenced WYS so map effects, skills and
// weather can share one canonical texture table as their renderers arrive.
const effectList = await readFile(path.join(clientRoot, "Effect", "EffectTextureList.bin"));
if (effectList.length % envRecordBytes !== 0) throw new Error("EffectTextureList.bin possui tamanho inesperado");
const effectTextures = {};
for (let index = 0; index < effectList.length / envRecordBytes; index++) {
  const start = index * envRecordBytes;
  const terminator = effectList.indexOf(0, start);
  const end = terminator < start || terminator > start + 255 ? start + 255 : terminator;
  const listedFile = effectList.subarray(start, end).toString("latin1").replaceAll("\\", path.sep);
  if (!listedFile || path.extname(listedFile).toLowerCase() !== ".wys") continue;
  const actualName = effectFiles.get(path.basename(listedFile).toLowerCase());
  if (!actualName) continue;
  const encoded = await readFile(path.join(clientRoot, "Effect", actualName));
  const outputName = `${String(index).padStart(3, "0")}.dds`;
  await writeFile(path.join(effectTexturesRoot, outputName), decodeWys(encoded));
  effectTextures[index] = {
    file: `textures/effects/${outputName}`,
    alpha: String.fromCharCode(effectList[start + 510] ?? 0),
  };
}

const monsterImport = await importMonsterCatalog();

const manifest = {
  version: 1,
  source: "WYD classic",
  defaultMap: "armia",
  maps: { armia: { label: "Armia", spawn: [2100, 2100], centerBlock: [16, 16] } },
  fields,
  textures,
  effectTextures,
  waterTextures,
  objectModels,
  navigation,
  monsters: monsterImport.manifest,
};
await writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `Importados ${fields.length} blocos, máscaras autoritativas de navegação, ${Object.keys(textures).length} texturas de terreno, ${Object.keys(effectTextures).length} texturas de efeito, ${Object.keys(objectModels).length} modelos de cenário e ${monsterImport.generatorCount} geradores de monstros (${monsterImport.templateCount} templates).`,
);

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function calculateBaseChecksum(data) {
  let sum = 0;
  for (let index = 0; index < data.length; index++) {
    const value = signedByte(data[index]);
    const mod = index % 7;
    if (mod === 0) sum = (sum + Math.trunc(value / 2)) | 0;
    if (mod === 1) sum = (sum + (value ^ 0xff)) | 0;
    if (mod === 2) sum = (sum + 3 * value) | 0;
    if (mod === 3) sum = (sum + 2 * value) | 0;
    if (mod === 4) sum = (sum - Math.trunc(value / 7)) | 0;
    if (mod === 5) sum = (sum - value) | 0;
    else sum = (sum + Math.trunc(value / 3)) | 0;
  }
  return sum;
}

function calculateObjectMaskChecksum(data) {
  let checksum = 0;
  for (let mask = 0; mask < 2048; mask++) {
    for (let y = 0; y < 16; y++) {
      const row = mask * 256 + y * 16;
      for (let x = 0; x < 16; x++) {
        checksum = (checksum + signedByte(data[row + x]) % 4 + 2 * y + 5 * mask) | 0;
      }
    }
  }
  return checksum;
}

function signedByte(value) {
  return value > 127 ? value - 256 : value;
}

function decodeWys(encoded) {
  if (encoded.length < 90) throw new Error("WYS truncado");
  const dds = Buffer.from(encoded.subarray(1));
  dds.write("DDS", 0, "ascii");
  dds.write(dds[84] === "2".charCodeAt(0) ? "DXT1" : "DXT3", 84, "ascii");
  return dds;
}

function readMsaTextureNames(msa) {
  if (msa.length < 12) return [];
  const attributeCount = msa.readUInt32LE(8);
  let offset = 12 + attributeCount * 20;
  const names = [];
  for (let index = 0; index < attributeCount && offset + 11 <= msa.length; index++, offset += 11) {
    names.push(msa.subarray(offset, offset + 11).toString("latin1").split("\0", 1)[0]);
  }
  return names;
}

async function caseInsensitiveFiles(directory) {
  const names = await readdir(directory);
  return new Map(names.map((name) => [name.toLowerCase(), name]));
}

async function importMonsterCatalog() {
  const npcGenerText = await readFile(path.join(serverDataRoot, "NPCGener.txt"), "latin1");
  const npcDatabaseRoot = path.join(serverDataRoot, "npcdb");
  const npcDatabaseFiles = await caseInsensitiveFiles(npcDatabaseRoot);
  const generators = parseNpcGenerators(npcGenerText);
  const templateNames = [...new Set(generators.flatMap((generator) => [generator.values.get("Leader"), generator.values.get("Follower")]).filter(Boolean))]
    .sort(compareAscii);
  const templateIndex = new Map(templateNames.map((name, index) => [name, index]));

  const itemList = Buffer.from(await readFile(path.join(clientRoot, "ItemList.bin")));
  const itemRecordBytes = 152;
  if (itemList.length % itemRecordBytes !== 0) throw new Error("ItemList.bin possui tamanho inesperado");
  for (let index = 0; index < itemList.length; index++) itemList[index] ^= 0x5a;

  const boneAnimations = readBoneAnimationList(await readFile(path.join(clientRoot, "mesh", "BoneAni4.txt"), "latin1"));
  const validAnimationIndices = await readFile(path.join(clientRoot, "mesh", "ValidIndex.bin"));
  if (validAnimationIndices.length < 100 * 186 * 4) throw new Error("ValidIndex.bin possui tamanho inesperado");
  const animationActions = readAnimationActions(await readFile(path.join(clientRoot, "AniSound4.txt"), "latin1"));
  const itemCache = new Map();
  const usedItemIndices = new Set();
  const usedSkins = new Set();
  const unresolvedTemplates = [];
  const meshCopies = new Map();
  const skeletonCopies = new Map();
  const animationCopies = new Map();
  const textureCopies = new Map();

  const readItem = (index) => {
    if (!index || index < 0 || index >= itemList.length / itemRecordBytes) return null;
    if (itemCache.has(index)) return itemCache.get(index);
    const offset = index * itemRecordBytes;
    let itemClass = null;
    for (let effect = 0; effect < 12; effect++) {
      const effectOffset = offset + 80 + effect * 4;
      if (itemList.readInt16LE(effectOffset) === 18) itemClass = itemList.readInt16LE(effectOffset + 2);
    }
    const item = {
      index,
      name: readCString(itemList, offset, 64),
      mesh: itemList.readInt16LE(offset + 64),
      texture: itemList.readInt16LE(offset + 66),
      visualEffect: itemList.readInt16LE(offset + 68),
      itemClass,
    };
    itemCache.set(index, item);
    return item;
  };

  const templates = [];
  for (const key of templateNames) {
    const databaseFile = resolveNpcDatabaseFile(npcDatabaseFiles, key);
    if (!databaseFile) {
      unresolvedTemplates.push(key);
      templates.push({ key, name: key.replaceAll("_", " ").trim(), missing: true });
      continue;
    }
    const data = await readFile(path.join(npcDatabaseRoot, databaseFile));
    if (data.length !== 756) throw new Error(`${databaseFile}: template NPC possui ${data.length} bytes, esperado 756`);
    const equipment = [];
    const equipmentIndices = [];
    for (let slot = 0; slot < 16; slot++) {
      const offset = 92 + slot * 8;
      const itemIndex = data.readUInt16LE(offset);
      equipmentIndices.push(itemIndex);
      if (itemIndex) usedItemIndices.add(itemIndex);
      equipment.push(
        itemIndex,
        data[offset + 2],
        data[offset + 3],
        data[offset + 4],
        data[offset + 5],
        data[offset + 6],
        data[offset + 7],
      );
    }

    const faceItem = readItem(equipmentIndices[0]);
    const skin = faceItem?.itemClass === null ? undefined : skinByItemClass.get(faceItem?.itemClass);
    const boneAnimation = skin === undefined ? undefined : boneAnimations.get(skin);
    let visual;
    if (skin !== undefined && boneAnimation) {
      usedSkins.add(skin);
      // TMHuman::SetPacketMOBItem first resolves LOOK_INFO from every equipped
      // ItemList entry. InitObject then copies the face look into selected
      // parts for the one/two-piece monster families.
      const look = equipmentIndices.map((itemIndex) => {
        const item = readItem(itemIndex);
        return { item: itemIndex, mesh: item?.mesh ?? 0, texture: item?.texture ?? 0 };
      });
      applyClassicMonsterLookOverrides(look, skin, faceItem.itemClass);
      const expand = classicLookExpand(faceItem.itemClass);
      const parts = [];
      for (let part = 1; part <= boneAnimation.partCount; part++) {
        const partLook = look[part - 1] ?? { item: 0, mesh: 0, texture: 0 };
        // RestoreDeviceObjects skips an empty secondary part only for the
        // special >=90 face meshes. Normal looks still try variant 01.
        if ((look[0]?.mesh ?? 0) >= 90 && part > 1 && partLook.mesh === 0) continue;

        const forceDefault = skin === 45 || skin === 46 || skin === 53 || skin === 54;
        const meshVariant = forceDefault ? 1 : partLook.mesh + 20 * expand + 1;
        let meshStem = `${boneAnimation.base}${String(part).padStart(2, "0")}${String(meshVariant).padStart(2, "0")}`.toLowerCase();
        // Skin 53 (sp02) is a God2 family but explicitly opts back into one
        // texture per part after God2Exception in the original client.
        const texturePart = skin === 53 ? part : god2Exception(boneAnimation.base, part - 1) ? 1 : part;
        const textureVariant = forceDefault
          ? 1
          : (partLook.texture & 0xFFF) + partLook.mesh + 20 * expand + 1;
        let textureStem = `${boneAnimation.base}${String(texturePart).padStart(2, "0")}${String(textureVariant).padStart(2, "0")}`.toLowerCase();
        ({ meshStem, textureStem } = applyClassicSkinFileExceptions(meshStem, textureStem));

        const meshSource = meshFiles.get(`${meshStem}.msh`);
        if (!meshSource) continue;
        const meshOutput = `${meshStem}.msh`;
        meshCopies.set(meshSource, meshOutput);

        const textureSource = meshFiles.get(`${textureStem}.wys`);
        const textureOutput = textureSource ? `${path.basename(textureSource, path.extname(textureSource)).toLowerCase()}.dds` : null;
        const textureAlpha = textureSource ? (modelTextureAlphaByFile.get(textureSource.toLowerCase()) ?? null) : null;
        if (textureSource && textureOutput) textureCopies.set(textureSource, textureOutput);
        parts.push([
          part,
          partLook.item,
          partLook.mesh,
          partLook.texture,
          `monsters/meshes/${meshOutput}`,
          textureOutput ? `monsters/textures/${textureOutput}` : null,
          textureAlpha,
        ]);
      }
      visual = { skin, itemClass: faceItem.itemClass, parts };
    }

    templates.push({
      key,
      name: readCString(data, 0, 16) || key.replaceAll("_", " ").trim(),
      ...(databaseFile !== key ? { databaseFile } : {}),
      clan: data[16],
      merchant: data[17],
      guild: data.readUInt16LE(18),
      characterClass: data[20],
      coin: data.readInt32LE(24),
      experience: data.readUInt32LE(28),
      home: [data.readUInt16LE(32), data.readUInt16LE(34)],
      baseScore: readNpcScore(data, 36),
      currentScore: readNpcScore(data, 64),
      equipment,
      learnedSkill: data.readUInt32LE(732),
      bonuses: [
        data.readInt16LE(736),
        data.readInt16LE(738),
        data.readInt16LE(740),
        data[742],
        data[743],
        data[744],
        data[745],
        data[746],
        data[747],
        data[748],
        data[749],
        data[750],
        data[751],
        data[752],
        data[753],
        data[754],
        data[755],
      ],
      ...(visual ? { visual } : {}),
    });
  }

  // TMTree/TMLeaf/TMShip e a pequena fauna não passam pelo MeshList/MSA. O
  // número no DAT escolhe uma família BON+ANI+MSH e preenche LOOK_INFO. É
  // importante importar essa tabela separadamente: os mesmos números no
  // MeshList apontam para itens completamente diferentes (a origem das
  // antigas "mini montarias" no gramado).
  const skinnedObjects = {};
  for (const type of [...usedObjectTypes].sort((a, b) => a - b)) {
    const definition = skinnedObjectLooksForType(type);
    if (!definition) continue;
    const boneAnimation = boneAnimations.get(definition.skin);
    if (!boneAnimation) continue;
    usedSkins.add(definition.skin);
    const variants = [];
    for (const look of definition.looks) {
      let meshStem = `${boneAnimation.base}01${String(look.mesh0 + 1).padStart(2, "0")}`.toLowerCase();
      let textureStem = `${boneAnimation.base}01${String(look.skin0 + look.mesh0 + 1).padStart(2, "0")}`.toLowerCase();
      ({ meshStem, textureStem } = applyClassicSkinFileExceptions(meshStem, textureStem));
      const meshSource = meshFiles.get(`${meshStem}.msh`);
      if (!meshSource) continue;
      const meshOutput = `${path.basename(meshSource, path.extname(meshSource)).toLowerCase()}.msh`;
      meshCopies.set(meshSource, meshOutput);
      const textureSource = meshFiles.get(`${textureStem}.wys`);
      const textureOutput = textureSource ? `${path.basename(textureSource, path.extname(textureSource)).toLowerCase()}.dds` : null;
      const textureAlpha = textureSource ? (modelTextureAlphaByFile.get(textureSource.toLowerCase()) ?? null) : null;
      if (textureSource && textureOutput) textureCopies.set(textureSource, textureOutput);

      // In Fields 27..30 x 21..24 the original client forces Skin0=9 for
      // leaf types 311..316. Keep the alternate DDS reachable without
      // duplicating thousands of catalog entries.
      let regionalTextureOutput = null;
      let regionalTextureAlpha = null;
      if (definition.kind === "leaf" && type <= 316) {
        let regionalStem = `${boneAnimation.base}01${String(look.mesh0 + 10).padStart(2, "0")}`.toLowerCase();
        ({ textureStem: regionalStem } = applyClassicSkinFileExceptions(meshStem, regionalStem));
        const regionalSource = meshFiles.get(`${regionalStem}.wys`);
        regionalTextureOutput = regionalSource
          ? `${path.basename(regionalSource, path.extname(regionalSource)).toLowerCase()}.dds`
          : null;
        regionalTextureAlpha = regionalSource
          ? (modelTextureAlphaByFile.get(regionalSource.toLowerCase()) ?? null)
          : null;
        if (regionalSource && regionalTextureOutput) textureCopies.set(regionalSource, regionalTextureOutput);
      }
      variants.push({
        mesh0: look.mesh0,
        skin0: look.skin0,
        mesh: `monsters/meshes/${meshOutput}`,
        texture: textureOutput ? `monsters/textures/${textureOutput}` : null,
        alpha: textureAlpha,
        ...(regionalTextureOutput ? {
          regionalTexture: `monsters/textures/${regionalTextureOutput}`,
          regionalAlpha: regionalTextureAlpha,
        } : {}),
      });
    }
    if (variants.length === 0) continue;
    skinnedObjects[type] = {
      kind: definition.kind,
      skin: definition.skin,
      variants,
    };
  }

  // TMSkillSpChange (#87 da Huntress) cria TMSkinMesh skin 86 diretamente.
  // Esse look wg01 não pertence a nenhum gerador/DAT, portanto precisa entrar
  // como dependência skinned indireta: duas partes, LOOK_INFO zerado.
  usedSkins.add(86);
  for (const part of [1, 2]) {
    const stem = `wg01${String(part).padStart(2, "0")}01`;
    const meshSource = meshFiles.get(`${stem}.msh`);
    if (!meshSource) throw new Error(`Troca de Espírito: ${stem}.msh ausente`);
    meshCopies.set(meshSource, `${stem}.msh`);
    const textureSource = meshFiles.get(`${stem}.wys`);
    if (!textureSource) throw new Error(`Troca de Espírito: ${stem}.wys ausente`);
    textureCopies.set(textureSource, `${stem}.dds`);
  }

  const visualFamilies = {};
  for (const skin of [...usedSkins].sort((a, b) => a - b)) {
    const boneAnimation = boneAnimations.get(skin);
    if (!boneAnimation) continue;
    const skeletonSource = meshFiles.get(`${boneAnimation.base.toLowerCase()}.bon`);
    const skeletonOutput = skeletonSource ? `${boneAnimation.base.toLowerCase()}.bon` : null;
    if (skeletonSource && skeletonOutput) skeletonCopies.set(skeletonSource, skeletonOutput);
    const clips = [];
    for (let slot = 0; slot < boneAnimation.animationCount; slot++) {
      const animationIndex = validAnimationIndices.readInt32LE((skin * 186 + slot) * 4);
      const animationStem = `${boneAnimation.base}${String(animationIndex + 1).padStart(4, "0")}`.toLowerCase();
      const animationSource = meshFiles.get(`${animationStem}.ani`);
      if (!animationSource) {
        clips.push(null);
        continue;
      }
      const animationOutput = `${animationStem}.ani`;
      animationCopies.set(animationSource, animationOutput);
      clips.push(`monsters/animations/${animationOutput}`);
    }
    const actionTable = animationActions.get(skin);
    visualFamilies[skin] = {
      base: boneAnimation.base.toLowerCase(),
      declaredParts: boneAnimation.partCount,
      meshParts: boneAnimation.meshParts,
      skeleton: skeletonOutput ? `monsters/skeletons/${skeletonOutput}` : null,
      clips,
      ...(actionTable ? { actionSet: actionTable.name, actions: actionTable.actions } : {}),
    };
  }

  for (const [source, output] of skeletonCopies) await copyFile(path.join(clientRoot, "mesh", source), path.join(monsterSkeletonsRoot, output));
  for (const [source, output] of meshCopies) await copyFile(path.join(clientRoot, "mesh", source), path.join(monsterMeshesRoot, output));
  for (const [source, output] of animationCopies) await copyFile(path.join(clientRoot, "mesh", source), path.join(monsterAnimationsRoot, output));
  for (const [source, output] of textureCopies) {
    await writeFile(path.join(monsterTexturesRoot, output), decodeWys(await readFile(path.join(clientRoot, "mesh", source))));
  }

  const generatorFields = [
    "MinuteGenerate",
    "MaxNumMob",
    "MinGroup",
    "MaxGroup",
    "RouteType",
    "Formation",
    "StartX",
    "StartY",
    "StartRange",
    "StartWait",
    "StartAction",
    "Segment1X",
    "Segment1Y",
    "Segment1Range",
    "Segment1Wait",
    "Segment1Action",
    "Segment2X",
    "Segment2Y",
    "Segment2Range",
    "Segment2Wait",
    "Segment3X",
    "Segment3Y",
    "DestX",
    "DestY",
    "DestRange",
    "DestWait",
  ];
  const generatorRows = generators.map((generator) => [
    generator.id,
    numberOrNull(generator.values.get("MinuteGenerate")),
    numberOrNull(generator.values.get("MaxNumMob")),
    numberOrNull(generator.values.get("MinGroup")),
    numberOrNull(generator.values.get("MaxGroup")),
    templateIndex.get(generator.values.get("Leader")) ?? -1,
    templateIndex.get(generator.values.get("Follower")) ?? -1,
    ...generatorFields.slice(4).map((field) => numberOrNull(generator.values.get(field))),
  ]);
  const items = [...usedItemIndices].sort((a, b) => a - b).map(readItem).filter(Boolean);
  const catalog = {
    version: 1,
    source: "NPCGener + npcdb (WYD classic)",
    generatorColumns: ["id", "minuteGenerate", "maxNumMob", "minGroup", "maxGroup", "leaderTemplate", "followerTemplate", ...generatorFields.slice(4)],
    scoreColumns: ["level", "armor", "damage", "reserved", "attackRun", "maxHp", "maxMp", "hp", "mp", "strength", "intelligence", "dexterity", "constitution", "special0", "special1", "special2", "special3"],
    equipment: {
      slots: 16,
      stride: 7,
      columns: ["item", "effect0", "value0", "effect1", "value1", "effect2", "value2"],
    },
    bonusColumns: ["score", "special", "skill", "critical", "saveMana", "shortSkill0", "shortSkill1", "shortSkill2", "shortSkill3", "guildLevel", "magic", "regenHp", "regenMp", "resist0", "resist1", "resist2", "resist3"],
    visualPartColumns: ["part", "item", "meshIndex", "textureIndex", "mesh", "texture", "alpha"],
    templates,
    items,
    visualFamilies,
    skinnedObjects,
    generators: generatorRows,
    unresolvedTemplates,
  };
  await writeFile(path.join(monstersRoot, "catalog.json"), `${JSON.stringify(catalog)}\n`);

  return {
    manifest: {
      catalog: "monsters/catalog.json",
      skeletons: "monsters/skeletons",
      meshes: "monsters/meshes",
      animations: "monsters/animations",
      textures: "monsters/textures",
    },
    generatorCount: generatorRows.length,
    templateCount: templates.length,
  };
}

function parseNpcGenerators(text) {
  const pieces = text.split(/^\s*#\s*\[\s*(-?\d+)\s*\]\s*$/m);
  const generators = [];
  for (let index = 1; index + 1 < pieces.length; index += 2) {
    const values = new Map();
    for (const line of pieces[index + 1].split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z0-9]+):\s*(.*?)\s*$/);
      if (match) values.set(match[1], match[2]);
    }
    generators.push({ id: Number(pieces[index]), values });
  }
  return generators;
}

function readBoneAnimationList(text) {
  const definitions = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+mesh\\(\S+)$/i);
    if (!match) continue;
    const skin = Number(match[1]);
    const base = match[4];
    const meshPartPattern = new RegExp(`^${base}(\\d{2})\\d{2,}\\.msh$`, "i");
    const meshParts = [...new Set([...meshFiles.values()].map((file) => meshPartPattern.exec(file)?.[1]).filter(Boolean).map(Number))].sort((a, b) => a - b);
    definitions.set(skin, {
      animationCount: Number(match[2]),
      partCount: Number(match[3]),
      base,
      meshParts,
    });
  }
  return definitions;
}

function readAnimationActions(text) {
  const actionsBySkin = new Map();
  let current;
  for (const line of text.split(/\r?\n/)) {
    const header = line.trim().match(/^\[([^\]]+)]\s+(-?\d+)$/);
    if (header) {
      current = { name: header[1], actions: {} };
      actionsBySkin.set(Number(header[2]), current);
      continue;
    }
    if (!current) continue;
    const fields = line.trim().split(/\s+/);
    if (fields.length < 2 || !/^[A-Za-z0-9]+$/.test(fields[0])) continue;
    const values = fields.slice(1).map(Number);
    if (values.every(Number.isFinite)) current.actions[fields[0]] = values;
  }
  return actionsBySkin;
}

function readNpcScore(data, offset) {
  return [
    data.readInt16LE(offset),
    data.readInt16LE(offset + 2),
    data.readInt16LE(offset + 4),
    data[offset + 6],
    data[offset + 7],
    data.readUInt16LE(offset + 8),
    data.readUInt16LE(offset + 10),
    data.readUInt16LE(offset + 12),
    data.readUInt16LE(offset + 14),
    data.readInt16LE(offset + 16),
    data.readInt16LE(offset + 18),
    data.readInt16LE(offset + 20),
    data.readInt16LE(offset + 22),
    data[offset + 24],
    data[offset + 25],
    data[offset + 26],
    data[offset + 27],
  ];
}

function readCString(data, offset, length) {
  const end = data.indexOf(0, offset);
  return data.subarray(offset, end < offset || end >= offset + length ? offset + length : end).toString("latin1");
}

function resolveNpcDatabaseFile(files, name) {
  return files.get(name.toLowerCase()) ?? files.get(name.replace(/_+$/, "").toLowerCase());
}

function numberOrNull(value) {
  if (value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compareAscii(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function classicLookExpand(itemClass) {
  // TMHuman::InitObject: these races use the second (+20) bank of looks.
  return itemClass === 4
    || itemClass === 8
    || itemClass === 36
    || itemClass === 39
    || itemClass === 40
    || itemClass === 60
    || itemClass === 63
    ? 1
    : 0;
}

function applyClassicMonsterLookOverrides(look, skin, itemClass) {
  const face = look[0] ?? { item: 0, mesh: 0, texture: 0 };
  const copyFace = (...partIndices) => {
    for (const partIndex of partIndices) look[partIndex] = { ...face };
  };

  // This is the exact family list immediately before TMSkinMesh is created in
  // TMHuman::InitObject. These models reuse the face look for their second
  // piece; using a blanket "skin > 1" fallback corrupts several other races.
  if (faceLookCopySkins.has(skin)) {
    copyFace(1);
  }

  if (itemClass === 40) {
    look[6] = { ...(look[6] ?? { item: 0, mesh: 0, texture: 0 }), mesh: 0 };
    look[7] = { ...(look[7] ?? { item: 0, mesh: 0, texture: 0 }), mesh: 0 };
  }
  if (skin === 26 || skin === 35) copyFace(1, 2);
  else if (skin === 11 || skin === 37 || skin === 44) copyFace(1, 2, 3, 4);

  if (itemClass === 39 || itemClass === 40 || itemClass === 63) copyFace(1, 2, 3, 4, 5);

  // Giant/God looks fill missing body meshes with the special mesh banks.
  if (face.mesh === 40) {
    for (const partIndex of [2, 3, 4, 5]) {
      const current = look[partIndex] ?? { item: 0, mesh: 0, texture: 0 };
      if (!current.mesh) look[partIndex] = { ...current, mesh: 40 };
    }
    look[1] = { ...(look[1] ?? { item: 0, mesh: 0, texture: 0 }), mesh: 40 };
  } else if (face.mesh === 80 || face.mesh === 64) {
    for (const partIndex of [2, 3, 4, 5]) {
      const current = look[partIndex] ?? { item: 0, mesh: 0, texture: 0 };
      if (!current.mesh) look[partIndex] = { ...current, mesh: 40 };
    }
    look[1] = { ...(look[1] ?? { item: 0, mesh: 0, texture: 0 }), mesh: face.mesh };
  }
}

function god2Exception(baseName, zeroBasedPart) {
  const base = baseName.toLowerCase();
  const family = base.slice(0, 2);
  return base[0] === "g"
    || base[0] === "o"
    || (family === "dr" && base[3] === "2" && zeroBasedPart === 1)
    || (family === "dr" && base[3] === "1")
    || (family === "bd" && zeroBasedPart === 1)
    || family === "be"
    || family === "bo"
    || family === "bm"
    || family === "hy"
    || family === "sp"
    || family === "cr"
    || family === "wb"
    || family === "wf"
    || family === "cb"
    || family === "mi"
    || family === "mo"
    || family === "tw"
    || family === "tr"
    || (family === "hs" && zeroBasedPart === 1)
    || family === "et"
    || family === "bn"
    || family === "rc"
    || family === "fn"
    || family === "bl"
    || family === "tg";
}

function applyClassicSkinFileExceptions(meshStem, textureStem) {
  // Literal filename corrections from TMSkinMesh::RestoreDeviceObjects.
  if (meshStem === "ch010218" && textureStem === "ch010219") textureStem = "ch010214";
  if (textureStem === "ch020315") textureStem = "ch020314";
  else if (textureStem === "bm010102") textureStem = "mi010105";
  else if (/^tr(?:13|14|15|16|17)/.test(textureStem)) textureStem = "tr130101";
  else if (textureStem.startsWith("tr190101")) textureStem = "tr180101";
  else if (textureStem.startsWith("tr190102")) textureStem = "tr180102";
  else if (textureStem.startsWith("tr200101")) textureStem = "tr180101";
  else if (textureStem.startsWith("tr200102")) textureStem = "tr180102";
  else if (textureStem.startsWith("ch010237")) textureStem = "ch010137";
  else if (textureStem.startsWith("ch010238")) textureStem = "ch010138";
  else if (textureStem.startsWith("ch020217")) textureStem = "ch020117";

  const femaleVariant13 = /^ch02(\d{2})13$/.exec(textureStem);
  if (femaleVariant13 && ["01", "04", "05"].includes(femaleVariant13[1])) {
    textureStem = `ch01${femaleVariant13[1]}30`;
  }
  return { meshStem, textureStem };
}

function treeLookForObjectType(type) {
  if (type >= 331 && type <= 342) {
    return {
      skin: Math.floor((type - 331) / 2) + 63,
      mesh0: type === 342 ? 1 : 0,
      skin0: 0,
    };
  }
  if (type >= 351 && type <= 378) {
    return {
      skin: Math.floor((type - 351) / 2) + 71,
      mesh0: type === 362 ? 1 : 0,
      skin0: type === 354 || type === 361 || type === 373 || type === 375 || type === 377 ? 1 : 0,
    };
  }
  return null;
}

function skinnedObjectLooksForType(type) {
  const tree = treeLookForObjectType(type);
  if (tree) return { kind: "tree", skin: tree.skin, looks: [tree] };
  // TMObjectContainer instantiates DAT type 3 as TMFloat. Its constructor
  // fixes m_nSkinMeshType to 62 and leaves LOOK_INFO zeroed, so TMSkinMesh
  // resolves the sole fl01 part/variant (fl010101) from BoneAni4.txt.
  if (type === 3) {
    return { kind: "float", skin: 62, looks: [{ mesh0: 0, skin0: 0 }] };
  }
  if (type >= 311 && type <= 322) {
    const late = type >= 317;
    return {
      kind: "leaf",
      skin: 61,
      looks: [{
        mesh0: late ? 2 : 0,
        // LOOK_INFO stores this field as uint8; the apparent 256+ values in
        // the decompiled arithmetic intentionally wrap to 0..9.
        skin0: ((late ? type - 57 : type - 55) & 0xff),
      }],
    };
  }
  if (type >= 487 && type <= 489) {
    return { kind: "ship", skin: 60, looks: [{ mesh0: type - 487, skin0: 0 }] };
  }
  if (type === 343) {
    return { kind: "butterfly", skin: 69, looks: [0, 1, 2].map((skin0) => ({ mesh0: 0, skin0 })) };
  }
  if (type === 4) {
    return { kind: "butterfly", skin: 69, looks: [3, 4].map((skin0) => ({ mesh0: 0, skin0 })) };
  }
  if (type === 6) {
    return { kind: "butterfly", skin: 69, looks: [{ mesh0: 0, skin0: 5 }] };
  }
  if (type === 7) {
    return { kind: "butterfly", skin: 24, looks: [{ mesh0: 0, skin0: 2 }] };
  }
  if (type === 344) {
    return { kind: "fish", skin: 70, looks: [0, 1, 2].map((mesh0) => ({ mesh0, skin0: 0 })) };
  }
  if (type === 12) {
    return { kind: "fish", skin: 70, looks: [{ mesh0: 0, skin0: 0 }] };
  }
  return null;
}
