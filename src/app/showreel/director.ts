/**
 * The showreel's director ("Regie"): plays a scene, a list of steps given as
 * data by the runner (tools/showreel/script.mjs), on the page's frame clock.
 * Camera shots, the drawn pointer's clicks and strokes, keys and the stage's
 * own actions; every scene and labelled step leaves a time mark
 * (performance.now()) for the cut.
 */
import { shotPlayer, type CameraPose, type Ease, type MapPoint3, type Shot } from './camera-path';
import { Hands, element, nextFrame, waitSeconds, waitUntil } from './hands';
import { pressKey, typeInto, type Mods, type ScreenPoint } from './pointer';
import type { Stage } from './stage';

/**
 * A map point as the script writes it: `[fx, fy, h?]` shares of the map's
 * width and depth around its middle; `{ at: 'hq' | 'center' | 'spawn:0', dx, dy }`
 * metres from a named spot; `{ m: [x, y] }` metres. `h` is metres above the
 * ground there, `habs` an absolute height; neither: on the ground, followed
 * live while it changes.
 */
export type PointSpec =
  | [number, number]
  | [number, number, number]
  | { at?: string; m?: [number, number]; f?: [number, number]; dx?: number; dy?: number; h?: number; habs?: number };

export interface Step {
  do: string;
  /** A time mark with this name when the step starts */
  label?: string;
  [key: string]: unknown;
}

export interface Scene {
  name: string;
  steps: Step[];
}

export interface Mark {
  /** performance.now() */
  t: number;
  kind: 'scene-start' | 'scene-end' | 'step' | 'mark';
  scene: string;
  label: string;
}

export class Director {
  readonly marks: Mark[] = [];
  private scene = '';
  private fade: HTMLDivElement | null = null;

  constructor(
    private readonly stage: () => Stage,
    readonly hands: Hands,
  ) {}

  private mark(kind: Mark['kind'], label: string): void {
    this.marks.push({ t: performance.now(), kind, scene: this.scene, label });
  }

  async run(scene: Scene): Promise<Mark[]> {
    const first = this.marks.length;
    this.scene = scene.name;
    await nextFrame();
    this.mark('scene-start', scene.name);
    try {
      await this.steps(scene.steps);
    } finally {
      this.mark('scene-end', scene.name);
    }
    return this.marks.slice(first);
  }

  private async steps(steps: readonly Step[]): Promise<void> {
    for (const step of steps) await this.step(step);
  }

  /** A map point of the open map; `live` leaves the height to the ground under it */
  point(spec: PointSpec): MapPoint3 {
    const stage = this.stage();
    const size = stage.mapSize() ?? { width: 512, depth: 512 };
    let x = 0;
    let y = 0;
    let h: number | undefined;
    let habs: number | undefined;
    if (Array.isArray(spec)) {
      x = spec[0] * size.width;
      y = spec[1] * size.depth;
      h = spec[2];
    } else {
      if (spec.at) {
        const named = stage.named(spec.at);
        if (!named) throw new Error(`showreel: no spot ${spec.at} on this map`);
        x = named.x;
        y = named.y;
      } else if (spec.m) [x, y] = spec.m;
      else if (spec.f) [x, y] = [spec.f[0] * size.width, spec.f[1] * size.depth];
      x += spec.dx ?? 0;
      y += spec.dy ?? 0;
      h = spec.h;
      habs = spec.habs;
    }
    if (habs !== undefined) return { x, y, h: habs };
    if (h !== undefined) return { x, y, h: stage.groundAt(x, y) + h };
    return { x, y, h: Number.NaN };
  }

  /** A point with its height fixed now (the ground's where it had none) */
  private fixed(spec: PointSpec): MapPoint3 {
    const p = this.point(spec);
    return Number.isNaN(p.h) ? { ...p, h: this.stage().groundAt(p.x, p.y) } : p;
  }

  private async step(step: Step): Promise<void> {
    if (step.label) this.mark('step', step.label);
    const stage = this.stage();
    const dur = Number(step['dur'] ?? 0);
    const mods = (step['mods'] as Mods | undefined) ?? {};
    switch (step.do) {
      case 'mark':
        this.mark('mark', String(step['name'] ?? step.label ?? ''));
        return;
      case 'wait':
        return waitSeconds(dur);
      case 'par':
        await Promise.all((step['steps'] as Step[]).map((s) => this.steps([s])));
        return;
      case 'seq':
        return this.steps(step['steps'] as Step[]);
      case 'if':
        // Steps for a part that may not be there yet (a tool another branch builds): skipped without it
        if (document.querySelector(String(step['sel']))) await this.steps(step['steps'] as Step[]);
        else this.mark('mark', `skipped: no ${String(step['sel'])}`);
        return;
      case 'shot':
        return this.shot(
          {
            kind: 'path',
            // 'current' starts where the camera is, so a shot follows on from whatever came before
            keys: (step['keys'] as ({ eye: PointSpec; look: PointSpec } | 'current')[]).map((k) =>
              k === 'current' ? (stage.pose() ?? { eye: this.fixed([0, -0.5, 200]), look: this.fixed([0, 0]) }) : { eye: this.fixed(k.eye), look: this.fixed(k.look) },
            ),
            ease: (step['ease'] as Ease) ?? 'inOut',
            even: step['even'] as boolean | undefined,
          },
          dur,
        );
      case 'orbit':
        return this.shot(
          {
            kind: 'orbit',
            center: this.fixed((step['center'] as PointSpec) ?? { at: 'center' }),
            from: Number(step['from'] ?? 0),
            to: Number(step['to'] ?? 90),
            radius: Number(step['radius'] ?? 200),
            radiusTo: step['radiusTo'] as number | undefined,
            height: Number(step['height'] ?? 120),
            heightTo: step['heightTo'] as number | undefined,
            ease: (step['ease'] as Ease) ?? 'inOut',
          },
          dur,
        );
      case 'frame':
        return this.frame(step);
      case 'follow':
        return this.follow(step);
      case 'release':
        stage.setPose(null);
        return;
      case 'cursor':
        this.hands.pointer.show(step['show'] !== false);
        return;
      case 'move': {
        const to = step['to'];
        if (typeof to === 'string') {
          const el = element(to);
          this.hands.pointer.show(true);
          await this.hands.pointer.glide(() => this.hands.centerOf(el), dur || 0.5, nextFrame, mods);
        } else {
          const at = this.point(to as PointSpec);
          await this.inView([at], step);
          await this.hands.toMap(stage, at, dur || 0.6, mods);
        }
        return;
      }
      case 'click':
        return this.hands.click(await this.find(step), dur || 0.5, Number(step['button'] ?? 0), mods);
      case 'clickMap': {
        const at = this.point(step['at'] as PointSpec);
        await this.inView([at], step);
        return this.hands.clickMap(stage, at, dur || 0.6, Number(step['button'] ?? 0), mods);
      }
      case 'stroke': {
        const points = (step['points'] as PointSpec[]).map((p) => this.point(p));
        await this.inView(points, step);
        return this.hands.stroke(
          stage,
          points,
          dur || 2,
          Number(step['button'] ?? 0),
          mods,
          Number(step['settle'] ?? 0.15),
        );
      }
      case 'key':
        pressKey(String(step['key']), mods);
        await nextFrame();
        return;
      case 'type': {
        const input = (await this.find(step)) as HTMLInputElement;
        await this.hands.click(input, dur || 0.45);
        await typeInto(input, String(step['text'] ?? ''), Number(step['cps'] ?? 12), nextFrame);
        return;
      }
      case 'select': {
        const select = (await this.find(step)) as HTMLSelectElement;
        await this.hands.click(select, dur || 0.45);
        await waitSeconds(0.25);
        select.value = String(step['value']);
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      case 'range':
        return this.range(await this.find(step), Number(step['to']), dur || 1.2);
      case 'waitFor':
        if (step['sel']) {
          const sel = String(step['sel']);
          await waitUntil(() => !!document.querySelector(sel), Number(step['timeout'] ?? 30), sel);
        } else await waitUntil(() => stage.ready(), Number(step['timeout'] ?? 60), `the ${stage.kind}`);
        return;
      case 'ui':
        // The page's own UI in the picture or a clean frame: the game's photo mode, the editor without its frame
        return stage.act('ui', { on: step['on'] !== false });
      case 'legend':
        document.documentElement.classList.toggle('sr-no-legend', step['on'] === false);
        return;
      case 'markers':
        return stage.kind === 'game' ? stage.act('markers', { on: step['on'] !== false }) : undefined;
      case 'upload': {
        // A file from the runner's disk into a file input (Playwright's setInputFiles, page.exposeFunction): a
        // page cannot read a local path, and clicking the input would open the system's file dialog
        const upload = (window as unknown as { __showreelUpload?: (sel: string, file: string) => Promise<void> }).__showreelUpload;
        if (!upload) throw new Error('showreel: the runner offers no upload');
        await upload(String(step['sel']), String(step['file']));
        return;
      }
      case 'fade':
        return this.fadeTo(Number(step['to'] ?? 0), dur);
      case 'act': {
        const { do: _do, label: _label, name, ...args } = step;
        // A spot for the action (where to build) as a map point
        if (args['at'] !== undefined) args['at'] = this.point(args['at'] as PointSpec);
        return stage.act(String(name), args);
      }
      default:
        throw new Error(`showreel: no step ${step.do}`);
    }
  }

  /**
   * The element a step names: `sel`, the first whose text is `withText` when
   * given; waits up to `timeout` seconds (5) for it, as a panel renders after the click that opens it
   */
  private async find(step: Step): Promise<HTMLElement> {
    const sel = String(step['sel']);
    const text = step['withText'] as string | undefined;
    const pick = (): HTMLElement | null => {
      // Shown ones only: hidden panels keep their buttons (the same data-mode in two tools), under visibility: hidden
      const all = Array.from(document.querySelectorAll<HTMLElement>(sel)).filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
      if (text === undefined) return all[0] ?? null;
      return all.find((el) => el.textContent?.trim() === text) ?? all.find((el) => el.textContent?.includes(text)) ?? null;
    };
    let found = pick();
    if (!found) {
      await waitUntil(() => (found = pick()) !== null, Number(step['timeout'] ?? 5), text === undefined ? sel : `${sel} with text ${text}`);
    }
    return found!;
  }

  private async shot(shot: Shot, seconds: number): Promise<void> {
    const stage = this.stage();
    const play = shotPlayer(shot);
    const start = await nextFrame();
    for (;;) {
      const t = seconds <= 0 ? 1 : Math.min(1, ((await nextFrame()) - start) / (seconds * 1000));
      stage.setPose(play(t));
      if (t >= 1) return;
    }
  }

  /**
   * The camera on a group of map points (`points`, `margin` metres round each, a brush): looking at their middle
   * from the current direction (or `from`, degrees as in orbit) at `pitch` degrees, far enough for all of them
   * to fit; during `dur` it turns `turn` degrees round them. Use it beside strokes (par) for a camera that moves
   * and still shows the work.
   */
  private async frame(step: Step): Promise<void> {
    const stage = this.stage();
    const points = (step['points'] as PointSpec[]).map((p) => this.fixed(p));
    const margin = Number(step['margin'] ?? 30);
    const cx = points.reduce((n, p) => n + p.x, 0) / points.length;
    const cy = points.reduce((n, p) => n + p.y, 0) / points.length;
    const ch = stage.groundAt(cx, cy);
    const radius = Math.max(...points.map((p) => Math.hypot(p.x - cx, p.y - cy))) + margin;
    const fov = Number(step['fov'] ?? (stage.kind === 'editor' ? 50 : 60));
    const distance = (radius * Number(step['pad'] ?? 1.25)) / Math.tan(((fov / 2) * Math.PI) / 180);
    const pitch = (Number(step['pitch'] ?? 40) * Math.PI) / 180;
    const now = stage.pose();
    const from = step['from'] !== undefined
      ? Number(step['from'])
      : now
        ? (Math.atan2(now.eye.x - now.look.x, -(now.eye.y - now.look.y)) * 180) / Math.PI
        : 0;
    const turn = Number(step['turn'] ?? 0);
    const poseAt = (deg: number): CameraPose => {
      const a = (deg * Math.PI) / 180;
      const hd = distance * Math.cos(pitch);
      return {
        eye: { x: cx + Math.sin(a) * hd, y: cy - Math.cos(a) * hd, h: ch + distance * Math.sin(pitch) },
        look: { x: cx, y: cy, h: ch },
      };
    };
    const glide = Number(step['glide'] ?? 0.8);
    if (now) await this.shot({ kind: 'path', keys: [now, poseAt(from)], ease: 'inOut' }, glide);
    const dur = Number(step['dur'] ?? 0) - glide;
    if (dur > 0) await this.shot({ kind: 'orbit', center: { x: cx, y: cy, h: ch }, from, to: from + turn, radius: distance * Math.cos(pitch), height: distance * Math.sin(pitch), ease: 'smooth' }, dur);
  }

  /** Whether a screen point lies well inside the map's canvas, on the canvas itself (no panel over it) */
  private onCanvas(p: ScreenPoint | null): boolean {
    const canvas = this.stage().canvas();
    if (!p || !canvas) return false;
    const r = canvas.getBoundingClientRect();
    const mx = r.width * 0.08;
    const my = r.height * 0.08;
    if (p.x < r.left + mx || p.x > r.right - mx || p.y < r.top + my || p.y > r.bottom - my) return false;
    return document.elementFromPoint(p.x, p.y) === canvas;
  }

  /**
   * Map input only where the viewer sees it: when a point of a click or
   * stroke lies off the canvas, behind the camera or under a panel, the
   * camera glides over (the view moved onto the points, then pulled back
   * until they fit) and the console says so, as the script's camera missed
   */
  private async inView(points: MapPoint3[], step: Step): Promise<void> {
    const stage = this.stage();
    const all = () => points.every((p) => this.onCanvas(stage.toScreen(p)));
    if (all()) return;
    console.warn(`[showreel] ${this.scene}: ${step.do} ${step.label ?? ''} off screen, the camera reframes`);
    const pose = stage.pose();
    if (!pose) return;
    const cx = points.reduce((n, p) => n + p.x, 0) / points.length;
    const cy = points.reduce((n, p) => n + p.y, 0) / points.length;
    const ch = stage.groundAt(cx, cy);
    let off = { x: pose.eye.x - pose.look.x, y: pose.eye.y - pose.look.y, h: Math.max(20, pose.eye.h - pose.look.h) };
    for (let attempt = 0; attempt < 5; attempt++) {
      const goal = { look: { x: cx, y: cy, h: ch }, eye: { x: cx + off.x, y: cy + off.y, h: ch + off.h } };
      await this.shot({ kind: 'path', keys: [stage.pose() ?? pose, goal], ease: 'inOut' }, attempt ? 0.4 : 0.8);
      if (all()) return;
      off = { x: off.x * 1.35, y: off.y * 1.35, h: off.h * 1.35 };
    }
  }

  /**
   * A chase camera on a moving spot (`at`, read every frame, e.g. `runner:0`): behind it by `back` metres along
   * its way, `side` to its right, `h` above the ground, looking `ahead` metres past it; position and direction
   * smoothed so the camera glides. Ends after `dur` seconds or when the spot is gone.
   */
  private async follow(step: Step): Promise<void> {
    const stage = this.stage();
    const spec = step['at'] as PointSpec;
    const back = Number(step['back'] ?? 14);
    const side = Number(step['side'] ?? 4);
    const up = Number(step['h'] ?? 4);
    const ahead = Number(step['ahead'] ?? 10);
    const seconds = Number(step['dur'] ?? 6);
    const first = this.point(spec);
    let at = { x: first.x, y: first.y };
    let dir = { x: 1, y: 0 };
    let last = await nextFrame();
    const start = last;
    for (;;) {
      const now = await nextFrame();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      let p: MapPoint3;
      try {
        p = this.point(spec);
      } catch {
        return;
      }
      const k = 1 - Math.exp(-dt * 3);
      const nx = at.x + (p.x - at.x) * k;
      const ny = at.y + (p.y - at.y) * k;
      const vx = nx - at.x;
      const vy = ny - at.y;
      const len = Math.hypot(vx, vy);
      if (len > 1e-3) {
        const kd = 1 - Math.exp(-dt * 2);
        const tx = dir.x + (vx / len - dir.x) * kd;
        const ty = dir.y + (vy / len - dir.y) * kd;
        const tl = Math.hypot(tx, ty) || 1;
        dir = { x: tx / tl, y: ty / tl };
      }
      at = { x: nx, y: ny };
      const ex = at.x - dir.x * back + dir.y * side;
      const ey = at.y - dir.y * back - dir.x * side;
      const lx = at.x + dir.x * ahead;
      const ly = at.y + dir.y * ahead;
      stage.setPose({
        eye: { x: ex, y: ey, h: stage.groundAt(ex, ey) + up },
        look: { x: lx, y: ly, h: stage.groundAt(lx, ly) + 1.5 },
      });
      if (now - start >= seconds * 1000) return;
    }
  }

  /**
   * A slider dragged by the pointer to `value`: the thumb's place from the
   * input's range, `input` events on the way, `change` on release
   */
  private async range(host: HTMLElement, value: number, seconds: number): Promise<void> {
    const input = (host instanceof HTMLInputElement ? host : host.querySelector('input[type=range]')) as HTMLInputElement | null;
    if (!input) throw new Error('showreel: no range input there');
    // A slider low in a long panel: into view first, as a person would scroll to it
    const box = input.getBoundingClientRect();
    if (box.bottom > innerHeight - 40 || box.top < 40) input.scrollIntoView({ block: 'center' });
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const from = Number(input.value);
    const thumbAt = (v: number) => {
      const r = input.getBoundingClientRect();
      const k = (v - min) / (max - min || 1);
      return { x: r.left + 8 + k * (r.width - 16), y: r.top + r.height / 2 };
    };
    this.hands.pointer.show(true);
    await this.hands.pointer.glide(() => thumbAt(from), 0.6, nextFrame);
    this.hands.pointer.down();
    const start = await nextFrame();
    for (;;) {
      const t = Math.min(1, ((await nextFrame()) - start) / (seconds * 1000));
      const k = t * t * (3 - 2 * t);
      const v = from + (value - from) * k;
      this.hands.pointer.moveTo(thumbAt(v));
      input.value = String(v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      if (t >= 1) break;
    }
    this.hands.pointer.up();
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** Black over the page to `opacity` in `seconds` */
  private async fadeTo(opacity: number, seconds: number): Promise<void> {
    if (!this.fade) {
      this.fade = document.createElement('div');
      Object.assign(this.fade.style, { position: 'fixed', inset: '0', background: '#000', opacity: '0', zIndex: '2147483644', pointerEvents: 'none' });
      document.body.append(this.fade);
    }
    const el = this.fade;
    const from = Number(el.style.opacity || 0);
    const start = await nextFrame();
    for (;;) {
      const t = seconds <= 0 ? 1 : Math.min(1, ((await nextFrame()) - start) / (seconds * 1000));
      el.style.opacity = String(from + (opacity - from) * t);
      if (t >= 1) return;
    }
  }

  /** Where the camera is now, for a script to start a shot from */
  currentPose(): CameraPose | null {
    return this.stage().pose();
  }
}
