# Memoria canonica do projeto WYD Web

Atualizado em 23/07/2026. Este documento preserva as descobertas e decisoes
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
- Quatro classes jogaveis, 16 montarias nivel 120, Griupan e oito evocacoes do
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
| `.msa/.msh` | objetos, efeitos e armas rígidas | 963 modelos no manifesto |
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
- `TMSea::FrameMove` possui três perfis, não um scroll genérico. A água
  externa mantém UV1 estático e move somente V de UV2; dungeon usa escalas
  `1,8/1,2`, texturas `8/9` e base de onda própria para o modo `2`. A região
  especial dos Fields `28/29 × 22/23` usa a textura de efeito `406`, UVs
  `9,5/3,8` em eixos distintos e onda visual de `0,9`. Os materiais agora
  separam esses caminhos, enquanto os seis DDS físicos de água/efeito são
  deduplicados no carregador.
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
- As casas `TMHouse` `251..254` usam a malha seguinte (`tipo + 1`) como teto,
  embora essa segunda malha não apareça no DAT. Em Armia há bases `251` em
  `2102,2114` e `253` em `2072,2110`, portanto os tetos reais são `252/254`.
  `TMObject::IsInHouse` consulta o bit `0x08` do `AttributeMap.dat`: o teto
  desaparece dentro da construção e fica translúcido a menos de seis unidades.
  O runtime replica a regra usando o atributo autoritativo já residente, com
  materiais próprios por teto e descarte junto ao Field. A proximidade não usa
  uma opacidade inventada: traduz `SRCBLEND=ONE/DESTBLEND=DESTCOLOR` do D3D9
  para `CustomBlending` do Three.js.
- O tipo `1855` é outro branch de proximidade de `TMHouse`: existem 52
  registros e, a menos de seis unidades, ele ativa o par clássico
  `ONE/INVSRCALPHA`. Cada instância recebe material próprio somente porque o
  estado muda por posição; geometria e texturas continuam compartilhadas.
  `TMHouse 610` referencia `611/612`, mas não existe registro `610` em nenhum
  dos 108 DAT deste corpus, portanto não há instância ativa a completar.
- `TMHouse::FrameMove` acrescenta partículas à água sem alterar sua malha:
  52 fontes ativas (`195/273/274/697/699/1993`) usam o billboard `151` a cada
  `200 ms`; 225 cachoeiras ativas (`292/490/1526/2005`) usam dois ou quatro
  bocais em intervalos de `100/300 ms`. Os 40 objetos `1520`, 112 `1535` e
  nove `1695` configuram contagem zero, enquanto os 20 `1665` retornam antes
  da emissão — não se deve inventar respingo neles. Os cinco `607` geram cinco
  billboards e cinco partículas por pulso, alternando a textura/cor no modo
  dungeon `2`. O runtime agrupa tudo em `Points` por Field, com ciclo,
  duração, posições e crescimento provenientes dos parâmetros do cliente,
  lifecycle de streaming e visibilidade controlada por `V`.
- `TMObjectContainer` mantém a base opaca de `1528`, `1540..1543` e `1597`,
  mas acrescenta, respectivamente, overlays `1555..1559` e `1598` via
  `TMEffectMesh`. São 697 bases afetadas. Os seis modelos indiretos agora são
  importados explicitamente e usam o RGB `0x223333`; o alpha vem da textura,
  como no `D3DTSS_ALPHAARG1=TEXTURE`, e não do byte alpha zero do literal.
- Os tipos `1549/1550/1551` são 62 `TMBike`. Eles não ficam estáticos: a cada
  ciclo de `20 s`, `sin(progress)` desloca a instância até `±3` unidades no
  eixo lógico Y quando o ângulo está próximo de `0/π/2π`, ou no eixo X nos
  demais ângulos. A conversão para Three.js inverte somente o deslocamento de
  Y para Z; geometria/material continuam compartilhados e o Field controla o
  lifecycle.
- `TMObject::Render` aplica um segundo estágio somente aos tipos
  `1934/1976/1977`. Existem 157 instâncias, todas em `Field2722`, região que
  `TMFieldScene` força para o clima de neve: a transição `SetWeatherState(11)`
  fixa `TMSky::m_nTextureIndex` em `68`, correspondente a
  `mesh/sky02.wys`. O estágio usa `D3DTCI_CAMERASPACEREFLECTIONVECTOR`,
  transformação 2D e `D3DTOP_ADDSMOOTH`; o runtime reproduz a reflexão
  esférica no shader do material Lambert e conserva o mapa-base. Os materiais
  clonados pertencem à instância e são descartados no unload; geometria,
  mapa-base e textura de céu continuam compartilhados.
- `EffectTextureList.bin` não referencia somente `Effect/`: os índices
  `67..70` apontam para `mesh/sky01..04.wys`. O importador antigo resolvia
  todos os nomes dentro de `Effect/` e descartava silenciosamente os quatro.
  A resolução agora respeita a pasta declarada pelo registro; os quatro DDS
  entram no manifesto de forma determinística.
- Cada MSA pode ter vários materiais, mas `TMObject::Render` decide o estado de
  alpha pelo `cAlpha` do primeiro índice de textura e aplica esse estado ao
  `TMMesh` inteiro. O importador agora persiste os 2.098 slots encontrados em
  `MeshTextureList.bin` (`1.875 N`, `148 A`, `10 C`, `65` sem entrada); entre
  os primeiros slots dos 963 modelos são `827 N`, `87 A`, `2 C` e `47` sem
  entrada. `ModelLibrary` replica essa decisão: `A/C` recebem alpha-test
  `0xAA/0xFF` e blend `SRCALPHA/INVSRCALPHA`; `N` permanece opaco. A faixa
  `156..185` continua no caminho alpha por exceção explícita do cliente,
  mesmo usando DXT1 marcado como `N`.
- A ambientação especial do DAT não é uma coleção de MSA estática.
  `TMButterFly` e `TMFish` criam cinco indivíduos por registro, com movimento,
  raio, fase, escala e orientação próprios. `TMLeaf`, `TMTree`, `TMShip`,
  borboletas e peixes usam ANI mesmo sem tabela de ações nomeadas. Para manter
  o instancing, o runtime amostra quatro poses do BON/ANI por protótipo e
  interpola o ciclo na GPU; isso substituiu o vento/balanço genérico. Os ritmos
  vêm de `m_dwFPS`: folhas/árvores `80 ms`, navios/peixes `30 ms` e
  borboletas `4/8/10/15 ms` conforme o tipo. `TMShip::InitAngle` ainda soma
  `90°`; os tipos de árvore `363..367` emitem o billboard `80` nas três
  alturas/cores recuperadas e obedecem à tecla global de efeitos.
- O flag `m_bAlphaObj` aparece em 817 registros, porém eles estão apenas nos
  Fields `2824/2823/2822/2611/2821/3026/2923/2922/2723/2722/2608`. Nenhum
  satisfaz os setores restritos do raycast de câmera do cliente
  (`31,31`, `17..19,30..` ou `13/14,28`), logo o branch é inerte neste corpus.
  De modo semelhante, não existe registro DAT de
  `507..510/519/533..599`; não instanciar suas entradas de MeshList por
  suposição.
- `TMObject::FrameMove` corrige quatro alturas visuais em `Field1916`:
  `454@2540,2082`, `443@2540,2086`, `454@2542,2090` e
  `449@2540,2094` passam para `height 0`, apesar dos valores DAT entre
  `1,175` e `1,925`. A correção acontece depois do registro da máscara no
  cliente; portanto o runtime altera somente a posição do mesh e preserva a
  altura original para navegação/colisão.
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

`ModelLibrary` separa ownership de protótipo e DDS. As 963 MSA possuem 2.098
slots de material, mas só 419 arquivos de textura físicos; o cache usa o
caminho do DDS como chave, mantém uma referência por modelo distinto que o
consome e descarta a textura somente após o último `release`. Materiais e
geometrias continuam por protótipo, pois alpha, shader e outros estados podem
ser específicos do tipo/instância.

A HUD expoe FPS, heap JS quando suportado, proxy da callback principal e
`WebGLRenderer.info` (`GEO/TEX/CALLS/TRIS`). Safari nao expoe
`performance.memory`; em iPhone, os contadores GPU e a inspecao remota sao a
referencia. O perfil Apple mobile reduz pixel ratio, antialias e sombras e pode
decodificar DDS para RGBA na CPU.

O build separa Three.js em vendor cacheavel. Renderers de Foema, TransKnight e
BeastMaster sao chunks lazy carregados no primeiro switch; Huntress permanece
no boot por ser a classe inicial. Medicao de 23/07/2026: app ~600 KiB, Three.js
~518 KiB e chunks de classe na faixa de ~37–124 KiB, todos minificados.

O plano do servidor autoritativo está em
`docs/guia-servidor-multiplayer.md`. O projeto não possui servidor-base; o
contrato clássico comprovável vem de `Basedef.h`, `CPSock.cpp`,
`TMSelectServerScene.cpp` e `TMFieldScene.cpp`. O cliente antigo usa TCP 8281
e `INIT_CODE=521270033`; o frontend web deverá usar HTTPS/WSS e manter um
eventual gateway TCP legado isolado do domínio.

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

Os 34 trajes temporários `4150..4183` foram transcritos integralmente de
`TMHuman::SetHumanCostume`, `TMSkinMesh::SetOldCostume` e `SetCostume`. A
tabela compartilhada registra as seis partes, textura, alpha e
`m_nSkinMeshType` e pode ser usada pelas quatro classes. Isso importa casos
como Yin-Yang, Esqueleto, Valquíria, Romano, Kalintz, Feiticeira, Draco,
Natal/Rudolph, Militar, Oculto e a faixa `4167..4183`. Como alguns trajes usam
mesh `ch01` com skin efetiva `1`, não se deve inferir o rig pelo nome do
arquivo: animação e attachment da arma devem obedecer `skinOverride`. O
sincronizador de equipamento sempre recarrega a classe ativa; usar Huntress
fixa nesse caminho é uma regressão.

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

O corpo/armadura dos 377 templates vem das partes skinned de `LOOK_INFO`, mas
`Equip[6]` e `Equip[7]` são armas MSA rígidas. O importador agora lê também
`EF_WTYPE 21`, inclui no manifesto os 76 tipos de arma efetivamente usados e
prende cada clone aos índices exatos de `g_dwHandIndex[skin][0/1]`. São 224
templates armados e 269 attachments no catálogo atual; `WTYPE 41` duplica a
garra esquerda na mão direita para `Demo_Gorgon` e `Kalintz(H)`, como
`SetPacketEquipItem`, e também ativa a matriz rotacionada da segunda mão.
`CheckWeapon` não usa somente `EF_WTYPE 21`: a ability 17 vem do campo dedicado
`nPos/position@136`. A combinação tipo/posição agora escolhe o banco ANI exato
dos rigs `ch01/ch02/or01/mi01`, incluindo escudo, duas mãos, arco e cajado.
Esses leases pertencem ao ator e são liberados junto do streaming. A escala
aplica `TMHuman::SetCharHeight` e o fator adicional `0,9`
de `OnPacketCreateMob` quando `Equip[0] < 40`. A orientação inicial não é
aleatória: usa o nibble alto de `SCORE.Reserved` e o sinal invertido passado
por `TMHuman::SetAngle`; a rota assume a direção somente quando o ator começa
a andar.

`Equip[15]` representa uma malha auxiliar, não uma parte do corpo. Para as
skins aceitas por `TMHuman` (`0/1/2/3/8`), 50 templates carregam a família
`mt01`/skin `85`: `mt010101.msh`, `mt01.bon`, cinco ANI e seis variantes de
textura. A `m_OutMatrix` usada como base vem dos bones `6` (skins 0/1), `7`
(skin 2), `9` (skin 3) e `16` (skin 8). A mantua usa ANI `0/1/2` para
parada/caminhada/corrida, período de `40 ms` e rotação
`yaw=-90°/pitch=-180°`. Ela é criada e descartada pelo mesmo streaming do
ator. O fonte recuperado contém duas leituras indefinidas: declara apenas
`fMantuaList[4][20]`, mas seleciona linhas 5–8, e tenta reduzir coat mesh 90
uma única vez. O port usa linha-base para a classe posterior sem tabela e
normaliza esse mesh pelo slot módulo 40; não reproduzir leitura de memória
fora do limite foi uma decisão deliberada.

Há 14 templates montados no `npcdb`. Para itens legados `2330..2389`,
`BASE_GetItemAbility(EF_MOUNTHP)` devolve o `short` little-endian formado por
`stEffect[0].cEffect/cValue`; procurar um efeito 80 no `ItemList` daria o
resultado errado. Todos os 14 têm HP positivo e resolvem seis looks:
Javali, Dragão Menor, Cavalo Leve N, Andaluz N, Fenrir das Sombras e
Svadilfari. O runtime instancia o animal no mesmo lease pool, aplica
`m_fScale * m_fMountScale`, ancora o corpo no `m_OutMatrix`/seat bone e usa as
ações montadas do cavaleiro (`MSTND`, `MWALK`, `MATT`, `MSTRIKE`, `MDIE`) em
sincronia com as ANI do animal. O yaw pertence ao animal; capa e armas seguem
o rider. Cavalo Leve N e Andaluz N acrescentaram os looks visuais 323/325 e
seus arreios `hs010304/hs010306`, levando o seletor compartilhado a 16
montarias sem criar outra família de rig.

`Equip[13]` possui um branch visual específico que não deve ser confundido
com o Griupan do jogador. Quatro templates (`Cav. Mortal`, `Gárgula Sábio`,
`Redmiron` e `Verdes`) carregam o item `769`, que cria Nyerdes como
`TMEffectSkinMesh` level 4: skin `32/ag01`, LOOK `1/0`, malha
`ag010102`, escala `1,2`, ação `RUN` e motion type `5`. O familiar fica
`0,3` unidade atrás, orbita em raio `0,1` a cada segundo e oscila
verticalmente sobre `2 × escala do dono`. A cada frame clássico ele emite a
textura de efeito `0`, cor `0xFFAAFFEE`, vida `1,5 s`, velocidade vertical
`-0,5` e uma das cinco dimensões autoradas. O runtime preserva o resultado com
um único batch instanciado de até 512 billboards. `g_bHideEffect` não oculta
os levels 3–6: por isso `V` desliga somente o rastro de Nyerdes, nunca sua
malha.

Os efeitos intrínsecos das criaturas não estão no `npcdb`: são uma cadeia de
condições em `TMHuman::RenderEffect`. Seus pontos não são centros genéricos do
ator. `CFrame::UpdateFrames` escreve `m_vecTempPos[0..10]` a partir de bones e
offsets distintos para cada `m_nBoneAniIndex`. A tabela exata dos rigs
`0/1/2/4/6/7/8/20/25/26/28/29` foi portada para
`ClassicMonsterPersistentEffects`. No corpus atual, 61 templates usam
billboards persistentes (caveiras, olhos, golems, demônios e elfos com
mantua), enquanto 56 satisfazem emissores aditivos/default de dragões,
minotauros, golems, ursos, javalis/lobos, elfos, trolls ou orcs. Texturas
sequenciais são trocadas a cada
`80 ms` como `m_nCycleIndex`, e todos os quads são agrupados por textura em
instancing global. A pool transitória é limitada a 2.048 partículas.

Há uma inconsistência real no branch do Dragão Esmeralda: a criação preenche
`m_pEyeFire[8/9]`, mas `RenderEffect_EmeraldDragon` consulta
`m_pEyeFire2[1/2]`, que não recebe valor em nenhum outro ponto do fonte
recuperado. O port não inventa uma ligação entre esses arrays; conserva
somente a partícula cinza executável desse branch.

O `TMShade` de Troll/Zumbi é uma geometria horizontal distinta do billboard.
O runtime usa um segundo batch instanciado com grid de quatro unidades,
textura `89`, rotação em passos de `π/6`, cor `0xCCCCCC`, vida `3 s` e a
curva `bFI=0` (`cos(progress·π/2)`). Gárgulas de classe `33` também respeitam
a condição original de dungeon tipo 2 (`row > 25` e `8 < column < 16`):
sete pontos, ciclo `101..108`, escala `2×3` e pulso entre `0,7..1`.

Dois branches continuam deliberadamente bloqueados por evidência
insuficiente. `TMButterFly(6,3,owner)` é criado por 16 templates, mas seu
construtor sobrescreve `m_fParticleH` e jamais inicializa
`m_fParticleV`, lido em todos os movimentos. Os seis Krill em `ATTACK02`
tentam usar `m_vecTempPos[1]`, embora o rig `22` escreva apenas o ponto zero.
Não preencher esses casos com valores visuais arbitrários. O terceiro caso
anterior, `Guer_Caveira`, foi resolvido pelo port dedicado dos sete
`TMEffectMeshRotate` e deixou de fazer parte deste bloqueio.

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
  `/wyd-cache-sw.js`. O pacote atual contém 815 arquivos/33,4 MiB necessários
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
- O `Guer_Caveira` é o único template do corpus que satisfaz o branch de
  `TMEffectMeshRotate` de `TMHuman`: class `36/37`, helm mesh `10` e arma
  esquerda diferente de mesh `930`. Ele usa sete escudos ósseos common mesh
  `3,6,4,7,5,6,7`, órbita de `1 s`/raio `1`, fases de `150 ms`, rotação
  própria em dobro e fogo vermelho `11..18` em quadros de `80 ms`. O runtime
  compartilha os cinco modelos e oito DDS, mantendo somente os clones por ator.
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
- Backend futuro: não existe servidor-base. O guia de multiplayer autoritativo
  parte somente do protocolo comprovado no cliente e de decisões modernas
  explicitamente rotuladas, sem ativar rede durante o escopo frontend atual.
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
