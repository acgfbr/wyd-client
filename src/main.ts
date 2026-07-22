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
      <small>* proxy da thread principal · não é CPU real</small>
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
      <button id="skill-slot-1" type="button" data-key="1" title="1 · Flecha"><span class="quickslot-icon">➶</span><span class="skill-name">Flecha</span><kbd>1</kbd><span class="skill-cooldown"></span></button>
      <button id="skill-slot-2" type="button" data-key="2" title="2 · Tempestade"><span class="quickslot-icon">✦</span><span class="skill-name">Temp.</span><kbd>2</kbd><span class="skill-cooldown"></span></button>
      <button id="skill-slot-3" type="button" data-key="3" title="3 · Veneno"><span class="quickslot-icon">☠</span><span class="skill-name">Veneno</span><kbd>3</kbd><span class="skill-cooldown"></span></button>
      <button id="skill-slot-4" type="button" data-key="4" title="4 · Evasão"><span class="quickslot-icon">✧</span><span class="skill-name">Evasão</span><kbd>4</kbd><span class="skill-cooldown"></span></button>
      <button id="skill-slot-5" type="button" data-key="5" title="5 · Fera"><span class="quickslot-icon">♞</span><span class="skill-name">Fera</span><kbd>5</kbd><span class="skill-cooldown"></span></button>
      <button id="skill-slot-6" type="button" data-key="6" title="6 · Caçada"><span class="quickslot-icon">✣</span><span class="skill-name">Caçada</span><kbd>6</kbd><span class="skill-cooldown"></span></button>
      <button id="skill-slot-7" type="button" data-key="7" title="7 · Skytalos"><span class="quickslot-icon">♜</span><span class="skill-name">Skytalos</span><kbd>7</kbd><span class="skill-cooldown"></span></button>
      <button id="skill-slot-8" type="button" data-key="8" title="8 · Montar"><span class="quickslot-icon">♘</span><span class="skill-name">Montar</span><kbd>8</kbd><span class="skill-cooldown"></span></button>
      <button id="skill-slot-9" type="button" data-key="9" title="9 · Ligação Espectral"><span class="quickslot-icon">◈</span><span class="skill-name">Ligação</span><kbd>9</kbd><span class="skill-cooldown"></span></button>
      <button type="button" data-key="0" title="0 · Poção de HP"><span class="quickslot-icon potion">HP</span><kbd>0</kbd><small id="quickslot-1-count">5</small></button>
    </div>
    <div class="classic-menu-labels" aria-hidden="true"><span>C.C</span><span>MENU</span></div>
  </section>

  <section class="classic-chat-shell" aria-label="Chat e registro de combate">
    <div class="chat-tabs"><span class="is-active">GERAL</span><span>GRUPO</span><span>GUILD</span></div>
    <section id="combat-log" class="combat-log" aria-live="polite"></section>
    <div class="chat-frame" aria-hidden="true"></div>
    <div class="chat-input"><strong>Todos</strong><span>Pressione Enter para conversar</span></div>
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

  <aside id="inventory-preview" class="inventory-preview" aria-label="Preview do item">
    <header>ITEM 3D</header>
    <div id="inventory-preview-viewport" class="inventory-preview-viewport" aria-hidden="true">
      <span id="inventory-preview-fallback" class="inventory-preview-fallback"></span>
    </div>
    <strong id="inventory-preview-name">Passe sobre um item</strong>
    <small id="inventory-preview-kind">Preview clássico 3D</small>
  </aside>

  <section id="inventory-panel" class="inventory-panel">
    <header><strong>INVENTÁRIO</strong><button type="button" aria-label="Fechar inventário" data-inventory-close>×</button></header>
    <div class="inventory-caption">Equipamento</div>
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
    <div id="inventory-grid" class="inventory-grid"></div>
    <div class="inventory-gold"><span>Gold</span><b id="player-coins">0</b></div>
    <p>Duplo clique usa o item · <kbd>I</kbd> fecha</p>
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

  <div class="controls-hint"><span>WASD</span> mover · <span>Q/E</span> câmera · <span>RODA</span> zoom · <span>C</span> personagem · <span>I</span> inventário · <span>K</span> skills · <span>G</span> GM · <span>R</span> montaria · <span>F</span> auto-combate · <span>V</span> efeitos</div>
`;

function showBootError(error: unknown): void {
  console.error(error);
  const status = document.querySelector<HTMLElement>("#loading-status");
  if (status) status.textContent = error instanceof Error ? error.message : "Falha ao iniciar";
}

try {
  const game = new GameApp(app);
  void game.start().catch(showBootError);
} catch (error) {
  // WebGLRenderer can fail synchronously before start() returns a Promise.
  showBootError(error);
}
