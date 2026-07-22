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
- HUD clássico, minimapa, seletor de mapas, câmera, zoom e modo G estão ligados.
- Build TypeScript/Vite verde em 21/07/2026.

## Implementado, mas ainda não homologado visualmente

- Saídas de Armia e altura das pontes após a máscara autoritativa.
- Pré-carregamento de monstros a 32 unidades da borda, com retenção até 45.
- Unicórnio `hs01` variante 19 e ações do bloco `[horse] 31`; a montagem atual
  está deformada e ainda permite ação a pé, portanto não está homologada.
- Macro `F`, montaria `R`, arco à distância e hotkeys de skill `1–8`.

## Provisório — não considerar fiel ainda

- Huntress montada com a variante 69 nos seis parts: isso não corresponde ao
  `LOOK_INFO`; rosto/base e equipamentos precisam ser resolvidos por slot.
- Aura ciano do Skytalos: ainda não foi ligada ao caminho real de refinação e
  Ancient. O orbe inventado já foi removido.
- Altura de sela `1.05` e escala do Unicórnio ainda precisam sair de `TMHuman`.
- Poder/dano e geometria visual das skills ainda são aproximações; nomes,
  mana, delay e range já vêm do bloco Huntress do `SkillData.bin`.
- Fórmula de dano offline e rotação do macro ainda precisam ser confrontadas
  com o cliente/servidor disponível.

## Fila obrigatória

1. Locomoção, saídas e pontes.
   Reproduzir também o controle clássico em que manter os botões esquerdo e
   direito do mouse pressionados faz o personagem avançar na direção atual.
2. Streaming antecipado de mundo e criaturas.
3. Fogueira `2109,2079` e efeitos de mapa. As fontes já carregam as malhas
   secundárias de água de `TMHouse` e o fluxo foi corrigido para seguir o eixo
   longitudinal; falta homologar a fogueira e implementar um atalho global de
   efeitos com o mesmo estado `g_bHideEffect` do cliente clássico.
4. `LOOK_INFO` da Huntress e guarda-roupa real.
5. Skytalos, refinação e Ancient.
6. Unicórnio nível 120 e pose montada.
7. Ataque à distância e macro: corrigir a animação de arco pela ação original
   e sincronizar o disparo ao frame de soltura da flecha.
8. Skills Huntress: além da regra de combate, carregar os efeitos originais de
   conjuração, trajetória e impacto; o feedback visual atual é insuficiente.
9. Isolamento completo do modo G.
10. Progressão e painel de personagem: reproduzir a janela de status clássica,
    guardar `STR/INT/DEX/CON` e pontos livres, permitir distribuição e calcular
    atributos derivados pelas fórmulas originais. A animação, partículas e som
    de `LEVELUP` devem ocorrer no instante em que os pontos forem concedidos.
11. NPCs, diálogo, lojas, portais, equipamento, inventário e loot. O
    inventário precisa trocar as siglas provisórias pelos sprites clássicos e
    exibir, no hover, o modelo 3D real girando; itens sem malha usam o sprite
    clássico ampliado.
12. HUD, áudio, efeitos e revisão manual dos mapas. Auditar especificamente os
    lotes de grama deslocados em `2104,2088` e `2129,2102`, comparando os
    registros DAT, pivô/rotação e a montagem original de `TMGrass/TMLeaf`.
    Abaixo do minimapa, adicionar telemetria compacta de FPS, memória usada e
    carga da thread principal (proxy de CPU, pois navegadores não expõem o uso
    real de CPU do processo de forma portável), com baixo custo de atualização.
13. Distribuição web: desenhar um build de produção com minificação agressiva,
    nomes/sourcemaps protegidos e ofuscação seletiva. Documentar que isso apenas
    eleva o custo de engenharia reversa; regras e segredos reais não podem
    depender de código entregue ao navegador.

## Convenções do projeto

- Usar `bun` para instalar dependências e executar scripts; não usar `npm`.

Rede e suíte de testes permanecem fora do escopo por decisão do projeto; cada
etapa fecha com build e inspeção manual focada.
