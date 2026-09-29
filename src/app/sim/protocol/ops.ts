/**
 * Renderer calls of the simulation (docs/SIM_WORKER.md): the simulation calls
 * its SimSink like it called the ThreeTilesEngine before, e.g.
 * `sink.effects.spawnFloatingText('+5', lat, lon, h, opts)`. The recorder
 * turns every call into an op `['effects.spawnFloatingText', '+5', lat, ...]`;
 * the main thread's OpPlayer (presentation/) calls the engine member at the
 * same path with the same arguments.
 *
 * Rules for the simulation side:
 *  - Fire and forget: a sink call returns undefined. Nothing may be read back.
 *  - Arguments are plain data: numbers, strings, booleans, null, arrays and
 *    plain objects of those. A vector goes as `{ x, y, z }`; the player makes
 *    a THREE.Vector3 of every plain object with exactly the keys x, y, z.
 *  - No entities, no functions, no three.js objects.
 */
export type PlainValue =
  | number
  | string
  | boolean
  | null
  | undefined
  | readonly PlainValue[]
  | { readonly [key: string]: PlainValue };

/** [engine member path, ...arguments] */
export type PresentationOp = readonly [string, ...PlainValue[]];

/** Any path, any plain arguments; the typed view of it is SimSink (sim/core). */
export type OpRecorderNode = ((...args: PlainValue[]) => void) & { readonly [member: string]: OpRecorderNode };

/**
 * A sink that records every call into `ops`. Members are created on first
 * access and cached, so a hot path pays one Map lookup per level.
 */
export function createOpRecorder(ops: PresentationOp[]): OpRecorderNode {
  const node = (path: string): OpRecorderNode => {
    const children = new Map<string, OpRecorderNode>();
    const call = (...args: PlainValue[]) => {
      ops.push([path, ...args]);
    };
    return new Proxy(call, {
      get(target, prop) {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        let child = children.get(prop);
        if (!child) {
          child = node(path ? `${path}.${prop}` : prop);
          children.set(prop, child);
        }
        return child;
      },
      apply(_target, _this, args: PlainValue[]) {
        ops.push([path, ...args]);
      },
    }) as unknown as OpRecorderNode;
  };
  return node('');
}
