import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Importing the worker module runs its top-level addEventListener('message', …),
// registering the protocol handler on the jsdom global. We then drive it by
// dispatching MessageEvents and capture the worker→main replies via a mocked
// postMessage.
import './pathfinding.worker';
import type {
  SerializedStreetNetwork,
  InitMessage,
  FindPathMessage,
  ClearGraphMessage,
  WorkerOutMessage,
} from './pathfinding.worker';

// Local mirrors of the worker-internal (non-exported) node/street shapes.
interface TStreetNode { id: number; lat: number; lon: number; }
interface TStreet { id: number; name: string; type: string; nodes: TStreetNode[]; }

/** A single straight street running north along lon 9.0, `count` nodes 1 m apart. */
function makeStraightNetwork(count: number, type = 'residential'): SerializedStreetNetwork {
  const nodes: TStreetNode[] = [];
  for (let i = 0; i < count; i++) {
    nodes.push({ id: i + 1, lat: 48.0 + i * 0.001, lon: 9.0 });
  }
  const street: TStreet = { id: 100, name: 'Test St', type, nodes };
  return {
    streets: [street as never],
    nodes: nodes.map((n) => [n.id, n as never]),
    bounds: { minLat: 48.0, maxLat: 48.0 + (count - 1) * 0.001, minLon: 9.0, maxLon: 9.0 },
  };
}

/** Two disjoint streets with no shared nodes — no path can connect them. */
function makeDisjointNetwork(): SerializedStreetNetwork {
  const a: TStreetNode[] = [
    { id: 1, lat: 48.0, lon: 9.0 },
    { id: 2, lat: 48.001, lon: 9.0 },
    { id: 3, lat: 48.002, lon: 9.0 },
  ];
  const b: TStreetNode[] = [
    { id: 10, lat: 49.0, lon: 10.0 },
    { id: 11, lat: 49.001, lon: 10.0 },
    { id: 12, lat: 49.002, lon: 10.0 },
  ];
  return {
    streets: [
      { id: 100, name: 'A', type: 'residential', nodes: a } as never,
      { id: 200, name: 'B', type: 'residential', nodes: b } as never,
    ],
    nodes: [...a, ...b].map((n) => [n.id, n as never]),
    bounds: { minLat: 48.0, maxLat: 49.002, minLon: 9.0, maxLon: 10.0 },
  };
}

describe('pathfinding.worker (message protocol)', () => {
  let posted: WorkerOutMessage[];

  function send(msg: InitMessage | FindPathMessage | ClearGraphMessage): void {
    dispatchEvent(new MessageEvent('message', { data: msg }));
  }
  const last = () => posted[posted.length - 1];

  beforeEach(() => {
    posted = [];
    vi.stubGlobal('postMessage', (m: WorkerOutMessage) => { posted.push(m); });
    // Reset the worker's module-global graph state between tests.
    send({ type: 'clearGraph' });
    posted = [];
  });

  afterEach(() => {
    send({ type: 'clearGraph' });
    vi.unstubAllGlobals();
  });

  // ────────────────────────────────────────────────────────────────
  // init
  // ────────────────────────────────────────────────────────────────
  describe('init', () => {
    it('replies with initDone after building the graph', () => {
      send({ type: 'init', network: makeStraightNetwork(4) });
      expect(last()).toEqual({ type: 'initDone' });
    });

    it('replies with an error when the network payload is malformed', () => {
      // streets undefined → buildGraph's for-of throws → caught → error reply.
      send({ type: 'init', network: { nodes: [], bounds: {} } as never });
      expect(last().type).toBe('error');
      expect((last() as { message: string }).message).toContain('Init failed');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // findPath
  // ────────────────────────────────────────────────────────────────
  describe('findPath', () => {
    it('returns an empty path when no network was initialized', () => {
      send({ type: 'findPath', id: 'p1', startLat: 48.0, startLon: 9.0, endLat: 48.003, endLon: 9.0 });
      expect(last()).toEqual({ type: 'pathResult', id: 'p1', path: [] });
    });

    it('echoes the request id back on the result', () => {
      send({ type: 'init', network: makeStraightNetwork(4) });
      send({ type: 'findPath', id: 'req-42', startLat: 48.0005, startLon: 9.0, endLat: 48.0025, endLon: 9.0 });
      expect(last().type).toBe('pathResult');
      expect((last() as { id: string }).id).toBe('req-42');
    });

    it('finds the node sequence along a straight street', () => {
      send({ type: 'init', network: makeStraightNetwork(6) });
      // start mid-segment 0 (n1–n2), end mid-segment 3 (n4–n5) → A* node1→node4.
      send({ type: 'findPath', id: 'p', startLat: 48.0005, startLon: 9.0, endLat: 48.0035, endLon: 9.0 });
      const result = last() as { type: string; path: TStreetNode[] };
      expect(result.type).toBe('pathResult');
      expect(result.path.map((n) => n.id)).toEqual([1, 2, 3, 4]);
    });

    it('returns full node objects (id + lat + lon)', () => {
      send({ type: 'init', network: makeStraightNetwork(4) });
      send({ type: 'findPath', id: 'p', startLat: 48.0005, startLon: 9.0, endLat: 48.0015, endLon: 9.0 });
      const result = last() as { path: TStreetNode[] };
      expect(result.path[0]).toMatchObject({ id: 1, lat: 48.0, lon: 9.0 });
    });

    it('returns an empty path between two disconnected street components', () => {
      send({ type: 'init', network: makeDisjointNetwork() });
      // start near street A, end near street B — no graph edge bridges them.
      send({ type: 'findPath', id: 'p', startLat: 48.0005, startLon: 9.0, endLat: 49.0015, endLon: 10.0 });
      const result = last() as { type: string; path: TStreetNode[] };
      expect(result.type).toBe('pathResult');
      expect(result.path).toEqual([]);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // clearGraph
  // ────────────────────────────────────────────────────────────────
  describe('clearGraph', () => {
    it('drops the graph so subsequent findPath calls return empty', () => {
      send({ type: 'init', network: makeStraightNetwork(6) });
      send({ type: 'findPath', id: 'before', startLat: 48.0005, startLon: 9.0, endLat: 48.0035, endLon: 9.0 });
      expect((last() as { path: TStreetNode[] }).path.length).toBeGreaterThan(0);

      send({ type: 'clearGraph' });

      send({ type: 'findPath', id: 'after', startLat: 48.0005, startLon: 9.0, endLat: 48.0035, endLon: 9.0 });
      expect(last()).toEqual({ type: 'pathResult', id: 'after', path: [] });
    });
  });
});
