/**
 * The showreel's hand: a drawn mouse pointer over the page and the input it
 * gives, as synthetic pointer, mouse and key events. The real pointer is
 * hidden while the showreel runs; the drawn one glides on an arc between
 * points, so strokes and clicks look like a person's.
 */
import { ease } from './camera-path';

export interface ScreenPoint {
  x: number;
  y: number;
}

/** Modifier keys held with a pointer event */
export interface Mods {
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
}

const ARROW = `
<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
  <path d="M3 2 L3 22 L8.2 17.4 L11.8 25.6 L15.4 24 L11.9 16 L19 16 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/>
</svg>`;

/** Where the hidden pointer is and which button it holds */
export class ShowreelPointer {
  readonly element: HTMLDivElement;
  private readonly ripple: HTMLDivElement;
  private at: ScreenPoint = { x: innerWidth * 0.62, y: innerHeight * 0.55 };
  /** Element under the pointer when a button went down: it takes the rest of the press (pointer capture) */
  private pressTarget: Element | null = null;
  private buttons = 0;

  constructor() {
    this.element = document.createElement('div');
    this.element.setAttribute('aria-hidden', 'true');
    this.element.innerHTML = ARROW;
    Object.assign(this.element.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      zIndex: '2147483646',
      pointerEvents: 'none',
      filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.45))',
      display: 'none',
      willChange: 'transform',
    } satisfies Partial<CSSStyleDeclaration>);
    this.ripple = document.createElement('div');
    Object.assign(this.ripple.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: '34px',
      height: '34px',
      marginLeft: '-17px',
      marginTop: '-17px',
      borderRadius: '50%',
      border: '2px solid rgba(255,255,255,0.9)',
      zIndex: '2147483645',
      pointerEvents: 'none',
      opacity: '0',
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.append(this.ripple, this.element);
    this.place(this.at);
  }

  get position(): ScreenPoint {
    return { ...this.at };
  }

  show(on: boolean): void {
    this.element.style.display = on ? 'block' : 'none';
  }

  /** Put the pointer at `p` and tell the page it moved there */
  moveTo(p: ScreenPoint, mods: Mods = {}): void {
    this.place(p);
    this.fire('pointermove', mods);
  }

  private place(p: ScreenPoint): void {
    this.at = { x: p.x, y: p.y };
    this.element.style.transform = `translate(${p.x - 3}px, ${p.y - 2}px)`;
  }

  /**
   * Glide to `to` over `seconds` on a slight arc, easing in and out; `frame`
   * waits for the next frame. A target that moves (a map point under a
   * moving camera) is asked again every frame.
   */
  async glide(to: () => ScreenPoint | null, seconds: number, frame: () => Promise<number>, mods: Mods = {}): Promise<void> {
    const from = this.position;
    const start = await frame();
    // A sideways bow of a few percent of the way, alternating its side
    const bow = (Math.random() < 0.5 ? -1 : 1) * 0.08;
    for (;;) {
      const now = await frame();
      const t = seconds <= 0 ? 1 : Math.min(1, (now - start) / (seconds * 1000));
      const end = to() ?? from;
      const u = ease('inOut', t);
      const dx = end.x - from.x;
      const dy = end.y - from.y;
      const arc = Math.sin(Math.PI * u) * bow;
      this.moveTo({ x: from.x + dx * u - dy * arc, y: from.y + dy * u + dx * arc }, mods);
      if (t >= 1) return;
    }
  }

  down(button = 0, mods: Mods = {}): void {
    this.pressTarget = this.under();
    this.buttons |= buttonBit(button);
    this.fire('pointerdown', mods, button);
    this.fireMouse('mousedown', button, mods);
    if (button === 0) this.pulse();
  }

  up(button = 0, mods: Mods = {}): void {
    this.buttons &= ~buttonBit(button);
    this.fire('pointerup', mods, button);
    this.fireMouse('mouseup', button, mods);
    const target = this.pressTarget;
    this.pressTarget = null;
    if (button === 0 && target && target === this.under()) this.fireMouse('click', 0, mods, target);
    if (button === 2) this.fireMouse('contextmenu', 2, mods, target ?? undefined);
  }

  /** A click where the pointer is */
  click(button = 0, mods: Mods = {}): void {
    this.down(button, mods);
    this.up(button, mods);
  }

  /** The element under the pointer (the drawn pointer takes no events) */
  under(): Element | null {
    return document.elementFromPoint(this.at.x, this.at.y);
  }

  private fire(type: 'pointerdown' | 'pointermove' | 'pointerup', mods: Mods, button = -1): void {
    const target = this.pressTarget ?? this.under();
    if (!target) return;
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: this.at.x,
        clientY: this.at.y,
        screenX: this.at.x,
        screenY: this.at.y,
        button: type === 'pointermove' ? -1 : button,
        buttons: this.buttons,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        shiftKey: !!mods.shift,
        ctrlKey: !!mods.ctrl,
        altKey: !!mods.alt,
        view: window,
      }),
    );
  }

  private fireMouse(type: string, button: number, mods: Mods, at?: Element): void {
    const target = at ?? this.pressTarget ?? this.under();
    target?.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: this.at.x,
        clientY: this.at.y,
        button,
        buttons: this.buttons,
        shiftKey: !!mods.shift,
        ctrlKey: !!mods.ctrl,
        altKey: !!mods.alt,
        detail: 1,
        view: window,
      }),
    );
  }

  private pulse(): void {
    const r = this.ripple;
    r.style.transition = 'none';
    r.style.transform = `translate(${this.at.x}px, ${this.at.y}px) scale(0.3)`;
    r.style.opacity = '0.9';
    void r.offsetWidth;
    r.style.transition = 'transform 360ms ease-out, opacity 360ms ease-out';
    r.style.transform = `translate(${this.at.x}px, ${this.at.y}px) scale(1)`;
    r.style.opacity = '0';
  }

  dispose(): void {
    this.element.remove();
    this.ripple.remove();
  }
}

function buttonBit(button: number): number {
  return button === 0 ? 1 : button === 1 ? 4 : button === 2 ? 2 : 0;
}

/** A key pressed and let go on the focused element (or the page): `key` as KeyboardEvent.key */
export function pressKey(key: string, mods: Mods = {}): void {
  const target = document.activeElement ?? document.body;
  const init: KeyboardEventInit = {
    key,
    code: keyCode(key),
    bubbles: true,
    cancelable: true,
    composed: true,
    shiftKey: !!mods.shift,
    ctrlKey: !!mods.ctrl,
    altKey: !!mods.alt,
  };
  target.dispatchEvent(new KeyboardEvent('keydown', init));
  target.dispatchEvent(new KeyboardEvent('keyup', init));
}

/** KeyboardEvent.code of a key as a US keyboard has it */
export function keyCode(key: string): string {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  const named: Record<string, string> = {
    ' ': 'Space',
    '+': 'Equal',
    '=': 'Equal',
    '-': 'Minus',
    '[': 'BracketLeft',
    ']': 'BracketRight',
    '{': 'BracketLeft',
    '}': 'BracketRight',
    '?': 'Slash',
  };
  return named[key] ?? key;
}

/** Text into an input, a letter at a time as a person types, `cps` letters a second */
export async function typeInto(input: HTMLInputElement | HTMLTextAreaElement, text: string, cps: number, frame: () => Promise<number>): Promise<void> {
  input.focus();
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const start = await frame();
  let typed = 0;
  while (typed < text.length) {
    const now = await frame();
    const due = Math.min(text.length, Math.floor(((now - start) / 1000) * cps) + 1);
    if (due === typed) continue;
    typed = due;
    input.value = text.slice(0, typed);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
