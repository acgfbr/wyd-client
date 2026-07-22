# WYD Web

Reimplementação do cliente clássico de **With Your Destiny** para o navegador,
escrita do zero em TypeScript e Three.js. O cliente clássico/decompilado é usado
como referência de formatos e comportamento; o código web antigo não é
reutilizado.

> Projeto em desenvolvimento e atualmente offline: rede e servidor ainda não
> fazem parte deste recorte. Consulte a [fila canônica](PENDENCIAS.md) para ver o
> que está homologado e o que ainda é provisório.

## Estado atual

- 111 Fields importados, nomeados, conectados e carregados dinamicamente.
- Terreno, objetos, colisão, pontes, água, efeitos ambientais e minimapa.
- Huntress com Mulher Kalintz, Skytalos Ancient +15 animado e Griupan.
- 14 montarias clássicas nível 120, incluindo Unicórnio e Grifo.
- NPCs e monstros com animação, autonomia, separação, combate, morte e respawn.
- Movimento por WASD/clique, câmera clássica, zoom amplo e modo G.
- Macro de combate, arco, dano/crítico, skills e buffs da Huntress.
- HUD clássico, inventário provisório, catálogo de skills e seletor de mapas.

## Capturas do build atual

| Armia, HUD, minimapa e seletor | Huntress, Skytalos Ancient e Griupan |
| --- | --- |
| ![Armia com HUD e minimapa](docs/screenshots/01-armia-mundo-hud.jpg) | ![Huntress com Skytalos Ancient e Griupan](docs/screenshots/02-huntress-skytalos-griupan.jpg) |

| Inventário, trajes e montarias | Grifo nível 120 |
| --- | --- |
| ![Inventário com seletores de traje e montaria](docs/screenshots/03-inventario-trajes-montarias.jpg) | ![Huntress montada no Grifo nível 120](docs/screenshots/04-grifo-nivel-120.jpg) |

| Buff persistente da Huntress | Catálogo clássico de skills |
| --- | --- |
| ![Buff persistente da Huntress](docs/screenshots/05-buffs-huntress.jpg) | ![Catálogo de skills importado do cliente](docs/screenshots/06-catalogo-skills.jpg) |

| Criaturas no mundo aberto | Visão geral de Armia |
| --- | --- |
| ![Criaturas e cenário em Erion](docs/screenshots/maps/026-field-19-15-erion.jpg) | ![Armia vista com câmera aberta](docs/screenshots/maps/028-field-16-16-armia.jpg) |

Uma captura real foi gerada para cada Field disponível. Veja a
**[galeria completa dos 111 mapas](docs/screenshots/maps/README.md)**.

## Rodando do zero

### Requisitos

- [Git](https://git-scm.com/).
- [Bun 1.x](https://bun.sh/docs/installation) — este projeto não usa npm.
- Navegador desktop atual com WebGL 2 e aceleração de hardware habilitada.
- Aproximadamente 500 MB livres para repositório, dependências e build.

### 1. Clonar e instalar

```bash
git clone git@github.com:acgfbr/wyd-client.git
cd wyd-client
bun install --frozen-lockfile
```

O repositório atual já inclui `public/game-data/classic`. Confirme que o pacote
de dados veio no clone:

```bash
test -f public/game-data/classic/manifest.json && echo "assets OK"
```

### 2. Iniciar o jogo

```bash
bun run dev
```

Abra [http://localhost:5173](http://localhost:5173). O jogo começa em Armia, na
coordenada `2100, 2100`. Se a porta estiver ocupada, o Vite mostrará no terminal
a próxima porta utilizada.

### 3. Validar um build de produção

```bash
bun run build
bun run preview
```

O build é escrito em `dist/`; o preview normalmente abre em
[http://localhost:4173](http://localhost:4173).

## Recriando os assets a partir do cliente clássico

Esta etapa é opcional quando `public/game-data/classic` já veio no clone. Use-a
para reconstruir o pacote a partir dos seus próprios arquivos do cliente:

```text
Origem/
├── Env/
├── Effect/
├── mesh/
├── UI/
├── NUI/
├── object.bin
├── ItemList.bin
├── Itemname.txt
├── SkillData.bin
└── AniSound4.txt

tools/data/
├── NPCGener.txt
└── npcdb/
```

Execute o importador único passando caminhos absolutos:

```bash
bun run import:all -- \
  "/caminho/para/Origem" \
  "/caminho/para/tools/data"
```

Sem argumentos, ele procura `../tjs/Origem` e `../tjs/tools/data`, relativos a
este repositório:

```bash
bun run import:all
```

O comando executa, em ordem, os importadores de mundo/criaturas, personagem,
skills e UI. Para depuração, eles também podem ser chamados separadamente:

```bash
bun run import:classic -- "/caminho/para/Origem" "/caminho/para/tools/data"
bun run import:player -- "/caminho/para/Origem"
bun run import:skills -- "/caminho/para/Origem"
bun run import:ui -- "/caminho/para/Origem"
```

## Controles

| Entrada | Ação |
| --- | --- |
| `WASD` / setas | Mover o personagem |
| Clique esquerdo | Caminhar até o ponto ou selecionar um alvo |
| Esquerdo mantido | Atualizar continuamente o destino |
| Esquerdo + direito | Avançar na direção da câmera |
| Direito arrastado | Girar a câmera |
| Roda do mouse | Zoom de `3.5` a `180` unidades |
| `Q` / `E` | Girar a câmera pelo teclado |
| `G` | Modo GM: velocidade extrema, invencibilidade e sem colisão |
| `R` | Montar/desmontar |
| `F` | Ligar/desligar o macro de combate |
| `1`–`9` | Usar skills da barra |
| `I` | Abrir/fechar inventário, trajes e montarias |
| `K` | Abrir/fechar catálogo de skills |
| `V` | Ligar/desligar todos os efeitos visuais |

## Deploy na Vercel com `public/game-data`

O Vite copia automaticamente `public/game-data` para `dist/game-data`. Como os
assets já estão versionados, o caminho recomendado é o deploy pela integração
Git da Vercel:

1. Envie o repositório para GitHub/GitLab/Bitbucket.
2. Na Vercel, escolha **Add New → Project** e importe o repositório.
3. Mantenha o preset **Vite**. O [`vercel.json`](vercel.json) já configura:
   `bun install --frozen-lockfile`, `bun run build` e saída `dist`.
4. Clique em **Deploy** e valide `/game-data/classic/manifest.json` na URL
   publicada antes de abrir o jogo.

O pacote atual possui cerca de 135 MB. No plano Hobby, a Vercel limita uploads
de arquivos-fonte feitos pela CLI a 100 MB; por isso, prefira a integração Git
para este repositório. O limite documentado e os demais limites atuais estão na
[documentação oficial da Vercel](https://vercel.com/docs/limits). Se futuramente
os assets forem migrados para Git LFS, habilite **Git LFS** em *Project Settings
→ Git* antes de redeployar; a Vercel possui
[suporte oficial a LFS](https://vercel.com/docs/project-configuration/git-settings#git-large-file-storage-lfs).

Os assets clássicos podem estar sujeitos aos direitos dos respectivos
proprietários. Antes de publicar um repositório ou deployment aberto, confirme
que você tem autorização para distribuí-los.

## Problemas comuns

| Sintoma | Correção |
| --- | --- |
| `Assets não importados` | Confirme `public/game-data/classic/manifest.json` ou rode `bun run import:all`. |
| Personagem vira cápsula / traje ou montaria ausente | Rode `bun run import:player`. |
| HUD sem imagens | Rode `bun run import:ui`. |
| Menu de skills pede importação | Rode `bun run import:skills`. |
| `NPCGener.txt` ou `npcdb` ausente | Corrija o segundo caminho passado ao `import:all`. |
| Erro de nome de arquivo no Linux | Preserve exatamente as pastas `Env`, `Effect`, `UI`, `NUI` e `mesh`. |
| Tela preta ou erro WebGL | Atualize o navegador/driver e habilite aceleração de hardware. |
| Vercel publica o app, mas assets retornam 404 | Confirme que `public/game-data` está versionado e que `manifest.json` existe no deployment. |

## Estrutura principal

```text
src/app/                 orquestração do jogo
src/assets/              fonte e manifesto dos assets importados
src/formats/classic/     parsers dos formatos clássicos
src/game/                player, combate, criaturas, montarias e estado
src/render/              terreno, modelos, água e efeitos
src/world/               Fields, streaming, coordenadas e navegação
src/ui/                  HUD e minimapa
tools/                   importadores do cliente clássico
public/game-data/        pacote web gerado/versionado
docs/screenshots/        capturas reais usadas na documentação
```

Mais detalhes estão em [docs/architecture.md](docs/architecture.md).
