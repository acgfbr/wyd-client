import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { HUNTRESS_LOOKS } from "../src/game/player/HuntressLooks.ts";
import { MOUNT_LOOKS } from "../src/game/player/MountLooks.ts";
import { CLASSIC_PLAYER_CLASSES } from "../src/game/player/PlayerClasses.ts";
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

await mkdir(meshesRoot, { recursive: true });
await mkdir(texturesRoot, { recursive: true });
await mkdir(mountsRoot, { recursive: true });
await mkdir(summonsRoot, { recursive: true });
await mkdir(transformationsRoot, { recursive: true });
await mkdir(griupanRoot, { recursive: true });

// LOOK_INFO equipment and SetHumanCostume cases used by the Huntress wardrobe.
// Mesh and texture choices live in one shared table consumed by the runtime.
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
  `${CLASSIC_PLAYER_CLASSES.length} classes (${HUNTRESS_LOOKS.length} looks da Huntress), ${importedWeapons.size} armas, ${MOUNT_LOOKS.length} montarias, ${BEAST_MASTER_SUMMONS.length} evocacoes, ${BEAST_MASTER_TRANSFORMATIONS.length} transformacoes e Griupan/fadas importados para ${outputRoot}`,
);

function decodeWys(encoded) {
  if (encoded.length < 90) throw new Error("WYS truncado");
  const dds = Buffer.from(encoded.subarray(1));
  dds.write("DDS", 0, "ascii");
  dds.write(dds[84] === "2".charCodeAt(0) ? "DXT1" : "DXT3", 84, "ascii");
  return dds;
}
