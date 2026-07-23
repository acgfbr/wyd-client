import "./style.css";
import { GameApp } from "./app/GameApp";

const app = document.querySelector<HTMLElement>("#app");

if (!app) throw new Error("Elemento #app não encontrado");

app.innerHTML = `
  <section id="loading" class="boot-screen">
    <div class="boot-emblem" aria-hidden="true">WYD</div>
    <p class="eyebrow">WITH YOUR DESTINY</p>
    <h1>Entrando em Armia</h1>
    <p id="loading-status">Carregando terreno clássico…</p>
  </section>

  <section id="target-status" class="target-status" aria-live="polite">
    <div class="target-heading"><strong id="target-name">Alvo</strong><span id="target-level">MONSTRO</span></div>
    <div class="hud-bar is-target"><i id="target-hp-fill"></i><span id="target-hp-text"></span></div>
  </section>

  <aside class="minimap-panel">
    <div class="location-panel"><span id="location-name">Armia</span><strong id="coordinates">2100, 2100</strong></div>
    <div class="minimap-bezel"><canvas id="minimap" width="168" height="168"></canvas></div>
    <span id="minimap-field">Armia · Field 16 · 16</span>
    <section id="runtime-telemetry" class="runtime-telemetry" aria-label="Telemetria local de desempenho" title="THREAD* é um proxy do tempo síncrono da thread principal, não o uso real de CPU.">
      <div><span>FPS</span><b id="telemetry-fps">—</b></div>
      <div><span>RAM JS</span><b id="telemetry-memory">—</b></div>
      <div><span>THREAD*</span><b id="telemetry-thread">—</b></div>
      <div><span>GEO</span><b id="telemetry-geometries">—</b></div>
      <div><span>TEX</span><b id="telemetry-textures">—</b></div>
      <div><span>CALLS</span><b id="telemetry-draw-calls">—</b></div>
      <div><span>TRIS</span><b id="telemetry-triangles">—</b></div>
      <small>* THREAD não é CPU real · GEO/TEX/CALLS/TRIS vêm do WebGLRenderer</small>
    </section>
  </aside>

  <aside id="map-teleport" class="map-teleport">
    <div class="classic-window-title"><span>MAPAS</span><small>ATALHO DE DESENVOLVIMENTO</small></div>
    <label for="map-select">Destino</label>
    <select id="map-select" aria-label="Escolher mapa para teleporte"><option>Carregando mapas…</option></select>
    <div class="map-teleport-meta"><span id="map-count">Lendo mapas…</span><span id="map-load-status">Conexões N/S/L/O</span></div>
  </aside>

  <div class="classic-mode-status" aria-label="Estados especiais">
    <div id="speed-boost" class="speed-boost"><kbd>G</kbd><span>GM</span></div>
    <div id="mount-status" class="mount-status"><kbd>R</kbd><span>Montaria</span></div>
    <div id="auto-combat" class="auto-combat"><kbd>F</kbd><span>Auto OFF</span></div>
    <div id="effects-status" class="effects-status is-active" title="Liga/desliga os efeitos visuais"><kbd>V</kbd><span>FX ON</span></div>
  </div>

  <section id="buff-status" class="buff-status" aria-label="Buffs ativos"></section>

  <section class="player-status">
    <div class="vital-orb is-hp" aria-hidden="true"><i></i><span>HP</span></div>
    <div class="vital-orb is-mp" aria-hidden="true"><i></i><span>MP</span></div>
    <div class="classic-mainbar" aria-hidden="true"></div>
    <div class="player-readout">
      <div class="player-identity"><strong id="player-name">Huntress</strong><span id="player-level">Lv. 1</span><small>Skytalos</small></div>
      <div class="hud-bar is-hp"><b>HP</b><i id="player-hp-fill"></i><span id="player-hp-text">180 / 180</span></div>
      <div class="hud-bar is-mp"><b>MP</b><i id="player-mp-fill"></i><span id="player-mp-text">90 / 90</span></div>
      <div class="hud-bar is-exp"><b>EXP</b><i id="player-exp-fill"></i><span id="player-exp-text">0 / 1105</span></div>
    </div>
    <div class="classic-hotbar" aria-label="Barra de atalhos">
      <button id="skill-slot-1" type="button" data-key="1"><span class="quickslot-icon">➶</span><span class="skill-name">Flecha</span><kbd>1</kbd><span class="skill-cooldown"></span></button>
      <button id="skill-slot-2" type="button" data-key="2"><span class="quickslot-icon">✦</span><span class="skill-name">Temp.</span><kbd>2</kbd><span class="skill-cooldown"></span></button>
      <button id="skill-slot-3" type="button" data-key="3"><span class="quickslot-icon">☠</span><span class="skill-name">Veneno</span><kbd>3</kbd><span class="skill-cooldown"></span></button>
      <button id="skill-slot-4" type="button" data-key="4"><span class="quickslot-icon">✧</span><span class="skill-name">Evasão</span><kbd>4</kbd><span class="skill-cooldown"></span></button>
      <button id="skill-slot-5" type="button" data-key="5"><span class="quickslot-icon">♞</span><span class="skill-name">Fera</span><kbd>5</kbd><span class="skill-cooldown"></span></button>
      <button id="skill-slot-6" type="button" data-key="6"><span class="quickslot-icon">✣</span><span class="skill-name">Caçada</span><kbd>6</kbd><span class="skill-cooldown"></span></button>
      <button id="skill-slot-7" type="button" data-key="7"><span class="quickslot-icon">♜</span><span class="skill-name">Skytalos</span><kbd>7</kbd><span class="skill-cooldown"></span></button>
      <button id="skill-slot-8" type="button" data-key="8"><span class="quickslot-icon">♘</span><span class="skill-name">Montar</span><kbd>8</kbd><span class="skill-cooldown"></span></button>
      <button id="skill-slot-9" type="button" data-key="9"><span class="quickslot-icon">◈</span><span class="skill-name">Ligação</span><kbd>9</kbd><span class="skill-cooldown"></span></button>
      <button type="button" data-key="0" title="0 · Poção de HP"><span class="quickslot-icon potion">HP</span><kbd>0</kbd><small id="quickslot-1-count">5</small></button>
    </div>
    <div class="classic-menu-actions" aria-label="Ações da interface clássica">
      <button id="hud-cc-button" class="classic-round-action is-cc" type="button" aria-label="Configurar o C.C de combate" aria-expanded="false" aria-controls="cc-panel" title="C.C · configurar macro de combate">C.C</button>
      <button id="hud-menu-button" class="classic-round-action is-menu" type="button" aria-label="Abrir o menu do jogo" title="Menu do jogo">MENU</button>
    </div>
    <section id="cc-panel" class="cc-panel" aria-label="Configuração do combate contínuo" aria-hidden="true">
      <div class="cc-classic-strip">
        <button id="cc-mode-cycle" type="button" data-cc-mode-cycle aria-label="Modo do C.C: desligado" title="Controle de Combate"><span id="cc-mode-name">Desligado</span></button>
        <button id="cc-recovery-cycle" type="button" aria-label="Recuperação automática em 30 por cento" title="HP/MP automático"><span id="cc-recovery-value">30</span></button>
        <button id="cc-mount-cycle" type="button" aria-label="Montaria em 30 por cento" title="HP/ração da montaria"><span id="cc-mount-value">30</span></button>
        <button id="cc-position-cycle" type="button" data-cc-position="continuous" aria-label="Movimentação contínua" title="Movimentação contínua"><span id="cc-position-name">Contínua</span></button>
      </div>
      <section class="cc-rotation" aria-labelledby="cc-rotation-title">
        <div class="cc-rotation-heading">
          <div><strong id="cc-rotation-title">Rotação mágica</strong><small>Web: somente skills ofensivas presentes na barra</small></div>
          <b id="cc-skill-count">0 / 10</b>
        </div>
        <div id="cc-skill-list" class="cc-skill-list"></div>
        <footer>
          <span id="cc-profile-status">C.C desligado</span>
          <small><kbd>F</kbd> alterna o modo · a lista abre no mágico</small>
        </footer>
      </section>
    </section>
  </section>

  <section class="classic-chat-shell" aria-label="Chat e registro de combate">
    <div class="chat-tabs" role="tablist" aria-label="Canal do chat">
      <button class="is-active" type="button" role="tab" aria-selected="true" data-chat-channel="general">GERAL</button>
      <button type="button" role="tab" aria-selected="false" data-chat-channel="party">GRUPO</button>
      <button type="button" role="tab" aria-selected="false" data-chat-channel="guild">GUILD</button>
    </div>
    <section id="combat-log" class="combat-log" aria-live="polite"></section>
    <div class="chat-frame" aria-hidden="true"></div>
    <div class="chat-input">
      <button id="chat-channel-label" type="button" aria-label="Alternar canal do chat" title="Clique para alternar o canal">Todos</button>
      <input id="chat-message" type="text" maxlength="127" autocomplete="off" spellcheck="false" aria-label="Mensagem do chat" placeholder="Pressione Enter para conversar" />
    </div>
  </section>

  <section id="game-menu-panel" class="game-menu-panel" aria-label="Menu do jogo" aria-hidden="true">
    <header><strong>MENU</strong><button type="button" aria-label="Fechar menu" data-game-menu-close>×</button></header>
    <button type="button" data-game-menu-action="resume">Continuar</button>
    <button type="button" data-game-menu-action="character">Personagem <kbd>C</kbd></button>
    <button type="button" data-game-menu-action="inventory">Inventário <kbd>I</kbd></button>
    <button type="button" data-game-menu-action="skills">Skills <kbd>K</kbd></button>
    <button type="button" data-game-menu-action="macro">Configurar C.C <kbd>F</kbd></button>
    <div class="game-menu-divider"><span>Sistema clássico</span></div>
    <button type="button" data-game-menu-action="server">Selecionar servidor <em>REDE</em></button>
    <button type="button" data-game-menu-action="character-select">Selecionar personagem <em>REDE</em></button>
    <button type="button" data-game-menu-action="quit">Sair do jogo <em>REDE</em></button>
    <small>As ações de sessão aguardam a futura camada de rede.</small>
  </section>

  <section id="ground-portal-prompt" class="ground-portal-prompt" role="dialog" aria-modal="true" aria-labelledby="ground-portal-prompt-title" aria-describedby="ground-portal-prompt-message ground-portal-prompt-price" aria-hidden="true">
    <div class="ground-portal-prompt-surface">
      <strong id="ground-portal-prompt-title" class="ground-portal-prompt-title">Informação</strong>
      <p id="ground-portal-prompt-message" class="ground-portal-prompt-message">Deseja ir para este destino?</p>
      <p id="ground-portal-prompt-price" class="ground-portal-prompt-price" aria-hidden="true"></p>
      <button type="button" class="ground-portal-prompt-confirm" data-ground-portal-confirm>Confirmar</button>
      <button type="button" class="ground-portal-prompt-cancel" data-ground-portal-cancel>Cancelar</button>
    </div>
  </section>

  <section id="npc-interaction" class="npc-interaction" role="dialog" aria-modal="false" aria-labelledby="npc-interaction-name" aria-describedby="npc-interaction-message" aria-hidden="true">
    <div class="npc-interaction-surface">
      <header>
        <strong id="npc-interaction-name">NPC</strong>
        <span id="npc-interaction-kind">INTERAÇÃO</span>
        <button type="button" aria-label="Fechar interação" data-npc-interaction-close>×</button>
      </header>
      <div id="npc-interaction-slots" class="npc-interaction-slots" aria-hidden="true"></div>
      <div class="npc-interaction-panel-copy"><p id="npc-interaction-message"></p></div>
    </div>
    <footer class="npc-interaction-authority">
      <strong id="npc-interaction-authority-title">Dados clássicos</strong>
      <span id="npc-interaction-authority-detail"></span>
      <small id="npc-interaction-source"></small>
    </footer>
  </section>

  <section id="character-panel" class="character-panel" aria-label="Dados do personagem" aria-hidden="true">
    <header><strong>PERSONAGEM</strong><button type="button" aria-label="Fechar dados do personagem" data-character-close>×</button></header>
    <div class="character-summary">
      <div class="is-name"><span>Nome</span><b id="character-name">Huntress</b></div>
      <div class="is-level"><span>Lv.</span><b id="character-level">1</b></div>
      <div class="is-wide"><span>EXP total</span><b id="character-exp-total">0</b></div>
      <div class="is-wide"><span>Próximo nível</span><b id="character-exp-next">500</b></div>
      <div class="is-points"><span>Pontos</span><b id="character-points">0</b></div>
    </div>
    <section class="character-primary" aria-label="Atributos primários">
      <h2>Atributos</h2>
      <div><span>FOR</span><b id="character-str">8</b><button type="button" data-character-attribute="str" aria-label="Adicionar um ponto em Força">+</button></div>
      <div><span>INT</span><b id="character-int">8</b><button type="button" data-character-attribute="int" aria-label="Adicionar um ponto em Inteligência">+</button></div>
      <div><span>DES</span><b id="character-dex">12</b><button type="button" data-character-attribute="dex" aria-label="Adicionar um ponto em Destreza">+</button></div>
      <div><span>CON</span><b id="character-con">8</b><button type="button" data-character-attribute="con" aria-label="Adicionar um ponto em Constituição">+</button></div>
    </section>
    <section class="character-derived" aria-label="Dados de combate offline">
      <h2>Combate <small>offline</small></h2>
      <div><span>HP</span><b id="character-hp">260 / 260</b></div>
      <div><span>MP</span><b id="character-mp">280 / 280</b></div>
      <div><span>Ataque</span><b id="character-attack">52</b></div>
      <div><span>Defesa</span><b id="character-defense">14</b></div>
    </section>
    <section class="character-progress" aria-label="Progresso do personagem">
      <div><span>EXP do nível</span><b id="character-exp-current">0 / 500</b></div>
      <div><span>Gold</span><b id="character-coins">0</b></div>
      <p id="character-offline-note">Frontend offline: +5 pontos e +3 ATQ por nível</p>
    </section>
    <footer><kbd>C</kbd><span>abre/fecha · valores derivados são mock do frontend</span></footer>
  </section>

  <section id="inventory-panel" class="inventory-panel">
    <header><strong>Equipamento</strong><button type="button" aria-label="Fechar inventário" data-inventory-close>×</button></header>
    <div id="inventory-equipment" class="inventory-equipment" aria-label="Itens equipados"></div>
    <details class="inventory-visual-controls">
      <summary>Visuais</summary>
      <div class="inventory-outfit">
        <label for="player-class-select">Classe ativa</label>
        <select id="player-class-select" aria-label="Selecionar classe do personagem">
          <option value="huntress">Huntress</option>
        </select>
        <small id="player-class-status">Huntress · personagem atual</small>
        <label id="outfit-label" for="outfit-select">Traje da Huntress</label>
        <select id="outfit-select" aria-label="Selecionar traje do personagem"><option>Carregando…</option></select>
        <small id="outfit-status">Carregando visual clássico…</small>
        <label for="mount-select">Montaria Lv. 120</label>
        <select id="mount-select" aria-label="Selecionar montaria nível 120"><option>Carregando…</option></select>
        <small id="mount-select-status">Carregando montarias clássicas…</small>
      </div>
    </details>
    <div id="inventory-grid" class="inventory-grid"></div>
    <nav id="inventory-bags" class="inventory-bags" aria-label="Bolsas do inventário">
      <button type="button" data-inventory-bag="0" aria-label="Abrir bolsa 1" aria-pressed="true"><span>1</span></button>
      <button type="button" data-inventory-bag="1" aria-label="Abrir bolsa 2" aria-pressed="false"><span>2</span></button>
      <button type="button" data-inventory-bag="2" aria-label="Abrir bolsa 3" aria-pressed="false"><span>3</span></button>
      <button type="button" data-inventory-bag="3" aria-label="Abrir bolsa 4" aria-pressed="false"><span>4</span></button>
    </nav>
    <div id="inventory-preview" class="inventory-preview" aria-label="Modelo 3D do item selecionado" aria-hidden="true">
      <div id="inventory-preview-viewport" class="inventory-preview-viewport" aria-hidden="true">
        <span id="inventory-preview-fallback" class="inventory-preview-fallback"></span>
      </div>
    </div>
    <div class="inventory-gold"><span>Gold</span><b id="player-coins">0</b></div>
    <p>Clique: pegar/preview · mova o mouse e clique para soltar · duplo clique: usar/equipar</p>
  </section>

  <section id="skill-panel" class="skill-panel" aria-label="Skills clássicas">
    <header><strong>SKILLS</strong><button type="button" aria-label="Fechar skills" data-skills-close>×</button></header>
    <div class="skill-panel-toolbar">
      <label for="skill-class-select">Classe</label>
      <select id="skill-class-select" aria-label="Classe exibida">
        <option value="huntress">Huntress</option>
      </select>
      <small><kbd>K</kbd> abre/fecha</small>
    </div>
    <div id="skill-catalog-status" class="skill-catalog-status">Carregando SkillData.bin…</div>
    <div id="skill-catalog-grid" class="skill-catalog-grid"></div>
  </section>

  <aside id="game-tooltip" class="game-tooltip" role="tooltip" aria-hidden="true">
    <strong data-tooltip-title></strong>
    <p data-tooltip-description hidden></p>
    <div data-tooltip-lines hidden></div>
  </aside>

  <div class="controls-hint"><span>WASD</span> mover · <span>Q/E</span> câmera · <span>RODA</span> zoom · <span>ESPAÇO</span> coletar · <span>Z</span> nomes dos drops · <span>C</span> personagem · <span>I</span> inventário · <span>K</span> skills · <span>G</span> GM · <span>R</span> montaria · <span>F</span> auto-combate · <span>V</span> efeitos · <span>M</span> música</div>
`;

function showBootError(error: unknown): void {
  console.error(error);
  const status = document.querySelector<HTMLElement>("#loading-status");
  if (status) status.textContent = error instanceof Error ? error.message : "Falha ao iniciar";
}

try {
  const game = new GameApp(app);
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) game.dispose();
  }, { once: true });
  void game.start().catch(showBootError);
} catch (error) {
  // WebGLRenderer can fail synchronously before start() returns a Promise.
  showBootError(error);
}
