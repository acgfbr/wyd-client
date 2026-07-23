# Auditoria Three.js e cobertura do cliente clássico

Data: 2026-07-22

Este documento inicia a pendência de auditoria técnica final. Ele não substitui
`PENDENCIAS.md`; aqui ficam a matriz de cobertura, os riscos de runtime e os
próximos imports rastreáveis.

## Fontes canônicas

- Cliente clássico em `../tjs/Origem` e fontes decompiladas em
  `../tjs/tm-project2/Projects/TMProject`.
- Assets web gerados em `public/game-data/classic`.
- Importadores reprodutíveis em `tools/import-classic-*.mjs`.
- Runtime Three.js em `src/render`, `src/world`, `src/game` e `src/app`.

## Sinais de runtime

A HUD abaixo do minimapa agora mostra:

- `FPS`: frames por segundo agregados a cada segundo.
- `RAM JS`: `performance.memory.usedJSHeapSize` quando o navegador expõe.
- `THREAD*`: tempo médio e ocupação da callback principal; não é CPU real.
- `GEO/TEX/CALLS/TRIS`: `WebGLRenderer.info.memory` e
  `WebGLRenderer.info.render`, úteis para detectar vazamento, draw calls
  excessivos e regressões de streaming.

Esses dados devem ser observados em Armia, fora da cidade, com C.C. ativo,
com vários drops, com NPC shop/cargo/inventário aberto e no iPhone.

## Boas práticas Three.js aplicadas

- `WebGLRenderer` único para a cena principal; o preview de inventário
  compartilha cache/model library e só usa renderer próprio pequeno quando
  necessário.
- Texturas e geometrias de mundo entram por streaming de Field.
- Vários sistemas possuem `dispose()` explícito para pools, texturas,
  materiais, skeletons, labels canvas e renderers auxiliares.
- `GameApp.dispose()` agora centraliza o shutdown: para o animation loop,
  remove listeners globais, encerra input, preview, ground items, player,
  mundo, spawns, efeitos, damage numbers e renderer. O `pagehide` preserva o
  bfcache do Safari/iOS quando `persisted=true` e só destrói recursos em unload
  real.
- Dados clássicos pesados carregam lazy: comércio, skills, ícones e modelos
  só são resolvidos quando necessários.
- `WebGLRenderer.info` agora está exposto na HUD para acompanhar geometria,
  textura, draw calls e triângulos em tempo real.
- Mobile/iPhone reduz pixel ratio, sombras e antialias, e usa fallback de DDS
  quando o navegador não suporta o caminho ideal.
- A varredura estática de `src/render/effects` confirmou `dispose()` em todos
  os módulos que alocam geometria/material/textura e limites explícitos nos
  pools variáveis de projéteis, partículas, trails, impactos e shades. Efeitos
  persistentes sem pool variável possuem quantidade fixa por ator/buff.
- Listeners globais de ciclo longo pertencem a `GameApp`/`GameInput` e são
  removidos no shutdown. Listeners locais de HUD/tooltip/shop pertencem a nós
  DOM descartados junto com a página e não criam registros por troca de mapa.

## Riscos técnicos abertos

- O shutdown central existe, mas ainda precisa de teste visual/manual de
  navegação/reload e inspeção dos contadores `GEO/TEX` antes/depois de trocas
  pesadas de mapa/classe.
- Os efeitos já promovidos têm pools limitados e cleanup; novas skills só
  podem entrar na matriz depois de declarar limite e descarte de
  mapa/classe/morte.
- O runtime principal agora fica separado do vendor Three.js. Foema,
  TransKnight e BeastMaster possuem chunks de renderer próprios carregados
  apenas no primeiro switch para a classe; o build medido gerou chunks de
  aproximadamente 20, 54 e 96 KiB minificados. A entrada da aplicação ficou em
  aproximadamente 460 KiB e o vendor Three.js em 518 KiB. Huntress permanece
  no boot porque é a classe inicial; catálogos grandes já usam fetch lazy.
- `performance.memory` não existe no Safari/iPhone, então RAM JS aparece como
  `—`; para iOS, usar GEO/TEX/CALLS/TRIS e inspeção remota.
- WebGPU não é alternativa atual: o runtime depende de materiais Three.js
  customizados via WebGL e shaders `onBeforeCompile`; migrar exigiria portar
  esses caminhos para outro pipeline.

## Matriz de cobertura

A matriz fisica e reproduzivel agora e gerada por
`bun run audit:coverage` em `docs/matriz-cobertura-classico.md` e
`docs/matriz-cobertura-classico.json`. O gerador cruza o manifesto com os
arquivos existentes e importa as definicoes TypeScript do runtime para nao
confundir asset presente com feature jogavel. No snapshot atual existem 2.285
caminhos unicos declarados e nenhum ausente; os 111 Fields possuem 111 TRN,
108 DAT declarados e 103 minimapas declarados. As ausencias de DAT/minimapa
nos demais Fields fazem parte do proprio manifesto, nao sao links quebrados.

| Subsistema | Cobertura atual | Fonte/rastro | Aberto |
| --- | --- | --- | --- |
| Mapas/Fields | 111 Fields, streaming, conexões, minimapas, seletor | `manifest.json`, `Field*.trn`, `regions.ts` | Revisão visual final dos 111 mapas |
| Terreno/colisão | TRN, AttributeMap, object.bin, pontes/altura, pathfinding | `ClassicWorld`, `ClassicNavigation` | Casos isolados de máscara/altura que aparecerem em teste |
| Objetos/props | DAT/WYS/MSH, água, folhas, fogueiras, fontes, floats | `MapObjects`, `MapWater`, `ClassicEnvironmentObjects` | Homologar pontos de grama e objetos raros |
| Personagem | Quatro classes jogáveis, rigs, traje base, arma, montaria/familiar | `PlayerClasses`, `ClassicPlayerAvatar` | Cobertura completa de equipamentos visuais por classe |
| Huntress | Mulher Kalintz, Skytalos Ancient +15, Griupan, 12 skills promovidas | `HuntressLooks`, `ClassicHuntressSkillEffects`, `ClassicLevelUpEffects` | 24 registros ainda não promovidos |
| Montarias | 14 montarias nível 120, Unicórnio padrão, sela/bones | `MountLooks`, `ClassicMount` | Homologação visual de todas as variações |
| NPCs/monstros | Spawn por Field, animação, hover/seleção, IA offline, drops | `MonsterCatalog`, `ClassicSpawnManager` | Cobertura de todos skins/itens/ações especiais |
| BeastMaster summons | 8 evocações, 10 por cast, IA offline | `BeastMasterSummons`, `ClassicBeastMasterSummon` | Trocar IA local por packets autoritativos no futuro |
| Inventário/equipamento | UI 7.54, bolsas, equip/unequip, cargo, preview 3D | `GameHud`, `ClassicInventoryPreview` | Compra/venda/economia somente com servidor |
| Itens/comércio | 6.500 ItemList, ItemPrice, Carry de NPC, tooltips clássicos | `ClassicCommerceCatalog`, `ClassicItemTooltip` | Footprint multicélula EF_GRID e ownership de drops |
| HUD/chat | Orbes, C.C., menu, chat local, overhead name/HP/balão | `main.ts`, `GameHud`, `ClassicPlayerOverheadHud` | Homologar 1024x768, widescreen e iPhone |
| Skills/VFX | Vários lotes por classe implementados; skills não citadas bloqueadas | `ClassSkills`, `render/effects` | Épico de skills completo continua aberto |
| Áudio | 333 SFX, 13 músicas, BGM opcional, combate/coleta, passos por piso, 82 IDs AniSound de atores e loops ambientais próximos | `audio/catalog.json`, `ClassicAudio`, `ClassicSpawnManager`, `MapObjects` | Quatro referências órfãs dos corpora desktop/mobile; clima global depende do futuro weather |
| Rede/servidor | Deliberadamente fora do escopo atual | n/a | Sessão, economia, dano autoritativo, drops reais |

## Ordem segura para continuar

1. Homologar visualmente a telemetria nova e coletar baseline de Armia:
   FPS/RAM/THREAD/GEO/TEX/CALLS/TRIS.
2. Testar o shutdown central em reload/pagehide real e bfcache Safari.
3. Medir o boot e a troca das quatro classes em desktop/iPhone para homologar
   os novos chunks e registrar a baseline real.
4. Voltar ao épico de skills somente com uma lista curta por lote, mantendo a
   regra de não cair em efeito genérico silencioso.
