const DEFAULT_INTERACTIVE_SELECTOR = [
  "button",
  "input",
  "select",
  "textarea",
  "a[href]",
  "summary",
  "[contenteditable='true']",
  "[data-window-drag-ignore]",
].join(",");

export interface ClassicWindowDragOptions {
  readonly viewportPadding?: number;
  readonly interactiveSelector?: string;
  readonly autoClampOnResize?: boolean;
  readonly onMove?: (controller: ClassicWindowDragController) => void;
  readonly onReset?: (controller: ClassicWindowDragController) => void;
}

interface ActiveWindowDrag {
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startTranslateX: number;
  readonly startTranslateY: number;
  readonly previousInlineZIndex: string;
  moved: boolean;
}

/**
 * Adds mouse/touch dragging to one classic window without replacing its
 * existing `transform`. Movement is stored in the independent CSS `translate`
 * property through custom properties shared by every draggable panel.
 */
export class ClassicWindowDragController {
  readonly element: HTMLElement;
  readonly handle: HTMLElement;

  readonly #viewportPadding: number;
  readonly #interactiveSelector: string;
  readonly #autoClampOnResize: boolean;
  readonly #onMove: ((controller: ClassicWindowDragController) => void) | undefined;
  readonly #onReset: ((controller: ClassicWindowDragController) => void) | undefined;
  #translateX = 0;
  #translateY = 0;
  #activeDrag: ActiveWindowDrag | null = null;
  #userPositioned = false;

  constructor(
    element: HTMLElement,
    handle: HTMLElement,
    options: ClassicWindowDragOptions = {},
  ) {
    this.element = element;
    this.handle = handle;
    this.#viewportPadding = Math.max(0, options.viewportPadding ?? 4);
    this.#interactiveSelector = options.interactiveSelector ?? DEFAULT_INTERACTIVE_SELECTOR;
    this.#autoClampOnResize = options.autoClampOnResize ?? true;
    this.#onMove = options.onMove;
    this.#onReset = options.onReset;

    this.element.classList.add("classic-draggable-window");
    this.handle.classList.add("classic-window-drag-handle");
    this.#applyTranslation();
    this.handle.addEventListener("pointerdown", this.#pointerDown);
    this.handle.addEventListener("pointermove", this.#pointerMove);
    this.handle.addEventListener("pointerup", this.#pointerUp);
    this.handle.addEventListener("pointercancel", this.#pointerCancel);
    this.handle.addEventListener("lostpointercapture", this.#lostPointerCapture);
    this.handle.addEventListener("dblclick", this.#doubleClick);
    if (this.#autoClampOnResize) window.addEventListener("resize", this.#resize);
  }

  get userPositioned(): boolean {
    return this.#userPositioned;
  }

  /** Moves by viewport pixels while retaining the panel's original transform. */
  moveByViewport(deltaX: number, deltaY: number, markAsUserPosition = false): void {
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;
    this.#translateX += deltaX;
    this.#translateY += deltaY;
    if (markAsUserPosition) this.#userPositioned = true;
    this.#applyTranslation();
    this.clampToViewport();
    this.#onMove?.(this);
  }

  /** Keeps the complete drag handle visible, even if the window is oversized. */
  clampToViewport(): void {
    if (getComputedStyle(this.element).visibility === "hidden") return;

    // A correction is normally exact because CSS translate is measured in CSS
    // pixels. Two extra passes also cover scaled legacy panels and rounding.
    for (let pass = 0; pass < 3; pass++) {
      const rect = this.handle.getBoundingClientRect();
      const correctionX = viewportCorrection(
        rect.left,
        rect.right,
        window.innerWidth,
        this.#viewportPadding,
      );
      const correctionY = viewportCorrection(
        rect.top,
        rect.bottom,
        window.innerHeight,
        this.#viewportPadding,
      );
      if (Math.abs(correctionX) < 0.1 && Math.abs(correctionY) < 0.1) break;
      this.#translateX += correctionX;
      this.#translateY += correctionY;
      this.#applyTranslation();
    }
  }

  /** Clears a manual position. A custom reset hook may establish a new anchor. */
  reset(): void {
    this.#finishDrag(false);
    this.#translateX = 0;
    this.#translateY = 0;
    this.#userPositioned = false;
    this.#applyTranslation();
    if (this.#onReset) this.#onReset(this);
    else this.clampToViewport();
  }

  dispose(): void {
    this.#finishDrag(false);
    this.handle.removeEventListener("pointerdown", this.#pointerDown);
    this.handle.removeEventListener("pointermove", this.#pointerMove);
    this.handle.removeEventListener("pointerup", this.#pointerUp);
    this.handle.removeEventListener("pointercancel", this.#pointerCancel);
    this.handle.removeEventListener("lostpointercapture", this.#lostPointerCapture);
    this.handle.removeEventListener("dblclick", this.#doubleClick);
    if (this.#autoClampOnResize) window.removeEventListener("resize", this.#resize);
    this.element.classList.remove("classic-draggable-window", "is-window-dragging");
    this.handle.classList.remove("classic-window-drag-handle");
    this.element.style.removeProperty("--classic-window-drag-x");
    this.element.style.removeProperty("--classic-window-drag-y");
  }

  #applyTranslation(): void {
    this.element.style.setProperty("--classic-window-drag-x", `${roundPixel(this.#translateX)}px`);
    this.element.style.setProperty("--classic-window-drag-y", `${roundPixel(this.#translateY)}px`);
  }

  #finishDrag(releaseCapture: boolean): void {
    const drag = this.#activeDrag;
    if (!drag) return;
    this.#activeDrag = null;
    if (releaseCapture && this.handle.hasPointerCapture?.(drag.pointerId)) {
      this.handle.releasePointerCapture(drag.pointerId);
    }
    this.element.classList.remove("is-window-dragging");
    this.element.style.zIndex = drag.previousInlineZIndex;
  }

  readonly #pointerDown = (event: PointerEvent): void => {
    if (!event.isPrimary || event.button !== 0 || this.#activeDrag) return;
    const target = event.target;
    if (target instanceof Element && target.closest(this.#interactiveSelector)) return;

    event.preventDefault();
    this.#activeDrag = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startTranslateX: this.#translateX,
      startTranslateY: this.#translateY,
      previousInlineZIndex: this.element.style.zIndex,
      moved: false,
    };
    this.element.classList.add("is-window-dragging");
    // Above ordinary HUD windows (35..42), below the modal portal prompt (60).
    this.element.style.zIndex = "55";
    this.handle.setPointerCapture?.(event.pointerId);
  };

  readonly #pointerMove = (event: PointerEvent): void => {
    const drag = this.#activeDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const deltaX = event.clientX - drag.startClientX;
    const deltaY = event.clientY - drag.startClientY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) >= 2) {
      drag.moved = true;
      this.#userPositioned = true;
    }
    if (!drag.moved) return;
    this.#translateX = drag.startTranslateX + deltaX;
    this.#translateY = drag.startTranslateY + deltaY;
    this.#applyTranslation();
    this.clampToViewport();
    this.#onMove?.(this);
  };

  readonly #pointerUp = (event: PointerEvent): void => {
    if (this.#activeDrag?.pointerId !== event.pointerId) return;
    this.#finishDrag(true);
  };

  readonly #pointerCancel = (event: PointerEvent): void => {
    if (this.#activeDrag?.pointerId !== event.pointerId) return;
    this.#finishDrag(true);
  };

  readonly #lostPointerCapture = (event: PointerEvent): void => {
    if (this.#activeDrag?.pointerId !== event.pointerId) return;
    this.#finishDrag(false);
  };

  readonly #doubleClick = (event: MouseEvent): void => {
    const target = event.target;
    if (target instanceof Element && target.closest(this.#interactiveSelector)) return;
    event.preventDefault();
    this.reset();
  };

  readonly #resize = (): void => {
    this.clampToViewport();
    this.#onMove?.(this);
  };
}

export function makeClassicWindowDraggable(
  element: HTMLElement,
  handle: HTMLElement,
  options: ClassicWindowDragOptions = {},
): ClassicWindowDragController {
  return new ClassicWindowDragController(element, handle, options);
}

function viewportCorrection(
  start: number,
  end: number,
  viewportSize: number,
  padding: number,
): number {
  const minimum = padding;
  const maximum = Math.max(minimum, viewportSize - padding);
  const size = end - start;
  if (size > maximum - minimum) return minimum - start;
  if (start < minimum) return minimum - start;
  if (end > maximum) return maximum - end;
  return 0;
}

function roundPixel(value: number): number {
  return Math.round(value * 10) / 10;
}
