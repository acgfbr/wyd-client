# Checklist de homologacao manual

Esta lista contem somente verificacoes que nao podem ser encerradas por analise
estatica ou build. Rede e regras autoritativas de servidor continuam fora do
escopo atual.

## Desktop

- Abrir Armia em `1024x768` e em widescreen; conferir HUD, chat, inventario,
  personagem, skills, loja, cargo, C.C e telemetria sem sobreposicao.
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

## Criterio de fechamento

Uma linha e considerada homologada somente com data, navegador/dispositivo e
captura ou valores de telemetria. Falha visual deve virar uma entrada reproduzivel
em `PENDENCIAS.md`; nao reabrir sistemas ja homologados sem regressao concreta.
