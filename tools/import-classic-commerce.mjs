/**
 * Importa o catalogo classico de itens e o Carry comercial dos NPCs.
 *
 * Uso (Bun):
 *   bun tools/import-classic-commerce.mjs [clientRoot] [serverDataRoot]
 *
 * Padroes locais:
 *   clientRoot     = ../tjs/Origem
 *   serverDataRoot = ../tjs/tools/data
 *   saida          = public/game-data/classic/commerce/catalog.json
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ITEM_COUNT = 6500;
const ITEM_RECORD_BYTES = 152;
const ITEM_NAMED_BYTES = 140;
const ITEM_PRICE_RECORDS = 100;
const NPC_RECORD_BYTES = 756;
const NPC_CARRY_OFFSET = 220;
const NPC_ITEM_BYTES = 8;
const SHOP_CARRY_SLOTS = [
  0, 1, 2, 3, 4, 5, 6, 7, 8,
  27, 28, 29, 30, 31, 32, 33, 34, 35,
  54, 55, 56, 57, 58, 59, 60, 61, 62,
];
const CLIENT_STATIC_PRICE_OVERRIDES = [
  { itemIndex: 412, price: 4_000_000 },
  { itemIndex: 413, price: 8_000_000 },
  { itemIndex: 419, price: 400_000 },
  { itemIndex: 420, price: 800_000 },
];

const projectRoot = path.resolve(import.meta.dirname, "..");
const clientRoot = path.resolve(process.argv[2] ?? path.resolve(projectRoot, "../tjs/Origem"));
const serverDataRoot = path.resolve(process.argv[3] ?? path.join(path.dirname(clientRoot), "tools/data"));
const outputDirectory = path.join(projectRoot, "public/game-data/classic/commerce");
const outputFile = path.join(outputDirectory, "catalog.json");
const itemListPath = path.join(clientRoot, "ItemList.bin");
const itemPricePath = path.join(clientRoot, "ItemPrice.bin");
const npcGenerPath = path.join(serverDataRoot, "NPCGener.txt");
const npcDatabaseRoot = path.join(serverDataRoot, "npcdb");
const windows1252 = new TextDecoder("windows-1252");

const encryptedItemList = Buffer.from(await readFile(itemListPath));
const expectedItemListBytes = ITEM_COUNT * ITEM_RECORD_BYTES;
if (encryptedItemList.length !== expectedItemListBytes) {
  throw new Error(`ItemList.bin possui ${encryptedItemList.length} bytes; esperado ${expectedItemListBytes}`);
}

const decodedItemList = Buffer.from(encryptedItemList);
for (let offset = 0; offset < decodedItemList.length; offset++) decodedItemList[offset] ^= 0x5a;

const itemPriceData = Buffer.from(await readFile(itemPricePath));
const expectedItemPriceBytes = ITEM_PRICE_RECORDS * 2 * Int32Array.BYTES_PER_ELEMENT;
if (itemPriceData.length !== expectedItemPriceBytes) {
  throw new Error(`ItemPrice.bin possui ${itemPriceData.length} bytes; esperado ${expectedItemPriceBytes}`);
}

const itemPriceOverrides = [];
let itemPriceTerminatorRecord = null;
for (let record = 0; record < ITEM_PRICE_RECORDS; record++) {
  const offset = record * 8;
  const itemIndex = itemPriceData.readInt32LE(offset);
  const price = itemPriceData.readInt32LE(offset + 4);
  if (itemIndex === 0) {
    itemPriceTerminatorRecord = record;
    break;
  }
  if (itemIndex < 0 || itemIndex >= ITEM_COUNT) {
    throw new Error(`ItemPrice.bin registro ${record}: item ${itemIndex} fora de 0..${ITEM_COUNT - 1}`);
  }
  itemPriceOverrides.push({ record, itemIndex, price });
}
if (itemPriceTerminatorRecord === null) {
  throw new Error("ItemPrice.bin nao possui o terminador itemIndex=0 dentro dos 100 registros");
}

const staticPriceByItem = new Map(CLIENT_STATIC_PRICE_OVERRIDES.map((entry) => [entry.itemIndex, entry.price]));
const filePriceByItem = new Map();
for (const entry of itemPriceOverrides) filePriceByItem.set(entry.itemIndex, entry);

const items = Array.from({ length: ITEM_COUNT }, (_, index) => readCatalogItem(index));
const npcGenerData = Buffer.from(await readFile(npcGenerPath));
const npcGenerText = npcGenerData.toString("latin1");
const generators = parseNpcGenerators(npcGenerText);
const templateNames = [...new Set(generators
  .flatMap((generator) => [generator.values.get("Leader"), generator.values.get("Follower")])
  .filter(Boolean))]
  .sort(compareAscii);
const npcDatabaseFiles = await caseInsensitiveFiles(npcDatabaseRoot);
const generatorRefsByTemplate = indexGeneratorReferences(generators);
const unresolvedTemplateKeys = [];
const resolvedTemplates = [];
let lowNibbleComparisons = 0;
let lowNibbleMatches = 0;

for (const key of templateNames) {
  const databaseFile = resolveNpcDatabaseFile(npcDatabaseFiles, key);
  if (!databaseFile) {
    unresolvedTemplateKeys.push(key);
    continue;
  }

  const data = Buffer.from(await readFile(path.join(npcDatabaseRoot, databaseFile)));
  if (data.length !== NPC_RECORD_BYTES) {
    throw new Error(`${databaseFile}: template NPC possui ${data.length} bytes; esperado ${NPC_RECORD_BYTES}`);
  }

  const merchant = data[17];
  const baseScoreReserved = data[42];
  const currentScoreReserved = data[70];
  const merchantRole = merchant & 0x0f;
  const clientReservedRole = currentScoreReserved & 0x0f;
  lowNibbleComparisons++;
  if (merchantRole === clientReservedRole) lowNibbleMatches++;

  // Carry tambem existe em monstros comuns e pode conter inventario de IA,
  // drops temporarios ou bytes legados. Para comercio, a fronteira fiel e o
  // proprio campo Merchant do template; nao promovemos Carry de Merchant=0.
  if (merchant === 0) continue;

  const carry = SHOP_CARRY_SLOTS.map((carrySlot) => readNpcItem(data, NPC_CARRY_OFFSET + carrySlot * NPC_ITEM_BYTES));
  const stockCount = carry.filter((entry) => entry?.itemIndex > 0).length;

  resolvedTemplates.push({
    key,
    databaseFile,
    name: readCString(data, 0, 16) || key.replaceAll("_", " ").trim(),
    sourceSha256: sha256(data),
    merchant,
    merchantRole,
    templateReserved: data[21],
    baseScoreReserved,
    currentScoreReserved,
    clientReservedRole,
    merchantReservedRoleMatch: merchantRole === clientReservedRole,
    ordinaryShopCandidate: merchantRole === 1 && clientReservedRole === 1,
    stockCount,
    carry,
    generatorReferences: generatorRefsByTemplate.get(key) ?? [],
  });
}

resolvedTemplates.sort((left, right) => compareAscii(left.key, right.key));
const ordinaryShopTemplateKeys = resolvedTemplates
  .filter((template) => template.ordinaryShopCandidate)
  .map((template) => template.key);

const catalog = {
  version: 1,
  source: {
    origin: "WYD classic / Origem Destiny local corpus",
    targetClient: {
      label: "7.54",
      evidence: "Project target recorded in README.md; the supplied binaries do not embed an independently verified release label.",
    },
    itemList: {
      file: "ItemList.bin",
      bytes: encryptedItemList.length,
      sha256: sha256(encryptedItemList),
      decodedSha256: sha256(decodedItemList),
      count: ITEM_COUNT,
      recordBytes: ITEM_RECORD_BYTES,
      encryption: { operation: "xor", key: 90, scope: "all bytes" },
      contract: {
        recoveredSymbol: "STRUCT_ITEMLIST",
        namedBytes: ITEM_NAMED_BYTES,
        unmappedTailBytes: ITEM_RECORD_BYTES - ITEM_NAMED_BYTES,
        unmappedTailEncoding: "hex; omitted from an item only when all 12 bytes are zero",
      },
    },
    itemPrice: {
      file: "ItemPrice.bin",
      bytes: itemPriceData.length,
      sha256: sha256(itemPriceData),
      recordCount: ITEM_PRICE_RECORDS,
      activeRecordCount: itemPriceOverrides.length,
      terminatorRecord: itemPriceTerminatorRecord,
      recordContract: ["itemIndex:int32le", "price:int32le"],
    },
    npcGenerators: {
      file: "NPCGener.txt",
      bytes: npcGenerData.length,
      sha256: sha256(npcGenerData),
      generatorCount: generators.length,
      referencedTemplateCount: templateNames.length,
      resolvedTemplateCount: templateNames.length - unresolvedTemplateKeys.length,
    },
    npcTemplates: {
      directory: "npcdb",
      recordBytes: NPC_RECORD_BYTES,
      recoveredSymbol: "STRUCT_MOB_OLD",
    },
    recoveredClientContracts: [
      {
        file: "TMProject/Basedef.h",
        symbols: ["STRUCT_ITEM", "STRUCT_ITEMLIST", "STRUCT_MOB_OLD", "MSG_ShopList"],
      },
      {
        file: "TMProject/Basedef.cpp",
        symbols: ["BASE_ReadItemList", "BASE_InitialItemRePrice", "BASE_ReadItemPrice"],
      },
      {
        file: "TMProject/SGrid.cpp",
        symbol: "SGridControl::BuyItem",
        evidence: "display index is mapped with index % 9 + 27 * floor(index / 9)",
      },
      {
        file: "TMProject/TMFieldScene.cpp",
        symbol: "TMFieldScene::OnPacketShopList",
        evidence: "MSG_ShopList.List contains 27 entries displayed on a five-column grid",
      },
    ],
  },
  authority: {
    scope: "static client and NPC-template extraction only",
    merchantToReserved: {
      status: "inference",
      rule: "STRUCT_MOB_OLD.Merchant & 0x0f corresponds to STRUCT_SCORE.Reserved & 0x0f",
      ordinaryShopRole: 1,
      corpusEvidence: {
        comparedResolvedTemplates: lowNibbleComparisons,
        matchingLowNibbles: lowNibbleMatches,
        mismatches: lowNibbleComparisons - lowNibbleMatches,
      },
      limitation: "No supplied authoritative server handler was used to prove the transformation; consumers must keep this mapping explicit as an inference.",
    },
    tax: {
      value: null,
      status: "server-runtime-only",
      evidence: "The client receives Tax in MSG_ShopList; neither ItemList nor the NPC template supplies an authoritative tax value.",
    },
    transactions: {
      status: "server-authoritative-not-imported",
      note: "This catalog does not authorize purchases, balances, prices at runtime, or inventory mutation.",
    },
  },
  itemLayout: {
    requirements: ["level", "strength", "intelligence", "dexterity", "constitution"],
    staticEffectCount: 12,
    staticEffectFields: ["effect", "value"],
  },
  priceOverrides: {
    applicationOrder: ["ItemList.basePrice", "BASE_InitialItemRePrice", "ItemPrice.bin in record order"],
    clientStatic: CLIENT_STATIC_PRICE_OVERRIDES,
    itemPrice: itemPriceOverrides,
  },
  shopCarryLayout: {
    displayEntries: 27,
    packetEntries: 27,
    displayGridColumns: 5,
    slots: SHOP_CARRY_SLOTS.map((carrySlot, displayIndex) => ({
      displayIndex,
      displayX: displayIndex % 5,
      displayY: Math.floor(displayIndex / 5),
      carrySlot,
    })),
    itemInstanceContract: {
      bytes: NPC_ITEM_BYTES,
      index: "int16le",
      effects: 3,
      effectPair: ["effect:uint8", "value:uint8", "packed:int16le"],
    },
  },
  counts: {
    items: items.length,
    referencedNpcTemplates: templateNames.length,
    unresolvedNpcTemplates: unresolvedTemplateKeys.length,
    commerceRelevantNpcTemplates: resolvedTemplates.length,
    ordinaryShopCandidates: ordinaryShopTemplateKeys.length,
  },
  unresolvedTemplateKeys,
  ordinaryShopTemplateKeys,
  items,
  npcTemplates: resolvedTemplates,
};

validateCatalog(catalog);
await mkdir(outputDirectory, { recursive: true });
const serialized = `${JSON.stringify(catalog)}\n`;
await writeFile(outputFile, serialized);

const written = await readFile(outputFile, "utf8");
const parsed = JSON.parse(written);
validateCatalog(parsed);
if (written !== serialized) throw new Error("catalog.json gravado difere da serializacao validada");

console.log(`[WYD] Comercio classico: ${catalog.counts.items} itens, ${catalog.counts.commerceRelevantNpcTemplates} templates relevantes, ${catalog.counts.ordinaryShopCandidates} lojas comuns.`);
console.log(`[WYD] ItemPrice: ${itemPriceOverrides.length} overrides; Merchant/Reserved: ${lowNibbleMatches}/${lowNibbleComparisons} nibbles coincidentes.`);
console.log(`[WYD] JSON validado: ${path.relative(projectRoot, outputFile)} (${Buffer.byteLength(serialized)} bytes, sha256 ${sha256(Buffer.from(serialized))}).`);

function readCatalogItem(index) {
  const offset = index * ITEM_RECORD_BYTES;
  const basePrice = decodedItemList.readInt32LE(offset + 128);
  const staticPriceOverride = staticPriceByItem.get(index) ?? null;
  const filePriceOverride = filePriceByItem.get(index) ?? null;
  let price = basePrice;
  if (staticPriceOverride !== null) price = staticPriceOverride;
  if (filePriceOverride) price = filePriceOverride.price;

  const effects = [];
  for (let effect = 0; effect < 12; effect++) {
    const effectOffset = offset + 80 + effect * 4;
    effects.push({
      effect: decodedItemList.readInt16LE(effectOffset),
      value: decodedItemList.readInt16LE(effectOffset + 2),
    });
  }

  const unmappedTail = decodedItemList.subarray(offset + ITEM_NAMED_BYTES, offset + ITEM_RECORD_BYTES);
  return {
    index,
    name: readCString(decodedItemList, offset, 64),
    mesh: decodedItemList.readInt16LE(offset + 64),
    texture: decodedItemList.readInt16LE(offset + 66),
    visualEffect: decodedItemList.readInt16LE(offset + 68),
    requirements: {
      level: decodedItemList.readInt16LE(offset + 70),
      strength: decodedItemList.readInt16LE(offset + 72),
      intelligence: decodedItemList.readInt16LE(offset + 74),
      dexterity: decodedItemList.readInt16LE(offset + 76),
      constitution: decodedItemList.readInt16LE(offset + 78),
    },
    effects,
    basePrice,
    price,
    clientStaticPriceOverride: staticPriceOverride,
    itemPriceOverride: filePriceOverride ? { record: filePriceOverride.record, price: filePriceOverride.price } : null,
    unique: decodedItemList.readInt16LE(offset + 132),
    reserved: decodedItemList.readInt16LE(offset + 134),
    position: decodedItemList.readInt16LE(offset + 136),
    extra: decodedItemList.readInt16LE(offset + 138),
    link: decodedItemList.readInt16LE(offset + 140),
    grade: decodedItemList.readInt16LE(offset + 142),
    ...(unmappedTail.some((value) => value !== 0) ? { unmappedTailHex: unmappedTail.toString("hex") } : {}),
  };
}

function readNpcItem(data, offset) {
  const bytes = data.subarray(offset, offset + NPC_ITEM_BYTES);
  if (bytes.every((value) => value === 0)) return null;
  const effects = [];
  for (let effect = 0; effect < 3; effect++) {
    const effectOffset = offset + 2 + effect * 2;
    effects.push({
      effect: data[effectOffset],
      value: data[effectOffset + 1],
      packed: data.readInt16LE(effectOffset),
    });
  }
  return { itemIndex: data.readInt16LE(offset), effects };
}

function parseNpcGenerators(text) {
  const pieces = text.split(/^\s*#\s*\[\s*(-?\d+)\s*\]\s*$/m);
  const parsed = [];
  for (let index = 1; index + 1 < pieces.length; index += 2) {
    const values = new Map();
    for (const line of pieces[index + 1].split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z0-9]+):\s*(.*?)\s*$/);
      if (match) values.set(match[1], match[2]);
    }
    parsed.push({ id: Number(pieces[index]), values });
  }
  return parsed;
}

function indexGeneratorReferences(generatorsToIndex) {
  const references = new Map();
  for (const generator of generatorsToIndex) {
    const roleByTemplate = new Map();
    for (const [role, field] of [["leader", "Leader"], ["follower", "Follower"]]) {
      const key = generator.values.get(field);
      if (!key) continue;
      const roles = roleByTemplate.get(key) ?? [];
      roles.push(role);
      roleByTemplate.set(key, roles);
    }
    for (const [key, roles] of roleByTemplate) {
      const templateReferences = references.get(key) ?? [];
      templateReferences.push({
        generatorId: generator.id,
        roles,
        start: [numberOrNull(generator.values.get("StartX")), numberOrNull(generator.values.get("StartY"))],
        destination: [numberOrNull(generator.values.get("DestX")), numberOrNull(generator.values.get("DestY"))],
        maxNumMob: numberOrNull(generator.values.get("MaxNumMob")),
      });
      references.set(key, templateReferences);
    }
  }
  return references;
}

async function caseInsensitiveFiles(directory) {
  const names = await readdir(directory);
  return new Map(names.map((name) => [name.toLowerCase(), name]));
}

function resolveNpcDatabaseFile(files, name) {
  return files.get(name.toLowerCase()) ?? files.get(name.replace(/_+$/, "").toLowerCase());
}

function readCString(data, offset, length) {
  const end = data.indexOf(0, offset);
  return windows1252.decode(data.subarray(offset, end < offset || end >= offset + length ? offset + length : end));
}

function numberOrNull(value) {
  if (value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compareAscii(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function validateCatalog(value) {
  if (value.version !== 1) throw new Error("Catalogo de comercio: versao inesperada");
  if (!Array.isArray(value.items) || value.items.length !== ITEM_COUNT) {
    throw new Error(`Catalogo de comercio: esperado items[${ITEM_COUNT}]`);
  }
  for (let index = 0; index < value.items.length; index++) {
    const item = value.items[index];
    if (item.index !== index) throw new Error(`Catalogo de comercio: indice de item invalido em ${index}`);
    if (!Array.isArray(item.effects) || item.effects.length !== 12) {
      throw new Error(`Catalogo de comercio: item ${index} nao possui 12 efeitos`);
    }
    if (!Number.isInteger(item.basePrice) || !Number.isInteger(item.price)) {
      throw new Error(`Catalogo de comercio: preco invalido no item ${index}`);
    }
    if (item.unmappedTailHex !== undefined && !/^[0-9a-f]{24}$/.test(item.unmappedTailHex)) {
      throw new Error(`Catalogo de comercio: cauda binaria invalida no item ${index}`);
    }
  }

  if (!Array.isArray(value.shopCarryLayout?.slots) || value.shopCarryLayout.slots.length !== 27) {
    throw new Error("Catalogo de comercio: mapa dos 27 slots ausente");
  }
  for (let index = 0; index < SHOP_CARRY_SLOTS.length; index++) {
    const slot = value.shopCarryLayout.slots[index];
    if (slot.displayIndex !== index || slot.carrySlot !== SHOP_CARRY_SLOTS[index]) {
      throw new Error(`Catalogo de comercio: mapeamento Carry invalido no display ${index}`);
    }
  }

  if (!Array.isArray(value.npcTemplates)) throw new Error("Catalogo de comercio: npcTemplates ausente");
  for (const template of value.npcTemplates) {
    if (!Array.isArray(template.carry) || template.carry.length !== 27) {
      throw new Error(`Catalogo de comercio: ${template.key} nao possui os 27 slots Carry`);
    }
    for (const entry of template.carry) {
      if (entry === null) continue;
      if (!Number.isInteger(entry.itemIndex) || entry.itemIndex >= ITEM_COUNT) {
        throw new Error(`Catalogo de comercio: item Carry invalido em ${template.key}`);
      }
      if (!Array.isArray(entry.effects) || entry.effects.length !== 3) {
        throw new Error(`Catalogo de comercio: efeitos Carry invalidos em ${template.key}`);
      }
    }
  }

  if (value.authority?.tax?.value !== null || value.authority?.tax?.status !== "server-runtime-only") {
    throw new Error("Catalogo de comercio: tax nao pode ser inventado no importador estatico");
  }
  if (value.authority?.merchantToReserved?.status !== "inference") {
    throw new Error("Catalogo de comercio: Merchant/Reserved deve permanecer uma inferencia explicita");
  }
  if (value.counts?.items !== ITEM_COUNT || value.counts?.commerceRelevantNpcTemplates !== value.npcTemplates.length) {
    throw new Error("Catalogo de comercio: contagens inconsistentes");
  }
}
