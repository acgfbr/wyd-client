# Checklist de homologacao manual

Esta lista contem somente verificacoes que nao podem ser encerradas por analise
estatica ou build. Rede e regras autoritativas de servidor continuam fora do
escopo atual.

## Desktop

- Abrir Armia em `1024x768` e em widescreen; conferir HUD, chat, inventario,
  personagem, skills, loja, cargo, C.C e telemetria sem sobreposicao.
- Com o pacote de Armia já cacheado, recarregar e confirmar que a tela de boot
  só desaparece depois de terreno, prédios, água, efeitos e personagem estarem
  presentes, sem objetos surgindo progressivamente na primeira imagem.
- Registrar FPS, RAM JS, THREAD, GEO, TEX, CALLS e TRIS apos 60 s parado, apos
  cruzar dois Fields e com C.C ativo durante 60 s.
- Trocar sequencialmente Huntress, TransKnight, Foema e BeastMaster; voltar para
  Huntress e confirmar que GEO/TEX estabilizam, sem crescimento a cada ciclo.
- Montar, caminhar por C.C e atacar em seguida; confirmar a animacao de
  locomocao da montaria e a ausencia de elevacao durante o ataque da Huntress.
- Conferir Unicorno, Grifo e as demais montarias nivel 120 no seletor.
- Conferir a grama em `2104,2088` e `2129,2102`.
- Ouvir passos em pedra/grama/agua, ataques, dano, morte, level up, skills,
  monstros, cachoeira e chuva local. Confirmar que `M` nao silencia SFX.

## Safari / iPhone 15

- Abrir com a musica desligada por padrao; pressionar `M` depois de um gesto
  real e confirmar BGM. Repetir ataque/skill para validar SFX apos autoplay.
- Trocar as quatro classes e retornar a Armia, observando se o processo e
  encerrado pelo sistema por pressao de memoria.
- Alternar inventario/preview 3D, mapa, C.C e efeitos `V` com toque.
- Colocar a pagina em segundo plano e retornar; confirmar bfcache sem tela preta
  e sem duplicacao do loop principal.
- Recarregar fora do bfcache e confirmar que canvas, listeners e audio antigos
  foram descartados.

## Mapas

- Percorrer o indice de 111 Fields usando o seletor de desenvolvimento.
- Em cada Field, conferir terreno, bordas, objetos, agua, minimapa, criaturas e
  ausencia de plano preto; registrar coordenada e captura para qualquer desvio.
- Ausencia declarada de DAT ou minimapa deve ser comparada ao manifesto antes
  de ser tratada como erro.
- Homologar as rajadas `TMDust 531` no Field `4,24`; elas devem cair em ciclos,
  variar pela escala do DAT e desaparecer com `V`.
- Conferir os portais `2035` em `2366,3893` e `2366,3926`, as composições
  `1980` na faixa `3740..3923,2875..2876` e as coroas `1846` em
  `3818,2846`, `4031,4054` e `4031,4071`.
- Conferir as partes `TMHouse` em exemplos de cada família: `607` em
  `147,3781`, `614` em `377,3803`, `1750` em `803,4055`, `1739` em
  `1684,3674` e `1711` em `1796,3640`. As três peças do `607` devem girar em
  sentidos opostos; as demais partes devem acompanhar posição/ângulo da base.
- Em Armia, conferir o teto `252` da casa `251` em `2102,2114` e o teto `254`
  da casa `253` em `2072,2110`: longe devem ficar opacos, a menos de seis
  unidades devem ficar translúcidos e, ao cruzar a área interna marcada pelo
  `AttributeMap`, devem desaparecer para revelar o personagem.
- Conferir um objeto `1855` em `3740,2978` (Field `29,23`): ao entrar no
  quadrado de seis unidades ele deve ativar a transparência da própria textura
  sem sumir; ao sair, deve restaurar o material opaco.
- Conferir as partículas `TMHouse` em `225,3776` (`195`), `2531,1743` (`292`),
  `1926,4006` (`1526`), `657,3732` (`2005`) e `147,3781` (`607`). Devem nascer
  nos bocais/offsets da malha, repetir sem acumular objetos ou memória e sumir
  imediatamente com `V`. Um `1665` em `1291,1673` deve continuar sem respingo,
  pois esse branch retorna antes de criar partículas no cliente.
- Conferir os overlays de cenário em `1075,3514` (`1528→1555`),
  `1939,3979` (`1540→1556`), `1945,4031` (`1541→1557`), `1966,4017`
  (`1542→1558`), `1045,3478` (`1543→1559`) e `3732,3563`
  (`1597→1598`). A base deve permanecer opaca e o overlay escuro/emissivo deve
  coincidir com sua posição e ângulo, desaparecendo com `V`.
- Conferir `TMBike` em `1984,3981` (`1549`), `1978,3992` (`1550`) e
  `1169,4019` (`1551`): devem completar a oscilação `-3..+3` em 20 segundos
  pelo eixo indicado pelo ângulo, sem criar clones ou deslocar a posição-base
  após descarregar/recarregar o Field.

## Criterio de fechamento

Uma linha e considerada homologada somente com data, navegador/dispositivo e
captura ou valores de telemetria. Falha visual deve virar uma entrada reproduzivel
em `PENDENCIAS.md`; nao reabrir sistemas ja homologados sem regressao concreta.
