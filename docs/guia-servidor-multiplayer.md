# Guia de servidor multiplayer autoritativo

Data da auditoria: 2026-07-23.

Este documento descreve como ligar o frontend Three.js a um servidor
multiplayer sem mover regras sensíveis para o navegador. Ele é um roteiro de
implementação; nenhuma conexão de rede foi ativada no jogo.

## Estado das fontes

Foram procurados diretórios e arquivos com nomes `server`, `servidor`, `DBSRV`,
`TMServer`, `GameServer`, `WorldServer` e `LoginServer` em `../tjs`, nos
projetos locais e em Downloads. Nenhuma fonte de servidor foi encontrada.

Os três RAR do cliente contêm somente:

- `Myth64.rar`: `Myth64.exe`;
- `Conf/serverlist.rar`: `serverlist.bin`;
- `Conf/Config.rar`: `Config.bin`.

Portanto:

- **Comprovado pelo cliente** significa que a estrutura ou o fluxo aparece em
  `tm-project2/Projects/TMProject`.
- **A definir no servidor futuro** significa que o cliente não contém a regra
  autoritativa e ela não deve ser inferida.
- **Decisão moderna** significa uma escolha de arquitetura para o cliente web,
  não uma propriedade do WYD clássico.

Não existe servidor-base para este projeto. Quando a implementação do backend
começar, a primeira tarefa deve ser gerar uma matriz que associe handler,
schema moderno, persistência e regra de domínio a cada mensagem abaixo.

## O que o cliente clássico comprova

O cliente abre TCP na porta `8281`, envia o inteiro little-endian
`INIT_CODE=521270033` e depois troca pacotes cujo cabeçalho C++ é:

```text
Size:u16 | KeyWord:u8 | CheckSum:u8 | Type:u16 | ID:u16 | Tick:u32
```

`CPSock.cpp` aplica uma transformação byte a byte baseada em uma tabela de 512
bytes e valida checksum. Isso é ofuscação de protocolo, não criptografia.
Layouts completos devem ser lidos em `Basedef.h`; copiar `sizeof(struct)` para
outra linguagem sem conferir alinhamento, sinal e endian gera corrupção
silenciosa.

Fluxos recuperados relevantes:

| Domínio | Mensagens comprovadas |
| --- | --- |
| Login | `AccountLogin 0x20D`, `CNFAccountLogin 0x10A` |
| Personagem | `NewCharacter 0x20F`, `DeleteCharacter 0x211`, `CharacterLogin 0x213`, `CNFCharacterLogin 0x114` |
| Mudança de servidor | `ReqTransper 0xFAA`, `CNFRemoveServer` |
| Entidades | `CreateMob 0x364`, `CreateMobTrade 0x363`, `REQMobByID 0x369`, `RemoveMob` |
| Movimento | `Action 0x36C`, `Action2 0x368`, `Action_Stop 0x366`, `Motion 0x36A` |
| Combate | `Attack_Multi 0x367`, `Attack_One 0x39D`, `Attack_Two 0x39E`, `UpdateScore 0x336`, `UpdateAffect 0x3B9` |
| Inventário | `UseItem 0x373`, `SwapItem 0x376`, `SendItem 0x182`, `UpdateItem 0x374`, `SplitItem 0x2E5` |
| Drop | `DropItem 0x272`, `GetItem 0x270`, `CreateItem`, `CNFDropItem`, `CNFGetItem` |
| Comércio | `REQShopList 0x27B`, `ShopList 0x17C`, `Buy 0x379`, `Sell 0x37A`, `RepurchaseItems 0x3E8` |
| Chat | `MessageChat 0x333`, `MessageWhisper 0x334`, `MessageShout 0xD1D` |
| Grupo | `REQParty 0x37F`, `CNFParty2 0x3AB`, `AddParty` |
| Sessão | `Ping 0x3A0`, `SysQuit/DelayStart 0x3AE` |

O login recuperado envia `Version=1758`. A senha e a tabela de transformação do
cliente antigo não constituem autenticação segura e não devem ser expostas no
protocolo web.

## Arquitetura recomendada

Começar com um monólito modular em Bun é mais seguro que criar vários serviços
antes de haver jogadores. Os limites internos já devem permitir separação
posterior.

```text
Browser Three.js
    |
    | HTTPS: login/refresh
    | WSS: intents, snapshots e eventos
    v
Gateway + sessão (Bun)
    |
    +-- World loop / interesse espacial
    +-- Combate, skills e buffs
    +-- Inventário, loot e comércio
    +-- Party, guild, chat e quests
    |
    +-- PostgreSQL: estado durável
    +-- Redis opcional: presença, leases e filas entre processos
```

O browser não abre TCP bruto. Se compatibilidade com o executável 7.54 for
necessária, criar um gateway TCP legado separado:

```text
Cliente 7.54 -- TCP 8281/protocolo antigo -- Legacy Gateway
                                                  |
Web client ----- WSS/protocolo moderno -----------+-- comandos de domínio
```

O gateway legado traduz mensagens; o núcleo do jogo não deve conhecer
`KeyWord`, checksum ou structs C++.

## Limites dos módulos

- `auth`: conta, hash de senha, bloqueio, refresh token e revogação.
- `session`: conexão ativa, personagem selecionado, reconexão e rate limit.
- `world`: Field, posição, interesse espacial, colisão e portais.
- `actors`: players, NPCs, monstros, summons e ciclo de vida.
- `combat`: alvo, alcance, cooldown, custo, acerto, crítico, dano, morte e EXP.
- `effects`: buffs/debuffs autoritativos e expiração por tick.
- `inventory`: bolsas, equipamento, stack, cargo, drop e revisão atômica.
- `economy`: lojas, preço, moeda, taxas e auditoria.
- `social`: chat, party, guild e bloqueios.
- `persistence`: transações, snapshots, migrations e outbox.
- `protocol`: schemas versionados; nenhum acesso direto ao banco.

As fórmulas devem ser funções puras que recebem estado/configuração e devolvem
resultado. A emissão de VFX continua no frontend, a partir do evento aceito
pelo servidor.

## Contrato web

Use `wss://` e autentique o socket com ticket curto emitido por HTTPS. Não
coloque senha, refresh token ou segredo permanente na URL.

Todo envelope precisa de:

```ts
interface Envelope<T> {
  version: 1;
  kind: string;
  seq: number;
  ack: number;
  requestId?: string;
  serverTick?: number;
  payload: T;
}
```

JSON é suficiente para o primeiro vertical slice. Depois de medir, snapshots de
alta frequência podem migrar para `ArrayBuffer`; login, inventário e economia
não precisam ser binários. Schema e semântica devem permanecer versionados.

Intenções mínimas do cliente:

- `session.resume`;
- `character.select`;
- `move.intent` com destino e sequência de input;
- `combat.attack` e `skill.cast`;
- `item.pickup`, `inventory.move`, `item.use`, `equipment.change`;
- `shop.buy`, `shop.sell`;
- `chat.send`;
- `portal.use`.

Eventos mínimos do servidor:

- `session.ready` e `session.rejected`;
- `world.snapshot`, `actor.spawn`, `actor.delta`, `actor.remove`;
- `move.corrected`;
- `combat.started`, `combat.result`, `actor.died`, `level.changed`;
- `buff.applied`, `buff.refreshed`, `buff.removed`;
- `inventory.snapshot`, `inventory.changed`, `request.rejected`;
- `chat.message`.

Cada mutação econômica usa `requestId` idempotente e `inventoryRevision`. Se a
revisão enviada estiver velha, o servidor rejeita e retorna snapshot novo.

## Loop autoritativo

1. Receber intenção e validar formato, sessão e limite de frequência.
2. Enfileirar pelo `serverTick`; nunca alterar o mundo dentro do callback do
   socket.
3. No tick, validar estado, posição, colisão, alcance, mana, cooldown, item e
   alvo.
4. Calcular o resultado com RNG do servidor.
5. Aplicar tudo em memória em uma única transição.
6. Publicar deltas somente para jogadores na área de interesse.
7. Persistir alterações duráveis por transação/outbox.

Começar em 10 ou 20 ticks/s. O frontend continua renderizando a 60 Hz e
interpola outros atores entre snapshots. O jogador local pode predizer
movimento, mas deve aceitar correção do servidor.

O modo `G` atual é ferramenta offline. Em multiplayer ele não concede
velocidade, invencibilidade ou noclip; no máximo pode existir em conta GM
auditada e autorizada pelo servidor.

## Movimento e interesse espacial

- Reutilizar no servidor os dados `TRN`, AttributeMap, object masks e regras de
  altura já parseados pelo frontend, extraindo-os para um pacote compartilhado
  sem dependência de Three.js/DOM.
- O cliente envia destino/input, não uma posição final confiável.
- O servidor limita distância por tick, valida célula, ponte, altura e portal.
- Dividir o mundo pelas células dos Fields de 128 unidades já usadas no
  streaming.
- Enviar spawn antes de o ator entrar na câmera, com margem de interesse e
  histerese equivalentes ao carregamento atual.
- Monstros continuam simulados fora da tela do jogador; a câmera nunca decide
  se a IA vive.

## Combate, skills, buffs e summons

- O cliente pede ataque/skill; o servidor escolhe se pode executar.
- Crítico, dano, defesa, resistências, custo, cooldown, EXP e loot são
  autoritativos. Os 35% e a progressão de ataque atuais são mocks de frontend e
  viram configuração/regra do servidor.
- O servidor responde com skill, caster, alvos, resultado, crítico e tick. O
  frontend resolve animação, trajetória, impacto, som e número de dano.
- Buffs guardam `sourceId`, `skillId`, nível, stacks, início e expiração. O
  efeito visual persiste enquanto o estado autoritativo estiver ativo.
- Transformações do BeastMaster mudam LOOK/score no servidor e notificam o
  cliente; não devem ser simuladas como aura.
- Cada summon é uma entidade com dono, IA, duração, HP e ID próprios. O número
  “10 por cast” atual deve virar regra configurável, não confiança no browser.

## Inventário, drop e economia

- Item no banco precisa de ID de instância, template, adicionais, refino,
  Ancient, quantidade, slot/local e versão.
- Stack só ocorre quando template e todos os atributos empilháveis coincidem.
- Mover/equipar usa transação atômica e valida classe, nível, slot, footprint
  `EF_GRID`, quantidade e revisão.
- Drop possui ID, posição, owner/party, janela de exclusividade e expiração.
- Espaço/Z são apenas controles de apresentação; pickup só termina após
  `inventory.changed`.
- Compra/venda nunca aceita preço informado pelo cliente. O servidor resolve
  tabela, imposto, estoque e saldo.
- Toda criação/destruição de item e moeda gera ledger auditável.

### Quests temporizadas e instâncias

O frontend já apresenta Cemitério e Cabuncle em ciclos locais de dez minutos,
mas o servidor deve publicar `serverNow`, `cycleStartedAt`, `cycleEndsAt` e um
`questInstanceId`. A entrada precisa validar nível, classe/Arch, item ou moeda
exigidos e capacidade antes de consumir qualquer recurso, tudo na mesma
transação idempotente. O personagem recebe uma participação vinculada à
instância; apenas participantes vivos e presentes podem entrar na lista de
ameaça dos monstros daquela quest. Sair, desconectar, expirar o ciclo ou trocar
de Field remove o alvo e manda a criatura retornar, sem confiar na posição ou
no relógio enviados pelo navegador.

Drops de quest, itens que concedem EXP ao usar e a recompensa final também são
eventos autoritativos. O catálogo do cliente prova a existência da
`Vela_do_Coveiro #4038` e da `Varinha_do_Carbunkle #701`, mas não prova custo,
chance, EXP nem regra de consumo. Essas tabelas devem ser confrontadas com o
servidor futuro antes de virar configuração de produção.

## Persistência mínima

Tabelas iniciais:

- `accounts`, `account_sessions`;
- `characters`, `character_stats`, `character_skills`, `character_buffs`;
- `item_instances`, `inventory_slots`, `cargo_slots`;
- `world_drops`;
- `guilds`, `guild_members`, `parties`;
- `quest_progress`;
- `economy_ledger`;
- `outbox_events`, `schema_migrations`.

Usar UUID/ULID para entidades persistentes e IDs compactos por sessão para
replicação. Salvar posição segura, não cada frame. Alterações de item/moeda e
progresso relevante entram em transação.

## Segurança e anti-cheat

- TLS obrigatório; senha com Argon2id e salt individual.
- Access token curto, refresh token rotativo e armazenado como hash.
- Limites por IP, conta, socket e tipo de comando.
- Tamanho máximo de frame e schemas estritos; fechar socket em pacote inválido.
- Nunca aceitar do cliente HP, MP, dano, crítico, EXP, ouro, item criado,
  cooldown encerrado ou posição impossível.
- Usar relógio monotônico do servidor. `Tick` do cliente é apenas correlação.
- Registrar login, GM, trade, loja, drop, pickup, refinamento e moeda.
- Não portar a transformação de bytes de `CPSock` como “segurança”.
- Segredos somente em variáveis de ambiente; sem credenciais no repositório.

## Reconexão e concorrência

- Um personagem possui um lease de sessão; nova conexão invalida ou transfere o
  lease de forma explícita.
- O cliente reconecta com ticket curto e último `ack`.
- O servidor devolve snapshot completo quando o histórico incremental não
  estiver mais disponível.
- `requestId` recente fica deduplicado por sessão.
- Alterações de inventário usam versão otimista e transação.
- Desconexão não remove imediatamente o personagem em combate; aplicar uma
  janela configurável e segura.

## Observabilidade e operação

Métricas mínimas:

- sockets ativos, autenticações, reconexões e rejeições;
- duração do tick, ticks atrasados e tamanho das filas;
- atores e mensagens por zona;
- latência de comando e correções de movimento;
- erros de persistência, conflitos de revisão e outbox atrasada;
- criação/destruição de itens e variação de moeda.

Logs estruturados devem incluir `requestId`, `sessionId`, `characterId`,
`worldId` e `serverTick`, sem senha/token. Adicionar health/readiness, tracing
dos comandos críticos, alertas de tick e backup PostgreSQL testado por restore.

## Estrutura sugerida

```text
server/
  package.json
  src/
    main.ts
    config.ts
    protocol/
    auth/
    session/
    world/
    actors/
    combat/
    inventory/
    economy/
    social/
    persistence/
  migrations/
  scripts/
packages/
  classic-data/     parsers e constantes sem Three.js
  protocol/         schemas compartilhados browser/servidor
```

Comandos devem seguir a decisão do projeto de usar Bun:

```bash
cd server
bun install --frozen-lockfile
bun run db:migrate
bun run dev
```

Variáveis mínimas:

```dotenv
DATABASE_URL=postgresql://...
SESSION_SIGNING_KEY=...
PUBLIC_ORIGIN=https://...
WORLD_ID=armia-1
PORT=8080
```

## Ordem de implementação

1. Extrair pacote compartilhado de coordenadas, TRN e colisão.
2. Criar login HTTPS, ticket de socket e seleção de personagem.
3. Entregar um único Field com dois players, spawn e movimento autoritativo.
4. Adicionar reconexão, interesse espacial e transição entre Fields.
5. Migrar ataque básico, morte/respawn e barra HP/MP.
6. Migrar inventário/equipamento/drop com revisão e idempotência.
7. Migrar skills, buffs, summons e loot.
8. Adicionar comércio, chat, party, guild, portais e quests; para Cemitério e
   Cabuncle, migrar o contador local para tempo/instância autoritativos e
   restringir a ameaça aos participantes registrados.
9. Fazer carga, segurança, observabilidade, backups e deploy.
10. Só então avaliar gateway TCP compatível com o executável clássico.

O primeiro marco aceitável é: dois navegadores autenticados veem um ao outro,
andam por Armia, reconectam sem duplicar personagem e recebem correção ao tentar
atravessar uma colisão. Não começar por guild, refino ou dezenas de skills.

## Critérios para validar o servidor futuro

- caminho e commit/versão da fonte;
- processo de login, DB e world/channel;
- linguagem, compilador, dependências e formato do banco;
- tabela de handlers por opcode;
- ownership de dano, buffs, loot, economia e movimento;
- packing/endian/checksum e handshake;
- condições de corrida, SQL construído por string e segredos embutidos;
- jobs, timers e limites de arrays;
- diferenças entre versão do servidor e `Version=1758`;
- partes reutilizáveis, partes somente de referência e partes que devem ser
  descartadas por segurança.

Sem essa validação, o protocolo recuperado do cliente é apenas referência de
compatibilidade, não fundamento para regras autoritativas de produção.
