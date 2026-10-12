import { PerspectiveCamera, type WebGLRenderer } from 'three';
import type { TilesRenderer } from '3d-tiles-renderer';
import { DiveView } from './dive-view';

/** A warm-up under way, its steps set by hand: the tiles' counts as the renderer has them */
function setup(steps: number) {
  const tiles = { stats: { queued: 0, downloading: 0, parsing: 0 }, activeTiles: new Set<number>() };
  const view = new DiveView({
    tiles: () => tiles as unknown as TilesRenderer,
    renderer: {} as WebGLRenderer,
    camera: new PerspectiveCamera(),
    fog: () => null,
    prerender: () => undefined,
  });
  const inner = view as unknown as { warmSteps: number; warmStep: number; stepShare: number };
  inner.warmSteps = steps;
  const load = (active: number, pending: number) => {
    tiles.activeTiles = new Set(Array.from({ length: active }, (_, i) => i));
    tiles.stats.downloading = pending;
  };
  return { view, inner, load };
}

describe('DiveView.warmProgress', () => {
  it('says nothing without a warm-up', () => {
    expect(setup(0).view.warmProgress()).toBeNull();
  });

  it('counts over the steps and never steps back when a new camera asks for more tiles', () => {
    const { view, inner, load } = setup(4);
    load(50, 50);
    expect(view.warmProgress()).toBe(12);
    load(90, 10);
    expect(view.warmProgress()).toBe(22);
    // The next camera: many new tiles to come, the share of tiles in drops
    inner.warmStep = 1;
    inner.stepShare = 0;
    load(100, 300);
    expect(view.warmProgress()).toBe(31);
    load(100, 900);
    expect(view.warmProgress()).toBe(31);
    // The last step done: at most 99 until the warm-up ends
    inner.warmStep = 3;
    load(1000, 1);
    expect(view.warmProgress()).toBe(99);
  });
});
