import * as THREE from "three";
import type { PlayerSnapshot } from "../game/state/PlayerState";

export type ClassicPlayerOverheadChatChannel = "general" | "party" | "guild";

export type ClassicPlayerOverheadSnapshot = Pick<
  PlayerSnapshot,
  "name" | "hp" | "maxHp" | "alive"
>;

const CLASSIC_LABEL_HEIGHT = 2;
const NORMAL_CHAT_DURATION_MS = 3_000;
const EXTENDED_CHAT_DURATION_MS = 10_000;
const CLASSIC_CHAT_LINE_LENGTH = 41;
const CLASSIC_CHAT_MAX_LENGTH = 82;

/**
 * Fixed-pixel, screen-space labels used by the local player in the classic
 * client. The original SText/SProgressBar controls are projected into the 2D
 * control container, so this deliberately does not participate in depth tests.
 */
export class ClassicPlayerOverheadHud {
  readonly element = document.createElement("div");

  readonly #anchor = document.createElement("div");
  readonly #chat = document.createElement("div");
  readonly #health = document.createElement("div");
  readonly #healthFill = document.createElement("i");
  readonly #name = document.createElement("div");
  readonly #projectedPosition = new THREE.Vector3();

  #alive = false;
  #chatExpiresAt = 0;
  #disposed = false;
  #mounted = false;
  #renderVisible = false;
  #lastScreenX = Number.NaN;
  #lastScreenY = Number.NaN;
  #lastFontSize = 0;
  #lastName = "";
  #lastHealthRatio = Number.NaN;

  constructor(container: HTMLElement) {
    this.element.className = "classic-player-overhead-layer";
    this.element.setAttribute("aria-hidden", "true");
    this.#anchor.className = "classic-player-overhead-anchor";
    this.#chat.className = "classic-player-overhead-chat";
    this.#health.className = "classic-player-overhead-health";
    this.#healthFill.className = "classic-player-overhead-health-fill";
    this.#name.className = "classic-player-overhead-name";

    this.#health.append(this.#healthFill);
    this.#anchor.append(this.#chat, this.#health, this.#name);
    this.element.append(this.#anchor);
    container.append(this.element);
  }

  sync(snapshot: ClassicPlayerOverheadSnapshot): void {
    if (this.#disposed) return;

    const name = snapshot.name || "NoName";
    if (name !== this.#lastName) {
      this.#lastName = name;
      this.#name.textContent = name;
      // TMHuman sizes this SText to strlen(name) * 6 + 18 pixels.
      this.#name.style.width = `${name.length * 6 + 18}px`;
    }

    const maximum = Number.isFinite(snapshot.maxHp) ? Math.max(0, snapshot.maxHp) : 0;
    const current = Number.isFinite(snapshot.hp) ? Math.max(0, snapshot.hp) : 0;
    const ratio = maximum > 0 ? Math.min(1, current / maximum) : 0;
    if (ratio !== this.#lastHealthRatio) {
      this.#lastHealthRatio = ratio;
      this.#healthFill.style.transform = `scaleX(${ratio})`;
    }

    const wasAlive = this.#alive;
    this.#alive = snapshot.alive;
    if (wasAlive && !this.#alive) this.clearChat();
    if (!this.#alive) this.setRenderVisible(false);
  }

  /**
   * Shows only local/general speech, matching the classic client's overhead
   * chat filter. A boolean can be supplied when the caller has already reduced
   * its channel/ownership decision to "belongs above the local player".
   */
  showChat(
    message: string,
    channelOrLocal: ClassicPlayerOverheadChatChannel | boolean = "general",
  ): void {
    if (this.#disposed || !this.#alive) return;
    const isLocalGeneral = typeof channelOrLocal === "boolean"
      ? channelOrLocal
      : channelOrLocal === "general";
    if (!isLocalGeneral) return;

    let text = message;
    // Party/guild prefixes normally arrive as their parsed channels. Keep the
    // raw classic local/whisper guards as well so no unsupported route leaks
    // into the player's speech label.
    if (text.startsWith("=") || text.startsWith("-") || text.startsWith("@") || text.startsWith("/")) {
      return;
    }
    const extended = text.startsWith("*");
    if (extended) text = text.slice(1);
    text = text.slice(0, CLASSIC_CHAT_MAX_LENGTH);
    if (!text) return;

    const multiline = text.length >= CLASSIC_CHAT_LINE_LENGTH;
    const displayedText = text.length > CLASSIC_CHAT_LINE_LENGTH
      ? `${text.slice(0, CLASSIC_CHAT_LINE_LENGTH)}\n${text.slice(CLASSIC_CHAT_LINE_LENGTH)}`
      : text;
    this.#chat.textContent = displayedText;
    this.#chat.style.width = `${multiline ? 256 : text.length * 6 + 20}px`;
    this.#chat.style.height = `${multiline ? 50 : 40}px`;
    this.#chat.classList.toggle("is-multiline", multiline);
    this.#chat.classList.add("is-visible");
    this.#chatExpiresAt = performance.now()
      + (extended ? EXTENDED_CHAT_DURATION_MS : NORMAL_CHAT_DURATION_MS);
  }

  update(camera: THREE.Camera, playerObject: THREE.Object3D, mounted: boolean): void {
    if (this.#disposed) return;
    if (this.#chatExpiresAt > 0 && performance.now() >= this.#chatExpiresAt) this.clearChat();

    if (mounted !== this.#mounted) {
      this.#mounted = mounted;
      this.#anchor.classList.toggle("is-mounted", mounted);
    }

    if (!this.#alive || !isObjectTreeVisible(playerObject)) {
      this.setRenderVisible(false);
      return;
    }

    const viewportWidth = this.element.clientWidth;
    const viewportHeight = this.element.clientHeight;
    if (viewportWidth <= 0 || viewportHeight <= 0) {
      this.setRenderVisible(false);
      return;
    }

    playerObject.localToWorld(this.#projectedPosition.set(0, CLASSIC_LABEL_HEIGHT, 0));
    camera.updateMatrixWorld();
    this.#projectedPosition.project(camera);

    const x = this.#projectedPosition.x;
    const y = this.#projectedPosition.y;
    const z = this.#projectedPosition.z;
    if (
      !Number.isFinite(x)
      || !Number.isFinite(y)
      || !Number.isFinite(z)
      || x <= -1
      || x >= 1
      || y <= -1
      || y >= 1
      || z < -1
      || z >= 1
    ) {
      this.setRenderVisible(false);
      return;
    }

    // The classic control code truncates projected screen coordinates to ints.
    const screenX = Math.trunc((x * 0.5 + 0.5) * viewportWidth);
    const screenY = Math.trunc((-y * 0.5 + 0.5) * viewportHeight);
    if (screenX !== this.#lastScreenX || screenY !== this.#lastScreenY) {
      this.#lastScreenX = screenX;
      this.#lastScreenY = screenY;
      this.#anchor.style.transform = `translate3d(${screenX}px, ${screenY}px, 0)`;
    }

    const fontSize = classicFontSize(viewportWidth);
    if (fontSize !== this.#lastFontSize) {
      this.#lastFontSize = fontSize;
      this.#anchor.style.setProperty("--classic-player-label-font-size", `${fontSize}px`);
    }
    this.setRenderVisible(true);
  }

  clearChat(): void {
    this.#chatExpiresAt = 0;
    this.#chat.textContent = "";
    this.#chat.classList.remove("is-visible", "is-multiline");
  }

  dispose(): void {
    if (this.#disposed) return;
    this.clearChat();
    this.#disposed = true;
    this.element.remove();
  }

  private setRenderVisible(visible: boolean): void {
    if (visible === this.#renderVisible) return;
    this.#renderVisible = visible;
    this.#anchor.classList.toggle("is-visible", visible);
  }
}

function classicFontSize(viewportWidth: number): number {
  switch (Math.round(viewportWidth)) {
    case 640:
      return 11;
    case 800:
    case 1024:
    case 1280:
      return 14;
    default:
      return 18;
  }
}

function isObjectTreeVisible(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}
