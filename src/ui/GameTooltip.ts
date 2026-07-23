export type GameTooltipTone = "default" | "skill" | "buff" | "item-common" | "item-uncommon" | "item-rare" | "item-epic";

export type GameTooltipLineTone =
  | "default"
  | "muted"
  | "option-common"
  | "option-good"
  | "option-superior"
  | "refinement"
  | "danger"
  | "special";

export interface GameTooltipLine {
  readonly text: string;
  readonly tone?: GameTooltipLineTone;
}

export interface GameTooltipContent {
  readonly title: string;
  readonly description?: string;
  readonly lines?: readonly (string | GameTooltipLine)[];
  readonly tone?: GameTooltipTone;
}

const TOOLTIP_SELECTOR = "[data-game-tooltip]";
const TOUCH_FOCUS_GUARD_MS = 800;
const LIVE_REFRESH_MS = 250;

/** Stores presentation metadata on a dynamic HUD element without a native browser tooltip. */
export function setGameTooltip(element: HTMLElement, content: GameTooltipContent | null): void {
  element.removeAttribute("title");
  if (!content) {
    delete element.dataset.gameTooltip;
    delete element.dataset.tooltipTitle;
    delete element.dataset.tooltipDescription;
    delete element.dataset.tooltipLines;
    delete element.dataset.tooltipTone;
    return;
  }
  element.dataset.gameTooltip = "";
  element.dataset.tooltipTitle = content.title;
  if (content.description?.trim()) element.dataset.tooltipDescription = content.description.trim();
  else delete element.dataset.tooltipDescription;
  if (content.lines?.length) element.dataset.tooltipLines = JSON.stringify(content.lines);
  else delete element.dataset.tooltipLines;
  element.dataset.tooltipTone = content.tone ?? "default";
}

/** One delegated tooltip for every dynamically rebuilt classic HUD collection. */
export class GameTooltip {
  readonly #root: HTMLElement;
  readonly #title: HTMLElement;
  readonly #description: HTMLElement;
  readonly #lines: HTMLElement;
  #anchor: HTMLElement | null = null;
  #pointerX = 0;
  #pointerY = 0;
  #pointerPositioned = false;
  #lastTouchAt = Number.NEGATIVE_INFINITY;
  #contentSignature = "";
  #refreshTimer = 0;

  constructor(root: HTMLElement) {
    this.#root = root;
    this.#title = requireTooltipPart(root, "[data-tooltip-title]");
    this.#description = requireTooltipPart(root, "[data-tooltip-description]");
    this.#lines = requireTooltipPart(root, "[data-tooltip-lines]");
    document.addEventListener("pointerover", this.pointerOver, true);
    document.addEventListener("pointermove", this.pointerMove, true);
    document.addEventListener("pointerout", this.pointerOut, true);
    document.addEventListener("pointerdown", this.pointerDown, true);
    document.addEventListener("focusin", this.focusIn, true);
    document.addEventListener("focusout", this.focusOut, true);
    document.addEventListener("keydown", this.keyDown, true);
    window.addEventListener("blur", this.hide);
    window.addEventListener("resize", this.position);
    window.addEventListener("scroll", this.position, true);
  }

  readonly hide = (): void => {
    if (this.#anchor) removeDescribedBy(this.#anchor, this.#root.id);
    this.#anchor = null;
    this.#contentSignature = "";
    this.#root.classList.remove("is-visible");
    this.#root.setAttribute("aria-hidden", "true");
    if (this.#refreshTimer) window.clearTimeout(this.#refreshTimer);
    this.#refreshTimer = 0;
  };

  private readonly pointerOver = (event: PointerEvent): void => {
    if (event.pointerType === "touch") {
      this.#lastTouchAt = performance.now();
      this.hide();
      return;
    }
    const anchor = tooltipAnchor(event.target);
    if (!anchor) return;
    this.#pointerX = event.clientX;
    this.#pointerY = event.clientY;
    this.#pointerPositioned = true;
    this.show(anchor);
  };

  private readonly pointerMove = (event: PointerEvent): void => {
    if (event.pointerType === "touch" || !this.#anchor || !this.#pointerPositioned) return;
    this.#pointerX = event.clientX;
    this.#pointerY = event.clientY;
    this.position();
  };

  private readonly pointerOut = (event: PointerEvent): void => {
    if (!this.#anchor || event.pointerType === "touch") return;
    const origin = tooltipAnchor(event.target);
    if (origin !== this.#anchor) return;
    const destination = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (destination && this.#anchor.contains(destination)) return;
    this.hide();
  };

  private readonly pointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== "touch") return;
    this.#lastTouchAt = performance.now();
    this.hide();
  };

  private readonly focusIn = (event: FocusEvent): void => {
    if (performance.now() - this.#lastTouchAt < TOUCH_FOCUS_GUARD_MS) {
      this.hide();
      return;
    }
    const anchor = tooltipAnchor(event.target);
    if (!anchor) return;
    this.#pointerPositioned = false;
    this.show(anchor);
  };

  private readonly focusOut = (event: FocusEvent): void => {
    if (!this.#anchor || tooltipAnchor(event.target) !== this.#anchor) return;
    const destination = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (destination && this.#anchor.contains(destination)) return;
    this.hide();
  };

  private readonly keyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") this.hide();
  };

  private show(anchor: HTMLElement): void {
    if (this.#anchor !== anchor) {
      if (this.#anchor) removeDescribedBy(this.#anchor, this.#root.id);
      this.#anchor = anchor;
      addDescribedBy(anchor, this.#root.id);
      this.#contentSignature = "";
    }
    this.refreshContent();
    this.#root.classList.add("is-visible");
    this.#root.setAttribute("aria-hidden", "false");
    this.position();
    if (!this.#refreshTimer) this.#refreshTimer = window.setTimeout(this.tick, LIVE_REFRESH_MS);
  }

  private readonly tick = (): void => {
    this.#refreshTimer = 0;
    if (!this.#anchor || !this.#anchor.isConnected || !this.#anchor.matches(TOOLTIP_SELECTOR)) {
      this.hide();
      return;
    }
    this.refreshContent();
    this.position();
    this.#refreshTimer = window.setTimeout(this.tick, LIVE_REFRESH_MS);
  };

  private refreshContent(): void {
    const anchor = this.#anchor;
    if (!anchor) return;
    const title = anchor.dataset.tooltipTitle?.trim() ?? "";
    const description = anchor.dataset.tooltipDescription?.trim() ?? "";
    const rawLines = anchor.dataset.tooltipLines ?? "[]";
    const tone = anchor.dataset.tooltipTone ?? "default";
    const signature = `${title}\u0000${description}\u0000${rawLines}\u0000${tone}`;
    if (signature === this.#contentSignature) return;
    this.#contentSignature = signature;
    const lines = parseTooltipLines(rawLines);
    this.#title.textContent = title;
    this.#description.textContent = description;
    this.#description.hidden = description.length === 0;
    this.#lines.replaceChildren(...lines.map((line) => {
      const row = document.createElement("span");
      row.textContent = line.text;
      row.dataset.tone = line.tone;
      return row;
    }));
    this.#lines.hidden = lines.length === 0;
    this.#root.dataset.tone = tone;
  }

  private readonly position = (): void => {
    const anchor = this.#anchor;
    if (!anchor || !this.#root.classList.contains("is-visible")) return;
    const margin = 8;
    const anchorRect = anchor.getBoundingClientRect();
    const tooltipRect = this.#root.getBoundingClientRect();
    const referenceX = this.#pointerPositioned
      ? this.#pointerX
      : anchorRect.left + anchorRect.width / 2;
    const referenceY = this.#pointerPositioned
      ? this.#pointerY
      : anchorRect.top + anchorRect.height / 2;
    // SGrid centers the 240 px description panel on the cursor. In the upper
    // half it opens 30 px below; in the lower half it opens 10 px above.
    let left = referenceX - tooltipRect.width / 2;
    let top = referenceY >= window.innerHeight / 2 - 30
      ? referenceY - tooltipRect.height - 10
      : referenceY + 30;
    left = Math.max(margin, Math.min(left, window.innerWidth - tooltipRect.width - margin));
    top = Math.max(margin, Math.min(top, window.innerHeight - tooltipRect.height - margin));
    this.#root.style.setProperty("--tooltip-left", `${Math.round(left)}px`);
    this.#root.style.setProperty("--tooltip-top", `${Math.round(top)}px`);
  };
}

function tooltipAnchor(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(TOOLTIP_SELECTOR) : null;
}

function parseTooltipLines(value: string): readonly Required<GameTooltipLine>[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const lines: Required<GameTooltipLine>[] = [];
    for (const line of parsed) {
      if (typeof line === "string" && line.trim().length > 0) {
        lines.push({ text: line.trim(), tone: "default" });
        continue;
      }
      if (!line || typeof line !== "object" || Array.isArray(line)) continue;
      const candidate = line as Partial<GameTooltipLine>;
      if (typeof candidate.text !== "string" || candidate.text.trim().length === 0) continue;
      lines.push({
        text: candidate.text.trim(),
        tone: isTooltipLineTone(candidate.tone) ? candidate.tone : "default",
      });
    }
    return lines;
  } catch {
    return [];
  }
}

function isTooltipLineTone(value: unknown): value is GameTooltipLineTone {
  return value === "default"
    || value === "muted"
    || value === "option-common"
    || value === "option-good"
    || value === "option-superior"
    || value === "refinement"
    || value === "danger"
    || value === "special";
}

function addDescribedBy(element: HTMLElement, id: string): void {
  const ids = new Set((element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean));
  ids.add(id);
  element.setAttribute("aria-describedby", [...ids].join(" "));
}

function removeDescribedBy(element: HTMLElement, id: string): void {
  const ids = (element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((entry) => entry && entry !== id);
  if (ids.length > 0) element.setAttribute("aria-describedby", ids.join(" "));
  else element.removeAttribute("aria-describedby");
}

function requireTooltipPart(root: HTMLElement, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Parte do tooltip ausente: ${selector}`);
  return element;
}
