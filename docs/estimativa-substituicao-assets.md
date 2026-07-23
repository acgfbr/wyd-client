# Estimativa para substituir todos os assets clássicos

Data-base: 2026-07-23. Esta é somente uma estimativa de esforço; nenhuma
migração foi iniciada.

## Inventário usado

A estimativa parte da matriz gerada pelo projeto, não apenas do que aparece em
Armia:

- 111 terrenos, 108 arquivos de objetos e 103 minimapas;
- 875 modelos estáticos de mapa e 347 texturas associadas;
- 238 texturas de terreno, 495 de efeitos e cinco de água;
- 47 famílias visuais de monstros/NPCs, 400 MSH, 555 ANI e 337 texturas;
- quatro classes, 166 MSH de player e 141 ANI;
- 14 montarias de nove famílias e oito famílias de summon;
- 6.500 registros/ícones de item em 14 atlas;
- 248 skills catalogadas;
- 333 SFX, 13 músicas, fontes e 33 imagens de UI.

Esses números não significam 6.500 modelos de item nem 111 kits artísticos
independentes: há muito reuso. Antes de contratar produção em escala, um
inventário de quatro a seis semanas deve agrupar duplicatas, variantes,
recolorações e dependências de rig.

## Resultado resumido

| Caminho | Esforço total | Equipe ideal | Calendário provável |
| --- | ---: | ---: | ---: |
| Substituição 1:1 | 80–135 pessoa-mês | 7–9 pessoas | 14–22 meses |
| Remaster fiel | 120–200 pessoa-mês | 9–12 pessoas | 18–28 meses |
| Redesign completo | 165–275 pessoa-mês | 10–14 pessoas | 24–38 meses |

Margem de incerteza atual: aproximadamente `±35%`. Ela cai depois do
inventário/deduplicação e de um vertical slice aprovado. Pessoa-mês não se
converte linearmente em calendário: adicionar artistas aumenta revisão,
integração e consistência.

## O que cada caminho significa

### 1. Substituição 1:1

Mantém silhueta funcional, escala, pivôs, footprint, bones, duração de
animações, slots, terrenos e leitura visual. Troca arquivos e acabamento sem
redesenhar o jogo.

Vantagens:

- menor alteração em colisão, câmera, gameplay e VFX;
- pode preservar os importadores e contratos de runtime;
- permite substituir por lotes e comparar lado a lado.

Riscos:

- reproduzir demais a aparência pode não resolver a independência de
  propriedade intelectual;
- restrições do rig/formato antigo continuam limitando a arte;
- qualidade final pode parecer inconsistente se só alguns lotes forem novos.

### 2. Remaster fiel

Preserva identidade e layout, mas cria geometria, textura, materiais,
animações, iluminação e VFX modernos. Exige LOD, compressão e orçamento mobile.

Além do caminho 1:1, inclui:

- materiais PBR e mapas adicionais;
- novas variações modulares para reduzir repetição;
- revisão de rig/deformação e animações;
- passe completo de iluminação, pós-processamento e legibilidade;
- perfil de qualidade para desktop/iPhone.

### 3. Redesign completo

Cria direção de arte, silhuetas, mundo, UI, áudio e efeitos próprios. É o único
caminho que pode gerar identidade realmente independente, mas deixa de ser uma
simples troca de assets.

Impactos:

- métricas de modelos e edifícios mudam colisão, navegação e câmera;
- mapas precisam de novo blockout e homologação;
- equipamentos exigem sistema modular/skin próprio;
- skills precisam de linguagem visual nova;
- UI, nomes, áudio e narrativa entram no mesmo esforço.

## Faixas por disciplina

As faixas abaixo representam um remaster fiel e podem se sobrepor no
calendário:

| Frente | Pessoa-mês |
| --- | ---: |
| Direção de arte, conceito e style guide | 6–10 |
| Terreno, 111 mapas, biomas e minimapas | 18–30 |
| Arquitetura e props modulares | 20–34 |
| Quatro classes e equipamentos visuais | 14–24 |
| Monstros e NPCs | 16–28 |
| Montarias, familiares e summons | 7–12 |
| Itens, ícones e apresentação de inventário | 8–14 |
| Rigging e animação | 14–24 |
| VFX de skills, buffs, clima e ambiente | 12–20 |
| UI, fontes e identidade | 8–14 |
| Áudio e música | 5–9 |
| Pipeline, tech art, integração e QA visual | 15–25 |

O total resumido é menor que a soma máxima porque algumas frentes compartilham
produção, tech art e QA; usar todos os máximos representa um escopo premium,
próximo do redesign.

## Equipe

Equipe mínima viável, com calendário longo:

- uma direção de arte/concept/UI;
- dois artistas de ambiente;
- um artista de personagem/criatura;
- um animator/rigger;
- um tech artist/VFX com suporte de engenharia;
- áudio e QA em dedicação parcial.

Equipe ideal para o remaster:

- diretor(a) de arte e produtor(a);
- dois ou três artistas de ambiente/props;
- dois artistas de personagem/criatura;
- animator/rigger;
- tech artist;
- VFX artist;
- UI/UX artist;
- áudio parcial;
- QA visual/integration;
- suporte recorrente de um engenheiro Three.js.

## Pipeline recomendado

1. Congelar métricas de gameplay: unidade, pivô, slot, footprint, bones e
   envelopes de animação.
2. Gerar inventário por hash/família e classificar `reusar`, `variante`,
   `recriar` e `eliminar`.
3. Definir style guide e orçamento por plataforma: triângulos, materiais,
   texturas, bones, draw calls e memória.
4. Produzir um vertical slice de Armia com uma classe, dez criaturas, uma
   montaria, uma loja, água, fogo e dez skills.
5. Medir desktop e iPhone antes de aprovar o pipeline.
6. Produzir kits modulares por bioma, depois classes/criaturas/equipamentos.
7. Migrar por manifesto com fallback explícito; nunca misturar silenciosamente
   asset novo e antigo.
8. Fazer homologação visual dos 111 mapas e das famílias de atores.
9. Remover o pacote clássico somente quando a matriz chegar a 100% sem
   referências.

Formatos recomendados para o runtime novo:

- glTF/GLB para modelos, rigs e animações;
- KTX2/Basis para texturas comprimidas;
- atlas somente onde reduz draw calls sem degradar streaming;
- áudio moderno com variantes e normalização;
- metadados versionados separados do arquivo artístico.

O Three.js pode continuar. A migração de arte não exige trocar renderer; exige
adaptar materiais, loaders, LOD e orçamento de memória.

## Clean room e direitos

Se o objetivo é abandonar assets clássicos por risco jurídico ou para criar IP
própria, não basta redesenhar a textura sobre o mesmo arquivo. O processo deve:

- guardar apenas métricas funcionais necessárias ao gameplay;
- usar brief e conceitos novos, com autoria/rastreabilidade;
- evitar entregar o asset original ao artista quando isso não for necessário;
- registrar licenças de fontes, áudio, brushes, scans e bibliotecas;
- obter revisão jurídica antes de distribuição comercial.

Esta seção não é aconselhamento jurídico; é um requisito de produção para que
o investimento não termine em outro conjunto de assets sem proveniência.

## Recomendação

Fazer primeiro um vertical slice de remaster fiel, estimado em 8–12
pessoa-mês, cobrindo Armia e todos os tipos de pipeline. Ele permite medir
qualidade, custo por família, desempenho no iPhone e grau real de reuso.

Só depois escolher:

- 1:1, se a prioridade for lançar rápido com risco visual controlado;
- remaster, se a prioridade for qualidade mantendo a estrutura do WYD;
- redesign, se a prioridade for identidade própria e independência de longo
  prazo.

Sem esse slice, comprometer 120–200 pessoa-mês seria uma decisão baseada em
contagem de arquivos, não em velocidade real da equipe.
