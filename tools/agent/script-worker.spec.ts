// @vitest-environment node
/**
 * The built script sandbox (public/agent/script-worker.js), bundled afresh
 * and run in a realm of its own that stands in for the worker's scope:
 * it takes away network, script loading and storage before any script runs,
 * also from what a script digs out of the language, and answers with the
 * kept commands.
 */
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { createMapDocument } from '../../src/app/world/custom-map/map-create';
import { normalizeCatalog } from '../../src/app/editor/catalog/asset-catalog';
import type { ScriptRunResult } from '../../src/app/editor/agent/map-script';
import { buildScriptWorker } from './build-script-worker.mjs';

const catalog = normalizeCatalog(JSON.parse(readFileSync(resolve('public/maps/assets/catalog.json'), 'utf8')), 'http://x/maps/assets/');

let bundle = '';
beforeAll(async () => {
  bundle = readFileSync(await buildScriptWorker(join(tmpdir(), `3dtd-script-worker-${process.pid}.js`)), 'utf8');
}, 60_000);

/** A fresh worker-like realm with the bundle loaded; what it posts lands in `posted` */
function worker() {
  const posted: ScriptRunResult[] = [];
  const reached: string[] = [];
  const scope: Record<string, unknown> = {
    postMessage: (m: ScriptRunResult) => posted.push(m),
    structuredClone,
    performance,
    fetch: () => reached.push('fetch'),
    XMLHttpRequest: function () {
      reached.push('xhr');
    },
    WebSocket: function () {
      reached.push('ws');
    },
    EventSource: function () {},
    importScripts: () => reached.push('importScripts'),
    indexedDB: {},
    caches: {},
    BroadcastChannel: function () {},
    setTimeout,
  };
  scope['self'] = scope;
  const context = createContext(scope);
  runInContext(bundle, context);
  const send = (source: string) => {
    (scope['onmessage'] as (e: { data: unknown }) => void)({
      data: { source, doc: createMapDocument({ id: 'm', name: 'M', width: 128, depth: 128, starter: false, now: new Date(0) }), catalog, seed: 3 },
    });
    return posted[posted.length - 1];
  };
  return { scope, send, reached, posted };
}

describe('the built script sandbox', () => {
  it('takes away network, script loading and storage before a script runs', () => {
    const { scope } = worker();
    for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'setTimeout', 'postMessage']) {
      expect(scope[name], name).toBeUndefined();
    }
  });

  it('keeps them away from what a script digs out of the language', () => {
    const { send, reached } = worker();
    const r = send(`
      const G = ({}).constructor.constructor('return this')();
      const found = ['fetch', 'importScripts', 'XMLHttpRequest', 'WebSocket', 'postMessage'].filter((n) => G[n] !== undefined);
      try { G.fetch('http://example.com'); } catch {}
      return found;
    `);
    expect(r).toMatchObject({ ok: true, value: [] });
    expect(reached).toEqual([]);
  });

  it('answers with the kept commands, once per worker', () => {
    const { send, posted } = worker();
    const r = send(`map.raise({ x: 0, y: 0 }, { radius: 10 }, 2); map.hq(10, 10); return map.h(0, 0) > 1;`);
    expect(r).toMatchObject({ ok: true, value: true });
    expect(r.ok && r.commands.map((c) => c.op)).toEqual(['raise', 'hq']);
    send('return 1');
    expect(posted).toHaveLength(1);
  });
});
