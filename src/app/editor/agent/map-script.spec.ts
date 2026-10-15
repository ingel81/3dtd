import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMapDocument } from '../../world/custom-map/map-create';
import type { CustomMapDocument } from '../../world/custom-map/map-document';
import { CatalogIndex, normalizeCatalog } from '../catalog/asset-catalog';
import { EditorDocument } from '../model/editor-document';
import { heightAt } from '../model/grid';
import { contentFingerprint } from './agent-reads';
import { checkCommand, runMapScript, scriptReference, SCRIPT_OPS, type ScriptRunResult } from './map-script';
import { MapKit } from '../ops/map-kit';
import { playCommands, playSteps } from './script-playback';

const catalog = normalizeCatalog(JSON.parse(readFileSync(resolve('public/maps/assets/catalog.json'), 'utf8')), 'http://x/maps/assets/');
const index = new CatalogIndex(catalog);

function map(): CustomMapDocument {
  return createMapDocument({ id: 'm', name: 'M', width: 256, depth: 256, cellSize: 2, baseMaterial: 'grass', splatResolution: 256, starter: false, now: new Date(0) });
}

function run(source: string, doc = map()): ScriptRunResult {
  return runMapScript(source, doc, catalog, { seed: 7 });
}

function ok(result: ScriptRunResult): Extract<ScriptRunResult, { ok: true }> {
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe('map scripts', () => {
  it('keeps every command as plain data and reads the map as the script left it', () => {
    const r = ok(
      run(`
        map.raise({ x: 0, y: 0 }, { radius: 20 }, 4);
        const top = map.h(0, 0);
        map.level([{ x: -40, y: -40 }, { x: 40, y: -40 }], { radius: 12 }, top);
        map.spawn('North', 0, 110);
        map.hq(0, -100);
        log('top', Math.round(top));
        return { top: Math.round(top), objects: map.objects().length };
      `),
    );
    expect(r.commands.map((c) => c.op)).toEqual(['raise', 'level', 'spawn', 'hq']);
    expect(r.logs).toEqual(['top 4']);
    expect(r.value).toEqual({ top: 4, objects: 0 });
    expect(r.commands[1].args[2]).toBeCloseTo(4, 0);
  });

  it('gives a map that the kit makes again from the kept commands, step by step', async () => {
    const r = ok(
      run(`
        map.generate('hills', 3, 0.5);
        map.road([{ x: -120, y: 0 }, { x: 0, y: 20 }, { x: 120, y: 0 }], { width: 8 });
        map.spawn('West', -120, 0);
        map.hq(120, 0);
        map.paint('dirt', [{ x: -60, y: -60 }, { x: 60, y: -60 }], { radius: 10 });
        map.biome('forest', [{ x: -80, y: 80 }, { x: 80, y: 80 }], { radius: 30 });
        map.scatter(['rock-small'], { x: 0, y: -100 }, { radius: 20 });
      `),
    );
    const editor = new EditorDocument(map());
    const before = editor.historySteps;
    const changes: unknown[] = [];
    editor.onChange((c) => changes.push(c));
    const played = await playCommands(editor, index, r.commands, 7, { wait: async () => undefined });
    expect(played.fingerprint).toBe(r.fingerprint);
    // The paint stroke went in runs of dabs, each telling the view
    expect(played.steps).toBeGreaterThan(r.commands.length);
    expect(changes.length).toBeGreaterThanOrEqual(played.steps);
    // The play itself keeps no step in the editor's history; the session makes the one step
    expect(editor.historySteps).toBe(before);
  });

  it('splits only strokes that change the ground dab by dab', () => {
    const steps = playSteps([
      { op: 'raise', args: [[{ x: 0, y: 0 }, { x: 100, y: 0 }], { radius: 6 }, 1] },
      { op: 'biome', args: ['forest', [{ x: 0, y: 0 }, { x: 100, y: 0 }], { radius: 6 }] },
    ]);
    expect(steps.filter((s) => s.command.op === 'raise').length).toBeGreaterThan(1);
    expect(steps.filter((s) => s.command.op === 'biome').length).toBe(1);
  });

  it('refuses what is not plain data or not a command, naming the line, and keeps nothing', () => {
    const fn = run(`map.raise({ x: 0, y: 0 }, { radius: 5 }, 1);\nmap.row('fence-wood', [{ x: 0, y: 0 }, { x: 9, y: 0 }], 3, { zFrom: () => 1 });`);
    expect(fn.ok).toBe(false);
    expect(!fn.ok && fn.error).toMatch(/plain data.*function.*line 2.*1 commands ran/);
    expect(run('map.teleport(1)')).toMatchObject({ ok: false, error: expect.stringMatching(/map\.teleport is not a function/) });
    expect(run(`map.biome('jungle', { x: 0, y: 0 }, { radius: 5 })`)).toMatchObject({ ok: false, error: expect.stringMatching(/one of meadow/) });
    expect(run(`map.place('no-such-asset', 0, 0)`)).toMatchObject({ ok: false, error: expect.stringMatching(/no asset no-such-asset/) });
    expect(run(`map.environment({ sky: 'purple' })`)).toMatchObject({ ok: false, error: expect.stringMatching(/sky must be one of/) });
    expect(run(`map.environment({ planet: { azimuth: 10, size: 4 } })`)).toMatchObject({ ok: false, error: expect.stringMatching(/planet must be \{ azimuth/) });
    expect(run(`throw new Error('mine')`)).toMatchObject({ ok: false, error: expect.stringMatching(/^mine \(line 1\)/) });
    expect(() => checkCommand('raise', [{ x: 0, y: 0 }, { radius: 1 }, NaN])).toThrow(/finite/);
    expect(() => checkCommand('raise', [[{ x: 0, y: 0 }, { x: 9000, y: 0 }], { radius: 0.5 }, 1])).toThrow(/dabs/);
  });

  it('hides what reaches past the map behind undefined names', () => {
    const r = ok(run(`return [typeof fetch, typeof importScripts, typeof XMLHttpRequest, typeof WebSocket, typeof globalThis, typeof self, typeof process, typeof setTimeout];`));
    expect(r.value).toEqual(Array(8).fill('undefined'));
  });

  it('cannot change the map past the commands through what a read or a command returned', () => {
    const doc = map();
    const r = ok(run(`const o = map.place('rock-small', 10, 10); o.x = 999; map.objects()[0].y = 999; map.markers().hq.x = 50;`, doc));
    expect(doc.objects[0].x).toBe(10);
    expect(doc.objects[0].y).not.toBe(999);
    expect(doc.hq.x).not.toBe(50);
    expect(r.commands).toHaveLength(1);
  });

  it('removes spawns and objects as the editor does, and gives a new spawn a free id', () => {
    const doc = map();
    const r = ok(run(`map.spawn('A', 0, 0); map.spawn('B', 10, 0); map.removeSpawn('s1'); map.spawn('C', 20, 0); const o = map.place('rock-small', 5, 5); map.removeObjects([o.id]);`, doc));
    expect(doc.spawns.map((s) => s.id)).toEqual(['s2', 's3']);
    expect(doc.objects).toEqual([]);
    expect(r.commands).toHaveLength(6);
  });

  it('makes water with map.water and reads it with map.waterBodies, no read hiding a command', () => {
    const doc = map();
    const r = ok(run(`const main = map.water(1, 'ice'); return { main, read: map.waterBodies() };`, doc));
    expect(r.value).toMatchObject({ main: -1, read: { main: { level: 1, kind: 'ice' } } });
    expect(r.commands.map((c) => c.op)).toEqual(['water']);
    expect(doc.terrain.water).toMatchObject({ level: 1, kind: 'ice' });
  });

  it('removes roads by edge id and refuses ids that are not there, pointing roads to removeRoads', () => {
    const doc = map();
    ok(run(`map.road([{ x: -100, y: 0 }, { x: 100, y: 0 }]);`, doc));
    const edge = doc.paths.edges[0].id;
    expect(run(`map.removeObjects(['${edge}'])`, structuredClone(doc))).toMatchObject({ ok: false, error: expect.stringMatching(new RegExp(`no objects ${edge}.*is a road.*map\\.removeRoads`)) });
    expect(run(`map.removeObjects(['o99'])`, structuredClone(doc))).toMatchObject({ ok: false, error: expect.stringMatching(/no objects o99/) });
    expect(run(`map.removeRoads(['e99'])`, structuredClone(doc))).toMatchObject({ ok: false, error: expect.stringMatching(new RegExp(`no roads e99; roads: ${edge}`)) });
    ok(run(`map.removeRoads(['${edge}'])`, doc));
    expect(doc.paths.edges).toEqual([]);
    expect(doc.paths.nodes).toEqual([]);
  });

  it('takes null for a left-out optional argument', () => {
    const doc = map();
    ok(run(`map.road([{ x: -100, y: 0 }, { x: 100, y: 0 }]); map.flattenRoads(null, 4, 3);`, doc));
    expect(() => checkCommand('raise', [{ x: 0, y: 0 }, { radius: 1 }, null])).toThrow(/metres must be a number/);
  });

  it('names close catalogue ids for an unknown material or asset', () => {
    expect(run(`map.paint('rock', { x: 0, y: 0 }, { radius: 5 })`)).toMatchObject({ ok: false, error: expect.stringMatching(/no material rock; close: [a-z-]*rock/) });
    expect(run(`map.place('fir', 0, 0)`)).toMatchObject({ ok: false, error: expect.stringMatching(/no asset fir; close: .*tree-fir/) });
    const empty = runMapScript(`map.place('tree-fir', 0, 0)`, map(), { materials: [], objects: [] }, { seed: 1 });
    expect(empty).toMatchObject({ ok: false, error: expect.stringMatching(/asset catalogue did not load/) });
  });

  it('says which ground layers fill the map when one more does not fit', () => {
    const materials = catalog.materials.map((m) => m.id).slice(0, 20);
    const r = run(`for (const m of ${JSON.stringify(materials)}) map.layer(m);`);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/ground layers full \(at most \d+: grass, .*\), .* left out; map\.trimLayers/) });
  });

  it('sets the ground from a grid of heights in one command, faded at its edge', async () => {
    const doc = map();
    // 5 x 5 samples 20 m apart from (-40, -40): a cone of 20 m in the middle
    const rows = Array.from({ length: 5 }, (_, j) => Array.from({ length: 5 }, (_, i) => Math.max(0, 20 - 10 * Math.hypot(i - 2, j - 2))));
    const r = ok(run(`map.heightGrid({ x: -40, y: -40 }, 20, ${JSON.stringify(rows)}, { edge: 10 });`, doc));
    expect(r.commands).toHaveLength(1);
    expect(heightAt(doc.terrain, 0, 0)).toBeCloseTo(20, 1);
    expect(heightAt(doc.terrain, 10, 0)).toBeCloseTo(15, 1);
    // Outside the grid untouched, at its edge faded to the ground
    expect(heightAt(doc.terrain, 100, 100)).toBe(heightAt(map().terrain, 100, 100));
    expect(heightAt(doc.terrain, -40, 0)).toBeCloseTo(heightAt(map().terrain, -40, 0), 5);
    expect(run(`map.heightGrid({ x: 0, y: 0 }, 10, [[1, 2], [3]])`)).toMatchObject({ ok: false, error: expect.stringMatching(/rows must be 2 to 257 rows/) });
    // Played back by the kit, the same map
    const played = await playCommands(new EditorDocument(map()), index, r.commands, 7, { wait: async () => undefined });
    expect(played.fingerprint).toBe(r.fingerprint);
  });

  it('documents every command in the reference', () => {
    const text = scriptReference();
    for (const op of Object.keys(SCRIPT_OPS)) expect(text).toContain(`map.${op}(`);
    expect(text).toContain('map.waterBodies()');
    expect(text).toMatch(/biome: temperate\|hell\|moon/);
    expect(text).toMatch(/waves is \{ kind: 'budget' \}/);
  });

  it('levels the ground under a house a script places on a slope, not under a tree', () => {
    const kit = new MapKit(map(), index, { name: 't', seed: 7 });
    const g = kit.doc.terrain.grid;
    for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.columns; i++) g.heights[j * g.columns + i] = (i * g.cellSize - 128) * 0.25;
    kit.place('tree-oak', -60, 0);
    expect(heightAt(kit.doc.terrain, -60 + 3, 0)).toBeCloseTo(-14.25, 3);
    kit.place('house', 40, 20);
    const r = index.object('house').radius;
    expect(heightAt(kit.doc.terrain, 40 + r, 20)).toBeCloseTo(heightAt(kit.doc.terrain, 40 - r, 20), 3);
    expect(heightAt(kit.doc.terrain, 40, 20 + r)).toBeCloseTo(heightAt(kit.doc.terrain, 40 - r, 20), 3);
    // The slope beyond the blend as it was
    expect(heightAt(kit.doc.terrain, 40 + 4 * r + 12, 20)).toBeCloseTo((40 + 4 * r + 12) * 0.25, 3);
  });

  it('levels the ground under a radar dish on a slope, so its turning head sweeps clear of the hill behind', () => {
    const kit = new MapKit(map(), index, { name: 't', seed: 7 });
    const g = kit.doc.terrain.grid;
    for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.columns; i++) g.heights[j * g.columns + i] = (i * g.cellSize - 128) * 0.5;
    kit.place('antenna-dish', 40, 20);
    // The head's rim reaches about 3.7 m out: the ground there stands no higher than under the dish
    expect(heightAt(kit.doc.terrain, 44, 20)).toBeCloseTo(heightAt(kit.doc.terrain, 36, 20), 3);
  });

  it('clears the rocks and trees off the way of a route of movers, leaving what stands beside it', () => {
    const kit = new MapKit(map(), index, { name: 't', seed: 7 });
    const onWay = kit.place('boulder', 0, 2.5);
    const beside = kit.place('boulder', 0, 20);
    const house = kit.place('house', 60, 30);
    kit.lifeRoute('movers', [{ x: -80, y: 0 }, { x: 80, y: 0 }], { asset: 'rover' });
    const ids = kit.doc.objects.map((o) => o.id);
    expect(ids).not.toContain(onWay.id);
    expect(ids).toEqual(expect.arrayContaining([beside.id, house.id]));
  });

  it('levels no ground under a hut on stilts, which stands over its shore as it is', () => {
    const kit = new MapKit(map(), index, { name: 't', seed: 7 });
    const g = kit.doc.terrain.grid;
    for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.columns; i++) g.heights[j * g.columns + i] = (i * g.cellSize - 128) * 0.25;
    const before = Float32Array.from(g.heights);
    kit.place('hut-stilts', 0, 20);
    expect(Array.from(g.heights)).toEqual(Array.from(before));
  });

  it("draws life areas and routes, sets the map's own life, reads and removes them, and plays them back as one change", async () => {
    const r = ok(
      run(`
        const flock = map.lifeArea('birds', [{ x: -60, y: -60 }, { x: 60, y: -60 }, { x: 0, y: 60 }], { height: 30, density: 1.5 });
        const stream = map.lifeRoute('sound', [{ x: -100, y: 0 }, { x: 100, y: 10 }], { sound: 'stream', volume: 0.5 });
        map.lifeRoute('fireflies', [{ x: 0, y: -100 }, { x: 0, y: 100 }]);
        map.lifeSettings({ auto: { birds: false }, density: 0.8 });
        map.removeLife([stream]);
        return { flock, life: map.life() };
      `),
    );
    const life = (r.value as { life: CustomMapDocument['life'] }).life!;
    expect((r.value as { flock: string }).flock).toBe('birds-1');
    expect(life.areas!.map((a) => a.id)).toEqual(['birds-1', 'fireflies-1']);
    expect(life.areas![0]).toEqual({ id: 'birds-1', kind: 'birds', shape: 'area', points: [{ x: -60, y: -60 }, { x: 60, y: -60 }, { x: 0, y: 60 }], height: 30, density: 1.5 });
    expect(life.auto).toEqual({ birds: false });
    expect(life.density).toBe(0.8);
    const editor = new EditorDocument(map());
    const changes: { life?: boolean }[] = [];
    editor.onChange((c) => changes.push(c));
    const played = await playCommands(editor, index, r.commands, 7, { wait: async () => undefined });
    expect(played.fingerprint).toBe(r.fingerprint);
    expect(changes.some((c) => c.life)).toBe(true);
    // A wrong option, a kind or too few points say what is wrong
    expect(run(`map.lifeArea('birds', [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 0, y: 9 }], { wings: 3 })`)).toMatchObject({ ok: false, error: expect.stringMatching(/know no wings/) });
    expect(run(`map.lifeArea('dragons', [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 0, y: 9 }])`).ok).toBe(false);
    expect(run(`map.lifeArea('fog', [{ x: 0, y: 0 }, { x: 9, y: 0 }])`)).toMatchObject({ ok: false, error: expect.stringMatching(/needs 3 to 256 points/) });
    expect(run(`map.removeLife(['nope'])`)).toMatchObject({ ok: false, error: expect.stringMatching(/no life areas nope/) });
  });

  it("sets the map's own intro flight, reads it, plays it back and takes it away again (TODO E170)", async () => {
    const r = ok(
      run(`
        map.intro({ kind: 'orbit', seconds: 12, radius: 150, height: 60, angle: 1 });
        return map.introFlight();
      `),
    );
    expect(r.value).toEqual({ kind: 'orbit', seconds: 12, radius: 150, height: 60, angle: 1 });
    const editor = new EditorDocument(map());
    const played = await playCommands(editor, index, r.commands, 7, { wait: async () => undefined });
    expect(played.fingerprint).toBe(r.fingerprint);
    expect(editor.doc.intro).toEqual(r.value);
    expect(ok(run(`map.intro({ kind: 'orbit', seconds: 12, radius: 150, height: 60, angle: 1 }); map.intro(null); return map.introFlight();`)).value).toBeNull();
    expect(run(`map.intro({ kind: 'path', seconds: 12, views: [] })`)).toMatchObject({ ok: false, error: expect.stringMatching(/intro.views must be a list of 1 to 16/) });
  });

  it("makes a spawn's lane optional and always open again, as the Spawns panel's switch", () => {
    const doc = map();
    doc.spawns = [{ id: 's1', name: 'West', x: -100, y: 0 }, { id: 's2', name: 'East', x: 100, y: 0 }];
    const r = ok(run(`map.optionalLane('s2', true); const a = map.markers().spawns; map.optionalLane('s2', false); return [a, map.markers().spawns];`, doc));
    const [on, off] = r.value as { id: string; optional?: boolean }[][];
    expect(on.map((s) => s.optional)).toEqual([undefined, true]);
    expect(off.every((s) => !('optional' in s))).toBe(true);
    expect(run(`map.optionalLane('s9', true)`, doc)).toMatchObject({ ok: false, error: expect.stringMatching(/no spawn s9; spawns: s1, s2/) });
  });

  it('draws the images of a life area under symmetry', () => {
    const kit = new MapKit(map(), index, { name: 't', seed: 7 });
    kit.symmetry = 'rot2';
    expect(kit.lifeRoute('boats', [{ x: 10, y: 20 }, { x: 60, y: 20.25 }])).toBe('boats-1');
    expect(kit.doc.life?.areas?.map((a) => [a.id, a.points])).toEqual([
      ['boats-1', [{ x: 10, y: 20 }, { x: 60, y: 20.25 }]],
      ['boats-2', [{ x: -10, y: -20 }, { x: -60, y: -20.25 }]],
    ]);
  });

  it('turns into the same kit run as a level script', () => {
    const doc = map();
    ok(run(`map.raise({ x: 0, y: 0 }, { radius: 20 }, 3);`, doc));
    const kit = new MapKit(map(), index, { name: 't', seed: 7 });
    kit.raise({ x: 0, y: 0 }, { radius: 20 }, 3);
    expect(contentFingerprint(doc)).toBe(contentFingerprint(kit.doc));
    expect(heightAt(doc.terrain, 0, 0)).toBeCloseTo(3, 1);
  });

  it('keeps a prefab in the map with an id that is the same when played, and places it as one group (TODO E170)', async () => {
    const r = ok(
      run(`
        const a = map.place('house', 40, 40);
        const b = map.place('tree-oak', 50, 40);
        const id = map.savePrefab('Farm', [a.id, b.id], true);
        map.placePrefab(id, { x: -60, y: -60 }, { rotation: 1 });
        map.placePrefab('Farm', { x: 60, y: -60 });
        return { id, kept: map.prefabs() };
      `),
    );
    expect(r.value).toMatchObject({ id: 'pf-1', kept: [{ id: 'pf-1', name: 'Farm', objects: 2, prefab: true }] });
    const editor = new EditorDocument(map());
    await playCommands(editor, index, r.commands, 7, { wait: async () => undefined });
    expect(editor.doc.prefabs?.map((p) => p.id)).toEqual(['pf-1']);
    const groups = editor.doc.objects.map((o) => o.group ?? '-');
    expect(groups).toEqual(['-', '-', 'g1', 'g1', 'g2', 'g2']);
    expect(run(`map.placePrefab('none', { x: 0, y: 0 })`).ok).toBe(false);
  });

  it('has every tool of the editor as a command, and plays them to the map the sandbox saw', async () => {
    const r = ok(
      run(`
        map.generate('valleys', 5, 0.6, false, true);
        map.road([{ x: -120, y: 0 }, { x: 0, y: 30 }, { x: 120, y: 0 }], { width: 8 });
        const [road] = map.roads();
        const node = map.splitRoad(road.id, { x: 0, y: 30 });
        map.moveNode(node, { x: 4, y: 40 });
        const branch = map.connectNodes(node, map.nodes().find((n) => n.id !== node).id, { width: 5, kind: 'path' });
        map.editRoads([branch], { width: 6 });
        map.smoothRoad(road.id, 10);
        map.straightenRoad(branch);
        map.roadSurface([road.id], 'asphalt');
        map.river([{ x: -120, y: -90 }, { x: 0, y: -70 }, { x: 120, y: -100 }], { width: 10 });
        const [river] = map.rivers();
        map.moveRiverPoint(river.id, 1, { x: 0, y: -60 });
        const added = map.addRiverPoint(river.id, 1, 0.5);
        map.removeRiverPoint(river.id, added);
        map.riverWidth(river.id, 12);
        map.simplifyRiver(river.id);
        map.riverKind(river.id, 'lava');
        map.carveRiverBed(river.id);
        map.pour({ x: 60, y: 90 }, 'water');
        const walls = map.line('castle-wall', [{ x: -60, y: 80 }, { x: -20, y: 80 }, { x: -20, y: 110 }]);
        const fence = map.line('rock-small', [{ x: 20, y: 70 }, { x: 60, y: 70 }], { spacing: 6, bothSides: true, offset: 3 });
        const copies = map.duplicate([fence[0].id], { x: 0, y: 5 });
        map.changeObjects(copies.map((o) => o.id), { dx: 2, turn: 0.5, scale: 1.2 });
        map.alignToSlope([fence[1].id]);
        const group = map.group(walls.map((o) => o.id));
        map.ungroup([walls[0].id]);
        map.cliffRocks([{ x: -100, y: -40 }, { x: -60, y: -40 }], { radius: 20 });
        map.spawn('West', -120, 0);
        map.moveSpawn('s1', -118, 2);
        map.renameSpawn('s1', 'Gate');
        map.copyArea({ x0: -40, y0: 60, x1: 0, y1: 100 }, { x: 80, y: -20 }, { rotation: 1, parts: { roads: false } });
        map.mirrorMap('x', { x: -60, y: 0 });
        return { group, walls: walls.length, fence: fence.length, lava: map.rivers()[0].kind, spawns: map.markers().spawns.map((s) => s.name) };
      `),
    );
    expect(r.value).toMatchObject({ group: 'g1', lava: 'lava', spawns: expect.arrayContaining(['Gate']) });
    expect((r.value as { walls: number }).walls).toBeGreaterThan(2);
    const editor = new EditorDocument(map());
    const played = await playCommands(editor, index, r.commands, 7, { wait: async () => undefined });
    expect(played.fingerprint).toBe(r.fingerprint);
  });

  it('stops at an unknown road, node, river, spawn, object or layer and names what there is', () => {
    const cases: [string, RegExp][] = [
      [`map.moveNode('n9', { x: 0, y: 0 })`, /no road node n9; map\.nodes\(\) lists them/],
      [`map.editRoads(['e9'], { width: 4 })`, /no road e9; roads: none/],
      [`map.road([{ x: -50, y: 0 }, { x: 50, y: 0 }]); map.editRoads([map.roads()[0].id], { lanes: 2 })`, /a road knows no lanes/],
      [`map.riverWidth('r9', 8)`, /no river r9; rivers: none/],
      [`map.moveSpawn('s9', 0, 0)`, /no spawn s9/],
      [`map.changeObjects(['o9'], { x: 1 })`, /no objects o9/],
      [`map.place('rock-small', 0, 0); map.changeObjects([map.objects()[0].id], { colour: 'red' })`, /an object knows no colour/],
      [`map.removeLayer('lava-rock')`, /no ground layer is lava-rock; layers: grass/],
      [`map.removeLayer('grass')`, /at least one ground layer/],
      [`map.water(5); map.sea(); map.pour({ x: 0, y: 0 })`, /water at \(0, 0\) already/],
      [`map.copyArea({ x0: 0, y0: 0 }, { x: 0, y: 0 })`, /must be a rectangle/],
    ];
    for (const [source, error] of cases) {
      const result = run(source);
      expect(result.ok, source).toBe(false);
      expect((result as { error: string }).error, source).toMatch(error);
    }
  });

  it('reads road nodes, the ends of each road and the points of rivers', () => {
    const r = ok(
      run(`
        map.road([{ x: -100, y: 0 }, { x: 100, y: 0 }]);
        map.river([{ x: -100, y: -60 }, { x: 100, y: -80 }]);
        return { roads: map.roads(), nodes: map.nodes(), rivers: map.rivers() };
      `),
    );
    const value = r.value as { roads: { a: string; b: string }[]; nodes: { id: string; roads: string[] }[]; rivers: { width: number; points: { height: number }[] }[] };
    expect(value.nodes.map((n) => n.id)).toEqual(expect.arrayContaining([value.roads[0].a, value.roads[0].b]));
    expect(value.nodes[0].roads.length).toBeGreaterThan(0);
    expect(value.rivers[0].width).toBeGreaterThan(0);
    expect(typeof value.rivers[0].points[0].height).toBe('number');
  });
});
