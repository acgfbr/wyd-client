# WYD Web — fila de reconstrução

Esta é a fila canônica do projeto. Itens visuais e regras de jogo só são
considerados fiéis quando possuem uma origem rastreável no cliente clássico.

## Baseline confirmada

- 111 Fields importados e conectados; terreno/objetos entram por streaming.
- WYT/WYS/TRN/DAT/MSA/MSH/BON/ANI possuem parsers próprios no runtime.
- `AttributeMap.dat` e `object.bin` compõem a máscara de colisão na ordem do
  cliente; pontes e plataformas também fornecem altura caminhável.
- NPCs/monstros têm streaming por Field, animação, autonomia, separação,
  combate, morte, respawn, EXP e drops offline. NPCs amistosos de rota curta
  fazem um passeio offline determinístico de 1–1,75 unidade, sempre contido em
  2,25 unidades da origem; guardas `RouteType 0` permanecem fixos.
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
  possui traje base/armadura no seletor e um primeiro loadout auditado de três
  ataques e dois buffs; a Huntress conserva seus nove slots atuais.
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
   autoritativo. Essa view já alimenta as 40 células visuais da loja: os 27
   slots `Carry` preservam seus vazios e os 13 restantes ficam vazios como no
   atlas; ícone, nome, requisitos, efeitos e preço estático vêm do catálogo. O
   Aki, por exemplo, expõe os 14 itens recuperados de seu template. Selecionar
   continua sendo apenas apresentação; ainda faltam no servidor compra/venda,
   saldo, Tax, cargo, combinação, missões, loot e persistência, e nenhuma dessas
   operações deve ser simulada como autoritativa.
   Para portais, o runtime reconhece o bit `0x10` do `AttributeMap`, cruza as 37
   entradas exatas de `g_TeleportTable` e abre o prompt clássico quando o
   personagem para sobre a célula. O prompt abre uma vez por entrada, não
   reaparece enquanto o personagem permanece nela e é limpo ao sair, morrer,
   trocar de classe/Field ou teleportar. Confirmar ainda não move o personagem
   nem cobra preço: destino, autorização e transição continuam pendentes do
   servidor. Também restam dimensões multicélula dos
   itens e a ligação final do catálogo ao loot. NPCs amistosos mantêm o passeio
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
    callback principal como `THREAD*`, sem alegar CPU real. Permanece aberta a
    camada de áudio e a revisão visual final dos mapas.
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
    o restante sem regressões visuais.
13. Memória canônica do projeto. Depois da auditoria final, criar e consolidar
    `MEMORIA_PROJETO.md` com a arquitetura resultante, decisões e justificativas,
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
    respawn e teleporte limpam somente o estado transitório necessário. A
    auditoria também registrou que o macro `Y`/`m_cAutoAttack` do cliente é um
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
   genéricos compartilhados entre classes. Para a Huntress, o catálogo binário,
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
