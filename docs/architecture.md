# Arquitetura da reimplementação

O cliente clássico e seus arquivos originais são a especificação canônica. O WYD M é uma adaptação mobile reduzida: seus dados podem ajudar a localizar nomes e conceitos, mas não substituem formatos, conteúdo ou comportamento do clássico.

## Limites

- `core`: relógio, eventos, matemática e leitura binária; não conhece Three.js.
- `formats`: decoders puros e testados para `.trn`, `.msh`, `.wys` e tabelas.
- `world`: coordenadas WYD, streaming, terreno, colisão e pathfinding.
- `render`: adaptação do estado do jogo para Three.js.
- `game`: regras, entidades, combate e inventário; não acessa DOM.
- `ui`: HUD e telas.
- `app`: composição e ciclo de vida.

O navegador nunca lê a instalação original diretamente. Uma ferramenta de importação produzirá dados web em `public/game-data`, que fica ignorado pelo Git.

## Primeiro vertical slice

1. Decodificar e validar `Field*.trn` do cliente clássico.
2. Importar texturas mínimas de terreno.
3. Compor e fazer streaming dos blocos ao redor de Armia.
4. Reproduzir câmera, picking e movimento com colisão.
5. Só então adicionar objetos estáticos e personagem animado.
