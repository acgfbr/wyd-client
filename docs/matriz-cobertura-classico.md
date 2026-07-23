# Matriz automatica de cobertura do cliente classico

Gerado por `bun run audit:coverage` em 2026-07-23T20:54:22.447Z. Este arquivo e
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
| Monstros/NPCs | `monsters` | 1340 | 37.2 MiB | .ani 555, .bon 47, .dds 337, .json 1, .msh 400 |
| Player | `player` | 509 | 29.6 MiB | .ani 171, .bon 23, .dds 130, .msa 5, .msh 180 |
| Montarias | `player/mounts` | 144 | 5.5 MiB | .ani 77, .bon 10, .dds 21, .msh 36 |
| Familiares | `player/familiars` | 6 | 128.7 KiB | .ani 1, .bon 1, .dds 2, .msh 2 |
| Evocacoes | `player/summons` | 94 | 3.2 MiB | .ani 63, .bon 7, .dds 9, .msh 15 |
| UI | `ui` | 37 | 6.5 MiB | .json 2, .png 34, .ttf 1 |
| Dados | `data` | 1 | 158.8 KiB | .json 1 |
| Comercio | `commerce` | 1 | 3.9 MiB | .json 1 |
| Navegacao | `navigation` | 2 | 1.5 MiB | .bin 1, .dat 1 |
| Audio | `audio` | 337 | 114.0 MiB | .json 1, .mp3 13, .wav 323 |

## Manifesto e dados estruturados

| Subsistema | Quantidade rastreada |
| --- | ---: |
| Texturas de terreno/ambiente | 238 |
| Texturas de efeitos | 495 |
| Texturas de agua | 5 |
| Modelos de objetos | 875 |
| Templates de NPC/monstro | 377 |
| Geradores de NPC/monstro | 3937 |
| Familias visuais | 47 |
| Objetos skinned catalogados | 49 |
| Registros de item | 6500 |
| Mapeamentos de icone | 6500 |
| Atlas de icones | 14 |
| Registros de skill | 248 |
| Arquivos TS dedicados a efeitos | 32 |
| Arquivos de audio importados | 336 |
| Entradas SFX no catalogo de audio | 333 |
| Musicas no catalogo de audio | 13 |
| IDs distintos de ação do AniSound | 82 |
| IDs de ação do AniSound ausentes | 0 |

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

Uma skill promovida possui definicao jogavel em `CLASS_SKILL_LOADOUTS`.
Registros marcados como passivos pelo proprio `SkillData.bin` ficam no
catalogo e nunca devem ocupar a barra. Isso nao prova por si so fidelidade
visual; a homologacao do renderer continua manual e rastreada em
`PENDENCIAS.md`.

| Classe | Importadas | Runtime | Indices ativos | Passivas fora da barra | Casts/buffs pendentes |
| --- | ---: | ---: | --- | ---: | ---: |
| TransKnight | 36 (24 normais + 12 master) | 22 | 0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 16, 17, 18, 19, 20, 21, 22, 23, 200 | 14 | 0 |
| Foema | 36 (24 normais + 12 master) | 24 | 24, 25, 26, 27, 28, 29, 30, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 43, 44, 45, 46, 47, 213, 216 | 8 | 4 |
| BeastMaster | 36 (24 normais + 12 master) | 24 | 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 66, 68, 70, 71, 224, 225, 235 | 10 | 2 |
| Huntress | 36 (24 normais + 12 master) | 17 | 72, 73, 75, 76, 77, 79, 80, 81, 83, 84, 85, 86, 87, 88, 89, 92, 95 | 17 | 2 |

### Casts/buffs ainda fora do runtime

- Foema `#31` Renascimento: exige um jogador aliado morto e confirmação autoritativa de renascimento.
- Foema `#42` Teleporte: exige grupo, consentimento, restrições de mapa e teleporte do servidor.
- Foema `#221` Incapacitador: o affect PvP e sua duração efetiva são aceitos pelo servidor.
- Foema `#223` Another Change: registro master sem instance, tick, affect ou renderer no cliente recuperado.
- BeastMaster `#226` Resi Decrease: redução de resistência e aplicação do affect são fórmulas do servidor.
- BeastMaster `#229` Invocação Final: InstanceValue 9 só é convertido em entidade pelo servidor via MSG_CreateMob.
- Huntress `#241` Absorção de Alma: registro master sem instance, tick, affect ou renderer no cliente recuperado.
- Huntress `#246` Bleeding: Affect 47 e o dano periódico de Bleeding pertencem ao servidor.

## Lacunas objetivas

- Audio: 333 entradas de SFX e 13 musicas; 82 IDs distintos do AniSound usados por atores, com 0 ausentes; 4 referencias do soundlist nao existem no corpus.
- Skills importadas mas ainda nao promovidas aparecem na tabela acima.
- Compra, venda, ownership, economia, drops e formulas autoritativas dependem
  do futuro servidor e nao podem ser inferidos desta matriz de assets.
- Cobertura fisica confirma existencia; animacao, bone, alpha, shader e escala
  ainda exigem homologacao visual por familia.
