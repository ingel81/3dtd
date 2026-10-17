import { describe, expect, it } from 'vitest';
import { loadingRows, makingView, reduceProgress, thinProgress, PROGRESS_EVERY_MS, OSM_MAKE_STEPS, OSM_STEPS, type OsmProgress, type OsmProgressState } from './osm-progress';

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
    expect(view.current).toEqual({ text: 'Levelling the ground under the streets', detail: null });
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
      { step: 'stored', state: 'done', detail: 'nothing kept yet' },
      { step: 'overpass' },
      { step: 'heights' },
      { step: 'heights', share: 0.5, detail: '3 of 6 tiles' },
      { step: 'overpass', detail: '2.1 MB received' },
      { step: 'heights', state: 'failed', detail: 'none came, the ground will be flat' },
    ]);
    expect(loadingRows(state).map((r) => `${r.step} ${r.status} ${r.detail}`)).toEqual([
      'stored done nothing kept yet',
      'overpass active 2.1 MB received',
      'heights failed none came, the ground will be flat',
    ]);
  });

  it('thins a step that only counts on, never one that begins or ends', () => {
    let t = 0;
    const sent: OsmProgress[] = [];
    const send = thinProgress((e) => sent.push(e), () => t);
    send({ step: 'overpass' });
    send({ step: 'overpass', detail: '1 MB' });
    t += PROGRESS_EVERY_MS - 1;
    send({ step: 'overpass', detail: '2 MB' });
    send({ step: 'heights' });
    t += 1;
    send({ step: 'overpass', detail: '3 MB' });
    send({ step: 'overpass', state: 'done', detail: '3.2 MB' });
    expect(sent.map((e) => `${e.step} ${e.state ?? ''} ${e.detail ?? ''}`.trim())).toEqual(['overpass', 'heights', 'overpass  3 MB', 'overpass done 3.2 MB']);
  });
});
