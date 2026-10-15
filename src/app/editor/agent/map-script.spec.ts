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

  it('turns into the same kit run as a level script', () => {
    const doc = map();
    ok(run(`map.raise({ x: 0, y: 0 }, { radius: 20 }, 3);`, doc));
    const kit = new MapKit(map(), index, { name: 't', seed: 7 });
    kit.raise({ x: 0, y: 0 }, { radius: 20 }, 3);
    expect(contentFingerprint(doc)).toBe(contentFingerprint(kit.doc));
    expect(heightAt(doc.terrain, 0, 0)).toBeCloseTo(3, 1);
  });
});
