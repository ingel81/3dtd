import { describe, expect, it } from 'vitest';
import { loadingRows, loadingView, makingView, reduceProgress, thinProgress, PROGRESS_EVERY_MS, OSM_MAKE_STEPS, OSM_STEPS, type OsmProgress, type OsmProgressState } from './osm-progress';
import { say } from '../../i18n/said';
import { en } from '../../i18n/messages/en';

/** The events of the making and the load as the worker sends them, added up and drawn (E218) */
describe('OSM world progress', () => {
  const add = (events: OsmProgress[], from: OsmProgressState = {}) => events.reduce((s, e) => reduceProgress(s, e), from);

  it('a step without a share of its own moves by its time against its weight, short of its end', () => {
    const parse = { ...add([{ step: 'parse' }]).parse!, since: 0 };
    const total = OSM_MAKE_STEPS.reduce((sum, s) => sum + OSM_STEPS[s].weight, 0);
    const at = (ms: number, share = 0) => makingView({ parse: { ...parse, share } }, ms).share;
    expect(at(0)).toBe(0);
    expect(at(OSM_STEPS.parse.weight / 2)).toBeCloseTo((0.5 * OSM_STEPS.parse.weight) / total, 6);
    // Never past 90 % of the step on time alone; a share it reports counts when it is further
    expect(at(1e9)).toBeCloseTo((0.9 * OSM_STEPS.parse.weight) / total, 6);
    expect(at(0, 0.95)).toBeCloseTo((0.95 * OSM_STEPS.parse.weight) / total, 6);
  });

  it('a step of the making that begins ends the ones before it; the bar goes by weight', () => {
    const state = add([{ step: 'parse' }, { step: 'terrain' }, { step: 'roads' }, { step: 'water' }, { step: 'level', share: 0.5 }]);
    expect(state.parse?.status).toBe('done');
    expect(state.water?.status).toBe('done');
    expect(state.level).toMatchObject({ status: 'active', share: 0.5 });
    const view = makingView(state);
    expect(view.stages.map((s) => `${s.id} ${s.status}`)).toEqual([
      'data done', 'terrain done', 'streets done', 'water done', 'ground active', 'layout waiting', 'buildings waiting', 'trees waiting', 'bake waiting',
    ]);
    expect(view.current).toEqual({ step: 'level', detail: null });
    expect(view.index).toBe(5);
    expect(view.share).toBeGreaterThan(0.1);
    expect(view.share).toBeLessThan(0.5);
    const end = add([{ step: 'save', state: 'done' }], state);
    expect(OSM_MAKE_STEPS.every((s) => end[s]?.status === 'done')).toBe(true);
    expect(makingView(end).share).toBe(1);
  });

  it('the downloads side by side end each on its own and say what came', () => {
    const state = add([
      { step: 'stored' },
      { step: 'stored', state: 'done', detail: { key: 'nothingKept' } },
      { step: 'overpass' },
      { step: 'heights' },
      { step: 'heights', share: 0.5, detail: { key: 'tiles', v: { done: 3, of: 6 } } },
      { step: 'overpass', detail: { key: 'received', v: { chars: 2.1e6 } } },
      { step: 'heights', state: 'failed', detail: { key: 'noHeights' } },
    ]);
    expect(loadingRows(state).map((r) => `${r.step} ${r.status} ${r.detail ? say(en.osm.detail, r.detail) : ''}`)).toEqual([
      'stored done nothing kept yet',
      'overpass active 2.1 MB received',
      'heights failed none came, the ground will be flat',
    ]);
  });

  it('the veil over the square: the share of the load by its weights, the row under way', () => {
    const t = 1000;
    const asking = add([{ step: 'stored' }, { step: 'stored', state: 'done', detail: { key: 'nothingKept' } }, { step: 'overpass' }, { step: 'heights' }]);
    const view = loadingView(asking, t);
    expect(view.current?.step).toBe('overpass');
    expect(view.share).toBeGreaterThan(0);
    expect(view.share).toBeLessThan(0.5);
    // Found on this device: the downloads do not count, the streets are the rest
    const found = add([{ step: 'stored' }, { step: 'stored', state: 'done', detail: { key: 'found' } }, { step: 'streets' }]);
    expect(loadingView(found, t).current?.step).toBe('streets');
    expect(loadingView(found, t).share).toBeGreaterThan(0.4);
    const end = add([{ step: 'streets', state: 'done' }], found);
    expect(loadingView(end, t)).toMatchObject({ share: 1, current: { step: 'streets', status: 'done' } });
    expect(loadingView({}, t)).toEqual({ share: 0, current: null });
  });

  it('thins a step that only counts on, never one that begins or ends', () => {
    let t = 0;
    const sent: OsmProgress[] = [];
    const send = thinProgress((e) => sent.push(e), () => t);
    send({ step: 'overpass' });
    send({ step: 'overpass', detail: { key: 'size', v: { chars: 1e6 } } });
    t += PROGRESS_EVERY_MS - 1;
    send({ step: 'overpass', detail: { key: 'size', v: { chars: 2e6 } } });
    send({ step: 'heights' });
    t += 1;
    send({ step: 'overpass', detail: { key: 'size', v: { chars: 3e6 } } });
    send({ step: 'overpass', state: 'done', detail: { key: 'size', v: { chars: 3.2e6 } } });
    expect(sent.map((e) => `${e.step} ${e.state ?? ''} ${e.detail ? say(en.osm.detail, e.detail) : ''}`.trim())).toEqual(['overpass', 'heights', 'overpass  3.0 MB', 'overpass done 3.2 MB']);
  });
});
