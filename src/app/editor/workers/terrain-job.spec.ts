import { createMapDocument } from '../../world/custom-map/map-create';
import { finishGenerated, generateTerrain } from '../ops/generate';
import { addNode, connect } from '../ops/path-graph';
import { emptyWater } from '../ops/water-ops';
import { erodeMap } from '../ops/landscape/erosion';
import { runTerrainJob, startTerrainJob, transferList, type TerrainJob } from './terrain-job';

function terrain() {
  return createMapDocument({ id: 'm', name: 'M', width: 400, depth: 400, cellSize: 2, now: new Date(0) }).terrain;
}

describe('terrain jobs', () => {
  it('generate in bands of rows gives the same land as at once', () => {
    const a = terrain();
    const b = terrain();
    const options = { preset: 'valleys' as const, seed: 9, strength: 0.7 };
    const result = generateTerrain(a, options);
    const job: TerrainJob = { kind: 'generate', width: b.width, depth: b.depth, columns: b.grid.columns, rows: b.grid.rows, cellSize: 2, heights: b.grid.heights, options };
    let last = null;
    for (const m of runTerrainJob(job)) {
      if (m.kind === 'rows') b.grid.heights.set(m.heights, m.j0 * b.grid.columns);
      if (m.kind === 'done') last = m.result;
    }
    expect(Array.from(b.grid.heights)).toEqual(Array.from(a.grid.heights));
    expect(last).toEqual(result);
  });

  it('finishes the map off the page as the editor did on it: water, levelled roads, layers, paint', () => {
    const make = () => {
      const doc = createMapDocument({ id: 'm', name: 'M', width: 400, depth: 400, cellSize: 2, now: new Date(0) });
      const a = addNode(doc.paths, { x: -150, y: -40 });
      const b = addNode(doc.paths, { x: 150, y: 60 });
      connect(doc.paths, a.id, b.id, 8);
      return doc;
    };
    const materials = ['grass', 'sand', 'rocky-ground', 'gravel', 'dirt', 'rock'];
    const options = { preset: 'islands' as const, seed: 4, strength: 0.8 };
    // On the page: generate, then the preset's water and finishGenerated
    const page = make();
    const result = generateTerrain(page.terrain, options);
    page.terrain.water = emptyWater(page.terrain, Math.round(result.water! * 10) / 10);
    page.terrain.water.mask.fill(255);
    finishGenerated(page, { ...result, water: null }, (m) => materials.includes(m), true);
    // In the job
    const doc = make();
    const t = doc.terrain;
    const { grid: _grid, ...ground } = t;
    const job: TerrainJob = {
      kind: 'generate', width: t.width, depth: t.depth, columns: t.grid.columns, rows: t.grid.rows, cellSize: 2, heights: t.grid.heights.slice(), options,
      finish: { terrain: structuredClone(ground), paths: doc.paths, materials, repaint: true },
    };
    const finished = [...runTerrainJob(job)].find((m) => m.kind === 'finished')!;
    expect(finished.kind).toBe('finished');
    if (finished.kind !== 'finished') return;
    expect(Array.from(finished.heights)).toEqual(Array.from(page.terrain.grid.heights));
    expect(finished.layers).toEqual(page.terrain.layers);
    expect(finished.splat.map((m) => Array.from(m))).toEqual(page.terrain.splat.maps.map((m) => Array.from(m)));
  });

  it('hands over each buffer of a message once, also splat maps sharing one', () => {
    const block = new ArrayBuffer(32);
    const heights = new Float32Array(4);
    const m = { kind: 'finished' as const, heights, layers: [], splat: [new Uint8Array(block, 0, 16), new Uint8Array(block, 16, 16)], progress: 1 };
    const list = transferList(m);
    expect(list).toEqual([heights.buffer, block]);
    expect(() => structuredClone(m, { transfer: list })).not.toThrow();
    expect(transferList({ kind: 'done', result: null })).toEqual([]);
  });

  it('erode in slices like at once, the land worn down a little', () => {
    const a = terrain();
    generateTerrain(a, { preset: 'hills', seed: 3, strength: 0.8 });
    const b = Float32Array.from(a.grid.heights);
    const before = Float32Array.from(a.grid.heights);
    erodeMap(a.grid.heights, a.grid.columns, a.grid.rows, 2, 5, 1, 0, 9000);
    let final: Float32Array | null = null;
    let slices = 0;
    for (const m of runTerrainJob({ kind: 'erode', columns: a.grid.columns, rows: a.grid.rows, cellSize: 2, heights: b, seed: 5, strength: 1, drops: 9000 })) {
      if (m.kind === 'heights') {
        final = m.heights;
        slices++;
      }
    }
    expect(slices).toBe(3);
    expect(Array.from(final!)).toEqual(Array.from(a.grid.heights));
    let moved = 0;
    for (let k = 0; k < before.length; k++) moved += Math.abs(before[k] - a.grid.heights[k]);
    expect(moved).toBeGreaterThan(1);
  });

  it('stops when told to, on the page as in a worker', async () => {
    const t = terrain();
    const stop = new AbortController();
    let seen = 0;
    const run = startTerrainJob(
      { kind: 'generate', width: t.width, depth: t.depth, columns: t.grid.columns, rows: t.grid.rows, cellSize: 2, heights: t.grid.heights, options: { preset: 'hills', seed: 1, strength: 0.5 } },
      () => {
        if (++seen === 1) stop.abort();
      },
      stop.signal,
    );
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen).toBe(1);
  });
});
