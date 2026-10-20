import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlobeSquares, StageGlobes } from './stage-globes';
import type { StageGlobeId } from '../globe/globe-stage';

/** The stage's renderer stands in: no WebGL here; it records the pictures it is asked for */
const drawn = vi.hoisted(() => ({ pictures: [] as string[], frames: 0, ready: null as null | (() => void) }));
vi.mock('../globe/globe-stage', () => ({
  GlobeStage: class {
    readonly ready = new Promise<void>((resolve) => (drawn.ready = resolve));
    readonly maps = { setMaps: () => undefined, spotOf: () => null };
    resize(): void {
      /* no canvas size here */
    }
    render(): [] {
      drawn.frames++;
      return [];
    }
    picture(globe: string): boolean {
      drawn.pictures.push(globe);
      return true;
    }
    dispose(): void {
      /* nothing held */
    }
  },
}));

/**
 * The globes' squares on the stage (E207 after review): at rest a frame reads
 * nothing from the layout; the hover comes from the cards' events and makes
 * the squares be read again while the scale's transition runs.
 */
describe('GlobeSquares', () => {
  let squares: GlobeSquares | null = null;
  afterEach(() => {
    squares?.dispose();
    document.body.innerHTML = '';
  });

  function stage() {
    document.body.innerHTML = `
      <div id="host">
        <canvas id="canvas"></canvas>
        <button class="ws-card" id="osm"><span data-globe="osm"></span><span class="name">OpenStreetMap</span></button>
        <button class="ws-card" id="maps"><span data-globe="maps"></span></button>
        <button id="plain">Settings</button>
      </div>`;
    const host = document.getElementById('host')!;
    const reads = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
    let now = 0;
    squares = new GlobeSquares(host, document.getElementById('canvas')!, () => now);
    return { host, reads, advance: (ms: number) => (now += ms), el: (id: string) => document.getElementById(id)! };
  }

  it('reads the squares once, then not again at rest', () => {
    const { reads, advance } = stage();
    expect(squares!.read().map((q) => q.globe)).toEqual(['osm', 'maps']);
    const first = reads.mock.calls.length;
    expect(first).toBe(3);
    advance(1000);
    expect(squares!.moving).toBe(false);
    for (let k = 0; k < 10; k++) squares!.read();
    expect(reads.mock.calls.length).toBe(first);
  });

  it('knows the hovered globe from the pointer and reads the squares again while the scale moves them', () => {
    const { reads, advance, el } = stage();
    squares!.read();
    advance(1000);
    const before = reads.mock.calls.length;
    el('osm').querySelector('.name')!.dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(squares!.hovered('osm')).toBe(true);
    expect(squares!.hovered('maps')).toBe(false);
    expect(squares!.moving).toBe(true);
    squares!.read();
    advance(300);
    squares!.read();
    expect(reads.mock.calls.length).toBe(before + 6);
    advance(400);
    expect(squares!.moving).toBe(false);
    // A button without a globe is no hover
    el('plain').dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(squares!.anyHovered).toBe(false);
    el('maps').dispatchEvent(new Event('pointerover', { bubbles: true }));
    el('host').dispatchEvent(new Event('pointerleave'));
    expect(squares!.anyHovered).toBe(false);
  });
});

/**
 * The still pictures of the globes for the menu's Continue: taken once per
 * globe after the earth's maps are up, the maps' again after its towers
 * changed, and never asked for again in the frames after.
 */
describe('StageGlobes pictures', () => {
  let globes: StageGlobes | null = null;
  afterEach(() => {
    globes?.dispose();
    globes = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('takes each globe once when the earth is ready, the maps again after new towers', async () => {
    drawn.pictures = [];
    drawn.frames = 0;
    let tick: ((now: number) => void) | null = null;
    vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => ((tick = cb), 1));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      return { canvas: this } as unknown as RenderingContext;
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AA');
    document.body.innerHTML = '<div id="host"><canvas id="canvas"></canvas><span data-globe="real"></span></div>';
    const got: [StageGlobeId, string][] = [];
    globes = new StageGlobes(
      document.getElementById('host')!,
      document.getElementById('canvas') as HTMLCanvasElement,
      () => ({ target: null, saturation: 1 }),
      () => null,
      () => undefined,
      (globe, url) => got.push([globe, url]),
    );
    globes.start('low', 0);
    let now = 0;
    const frame = () => tick!((now += 1000));

    frame();
    expect(drawn.pictures).toEqual([]);
    drawn.ready!();
    await Promise.resolve();
    frame();
    expect(got).toEqual([['real', 'data:image/png;base64,AA'], ['osm', 'data:image/png;base64,AA'], ['maps', 'data:image/png;base64,AA']]);
    // The frame's globes are drawn after the pictures, in the same frame
    expect(drawn.frames).toBe(2);
    frame();
    frame();
    expect(drawn.pictures).toHaveLength(3);

    globes.setMaps([{ id: 'bay' }], null);
    frame();
    expect(drawn.pictures).toEqual(['real', 'osm', 'maps', 'maps']);
  });
});
