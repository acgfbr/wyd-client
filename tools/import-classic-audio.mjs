import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const projectRoot = path.resolve(import.meta.dir, "..");
const clientRoot = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(projectRoot, "../tjs/Origem");
const outputRoot = path.join(projectRoot, "public/game-data/classic/audio");
const inferredMobileAudioRoot = path.resolve(
  projectRoot,
  "../../../Downloads/wyd_extracted/AudioClip",
);
const mobileAudioRoot = process.argv[3]
  ? path.resolve(process.argv[3])
  : process.env.WYD_MOBILE_AUDIO_ROOT
    ? path.resolve(process.env.WYD_MOBILE_AUDIO_ROOT)
    : (await Bun.file(path.join(inferredMobileAudioRoot, "mguardatt.wav")).exists())
      ? inferredMobileAudioRoot
      : null;

const soundListPath = path.join(clientRoot, "sound/soundlist.txt");
if (!(await Bun.file(soundListPath).exists())) {
  throw new Error(`soundlist.txt nao encontrado em ${soundListPath}`);
}

const sounds = [];
const missing = [];
const soundList = await Bun.file(soundListPath).text();
for (const line of soundList.split(/\r?\n/)) {
  const match = line.match(/^\s*(\d+)\s+(.+?\.wav)\s+(\d+)\s*$/i);
  if (!match) continue;
  const index = Number.parseInt(match[1], 10);
  const sourceRelative = match[2].replaceAll("\\", "/").replace(/\/+/g, "/");
  const channels = Number.parseInt(match[3], 10);
  let source = path.join(clientRoot, sourceRelative);
  let fallbackSource = null;
  const outputRelative = sourceRelative.replace(/^sound\//i, "sounds/");
  const destination = path.join(outputRoot, outputRelative);
  if (!(await Bun.file(source).exists())) {
    const exactMobileCandidate = mobileAudioRoot
      ? path.join(mobileAudioRoot, path.basename(sourceRelative))
      : null;
    if (!exactMobileCandidate || !(await Bun.file(exactMobileCandidate).exists())) {
      missing.push({ kind: "sound", index, source: sourceRelative });
      continue;
    }
    source = exactMobileCandidate;
    fallbackSource = `AudioClip/${path.basename(exactMobileCandidate)}`;
  }
  await copyFile(source, destination);
  sounds.push({
    index,
    channels,
    file: `audio/${outputRelative}`,
    source: sourceRelative,
    ...(fallbackSource ? { fallbackSource } : {}),
  });
}

// Exact DS_SOUND_MANAGER::m_szMusicPathOrigin order in DirShow.cpp.
const musicNames = [
  "login.mp3",
  "town01.mp3",
  "field01.mp3",
  "town02.mp3",
  "field02.mp3",
  "dungeon01.mp3",
  "kingdom.mp3",
  "dungeon02.mp3",
  "town03.mp3",
  "field03.mp3",
  "CastleWar.mp3",
  "kepra.mp3",
  "KhepraBoss.mp3",
];
const music = [];
for (const [index, name] of musicNames.entries()) {
  const sourceRelative = `music/${name}`;
  const source = path.join(clientRoot, sourceRelative);
  const destination = path.join(outputRoot, "music", name);
  if (!(await Bun.file(source).exists())) {
    missing.push({ kind: "music", index, source: sourceRelative });
    continue;
  }
  await copyFile(source, destination);
  music.push({ index, file: `audio/music/${name}`, source: sourceRelative });
}

const catalog = {
  version: 1,
  source: {
    soundList: "sound/soundlist.txt",
    musicOrder: "DirShow.cpp DS_SOUND_MANAGER::m_szMusicPathOrigin",
    routing: "TMFieldScene.cpp music selection block",
    mobileAudioFallback: mobileAudioRoot ? "wyd_extracted/AudioClip (exact basename only)" : null,
  },
  counts: {
    sounds: sounds.length,
    music: music.length,
    missing: missing.length,
  },
  sounds: sounds.sort((a, b) => a.index - b.index),
  music,
  missing,
};
await mkdir(outputRoot, { recursive: true });
await Bun.write(path.join(outputRoot, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);

console.log(`Audio classico: ${sounds.length} SFX, ${music.length} musicas, ${missing.length} referencias ausentes.`);

async function copyFile(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  const target = Bun.file(destination);
  const input = Bun.file(source);
  if (await target.exists() && target.size === input.size) return;
  await Bun.write(destination, input);
}
