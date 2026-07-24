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
- `ModelLibrary` deduplica os DDS por caminho: 2.098 slots de material das
  963 MSA compartilham 419 arquivos físicos. Cada modelo retém
  uma lease por DDS distinto e o último `release` descarta a textura; materiais
  e geometrias continuam por protótipo para não compartilhar estado mutável.
- Vários sistemas possuem `dispose()` explícito para pools, texturas,
  materiais, skeletons, labels canvas e renderers auxiliares.
- `GameApp.dispose()` agora centraliza o shutdown: para o animation loop,
  remove listeners globais, encerra input, preview, ground items, player,
  mundo, spawns, efeitos, damage numbers e renderer. O `pagehide` preserva o
  bfcache do Safari/iOS quando `persisted=true` e só destrói recursos em unload
  real.
- Dados clássicos pesados carregam lazy: comércio, skills, ícones e modelos
  só são resolvidos quando necessários.
- Materiais MSA de cenário preservam agora o `cAlpha` de
  `MeshTextureList.bin`. O primeiro slot governa o mesh inteiro, igual ao
  `TMObject`; somente `A/C` e a exceção `156..185` entram na fila transparente,
  evitando tanto recortes opacos quanto ordenar todos os 963 modelos como
  transparentes.
- Folhas, árvores, navios, borboletas e peixes continuam agrupados em
  `InstancedMesh`, mas não usam mais deformação procedural genérica. Quatro
  poses amostradas dos BON/ANI clássicos são atributos compartilhados do
  protótipo e o shader interpola o ciclo com o `m_dwFPS` de cada classe. Isso
  preserva poucos draw calls sem alocar um `Skeleton` por instância.
- `MapWater` separa os três shaders de `TMSea` (externo, dungeon e região
  especial `28/29 × 22/23`) e deduplica seus DDS por origem/índice. Materiais
  compartilham as texturas `2/3`, `8/9` e o efeito `406`, que são descartadas
  uma única vez no lifecycle global da água.
- O preview 3D do inventário usa LRU de no máximo 12 instâncias. Materiais
  clonados são descartados na expulsão e o protótipo do `ModelLibrary` é
  liberado quando nenhum outro preview daquele tipo continua residente. Assim,
  percorrer o catálogo de 6.500 itens não transforma a sessão em um cache GPU
  sem limite.
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
  aproximadamente 37–124 KiB minificados. A entrada da aplicação ficou em
  aproximadamente 600 KiB e o vendor Three.js em 518 KiB. Huntress permanece
  no boot porque é a classe inicial; catálogos grandes já usam fetch lazy.
- `performance.memory` não existe no Safari/iPhone, então RAM JS aparece como
  `—`; para iOS, usar GEO/TEX/CALLS/TRIS e inspeção remota.
- WebGPU não é alternativa atual: o runtime depende de materiais Three.js
  customizados via WebGL e shaders `onBeforeCompile`; migrar exigiria portar
  esses caminhos para outro pipeline.
- O chunk `vendor-three` fica em aproximadamente 518 KiB minificados. Esse
  tamanho é da biblioteca compartilhada, não de assets dos mapas, e não cresce
  ao caminhar. Dividi-lo artificialmente não reduz bytes nem memória de
  execução; a métrica útil para regressão continua sendo o chunk da aplicação,
  os chunks lazy por classe e os contadores em runtime.

## Matriz de cobertura

A matriz fisica e reproduzivel agora e gerada por
`bun run audit:coverage` em `docs/matriz-cobertura-classico.md` e
`docs/matriz-cobertura-classico.json`. O gerador cruza o manifesto com os
arquivos existentes e importa as definicoes TypeScript do runtime para nao
confundir asset presente com feature jogavel. No snapshot atual existem 4.241
caminhos unicos declarados e nenhum ausente; os 111 Fields possuem 111 TRN,
108 DAT declarados e 103 minimapas declarados. As ausencias de DAT/minimapa
nos demais Fields fazem parte do proprio manifesto, nao sao links quebrados.

| Subsistema | Cobertura atual | Fonte/rastro | Aberto |
| --- | --- | --- | --- |
| Mapas/Fields | 111 Fields, streaming, conexões, minimapas, seletor | `manifest.json`, `Field*.trn`, `regions.ts` | Revisão visual final dos 111 mapas |
| Terreno/colisão | TRN, AttributeMap, object.bin, pontes/altura, pathfinding | `ClassicWorld`, `ClassicNavigation` | Casos isolados de máscara/altura que aparecerem em teste |
| Objetos/props | DAT/WYS/MSH, água, folhas/árvores/fauna/navios com ANI instanciada, fogueiras, fontes, floats, TMDust 531, tetos/partículas TMHouse, reflexos de céu e composições 1846/1980/2035 | `MapObjects`, `MapWater`, `ClassicEnvironmentObjects`, `MapEffects`, `MapMeshEffects` | Homologar pontos de grama e famílias ambientais raras |
| Personagem | Quatro classes jogáveis, rigs, 34 trajes `4150..4183` com troca `ch01/ch02`, arma, montaria/familiar | `ClassicCostumeLooks`, `PlayerClasses`, `ClassicPlayerAvatar` | Combinações ordinárias de equipamentos `LOOK_INFO` por classe |
| Huntress | Mulher Kalintz, Skytalos Ancient +15, Griupan, 17 skills promovidas | `HuntressLooks`, `ClassicHuntressSkillEffects`, `ClassicAlchemyCatalog`, `ClassicLevelUpEffects` | 17 passivas e 2 casts ainda fora do runtime |
| Montarias | 16 montarias nível 120, Unicórnio padrão, sela/bones | `MountLooks`, `ClassicMount` | Homologação visual de todas as variações |
| NPCs/monstros | Spawn por Field, animação, hover/seleção, IA offline, drops, armas Equip[6]/[7], 14 montarias Equip[14], 50 mantuas Equip[15], Nyerdes, efeitos intrínsecos 61+56, crater TMShade, Gárgulas dungeon-2 e os sete `TMEffectMeshRotate` do Guer_Caveira | `MonsterCatalog`, `ClassicSpawnManager`, `ClassicNyerdesParticles`, `ClassicMonsterPersistentEffects`, `ClassicMonsterRotateBoneEffects` | Homologar por amostragem; TMButterFly de owner e o ponto `[1]` do Krill ATTACK02 aguardam evidência não contraditória |
| BeastMaster | 8 evocações (10 por cast), IA offline e 5 transformações de rig | `BeastMasterSummons`, `ClassicBeastMasterSummon`, `BeastMasterTransformations` | Invocação Final e fórmulas autoritativas ainda dependem do servidor |
| Inventário/equipamento | UI 7.54, bolsas, equip/unequip, cargo, preview 3D, Extração e Alquimia somente leitura | `GameHud`, `ClassicInventoryPreview`, `ClassicAlchemyCatalog` | Compra/venda/economia e resultado das combinações somente com servidor |
| Itens/comércio | 6.500 ItemList, ItemPrice, Carry de NPC, tooltips clássicos e footprint EF_GRID | `ClassicCommerceCatalog`, `PlayerState`, `ClassicItemTooltip` | Ownership/decadência de drops e economia autoritativa |
| HUD/chat | Orbes, C.C., menu, chat local, overhead name/HP/balão | `main.ts`, `GameHud`, `ClassicPlayerOverheadHud` | Homologar 1024x768, widescreen e iPhone |
| Skills/VFX | Vários lotes por classe implementados; skills não citadas bloqueadas | `ClassSkills`, `render/effects` | Épico de skills completo continua aberto |
| Áudio | 333 SFX, 13 músicas, BGM opcional, combate/coleta, passos por piso, 82 IDs AniSound de atores e loops ambientais próximos | `audio/catalog.json`, `ClassicAudio`, `ClassicSpawnManager`, `MapObjects` | Quatro referências órfãs dos corpora desktop/mobile; clima global depende do futuro weather |
| Rede/servidor | Deliberadamente fora do escopo atual | n/a | Sessão, economia, dano autoritativo, drops reais |

## Inventário objetivo das lacunas

- Skills: 87 de 144 registros de classe/master já estão no runtime. Dos 57
  restantes, 49 são passivos no próprio `SkillData.bin`; apenas 8 são
  casts/buffs ainda não promovidos. Alguns destes 8 dependem de estado
  autoritativo, party, item ou servidor; “pendente” não
  significa automaticamente “falta um efeito”.
- Classes/equipamentos: as quatro classes, seus looks base e toda a faixa de
  fantasias `4150..4183` são jogáveis. Os trajes trocam também
  `m_nSkinMeshType`, banco ANI e attachment de mão como no cliente. Ainda não
  existe cobertura visual 1:1 de todas as combinações ordinárias de
  `LOOK_INFO` entre os 6.500 itens; o próximo import deve partir de
  `ItemList.bin` e das regras de slot/mesh do cliente, não de uma lista manual
  de skins.
- Monstros/NPCs: os 377 templates e 3.937 geradores estão catalogados e entram
  no streaming. As armas rígidas também foram fechadas a partir de
  `Equip[6]/Equip[7]`: 76 MSAs cobrem 224 templates e 269 attachments,
  incluindo o espelhamento/rotação das duas garras `EF_WTYPE 41`. Os rigs
  humanoides cruzam o tipo com `nPos/position@136` nos mesmos branches de
  `CheckWeapon` para escolher seu banco ANI. `Equip[14]`, `Equip[15]` e o
  Nyerdes `769` de `Equip[13]` também possuem os attachments, ações e
  lifecycle de streaming derivados de `TMHuman`. `RenderEffect` cobre ainda
  61 perfis persistentes e 56 perfis de emissão aditiva/default por meio dos pontos
  exatos de `CFrame::UpdateFrames`. A lacuna restante é validar
  famílias visuais, armas e ações especiais por amostragem; casos com skin
  incorreta devem ser corrigidos no catálogo/importador para beneficiar todos
  os spawns.
- Itens: os 6.500 registros, preços, carries e ícones estão importados. Ainda
  são sistemas de servidor: propriedade real do drop, compra/venda, economia,
  persistência e validação. `EF_GRID` multicélula já é respeitado por
  bolsa/cargo, e moedas `EF_ITEMTYPE 2` já têm leitura/etiqueta clássica; a
  criação, coleta e alteração de saldo continuam corretamente no servidor.
- Mapas: os 111 TRN existem; 108 DAT e 103 minimapas são exatamente os
  declarados pela fonte. O aberto é homologação visual dos mapas e dos raros
  objetos com comportamento próprio, não uma importação em lote ausente. A
  primeira varredura recuperou 1.189 emissores `TMDust 531`, portais `2035`,
  coroas `1846`, composições `1980`, 430 bases `TMHouse` com partes indiretas
  e os tetos `tipo + 1` de `251..254`, ocultos pelo bit `0x08` do AttributeMap.
  Os 52 objetos `1855` agora também alternam o blend de proximidade do cliente;
  `610/611/612` não foi instanciado porque não existe base `610` nos DAT;
  52 fontes, 225 cachoeiras e cinco objetos `607` recuperaram os emissores de
  `TMHouse::FrameMove` em batches GPU, mantendo sem emissão os quatro branches
  que o cliente explicitamente zera ou interrompe;
  697 estruturas recuperaram os overlays indiretos `1555..1559/1598`, e 62
  objetos `TMBike 1549..1551` agora oscilam no ciclo clássico de 20 segundos;
  157 objetos `1934/1976/1977` de `Field2722` recuperaram a segunda textura
  de céu `68` com coordenada de reflexão de câmera e `ADDSMOOTH`; o importador
  passou a incluir corretamente `EffectTextureList 67..70`, cujos arquivos
  vivem em `mesh/`, não em `Effect/`;
  os 817 flags `m_bAlphaObj` e as entradas genéricas
  `507..510/519/533..599` foram auditados como branches sem instância ativa
  nos setores/DAT deste corpus, portanto permanecem sem comportamento inventado;
  quatro hotfixes de altura de `TMObject::FrameMove` em `Field1916` foram
  aplicados somente aos meshes, preservando a máscara autoritativa;
  os 2.024 metadados `cAlpha` das texturas MSA passaram a fazer parte do
  manifest e do material de runtime, incluindo a exceção autoral `156..185`;
  `TMButterFly/TMFish/TMLeaf/TMTree/TMShip` recuperaram movimentos, ritmos e
  ANI por quatro poses instanciadas, a rotação adicional dos navios e as
  partículas `80` dos tipos de árvore `363..367`;
  `TMSea` recuperou os três perfis de UV/onda/material, incluindo as 14
  superfícies especiais com efeito `406` em `Field2922/2923`;
  confirmou ainda que `520..530`, `657/658` e `674` são deliberadamente
  invisíveis no cliente.
- Áudio: 333 SFX e 13 músicas estão no catálogo. Quatro referências não existem
  nos corpora usados e não devem receber substituto arbitrário.

## Procedimento seguro para novos imports

1. Identificar no binário/código clássico o índice, arquivo e regra de
   despacho; registrar a fonte no catálogo gerado.
2. Importar por script em `tools/`, com saída determinística no
   `public/game-data/classic` e referência no manifesto.
3. Carregar sob demanda. Geometrias/texturas compartilhadas pertencem à
   biblioteca; materiais mutáveis pertencem à instância.
4. Definir teto de pool/cache e `dispose()` antes de conectar o recurso ao
   loop. Cancelar resultados assíncronos obsoletos por geração.
5. Implementar estado local apenas quando ele é observável no cliente. Regras
   de dano, economia, party e autoridade permanecem no futuro servidor.
6. Rodar `bun run audit:coverage`, `bunx tsc --noEmit`, `bun run build` e a
   inspeção manual curta do cenário afetado.

## Ordem segura para continuar

1. Homologar visualmente a telemetria nova e coletar baseline de Armia:
   FPS/RAM/THREAD/GEO/TEX/CALLS/TRIS.
2. Testar o shutdown central em reload/pagehide real e bfcache Safari.
3. Medir o boot e a troca das quatro classes em desktop/iPhone para homologar
   os novos chunks e registrar a baseline real.
4. Homologar por amostragem as famílias de monstros/NPCs e as 16 montarias, em
   vez de manter todos residentes.
5. Voltar ao épico de skills somente com uma lista curta por lote, mantendo a
   regra de não cair em efeito genérico silencioso e separando passivas/regras
   de servidor de VFX realmente ausentes.
