import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { HUNTRESS_LOOKS } from "../src/game/player/HuntressLooks.ts";
import { MOUNT_LOOKS } from "../src/game/player/MountLooks.ts";

const projectRoot = path.resolve(import.meta.dirname, "..");
const clientRoot = path.resolve(process.argv[2] ?? path.join(projectRoot, "../tjs/Origem"));
const meshRoot = path.join(clientRoot, "mesh");
const outputRoot = path.join(projectRoot, "public/game-data/classic/player");
const meshesRoot = path.join(outputRoot, "meshes");
const texturesRoot = path.join(outputRoot, "textures");
const mountsRoot = path.join(outputRoot, "mounts");
const griupanRoot = path.join(outputRoot, "familiars/ag01");

await mkdir(meshesRoot, { recursive: true });
await mkdir(texturesRoot, { recursive: true });
await mkdir(mountsRoot, { recursive: true });
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

// Item #2551 Skytalos(Anct), like base item #826, maps mesh 762 to bow16.msa.
await copyFile(path.join(meshRoot, "bow16.msa"), path.join(meshesRoot, "bow16.msa"));
await writeFile(path.join(texturesRoot, "bow16.dds"), decodeWys(await readFile(path.join(meshRoot, "bow16.wys"))));

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

// Equip[13] item #1726 (Griupan): TMHuman creates skin 32 with LOOK_INFO
// Mesh0/Skin0 = 2/0. TMSkinMesh therefore resolves the single ag01 part to
// ag010103, while the [angel] animation table uses ag010101.ani.
await copyFile(path.join(meshRoot, "ag01.bon"), path.join(griupanRoot, "ag01.bon"));
await copyFile(path.join(meshRoot, "ag010101.ani"), path.join(griupanRoot, "ag010101.ani"));
await copyFile(path.join(meshRoot, "ag010103.msh"), path.join(griupanRoot, "ag010103.msh"));
await writeFile(
  path.join(griupanRoot, "ag010103.dds"),
  decodeWys(await readFile(path.join(meshRoot, "ag010103.wys"))),
);

console.log(
  `${HUNTRESS_LOOKS.length} looks da Huntress, Skytalos, ${MOUNT_LOOKS.length} montarias e Griupan importados para ${outputRoot}`,
);

function decodeWys(encoded) {
  if (encoded.length < 90) throw new Error("WYS truncado");
  const dds = Buffer.from(encoded.subarray(1));
  dds.write("DDS", 0, "ascii");
  dds.write(dds[84] === "2".charCodeAt(0) ? "DXT1" : "DXT3", 84, "ascii");
  return dds;
}
