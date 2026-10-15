/**
 * The director's hands: the frame clock and the drawn pointer's moves to
 * page elements and map points, shared by the stages.
 */
import type { MapPoint3 } from './camera-path';
import { ShowreelPointer, type Mods, type ScreenPoint } from './pointer';
import type { Stage } from './stage';

/** The next animation frame's time (performance.now() based) */
export function nextFrame(): Promise<number> {
  return new Promise((done) => requestAnimationFrame(done));
}

export async function waitSeconds(seconds: number): Promise<void> {
  const start = await nextFrame();
  while ((await nextFrame()) - start < seconds * 1000) {
    // the frame clock, so a wait lines up with the moves around it
  }
}

/** Resolves once `test` holds, checked each frame; throws after `seconds` */
export async function waitUntil(test: () => boolean, seconds: number, what: string): Promise<void> {
  const start = await nextFrame();
  while (!test()) {
    if ((await nextFrame()) - start > seconds * 1000) throw new Error(`showreel: waited ${seconds} s for ${what}`);
  }
}

export function element(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`showreel: no element ${selector}`);
  return found;
}

export class Hands {
  constructor(readonly pointer: ShowreelPointer) {}

  /** The middle of an element on screen, scrolled into view first */
  centerOf(el: Element): ScreenPoint {
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) el.scrollIntoView({ block: 'center' });
    const s = el.getBoundingClientRect();
    return { x: s.left + s.width / 2, y: s.top + s.height / 2 };
  }

  /** Glide to an element and click it */
  async click(selector: string | Element, seconds = 0.7, button = 0, mods: Mods = {}): Promise<void> {
    const el = typeof selector === 'string' ? element(selector) : selector;
    this.pointer.show(true);
    await this.pointer.glide(() => this.centerOf(el), seconds, nextFrame, mods);
    await waitSeconds(0.08);
    // A panel that was still laying out moved the element on the way: a short second glide onto it
    const at = this.centerOf(el);
    const p = this.pointer.position;
    if (Math.hypot(at.x - p.x, at.y - p.y) > 3) await this.pointer.glide(() => this.centerOf(el), 0.2, nextFrame, mods);
    this.pointer.down(button, mods);
    await waitSeconds(0.07);
    this.pointer.up(button, mods);
  }

  /** Glide to a map point (followed while the camera moves) */
  async toMap(stage: Stage, p: MapPoint3, seconds: number, mods: Mods = {}): Promise<void> {
    this.pointer.show(true);
    await this.pointer.glide(() => stage.toScreen(p), seconds, nextFrame, mods);
  }

  /** Glide to a map point and click there */
  async clickMap(stage: Stage, p: MapPoint3, seconds = 0.8, button = 0, mods: Mods = {}): Promise<void> {
    await this.toMap(stage, p, seconds, mods);
    await waitSeconds(0.1);
    this.pointer.down(button, mods);
    await waitSeconds(0.08);
    this.pointer.up(button, mods);
  }

  /**
   * Hold a button and draw through map points in `seconds`, at one speed
   * along the line; the screen positions follow the camera every frame
   */
  async stroke(stage: Stage, points: readonly MapPoint3[], seconds: number, button = 0, mods: Mods = {}, settle = 0.15): Promise<void> {
    await this.toMap(stage, points[0], 0.45, mods);
    await waitSeconds(0.12);
    this.pointer.down(button, mods);
    const lengths = [0];
    for (let i = 1; i < points.length; i++) {
      lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    }
    const total = lengths[lengths.length - 1];
    const start = await nextFrame();
    for (;;) {
      const now = await nextFrame();
      const t = seconds <= 0 ? 1 : Math.min(1, (now - start) / (seconds * 1000));
      const at = pointAlong(points, lengths, total * t);
      const screen = stage.toScreen(at);
      if (screen) this.pointer.moveTo(screen, mods);
      if (t >= 1) break;
    }
    await waitSeconds(settle);
    this.pointer.up(button, mods);
  }
}

function pointAlong(points: readonly MapPoint3[], lengths: number[], distance: number): MapPoint3 {
  if (points.length === 1) return points[0];
  let i = 1;
  while (i < points.length - 1 && lengths[i] < distance) i++;
  const a = points[i - 1];
  const b = points[i];
  const span = lengths[i] - lengths[i - 1] || 1;
  const k = Math.min(1, Math.max(0, (distance - lengths[i - 1]) / span));
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, h: a.h + (b.h - a.h) * k };
}
