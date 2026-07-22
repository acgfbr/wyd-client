# WYD Web — fila de reconstrução

Esta é a fila canônica do projeto. Itens visuais e regras de jogo só são
considerados fiéis quando possuem uma origem rastreável no cliente clássico.

## Baseline confirmada

- 111 Fields importados e conectados; terreno/objetos entram por streaming.
- WYT/WYS/TRN/DAT/MSA/MSH/BON/ANI possuem parsers próprios no runtime.
- `AttributeMap.dat` e `object.bin` compõem a máscara de colisão na ordem do
  cliente; pontes e plataformas também fornecem altura caminhável.
- NPCs/monstros têm streaming por Field, animação, autonomia, separação,
  combate, morte, respawn, EXP e drops offline.
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
- Build TypeScript/Vite verde em 22/07/2026.

## Implementado, mas ainda não homologado visualmente

- Saídas de Armia e altura das pontes após a máscara autoritativa.
- Pré-carregamento de monstros a 32 unidades da borda, com retenção até 45.
- Unicórnio item `2381`/visual `336`, `hs01` variante `07` completa em três
  partes e ações do bloco `[horse] 31`. A sela agora segue o bone `4` e a
  transformação `SetVecMantua(2, 31)`; aguarda homologação visual.
- Macro `F`, montaria `R`, arco à distância e hotkeys de skill `1–9`.
- Troca jogável entre TransKnight, Foema, BeastMaster e Huntress: os rigs
  `ch01/ch02`, `bExpand`, armaduras da seleção clássica, armas Ancient, bancos
  a pé/montado e attachments de mão já foram derivados do cliente. Cada classe
  possui traje base/armadura no seletor e um primeiro loadout auditado de três
  ataques e dois buffs; a Huntress conserva seus nove slots atuais.
- Controle contínuo implementado: manter o esquerdo atualiza o destino a cada
  `200 ms`; manter esquerdo+direito avança na direção da câmera e permite
  esterçar com o direito. A célula isolada em `2164,2102` agora recebe um
  microdesvio manual restrito, sem remover a colisão clássica nem liberar
  paredes/corrimãos. O conjunto aguarda homologação manual no navegador.

## Provisório — não considerar fiel ainda

- Poder/dano e geometria visual das skills ainda são aproximações; nomes,
  mana, delay, range, alvo, ações e estados dos primeiros loadouts das quatro
  classes já vêm do `SkillData.bin`.
- Fórmula de dano offline e rotação do macro ainda precisam ser confrontadas
  com o cliente/servidor disponível. Enquanto o servidor não existe, cada
  nível concede `+3 ATQ` no estado do frontend e o combate usa esse total.

## Fila obrigatória

1. Locomoção, saídas e pontes. O controle contínuo já está implementado:
   esquerdo mantido retargeta o chão, esquerdo+direito avança e esterça pela
   câmera, e ambos funcionam independentemente da ordem em que são
   pressionados. O gargalo relatado em `2163,2102` foi isolado no bloqueio
   `type 444` da célula vizinha `2164,2102`; o movimento manual agora contorna
   somente obstáculos unitários com rota curta e máscara autoritativa, nos dois
   sentidos. O clique continua usando A*. Falta homologar esses controles no
   navegador e permanece proibido reabrir a revisão global das pontes já
   homologadas.
2. Streaming antecipado de mundo e criaturas.
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
   chance de crítico foi definida em `35%` por ataque. A montaria permanece em
   locomoção/idle durante o ataque da Huntress. Regressão pendente relatada no
   macro: durante algumas aproximações automáticas com a Huntress montada, o
   personagem se desloca mas a montaria permanece visualmente em idle. Auditar
   a transição entre `MSTND/MRUN/MWALK`, o action lock do disparo e o novo
   `moveTo` do alvo, sincronizando a animação com deslocamento real sem fazer a
   montaria saltar durante o ataque.
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
   completa das quatro classes. Para BeastMaster, implementar também as
   evocações reais: criação do summon, skin/LOOK_INFO, VFX de entrada, tempo de
   vida, seguimento, escolha de alvo, ataque, morte e descarte/streaming conforme
   as rotinas originais, sem reutilizar o familiar Griupan como substituto.
8. Isolamento completo do modo G.
9. Progressão e painel de personagem: reproduzir a janela de status clássica,
    guardar `STR/INT/DEX/CON` e pontos livres, permitir distribuição e calcular
    atributos derivados pelas fórmulas originais. A animação, partículas e som
    de `LEVELUP` devem ocorrer no instante em que os pontos forem concedidos.
10. NPCs, diálogo, lojas, portais, equipamento, inventário e loot. O
    inventário precisa trocar as siglas provisórias pelos sprites clássicos e
    exibir, no hover, o modelo 3D real girando; itens sem malha usam o sprite
    clássico ampliado. NPCs devem fazer pequenas caminhadas aleatórias dentro
    de um raio curto do ponto original, alternando pausa/passeio e sempre
    retornando à sua área de origem, sem a autonomia ampla dos monstros.
    O Griupan solicitado neste pacote já está equipado e homologado como
    familiar padrão.
11. HUD, áudio, efeitos e revisão manual dos mapas. Auditar especificamente os
    lotes de grama deslocados em `2104,2088` e `2129,2102`, comparando os
    registros DAT, pivô/rotação e a montagem original de `TMGrass/TMLeaf`.
    Abaixo do minimapa, adicionar telemetria compacta de FPS, memória usada e
    carga da thread principal (proxy de CPU, pois navegadores não expõem o uso
    real de CPU do processo de forma portável), com baixo custo de atualização.
12. Distribuição web: desenhar um build de produção com minificação agressiva,
    nomes/sourcemaps protegidos e ofuscação seletiva. Documentar que isso apenas
    eleva o custo de engenharia reversa; regras e segredos reais não podem
    depender de código entregue ao navegador. Criar também no `README.md` um
    tutorial completo para quem clonou o repositório do zero: requisitos,
    instalação e execução exclusivamente com Bun, localização/preparo dos
    assets necessários, comandos de desenvolvimento e produção e resolução dos
    erros comuns de ambiente. Organizar capturas reais do jogo em uma pasta
    dedicada e montar no README uma galeria representativa de tudo que foi
    entregue — mapas/objetos, personagem e equipamentos, montarias, criaturas,
    combate/skills/buffs, efeitos, HUD e streaming — sem usar imagens que não
    correspondam ao estado atual do projeto.
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
