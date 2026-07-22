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
  Explosão Etérea `#86` e Força Espectral `#101` está homologado. Os buffs
  persistem por `180 s`, com efeitos suavizados; a passiva `#101` acrescenta
  alcance e acopla o `SForce` clássico aos ataques.
- HUD clássico, minimapa, seletor de mapas, câmera, zoom e modo G estão ligados.
- A janela `C` usa `character2.wyt`, mostra progressão/atributos e distribui os
  pontos do mock offline. A tabela acumulada de EXP possui os 403 valores
  exatos de `g_pNextLevel` do cliente.
- Os 14 atlas `itemicon01..14`, a tabela `itemicon.bin` e o preview 3D giratório
  do inventário estão integrados; o preview compartilha renderer e cache de
  modelos com o mundo.
- Abaixo do minimapa, a telemetria agrega FPS, heap JS quando disponível e o
  tempo/ocupação da callback principal como proxy explicitamente não-CPU.
- Build TypeScript/Vite verde em 22/07/2026.

## Implementado, mas ainda não homologado visualmente

- Terreno usa margem base 28, antecipação direcional de até 60 e retenção 42;
  criaturas entram a 56 unidades da borda e permanecem até 64.
- Unicórnio item `2381`/visual `336`, `hs01` variante `07` completa em três
  partes e ações do bloco `[horse] 31`. A sela agora segue o bone `4` e a
  transformação `SetVecMantua(2, 31)`; aguarda homologação visual.
- Macro `F`, montaria `R`, arco à distância e hotkeys de skill `1–9`.
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
- Fórmula de dano offline e rotação do macro ainda precisam ser confrontadas
  com o cliente/servidor disponível. Enquanto o servidor não existe, cada
  nível concede `+3 ATQ` no estado do frontend e o combate usa esse total.

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
7. Skills e buffs completos por classe. Implementar a matriz de habilidades de
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
   Explosão Etérea `#86` já usa as lâminas e a trajetória clássicas. A passiva
   Força Espectral `#101` também já está sempre aprendida, acrescenta uma
   unidade ao alcance e acopla o `SForce` clássico de três camadas à arma em
   ataques normais e skills ofensivas, sem ocupar slot ou criar buff temporário.
   Esse recorte da Huntress está homologado; o épico só fecha depois da matriz
   completa das quatro classes. As oito evocações reais do BeastMaster já têm
   criação, skin/LOOK_INFO, animação `LEVELUP`, seguimento, escolha de alvo,
   ataque e descarte local, sem reutilizar o Griupan. O nascimento agora porta
   `TMEffectStart(type 1)` e `TMEffectLevelUp(type 0)` por entidade, com pool
   limitado a 40 efeitos. A auditoria confirmou que tempo de vida, IA, morte e
   remoção chegam do servidor como entidades `TMHuman`, não são regras do
   cliente; enquanto rede está fora do escopo, a formação de 10 e sua IA são
   uma política explícita do frontend. No futuro, a simulação local deverá ser
   substituída pelos packets autoritativos do servidor.
8. Isolamento completo do modo G — **concluído no frontend**. `G` usa velocidade
   64, ignora a navegação/colisão, bloqueia dano recebido, revive ao ativar e
   continua alimentando o streaming preditivo sem alterar o modo normal.
9. Progressão e painel de personagem — **frontend implementado, fidelidade
   parcial**. A janela `C` usa o atlas clássico, guarda e distribui
   `STR/INT/DEX/CON`, mostra pontos livres/EXP total e aplica a tabela exata
   `g_pNextLevel[403]`. Cada nível concede os `+5` pontos e `+3 ATQ` configurados
   no mock, toca `LEVELUP/MLVLUP` e dispara o efeito visual clássico. Ainda
   faltam as fórmulas autoritativas de atributos derivados e o som original;
   não inventar essas regras no cliente antes da camada de servidor/áudio.
10. NPCs, diálogo, lojas, portais, equipamento, inventário e loot — **parcial**.
    O inventário atual usa os sprites reais resolvidos por `itemicon.bin`; os
    14 atlas foram importados e itens com malha exibem preview 3D giratório,
    com sprite clássico ampliado como fallback. Poção, Skytalos e Mulher
    Kalintz já apontam para seus modelos reais. NPCs amistosos antes congelados
    alternam pausa/passeio em rota curta validada pela navegação e recebem um
    limite rígido após a separação, sem afetar hostis nem `RouteType 0`.
    Permanecem abertos diálogo, lojas, portais, equipamento real e expansão do
    loot/inventário. O Griupan solicitado já está equipado e homologado como
    familiar padrão.
11. HUD, áudio, efeitos e revisão manual dos mapas — **parcial**. A causa da
    grama deslocada em `2104,2088` e `2129,2102` foi rastreada no cliente:
    `TMLeaf/TMTree/TMShip` usam `TMSkinMesh` sem owner/type 1 e não recebem o
    mirror Z reservado a personagens. O runtime agora segue essa transformação;
    os DAT/MSH importados são idênticos à origem e os footprints `315/316`
    voltaram aos canteiros, aguardando inspeção visual. A telemetria abaixo do
    minimapa também está concluída: agrega uma vez por segundo FPS, heap JS
    (`performance.memory`, ou `—` no Safari/iPhone) e duração/ocupação da
    callback principal como `THREAD*`, sem alegar CPU real. Permanece aberta a
    camada de áudio e a revisão visual final dos mapas.
12. Distribuição web — **concluído para o escopo atual**. O build de produção
    não publica sourcemaps, remove comentários legais/`debugger`/`console.debug`,
    minifica identificadores/sintaxe/espaços e usa nomes de assets por hash. O
    README documenta o limite dessa proteção, instalação e comandos somente com
    Bun, preparo dos assets, erros comuns, iPhone/Vercel e a galeria de capturas
    reais, incluindo as quatro classes, evocações e os 111 mapas.
13. Auditoria técnica final e cobertura do cliente clássico. Revisar o runtime
    contra as melhores práticas atuais do Three.js — ciclo de vida/dispose,
    cache e compartilhamento de GPU, draw calls/instancing, streaming, LOD,
    frustum/occlusion, materiais/shaders, animação, carregamento assíncrono e
    orçamento de memória/frame. Em paralelo, gerar uma matriz rastreável do que
    foi e não foi importado para todas as classes, monstros, NPCs, itens,
    equipamentos, montarias, animações, sons e efeitos; apontar os parsers e
    dados-fonte existentes, lacunas, dependências e a ordem segura para trazer
    o restante sem regressões visuais.
14. Memória canônica do projeto. Depois da auditoria final, criar e consolidar
    `MEMORIA_PROJETO.md` com a arquitetura resultante, decisões e justificativas,
    fontes do cliente clássico por subsistema, formatos/parsers, descobertas,
    bugs corrigidos, bugs ainda conhecidos, limitações técnicas e de navegador,
    soluções rejeitadas, riscos, débitos, procedimentos de importação/build e
    um histórico cronológico das mudanças relevantes. Manter o documento vivo
    a partir daí, sem transformar `PENDENCIAS.md` em diário de implementação.

## Convenções do projeto

- Usar `bun` para instalar dependências e executar scripts; não usar `npm`.

Rede e suíte de testes permanecem fora do escopo por decisão do projeto; cada
etapa fecha com build e inspeção manual focada.
