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
| `NPCGener.txt` + `npcdb` | templates/geradores/Carry | um template segue nao resolvido: `Tower_de_Thor` |

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
no boot por ser a classe inicial. Medicao de 22/07/2026: app ~460 KiB, Three.js
~518 KiB e chunks de classe ~20/54/96 KiB, todos minificados.

## Personagem, equipamento e montarias

A Huntress padrao usa Mulher Kalintz, Skytalos Ancient +15 e Griupan. O
Skytalos e o item `2551`, mesh `762/bow16`, banco de arco `6` desmontado e `5`
montado, segunda textura `165` e UV U/V no ciclo classico de quatro segundos.
O passe Ancient segue `MODULATE2X + ADDSMOOTH`. Os adicionais atuais do Carry
de Utilidades sao `EF2=120`, `EF3=120`, `EF43=251`, grade 5; o tooltip calcula
`Dano de Perfuracao: 480`.

As skills Huntress promovidas ao runtime somam quatorze. Meditacao `#77` foi
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
formam pilhas de ate 50. TTL, ownership, moedas, `EF_GRID` multicelula e drop
tables sao dependencias do servidor.

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

## Limitacoes e riscos conhecidos

- Homologacao visual ainda e necessaria em 1024x768, widescreen e iPhone.
- Reload real, bfcache e contadores GEO/TEX antes/depois de trocas pesadas
  precisam de baseline manual.
- Nem todas as 248 skills possuem definicao jogavel e renderer fiel; a matriz
  automatica mostra a cobertura por classe.
- Audio possui 333 entradas SFX e 13 musicas importadas. O `mguardatt.wav`
  faltante no desktop veio do cliente mobile por correspondencia exata de
  nome; quatro referencias seguem ausentes, sem substituicao aproximada. O BGM segue o
  roteamento classico, inicia desligado e `M` alterna apenas a musica. Ataque,
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
  Espirito `#87` e Evasao Aprimorada `#89` promovidos no lote Huntress; Assalto
  `#11`, Espada da Fenix `#12` e Possuido `#13` promovidos no TransKnight.
  Assalto usa billboards `56/60` e som `168`; Espada da Fenix reutiliza o
  DoubleSwing nivel `1`; Possuido separa o burst type `4` da armadura critica
  persistente `2838/413`. A lacuna total caiu de 97 para 89 registros.
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
