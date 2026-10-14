/**
 * The showreel's director ("Regie"): plays a scene, a list of steps given as
 * data by the runner (tools/showreel/script.mjs), on the page's frame clock.
 * Camera shots, the drawn pointer's clicks and strokes, keys and the stage's
 * own actions; every scene and labelled step leaves a time mark
 * (performance.now()) for the cut.
 */
import { shotPlayer, type CameraPose, type Ease, type MapPoint3, type Shot } from './camera-path';
import { Hands, element, nextFrame, waitSeconds, waitUntil } from './hands';
import { pressKey, typeInto, type Mods } from './pointer';
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
          await this.hands.pointer.glide(() => this.hands.centerOf(el), dur || 0.7, nextFrame, mods);
        } else await this.hands.toMap(stage, this.point(to as PointSpec), dur || 0.8, mods);
        return;
      }
      case 'click':
        return this.hands.click(await this.find(step), dur || 0.7, Number(step['button'] ?? 0), mods);
      case 'clickMap':
        return this.hands.clickMap(stage, this.point(step['at'] as PointSpec), dur || 0.8, Number(step['button'] ?? 0), mods);
      case 'stroke':
        return this.hands.stroke(
          stage,
          (step['points'] as PointSpec[]).map((p) => this.point(p)),
          dur || 2,
          Number(step['button'] ?? 0),
          mods,
          Number(step['settle'] ?? 0.15),
        );
      case 'key':
        pressKey(String(step['key']), mods);
        await nextFrame();
        return;
      case 'type': {
        const input = (await this.find(step)) as HTMLInputElement;
        await this.hands.click(input, dur || 0.6);
        await typeInto(input, String(step['text'] ?? ''), Number(step['cps'] ?? 12), nextFrame);
        return;
      }
      case 'select': {
        const select = (await this.find(step)) as HTMLSelectElement;
        await this.hands.click(select, dur || 0.6);
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
      const all = Array.from(document.querySelectorAll<HTMLElement>(sel));
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
   * A slider dragged by the pointer to `value`: the thumb's place from the
   * input's range, `input` events on the way, `change` on release
   */
  private async range(host: HTMLElement, value: number, seconds: number): Promise<void> {
    const input = (host instanceof HTMLInputElement ? host : host.querySelector('input[type=range]')) as HTMLInputElement | null;
    if (!input) throw new Error('showreel: no range input there');
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
