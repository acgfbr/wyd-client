import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const classicRoot = path.join(projectRoot, "public/game-data/classic");
const manifest = JSON.parse(await readFile(path.join(classicRoot, "manifest.json"), "utf8"));
const monsters = JSON.parse(await readFile(path.join(classicRoot, manifest.monsters.catalog), "utf8"));
const monsterItems = new Map(monsters.items.map((item) => [item.index, item]));
const { MOUNT_LOOKS } = await import("../src/game/player/MountLooks.ts");
const mountLooksByItem = new Map(MOUNT_LOOKS.map((look) => [look.itemIndex, look]));
const defaultMap = manifest.maps[manifest.defaultMap];
if (!defaultMap) throw new Error("Mapa padrao ausente do manifesto classico");

const [centerColumn, centerRow] = defaultMap.centerBlock;
const selectedFields = manifest.fields.filter((field) => (
  Math.abs(field.column - centerColumn) + Math.abs(field.row - centerRow) <= 1
));
const selectedFieldKeys = new Set(selectedFields.map((field) => `${field.column}:${field.row}`));
const relativeFiles = new Set();

await addFile("manifest.json");
await addFile(manifest.navigation.attributeMap.file);
await addFile(manifest.navigation.objectMasks.file);
await addFile(manifest.monsters.catalog);
await addFile("commerce/catalog.json");
await addFile("data/skills.json");
await addFile("audio/catalog.json");

// The classic HUD is small compared with the world package and must never
// visibly assemble after Armia has already appeared.
await addDirectory("ui");

for (const field of selectedFields) {
  const fieldFile = `fields/${field.file}`;
  await addFile(fieldFile);
  if (field.objectFile) await addFile(`objects/${field.objectFile}`);
  if (field.minimapFile) await addFile(`minimaps/${field.minimapFile}`);

  const trn = await readFile(path.join(classicRoot, fieldFile));
  const headerBytes = 1 + trn[0] + 2;
  for (let tile = 0; tile < 64 * 64; tile++) {
    const offset = headerBytes + tile * 12;
    const foreground = manifest.textures[String(trn[offset + 1] + 10)];
    const background = manifest.textures[String(trn[offset + 3] + 256)];
    if (foreground) await addFile(foreground.file);
    if (background) await addFile(background.file);
  }

  if (!field.objectFile) continue;
  const dat = await readFile(path.join(classicRoot, `objects/${field.objectFile}`));
  for (let offset = 0; offset + 28 <= dat.length;) {
    const type = dat.readUInt32LE(offset);
    const model = manifest.objectModels[String(type)];
    if (model) {
      await addFile(model.file);
      for (const texture of model.textures) if (texture) await addFile(texture);
    }
    offset += type >= 501 && type < 600 ? 36 : 28;
  }
}

const generatorColumns = new Map(monsters.generatorColumns.map((name, index) => [name, index]));
const startX = generatorColumns.get("StartX");
const startY = generatorColumns.get("StartY");
const leaderTemplate = generatorColumns.get("leaderTemplate");
const followerTemplate = generatorColumns.get("followerTemplate");
const templateIndices = new Set();
for (const generator of monsters.generators) {
  const x = generator[startX];
  const y = generator[startY];
  if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
  if (!selectedFieldKeys.has(`${Math.floor(x / 128)}:${Math.floor(y / 128)}`)) continue;
  if (Number.isInteger(generator[leaderTemplate]) && generator[leaderTemplate] >= 0) {
    templateIndices.add(generator[leaderTemplate]);
  }
  if (Number.isInteger(generator[followerTemplate]) && generator[followerTemplate] >= 0) {
    templateIndices.add(generator[followerTemplate]);
  }
}

const spawnActions = ["STAND01", "WALK", "ATTACK1", "STRIKE", "DIE", "DEAD"];
for (const templateIndex of templateIndices) {
  const template = monsters.templates[templateIndex];
  if (!template?.visual) continue;
  for (const part of template.visual.parts) {
    await addFile(part[4]);
    if (part[5]) await addFile(part[5]);
  }
  if (
    monsters.mantua
    && [0, 1, 2, 3, 8].includes(template.visual.skin)
    && (template.equipment?.[15 * 7] ?? 0) > 0
  ) {
    const item = monsterItems.get(template.equipment[15 * 7]);
    const variant = monsters.mantua.variants.find((entry) => entry.textureIndex === item?.texture);
    const family = monsters.visualFamilies[String(monsters.mantua.skin)];
    await addFile(monsters.mantua.mesh);
    if (variant) await addFile(variant.texture);
    if (family?.skeleton) await addFile(family.skeleton);
    for (const slot of [0, 1, 2]) {
      if (family?.clips?.[slot]) await addFile(family.clips[slot]);
    }
  }
  const mountItemIndex = template.equipment?.[14 * 7] ?? 0;
  const mountHp = (template.equipment?.[14 * 7 + 1] ?? 0)
    | ((template.equipment?.[14 * 7 + 2] ?? 0) << 8);
  const mount = mountHp > 0 ? mountLooksByItem.get(mountItemIndex) : null;
  if (mount) {
    const root = `player/mounts/${mount.family.base}`;
    await addFile(`${root}/${mount.family.base}.bon`);
    for (const part of mount.parts) {
      await addFile(`${root}/${part.meshStem}.msh`);
      await addFile(`${root}/${part.textureStem}.dds`);
    }
    for (const action of spawnActions) {
      const slot = mount.family.visual.actions?.[action]?.[0];
      const clip = Number.isInteger(slot) ? mount.family.visual.clips[slot] : null;
      if (clip) await addFile(clip);
    }
  }
  const family = monsters.visualFamilies[String(template.visual.skin)];
  if (!family) continue;
  if (family.skeleton) await addFile(family.skeleton);
  const variant = Math.max(0, Math.min(3, Math.trunc(template.characterClass ?? 0)));
  for (const action of spawnActions) {
    const values = family.actions?.[action];
    const pairOffset = values?.length >= 9 ? variant * 2 : 0;
    const slot = values?.[pairOffset] ?? values?.[0] ?? 0;
    const clip = family.clips?.[slot];
    if (clip) await addFile(clip);
  }
}

// Default player presentation: Mulher Kalintz, Skytalos, Griupan and Unicorn.
await addFile("player/equipment-looks.json");
await addFile("player/weapons.json");
await addFile("player/mantuas.json");
for (const stem of [
  "ch020117", "ch020217", "ch020317", "ch020417", "ch020517", "ch020617",
]) {
  await addFile(`player/meshes/${stem}.msh`);
}
for (const stem of [
  "ch020117", "ch020317", "ch020417", "ch020517", "ch020617",
]) {
  await addFile(`player/textures/${stem}.dds`);
}
await addFile("player/meshes/bow16.msa");
await addFile("player/textures/bow16.dds");
await addDirectory("player/familiars/ag01");
await addDirectory("player/mounts/hs01");
await addMatchingFiles("monsters/animations", /^ch02.*\.ani$/i);
await addFile("monsters/skeletons/ch02.bon");
for (const effectIndex of [
  0, 2,
  ...Array.from({ length: 8 }, (_, index) => 11 + index),
  56, 60, 71, 89,
  ...Array.from({ length: 8 }, (_, index) => 101 + index),
  119, 123, 165, 452,
]) {
  const effect = manifest.effectTextures[String(effectIndex)];
  if (effect) await addFile(effect.file);
}
// Guer_Caveira materializes bnsh01..05 through TMEffectMeshRotate rather than
// a DAT record or an equipment slot, so all five models must be offline-ready.
for (const type of [3, 4, 5, 6, 7]) {
  const model = manifest.objectModels[String(type)];
  if (!model) continue;
  await addFile(model.file);
  for (const texture of model.textures) if (texture) await addFile(texture);
}

const files = [...relativeFiles].sort();
const hash = createHash("sha256");
const assets = [];
let totalBytes = 0;
for (const file of files) {
  const absolute = path.join(classicRoot, file);
  const data = await readFile(absolute);
  hash.update(file);
  hash.update("\0");
  hash.update(data);
  totalBytes += data.length;
  assets.push({ url: `/game-data/classic/${file}`, bytes: data.length });
}

const index = {
  version: 1,
  key: hash.digest("hex").slice(0, 24),
  label: defaultMap.label,
  generatedAt: new Date().toISOString(),
  totalBytes,
  assets,
};
await writeFile(
  path.join(classicRoot, "precache-armia.json"),
  `${JSON.stringify(index)}\n`,
);
console.log(
  `[WYD] Cache inicial ${defaultMap.label}: ${assets.length} arquivos, ${(totalBytes / 1_048_576).toFixed(1)} MiB.`,
);

async function addFile(relative) {
  if (!relative || relativeFiles.has(relative)) return;
  const absolute = path.join(classicRoot, relative);
  try {
    if ((await stat(absolute)).isFile()) relativeFiles.add(relative);
  } catch {
    // Optional runtime resources remain network-lazy when absent.
  }
}

async function addDirectory(relative) {
  const directory = path.join(classicRoot, relative);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const child = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) await addDirectory(child);
    else if (entry.isFile()) await addFile(child);
  }
}

async function addMatchingFiles(relative, pattern) {
  const directory = path.join(classicRoot, relative);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isFile() && pattern.test(entry.name)) {
      await addFile(path.posix.join(relative, entry.name));
    }
    pattern.lastIndex = 0;
  }
}
