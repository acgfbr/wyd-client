import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const RECORD_BYTES = 104;
const CLIENT_RECORDS = 248;
const ITEM_RECORD_BYTES = 152;
const XOR_KEY = 0x5a;
const projectRoot = path.resolve(import.meta.dirname, "..");
const clientRoot = path.resolve(process.argv[2] ?? path.join(projectRoot, "../tjs/Origem"));
const outputRoot = path.join(projectRoot, "public/game-data/classic/data");

const classBlocks = [
  { key: "transknight", name: "TransKnight", firstSkill: 0, masteries: ["Confiança", "Trans", "Espada Mágica"] },
  { key: "foema", name: "Foema", firstSkill: 24, masteries: ["Magia Branca", "Magia Negra", "Magia Especial"] },
  { key: "beastmaster", name: "BeastMaster", firstSkill: 48, masteries: ["Elemental", "Evocação", "Natureza"] },
  { key: "huntress", name: "Huntress", firstSkill: 72, masteries: ["Sobrevivência", "Troca", "Captura"] },
];

const source = await readFile(path.join(clientRoot, "SkillData.bin"));
if (source.length < CLIENT_RECORDS * RECORD_BYTES) {
  throw new Error(`SkillData.bin truncado: ${source.length} bytes`);
}
const decoded = Buffer.from(source);
for (let offset = 0; offset < CLIENT_RECORDS * RECORD_BYTES; offset++) decoded[offset] ^= XOR_KEY;

const itemListSource = await readFile(path.join(clientRoot, "ItemList.bin"));
const itemList = Buffer.from(itemListSource);
if (itemList.length % ITEM_RECORD_BYTES !== 0) {
  throw new Error(`ItemList.bin possui ${itemList.length} bytes; stride esperado ${ITEM_RECORD_BYTES}`);
}
for (let offset = 0; offset < itemList.length; offset++) itemList[offset] ^= XOR_KEY;
const itemNameSource = await readFile(path.join(clientRoot, "Itemname.txt"));
const localizedNames = parseItemNames(itemNameSource.toString("latin1"));

const skills = Array.from({ length: CLIENT_RECORDS }, (_, index) => decodeSkill(index));
assertReferenceRecord(skills[72], { manaSpent: 15, delaySeconds: 15, range: 2 });
assertReferenceRecord(skills[79], { manaSpent: 75, maxTarget: 6, aggressive: 1 });
assertReferenceRecord(skills[95], { affectType: 28, affectTimeSeconds: 3 });
assertReferenceRecord(skills[101], { passive: 1, manaSpent: 0, delaySeconds: 0, range: 0 });

const classes = classBlocks.map((entry, classIndex) => ({
  ...entry,
  classIndex,
  skills: skills.slice(entry.firstSkill, entry.firstSkill + 24).map((skill) => skill.index),
  masterSkills: skills.slice(200 + classIndex * 12, 212 + classIndex * 12).map((skill) => skill.index),
}));

const catalog = {
  version: 3,
  source: {
    file: "SkillData.bin",
    bytes: source.length,
    sha256: createHash("sha256").update(source).digest("hex"),
    xor: XOR_KEY,
    recordBytes: RECORD_BYTES,
    clientRecords: CLIENT_RECORDS,
    physicalRecords: Math.floor(source.length / RECORD_BYTES),
    refs: [
      "tm-project2/Projects/TMProject/Basedef.h:301-325",
      "tm-project2/Projects/TMProject/Basedef.cpp:196-229",
      "tm-project2/Projects/TMProject/SGrid.cpp:4163-4169",
    ],
    itemList: {
      file: "ItemList.bin",
      bytes: itemListSource.length,
      sha256: createHash("sha256").update(itemListSource).digest("hex"),
    },
    itemNames: {
      file: "Itemname.txt",
      bytes: itemNameSource.length,
      sha256: createHash("sha256").update(itemNameSource).digest("hex"),
    },
  },
  iconAtlas: {
    file: "ui/skill-icons.png",
    width: 512,
    height: 512,
    cellWidth: 32,
    cellHeight: 32,
    columns: 16,
    textureSet: 199,
    sourceTexture: 131,
  },
  classes,
  specialSkills: skills
    .filter((skill) => skill.category === "special" && skill.index <= 104 && skill.rawName)
    .map((skill) => skill.index),
  // Offline project policy: #101 is equipped as a permanent learned passive.
  alwaysLearnedSkills: [101],
  skills,
};

await mkdir(outputRoot, { recursive: true });
await writeFile(path.join(outputRoot, "skills.json"), JSON.stringify(catalog));
console.log(`Importadas ${skills.length} skills clássicas (${classes.length} classes) para ${outputRoot}`);

function decodeSkill(index) {
  const offset = index * RECORD_BYTES;
  const int = (word) => decoded.readInt32LE(offset + word * 4);
  // Basedef.cpp only exposes pseudo-items 5000..5104 for the regular block
  // and 5400..5447 for master skills. Internal records 105..199 have no item
  // and must not alias the unrelated inventory entries at 5105..5199.
  const itemIndex = index <= 104 ? index + 5000 : (index >= 200 ? index + 5200 : null);
  const itemOffset = itemIndex === null ? -1 : itemIndex * ITEM_RECORD_BYTES;
  const itemAvailable = itemOffset >= 0 && itemOffset + ITEM_RECORD_BYTES <= itemList.length;
  const itemName = itemAvailable ? readCString(itemList, itemOffset, 64) : "";
  const localizedName = itemIndex === null ? "" : (localizedNames.get(itemIndex) ?? itemName);
  const rawName = localizedName || null;
  const displayName = displaySkillName(index, humanizeName(localizedName)) || `Skill ${index}`;
  const classification = classifySkill(index);
  const iconIndex = itemAvailable ? itemList.readInt16LE(itemOffset + 66) : -1;
  const passive = int(22);
  const targetType = int(1);
  const aggressive = int(18);
  const affectType = int(9);
  const tickType = int(7);
  const kind = passive === 1
    ? "passive"
    : ((targetType === 0 || targetType === 2)
      && aggressive !== 1
      && (affectType > 0 || tickType > 0)
      ? "buff"
      : "active");
  return {
    index,
    recordOffset: offset,
    itemIndex,
    name: displayName,
    displayName,
    rawName,
    ...classification,
    skillPoints: int(0),
    kind,
    targetType,
    manaSpent: int(2),
    delaySeconds: int(3),
    range: int(4),
    instanceType: int(5),
    instanceValue: int(6),
    tickType,
    tickValue: int(8),
    affectType,
    affectValue: int(10),
    affectTimeSeconds: int(11),
    action1: [...decoded.subarray(offset + 48, offset + 56)],
    action2: [...decoded.subarray(offset + 56, offset + 64)],
    instanceAttribute: int(16),
    tickAttribute: int(17),
    aggressive,
    maxTarget: int(19),
    party: int(20),
    affectResist: int(21),
    passive,
    forceDamage: int(23),
    reserved: [int(24), int(25)],
    iconIndex: iconIndex >= 0 ? iconIndex : null,
    icon: iconIndex >= 0 ? {
      x: (iconIndex % 16) * 32,
      y: Math.floor(iconIndex / 16) * 32,
      width: 32,
      height: 32,
    } : null,
  };
}

function classifySkill(index) {
  if (index < 96) {
    const classIndex = Math.floor(index / 24);
    const localIndex = index % 24;
    return {
      category: "class",
      classKey: classBlocks[classIndex].key,
      mastery: Math.floor(localIndex / 8) + 1,
      masterySlot: localIndex % 8 + 1,
    };
  }
  if (index >= 200) {
    const classIndex = Math.floor((index - 200) / 12);
    const localIndex = (index - 200) % 12;
    return {
      category: "master",
      classKey: classBlocks[classIndex]?.key ?? null,
      mastery: Math.floor(localIndex / 4) + 1,
      masterySlot: localIndex % 4 + 1,
    };
  }
  return { category: "special", classKey: null, mastery: null, masterySlot: null };
}

function parseItemNames(text) {
  const result = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (match) result.set(Number(match[1]), match[2].trim());
  }
  return result;
}

function readCString(buffer, offset, maximumBytes) {
  const end = buffer.indexOf(0, offset);
  const boundedEnd = end < offset || end > offset + maximumBytes ? offset + maximumBytes : end;
  return buffer.subarray(offset, boundedEnd).toString("latin1").trim();
}

function humanizeName(name) {
  return name.replaceAll("_", " ").replace(/\s+/g, " ").trim();
}

function displaySkillName(index, name) {
  // Keep rawName byte-faithful while fixing the few accents omitted by the
  // retail Itemname table in the user-facing label.
  const overrides = new Map([
    [19, "Lâmina Congelada"],
    [40, "Névoa Venenosa"],
    [78, "Lança de Ferro"],
    [88, "Lâmina das Sombras"],
    [93, "Lâmina Aérea"],
  ]);
  return overrides.get(index) ?? name;
}

function assertReferenceRecord(record, expected) {
  for (const [field, value] of Object.entries(expected)) {
    if (record[field] !== value) {
      throw new Error(`SkillData #${record.index}: ${field}=${record[field]}, esperado ${value}`);
    }
  }
}
