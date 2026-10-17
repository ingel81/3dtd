/**
 * Pointer, wheel and keys over the view, to the tool in hand or to the
 * camera: the left button to the tool (unless the view is locked), the
 * right button turns the view (W A S D Q E fly while it is held), the
 * middle button or Shift and the right one pan, the wheel zooms. The
 * pointer is raycast to the ground at most once a frame (frame).
 */
import { stepRadius } from '../../map-ops/brush';
import type { EditorDocument } from '../model/editor-document';
import { patch, type EditorSettings, type EditorTool, type MapHit, type ToolContext, type ToolPointer } from '../tools/tool';
import type { CameraController } from './camera-controller';
import { mapToScene } from './map-view';

/** Keys that fly the view while the right button is held */
const FLY_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e']);

interface PointerLike {
  clientX: number;
  clientY: number;
  button: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

export interface InputHost {
  readonly canvas: HTMLCanvasElement;
  readonly controller: CameraController;
  readonly editor: EditorDocument;
  readonly settings: EditorSettings;
  readonly ctx: ToolContext;
  /** The camera's field of view now, degrees (panning keeps the ground under the pointer) */
  fov(): number;
  /** The ground under a client pixel */
  ground(clientX: number, clientY: number): MapHit | null;
  /** A click or the wheel stops what plays in the view (the intro preview); true when something did */
  interrupt(): boolean;
  /** The pointer left the view with nothing held */
  left(): void;
}

export class InputRouter {
  private current: EditorTool | null = null;
  private pointer: { clientX: number; clientY: number; shift: boolean; ctrl: boolean; alt: boolean; button: number } | null = null;
  private pointerMoved = false;
  private toolDrag = false;
  private cameraDrag: { mode: 'rotate' | 'pan'; x: number; y: number } | null = null;
  private lastHit: MapHit | null = null;
  private readonly keysDown = new Set<string>();
  /** Tools take no input (a terrain job runs) */
  private locked = false;
  private readonly unsubscribe: (() => void)[] = [];

  constructor(private readonly host: InputHost) {
    const c = host.canvas;
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      c.addEventListener(type, fn, opts);
      this.unsubscribe.push(() => c.removeEventListener(type, fn));
    };
    on('pointerdown', (e) => this.onPointerDown(e));
    on('pointermove', (e) => this.onPointerMove(e));
    on('pointerup', (e) => this.onPointerUp(e));
    on('pointercancel', (e) => this.onPointerUp(e));
    on('pointerleave', () => {
      if (!this.toolDrag && !this.cameraDrag) {
        this.pointer = null;
        host.left();
      }
    });
    on('wheel', (e) => this.onWheel(e), { passive: false });
  }

  get tool(): EditorTool | null {
    return this.current;
  }

  /** The tool in hand from now; false when it was already */
  setTool(tool: EditorTool): boolean {
    if (this.current === tool) return false;
    const ctx = this.host.ctx;
    this.current?.deactivate?.(ctx);
    // What the last tool drew goes with it
    ctx.overlay.clear();
    this.current = tool;
    tool.activate?.(ctx);
    return true;
  }

  /** While a terrain job runs or another tab edits the map, tools take no input (the view still turns and zooms) */
  setLocked(on: boolean): void {
    this.locked = on;
    if (on && this.toolDrag) {
      this.toolDrag = false;
      this.current?.cancel?.(this.host.ctx);
    }
  }

  /** Whether a tool holds the pointer (a stroke, a drag): slow extras wait */
  get dragging(): boolean {
    return this.toolDrag;
  }

  /** Whether the right button is turning the view (keys fly then) */
  get flying(): boolean {
    return this.cameraDrag?.mode === 'rotate';
  }

  /**
   * Global keys the shell passes on: the tool first, then the camera.
   * Esc drops what is half done and the selection; false when there was
   * neither (the shell then goes to Look).
   */
  key(e: KeyboardEvent): boolean {
    const { ctx, editor, settings } = this.host;
    // Flying with the right button held takes W A S D Q E before any tool
    const k = e.key.toLowerCase();
    if (this.flying && FLY_KEYS.has(k) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.keysDown.add(`fly:${k}`);
      return true;
    }
    // A locked view (a terrain job, a map another tab edits) takes no edits by key either: Delete, Ctrl+D, End …
    if (!this.locked && this.current?.key?.(e, ctx)) return true;
    if (e.key === 'Escape') {
      const dropped = this.current?.cancel?.(ctx) ?? false;
      const selected = editor.selection !== null;
      editor.select(null);
      return dropped || selected;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const b = settings.brush();
    switch (e.key) {
      case '[':
        patch(settings.brush, { radius: stepRadius(b.radius, -1) });
        return true;
      case ']':
        patch(settings.brush, { radius: stepRadius(b.radius, 1) });
        return true;
      case '{':
        patch(settings.brush, { strength: Math.max(0.05, Math.round((b.strength - 0.1) * 100) / 100) });
        return true;
      case '}':
        patch(settings.brush, { strength: Math.min(1, Math.round((b.strength + 0.1) * 100) / 100) });
        return true;
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
        this.keysDown.add(e.key);
        return true;
    }
    return false;
  }

  keyUp(e: KeyboardEvent): void {
    this.keysDown.delete(e.key);
    this.keysDown.delete(`fly:${e.key.toLowerCase()}`);
  }

  /** The arrow keys move the view, held fly keys fly it */
  moveByKeys(dt: number): void {
    if (!this.keysDown.size) return;
    const controller = this.host.controller;
    const speed = controller.goal.distance * 0.9 * dt;
    let right = 0;
    let forward = 0;
    if (this.keysDown.has('ArrowUp')) forward += speed;
    if (this.keysDown.has('ArrowDown')) forward -= speed;
    if (this.keysDown.has('ArrowRight')) right += speed;
    if (this.keysDown.has('ArrowLeft')) right -= speed;
    // Flying: faster with Shift, Q and E change the height above the ground
    const fly = (this.pointer?.shift ? 3 : 1) * speed;
    let up = 0;
    if (this.keysDown.has('fly:w')) forward += fly;
    if (this.keysDown.has('fly:s')) forward -= fly;
    if (this.keysDown.has('fly:d')) right += fly;
    if (this.keysDown.has('fly:a')) right -= fly;
    if (this.keysDown.has('fly:e')) up += fly;
    if (this.keysDown.has('fly:q')) up -= fly;
    controller.fly(forward, right, up);
  }

  /**
   * Once a frame: one ground raycast for the tool and the cursor (only when
   * the pointer moved or a tool drags), the drag's move, the tool's frame.
   * Returns the pointer as the tool saw it, null off the view.
   */
  frame(dt: number): ToolPointer | null {
    const p = this.pointer;
    const ctx = this.host.ctx;
    let tp: ToolPointer | null = null;
    if (p && !this.cameraDrag) {
      const hit = this.pointerMoved || this.toolDrag ? this.host.ground(p.clientX, p.clientY) : this.lastHit;
      this.lastHit = hit;
      tp = { hit, clientX: p.clientX, clientY: p.clientY, button: p.button, shift: p.shift, ctrl: p.ctrl, alt: p.alt };
      if (this.toolDrag && this.pointerMoved) this.current?.pointerMove?.(tp, ctx);
      this.pointerMoved = false;
    }
    this.current?.frame?.(dt, tp, ctx);
    return tp;
  }

  dispose(): void {
    for (const u of this.unsubscribe) u();
    this.current?.deactivate?.(this.host.ctx);
  }

  private toolPointer(e: PointerLike, hit: MapHit | null): ToolPointer {
    return { hit, clientX: e.clientX, clientY: e.clientY, button: e.button, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey };
  }

  private onPointerDown(e: PointerEvent): void {
    const { canvas, ctx } = this.host;
    canvas.focus({ preventScroll: true });
    if (this.host.interrupt()) {
      e.preventDefault();
      return;
    }
    this.trackPointer(e);
    const tool = this.current;
    const pan = e.button === 1 || (e.button === 2 && e.shiftKey);
    if (e.button === 0 && tool && !this.locked) {
      const hit = this.host.ground(e.clientX, e.clientY);
      this.lastHit = hit;
      if (tool.pointerDown?.(this.toolPointer(e, hit), ctx)) {
        this.toolDrag = true;
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
    }
    if (e.button === 2 && !pan && tool) {
      // A right click may end something in the tool (a road being drawn); a drag still turns the view
      tool.pointerDown?.(this.toolPointer(e, this.lastHit), ctx);
    }
    if (e.button === 1 || e.button === 2) {
      this.cameraDrag = { mode: pan ? 'pan' : 'rotate', x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  }

  private onPointerMove(e: PointerEvent): void {
    this.trackPointer(e);
    const drag = this.cameraDrag;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (drag.mode === 'rotate') this.host.controller.rotate(dx, dy);
    else this.host.controller.pan(dx, dy, this.host.canvas.clientHeight, this.host.fov());
  }

  private onPointerUp(e: PointerEvent): void {
    const { canvas, ctx } = this.host;
    this.trackPointer(e);
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (this.toolDrag) {
      this.toolDrag = false;
      const hit = this.host.ground(e.clientX, e.clientY);
      this.current?.pointerMove?.(this.toolPointer(e, hit), ctx);
      this.current?.pointerUp?.(this.toolPointer(e, hit), ctx);
    }
    if (this.cameraDrag) for (const k of FLY_KEYS) this.keysDown.delete(`fly:${k}`);
    this.cameraDrag = null;
  }

  private onWheel(e: WheelEvent): void {
    const { ctx, settings } = this.host;
    e.preventDefault();
    if (this.host.interrupt()) return;
    const tool = this.current;
    // Ctrl and the wheel size the brush where one shows (Ctrl+wheel would zoom the page otherwise)
    if ((e.ctrlKey || e.metaKey) && tool?.brushVisible(ctx)) {
      patch(settings.brush, { radius: stepRadius(settings.brush().radius, e.deltaY < 0 ? 1 : -1) });
      return;
    }
    // A tool may take the wheel with a modifier (Place turns with Shift); with Shift some systems scroll sideways (deltaX)
    const delta = e.deltaY || e.deltaX;
    if (delta && tool?.wheel?.(Math.sign(delta), this.toolPointer(e, null), ctx)) return;
    const steps = Math.sign(e.deltaY) * Math.min(3, Math.abs(e.deltaY) / 100 || 1);
    const hit = this.host.ground(e.clientX, e.clientY);
    this.host.controller.zoom(steps, hit ? mapToScene(hit.x, hit.y, hit.z) : null);
  }

  private trackPointer(e: PointerEvent): void {
    this.pointer = { clientX: e.clientX, clientY: e.clientY, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, button: e.button };
    this.pointerMoved = true;
  }
}
