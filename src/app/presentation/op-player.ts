import { Vector3 } from 'three';
import type { PlainValue, PresentationOp } from '../sim/protocol/ops';

/** A member call resolved once: the object at the path's parent and its function */
interface ResolvedCall {
  readonly target: object;
  readonly fn: (...args: unknown[]) => unknown;
}

/**
 * What the main thread puts in place of an op: gets the revived arguments
 * and `call`, which calls the engine member at the op's path with whatever
 * arguments it is given.
 */
export type OpOverride = (args: unknown[], call: (...args: unknown[]) => unknown) => void;

/**
 * Plays the simulation's renderer calls (sim/protocol/ops.ts) on the main
 * thread: each op `[path, ...args]` calls the member of `root` (the
 * ThreeTilesEngine) at `path` with the arguments, a plain `{x, y, z}`
 * revived into a THREE.Vector3 (in arrays and objects too). The function of
 * a path is resolved once and kept.
 *
 * Overrides stand in for a path where the main thread supplies what the
 * simulation cannot send: the shadow tower's live aim, the grid's ground, a
 * sound that needs a loop handle. An unknown path is reported once and
 * skipped; a failing call is reported and the next op plays on.
 */
export class OpPlayer {
  private readonly calls = new Map<string, ResolvedCall>();
  private readonly overrides = new Map<string, OpOverride>();
  private readonly reported = new Set<string>();

  constructor(private readonly root: object) {}

  /** `path`'s ops go to `override` instead of the engine. One override per path. */
  override(path: string, override: OpOverride): void {
    this.overrides.set(path, override);
  }

  play(ops: readonly PresentationOp[]): void {
    for (const op of ops) this.playOne(op);
  }

  playOne(op: PresentationOp): void {
    const path = op[0];
    const args: unknown[] = new Array(op.length - 1);
    for (let i = 1; i < op.length; i++) args[i - 1] = revive(op[i]);
    try {
      const override = this.overrides.get(path);
      if (override !== undefined) {
        override(args, (...callArgs) => this.call(path, callArgs));
        return;
      }
      this.call(path, args);
    } catch (err) {
      console.error(`[OpPlayer] ${path} failed:`, err);
    }
  }

  /** Call the engine member at `path`; undefined when there is none. A promise it returns is caught. */
  private call(path: string, args: unknown[]): unknown {
    const resolved = this.resolve(path);
    if (resolved === null) return undefined;
    const result = resolved.fn.apply(resolved.target, args);
    if (result instanceof Promise) {
      result.catch((err: unknown) => console.warn(`[OpPlayer] ${path} rejected:`, err));
    }
    return result;
  }

  private resolve(path: string): ResolvedCall | null {
    const cached = this.calls.get(path);
    if (cached !== undefined) return cached;
    const parts = path.split('.');
    let target: unknown = this.root;
    for (let i = 0; i < parts.length - 1; i++) {
      target = target !== null && typeof target === 'object' ? (target as Record<string, unknown>)[parts[i]] : undefined;
    }
    const fn =
      target !== null && typeof target === 'object'
        ? (target as Record<string, unknown>)[parts[parts.length - 1]]
        : undefined;
    if (typeof fn !== 'function') {
      // Not kept: a member that comes later (an optional renderer) is found then
      if (!this.reported.has(path)) {
        this.reported.add(path);
        console.error(`[OpPlayer] no engine member at '${path}'`);
      }
      return null;
    }
    const resolved: ResolvedCall = { target: target as object, fn: fn as (...args: unknown[]) => unknown };
    this.calls.set(path, resolved);
    return resolved;
  }
}

/**
 * `value` with every plain `{x, y, z}` (exactly those keys, numbers) as a
 * THREE.Vector3; arrays and other plain objects are copied only where
 * something inside them was revived.
 */
export function revive(value: PlainValue | unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    let out: unknown[] | null = null;
    for (let i = 0; i < value.length; i++) {
      const v = revive(value[i]);
      if (v !== value[i]) {
        out ??= value.slice();
        out[i] = v;
      }
    }
    return out ?? value;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length === 3 &&
    typeof record['x'] === 'number' &&
    typeof record['y'] === 'number' &&
    typeof record['z'] === 'number'
  ) {
    return new Vector3(record['x'], record['y'], record['z']);
  }
  let out: Record<string, unknown> | null = null;
  for (const key of keys) {
    const v = revive(record[key]);
    if (v !== record[key]) {
      out ??= { ...record };
      out[key] = v;
    }
  }
  return out ?? value;
}
