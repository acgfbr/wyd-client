import path from "node:path";
import process from "node:process";

const projectRoot = path.resolve(import.meta.dirname, "..");
const clientRoot = process.argv[2] ? path.resolve(process.argv[2]) : null;
const serverDataRoot = process.argv[3] ? path.resolve(process.argv[3]) : null;
const imports = [
  { label: "mundo, objetos e criaturas", script: "import-classic-assets.mjs", serverData: true },
  { label: "personagem, Skytalos, montarias e Griupan", script: "import-classic-player.mjs" },
  { label: "skills", script: "import-classic-skills.mjs" },
  { label: "HUD clássico", script: "import-classic-ui.mjs" },
  { label: "itens e comercio", script: "import-classic-commerce.mjs", serverData: true },
  { label: "audio e musicas", script: "import-classic-audio.mjs" },
];

for (const entry of imports) {
  console.log(`\n[WYD] Importando ${entry.label}...`);
  const command = [process.execPath, path.join(projectRoot, "tools", entry.script)];
  if (clientRoot) command.push(clientRoot);
  if (entry.serverData && serverDataRoot) command.push(serverDataRoot);
  const child = Bun.spawn(command, {
    cwd: projectRoot,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    console.error(`[WYD] Falha ao importar ${entry.label} (código ${exitCode}).`);
    process.exit(exitCode);
  }
}

console.log("\n[WYD] Gerando pacote de cache inicial...");
const cacheIndex = Bun.spawn(
  [process.execPath, path.join(projectRoot, "tools", "build-classic-precache.mjs")],
  { cwd: projectRoot, stdin: "inherit", stdout: "inherit", stderr: "inherit" },
);
const cacheExitCode = await cacheIndex.exited;
if (cacheExitCode !== 0) process.exit(cacheExitCode);

console.log("\n[WYD] Importação completa em public/game-data/classic.");
