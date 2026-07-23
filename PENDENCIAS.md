# WYD Web — fila de reconstrução

Esta é a fila canônica do projeto. Itens visuais e regras de jogo só são
considerados fiéis quando possuem uma origem rastreável no cliente clássico.

## Baseline confirmada

- 111 Fields importados e conectados; terreno/objetos entram por streaming.
- WYT/WYS/TRN/DAT/MSA/MSH/BON/ANI possuem parsers próprios no runtime.
- `AttributeMap.dat` e `object.bin` compõem a máscara de colisão na ordem do
  cliente; pontes e plataformas também fornecem altura caminhável.
- NPCs/monstros têm streaming por Field, animação, autonomia, separação,
  combate, morte, respawn e EXP. O drop offline deixa uma instância 3D no chão
  e só entra no inventário depois do fluxo de coleta confirmado; `Espaço`
  coleta o vizinho alcançável mais próximo e `Z` alterna todos os nomes. NPCs
  amistosos de rota curta fazem um passeio offline determinístico de 1–1,75 unidade,
  sempre contido em 2,25 unidades da origem; guardas `RouteType 0` permanecem fixos.
- Clique para mover usa rota com desempate estável, remoção segura dos centros
  intermediários visíveis e interpolação linear, sem o zigue-zague do A* cru.
- O marcador de clique agora é um pulso transitório de 0,72 s, em vez de ficar
  permanentemente abandonado no terreno.
- O Skytalos Ancient +15 usa o item `2551`, malha `762/bow16`, banco de
  animação de arco `6`, pose armada `STAND02` e a multitextura `165`. O segundo
  UV percorre U/V no ciclo clássico de 4 s e a empunhadura foi homologada.
- A fogueira `501` usa os frames `011–018`, cores, escala e UVs do
  `TMEffectBillBoard`; a inversão vertical dos DDS foi corrigida e homologada
  em `2135,2140`.
- O Griupan item `1726` está homologado como familiar padrão independente da
  montaria, usando `32/ag01`, malha `ag010103`, animação, seguimento flutuante
  tipo `5` e partículas clássicas.
- O recorte da Huntress formado por Imunidade `#76`, Ligação Espectral `#81`,
  Explosão Etérea `#86`, Lâmina das Sombras `#88` e Força Espectral `#101`
  está implementado. Os buffs
  persistem por `180 s`, com efeitos suavizados; a passiva `#101` acrescenta
  alcance e acopla o `SForce` clássico aos ataques.
- HUD clássico, minimapa, seletor de mapas, câmera, zoom e modo G estão ligados.
  A composição inferior passou a usar a proporção da interface 7.54: trilho em
  toda a base, orbes nos cantos, readout compacto dentro da barra e áreas reais
  de clique sobre `C.C` e `MENU`. O chat abre com `Enter`, envia/fecha com
  `Enter`, cancela com `Esc`, guarda as cinco últimas mensagens e alterna entre
  Geral/Grupo/Guild; `=` e `-` mantêm os prefixos do `SEditableText` clássico.
- A janela `C` usa `character2.wyt`, mostra progressão/atributos e distribui os
  pontos do mock offline. A tabela acumulada de EXP possui os 403 valores
  exatos de `g_pNextLevel` do cliente.
- Os 14 atlas `itemicon01..14`, a tabela `itemicon.bin` e a seleção 3D giratória
  do inventário estão integrados. O ícone permanece em `35×35`; um clique
  expande o mesh e o prende ao cursor, o movimento do mouse carrega o item e o
  próximo clique solta/move/equipa. Clicar novamente na origem cancela e hover
  isolado não abre nada. Não existe popup, fundo ou janela extra.
  A cena usa um canvas transparente pequeno e compartilha o cache de modelos
  com o mundo. Itens refinados exibem `+N` no grid. O Skytalos Ancient
  +15 também reproduz no preview o emissivo de `TMMesh::RenderForUI` e a segunda
  textura `165` com UV de 4 s e composição `MODULATE2X + ADDSMOOTH`.
- O inventário 7.54 agora usa o recorte real `227×421` do atlas, quatro bolsas
  sobrepostas de `5×3` (offsets `0/15/30/45`) e as quatro abas originais. Os 15
  slots ativos de equipamento seguem IDs, coordenadas e máscaras de
  `FieldScene2.bin`; não há mais grid de 60 células rolável nem o restante do
  atlas aparecendo como fundo. Pointer Events permitem mover, combinar e trocar
  itens com mouse ou touch; o fluxo clássico clique–cursor–clique também move
  entre bolsas sem manter botão pressionado. É possível equipar por drop/duplo
  clique e desequipar para um espaço vazio. Skytalos, Mulher Kalintz, Unicórnio
  Lv. 120 e Griupan começam
  nos slots correspondentes; arma, traje, montaria e familiar também atualizam
  o modelo do personagem ao equipar/retirar.
- Abaixo do minimapa, a telemetria agrega FPS, heap JS quando disponível e o
  tempo/ocupação da callback principal como proxy explicitamente não-CPU.
- Build TypeScript/Vite verde em 22/07/2026.

## Implementado, mas ainda não homologado visualmente

- Terreno usa margem base 28, antecipação direcional de até 60 e retenção 42;
  criaturas entram a 56 unidades da borda e permanecem até 64.
- Unicórnio item `2381`/visual `336`, `hs01` variante `07` completa em três
  partes e ações do bloco `[horse] 31`. A sela agora segue o bone `4` e a
  transformação `SetVecMantua(2, 31)`; aguarda homologação visual.
- C.C `F` com modos físico, mágico e suporte, montaria `R`, arco à distância e
  hotkeys de skill `1–9`. O clique no botão redondo agora abre a caixa clássica
  em vez de alterar silenciosamente o estado.
- Troca jogável entre TransKnight, Foema, BeastMaster e Huntress: os rigs
  `ch01/ch02`, `bExpand`, armaduras da seleção clássica, armas Ancient, bancos
  a pé/montado e attachments de mão já foram derivados do cliente. Cada classe
  possui traje base/armadura no seletor e um primeiro loadout auditado. A
  Huntress possui nove atalhos visíveis e doze skills promovidas; Meditação
  `#77`, Escudo Dourado `#85` e Evasão Aprimorada `#89` continuam utilizáveis
  pelo catálogo `K`.
- BeastMaster possui as oito evocações de Natureza auditadas (`#56–#63`):
  Condor, Javali, Lobo, Urso, Grande Tigre, Gorila, Dragão Negro e Succubus.
  BON/MSH/DDS, variantes LOOK_INFO e ações AniSound/ValidIndex são reais; no
  mock offline, cada cast cria a formação de 10 solicitada, que segue o dono,
  procura hostis e ataca. Grande Tigre ocupa o atalho `9`; as oito continuam
  utilizáveis pelo catálogo `K`. Cada uma das 10 entidades nasce em sua própria
  posição com o conjunto clássico `TMEffectStart(type 1)` +
  `TMEffectLevelUp(type 0)`, incluindo malha `703` e texturas `2/7/52/54/55`.
- Controle contínuo implementado: manter o esquerdo atualiza o destino a cada
  `200 ms`; manter esquerdo+direito avança na direção da câmera e permite
  esterçar com o direito. A célula isolada em `2164,2102` agora recebe um
  microdesvio manual restrito, sem remover a colisão clássica nem liberar
  paredes/corrimãos.
- A grama `TMLeaf` dos tipos `315/316` em `2104,2088` e `2129,2102` deixou de
  receber o espelhamento Z exclusivo das malhas de personagem. DAT/MSH/WYS
  foram conferidos contra a origem e o footprint voltou aos limites do
  canteiro; falta homologar visualmente os dois pontos.

## Provisório — não considerar fiel ainda

- Poder/dano e geometria visual das skills ainda são aproximações; nomes,
  mana, delay, range, alvo, ações e estados dos primeiros loadouts das quatro
  classes já vêm do `SkillData.bin`.
- A fórmula de dano continua sendo um mock offline. A rotação foi confrontada
  com o cliente: o C.C clássico usa somente a skill selecionada e o macro `Y`
  separado gira os últimos N atalhos. A lista ordenável da versão web é uma
  extensão deliberada pedida para este projeto; não é apresentada como regra
  do servidor. Enquanto o servidor não existe, cada nível concede `+3 ATQ` no
  estado do frontend e o combate usa esse total.
- `Enfraquecer #51` preserva o `AffectValue=10` bruto do SkillData. Como o
  cliente não revela se o servidor o trata como pontos ou percentual, o mock
  offline reduz em `10%` o dano dos monstros marcados por `5 s`; essa política
  deve ser removida quando a fórmula autoritativa existir.

## Fila obrigatória

1. Locomoção, saídas e pontes — **concluído e homologado**. O controle contínuo
   está implementado:
   esquerdo mantido retargeta o chão, esquerdo+direito avança e esterça pela
   câmera, e ambos funcionam independentemente da ordem em que são
   pressionados. O gargalo relatado em `2163,2102` foi isolado no bloqueio
   `type 444` da célula vizinha `2164,2102`; o movimento manual agora contorna
   somente obstáculos unitários com rota curta e máscara autoritativa, nos dois
   sentidos. O clique continua usando A*. A ponte foi testada e aprovada; fica
   proibido reabrir sua revisão global sem uma regressão nova e reproduzível.
2. Streaming antecipado de mundo e criaturas — **implementação concluída**.
   Terreno antecipa somente na direção do movimento (até 60 unidades), mantém
   histerese em 42 e descarrega Fields fora da janela. Criaturas entram a 56 e
   saem a 64, inclusive antes de o jogador cruzar para o terreno vizinho.
3. `LOOK_INFO` da Huntress e guarda-roupa real. Implementado a partir de
   `SetPacketMOBItem`, `SetHumanCostume` e `SetCostume`: rosto/cabeça base,
   Rake, Loki, Waha e fantasias clássicas, incluindo a Mulher Kalintz do item
   `4156`, agora definida como traje padrão do personagem.
4. Skytalos, refinação e Ancient. Implementado e homologado: item `2551`,
   refinação +15, composição `MODULATE2X + ADDSMOOTH`, UV animado em 4 s e
   empunhadura pelo banco de arco da Huntress.
5. Montarias nível 120 e pose montada. Implementado e inspecionado com 14
   montarias reais selecionáveis, cada uma com item/skin/meshes/texturas,
   escala, bone de sela e banco de animação próprios. O Grifo conserva o rig
   `bd02` para asas/pernas e reutiliza somente a curva vertical autorada do
   `RUN` do Dragão Vermelho `dr02`, subindo ao avançar sem deformar o esqueleto.
   A multitextura `452` percorre U/V no ciclo clássico de 10 s, respeita os
   modos alpha `A/N/C` e limita a iluminação antes de `MODULATE2X`, como o
   vertex shader Direct3D original, evitando saturação causada pelas luzes do
   Three.js. O runtime permanece em `WebGLRenderer`; uma migração WebGPU não é
   pendência atual porque exigiria portar os shaders `onBeforeCompile` para TSL.
6. Ataque à distância e macro. Implementado e homologado: banco de arco `6`
   desmontado/`5` montado, ciclo `ATTACK02/03/01`, soltura após `200 ms` e voo
   de `50 ms` por unidade do ataque `151`. O dano usa o atlas original
   `Yellow_Number`; críticos usam `Orange_Number`, curva `TMFont3` de `2,1 s`
   e impacto clássico `531/118/229/230/231`. Para o gameplay offline atual, a
   chance de crítico foi definida em `35%` por ataque. A correção da aproximação
   montada também está implementada: deslocamento real interrompe o action lock,
   seleciona `MRUN/MWALK` no cavaleiro e `RUN` na montaria no mesmo frame; ao
   parar para disparar, a rota termina antes de `MATT` e a montaria permanece em
   `STAND01`, sem disparar a curva de elevação. Falta apenas homologar novamente
   essa sequência rara no navegador.
7. Isolamento completo do modo G — **concluído no frontend**. `G` usa velocidade
   64, ignora a navegação/colisão, bloqueia dano recebido, revive ao ativar e
   continua alimentando o streaming preditivo sem alterar o modo normal.
8. Progressão e painel de personagem — **frontend implementado, fidelidade
   parcial**. A janela `C` usa o atlas clássico, guarda e distribui
   `STR/INT/DEX/CON`, mostra pontos livres/EXP total e aplica a tabela exata
   `g_pNextLevel[403]`. Cada nível concede os `+5` pontos e `+3 ATQ` configurados
   no mock, toca `LEVELUP/MLVLUP` e dispara o efeito visual clássico. Ainda
   faltam as fórmulas autoritativas de atributos derivados e o som original;
   não inventar essas regras no cliente antes da camada de servidor/áudio.
9. NPCs, diálogo, lojas, portais, equipamento, inventário e loot — **parcial**.
   Cada ator agora expõe `generatorId`, índice/chave do template, código de
   interação, item da cabeça e categoria `shop/cargo/quest/mix/premium/special`.
   O clique segue a separação mouse-down/mouse-up do cliente, respeita o ator
   mais próximo, não abre fala inventada para código zero e fecha a interação
   ao mover, atacar ou trocar de estado. A equivalência entre o nibble baixo de
   `Merchant` e `SCORE.Reserved` permanece identificada como inferência do
   corpus, embora tenha coincidido nos 376 templates resolvidos analisados.
   Foram importados os atlas reais `MessageBox2`, `Store2`, `Storage2`,
   `Quest2`, `PotalUI` e `PotalOldUI`; os painéis usam essas geometrias e o
   serviço abre junto do inventário existente, fechando-o depois somente quando
   ele próprio o abriu. Inventário, personagem, skills, loja e cargo podem ser
   arrastados por mouse/toque; loja/cargo nascem a `8 px` do inventário e
   escolhem automaticamente o lado que cabe no viewport. NPCs amistosos também
   recebem no hover um contorno verde extrudado pela normal depois do skinning,
   em vez de uma cópia escalada pelo pivô que desaparecia dentro de rigs
   multipartes. O inventário conserva os 14 atlas de `itemicon.bin`,
   quatro bolsas, 15 slots por página, 15 slots de equipamento, preview 3D,
   drag/drop, merge/swap e equipar/desequipar no estado offline.
   O novo catálogo comercial contém os 6.500 registros de `ItemList.bin`, os
   12 efeitos e demais campos úteis, os 99 overrides ativos de `ItemPrice.bin`
   e o `Carry` comercial mapeado nos 27 slots `0..8`, `27..35` e `54..62` de
   79 templates. O loader runtime é explícito, lazy, cacheado e somente leitura;
   resolve por item/template uma view congelada dos 27 slots, inclusive vazios,
   com item completo, efeitos da instância e preço estático marcado como não
   autoritativo. Auditoria no binário confirmou que o registro de `ItemList.bin`
   tem `unique@132`, `reserved@134`, `position@136`, `extra@138`, `link@140` e
   `grade@142`; o layout antigo `position@134/grade@138` estava errado para este
   corpus e gerava opções/Ancient incoerentes. Essa view já alimenta as 40 células visuais da loja: os 27
   slots `Carry` preservam seus vazios e os 13 restantes ficam vazios como no
   atlas; ícone, nome, requisitos, efeitos, adicionais de instância e preço
   estático vêm do catálogo. Os tooltips de inventário/equipamento/cargo/loja
   usam o painel clássico de `240×270`, Tahoma 12, preto `0xAA000000`, paleta do
   `SGrid` e fórmula real de refino/Ancient. O Skytalos `#2551` preserva os
   adicionais do `Carry` de `Utilidades`: `EF2=120`, `EF3=120`, `EF43=251`
   (`+15`) e `grade=5`, exibindo `Dano de Perfuração : 480` como no cliente. O
   Aki, por exemplo, expõe os 14 itens recuperados de seu template. Selecionar
   continua sendo apenas apresentação; ainda faltam no servidor compra/venda,
   saldo, Tax, combinação, missões e persistência, e nenhuma dessas operações
   deve ser simulada como autoritativa. Drop tables e regras de loot continuam
   sendo responsabilidade do servidor.
   O cargo também deixou de ser uma grade vazia. A fonte reserva
   `MAX_CARGO=128`, mas `TMFieldScene` expõe somente os índices `0..119` em três
   páginas de 40 (`5×8`); a UI reproduz essas páginas, ícones, quantidades e
   refinação. Enquanto a conta/servidor não existe, os 120 slots começam vazios
   e vivem exclusivamente na sessão, com aviso explícito. Mover, juntar pilhas
   e trocar inventário↔cargo/cargo↔cargo usa uma única transação de estado para
   não criar estados intermediários de duplicação ou perda. Não há seed,
   `localStorage`, saldo, taxa nem alegação de persistência compartilhada.
   Para portais, o runtime reconhece o bit `0x10` do `AttributeMap`, cruza as 37
   entradas exatas de `g_TeleportTable` e abre o prompt clássico quando o
   personagem para sobre a célula. O prompt abre uma vez por entrada, não
   reaparece enquanto o personagem permanece nela e é limpo ao sair, morrer,
   trocar de classe/Field ou teleportar. Confirmar ainda não move o personagem
   nem cobra preço: destino, autorização e transição continuam pendentes do
   servidor.
   A apresentação de item no chão agora segue `MSG_CreateItem`/`TMItem`: usa o
   índice e os três efeitos do `STRUCT_ITEM`, `GridX/Y` inteiros, centro
   `+0,5`, altura `+0,1`, rotação em quartos, nome/hover branco, brilho por
   `EF38`, toggle global de efeitos e descarte fora do quadrado de 18 células.
   Clique e aproximação partem do `MoveGet`: o cliente recuperado usa
   `BASE_GetDistance <= 1`, enquanto o fallback web adota explicitamente o
   alcance de conforto solicitado de três células. A rota termina no ponto
   caminhável válido mais próximo ao redor do item e conserva validação do
   segmento/altura, cooldown de 1 s, teste de espaço no inventário e mutação
   somente após a confirmação equivalente a `CNFGetItem`. O cliente recuperado
   não contém as drop tables do servidor;
   portanto a demonstração permanece explicitamente isolada em uma política
   offline determinística para as poções reais `#400/#405` e as Poeiras de
   Oriharucon/Lactolerium `#412/#413`, sem o antigo Fragmento de Oriharucon
   inventado. Os modelos `53/56/61/62` e dados estáticos vêm do catálogo
   clássico. No fallback offline, os quatro itens são agrupáveis em até 50
   unidades; tanto a confirmação da coleta quanto o drag/drop completam uma
   pilha compatível antes de consumir outro slot. `Espaço` coleta somente uma
   instância materializada dentro do alcance web de três células, e `Z` alterna
   a visibilidade de todos os nomes residentes sem interferir na digitação do
   chat. Falhas de A*/segmento e
   aproximações sem progresso cancelam a coleta e liberam novamente o C.C.; a
   rota iniciada pelo drop também é encerrada ao cancelar, sem parar um caminho
   posterior que não pertença à coleta. Como o TTL real depende do servidor, o
   mock não inventa um tempo clássico: mantém um teto explícito de 128 drops
   residentes e descarta o mais antigo ao excedê-lo, além da janela espacial de
   18 células. Ainda faltam ownership,
   decaimento/ressincronização de servidor, footprint `EF_GRID` multicélula,
   moedas no chão e drop tables
   autoritativas. NPCs amistosos mantêm o passeio
   curto já implementado, e o Griupan segue homologado como familiar padrão.
10. HUD, áudio, efeitos e revisão manual dos mapas — **parcial**. A HUD recebeu
    o primeiro passe de escala/composição baseado na captura 7.54 fornecida:
    painéis de personagem/inventário ampliados, trilho inferior contínuo,
    orbes laterais, readout integrado, botões redondos clicáveis e telemetria
    legível. O chat local segue `SEditableText::OnCharEvent` e
    `TMFieldScene::OnKeyReturn`; rede continua deliberadamente fora do escopo.
    O HUD sobre o próprio personagem também foi reconstruído como a camada 2D
    do cliente, sem reutilizar sprites dos mobs: projeta o topo do ator a cada
    frame, mantém nome `#ffffaa` e HP `72×7,5`, e mostra o balão preto
    translúcido acima deles por `3 s` (`10 s` com prefixo `*`). Grupo/guild e
    rotas `@`/`/` não geram balão; os offsets a pé/montado, a fonte
    `FontNanum.ttf`, o recorte de viewport e a ausência deliberada de
    depth-test seguem `TMHuman::LabelPosition` e `SText`.
    Ainda é necessária homologação visual em 1024×768, desktop widescreen e
    iPhone; o detalhamento dos slots equipados já foi reconstruído a partir do
    `FieldScene2.bin`. A causa da
    grama deslocada em `2104,2088` e `2129,2102` foi rastreada no cliente:
    `TMLeaf/TMTree/TMShip` usam `TMSkinMesh` sem owner/type 1 e não recebem o
    mirror Z reservado a personagens. O runtime agora segue essa transformação;
    os DAT/MSH importados são idênticos à origem e os footprints `315/316`
    voltaram aos canteiros, aguardando inspeção visual. A telemetria abaixo do
    minimapa também está concluída: agrega uma vez por segundo FPS, heap JS
    (`performance.memory`, ou `—` no Safari/iPhone) e duração/ocupação da
    callback principal como `THREAD*`, sem alegar CPU real. A primeira camada
    de áudio também foi integrada: `soundlist.txt` gera um catálogo lazy com
    333 entradas de SFX, os 13 MP3 seguem a ordem exata de `DirShow.cpp` e o
    BGM usa o roteamento não-war recuperado de `TMFieldScene.cpp`; começa
    desligado e a tecla `M` alterna somente a música, sem silenciar os efeitos.
    Ataques usam os pares de arma de `TMHuman::PlayAttackSound`, e skills,
    impactos e level up já disparam os IDs recuperados de `TMHuman.cpp` e dos
    controladores `TMSkill*`; a coleta confirmada usa o som `31` do fluxo
    clássico. A segunda camada também está ligada: passos escolhem os pares de
    `TMHuman::AnimationFrame` pelo tipo de piso; NPCs e monstros disparam os 82
    IDs distintos preservados em suas ações `AniSound4`, incluindo ataque,
    dano, morte e loops de movimento/idle; cachoeiras `TMHouse type 3`, chuva
    local e o objeto `607` usam loops com os raios clássicos. Atenuação,
    `IsSoundPlaying` por quantidade de canais e teto de 28 vozes impedem spam
    em Fields densos. A auditoria confirma zero IDs de ação ausentes no pacote.
    O `mguardatt.wav` ausente no desktop foi recuperado pelo nome exato do
    cliente mobile reduzido, com a procedência registrada no catálogo. Quatro
    referências gerais do soundlist ainda não existem em nenhum dos dois
    corpora e permanecem explicitamente listadas. A pendência de áudio do runtime atual está
    concluída; clima global futuro só deve ser ligado quando o respectivo
    sistema de weather existir. Ainda falta concluir a revisão visual final
    dos mapas.
11. Distribuição web — **concluído para o escopo atual**. O build de produção
    não publica sourcemaps, remove comentários legais/`debugger`/`console.debug`,
    minifica identificadores/sintaxe/espaços e usa nomes de assets por hash. O
    bootstrap mobile prepara somente os renderers da classe ativa; a troca de
    classe aguarda o respectivo lote antes de liberar o personagem, evitando
    manter em memória de entrada os efeitos completos das quatro classes. O
    README documenta o limite dessa proteção, instalação e comandos somente com
    Bun, preparo dos assets, erros comuns, iPhone/Vercel e a galeria de capturas
    reais, incluindo as quatro classes, evocações e os 111 mapas.
12. Auditoria técnica final e cobertura do cliente clássico. Revisar o runtime
    contra as melhores práticas atuais do Three.js — ciclo de vida/dispose,
    cache e compartilhamento de GPU, draw calls/instancing, streaming, LOD,
    frustum/occlusion, materiais/shaders, animação, carregamento assíncrono e
    orçamento de memória/frame. Em paralelo, gerar uma matriz rastreável do que
    foi e não foi importado para todas as classes, monstros, NPCs, itens,
    equipamentos, montarias, animações, sons e efeitos; apontar os parsers e
    dados-fonte existentes, lacunas, dependências e a ordem segura para trazer
    o restante sem regressões visuais. Iniciado em
    `docs/auditoria-threejs-cobertura.md`: a HUD agora expõe também
    `WebGLRenderer.info` (`GEO/TEX/CALLS/TRIS`) além de FPS, heap JS e proxy de
    thread, e a primeira matriz de cobertura/riscos está registrada. O
    shutdown central `GameApp.dispose()` também foi implementado com cleanup de
    listeners, input, mundo, spawns, player, ground items, preview, efeitos,
    renderer e caches de terreno/modelos/texturas, preservando o bfcache do
    Safari/iOS em `pagehide.persisted=true`. Ainda faltam baseline visual/perf
    por cenário e teste manual de reload/bfcache. A varredura estática confirmou
    `dispose()` em todos os módulos de efeito que alocam GPU, limites nos pools
    variáveis e ownership dos listeners globais; novas skills ficam obrigadas
    a manter esse contrato. A matriz automatica por
    arquivo importado foi concluida: `bun run audit:coverage` cruza o manifesto,
    o corpus fisico e as definicoes TypeScript do runtime, gerando Markdown e
    JSON em `docs/matriz-cobertura-classico.*`. O snapshot atual valida 2.285
    caminhos declarados sem faltantes, 111 TRN, 108 DAT declarados, 103
    minimapas declarados, 377 templates, 3.937 geradores, 6.500 itens, 248
    skills binárias, 14 montarias e oito evocacoes; tambem explicita por classe
    quais skills ja foram promovidas ao runtime. O code splitting tambem foi
    aplicado: Three.js ocupa um chunk vendor cacheavel, a entrada da aplicacao
    ficou em cerca de 460 KiB minificados e os renderers de Foema, TransKnight
    e BeastMaster viraram chunks lazy de aproximadamente 20/54/96 KiB,
    carregados somente no primeiro switch para cada classe.
    As verificações que exigem navegador/dispositivo estão isoladas em
    `docs/checklist-homologacao-manual.md`, com cenário, duração, coordenadas e
    critério de evidência; elas não são marcadas como aprovadas pelo build.
13. Memória canônica do projeto — **primeira consolidacao concluida**.
    `MEMORIA_PROJETO.md` registra a arquitetura resultante, decisões e justificativas,
    fontes do cliente clássico por subsistema, formatos/parsers, descobertas,
    bugs corrigidos, bugs ainda conhecidos, limitações técnicas e de navegador,
    soluções rejeitadas, riscos, débitos, procedimentos de importação/build e
    um histórico cronológico das mudanças relevantes. Manter o documento vivo
    a partir daí, sem transformar `PENDENCIAS.md` em diário de implementação.
14. Menu do jogo e configuração `C.C` — **frontend concluído e auditado**. A
    origem ativa não usa o handler legado `B_CCATTACK`: `B_CCMODE_SYSTEM`
    (`66570`) mostra/esconde o painel `66817`, com `120×30` e quatro controles
    `29×29`. A versão web reproduz essa geometria imediatamente acima do botão
    e usa os crops reais `455/456/458/459/460/463/464/465` do atlas
    `main.wyt`. O clique no `C.C` somente abre/fecha a caixa; o primeiro ícone e
    `F` percorrem o mesmo estado `0` desligado, `1` físico, `2` mágico e `3`
    suporte. O físico chama o ataque básico, o mágico nunca cai em ataque
    básico quando aguarda mana/cooldown e o suporte mantém buffs, evocações e
    recuperação sem atacar. HP/MP automático e movimento contínuo/fixo/parado
    funcionam no mock; o percentual de HP/ração da montaria fica configurável,
    mas sem efeito até existir estado autoritativo da montaria. A extensão do
    modo mágico aceita até dez skills ofensivas realmente presentes na barra,
    permite incluir/remover/reordenar e preserva uma configuração por classe.
    Alvos e skills adquiridos manualmente são separados dos adquiridos pelo
    macro; desligar não cancela uma ação manual. Troca de classe, morte,
    respawn e teleporte limpam somente o estado transitório necessário. No
    modo contínuo (`>>`), o raio de aquisição agora ultrapassa o alcance
    imediato da arma/skill e entrega o ponto de aproximação ao A*, de modo que
    o personagem caminha até o próximo monstro em vez de aguardar um alvo já
    dentro do alcance. Um alvo cujo caminho falha entra em espera por `1,5 s`,
    permitindo ao C.C. tentar outro monstro em vez de readquirir o mesmo para
    sempre. A auditoria também registrou que o macro
    `Y`/`m_cAutoAttack` do cliente é um
    sistema separado, que gira os últimos N atalhos; a lista ordenável web é
    uma decisão explícita do projeto. O menu recebeu as opções clássicas de
    servidor/personagem/saída como estados honestamente bloqueados pela rede.
    Dano, sessão e regras econômicas continuam destinados ao futuro servidor.
15. Skills e buffs completos por classe. Implementar a matriz de habilidades de
   TransKnight, Foema, BeastMaster e Huntress a partir de `SkillData.bin` e das
   rotinas do cliente clássico. Cada skill deve usar sua textura, animação de
   personagem, efeito de conjuração, trajetória e impacto originais; cada buff
   deve manter duração/estado e o efeito persistente correto no personagem ou
   alvo. Reproduzir também shader, blend/alpha, UV animado, billboard/mesh,
   escala, cor, bone de ancoragem e sincronização dos frames, evitando efeitos
   genéricos compartilhados entre classes. O Mestre Carb agora reconhece seus
   cinco templates importados e renova por `900 s` os 32 buffs reais de
   classe/master identificados no `SkillData.bin`; classe, índice, ícone
   (inclusive o atlas master), `instance`, `tick` e `affect` são preservados,
   os ícones quebram em múltiplas linhas e o estado sobrevive à troca de classe.
   Os 14 buffs que já possuem renderer continuam usando seus efeitos dedicados
   quando a respectiva classe visual está carregada. Para os demais, o estado e
   o ícone são fiéis, mas fórmulas de atributos e VFX ainda dependem de código
   autoritativo/renderer recuperado e não foram inventados. A interação é
   instantânea: clicar no Mestre Carb renova os buffs sem abrir modal de NPC ou
   inventário. Para a Huntress, o
   catálogo binário,
   ícones clássicos, barra clicável e menu `K` já estão integrados; os buffs
   offline duram `180 s`. A Imunidade `#76` deve manter as duas esferas
   `sphere2` persistentes, e a Ligação Espectral `#81` deve ocupar o slot `9`
   com os dois arcos `unsole` orbitando enquanto o estado estiver ativo. A
   Explosão Etérea `#86` já usa as lâminas e a trajetória clássicas. A Lâmina
   das Sombras `#88` também deixou de usar o projétil genérico: cria as cinco
   cópias skinned de `100/300/500/700/900 ms`, interpola pelo motion type `6`,
   aplica o fade cosseno e as partículas `texture 0`; montada, duplica somente
   o animal como no branch `m_stMountLook`, com pool e descarte limitados. O
   fallback montado também segue o `SetAnimation` clássico: como o índice `99`
   da `MATT3` da Huntress não cabe nas dez animações de `hs01`, o clone conserva
   o `STAND01` do próprio rig da montaria e herda apenas o FPS de `15 ms` do
   cavaleiro; matrizes ANI de rigs diferentes são rejeitadas no runtime. A
   passiva Força Espectral `#101` também já está sempre aprendida, acrescenta uma
   unidade ao alcance e acopla o `SForce` clássico de três camadas à arma em
   ataques normais e skills ofensivas, sem ocupar slot ou criar buff temporário.
   O primeiro lote de TransKnight agora possui renderers dedicados para Giro da
   Fúria `#0`, Toque Sagrado `#1`, Golpe Duplo `#2`, Samaritano `#3`, Aura da
   Vida `#5`, Lâmina Congelada `#19` e Tempestade de Gelo `#23`, usando as malhas
   `10/702/703/706/707`, DDS, alpha DWORD, offsets, tempos e pools derivados do
   cliente. O primeiro lote dedicado de Foema cobre Ataque de Fogo `#32`,
   Relâmpago `#33`, Trovão `#37`, Névoa Venenosa `#40` e Velocidade `#41`; o
   Trovão separa o cast transitório de dois segundos dos anéis persistentes do
   estado do buff. O segundo lote da Foema também está implementado: Lança de
   Gelo `#34` usa os modelos `708/707`, sombra móvel, flare e partículas do
   FreezeBlade; Fênix de Fogo `#38` combina simultaneamente o pássaro `8` e a
   onda `702`, com frames, trilhas, explosão radial e fogo final; Arma Mágica
   `#44` possui o cast único `56/60` e, durante os `180 s` do mock, amostra a
   matriz final da arma para emitir o rastro `56` ao longo da lâmina, inclusive
   montado, sem o antigo pulso genérico no corpo. Os três preservam pools
   limitados e separam o dano offline do momento do impacto visual. Tempestade
   de Meteoro `#35` e Inferno `#39` também estão integrados: o primeiro cria o
   MeteorStorm central de nível `0`; o segundo cria os quatro cantos de nível
   `4` em `0/200/400/600 ms` e o centro em `270 ms`. Ambos preservam o voo
   diagonal de `600 ms`, trilhas `0/59`, impacto animado `33–41`, flash `8`,
   shade `7`, pools limitados e o despacho imediato de `TMFieldScene`, separado
   do evento atrasado de `TMHuman`. Nevasca `#36` segue o outro branch imediato:
   cria seis MeteorStorm nível `1` com os offsets autorados, modelo `708`,
   textura `19`, trilhas azuis `0`, impactos `71–78` e shade `7`. O affect de
   `2 s` fica no ator: usa o RGB clássico `(0,.4,.9)` e aumenta o período da
   animação em `1,15×`; movimento continua sem regra inventada, pois no cliente
   essa posição chega do servidor. Escudo Mágico `#43` e Toque da Athena `#45`
   também estão integrados. O Escudo conserva o evento de `500 ms`, as quinze
   partículas `56`, o raio `51` e o pulso persistente dos cinco pares de modelos
   `704/705` com textura `57`, inclusive a escala montada `1,5`. Athena mantém o
   despacho imediato do pacote, as vinte partículas `56` com vidas escalonadas
   e o billboard horizontal persistente `93` em `feet + 0,4`, com rotação/fade
   de `5 s`. Ambos aceitam self/aliado no binário; o mock offline seleciona self
   sem fingir party/rede, mantém o override solicitado de `180 s` e não inventa
   as fórmulas autoritativas de defesa/mastery que pertencem ao servidor. As
   Controle de Mana `#46` e Cancelamento `#47` também estão integrados.
   Controle de Mana conserva o evento de `500 ms`: quatro controllers
   `TMEffectParticle` somam 60 filhos reais nas texturas `122/56`, o shade
   `7` dura `1,5 s` e o affect persistente emite os dois billboards
   `56/0` normalizados a `60 Hz`; o buff offline segue o override solicitado
   de `180 s`. Cancelamento não inventa explosão nem dano: o dispatcher
   clássico não possui branch de cast para `#47`, então o mock aplica somente
   o affect `32` de `1 s`, com tint vermelho e o pulso dos modelos `501/502`
   na textura `202`. As alegações de converter `80%` do dano em MP, preservar
   `300 MP` ou falhar em `25%` não aparecem no cliente/SkillData e permanecem
   fora do frontend até existir código autoritativo do servidor.
   Teleporte `#42` fica por último porque exige party, consentimento, restrições
   de mapa/inventário e rede; não deve virar teleporte livre no mock. O primeiro
   lote visual ativo do BeastMaster também deixou de usar projéteis e pulsos
   genéricos: Fera Flamejante `#48` e Chamas Etéreas `#49` usam os dois looks
   reais do `dr01`, Judgement, voo com alvo móvel, trilhas e respectivamente
   fogo de impacto ou órbita residual; Som das Fadas `#50` lança três cópias
   `ag010101` pelos offsets cumulativos e motion type `4`. Proteção Elemental
   `#53` mantém o protetor `ag010101` e suas partículas enquanto o buff de
   `180 s` estiver ativo, sem reutilizar o Griupan `ag010103`; Força Elemental
   `#54` combina o cast Haste, SlowSlash e o stream persistente dos modelos
   `704/705`, incluindo a escala montada. Todos usam materiais isolados, pools
   limitados, lifecycle ligado a morte/mapa/classe/FX e mantêm o dano offline
   separado do término das trajetórias. O segundo lote ativo do BeastMaster
   cobre Enfraquecer `#51`, Fúria de Gaia `#52` e Espírito Vingador `#55`.
   Enfraquecer preserva o evento atrasado de `500 ms`, o SlowSlash tipo `1`, a
   seleção primário-primeiro de até oito alvos no raio `1` e não passa pelo
   dano mínimo genérico; o mock marca Ataque(-) por `5 s`. Fúria de Gaia
   despacha imediatamente e encadeia os sete FreezeBlade reais `712–718`, com
   `stone01`, snap de altura, crescimento/retração e emissão compartilhada.
   Espírito Vingador também é imediato, combina Judgement `418/419` e
   EffectStart `703/152` nos mesmos cinco alvos usados pelo dano offline. Os
   novos modelos e a textura indireta fazem parte do importador e do manifesto
   reprodutível. Skills ainda não citadas continuam abertas e não devem cair
   silenciosamente em um efeito genérico ao serem promovidas.
   O lote seguinte da Huntress promoveu Meditação `#77` e Escudo Dourado
   `#85`. Meditação porta os cinco pares roxo/branco da textura `101`, com
   espiral do particle type `8`, fade, escala e vidas de `500–900 ms`.
   Escudo Dourado reutiliza o caminho real `TMEffectLevelUp(type 1)`, com as
   oito partículas amarelas `56`, colunas `122`, anel `56`, slope `2` e shade
   `7`; ambos mantêm o override offline de `180 s`. Evasão Aprimorada `#89`
   cria as cinco cópias cinzas reais da pose corrente, iniciadas a cada
   `100 ms`, com vidas de `400–600 ms`; montada, duplica somente o animal.
   A matriz agora registra doze skills Huntress no runtime e 24 registros
   ainda não promovidos.
   `#76/#81/#86/#101` estão homologadas; `#88` está implementada e aguarda a
   inspeção visual no navegador. O épico só fecha depois da matriz completa das
   quatro classes. As oito evocações reais do BeastMaster já têm
   criação, skin/LOOK_INFO, animação `LEVELUP`, seguimento, escolha de alvo,
   ataque e descarte local, sem reutilizar o Griupan. O nascimento agora porta
   `TMEffectStart(type 1)` e `TMEffectLevelUp(type 0)` por entidade, com pool
   limitado a 40 efeitos. A auditoria confirmou que tempo de vida, IA, morte e
   remoção chegam do servidor como entidades `TMHuman`, não são regras do
   cliente; enquanto rede está fora do escopo, a formação de 10 e sua IA são
   uma política explícita do frontend. No futuro, a simulação local deverá ser
   substituída pelos packets autoritativos do servidor.
16. Estimativa final para substituição integral dos assets originais — **fazer
    somente no encerramento das demais pendências e apenas como estimativa**.
    Usar a matriz de cobertura produzida pela auditoria técnica para dimensionar
    uma reconstrução visual do zero, sem executar a migração: separar mapas e
    terreno, arquitetura/props, personagens/classes, monstros/NPCs, montarias,
    itens/equipamentos, rigs/animações, VFX, áudio, fontes e interface; informar
    faixas de pessoa-mês, composição mínima/ideal da equipe, etapas, dependências,
    riscos e margem de incerteza. Comparar caminhos 1:1, remaster e redesign,
    incluindo pipeline de arte, validação e impacto no runtime, para que a decisão
    de abandonar todos os assets clássicos seja tomada sobre o inventário real do
    projeto e não sobre um chute prematuro.

## Convenções do projeto

- Usar `bun` para instalar dependências e executar scripts; não usar `npm`.

Rede e suíte de testes permanecem fora do escopo por decisão do projeto; cada
etapa fecha com build e inspeção manual focada.
