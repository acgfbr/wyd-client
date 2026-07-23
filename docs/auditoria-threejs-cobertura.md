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
  aproximadamente 504 KiB e o vendor Three.js em 518 KiB. Huntress permanece
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
| Huntress | Mulher Kalintz, Skytalos Ancient +15, Griupan, 17 skills promovidas | `HuntressLooks`, `ClassicHuntressSkillEffects`, `ClassicAlchemyCatalog`, `ClassicLevelUpEffects` | 17 passivas e 2 casts ainda fora do runtime |
| Montarias | 14 montarias nível 120, Unicórnio padrão, sela/bones | `MountLooks`, `ClassicMount` | Homologação visual de todas as variações |
| NPCs/monstros | Spawn por Field, animação, hover/seleção, IA offline, drops | `MonsterCatalog`, `ClassicSpawnManager` | Cobertura de todos skins/itens/ações especiais |
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
- Classes/equipamentos: as quatro classes e seus looks base são jogáveis, mas
  a cobertura visual 1:1 de todos os `LOOK_INFO` e combinações dos 6.500 itens
  ainda não existe. O próximo import deve partir de `ItemList.bin` e das regras
  de slot/mesh do cliente, não de uma lista manual de skins.
- Monstros/NPCs: os 377 templates e 3.937 geradores estão catalogados e entram
  no streaming. A lacuna é validar famílias visuais e ações especiais por
  template; não faltam apenas arquivos. Casos com skin incorreta devem ser
  corrigidos no catálogo/importador para beneficiar todos os spawns.
- Itens: os 6.500 registros, preços, carries e ícones estão importados. Ainda
  são sistemas de servidor: propriedade real do drop, compra/venda, economia,
  persistência e validação. `EF_GRID` multicélula já é respeitado por
  bolsa/cargo, e moedas `EF_ITEMTYPE 2` já têm leitura/etiqueta clássica; a
  criação, coleta e alteração de saldo continuam corretamente no servidor.
- Mapas: os 111 TRN existem; 108 DAT e 103 minimapas são exatamente os
  declarados pela fonte. O aberto é homologação visual dos mapas e dos raros
  objetos com comportamento próprio, não uma importação em lote ausente.
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
4. Homologar por amostragem as famílias de monstros/NPCs e as 14 montarias, em
   vez de manter todos residentes.
5. Voltar ao épico de skills somente com uma lista curta por lote, mantendo a
   regra de não cair em efeito genérico silencioso e separando passivas/regras
   de servidor de VFX realmente ausentes.
