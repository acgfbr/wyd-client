import * as THREE from "three";

export class GameInput {
  readonly #keys = new Set<string>();
  readonly #pointer = new THREE.Vector2();
  #leftHeld = false;
  #leftGroundTracking = false;
  #rightDragging = false;
  #clientX = 0;
  #clientY = 0;
  #lastX = 0;
  #lastY = 0;
  onGroundClick?: (pointer: THREE.Vector2) => void;
  onCameraRotate?: (deltaYaw: number, deltaPitch: number) => void;
  onZoom?: (delta: number) => void;
  onSpeedToggle?: () => void;
  onInventoryToggle?: () => void;
  onCharacterToggle?: () => void;
  onSkillMenuToggle?: () => void;
  onMountToggle?: () => void;
  onAutoCombatToggle?: () => void;
  onEffectsToggle?: () => void;
  onSkill?: (slot: number) => void;

  constructor(private readonly element: HTMLElement) {
    window.addEventListener("keydown", (event) => {
      if (isTextEntry(event.target)) return;
      this.#keys.add(event.code);
      if (event.code === "KeyG" && !event.repeat) this.onSpeedToggle?.();
      if (event.code === "KeyI" && !event.repeat) this.onInventoryToggle?.();
      if (event.code === "KeyC" && !event.repeat) this.onCharacterToggle?.();
      if (event.code === "KeyK" && !event.repeat) this.onSkillMenuToggle?.();
      if (event.code === "KeyR" && !event.repeat) this.onMountToggle?.();
      if (event.code === "KeyF" && !event.repeat) this.onAutoCombatToggle?.();
      if (event.code === "KeyV" && !event.repeat) this.onEffectsToggle?.();
      if (!event.repeat && /^Digit[1-9]$/.test(event.code)) this.onSkill?.(Number(event.code.slice(-1)));
    });
    window.addEventListener("keyup", (event) => this.#keys.delete(event.code));
    element.addEventListener("contextmenu", (event) => event.preventDefault());
    // Mouse events are intentional: browsers may only emit pointerdown for
    // the first button in a chord, while mousedown/up report L and R separately.
    element.addEventListener("mousedown", this.mouseDown);
    window.addEventListener("mousemove", this.mouseMove);
    window.addEventListener("mouseup", this.mouseUp);
    window.addEventListener("blur", this.resetTransientState);
    window.addEventListener("focusin", (event) => {
      if (isTextEntry(event.target)) this.resetTransientState();
    });
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

  /** Both mouse buttons reproduce the classic continuous forward control. */
  dualButtonForward(): boolean {
    return this.#leftHeld && this.#rightDragging;
  }

  primaryHeld(): boolean {
    return this.#leftHeld;
  }

  /**
   * Writes the latest pointer in NDC while a terrain press remains held.
   * DOM hit-testing prevents a drag that crosses a HUD panel from clicking
   * through that panel into the world canvas.
   */
  heldGroundPointer(target: THREE.Vector2): boolean {
    if (!this.#leftHeld || !this.#leftGroundTracking || this.#rightDragging) return false;
    const front = document.elementFromPoint(this.#clientX, this.#clientY);
    if (front !== this.element && !(front && this.element.contains(front))) return false;
    target.copy(this.#pointer);
    return true;
  }

  private readonly mouseDown = (event: MouseEvent): void => {
    this.updatePointer(event.clientX, event.clientY);
    if (event.button === 2) {
      this.#rightDragging = true;
      this.#lastX = event.clientX;
      this.#lastY = event.clientY;
      return;
    }
    if (event.button !== 0) return;
    this.#leftHeld = true;
    this.#leftGroundTracking = true;
    // If left is the second half of the two-button chord, do not emit an
    // accidental ground/monster click. Tracking resumes if right is released
    // while left remains held.
    if (this.#rightDragging || (event.buttons & 2) !== 0) {
      return;
    }
    this.onGroundClick?.(this.#pointer.clone());
  };

  private readonly mouseMove = (event: MouseEvent): void => {
    this.updatePointer(event.clientX, event.clientY);
    // Recover from a mouseup lost while the browser changed focus.
    if (this.#leftHeld && (event.buttons & 1) === 0) {
      this.#leftHeld = false;
      this.#leftGroundTracking = false;
    }
    if (this.#rightDragging && (event.buttons & 2) === 0) {
      this.#rightDragging = false;
      return;
    }
    if (!this.#rightDragging) return;
    const dx = event.clientX - this.#lastX;
    const dy = event.clientY - this.#lastY;
    this.#lastX = event.clientX;
    this.#lastY = event.clientY;
    this.onCameraRotate?.(-dx * 0.006, dy * 0.004);
  };

  private readonly mouseUp = (event: MouseEvent): void => {
    this.updatePointer(event.clientX, event.clientY);
    if (event.button === 0) {
      this.#leftHeld = false;
      this.#leftGroundTracking = false;
    }
    if (event.button === 2) this.#rightDragging = false;
  };

  private readonly resetMouseButtons = (): void => {
    this.#leftHeld = false;
    this.#leftGroundTracking = false;
    this.#rightDragging = false;
  };

  private readonly resetTransientState = (): void => {
    this.#keys.clear();
    this.resetMouseButtons();
  };

  private readonly wheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.onZoom?.(Math.sign(event.deltaY) * 3);
  };

  private updatePointer(clientX: number, clientY: number): void {
    this.#clientX = clientX;
    this.#clientY = clientY;
    const bounds = this.element.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    this.#pointer.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1,
    );
  }
}

function isTextEntry(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable);
}
