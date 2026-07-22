import * as THREE from "three";

export class GameInput {
  readonly #keys = new Set<string>();
  readonly #pointer = new THREE.Vector2();
  #rightDragging = false;
  #lastX = 0;
  #lastY = 0;
  onGroundClick?: (pointer: THREE.Vector2) => void;
  onCameraRotate?: (deltaYaw: number, deltaPitch: number) => void;
  onZoom?: (delta: number) => void;
  onSpeedToggle?: () => void;
  onInventoryToggle?: () => void;
  onMountToggle?: () => void;
  onAutoCombatToggle?: () => void;
  onEffectsToggle?: () => void;
  onSkill?: (slot: number) => void;

  constructor(private readonly element: HTMLElement) {
    window.addEventListener("keydown", (event) => {
      this.#keys.add(event.code);
      if (isTextEntry(event.target)) return;
      if (event.code === "KeyG" && !event.repeat) this.onSpeedToggle?.();
      if (event.code === "KeyI" && !event.repeat) this.onInventoryToggle?.();
      if (event.code === "KeyR" && !event.repeat) this.onMountToggle?.();
      if (event.code === "KeyF" && !event.repeat) this.onAutoCombatToggle?.();
      if (event.code === "KeyV" && !event.repeat) this.onEffectsToggle?.();
      if (!event.repeat && /^Digit[1-8]$/.test(event.code)) this.onSkill?.(Number(event.code.slice(-1)));
    });
    window.addEventListener("keyup", (event) => this.#keys.delete(event.code));
    element.addEventListener("contextmenu", (event) => event.preventDefault());
    element.addEventListener("pointerdown", this.pointerDown);
    window.addEventListener("pointermove", this.pointerMove);
    window.addEventListener("pointerup", this.pointerUp);
    element.addEventListener("wheel", this.wheel, { passive: false });
  }

  movement(): THREE.Vector2 {
    const x = Number(this.#keys.has("KeyD") || this.#keys.has("ArrowRight")) - Number(this.#keys.has("KeyA") || this.#keys.has("ArrowLeft"));
    const y = Number(this.#keys.has("KeyW") || this.#keys.has("ArrowUp")) - Number(this.#keys.has("KeyS") || this.#keys.has("ArrowDown"));
    return new THREE.Vector2(x, y).normalize();
  }

  rotationAxis(): number {
    return Number(this.#keys.has("KeyE")) - Number(this.#keys.has("KeyQ"));
  }

  private readonly pointerDown = (event: PointerEvent): void => {
    if (event.button === 2) {
      this.#rightDragging = true;
      this.#lastX = event.clientX;
      this.#lastY = event.clientY;
      return;
    }
    if (event.button !== 0) return;
    const bounds = this.element.getBoundingClientRect();
    this.#pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
    this.onGroundClick?.(this.#pointer.clone());
  };

  private readonly pointerMove = (event: PointerEvent): void => {
    if (!this.#rightDragging) return;
    const dx = event.clientX - this.#lastX;
    const dy = event.clientY - this.#lastY;
    this.#lastX = event.clientX;
    this.#lastY = event.clientY;
    this.onCameraRotate?.(-dx * 0.006, dy * 0.004);
  };

  private readonly pointerUp = (event: PointerEvent): void => {
    if (event.button === 2) this.#rightDragging = false;
  };

  private readonly wheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.onZoom?.(Math.sign(event.deltaY) * 3);
  };
}

function isTextEntry(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable);
}
