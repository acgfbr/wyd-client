import { readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");
const classicRoot = join(projectRoot, "public/game-data/classic");
const docsRoot = join(projectRoot, "docs");

const manifest = await readJson(join(classicRoot, "manifest.json"));
const monsterCatalog = await readJson(join(classicRoot, manifest.monsters.catalog));
const commerceCatalog = await readJson(join(classicRoot, "commerce/catalog.json"));
const skillCatalog = await readJson(join(classicRoot, "data/skills.json"));
const itemIcons = await readJson(join(classicRoot, "ui/item-icons.json"));
const audioCatalogPath = join(classicRoot, "audio/catalog.json");
const audioCatalog = await Bun.file(audioCatalogPath).exists()
  ? await readJson(audioCatalogPath)
  : null;

const { CLASSIC_PLAYER_CLASSES } = await import("../src/game/player/PlayerClasses.ts");
const { HUNTRESS_LOOKS } = await import("../src/game/player/HuntressLooks.ts");
const { MOUNT_LOOKS } = await import("../src/game/player/MountLooks.ts");
const { CLASS_SKILL_LOADOUTS } = await import("../src/game/combat/ClassSkills.ts");
const { BEAST_MASTER_SUMMONS } = await import("../src/game/combat/BeastMasterSummons.ts");

const areas = [
  ["Fields/TRN", "fields"],
  ["Objetos/DAT", "objects"],
  ["Minimapas/WYT", "minimaps"],
  ["Modelos de mapa", "models"],
  ["Texturas de ambiente", "textures/env"],
  ["Texturas de efeitos", "textures/effects"],
  ["Texturas de agua", "textures/water"],
  ["Monstros/NPCs", "monsters"],
  ["Player", "player"],
  ["Montarias", "player/mounts"],
  ["Familiares", "player/familiars"],
  ["Evocacoes", "player/summons"],
  ["UI", "ui"],
  ["Dados", "data"],
  ["Comercio", "commerce"],
  ["Navegacao", "navigation"],
  ["Audio", "audio"],
];

const areaStats = [];
for (const [label, directory] of areas) {
  const files = await walk(join(classicRoot, directory));
  areaStats.push({
    label,
    directory,
    files: files.length,
    bytes: files.reduce((total, file) => total + file.size, 0),
    extensions: countExtensions(files),
  });
}

const fieldChecks = manifest.fields.map((field) => ({
  field: field.file.replace(/\.trn$/i, ""),
  terrain: `fields/${field.file}`,
  object: field.objectFile ? `objects/${field.objectFile}` : null,
  minimap: field.minimapFile ? `minimaps/${field.minimapFile}` : null,
}));

const referencedFiles = [
  ...fieldChecks.flatMap((field) => [field.terrain, field.object, field.minimap]),
  ...Object.values(manifest.textures).map((entry) => entry.file),
  ...Object.values(manifest.effectTextures).map((entry) => entry.file),
  ...Object.values(manifest.waterTextures).map((entry) => entry.file),
  ...Object.values(manifest.objectModels).flatMap((entry) => [entry.file, ...(entry.textures ?? [])]),
  manifest.navigation.attributeMap.file,
  manifest.navigation.objectMasks.file,
  manifest.monsters.catalog,
];

const uniqueReferencedFiles = [...new Set(referencedFiles.filter((file) => typeof file === "string"))].sort();
const missingReferencedFiles = [];
for (const file of uniqueReferencedFiles) {
  if (!(await Bun.file(join(classicRoot, file)).exists())) {
    missingReferencedFiles.push(file);
  }
}

const skillsByClass = skillCatalog.classes.map((classEntry) => {
  const importedIndices = new Set([...classEntry.skills, ...classEntry.masterSkills]);
  const imported = skillCatalog.skills.filter((skill) => importedIndices.has(skill.index));
  const runtime = CLASS_SKILL_LOADOUTS[classEntry.key] ?? [];
  const runtimeIndices = new Set(runtime.map((skill) => skill.classicIndex));
  const catalogOnly = imported.filter((skill) => !runtimeIndices.has(skill.index));
  const passiveCatalogIndices = catalogOnly
    .filter((skill) => skill.passive === 1)
    .map((skill) => skill.index);
  const castablePendingIndices = catalogOnly
    .filter((skill) => skill.passive !== 1)
    .map((skill) => skill.index);
  return {
    key: classEntry.key,
    name: classEntry.name,
    imported: imported.length,
    regular: classEntry.skills.length,
    master: classEntry.masterSkills.length,
    runtime: runtime.length,
    runtimeIndices: [...runtimeIndices].sort((a, b) => a - b),
    passiveCatalogIndices,
    castablePendingIndices,
    // Compatibility key for consumers of the first report version. It now
    // tracks actionable casts/buffs instead of passive catalog records.
    pendingIndices: castablePendingIndices,
  };
});

const effectSourceFiles = (await walk(join(projectRoot, "src/render/effects")))
  .filter((file) => file.path.endsWith(".ts"));
const screenshotFiles = (await walk(join(docsRoot, "screenshots")))
  .filter((file) => /\.(?:png|jpe?g|webp)$/i.test(file.path));
const mapScreenshotFiles = screenshotFiles.filter((file) => file.path.includes("/maps/"));
const audioFiles = (await walk(classicRoot))
  .filter((file) => /\.(?:wav|mp3|ogg|m4a|aac)$/i.test(file.path));
const catalogSoundIndices = new Set((audioCatalog?.sounds ?? []).map((entry) => entry.index));
const actorActionSoundIndices = [...new Set(
  Object.values(monsterCatalog.visualFamilies)
    .flatMap((family) => Object.values(family.actions ?? {}))
    .map((values) => values.at(-1))
    .filter((value) => Number.isFinite(value) && value > 0),
)].sort((left, right) => left - right);

const coverage = {
  generatedAt: new Date().toISOString(),
  command: "bun run audit:coverage",
  source: manifest.source,
  referencedFiles: {
    total: uniqueReferencedFiles.length,
    missing: missingReferencedFiles,
  },
  maps: {
    fields: manifest.fields.length,
    completeTerrain: fieldChecks.filter((field) => !missingReferencedFiles.includes(field.terrain)).length,
    declaredObjects: fieldChecks.filter((field) => field.object !== null).length,
    declaredMinimaps: fieldChecks.filter((field) => field.minimap !== null).length,
    missingObjectReferences: fieldChecks.filter((field) => field.object && missingReferencedFiles.includes(field.object)).length,
    missingMinimapReferences: fieldChecks.filter((field) => field.minimap && missingReferencedFiles.includes(field.minimap)).length,
    screenshots: mapScreenshotFiles.length,
  },
  manifest: {
    terrainTextures: Object.keys(manifest.textures).length,
    effectTextures: Object.keys(manifest.effectTextures).length,
    waterTextures: Object.keys(manifest.waterTextures).length,
    objectModels: Object.keys(manifest.objectModels).length,
  },
  monsters: {
    templates: monsterCatalog.templates.length,
    generators: monsterCatalog.generators.length,
    itemRecords: monsterCatalog.items.length,
    visualFamilies: Object.keys(monsterCatalog.visualFamilies).length,
    skinnedObjects: Object.keys(monsterCatalog.skinnedObjects).length,
    unresolvedTemplates: monsterCatalog.unresolvedTemplates,
  },
  player: {
    classes: CLASSIC_PLAYER_CLASSES.map((entry) => ({
      key: entry.key,
      name: entry.name,
      looks: entry.looks.length,
    })),
    huntressLooks: HUNTRESS_LOOKS.length,
    mounts: MOUNT_LOOKS.length,
    mountFamilies: [...new Set(MOUNT_LOOKS.map((mount) => mount.family.base))].sort(),
    beastMasterSummons: BEAST_MASTER_SUMMONS.length,
  },
  items: {
    catalog: commerceCatalog.counts.items,
    iconMappings: itemIcons.itemToIcon.length,
    iconAtlases: itemIcons.atlases.length,
    referencedNpcTemplates: commerceCatalog.counts.referencedNpcTemplates,
    unresolvedNpcTemplates: commerceCatalog.counts.unresolvedNpcTemplates,
    commerceRelevantNpcTemplates: commerceCatalog.counts.commerceRelevantNpcTemplates,
  },
  skills: {
    catalogRecords: skillCatalog.skills.length,
    classes: skillsByClass,
    dedicatedEffectSourceFiles: effectSourceFiles.length,
  },
  audio: {
    importedFiles: audioFiles.length,
    catalogSounds: audioCatalog?.counts.sounds ?? 0,
    catalogMusic: audioCatalog?.counts.music ?? 0,
    missingReferences: audioCatalog?.missing ?? [],
    actorActionSounds: actorActionSoundIndices.length,
    missingActorActionSounds: actorActionSoundIndices.filter((index) => !catalogSoundIndices.has(index)),
  },
  screenshots: {
    total: screenshotFiles.length,
    maps: mapScreenshotFiles.length,
  },
  areas: areaStats,
};

await Bun.write(join(docsRoot, "matriz-cobertura-classico.json"), `${JSON.stringify(coverage, null, 2)}\n`);
await Bun.write(join(docsRoot, "matriz-cobertura-classico.md"), renderMarkdown(coverage));

console.log(`Cobertura gerada: ${relative(projectRoot, join(docsRoot, "matriz-cobertura-classico.md"))}`);
console.log(`Referencias: ${coverage.referencedFiles.total}; ausentes: ${coverage.referencedFiles.missing.length}`);
console.log(`Fields: ${coverage.maps.fields}; monstros/NPCs: ${coverage.monsters.templates}; itens: ${coverage.items.catalog}`);

function renderMarkdown(report) {
  const missing = report.referencedFiles.missing.length === 0
    ? "Nenhum arquivo referenciado pelo manifesto esta ausente."
    : report.referencedFiles.missing.map((file) => `- \`${file}\``).join("\n");

  const areaRows = report.areas.map((area) =>
    `| ${area.label} | \`${area.directory}\` | ${area.files} | ${formatBytes(area.bytes)} | ${formatExtensions(area.extensions)} |`,
  ).join("\n");

  const skillRows = report.skills.classes.map((entry) =>
    `| ${entry.name} | ${entry.imported} (${entry.regular} normais + ${entry.master} master) | ${entry.runtime} | ${entry.runtimeIndices.join(", ") || "-"} | ${entry.passiveCatalogIndices.length} | ${entry.castablePendingIndices.length} |`,
  ).join("\n");

  const classRows = report.player.classes.map((entry) =>
    `| ${entry.name} | ${entry.looks} |`,
  ).join("\n");

  const audioGap = report.audio.importedFiles === 0
    ? "- Audio continua sem arquivos importados."
    : `- Audio: ${report.audio.catalogSounds} entradas de SFX e ${report.audio.catalogMusic} musicas; ${report.audio.actorActionSounds} IDs distintos do AniSound usados por atores, com ${report.audio.missingActorActionSounds.length} ausentes; ${report.audio.missingReferences.length} referencias do soundlist nao existem no corpus.`;

  return `# Matriz automatica de cobertura do cliente classico

Gerado por \`${report.command}\` em ${report.generatedAt}. Este arquivo e
derivado dos artefatos importados e do runtime; nao deve ser editado
manualmente. A analise e as decisoes ficam em \`auditoria-threejs-cobertura.md\`.

## Integridade dos imports

- ${report.referencedFiles.total} caminhos unicos referenciados pelo manifesto.
- ${report.referencedFiles.missing.length} caminhos referenciados ausentes.
- ${report.maps.fields} Fields: ${report.maps.completeTerrain} TRN,
  ${report.maps.declaredObjects} DAT declarados e ${report.maps.declaredMinimaps}
  minimapas declarados.
- Referencias declaradas ausentes: ${report.maps.missingObjectReferences} DAT e
  ${report.maps.missingMinimapReferences} minimapas.
- ${report.maps.screenshots} capturas de mapa presentes na documentacao.

${missing}

## Inventario fisico

| Area | Diretorio | Arquivos | Tamanho | Extensoes |
| --- | --- | ---: | ---: | --- |
${areaRows}

## Manifesto e dados estruturados

| Subsistema | Quantidade rastreada |
| --- | ---: |
| Texturas de terreno/ambiente | ${report.manifest.terrainTextures} |
| Texturas de efeitos | ${report.manifest.effectTextures} |
| Texturas de agua | ${report.manifest.waterTextures} |
| Modelos de objetos | ${report.manifest.objectModels} |
| Templates de NPC/monstro | ${report.monsters.templates} |
| Geradores de NPC/monstro | ${report.monsters.generators} |
| Familias visuais | ${report.monsters.visualFamilies} |
| Objetos skinned catalogados | ${report.monsters.skinnedObjects} |
| Registros de item | ${report.items.catalog} |
| Mapeamentos de icone | ${report.items.iconMappings} |
| Atlas de icones | ${report.items.iconAtlases} |
| Registros de skill | ${report.skills.catalogRecords} |
| Arquivos TS dedicados a efeitos | ${report.skills.dedicatedEffectSourceFiles} |
| Arquivos de audio importados | ${report.audio.importedFiles} |
| Entradas SFX no catalogo de audio | ${report.audio.catalogSounds} |
| Musicas no catalogo de audio | ${report.audio.catalogMusic} |
| IDs distintos de ação do AniSound | ${report.audio.actorActionSounds} |
| IDs de ação do AniSound ausentes | ${report.audio.missingActorActionSounds.length} |

Templates de NPC/monstro nao resolvidos: ${report.monsters.unresolvedTemplates.length}.
Templates comerciais nao resolvidos: ${report.items.unresolvedNpcTemplates}.

## Player, looks, montarias e evocacoes

| Classe | Looks expostos no runtime |
| --- | ---: |
${classRows}

- Looks especializados da Huntress: ${report.player.huntressLooks}.
- Montarias selecionaveis: ${report.player.mounts}, em
  ${report.player.mountFamilies.length} familias (${report.player.mountFamilies.join(", ")}).
- Evocacoes do BeastMaster: ${report.player.beastMasterSummons}.

## Skills: import binario x promocao no runtime

Uma skill promovida possui definicao jogavel em \`CLASS_SKILL_LOADOUTS\`.
Registros marcados como passivos pelo proprio \`SkillData.bin\` ficam no
catalogo e nunca devem ocupar a barra. Isso nao prova por si so fidelidade
visual; a homologacao do renderer continua manual e rastreada em
\`PENDENCIAS.md\`.

| Classe | Importadas | Runtime | Indices ativos | Passivas fora da barra | Casts/buffs pendentes |
| --- | ---: | ---: | --- | ---: | ---: |
${skillRows}

## Lacunas objetivas

${audioGap}
- Skills importadas mas ainda nao promovidas aparecem na tabela acima.
- Compra, venda, ownership, economia, drops e formulas autoritativas dependem
  do futuro servidor e nao podem ser inferidos desta matriz de assets.
- Cobertura fisica confirma existencia; animacao, bone, alpha, shader e escala
  ainda exigem homologacao visual por familia.
`;
}

async function readJson(path) {
  return Bun.file(path).json();
}

async function walk(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(path));
      continue;
    }
    if (!entry.isFile()) continue;
    const file = Bun.file(path);
    files.push({ path, size: file.size });
  }
  return files;
}

function countExtensions(files) {
  const counts = {};
  for (const file of files) {
    const extension = extname(file.path).toLowerCase() || "(sem extensao)";
    counts[extension] = (counts[extension] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function formatExtensions(extensions) {
  return Object.entries(extensions)
    .map(([extension, count]) => `${extension} ${count}`)
    .join(", ") || "-";
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}
