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

## Riscos técnicos abertos

- O shutdown central existe, mas ainda precisa de teste visual/manual de
  navegação/reload e inspeção dos contadores `GEO/TEX` antes/depois de trocas
  pesadas de mapa/classe.
- Alguns efeitos de skill possuem pools próprios e modelos/texuras dedicados;
  a matriz completa deve confirmar que cada pool tem limite, cleanup de mapa e
  cleanup de troca de classe.
- O chunk de produção está grande. A distribuição atual é aceitável para o
  protótipo, mas o build final deve considerar code splitting por classe,
  renderer de skill e catálogos.
- `performance.memory` não existe no Safari/iPhone, então RAM JS aparece como
  `—`; para iOS, usar GEO/TEX/CALLS/TRIS e inspeção remota.
- WebGPU não é alternativa atual: o runtime depende de materiais Three.js
  customizados via WebGL e shaders `onBeforeCompile`; migrar exigiria portar
  esses caminhos para outro pipeline.

## Matriz de cobertura

| Subsistema | Cobertura atual | Fonte/rastro | Aberto |
| --- | --- | --- | --- |
| Mapas/Fields | 111 Fields, streaming, conexões, minimapas, seletor | `manifest.json`, `Field*.trn`, `regions.ts` | Revisão visual final dos 111 mapas |
| Terreno/colisão | TRN, AttributeMap, object.bin, pontes/altura, pathfinding | `ClassicWorld`, `ClassicNavigation` | Casos isolados de máscara/altura que aparecerem em teste |
| Objetos/props | DAT/WYS/MSH, água, folhas, fogueiras, fontes, floats | `MapObjects`, `MapWater`, `ClassicEnvironmentObjects` | Homologar pontos de grama e objetos raros |
| Personagem | Quatro classes jogáveis, rigs, traje base, arma, montaria/familiar | `PlayerClasses`, `ClassicPlayerAvatar` | Cobertura completa de equipamentos visuais por classe |
| Huntress | Mulher Kalintz, Skytalos Ancient +15, Griupan, buffs principais | `HuntressLooks`, `ClassicHuntressSkillEffects` | Matriz completa das skills restantes |
| Montarias | 14 montarias nível 120, Unicórnio padrão, sela/bones | `MountLooks`, `ClassicMount` | Homologação visual de todas as variações |
| NPCs/monstros | Spawn por Field, animação, hover/seleção, IA offline, drops | `MonsterCatalog`, `ClassicSpawnManager` | Cobertura de todos skins/itens/ações especiais |
| BeastMaster summons | 8 evocações, 10 por cast, IA offline | `BeastMasterSummons`, `ClassicBeastMasterSummon` | Trocar IA local por packets autoritativos no futuro |
| Inventário/equipamento | UI 7.54, bolsas, equip/unequip, cargo, preview 3D | `GameHud`, `ClassicInventoryPreview` | Compra/venda/economia somente com servidor |
| Itens/comércio | 6.500 ItemList, ItemPrice, Carry de NPC, tooltips clássicos | `ClassicCommerceCatalog`, `ClassicItemTooltip` | Footprint multicélula EF_GRID e ownership de drops |
| HUD/chat | Orbes, C.C., menu, chat local, overhead name/HP/balão | `main.ts`, `GameHud`, `ClassicPlayerOverheadHud` | Homologar 1024x768, widescreen e iPhone |
| Skills/VFX | Vários lotes por classe implementados; skills não citadas bloqueadas | `ClassSkills`, `render/effects` | Épico de skills completo continua aberto |
| Áudio | Fora do runtime atual | n/a | Importar sons e tocar eventos originais |
| Rede/servidor | Deliberadamente fora do escopo atual | n/a | Sessão, economia, dano autoritativo, drops reais |

## Ordem segura para continuar

1. Homologar visualmente a telemetria nova e coletar baseline de Armia:
   FPS/RAM/THREAD/GEO/TEX/CALLS/TRIS.
2. Testar o shutdown central em reload/pagehide real e bfcache Safari.
3. Gerar uma tabela automática de cobertura por arquivo importado: mapas,
   monstros, player, montarias, itens, UI e skills.
4. Separar code splitting por classe/skill apenas depois da matriz mostrar
   quais assets são realmente carregados no boot.
5. Voltar ao épico de skills somente com uma lista curta por lote, mantendo a
   regra de não cair em efeito genérico silencioso.
