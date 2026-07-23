# Memoria canonica do projeto WYD Web

Atualizado em 22/07/2026. Este documento preserva as descobertas e decisoes
tecnicas da reconstrucao. A fila executavel continua em `PENDENCIAS.md`; a
matriz gerada fica em `docs/matriz-cobertura-classico.md`.

## Objetivo e autoridade

O projeto recria do zero, em TypeScript e Three.js, o cliente classico 7.54 de
With Your Destiny. O codigo web anterior de `../tjs` nao e base de
implementacao. A ordem de autoridade adotada e:

1. Codigo recuperado/decompilado do cliente classico.
2. Binarios e assets do cliente classico.
3. Capturas comparativas do cliente original.
4. Aplicativo mobile extraido, apenas como fonte auxiliar e reduzida.
5. Fallbacks web explicitamente marcados, nunca apresentados como regra
   autoritativa.

Rede, servidor e suite automatizada de testes foram adiados por decisao do
projeto. Economia, sessao, ownership, drop tables, formulas de dano e regras
anticheat nao devem ser inventadas no frontend.

## Estado funcional consolidado

- 111 Fields conectados com streaming de terreno, objetos, minimapas e
  criaturas; Armia e o mapa inicial em `2100,2100`.
- Movimento por teclado, clique continuo e dois botoes; camera classica com
  rotacao e zoom amplo; A* com colisao e alturas caminhaveis.
- Modo `G` com velocidade 64, invencibilidade e bypass de colisao isolado do
  movimento normal.
- Quatro classes jogaveis, 14 montarias nivel 120, Griupan e oito evocacoes do
  BeastMaster em grupos offline de dez.
- NPCs e monstros com streaming antecipado, animacao, autonomia, separacao,
  selecao/outline, combate, morte, respawn e drops locais.
- HUD 7.54, chat local, overhead de nome/HP/balao, C.C, inventario, equipamento,
  cargo, lojas, skills, minimapa, seletor de mapas e telemetria.
- Catalogos importados: 6.500 itens, 248 skills, 377 templates de criaturas e
  3.937 geradores.

## Arquitetura resultante

| Camada | Responsabilidade |
| --- | --- |
| `src/core` | Leitura binaria e utilitarios sem Three.js |
| `src/formats/classic` | Parsers puros de TRN, MSH, MSA, WYS, DAT, BON e ANI |
| `src/assets` | Manifesto e acesso lazy ao pacote importado |
| `src/world` | Coordenadas WYD, Fields, streaming, altura, colisao e navegacao |
| `src/render` | Terreno, modelos, personagens, agua, objetos e VFX Three.js |
| `src/game` | Player, estado offline, criaturas, combate, montarias e itens |
| `src/ui` | HUD, janelas, tooltips, minimapa e telemetria |
| `src/app` | Composicao, input, loop, transicoes e ciclo de vida |
| `tools` | Importadores Bun reprodutiveis |

O navegador nunca le a instalacao original. Os importadores convertem/copiam o
corpus para `public/game-data/classic`; o runtime consome apenas esse pacote.

## Formatos e descobertas binarias

| Fonte | Uso atual | Observacao importante |
| --- | --- | --- |
| `Field*.trn` | terreno e tiles | 111 arquivos declarados |
| `Field*.dat` | objetos por Field | 108 declarados; ausencia nos demais e do manifesto |
| `m*.wyt` | minimapas | 103 declarados; nem todo Field possui um |
| `.wys` | malhas/objetos compostos | transformacao difere de personagem |
| `.msa/.msh` | objetos e meshes | 875 modelos de mapa no manifesto |
| `.bon/.ani` | skeleton e animacao | bancos nao podem ser cruzados entre rigs |
| `AttributeMap.dat` | flags globais de navegacao | inclui portal `0x10` |
| `object.bin` | mascaras de objeto | compoe colisao depois do AttributeMap |
| `SkillData.bin` | 248 skills | dados de apresentacao, nao formula de servidor |
| `ItemList.bin` | 6.500 itens | registro final auditado abaixo |
| `ItemPrice.bin` | overrides estaticos | preco nao autoritativo no frontend |
| `NPCGener.txt` + `npcdb` | templates/geradores/Carry | 377 resolvidos; `Tower_de_Thor` e alias comprovado de `Tower_of_Thor` |

Offsets confirmados neste corpus para o final do registro de `ItemList.bin`:
`unique@132`, `reserved@134`, `position@136`, `extra@138`, `link@140` e
`grade@142`. O layout antigo `position@134/grade@138` corrompia adicionais e
Ancient. A instancia conserva tres efeitos `STRUCT_ITEM`; efeitos estaticos nao
recebem escala de refino.

## Coordenadas, orientacao e terreno

O mundo logico WYD usa X/Y; Three.js usa X/Z. A conversao central vive em
`src/world/coordinates.ts`. O eixo visual que parecia invertido no primeiro
porte nao podia ser corrigido globalmente: personagens usam o espelhamento Z
do caminho skinned classico, enquanto `TMLeaf`, `TMTree` e `TMShip` usam
`TMSkinMesh` sem owner/type 1 e nao recebem esse mirror. Aplicar a regra de
personagem a objetos foi a causa das malhas deitadas e da grama deslocada.

As manchas de terra nao sao decals quadrados independentes: fazem parte da
composicao/blend do tile. A reconstrucao passou a preservar continuidade entre
vizinhos, evitando recortes em forma de tabuleiro. Bordas de Fields conectados
nao devem ganhar interpolacao inventada; a costura usa a mesma amostragem e
orientacao dos tiles de ambos os lados.

`AttributeMap.dat` e `object.bin` devem ser aplicados na ordem do cliente.
Pontes e plataformas fornecem camada de altura caminhavel propria. A ponte ja
foi homologada; nao reabrir sua colisao global sem regressao reproduzivel.

## Ambiente e efeitos de mapa

- Agua usa os cinco DDS classicos e geometria/altura do mapa. Fontes possuem
  arcos descendentes; deslocar UV lateralmente dava a impressao errada de agua
  movendo de um lado para outro.
- Fogueira tipo `501` usa frames `011..018`, alpha/cor/escala do
  `TMEffectBillBoard`. O DDS precisava da orientacao vertical correta; a
  inversao anterior fazia a chama aparecer separada ou abaixo da brasa.
- Cataventos, floats e objetos animados podem possuir partes skinned separadas;
  importar apenas a base remove componentes como a helice.
- `TMDust` tipo `531` não desenha sua MSA: é um emissor invisível que sorteia
  rajadas da textura `119` a cada `10 s`. Existem 1.189 registros em 28 Fields;
  o runtime os agrupa em um único `Points` por Field, preservando escala do DAT,
  queda de seis unidades, chance de 40%, streaming, descarte e a tecla `V`.
- Os dois portais `2035` acrescentam os billboards `423/424`; os três objetos
  `1846` possuem as coroas de fogo/brilho em raios `3` e `2,25`. O descritor
  `1980` aparece cinco vezes e é uma composição das malhas `1979/1980/1981`;
  a camada `1979` usa brilho, scroll U, offset `4,58/4,5` e escala vertical
  derivada da altura. `1979/1981` são dependências indiretas do importador.
- `TMHouse::Render` também compõe malhas que não aparecem no DAT. Os cinco
  portões `607` usam duas cópias de `608` e uma de `609`, contra-rotacionadas
  no ciclo de `20 s`; `614`, `1750`, `1739` e `1711` acrescentam,
  respectivamente, `615`, `1770`, `1771` e `1772`. São 430 bases afetadas.
  Essas dependências agora são importadas explicitamente e compartilham o
  mesmo lease/lifecycle de streaming da base.
- Os tipos `520..530` são criados como `TMEffectMesh`, mas o próprio
  `TMEffectMesh::Render` retorna sem desenhá-los. `657/658` são `m_bNullObj` e
  `674` não possui entrada utilizável. Eles devem continuar invisíveis.
- Partes pretas nao devem receber um plano generico. Preto pode significar
  asset ausente, alpha incorreto, agua/efeito nao carregado ou lado interno de
  geometria; diagnosticar pela origem antes de preencher.

## Streaming e desempenho

O terreno mantem margem base 28, antecipacao direcional de ate 60 e retencao
42. Criaturas entram a 56 unidades da borda e saem a 64. O objetivo e carregar
antes da entrada visual sem manter os 111 mapas em memoria.

O renderer principal e unico. Modelos, materiais e texturas usam bibliotecas
cacheadas e liberacao explicita. `GameApp.dispose()` encerra animation loop,
listeners, input, mundo, spawns, player, drops, preview, VFX, caches e renderer;
`pagehide.persisted=true` preserva o bfcache do Safari/iOS.

A HUD expoe FPS, heap JS quando suportado, proxy da callback principal e
`WebGLRenderer.info` (`GEO/TEX/CALLS/TRIS`). Safari nao expoe
`performance.memory`; em iPhone, os contadores GPU e a inspecao remota sao a
referencia. O perfil Apple mobile reduz pixel ratio, antialias e sombras e pode
decodificar DDS para RGBA na CPU.

O build separa Three.js em vendor cacheavel. Renderers de Foema, TransKnight e
BeastMaster sao chunks lazy carregados no primeiro switch; Huntress permanece
no boot por ser a classe inicial. Medicao de 23/07/2026: app ~544 KiB, Three.js
~518 KiB e chunks de classe na faixa de ~37–124 KiB, todos minificados.

O plano do servidor autoritativo está em
`docs/guia-servidor-multiplayer.md`. A fonte de servidor informada pelo usuário
não foi localizada no acervo disponível em 23/07/2026; o contrato clássico
comprovável vem de `Basedef.h`, `CPSock.cpp`, `TMSelectServerScene.cpp` e
`TMFieldScene.cpp`. O cliente antigo usa TCP 8281 e `INIT_CODE=521270033`; o
frontend web deverá usar HTTPS/WSS e manter um eventual gateway TCP legado
isolado do domínio.

A estimativa de abandono integral dos assets está em
`docs/estimativa-substituicao-assets.md`: 80–135 pessoa-mês para substituição
1:1, 120–200 para remaster fiel e 165–275 para redesign, com incerteza atual de
aproximadamente 35% até deduplicação e vertical slice.

## Personagem, equipamento e montarias

A Huntress padrao usa Mulher Kalintz, Skytalos Ancient +15 e Griupan. O
Skytalos e o item `2551`, mesh `762/bow16`, banco de arco `6` desmontado e `5`
montado, segunda textura `165` e UV U/V no ciclo classico de quatro segundos.
O passe Ancient segue `MODULATE2X + ADDSMOOTH`. Os adicionais atuais do Carry
de Utilidades sao `EF2=120`, `EF3=120`, `EF43=251`, grade 5; o tooltip calcula
`Dano de Perfuracao: 480`.

As skills Huntress promovidas ao runtime somam dezessete. Meditacao `#77` foi
recuperada de `TMHuman.cpp` como cinco pares de billboards `101` em espiral;
Escudo Dourado `#85` usa o mesmo `TMEffectLevelUp` tipo `1` do cliente, com
texturas `122/56/2/7`. Esses casts nao usam o pulso generico e seus buffs
mantem o override offline de `180 s`. Evasao Aprimorada `#89` usa cinco clones
skinned cinza da pose atual, com delays e vidas originais; montada, conserva a
regra de copiar apenas o animal. Troca de Espirito `#87` recupera
`TMSkillSpChange`: tres instancias skinned `86/wg01` seguem os bones `1/2` do
dono em `0/400/800 ms`, com o shade `7`, vinte particulas `231` e os tempos,
cores, crescimento e fade do motion type `10`. BON, ANI, as duas MSH e DDS
indiretas agora fazem parte do importador reproduzivel. Ilusao `#73` e uma
rota especial de movimento, nao um buff: o proximo clique resolve ate oito
passos navegaveis, clona por `3 s` a pose corrente completa na origem e
teleporta ao centro da celula confirmada. O portal tipo `2` conserva mesh
`703`, texturas `58/94`, cyan `0x0055FF`, pulso/rotacao e som `159`; montada,
a ilusao anima separadamente o rig do animal e o da cavaleira.

O footprint de inventário não deve ser inferido pela malha ou pelo ícone.
`SGridControlItem` lê `EF_GRID 33` dos três efeitos da instância e consulta
`g_pItemGridXY`: índices `0..7` significam `1×1` até `2×4`. Bolsa e cargo
agora preservam essa ocupação em add/move/swap/equip/transfer, inclusive
clique por célula secundária. `ItemList.bin` e os Carries do corpus atual não
possuem efeito `33`; logo o padrão legítimo continua `1×1` até um packet de
servidor fornecer outro índice.

Montarias conservam rig, partes, bancos ANI, escala e bone de sela proprios.
Nunca aplicar ANI de cavaleiro diretamente ao animal. A MATT3 da Huntress pode
referenciar indice 99, inexistente no `hs01`; nesse caso o animal fica em
`STAND01` e apenas o cavaleiro ataca. Deslocamento deve interromper o action
lock e selecionar movimento no cavaleiro e no animal no mesmo frame.

O Unicórnio padrao usa item `2381`, visual `336`, familia `hs01` em tres partes.
O Grifo conserva `bd02`; ao correr reutiliza apenas a curva vertical do Dragao
Vermelho, nunca o esqueleto dele.

## Combate, IA e regras offline

Monstros possuem autonomia independente da camera e separacao local para nao
se sobrepor. NPCs amistosos podem passear ate 2,25 unidades da origem; guardas
`RouteType 0` ficam parados. O outline de hover usa extrusao por normal depois
do skinning, pois escala pelo pivo desaparecia dentro de rigs multipartes.

O C.C possui modos desligado, fisico, magico e suporte. No continuo, procura um
hostil alem do alcance imediato e entrega a aproximacao ao A*. Alvos sem rota
entram em cooldown local de 1,5 s. O macro web ordenavel e uma extensao do
projeto; o cliente tambem possui o sistema `Y/m_cAutoAttack`, que e separado.

Chance critica offline: 35%. Cada level concede, provisoriamente, cinco pontos
de atributo e `+3 ATQ`. Buffs comuns duram 180 s; Mestre Carb renova os 32
estados reais identificados por 900 s. Esses valores sao politicas de frontend
ate o servidor substituir a simulacao.

As quests temporizadas Cemiterio e Cabuncle possuem um contador local abaixo
do minimapa, alinhado ao relogio em janelas globais de dez minutos. Cemiterio
usa os geradores `3606..3618` no retangulo `2381..2422 x 2078..2127`;
Cabuncle usa `3619..3628` em `2230..2255 x 1703..1725`. Os monstros desses
geradores nao adquirem o jogador fora da propria area e abandonam a perseguicao
quando ele sai. Isso e somente a protecao coerente possivel no modo offline:
no multiplayer, reset, inscricao na instancia e autorizacao de alvo pertencem
ao servidor. O Coveiro, gerador `3524` em `2375,2104`, carrega um segundo
billboard acima da placa de nome/HP com o mesmo contador do minimapa; ele muda
de verde para amarelo no ultimo minuto e atualiza a textura uma vez por segundo.
O corpus identifica a
`Vela_do_Coveiro #4038`, a `Varinha_do_Carbunkle #701` e o requisito textual
de dez varinhas; cobranca de entrada, drops e recompensa de EXP ainda nao
podem ser derivados como regras autoritativas.

## Inventario, comercio e drops

O inventario usa o recorte real `227x421`, quatro bolsas sobrepostas de `5x3`
e 15 slots de equipamento do `FieldScene2.bin`. O item permanece pequeno no
slot; clique seleciona o modelo 3D e o prende ao cursor ate o proximo clique.
Ha movimento, swap, merge, equipar e desequipar entre bolsas/equipamento/cargo.

O catalogo comercial contem 6.500 itens e os 27 slots Carry dos NPCs. Loja e
cargo abrem junto ao inventario e sao arrastaveis. Comprar, vender, saldo, Tax,
mix, quest e persistencia continuam bloqueados sem servidor.

Drops locais usam apresentacao `MSG_CreateItem/TMItem`, centro `+0,5`, altura
`+0,1`, rotacao em quartos, nome e brilho. `Espaco` coleta o vizinho alcancavel
e `Z` alterna nomes. O cliente usa distancia 1; o fallback web solicitado usa
alcance 3, mantendo segmento, altura e colisao. Pocoes HP/MP e Poeiras Ori/Lac
formam pilhas de ate 50. O renderer reconhece moeda (`EF_ITEMTYPE 38 = 2`),
decodifica `EF36:EF37` como valor de 16 bits e exibe `Bronze %d`, exatamente
como `TMItem::InitObject` e `Messages.txt[65]`; spawn, confirmacao e saldo da
moeda permanecem no servidor. TTL, ownership e drop tables sao dependencias
autoritativas.

## HUD, interface e chat

A composicao inferior segue a proporcao 7.54: trilho continuo, orbes nos
cantos, readout central, botoes C.C/MENU e barra de skills. `Enter` abre/envia
chat e `Esc` cancela. O frontend ecoa apenas localmente. Nome, HP e balao ficam
projetados acima do player; o balao dura 3 s ou 10 s com prefixo `*`.

Tooltips usam painel classico `240x270`, Tahoma 12, preto alpha e paleta do
`SGrid`. Eles mostram requisitos, efeitos, adicionais da instancia,
refinamento, Ancient e preco estatico quando aplicavel.

## Bugs importantes ja corrigidos

- Mundo/objetos invertidos e meshes deitados por mirror Z global incorreto.
- Tiles de sujeira desconectados por composicao tratada como decal quadrado.
- Miniaturas repetidas na grama por decodificacao/transformacao de objeto.
- Buracos pretos causados por alpha/efeitos/agua ausentes.
- Em `2164,2102`, um prop `type 444` de Field1616 em `height -2,8` carimbava
  `127` depois do deck da ponte em `height 0,1`. A composição ignora apenas
  esse mask enterrado, mantendo o objeto visual e a pista caminhável contínua.
- Fonte com UV lateral em vez de fluxo descendente.
- Fogueira com frames DDS invertidos verticalmente.
- Player passando sob pontes ou travando em celula isolada de corrimao.
- Clique para mover em zigue-zague por centros intermediarios crus do A*.
- Marcador verde permanente apos movimento.
- Monstros sobrepostos, sem autonomia ou andando de lado/costas.
- Montaria atacando/subindo junto com a animacao do cavaleiro.
- Inventario com preview popup e itens brancos em vez do fluxo 7.54.
- Offsets finais errados de `ItemList.bin`, que corrompiam adicionais/Ancient.
- Assets e renderers de todas as classes residentes no boot mobile.
- Listeners/caches sem shutdown central em unload real.
- Preview 3D do inventário acumulando uma instância/material por item
  selecionado; agora usa LRU de 12 entradas e devolve protótipos sem uso ao
  `ModelLibrary`.

## Limitacoes e riscos conhecidos

- Homologacao visual ainda e necessaria em 1024x768, widescreen e iPhone.
- O cache persistente inicial usa `precache-armia.json` e o service worker
  `/wyd-cache-sw.js`. O pacote atual contém 780 arquivos/32,9 MiB necessários
  ao primeiro cenário de Armia, tem chave derivada do conteúdo, valida quota,
  pede persistência, retoma entradas ausentes e pode ser interrompido ou limpo
  sem bloquear o fallback de rede. Os demais mapas continuam lazy. A
  homologação de expulsão/retomada em Safari/iPhone permanece manual; cache em
  disco reduz rede, mas não elimina parsing ou upload para GPU. Por isso, o
  boot mantém a tela opaca até o Field inicial concluir DAT, modelos, água,
  efeitos e visuais do jogador, e executa um primeiro render oculto antes de
  revelar Armia. O streaming dos demais Fields continua assíncrono.
- Reload real, bfcache e contadores GEO/TEX antes/depois de trocas pesadas
  precisam de baseline manual.
- Nem todas as 248 skills possuem definicao jogavel e renderer fiel; a matriz
  automatica mostra a cobertura por classe.
- Audio possui 333 entradas SFX e 13 musicas importadas. O `mguardatt.wav`
  faltante no desktop veio do cliente mobile por correspondencia exata de
  nome; quatro referencias seguem ausentes, sem substituicao aproximada. O BGM segue o
  roteamento classico, inicia desligado e `M` alterna apenas a musica. `B` e o
  menu alternam SFX separadamente, encerrando tambem vozes e loops ativos. Ataque,
  skill, impacto, level up e coleta usam IDs recuperados do cliente. Passos
  seguem os pares por piso de `TMHuman::AnimationFrame`; os 82 IDs distintos
  usados pelas acoes de NPCs/monstros no `AniSound4.txt` estao presentes e
  ligados, com atenuacao e limite de canais. Cachoeira, chuva local e o objeto
  ambiental 607 mantem loops por proximidade. Clima global fica condicionado
  a implementacao futura do sistema de weather, nao ao audio.
- Cobertura visual de todos os equipamentos, skins raros e acoes especiais de
  criaturas continua incompleta.
- WebGPU nao e substituto direto: shaders `onBeforeCompile` e materiais WebGL
  teriam de ser portados para TSL/nodes.
- JavaScript distribuido no navegador pode ser dificultado, mas nunca mantido
  secreto. Regras autoritativas devem viver no servidor.
- Os assets classicos podem ter restricoes de direitos; distribuicao publica
  exige autorizacao.

## Decisoes rejeitadas ou adiadas

- Reutilizar o projeto web anterior: rejeitado; a reconstrucao parte do zero.
- Tratar o cliente mobile como fonte principal: rejeitado por ser reduzido.
- Migrar imediatamente para WebGPU: adiado por custo e incompatibilidade dos
  shaders atuais.
- Inventar compra, economia, drops e formulas no frontend: rejeitado.
- Reabrir globalmente a ponte ja homologada: rejeitado sem regressao nova.
- Teleporte livre de portal no mock: rejeitado porque autorizacao/custo/mapa
  pertencem ao servidor.

## Procedimentos reprodutiveis

Instalar e rodar somente com Bun:

```bash
bun install --frozen-lockfile
bun run dev
bun run build
```

Reconstruir todos os assets:

```bash
bun run import:all -- "/caminho/Origem" "/caminho/tools/data"
```

Gerar a matriz auditavel depois de qualquer import ou promocao de classe:

```bash
bun run audit:coverage
```

Validacao tecnica usada enquanto a suite automatizada permanece fora do
escopo:

```bash
bunx tsc --noEmit
bun run build
git diff --check
```

O build atual avisa que Node 20.18 e menor que o minimo pedido pelo Vite
7.3.6 (20.19 ou 22.12). O build ainda conclui via Bun, mas o ambiente deve ser
atualizado para remover a divergencia.

## Historico resumido

- Mundo: import de 111 Fields, orientacao, terreno, objetos, conexoes e
  streaming.
- Ambiente: agua, fontes, fogueiras, grama, partes animadas e colisao de ponte.
- Entidades: criaturas, IA, separacao, NPCs, hover e interacoes.
- Player: Huntress, trajes, Skytalos Ancient, Griupan e montarias nivel 120.
- Gameplay: combate, critico, C.C, skills iniciais, buffs, progressao e drops.
- UI: HUD 7.54, chat, overhead, inventario/equipamento/cargo/lojas e tooltips.
- Classes: TransKnight, Foema, BeastMaster, Huntress e evocacoes.
- Skills: Ilusao `#73`, Meditacao `#77`, Escudo Dourado `#85`, Troca de
  Espirito `#87` e Evasao Aprimorada `#89` promovidos no lote Huntress. No
  TransKnight, Carga `#8`, Golpe Mortal `#10` e Contra Ataque `#18` preservam o
  branch sem projetil, com som `160` e quake `2`; Assalto `#11` usa billboards
  `56/60`; Espada da Fenix `#12` reutiliza o DoubleSwing nivel `1`; Possuido
  `#13` separa o burst type `4` da armadura critica persistente `2838/413`;
  Punhalada Venenosa `#21` usa as dez particulas, tempos, cor e som do
  `TMSkillPoison`, mantendo o `TickType 20` como regra futura do servidor;
  Furia Divina `#6` segue o alvo com os cinco segmentos do `TMEffectSpark`;
  Destino `#7` cria uma `TMArrow` type `10001` por alvo, com modelo `2840`,
  beam, wake, impacto e som final do cliente; Fanatismo `#4` cria snapshots
  skinned da pose corrente a cada `300 ms`; Espada Flamejante `#17` acompanha
  a matriz viva da arma e porta o `m_cFireEffect` azul; Ataque da Alma `#20`
  clona o rig/LOOK real do alvo, sobe e desvanece por `3 s`. Na Foema, Flecha
  Magica `#24` porta o controller type `0`, modelo `701`, frames `20-25`,
  particulas, shades, impacto e sons; Choque Divino `#28` porta o
  `TMSkillDoubleSwing` nivel `2`, modelo `12`, textura `91`, nucleos
  `56/2/60`, shade `7` e trail `0`; Flash `#26` porta os quatro pilares `58`,
  planos `93/2`, shade `7` e o despacho imediato; Recuperar `#29` porta as
  doze particulas azuis `56`, shade `7`, som `158` e aplica somente o
  `InstanceValue=150` ao jogador no mock offline; Julgamento Divino `#30`
  porta o `TMSkillJudgement` type `0`, modelo `10`, aneis `124`, som `38` e
  despacho imediato; Cura `#27` reutiliza o `TMSkillHeal` e cura
  `InstanceValue=100` no alvo self aceito pelo `TargetType 2`; Desintoxicar
  `#25` porta as 21 partículas, shade e som do `TMSkillCure`, sem inventar
  estado negativo no player. A auditoria agora separa corretamente os 144
  registros por semântica: 87 estão no runtime, 49 são passivos de catálogo e
  8 são casts/buffs realmente pendentes. Extração `#83` e Alquimia `#84`
  preservam o fluxo de item do cliente: a primeira seleciona/confirma um item
  da bolsa, e a segunda abre as receitas reais de `Mixlist.bin` no atlas
  `NewItemMix`; nenhuma delas inventa consumo ou resultado sem servidor.
  Toxina de Serpente `#92` também está no catálogo jogável, mas conserva a
  rejeição anterior ao gasto de mana de `TMFieldScene::SkillUse`: requer
  `EF_WTYPE 41` (garras), enquanto o Skytalos padrão é `WTYPE 101`. O
  `Affect 36` não cria objeto visual em `TMHuman::CheckAffect`; o runtime
  mantém somente estado/ícone quando uma garra compatível existir.
  Os oito casts ainda bloqueados ficam centralizados em
  `ClassSkillBlockers.ts`; o menu `K` e `audit:coverage` consomem a mesma
  tabela para expor claramente a fronteira de party/PvP/economia/servidor.
  Perseguição `#16` porta
  `TMSkillSlowSlash` tipo `0`, textura `2` e som `167`; Exterminar `#22` porta
  `TMSkillBash`, os pulsos `TMSkillSpeedUp`, a explosão radial e o fogo
  `texture 33`, com pools limitados. Proteção Divina `#200` completa os casts
  do TransKnight como buff de estado `Affect 6 / m_bShield2`; o cliente não
  despacha VFX para índices master, portanto nenhum efeito genérico foi
  inventado. A mesma regra recuperada promoveu Proteção Absoluta `#213`
  (`Affect 6`) e Magia Misteriosa `#216` (`Affect 42`) da Foema como buffs de
  estado sem VFX fictício. Anti Magia `#224`, Chama Resistente `#225` e Last
  Resistance `#235` seguem o mesmo contrato master no BeastMaster: estado,
  tick e fórmula autoritativa permanecem separados da apresentação.
  As cinco transformações BeastMaster também estão no runtime:
  `#64/#66/#68/#70/#71` resolvem respectivamente as skins
  `44/45/47/53/54` e as famílias `BL01/LB01/DD01/SP02/MM01`, usando
  `BoneAni4`, `ValidIndex` e `AniSound4`. A forma substitui o rig equipado,
  mantém locomoção/ataque/morte, é mutuamente exclusiva, impede montar e
  respeita o bloqueio clássico de trajes `4150..4199`; Titã conserva a escala
  `2.0` imposta em `TMHuman::InitObject`. A `Invocação Final #229` carrega
  `InstanceType=11/Value=9`, mas o cliente não contém o mapa desse valor para
  LOOK/NPC: ele recebe a entidade já resolvida via `MSG_CreateMob`. Não criar
  uma invocação substituta sem a tabela do servidor.
- Backend futuro: a ultima tarefa da fila deve inventariar o servidor-base e
  produzir o guia de um multiplayer autoritativo, sem ativar rede durante o
  escopo frontend atual.
- Distribuicao: README, capturas dos 111 mapas, Vercel/iPhone, minificacao,
  telemetria, dispose e code splitting.
- Auditoria: matriz automatica de arquivos/cobertura e memoria canonica.

## Documentos relacionados

- `PENDENCIAS.md`: fila obrigatoria e estado de homologacao.
- `docs/auditoria-threejs-cobertura.md`: auditoria tecnica e ordem segura.
- `docs/matriz-cobertura-classico.md`: snapshot gerado automaticamente.
- `docs/architecture.md`: limites resumidos das camadas.
- `README.md`: guia para usuario, controles, imports e deploy.

Este arquivo deve ser atualizado quando uma descoberta muda a interpretacao
de um formato, uma regra deixa de ser mock, uma limitacao e removida ou uma
decisao estrutural passa a afetar os proximos lotes.
