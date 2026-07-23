# Matriz automatica de cobertura do cliente classico

Gerado por `bun run audit:coverage` em 2026-07-23T02:57:25.689Z. Este arquivo e
derivado dos artefatos importados e do runtime; nao deve ser editado
manualmente. A analise e as decisoes ficam em `auditoria-threejs-cobertura.md`.

## Integridade dos imports

- 2285 caminhos unicos referenciados pelo manifesto.
- 0 caminhos referenciados ausentes.
- 111 Fields: 111 TRN,
  108 DAT declarados e 103
  minimapas declarados.
- Referencias declaradas ausentes: 0 DAT e
  0 minimapas.
- 111 capturas de mapa presentes na documentacao.

Nenhum arquivo referenciado pelo manifesto esta ausente.

## Inventario fisico

| Area | Diretorio | Arquivos | Tamanho | Extensoes |
| --- | --- | ---: | ---: | --- |
| Fields/TRN | `fields` | 111 | 5.2 MiB | .trn 111 |
| Objetos/DAT | `objects` | 108 | 3.6 MiB | .dat 108 |
| Minimapas/WYT | `minimaps` | 103 | 4.8 MiB | .wyt 103 |
| Modelos de mapa | `models` | 1222 | 35.2 MiB | .dds 347, .msa 875 |
| Texturas de ambiente | `textures/env` | 238 | 2.5 MiB | .dds 238 |
| Texturas de efeitos | `textures/effects` | 495 | 15.7 MiB | .dds 495 |
| Texturas de agua | `textures/water` | 5 | 67.0 KiB | .dds 5 |
| Monstros/NPCs | `monsters` | 1334 | 37.1 MiB | .ani 554, .bon 46, .dds 335, .json 1, .msh 398 |
| Player | `player` | 450 | 23.5 MiB | .ani 141, .bon 18, .dds 120, .msa 5, .msh 166 |
| Montarias | `player/mounts` | 144 | 5.5 MiB | .ani 77, .bon 10, .dds 21, .msh 36 |
| Familiares | `player/familiars` | 6 | 128.7 KiB | .ani 1, .bon 1, .dds 2, .msh 2 |
| Evocacoes | `player/summons` | 94 | 3.2 MiB | .ani 63, .bon 7, .dds 9, .msh 15 |
| UI | `ui` | 35 | 6.3 MiB | .json 1, .png 33, .ttf 1 |
| Dados | `data` | 1 | 158.8 KiB | .json 1 |
| Comercio | `commerce` | 1 | 3.9 MiB | .json 1 |
| Navegacao | `navigation` | 2 | 1.5 MiB | .bin 1, .dat 1 |
| Audio | `audio` | 336 | 114.0 MiB | .json 1, .mp3 13, .wav 322 |

## Manifesto e dados estruturados

| Subsistema | Quantidade rastreada |
| --- | ---: |
| Texturas de terreno/ambiente | 238 |
| Texturas de efeitos | 495 |
| Texturas de agua | 5 |
| Modelos de objetos | 875 |
| Templates de NPC/monstro | 377 |
| Geradores de NPC/monstro | 3937 |
| Familias visuais | 46 |
| Objetos skinned catalogados | 49 |
| Registros de item | 6500 |
| Mapeamentos de icone | 6500 |
| Atlas de icones | 14 |
| Registros de skill | 248 |
| Arquivos TS dedicados a efeitos | 27 |
| Arquivos de audio importados | 335 |
| Entradas SFX no catalogo de audio | 332 |
| Musicas no catalogo de audio | 13 |

Templates de NPC/monstro nao resolvidos: 1.
Templates comerciais nao resolvidos: 1.

## Player, looks, montarias e evocacoes

| Classe | Looks expostos no runtime |
| --- | ---: |
| TransKnight | 2 |
| Foema | 2 |
| BeastMaster | 2 |
| Huntress | 14 |

- Looks especializados da Huntress: 12.
- Montarias selecionaveis: 14, em
  9 familias (bd02, be01, bo01, dr01, dr02, hs01, tg01, tw01, wf01).
- Evocacoes do BeastMaster: 8.

## Skills: import binario x promocao no runtime

Uma skill promovida possui definicao jogavel em `CLASS_SKILL_LOADOUTS`. Isso
nao prova por si so fidelidade visual; a homologacao do renderer continua
manual e rastreada em `PENDENCIAS.md`.

| Classe | Importadas | Runtime | Indices ativos | Ainda nao promovidas |
| --- | ---: | ---: | --- | ---: |
| TransKnight | 36 (24 normais + 12 master) | 7 | 0, 1, 2, 3, 5, 19, 23 | 29 |
| Foema | 36 (24 normais + 12 master) | 15 | 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 43, 44, 45, 46, 47 | 21 |
| BeastMaster | 36 (24 normais + 12 master) | 16 | 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63 | 20 |
| Huntress | 36 (24 normais + 12 master) | 9 | 72, 75, 76, 79, 80, 81, 86, 88, 95 | 27 |

## Lacunas objetivas

- Audio: 332 entradas de SFX e 13 musicas; 5 referencias do soundlist nao existem no corpus.
- Skills importadas mas ainda nao promovidas aparecem na tabela acima.
- Compra, venda, ownership, economia, drops e formulas autoritativas dependem
  do futuro servidor e nao podem ser inferidos desta matriz de assets.
- Cobertura fisica confirma existencia; animacao, bone, alpha, shader e escala
  ainda exigem homologacao visual por familia.
