import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const projectRoot = path.resolve(import.meta.dirname, "..");
const clientRoot = path.resolve(process.argv[2] ?? path.join(projectRoot, "../tjs/Origem"));
const meshRoot = path.join(clientRoot, "mesh");
const outputRoot = path.join(projectRoot, "public/game-data/classic/player");
const meshesRoot = path.join(outputRoot, "meshes");
const texturesRoot = path.join(outputRoot, "textures");
const mountRoot = path.join(outputRoot, "mounts/unicorn");

await mkdir(meshesRoot, { recursive: true });
await mkdir(texturesRoot, { recursive: true });
await mkdir(mountRoot, { recursive: true });

// Waha Divino is the complete retail Huntress set (ch02, variant 69).
for (let part = 1; part <= 6; part++) {
  const base = `ch02${String(part).padStart(2, "0")}69`;
  await copyFile(path.join(meshRoot, `${base}.msh`), path.join(meshesRoot, `${base}.msh`));
  await writeFile(path.join(texturesRoot, `${base}.dds`), decodeWys(await readFile(path.join(meshRoot, `${base}.wys`))));
}

// Item #826: ItemList mesh 762 -> MeshList bow16.msa.
await copyFile(path.join(meshRoot, "bow16.msa"), path.join(meshesRoot, "bow16.msa"));
await writeFile(path.join(texturesRoot, "bow16.dds"), decodeWys(await readFile(path.join(meshRoot, "bow16.wys"))));

// Level-120 Unicorn: classic hs01 variant 19, two skinned parts sharing the
// first texture exactly as the client's God2Exception path does.
await copyFile(path.join(meshRoot, "hs01.bon"), path.join(mountRoot, "hs01.bon"));
for (const part of [1, 2]) {
  await copyFile(path.join(meshRoot, `hs01${String(part).padStart(2, "0")}19.msh`), path.join(mountRoot, `hs01${String(part).padStart(2, "0")}19.msh`));
}
await writeFile(path.join(mountRoot, "hs010119.dds"), decodeWys(await readFile(path.join(meshRoot, "hs010119.wys"))));
for (let clip = 1; clip <= 10; clip++) {
  const file = `hs01${String(100 + clip).padStart(4, "0")}.ani`;
  await copyFile(path.join(meshRoot, file), path.join(mountRoot, file));
}

console.log(`Huntress, Skytalos e Unicórnio importados para ${outputRoot}`);

function decodeWys(encoded) {
  if (encoded.length < 90) throw new Error("WYS truncado");
  const dds = Buffer.from(encoded.subarray(1));
  dds.write("DDS", 0, "ascii");
  dds.write(dds[84] === "2".charCodeAt(0) ? "DXT1" : "DXT3", 84, "ascii");
  return dds;
}
