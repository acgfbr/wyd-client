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
- HUD clássico, minimapa, seletor de mapas, câmera, zoom e modo G estão ligados.
- Build TypeScript/Vite verde em 21/07/2026.

## Implementado, mas ainda não homologado visualmente

- Saídas de Armia e altura das pontes após a máscara autoritativa.
- Pré-carregamento de monstros a 32 unidades da borda, com retenção até 45.
- Unicórnio item `2381`/visual `336`, `hs01` variante `07` completa em três
  partes e ações do bloco `[horse] 31`. A sela agora segue o bone `4` e a
  transformação `SetVecMantua(2, 31)`; aguarda homologação visual.
- Macro `F`, montaria `R`, arco à distância e hotkeys de skill `1–8`.

## Provisório — não considerar fiel ainda

- Poder/dano e geometria visual das skills ainda são aproximações; nomes,
  mana, delay e range já vêm do bloco Huntress do `SkillData.bin`.
- Fórmula de dano offline e rotação do macro ainda precisam ser confrontadas
  com o cliente/servidor disponível.

## Fila obrigatória

1. Locomoção, saídas e pontes.
   Reproduzir também o controle clássico em que manter os botões esquerdo e
   direito do mouse pressionados faz o personagem avançar na direção atual.
   Ao manter somente o botão esquerdo pressionado sobre o terreno, atualizar
   continuamente o destino sob o cursor e manter o personagem em movimento;
   soltar o botão encerra essa atualização, sem exigir cliques repetidos.
   Corrigir especificamente o gargalo em `2163,2102`: ao cruzar a ponte em
   linha reta o personagem fica preso e só passa após um desvio lateral;
   auditar a célula, vizinhas, máscara do objeto e transição de altura local,
   sem reabrir a revisão global das pontes já homologadas.
2. Streaming antecipado de mundo e criaturas.
3. `LOOK_INFO` da Huntress e guarda-roupa real. Implementado a partir de
   `SetPacketMOBItem`, `SetHumanCostume` e `SetCostume`: rosto/cabeça base,
   Rake, Loki, Waha e oito fantasias, totalizando 11 visuais selecionáveis.
4. Skytalos, refinação e Ancient. Implementado e homologado: item `2551`,
   refinação +15, composição `MODULATE2X + ADDSMOOTH`, UV animado em 4 s e
   empunhadura pelo banco de arco da Huntress.
5. Unicórnio nível 120 e pose montada. Implementado a partir do item `2381`,
   visual `336`, meshes `hs010[1-3]07`, bone de sela `4`, escala combinada
   `0.9` e multitextura de montaria `452` correspondente ao nível `120`;
   falta somente homologação visual dentro do jogo. Expandir para um seletor
   de várias montarias reais do cliente, nos moldes do seletor de trajes:
   todas no nível `120`, com item/skin/meshes/texturas, escala, bone de sela e
   conjunto de animações específicos, permitindo troca sem recarregar a página.
6. Ataque à distância e macro: corrigir a animação de arco pela ação original
   e sincronizar o disparo ao frame de soltura da flecha. A empunhadura em
   repouso já está correta, mas o ciclo de ataque com arco continua reprovado
   visualmente e não deve ser considerado homologado.
7. Skills Huntress: além da regra de combate, carregar os efeitos originais de
   conjuração, trajetória e impacto; o feedback visual atual é insuficiente.
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
11. HUD, áudio, efeitos e revisão manual dos mapas. Auditar especificamente os
    lotes de grama deslocados em `2104,2088` e `2129,2102`, comparando os
    registros DAT, pivô/rotação e a montagem original de `TMGrass/TMLeaf`.
    Abaixo do minimapa, adicionar telemetria compacta de FPS, memória usada e
    carga da thread principal (proxy de CPU, pois navegadores não expõem o uso
    real de CPU do processo de forma portável), com baixo custo de atualização.
12. Distribuição web: desenhar um build de produção com minificação agressiva,
    nomes/sourcemaps protegidos e ofuscação seletiva. Documentar que isso apenas
    eleva o custo de engenharia reversa; regras e segredos reais não podem
    depender de código entregue ao navegador.
13. Auditoria técnica final e cobertura do cliente clássico. Revisar o runtime
    contra as melhores práticas atuais do Three.js — ciclo de vida/dispose,
    cache e compartilhamento de GPU, draw calls/instancing, streaming, LOD,
    frustum/occlusion, materiais/shaders, animação, carregamento assíncrono e
    orçamento de memória/frame. Em paralelo, gerar uma matriz rastreável do que
    foi e não foi importado para todas as classes, monstros, NPCs, itens,
    equipamentos, montarias, animações, sons e efeitos; apontar os parsers e
    dados-fonte existentes, lacunas, dependências e a ordem segura para trazer
    o restante sem regressões visuais.

## Convenções do projeto

- Usar `bun` para instalar dependências e executar scripts; não usar `npm`.

Rede e suíte de testes permanecem fora do escopo por decisão do projeto; cada
etapa fecha com build e inspeção manual focada.
