import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { HUNTRESS_LOOKS } from "../src/game/player/HuntressLooks.ts";
import { MOUNT_LOOKS } from "../src/game/player/MountLooks.ts";
import { CLASSIC_PLAYER_CLASSES } from "../src/game/player/PlayerClasses.ts";
import { CLASSIC_COSTUME_LOOKS } from "../src/game/player/ClassicCostumeLooks.ts";
import { BEAST_MASTER_SUMMONS } from "../src/game/combat/BeastMasterSummons.ts";
import { BEAST_MASTER_TRANSFORMATIONS } from "../src/game/combat/BeastMasterTransformations.ts";

const projectRoot = path.resolve(import.meta.dirname, "..");
const clientRoot = path.resolve(process.argv[2] ?? path.join(projectRoot, "../tjs/Origem"));
const meshRoot = path.join(clientRoot, "mesh");
const outputRoot = path.join(projectRoot, "public/game-data/classic/player");
const meshesRoot = path.join(outputRoot, "meshes");
const texturesRoot = path.join(outputRoot, "textures");
const mountsRoot = path.join(outputRoot, "mounts");
const summonsRoot = path.join(outputRoot, "summons");
const transformationsRoot = path.join(outputRoot, "transformations");
const griupanRoot = path.join(outputRoot, "familiars/ag01");
const equipmentCatalogFile = path.join(outputRoot, "equipment-looks.json");
const weaponCatalogFile = path.join(outputRoot, "weapons.json");
const manifestFile = path.join(projectRoot, "public/game-data/classic/manifest.json");
const itemRecordBytes = 152;
const modelTextureRecordBytes = 528;
const bodySlotByPosition = new Map([
  [2, { slot: "helmet", part: 2 }],
  [4, { slot: "armor", part: 3 }],
  [8, { slot: "pants", part: 4 }],
  [16, { slot: "gloves", part: 5 }],
  [32, { slot: "boots", part: 6 }],
]);

await mkdir(meshesRoot, { recursive: true });
await mkdir(texturesRoot, { recursive: true });
await mkdir(mountsRoot, { recursive: true });
await mkdir(summonsRoot, { recursive: true });
await mkdir(transformationsRoot, { recursive: true });
await mkdir(griupanRoot, { recursive: true });

// LOOK_INFO equipment plus the complete SetHumanCostume range 4150..4183
// shared by every class. Mesh/texture choices live in the runtime tables.
const importedMeshes = new Set();
const importedTextures = new Set();
for (const look of HUNTRESS_LOOKS) {
  for (const part of look.parts) {
    if (!importedMeshes.has(part.meshStem)) {
      await copyFile(
        path.join(meshRoot, `${part.meshStem}.msh`),
        path.join(meshesRoot, `${part.meshStem}.msh`),
      );
      importedMeshes.add(part.meshStem);
    }
    if (!importedTextures.has(part.textureStem)) {
      await writeFile(
        path.join(texturesRoot, `${part.textureStem}.dds`),
        decodeWys(await readFile(path.join(meshRoot, `${part.textureStem}.wys`))),
      );
      importedTextures.add(part.textureStem);
    }
  }
}

// Base bodies and the post-InitObject class-selection looks. The Huntress
// wardrobe above remains the playable default; these assets make all four
// exact ch01/ch02 class definitions self-contained for the runtime adapter.
for (const playerClass of CLASSIC_PLAYER_CLASSES) {
  for (const look of [
    { parts: playerClass.baseParts },
    playerClass.selection.look,
    ...playerClass.looks,
  ]) {
    for (const part of look.parts) {
      if (!importedMeshes.has(part.meshStem)) {
        await copyFile(
          path.join(meshRoot, `${part.meshStem}.msh`),
          path.join(meshesRoot, `${part.meshStem}.msh`),
        );
        importedMeshes.add(part.meshStem);
      }
      if (!importedTextures.has(part.textureStem)) {
        await writeFile(
          path.join(texturesRoot, `${part.textureStem}.dds`),
          decodeWys(await readFile(path.join(meshRoot, `${part.textureStem}.wys`))),
        );
        importedTextures.add(part.textureStem);
      }
    }
  }
}

// Ordinary Equip[1..5] records do not name files directly. TMSkinMesh builds
// each ch01/ch02 filename from ItemList mesh/texture, the class expand bank and
// the body part. Generate the exact reachable graph once so runtime never
// guesses filenames or probes 404s while equipment changes.
const meshFiles = await caseInsensitiveFiles(meshRoot);
const itemList = Buffer.from(await readFile(path.join(clientRoot, "ItemList.bin")));
if (itemList.length % itemRecordBytes !== 0) {
  throw new Error("ItemList.bin possui tamanho inesperado");
}
for (let offset = 0; offset < itemList.length; offset++) itemList[offset] ^= 0x5a;
const modelTextureList = await readFile(path.join(meshRoot, "MeshTextureList.bin"));
if (modelTextureList.length % modelTextureRecordBytes !== 0) {
  throw new Error("MeshTextureList.bin possui tamanho inesperado");
}
const alphaByTexture = readModelTextureAlphas(modelTextureList);
const equipmentItems = [];
const equipmentStats = {
  candidates: 0,
  hiddenCythera: 0,
  emptyMesh: 0,
  withoutClass: 0,
  unsupportedPlayerClass: 0,
  missingVariantAssets: 0,
};
for (let itemIndex = 1; itemIndex < itemList.length / itemRecordBytes; itemIndex++) {
  const offset = itemIndex * itemRecordBytes;
  const position = itemList.readInt16LE(offset + 136);
  const slot = bodySlotByPosition.get(position);
  if (!slot) continue;
  equipmentStats.candidates++;
  // The classic client intentionally hides these four Cythera helmets.
  if (itemIndex >= 3500 && (itemIndex <= 3502 || itemIndex === 3507)) {
    equipmentStats.hiddenCythera++;
    continue;
  }
  const mesh = itemList.readInt16LE(offset + 64);
  const texture = itemList.readInt16LE(offset + 66);
  if (mesh <= 0) {
    equipmentStats.emptyMesh++;
    continue;
  }
  const itemClass = itemEffect(itemList, offset, 18);
  if (itemClass === null) {
    equipmentStats.withoutClass++;
    continue;
  }
  const compatibleClasses = CLASSIC_PLAYER_CLASSES.filter((playerClass) => (
    itemClass === 255 || (itemClass & playerClass.itemClass) !== 0
  ));
  if (compatibleClasses.length === 0) {
    equipmentStats.unsupportedPlayerClass++;
    continue;
  }
  const variants = [];
  for (const playerClass of compatibleClasses) {
    const base = playerClass.skin === 0 ? "ch01" : "ch02";
    const variantOffset = 20 * playerClass.expand;
    let meshStem = `${base}${String(slot.part).padStart(2, "0")}${String(mesh + variantOffset + 1).padStart(2, "0")}`.toLowerCase();
    let textureStem = `${base}${String(slot.part).padStart(2, "0")}${String(texture + mesh + variantOffset + 1).padStart(2, "0")}`.toLowerCase();
    ({ meshStem, textureStem } = applyClassicPlayerFileExceptions(meshStem, textureStem));
    const meshSource = meshFiles.get(`${meshStem}.msh`);
    const textureSource = meshFiles.get(`${textureStem}.wys`);
    if (!meshSource || !textureSource) {
      equipmentStats.missingVariantAssets++;
      continue;
    }
    if (!importedMeshes.has(meshStem)) {
      await copyFile(path.join(meshRoot, meshSource), path.join(meshesRoot, `${meshStem}.msh`));
      importedMeshes.add(meshStem);
    }
    if (!importedTextures.has(textureStem)) {
      await writeFile(
        path.join(texturesRoot, `${textureStem}.dds`),
        decodeWys(await readFile(path.join(meshRoot, textureSource))),
      );
      importedTextures.add(textureStem);
    }
    variants.push({
      classKey: playerClass.key,
      slot: slot.slot,
      part: slot.part,
      meshStem,
      textureStem,
      alpha: normalizeAlpha(alphaByTexture.get(textureSource.toLowerCase())),
    });
  }
  if (variants.length === 0) continue;
  equipmentItems.push({
    index: itemIndex,
    name: readCString(itemList, offset, 64),
    itemClass,
    position,
    mesh,
    texture,
    variants,
  });
}
await writeFile(equipmentCatalogFile, `${JSON.stringify({
  version: 1,
  source: "ItemList.bin + TMSkinMesh::RestoreDeviceObjects + MeshTextureList.bin",
  counts: {
    ...equipmentStats,
    importedItems: equipmentItems.length,
    importedVariants: equipmentItems.reduce((total, item) => total + item.variants.length, 0),
  },
  slots: Object.fromEntries([...bodySlotByPosition].map(([position, slot]) => [slot.slot, {
    position,
    part: slot.part,
  }])),
  items: equipmentItems,
}, null, 2)}\n`);

// Hand equipment uses the common MeshList model graph imported by
// import-classic-assets.mjs. Keep only models present in that authoritative
// manifest: the runtime can then resolve a weapon without probing filenames.
const classicManifest = JSON.parse(await readFile(manifestFile, "utf8"));
const weaponItems = [];
const canonicalWeaponByModel = new Map(CLASSIC_PLAYER_CLASSES.flatMap((playerClass) => (
  [playerClass.selection.weapon, playerClass.defaultWeapon].map((weapon) => [
    weapon.meshIndex,
    weapon,
  ])
)));
const weaponStats = {
  candidates: 0,
  emptyMesh: 0,
  missingModel: 0,
  importedItems: 0,
};
for (let itemIndex = 1; itemIndex < itemList.length / itemRecordBytes; itemIndex++) {
  const offset = itemIndex * itemRecordBytes;
  const position = itemList.readUInt16LE(offset + 136);
  if (position !== 64 && position !== 128 && position !== 192) continue;
  weaponStats.candidates++;
  const modelType = itemList.readInt16LE(offset + 64);
  if (modelType <= 0) {
    weaponStats.emptyMesh++;
    continue;
  }
  if (!classicManifest.objectModels?.[String(modelType)]) {
    weaponStats.missingModel++;
    continue;
  }
  weaponItems.push({
    index: itemIndex,
    name: readCString(itemList, offset, 64),
    itemClass: itemEffect(itemList, offset, 18) ?? 0,
    position,
    modelType,
    texture: itemList.readInt16LE(offset + 66),
    visualEffect: itemList.readInt16LE(offset + 68),
    weaponType: itemEffect(itemList, offset, 21) ?? 0,
    fallbackTexture: canonicalWeaponByModel.has(modelType)
      ? `player/textures/${canonicalWeaponByModel.get(modelType).textureStem}.dds`
      : null,
    fallbackAlpha: canonicalWeaponByModel.get(modelType)?.alpha ?? null,
  });
}
weaponStats.importedItems = weaponItems.length;
await writeFile(weaponCatalogFile, `${JSON.stringify({
  version: 1,
  source: "ItemList.bin + MeshList.txt + TMHuman::CheckWeapon + CFrame::Render",
  counts: weaponStats,
  items: weaponItems,
}, null, 2)}\n`);

// Canonical selchar weapons plus the existing playable Skytalos. MSA and WYS
// share the stems recorded in PlayerClasses; repeated assets are deduplicated.
const importedWeapons = new Set();
for (const playerClass of CLASSIC_PLAYER_CLASSES) {
  for (const weapon of [playerClass.selection.weapon, playerClass.defaultWeapon]) {
    if (importedWeapons.has(weapon.meshStem)) continue;
    await copyFile(
      path.join(meshRoot, `${weapon.meshStem}.msa`),
      path.join(meshesRoot, `${weapon.meshStem}.msa`),
    );
    await writeFile(
      path.join(texturesRoot, `${weapon.textureStem}.dds`),
      decodeWys(await readFile(path.join(meshRoot, `${weapon.textureStem}.wys`))),
    );
    importedWeapons.add(weapon.meshStem);
  }
}

// Equip[14] variants use nine distinct rigs. Keep one skeleton/animation bank
// per family and deduplicate mesh/texture files shared by multiple mounts.
const importedMountFamilies = new Set();
const importedMountMeshes = new Set();
const importedMountTextures = new Set();
for (const look of MOUNT_LOOKS) {
  const base = look.family.base;
  const mountRoot = path.join(mountsRoot, base);
  await mkdir(mountRoot, { recursive: true });

  if (!importedMountFamilies.has(base)) {
    await copyFile(path.join(meshRoot, `${base}.bon`), path.join(mountRoot, `${base}.bon`));
    for (let clip = 1; clip <= look.family.clipCount; clip++) {
      const file = `${base}${String(100 + clip).padStart(4, "0")}.ani`;
      await copyFile(path.join(meshRoot, file), path.join(mountRoot, file));
    }
    importedMountFamilies.add(base);
  }

  for (const part of look.parts) {
    const meshKey = `${base}/${part.meshStem}`;
    if (!importedMountMeshes.has(meshKey)) {
      await copyFile(
        path.join(meshRoot, `${part.meshStem}.msh`),
        path.join(mountRoot, `${part.meshStem}.msh`),
      );
      importedMountMeshes.add(meshKey);
    }
    const textureKey = `${base}/${part.textureStem}`;
    if (!importedMountTextures.has(textureKey)) {
      await writeFile(
        path.join(mountRoot, `${part.textureStem}.dds`),
        decodeWys(await readFile(path.join(meshRoot, `${part.textureStem}.wys`))),
      );
      importedMountTextures.add(textureKey);
    }
  }
}

// BeastMaster nature summons are not guaranteed to occur in NPCGener, so the
// world catalog cannot be their asset owner. Keep all eight looks together in
// a self-contained package. ValidIndex is already represented by each
// family's explicit animationStems (Succubus notably uses 0101..0111 and
// 0201..0211 rather than one contiguous filename range).
const importedSummonFamilies = new Set();
const importedSummonMeshes = new Set();
const importedSummonTextures = new Set();
for (const summon of BEAST_MASTER_SUMMONS) {
  const { family } = summon;
  const summonRoot = path.join(summonsRoot, family.base);
  await mkdir(summonRoot, { recursive: true });

  if (!importedSummonFamilies.has(family.base)) {
    await copyFile(
      path.join(meshRoot, `${family.skeletonStem}.bon`),
      path.join(summonRoot, `${family.skeletonStem}.bon`),
    );
    for (const animationStem of family.animationStems) {
      await copyFile(
        path.join(meshRoot, `${animationStem}.ani`),
        path.join(summonRoot, `${animationStem}.ani`),
      );
    }
    importedSummonFamilies.add(family.base);
  }

  for (const part of summon.parts) {
    const meshKey = `${family.base}/${part.meshStem}`;
    if (!importedSummonMeshes.has(meshKey)) {
      await copyFile(
        path.join(meshRoot, `${part.meshStem}.msh`),
        path.join(summonRoot, `${part.meshStem}.msh`),
      );
      importedSummonMeshes.add(meshKey);
    }

    const textureKey = `${family.base}/${part.textureStem}`;
    if (!importedSummonTextures.has(textureKey)) {
      await writeFile(
        path.join(summonRoot, `${part.textureStem}.dds`),
        decodeWys(await readFile(path.join(meshRoot, `${part.textureStem}.wys`))),
      );
      importedSummonTextures.add(textureKey);
    }
  }
}

// BeastMaster transformations are player LOOK replacements delivered by the
// server after skills #64/#66/#68/#70/#71. They never need to occur in
// NPCGener, so keep their five BON/MSH/ANI families with the player package.
for (const transformation of BEAST_MASTER_TRANSFORMATIONS) {
  const base = transformation.family.base;
  const transformationRoot = path.join(transformationsRoot, base);
  await mkdir(transformationRoot, { recursive: true });
  await copyFile(
    path.join(meshRoot, `${base}.bon`),
    path.join(transformationRoot, `${base}.bon`),
  );
  for (const clip of transformation.family.clips) {
    const file = path.basename(clip);
    await copyFile(path.join(meshRoot, file), path.join(transformationRoot, file));
  }
  const importedTransformationTextures = new Set();
  for (const part of transformation.parts) {
    const meshFile = path.basename(part.mesh);
    await copyFile(path.join(meshRoot, meshFile), path.join(transformationRoot, meshFile));
    if (!part.texture) continue;
    const textureFile = path.basename(part.texture);
    if (importedTransformationTextures.has(textureFile)) continue;
    await writeFile(
      path.join(transformationRoot, textureFile),
      decodeWys(await readFile(path.join(meshRoot, textureFile.replace(/\.dds$/i, ".wys")))),
    );
    importedTransformationTextures.add(textureFile);
  }
}

// Equip[13] item #1726 (Griupan): TMHuman creates skin 32 with LOOK_INFO
// Mesh0/Skin0 = 2/0. TMSkinMesh therefore resolves the familiar to ag010103.
// Item #769 (Nyerdes) uses Mesh0/Skin0 = 1/0 and resolves to ag010102.
// BM skills #50/#53 create the same skin with look 0/0, resolving their
// motion-4 fairies/protector to ag010101. Both looks use the [angel]
// ag010101.ani clip.
await copyFile(path.join(meshRoot, "ag01.bon"), path.join(griupanRoot, "ag01.bon"));
await copyFile(path.join(meshRoot, "ag010101.ani"), path.join(griupanRoot, "ag010101.ani"));
await copyFile(path.join(meshRoot, "ag010101.msh"), path.join(griupanRoot, "ag010101.msh"));
await writeFile(
  path.join(griupanRoot, "ag010101.dds"),
  decodeWys(await readFile(path.join(meshRoot, "ag010101.wys"))),
);
await copyFile(path.join(meshRoot, "ag010102.msh"), path.join(griupanRoot, "ag010102.msh"));
await writeFile(
  path.join(griupanRoot, "ag010102.dds"),
  decodeWys(await readFile(path.join(meshRoot, "ag010102.wys"))),
);
await copyFile(path.join(meshRoot, "ag010103.msh"), path.join(griupanRoot, "ag010103.msh"));
await writeFile(
  path.join(griupanRoot, "ag010103.dds"),
  decodeWys(await readFile(path.join(meshRoot, "ag010103.wys"))),
);

console.log(
  `${CLASSIC_PLAYER_CLASSES.length} classes, ${equipmentItems.length} equipamentos LOOK_INFO, ${weaponItems.length} armas comuns, ${CLASSIC_COSTUME_LOOKS.length} trajes 4150..4183, ${HUNTRESS_LOOKS.length} looks especializados da Huntress, ${importedWeapons.size} armas canônicas, ${MOUNT_LOOKS.length} montarias, ${BEAST_MASTER_SUMMONS.length} evocacoes, ${BEAST_MASTER_TRANSFORMATIONS.length} transformacoes e Griupan/fadas importados para ${outputRoot}`,
);

function decodeWys(encoded) {
  if (encoded.length < 90) throw new Error("WYS truncado");
  const dds = Buffer.from(encoded.subarray(1));
  dds.write("DDS", 0, "ascii");
  dds.write(dds[84] === "2".charCodeAt(0) ? "DXT1" : "DXT3", 84, "ascii");
  return dds;
}

async function caseInsensitiveFiles(directory) {
  const names = await readdir(directory);
  return new Map(names.map((name) => [name.toLowerCase(), name]));
}

function itemEffect(itemListData, itemOffset, expectedEffect) {
  for (let effect = 0; effect < 12; effect++) {
    const effectOffset = itemOffset + 80 + effect * 4;
    if (itemListData.readInt16LE(effectOffset) === expectedEffect) {
      return itemListData.readInt16LE(effectOffset + 2);
    }
  }
  return null;
}

function readModelTextureAlphas(data) {
  const result = new Map();
  for (let index = 0; index < data.length / modelTextureRecordBytes; index++) {
    const start = index * modelTextureRecordBytes;
    const terminator = data.indexOf(0, start);
    const end = terminator < start || terminator > start + 255 ? start + 255 : terminator;
    const listedFile = data.subarray(start, end).toString("latin1").replaceAll("\\", path.sep);
    if (!listedFile) continue;
    result.set(
      path.basename(listedFile).toLowerCase(),
      String.fromCharCode(data[start + 510] ?? 0),
    );
  }
  return result;
}

function normalizeAlpha(value) {
  return value === "A" || value === "C" || value === "N" ? value : "N";
}

function applyClassicPlayerFileExceptions(meshStem, textureStem) {
  if (meshStem === "ch010218" && textureStem === "ch010219") textureStem = "ch010214";
  if (textureStem === "ch020315") textureStem = "ch020314";
  else if (textureStem.startsWith("ch010237")) textureStem = "ch010137";
  else if (textureStem.startsWith("ch010238")) textureStem = "ch010138";
  else if (textureStem.startsWith("ch020217")) textureStem = "ch020117";

  const femaleVariant13 = /^ch02(\d{2})13$/.exec(textureStem);
  if (femaleVariant13 && ["01", "04", "05"].includes(femaleVariant13[1])) {
    textureStem = `ch01${femaleVariant13[1]}30`;
  }
  return { meshStem, textureStem };
}

function readCString(data, offset, length) {
  const end = data.indexOf(0, offset);
  return new TextDecoder("windows-1252").decode(
    data.subarray(offset, end < offset || end >= offset + length ? offset + length : end),
  );
}
