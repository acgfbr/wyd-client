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
- O Nyerdes item `769` de quatro templates do `npcdb` usa a variante
  `ag010102`, animação `RUN`, órbita tipo `5` e o rastro aditivo do efeito
  `0`; a tecla global `V` suprime somente as partículas, preservando a malha
  como nas exceções `3..6` de `g_bHideEffect`.
- O recorte da Huntress formado por Ilusão `#73`, Imunidade `#76`, Ligação
  Espectral `#81`, Explosão Etérea `#86`, Troca de Espírito `#87`, Lâmina das
  Sombras `#88` e Força Espectral `#101`
  está implementado. Os buffs
  persistem por `180 s`, com efeitos suavizados; a passiva `#101` acrescenta
  alcance e acopla o `SForce` clássico aos ataques.
- Carga `#8`, Golpe Mortal `#10`, Assalto `#11`, Espada da Fênix `#12`,
  Fanatismo `#4`, Fúria Divina `#6`, Destino `#7`, Possuído `#13`, Perseguição
  `#16`, Espada
  Flamejante `#17`, Contra Ataque `#18`, Ataque da Alma `#20` e Punhalada
  Venenosa `#21`, Exterminar `#22` e a master Proteção Divina `#200` do
  TransKnight estão jogáveis com os
  registros exatos de `SkillData.bin`. `#8/#10/#18` preservam o branch sem
  projétil do cliente: animação do registro, som `160` e `EarthQuake(2)`.
  Assalto usa os dois billboards clássicos `56/60`, cores, crescimento, fade e
  som `168`; Espada da Fênix usa o `TMSkillDoubleSwing` de nível `1`, malha
  `702`, textura `91`, escala `5×2`, rastro rosa, shade vermelho e som `160`;
  Possuído usa a malha `2838`, textura `413`, expansão type `4` de `500 ms` e
  a armadura crítica persistente com brilho de `1,5 s`; Punhalada Venenosa
  reproduz as dez partículas `texture 0`, crescimento, posições, tempos
  escalonados, cor `0xFF33FF66` e som `156` do `TMSkillPoison`. O `TickType 20`
  permanece documentado, mas seu dano periódico pertence ao servidor. Fúria
  Divina mantém cinco segmentos `texture 128` presos ao alvo vivo por `900 ms`,
  com shades `7` e som `178`; Destino cria uma `TMArrow` por alvo do pacote,
  usa malha `2840`, beam `410`, rastro `0`, impacto `8/7`, voo de `600 ms` e
  som final `26`. Fanatismo captura a pose corrente a cada `300 ms` por
  `1,5 s`, inclusive os dois rigs quando montado, com clone cinza de `700 ms`
  e som `160`; Espada Flamejante acompanha a matriz real da arma durante o
  restante do golpe e emite o billboard azul `11` com som `155`; Ataque da
  Alma clona o LOOK/rig real do alvo em `STAND01`, aplica cinza `0,5`, fade
  cosseno, subida motion type `1` por `3 s` e som `153`. Os affects offline
  duram `180 s`, mas as fórmulas de status continuam reservadas ao futuro
  servidor.
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
- Build TypeScript/Vite verde em 23/07/2026.

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
  Huntress possui nove atalhos visíveis e dezessete skills promovidas; Ilusão
  `#73`, Meditação `#77`, Escudo Dourado `#85`, Troca de Espírito `#87` e
  Evasão Aprimorada `#89` continuam utilizáveis pelo catálogo `K`.
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
   `type 444` da célula vizinha `2164,2102`. Uma inspeção posterior da máscara
   composta mostrou que esse objeto está em `height -2,8`, abaixo do deck já
   registrado em `height 0,1`, e sobrescrevia sozinho a pista com `127`. O
   compositor agora ignora somente esse carimbo enterrado de Field1616; o
   objeto visual permanece e a faixa `2101..2103` fica contínua. O microdesvio
   manual genérico continua limitado a obstáculos unitários. A ponte deve ser
   homologada novamente nesse ponto; fica
   proibido reabrir sua revisão global sem uma regressão nova e reproduzível.
2. Streaming antecipado de mundo e criaturas — **implementação concluída**.
   Terreno antecipa somente na direção do movimento (até 60 unidades), mantém
   histerese em 42 e descarrega Fields fora da janela. Criaturas entram a 56 e
   saem a 64, inclusive antes de o jogador cruzar para o terreno vizinho.
3. `LOOK_INFO` e guarda-roupa real — **faixa clássica de trajes concluída**.
   Além dos looks especializados da Huntress, os 34 itens `4150..4183` de
   `SetHumanCostume`, `SetOldCostume` e `SetCostume` agora estão disponíveis
   nas quatro classes. Cada entrada conserva as seis MSH, WYS/DDS, alpha e a
   troca de `m_nSkinMeshType`; ao mudar entre esqueleto `ch01/ch02`, o banco
   ANI e o bone/transform da arma acompanham o rig efetivo. Equipar ou retirar
   o traje pelo inventário reconstrói a classe ativa, sem voltar
   silenciosamente para Huntress. Mulher Kalintz `4156` continua sendo o
   padrão da Huntress.
   O lote ordinário de corpo também foi fechado para os quatro players:
   `ItemList.bin` fornece `Equip[1..5]`, mesh, texture, posição e `EF_CLASS`;
   o importador aplica `bExpand`, exceções literais de filename e o alpha do
   `MeshTextureList.bin`. `EF_CLASS` é máscara de bits: a correção dessa regra
   elevou o corpus para 990 itens válidos e 1.019 variantes de classe/slot
   entre elmo, armadura, calça, luvas e botas, carregados preguiçosamente por
   catálogo. Fantasia continua prevalecendo
   como override de corpo inteiro; sem fantasia, cada mudança nesses cinco
   slots recompõe apenas a parte correspondente e requisições antigas são
   descartadas.
   `Equip[6]/Equip[7]` também foi fechado para o player: os 794 registros de
   mão do `ItemList` resultam em 788 armas com MSA válida e zero modelos
   referenciados ausentes. O runtime prende cada lado aos ossos/matrizes
   diferentes de `CFrame::Render`, duplica `WTYPE 41`, cruza tipo/posição em
   `CheckWeapon` e troca os bancos ANI a pé/montado. Ancient/refinação usam a
   multitextura da instância quando ela existe; o Skytalos +15 conserva sua
   Força Espectral. Permanecem fora deste lote rosto/classe e mantuas de
   player.
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
   18 células. O `EF_GRID 33` da instância agora usa a tabela exata
   `g_pItemGridXY` (`1×1`, `1×2`, `1×3`, `1×4`, `2×1`, `2×2`, `2×3`,
   `2×4`) em bolsa e cargo. Add, coleta, merge, troca, equipar/desequipar e
   transferência validam todas as células sem atravessar a página; clicar ou
   arrastar por uma célula secundária resolve o mesmo item-âncora, e o tooltip
   mostra o footprint quando ele não é `1×1`. O corpus local não possui
   `EF_GRID` nos itens estáticos/Carries atuais; a informação chega pelo
   `STRUCT_ITEM`, por isso nenhum tamanho foi inventado para o Skytalos ou
   drops offline. O renderer também reconhece `EF_ITEMTYPE 38 = 2`,
   reconstrói o valor monetário clássico como dois bytes sem sinal
   (`EF36 << 8 | EF37`) e usa a string original `Messages[65]`,
   `Bronze %d`, no nome exibido no chão. Criação, confirmação da coleta e
   alteração de saldo não foram falsificadas: continuam aguardando o protocolo
   autoritativo. As quests temporizadas Cemitério e Cabuncle agora aparecem
   abaixo do minimapa com o próximo reset em `MM:SS`. O fallback offline alinha
   todos os clientes em fronteiras de relógio de 10 minutos, em vez de reiniciar
   a contagem ao recarregar. O Coveiro do gerador `3524`, em `2375,2104`,
   também exibe acima do nome uma placa 3D com o mesmo relógio, moldura dourada
   e alerta amarelo no último minuto; a textura só é redesenhada quando o
   segundo muda. Os retângulos de combate vêm dos `StartX/StartY`
   e `StartRange=3` dos geradores `3606..3618` e `3619..3628`; esses monstros
   só adquirem o player dentro do próprio retângulo e retornam à origem quando
   ele sai. No multiplayer, relógio, participação/instância e elegibilidade de
   alvo devem vir do servidor, não da posição declarada pelo cliente.
   Permanecem pendentes a cobrança/validação de entrada pelo Coveiro, a
   progressão das quests, a tabela autoritativa de drops e o consumo/recompensa
   de EXP dos itens. O corpus já identifica `Vela_do_Coveiro #4038`,
   `Varinha_do_Carbunkle #701`, as mensagens de nível `40..115`/`51..100` e o
   requisito de dez varinhas, mas não revela sozinho as fórmulas do servidor.
   Ainda faltam ownership, decaimento/ressincronização de servidor e drop
   tables autoritativas. NPCs amistosos mantêm o passeio
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
    desligado e a tecla `M` alterna somente a música. A tecla `B` e o botão
    correspondente no menu alternam todos os SFX separadamente — ataques,
    impactos, skills, buffs, passos e loops ambientais — e encerram
    imediatamente as vozes/loops ativos ao silenciar.
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
    A revisão estrutural dos DATs recuperou o primeiro lote raro: 1.189
    emissores `TMDust 531` em batch por Field, os billboards `423/424` dos dois
    portais `2035`, as coroas dos três objetos `1846` e as três camadas
    `1979/1980/1981` dos cinco descritores `1980`. As dependências indiretas
    `1979/1981` agora fazem parte do importador. A auditoria também provou que
    `520..530`, `657/658` e `674` devem permanecer invisíveis, evitando criar
    cenário inexistente por inferência. Falta homologar visualmente esses
    efeitos nas coordenadas/Fields em que aparecem e continuar a amostragem dos
    demais objetos raros.
    A família `TMHouse` também foi cruzada: 430 bases recuperaram suas partes
    indiretas `608/609`, `615`, `1770`, `1771` e `1772`; o portão `607`
    contra-rotaciona três peças no ciclo de `20 s`. Importador, leases e
    descarte por Field incluem essas partes. As bases `251..254` agora também
    carregam seu teto `tipo + 1`: ele fica translúcido dentro do raio clássico
    de seis unidades e some quando o bit `0x08` do `AttributeMap` confirma que
    o jogador entrou em uma construção. Permanece a homologação visual dos
    tetos `252/254` em Armia e dos materiais substituídos por texture-set nos
    tipos `614/1711/1739/1750`.
    Os 52 objetos `1855` também receberam o branch de proximidade original:
    dentro de seis unidades alternam para `SRC=ONE/DST=INVSRCALPHA`, sem
    aplicar opacidade arbitrária e sem contaminar os materiais compartilhados.
    O composite `610/611/612` foi confirmado no código, mas nenhum dos 108 DAT
    possui uma base `610`; fica documentado, sem criar objetos inexistentes.
    As emissões de `TMHouse::FrameMove` também foram reconstruídas em batch
    GPU por Field: 52 fontes e 225 cachoeiras ativas usam a textura `151`,
    respeitando bocais, ângulos, offsets, intervalos e duração; os cinco `607`
    combinam o billboard `0/151` e a partícula `56`, incluindo o branch dungeon
    `2`. `1520/1535/1695/1665` permanecem sem respingo conforme os retornos e
    contagens zero do próprio cliente. A tecla `V`, streaming e descarte
    abrangem os novos batches.
    O dispatcher completo revelou ainda 697 bases `1528/1540..1543/1597` com
    overlays indiretos `1555..1559/1598`; as seis malhas emissivas foram
    importadas e agora acompanham posição/ângulo da base. As 62 plataformas
    `TMBike` (`1549..1551`) também reproduzem a senoide clássica de `20 s`,
    amplitude `±3` e seleção de eixo pelo ângulo. Falta homologar visualmente
    esses dois lotes nas coordenadas registradas no checklist. A sequência
    seguinte recuperou o segundo estágio refletivo dos 157 objetos
    `1934/1976/1977`, todos em `Field2722`: nessa região o cliente força neve,
    seleciona `EffectTexture 68` (`mesh/sky02.wys`) e combina a amostra por
    reflection-vector com `D3DTOP_ADDSMOOTH`. O importador passou a respeitar
    também as entradas de `EffectTextureList.bin` que apontam para a pasta
    `mesh`, e os materiais próprios dessas instâncias são descartados com o
    Field. Falta homologar o reflexo nas coordenadas do checklist. Duas
    aparentes lacunas foram descartadas por evidência: os 817 registros com
    `m_bAlphaObj` não caem em nenhum dos setores onde o cliente executa seu
    raycast de câmera, e não existe registro DAT dos tipos genéricos
    `507..510/519/533..599`; não se deve criar comportamento ou objetos para
    branches inativos neste corpus. Também foram portadas as quatro correções
    de altura puramente visuais de `TMObject::FrameMove` em `Field1916`
    (`443/449/454` perto de `2540,2082..2094`): o mesh vai para altura zero,
    mas a altura DAT continua intacta no registro da máscara, como no cliente.
    O caminho opaco/transparente dos objetos também deixou de usar uma regra
    única: o manifest preserva agora os 2.024 bytes `cAlpha` das texturas MSA;
    `ModelLibrary` consulta exatamente o primeiro slot, como
    `TMObject::Render`, e ativa alpha-test `0xAA` +
    `SRCALPHA/INVSRCALPHA` apenas para `A/C` ou para a faixa forçada
    `156..185`. Isso corrige cercas/folhagens/ornamentos recortados sem ordenar
    como transparente todo o cenário.
11. Distribuição web — **implementação concluída; homologação manual pendente**. O build de produção
    não publica sourcemaps, remove comentários legais/`debugger`/`console.debug`,
    minifica identificadores/sintaxe/espaços e usa nomes de assets por hash. O
    bootstrap mobile prepara somente os renderers da classe ativa; a troca de
    classe aguarda o respectivo lote antes de liberar o personagem, evitando
    manter em memória de entrada os efeitos completos das quatro classes. O
    README documenta o limite dessa proteção, instalação e comandos somente com
    Bun, preparo dos assets, erros comuns, iPhone/Vercel e a galeria de capturas
    reais, incluindo as quatro classes, evocações e os 111 mapas.
    A primeira execução agora lê `precache-armia.json`, valida sua chave de
    conteúdo e prepara em `CacheStorage` um pacote essencial de Armia com 780
    arquivos/32,9 MiB. A tela mostra arquivos, bytes, taxa e nome corrente;
    `Entrar agora` interrompe sem impedir o boot e o próximo acesso retoma
    apenas as entradas ausentes. O navegador recebe pedido de persistência
    quando suportado e a estimativa de quota é conferida antes da transferência.
    O MENU permite limpar o pacote local. Um service worker cache-first serve
    os dados clássicos armazenados, mantém manifesto/índice network-first e
    deixa todos os demais mapas no streaming normal. O índice é regenerado por
    `bun run import:cache` e ao final de `bun run import:all`; uma mudança em
    qualquer conteúdo troca a chave e invalida o pacote anterior. O pacote
    completo de cerca de 264 MB não é baixado silenciosamente. Falha, quota,
    modo privado ou ausência das APIs cai para a rede sem bloquear o jogo.
    `CacheStorage` reduz downloads, mas não elimina parsing nem upload à GPU, e
    Safari/iPhone ainda pode expulsar o cache sob pressão. Falta homologar em
    uma publicação HTTPS real: primeira visita, interrupção/retomada, limpeza,
    atualização de versão, offline parcial e expulsão no iPhone 15.
    O boot de Armia agora usa uma barreira adicional: aguarda o DAT e a montagem
    completa de modelos, água, efeitos, avatar, Griupan e montaria; em seguida
    faz o primeiro render ainda atrás da tela opaca para compilar materiais e
    enviar as texturas visíveis à GPU. Caminhada e teleporte preservam o
    streaming assíncrono, portanto essa espera maior ocorre somente na entrada.
12. Auditoria técnica final e cobertura do cliente clássico —
    **implementação e documentação concluídas; homologação manual separada**.
    Revisar o runtime
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
    JSON em `docs/matriz-cobertura-classico.*`. O snapshot atual valida 5.112
    caminhos declarados sem faltantes — incluindo agora o grafo interno de
    MSH/BON/ANI/texturas dos monstros —, 111 TRN, 108 DAT declarados, 103
    minimapas declarados, 377 templates, 3.937 geradores, 6.500 itens, 990
    equipamentos ordinários de corpo, 788 armas de player, 248 skills binárias,
    16 montarias e oito
    evocacoes; tambem explicita por classe
    quais skills ja foram promovidas ao runtime. O code splitting tambem foi
    aplicado: Three.js ocupa um chunk vendor cacheavel, a entrada da aplicacao
    ficou em cerca de 607 KiB minificados e os renderers de Foema, TransKnight
    e BeastMaster viraram chunks lazy na faixa de aproximadamente 37–124 KiB,
    carregados somente no primeiro switch para cada classe.
    O `ModelLibrary` também passou a compartilhar DDS por caminho entre tipos:
    os 2.224 slots das 1.089 MSA reutilizam o conjunto físico de 501 texturas,
    com lease por modelo e descarte somente quando o último consumidor sai.
    Geometria e material continuam pertencendo ao protótipo de cada tipo; isso
    remove uploads GPU duplicados sem permitir que estados mutáveis vazem entre
    objetos.
    O preview 3D do inventário também deixou de crescer com cada item
    selecionado: usa LRU de 12 instâncias, descarta os materiais próprios na
    expulsão e libera o protótipo compartilhado quando nenhum outro preview do
    mesmo tipo continua residente. A auditoria estática e o inventário objetivo
    de lacunas estão consolidados; baseline e bfcache permanecem homologação
    manual, não pendência de implementação.
    A camada ambiental também foi confrontada diretamente com
    `TMButterFly`, `TMFish`, `TMLeaf`, `TMTree`, `TMShip` e
    `TMObjectContainer`. Os cinco indivíduos por emissor de fauna agora usam
    os três movimentos, raios, escalas, fases e orientações de origem em vez
    de uma órbita genérica. As ANI reais de folhas, árvores, navios,
    borboletas e peixes são amostradas em quatro poses por protótipo e
    interpoladas no shader, preservando um draw call por batch sem manter um
    esqueleto vivo por folha. Os ritmos `80/30/15/10/8/4 ms` e os `90°`
    extras de `TMShip::InitAngle` foram recuperados. O balanço senoidal
    inventado do navio foi removido e os tipos de árvore `363..367` voltaram a
    emitir a textura `80` nas alturas/cores clássicas. Falta somente
    homologação visual dessa camada em Fields que contenham cada família.
    `TMSea` também foi fechado contra seus três branches: água externa,
    dungeon e a região especial `28/29 × 22/23`. Cada perfil agora conserva
    texturas, escalas/direções de UV, opacidade e amplitude/base da onda do
    cliente; a região especial carrega o efeito `406`, ausente do antigo
    material genérico. O cache de `MapWater` passou a compartilhar cada DDS
    físico entre materiais e o descarte ocorre uma única vez no shutdown.
    A amostragem de NPCs/monstros também fechou a arma rígida que não pertence
    às partes MSH do corpo: `Equip[6]/Equip[7]` agora resolve o item, importa
    os 76 tipos MSA usados e prende 269 instâncias aos bones exatos de
    `g_dwHandIndex` em 224 templates. `EF_WTYPE 41` espelha as duas garras
    conhecidas e rotaciona a segunda mão. `CheckWeapon` agora cruza também
    `nPos/position@136` para selecionar os bancos ANI autorados dos quatro rigs
    humanoides; cada lease é liberado no unload. Escala e direção inicial
    também seguem `SetCharHeight`, o `0,9` extra para `Equip[0] < 40` e o
    nibble alto de `SCORE.Reserved`, em vez de tamanho/direção aleatórios.
    `Equip[15]` também deixou de ser ignorado: 50 templates suportados por
    `TMHuman` agora instanciam a mantua auxiliar `mt01` (skin `85`), com seis
    texturas realmente referenciadas, cinco ANI importadas e sincronização
    parada/caminhada/corrida. A capa acompanha a `m_OutMatrix` recuperada do
    bone `6`, `7`, `9` ou `16`, conforme a skin, e cada lease sai junto do
    Field. A declaração recuperada de `fMantuaList[4][20]` contradiz branches
    que tentam acessar linhas `5..8`, e o coat mesh `90` também excede a
    redução única do fonte; o runtime evita leitura fora do limite usando a
    linha-base e o slot de família módulo `40`, deixando essa correção
    defensiva explicitamente rastreada.
    Os 14 templates com montaria viva em `Equip[14]` também foram fechados:
    o decoder respeita o `sValue` little-endian usado por `EF_MOUNTHP`, resolve
    seis looks reais e prende o cavaleiro ao bone/transform de sela de cada
    família. Corpo, armas e mantua usam `MSTND/MWALK/MATT/MSTRIKE/MDIE`, o
    animal recebe suas ANI equivalentes e a direção passa a girar a montaria,
    não a base anexada do cavaleiro. `Cavalo Leve N` e `Andaluz N`, antes
    ausentes, elevaram o seletor para 16 montarias e compartilham corretamente
    o rig `hs01` com arreios `04/06`.
    `Equip[13]` também foi confrontado com o branch visual de `TMHuman`. Os
    quatro templates que realmente carregam o item `769` agora instanciam
    Nyerdes pela família `ag01`, malha/textura `ag010102` e ANI
    `ag010101`. A órbita conserva o atraso de `0,3`, raio `0,1`, ciclo de
    `1 s`, oscilação vertical e altura dependente da escala do dono. O emissor
    clássico de partículas `0xFFAAFFEE` usa vida de `1,5 s`, queda de `0,5`
    unidade e cinco dimensões sorteadas; no port ele é um batch instanciado
    único de 512 billboards, em vez de criar uma malha por frame. `V` desliga
    o rastro, mas não esconde Nyerdes, reproduzindo a exceção do cliente.
    `TMHuman::RenderEffect` também deixou de ser uma lacuna totalmente
    silenciosa. Os pontos `m_vecTempPos[0..10]` foram transcritos de
    `CFrame::UpdateFrames` para os rigs `0/1/2/4/6/7/8/20/25/26/28/29`,
    incluindo bones e offsets locais. Com isso, 61 templates recebem os
    billboards persistentes de caveiras, olhos, golems, demônios e elfos com
    mantua, inclusive os ciclos `11..18` e `101..108`; outros 56 templates
    entram nos emissores aditivos/default comprovados de dragões, minotauros,
    golems, ursos, javalis/lobos, elfos, trolls e orcs. A implementação agrega por textura em
    batches instanciados globais de até 512 quads e mantém no máximo 2.048
    partículas transitórias, todos obedecendo `V`, distância e streaming. A
    contradição do Dragão Esmeralda foi preservada: o construtor recuperado
    preenche `m_pEyeFire[8/9]`, mas o renderer lê `m_pEyeFire2[1/2]`; somente
    a emissão cinza comprovadamente alcançável foi portada.
    O crater/shade dos seis perfis Troll/Zumbi também usa agora um batch
    horizontal próprio: grid clássico de quatro unidades, textura `89`,
    rotação em passos de `π/6`, cor `0xCCCCCC`, vida de `3 s` e fade
    `cos(progress·π/2)`. A condição de dungeon também foi restaurada para os
    oito templates de Gárgula: os sete pontos `m_vecTempPos`, textura animada
    `101..108`, escala `2×3`, cor laranja e pulso de três segundos aparecem
    somente nos Fields `row > 25, 8 < column < 16`, equivalentes ao
    `RenderDevice::m_bDungeon == 2`.
    O `TMEffectMeshRotate` exclusivo do `Guer_Caveira` também foi portado em
    lote próprio. A condição exata (`class 36/37`, helm mesh `10`, arma
    esquerda diferente de mesh `930`) resolve somente esse template no corpus.
    Os sete filhos usam os common meshes reais `3,6,4,7,5,6,7`
    (`bnsh01..05`), órbita de raio `1`, ciclo de `1 s`, defasagem de `150 ms`,
    rotação própria em dobro e a chama vermelha animada `11..18` a cada
    `80 ms`. Modelos/textura são compartilhados, o ator mantém apenas clones,
    e streaming, distância, descarte e a tecla `V` abrangem o conjunto.
    Permanecem fora deste lote 16 templates que criam quatro `TMButterFly`
    auxiliares: o construtor recuperado atribui `m_fParticleH` duas vezes e
    nunca inicializa `m_fParticleV`, embora `FrameMove` leia esse valor em
    todos os movimentos. Não reproduzir memória indefinida nem escolher uma
    amplitude vertical no achismo; a implementação exige outra versão do
    cliente ou captura que prove o valor. Os seis Krill condicionados a
    `ATTACK02` têm inconsistência semelhante: o rig `22` só escreve
    `m_vecTempPos[0]`, mas o renderer emite também de `[1]`.
    Falta homologar visualmente uma amostra de cada skin humanoide armada.
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
   Fúria `#0`, Toque Sagrado `#1`, Golpe Duplo `#2`, Samaritano `#3`,
   Fanatismo `#4`, Aura da Vida `#5`, Fúria Divina `#6`, Destino `#7`, Carga
   `#8`, Golpe Mortal `#10`, Assalto `#11`, Espada da Fênix `#12`, Possuído
   `#13`, Perseguição `#16`, Espada Flamejante `#17`, Contra Ataque `#18`,
   Lâmina Congelada `#19`, Ataque da Alma `#20`, Punhalada Venenosa `#21`,
   Exterminar `#22`, Tempestade de Gelo `#23` e Proteção Divina `#200`,
   usando as malhas
   `10/702/703/706/707/2838/2840`, DDS, alpha DWORD, offsets, tempos e pools
   derivados do cliente. Carga, Golpe Mortal e Contra Ataque compartilham o
   branch de `TMHuman` que executa somente quake `2` e som `160`; portanto não
   recebem o antigo projétil genérico. Assalto reproduz somente as texturas
   `56/60` do evento original. Espada da Fênix reutiliza o
   controller do Golpe Duplo no nível `1`, preservando a escala horizontal
   `5`, vertical `2`, cor `0xFFFF0000`, trail `0xFFFF9999`, grid de shade `5`
   e percurso até quatro vezes o vetor do alvo. Possuído separa o cast type
   `4` do estado
   `m_cCriticalArmor`: enquanto o affect `24` estiver ativo, mantém a malha
   `2838`/textura `413`, escala `2×1,5`, brilho senoidal de `1,5 s`, yaw e
   offsets próprios para montaria. Fúria Divina porta o `TMEffectSpark` de
   cinco segmentos e segue o alvo durante os `900 ms` úteis do controller.
   Destino seleciona uma única lista de até oito alvos e reproduz para cada um
   a `TMArrow` type `10001`, incluindo a trajetória fixa `(+3,+5,-3)`, modelo
   `2840`, beam `410`, wake `0`, impacto `8/7` e som `26`. Fanatismo não
   inventa fórmula para o affect `5`: replica apenas os snapshots
   skinned cinza de `700 ms` produzidos a cada `300 ms`, com ambos os rigs
   quando montado. Espada Flamejante amostra a matriz final da arma a `30 Hz`
   durante o restante da animação, portando `m_cFireEffect`, billboard `11`,
   cor `0xFF0055FF`, escala randômica sem fade e som `155`. Ataque da Alma pede
   ao gerenciador de spawns um clone do rig e LOOK reais do
   alvo, compartilha geometria/textura, toca `STAND01`, sobe uma unidade por
   segundo e some em `3 s`, sem projétil genérico. O primeiro lote
   dedicado de Foema cobre
   Flecha Mágica `#24`, Desintoxicar `#25`, Flash `#26`, Cura `#27`,
   Choque Divino `#28`,
   Recuperar `#29`,
   Julgamento Divino `#30`, Ataque de Fogo `#32`,
   Relâmpago `#33`, Trovão `#37`, Névoa Venenosa `#40` e Velocidade `#41`; o
   Trovão separa o cast transitório de dois segundos dos anéis persistentes do
   estado do buff. Flecha Mágica usa o `TMSkillMagicArrow` type `0`: malha `701`, frames
   `20–25`, voo de `50 ms` por unidade, três partículas `0` por emissão, shade
   móvel `7`, impacto `71/7` e sons `161/154`. Choque Divino porta o
   `TMSkillDoubleSwing` nível `2`: modelo `12`/textura `91`, shade móvel `7`,
   núcleos `56/2/60`, fumaça `0` a cada `100 ms`, giro de uma volta por segundo
   e o percurso clássico que atravessa o alvo. Flash preserva o despacho
   imediato de `TMFieldScene`, os quatro pilares `58`, os planos expansivos
   `93/2`, shade `7` e som `159`; o escurecimento da tela só existe quando
   outro jogador acerta o cliente local e, portanto, não é falsificado no mock.
   Recuperar usa as doze partículas azuis `56`, movimentos/lifetimes individuais,
   shade `7` e som `158`; no offline aplica ao jogador local apenas o
   `InstanceValue=150`, enquanto cura dos demais membros continua pertencendo
   ao futuro servidor de party. Cura `#27` reutiliza exatamente o mesmo
   `TMSkillHeal`/som e aplica `InstanceValue=100`; como `TargetType 2` aceita
   a própria personagem, ela já é jogável em self, enquanto selecionar outro
   aliado continua pendente da UI multiplayer. Desintoxicar `#25` porta o
   `TMSkillCure`: 16 partículas multicoloridas mais cinco órbitas brancas,
   lifetimes individuais, shade `7` e som `4`; a remoção de affects negativos
   fica neutra enquanto o player offline ainda não possui esse estado.
   Julgamento Divino porta o
   `TMSkillJudgement` type `0`: modelo `10` com expansão vertical/rotação type
   `2`, anéis `124`, cores e janela curta de ownership de `300 ms`, som `38`
   e despacho imediato do pacote.
   O segundo lote da Foema também está implementado: Lança de Gelo `#34` usa
   os modelos `708/707`, sombra móvel, flare e partículas do
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
   Proteção Absoluta `#213` e Magia Misteriosa `#216` também foram promovidas
   com os registros master exatos. Como índices acima de `199` não entram no
   dispatcher visual de `TMHuman` e os affects `6/42` são estados sem objeto
   visual em `CheckAffect`, ambas aparecem na barra/catálogo e duram `180 s`
   no mock sem receber um brilho inventado.
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
   reprodutível. Os masters Anti Magia `#224`, Chama Resistente `#225` e Last
   Resistance `#235` também estão na barra/catálogo com os campos binários e
   duração offline de `180 s`; como o dispatcher não processa índices master,
   não receberam partículas genéricas. As transformações `#64` Lobisomem,
   `#66` Homem Urso, `#68` Astaroth, `#70` Titã e `#71` Éden agora substituem
   o rig inteiro pelas famílias clássicas `BL01/LB01/DD01/SP02/MM01`, com
   BON/MSH/ANI/DDS próprios, clips recuperados de `ValidIndex`, ritmos do
   `AniSound4`, troca mutuamente exclusiva e lifecycle ligado ao buff de
   `180 s`. A forma bloqueia montaria e o cast respeita a rejeição original
   quando Equip[14] contém traje `4150..4199`; Titã conserva a escala `2.0`
   definida pelo cliente. Com isso, BeastMaster possui 24 skills no runtime e
   restam somente `#226` (debuff/fórmula autoritativa) e `#229` (Invocação
   Final). A investigação de `#229` confirmou `InstanceType=11/Value=9`, mas o
   cliente apenas envia o cast e recebe o summon pronto como `MSG_CreateMob`;
   não há nele associação `9 → LOOK/NPC`, duração ou status. Essa entidade é
   uma tabela do servidor e permanece bloqueada, sem escolher um monstro por
   aparência. Skills ainda não citadas continuam abertas e não devem cair
   silenciosamente em um efeito genérico ao serem promovidas.
   O lote seguinte da Huntress promoveu Meditação `#77` e Escudo Dourado
   `#85`. Meditação porta os cinco pares roxo/branco da textura `101`, com
   espiral do particle type `8`, fade, escala e vidas de `500–900 ms`.
   Escudo Dourado reutiliza o caminho real `TMEffectLevelUp(type 1)`, com as
   oito partículas amarelas `56`, colunas `122`, anel `56`, slope `2` e shade
   `7`; ambos mantêm o override offline de `180 s`. Troca de Espírito `#87`
   também foi promovida sem efeito genérico: importa indiretamente a família
   `86/wg01`, cria as três asas skinned nos atrasos `0/400/800 ms`, segue o
   midpoint dos bones `1/2` do dono com o Y do bone `1`, conserva as vidas
   `2/1,8/1,6 s`, o crescimento/fade do motion type `10`, o shade `7`
   vermelho/azul e as vinte partículas `231` disparadas após `1 s`.
   Ilusão `#73` também segue o fluxo especial do cliente, sem virar buff ou
   projétil: selecionar no catálogo arma o próximo clique no terreno, a rota
   navegável é recortada nos primeiros oito passos de `BASE_GetRoute`, a pose
   corrente deixa uma cópia branca `EF_BRIGHT` por `3 s` na origem e o ator é
   reposicionado no centro da célula confirmada. Montada, a cópia preserva os
   dois rigs independentes de animal e cavaleira. O portal tipo `2` usa a malha
   `703`, textura `58`, pulsos `94`, cor `0x0055FF`, escalas, rotação e som
   `159` de `TMSkillTownPortal`.
   Evasão Aprimorada `#89`
   cria as cinco cópias cinzas reais da pose corrente, iniciadas a cada
   `100 ms`, com vidas de `400–600 ms`; montada, duplica somente o animal.
   Extração `#83` e Alquimia `#84` também deixaram de ser tratadas como ataques.
   A primeira arma a seleção sobre uma célula ocupada das quatro bolsas, usa a
   confirmação no `MessageBox2` e não altera o item sem a resposta do servidor.
   A segunda abre diretamente o atlas `NewItemMix`, junto do inventário, e
   apresenta as dez receitas `head=0/x=0/y=0`, resultados, requisitos e custos
   recuperados dos 100 `STRUCT_RESULT_ITEMLIST` e 100
   `STRUCT_NEED_ITEMLIST` de `Mixlist.bin`. Combinar permanece bloqueado em
   modo somente leitura porque consumo, chance e resultado são autoritativos.
   Toxina de Serpente `#92` também está no runtime com a trava exata de
   `TMFieldScene::SkillUse`: exige garras `EF_WTYPE 41`, rejeita o Skytalos
   `WTYPE 101` antes de mana/cooldown e não desenha aura inventada, pois o
   `Affect 36` é somente estado/ícone em `TMHuman::CheckAffect`.
   A matriz agora registra dezessete skills Huntress no runtime e 19 registros
   ainda não promovidos, dos quais 17 são passivos e apenas `#241/#246`
   continuam sendo casts dependentes de regra autoritativa.
   Os oito casts restantes das quatro classes possuem bloqueio canônico em
   `ClassSkillBlockers.ts`; o catálogo `K` os identifica como `SERVIDOR` e o
   tooltip explica a dependência exata. A auditoria exporta os mesmos motivos
   em Markdown/JSON, evitando que a UI e a documentação divirjam.
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
16. Estimativa final para substituição integral dos assets originais —
    **concluída como estimativa, sem iniciar migração**.
    Usar a matriz de cobertura produzida pela auditoria técnica para dimensionar
    uma reconstrução visual do zero, sem executar a migração: separar mapas e
    terreno, arquitetura/props, personagens/classes, monstros/NPCs, montarias,
    itens/equipamentos, rigs/animações, VFX, áudio, fontes e interface; informar
    faixas de pessoa-mês, composição mínima/ideal da equipe, etapas, dependências,
    riscos e margem de incerteza. Comparar caminhos 1:1, remaster e redesign,
    incluindo pipeline de arte, validação e impacto no runtime, para que a decisão
    de abandonar todos os assets clássicos seja tomada sobre o inventário real do
    projeto e não sobre um chute prematuro. O resultado está em
    `docs/estimativa-substituicao-assets.md`, com inventário real, faixas por
    caminho/disciplina, equipe, calendário, pipeline, clean room e margem de
    incerteza.
17. Guia final para criação do servidor multiplayer — **documentação
    concluída no escopo disponível; não existe servidor-base**. Inventariar o
    protocolo exposto pelo cliente clássico e produzir um guia reproduzível para ligar
    este frontend a um backend autoritativo. O documento deve cobrir login e
    sessão, seleção/criação de personagem, gateway, mundos/channels, loop de
    simulação, movimento e colisão, spawn/IA, combate/skills/buffs, inventário,
    equipamento, loot, comércio, portais, quests, guild/grupo/chat, persistência
    e migrações. Incluir contratos de mensagens e versionamento, reconexão,
    idempotência, validação/anti-cheat, concorrência, segurança, observabilidade,
    backups, deploy, escalabilidade e um ambiente local passo a passo. Separar
    claramente o que foi comprovado pelo cliente, o que pertence ao futuro
    servidor e o que será uma decisão moderna; não copiar
    vulnerabilidades, credenciais ou regras desconhecidas por suposição. Como
    rede continua fora do escopo atual, esta tarefa gera arquitetura, roteiro e
    instruções, não ativa multiplayer silenciosamente no frontend. O guia está
    em `docs/guia-servidor-multiplayer.md`. A busca local não encontrou fonte
    de servidor; `Myth64.rar`, `serverlist.rar` e `Config.rar` contêm somente
    executável/configurações do cliente. O documento separa o que foi
    comprovado em `Basedef.h`/`CPSock.cpp`, o que é decisão moderna e tudo que
    deverá ser definido e validado durante a implementação futura. Uma eventual
    fonte legada poderá ser auditada depois, mas não é dependência desta fila.

## Convenções do projeto

- Usar `bun` para instalar dependências e executar scripts; não usar `npm`.

Rede e suíte de testes permanecem fora do escopo por decisão do projeto; cada
etapa fecha com build e inspeção manual focada.
