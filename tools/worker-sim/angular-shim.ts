// @angular/core for the worker lab (docs/WORKER_PLAN.md, stage 1): the real module with inject,
// Injectable and effect replaced, as the specs mock them (resimulation.scenario.spec.ts). The
// build aliases '@angular/core' to this file for every importer but this one.
export * from '@angular/core';
import { noopStub } from '../../src/app/integration/noop-stub';

interface Lab {
  services: Record<string, unknown>;
  /** Token names nobody put into `services`: they got a no-op stub */
  stubbed: Set<string>;
  /** While set, new stubs are traced into `calls` (lab.ts, reach) */
  tracing: boolean;
  /** Member path to calls, e.g. engine.effects.spawnMuzzleFlash */
  calls: Map<string, number>;
}

/**
 * `value` behind a proxy that counts every call made through it by member path. Results are not
 * wrapped: what a call returns (a Vector3, a camera) is the caller's.
 */
export function traced<T>(value: T, path: string): T {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
  const { calls } = lab();
  const children = new Map<PropertyKey, unknown>();
  return new Proxy(value as object, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (typeof prop === 'symbol' || prop === 'then') return v;
      if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return v;
      let child = children.get(prop);
      if (!child) children.set(prop, (child = traced(v, `${path}.${String(prop)}`)));
      return child;
    },
    apply(target, thisArg, args) {
      calls.set(path, (calls.get(path) ?? 0) + 1);
      return Reflect.apply(target as (...a: unknown[]) => unknown, thisArg, args);
    },
  }) as T;
}

export function lab(): Lab {
  const g = globalThis as { __workerLab?: Lab };
  return (g.__workerLab ??= { services: {}, stubbed: new Set(), tracing: false, calls: new Map() });
}

export const Injectable = () => (target: unknown) => target;
export const effect = () => undefined;
export function inject(token: { name?: string; _desc?: string }): unknown {
  const name = token?.name ?? token?._desc ?? 'unknown';
  const { services, stubbed, tracing } = lab();
  if (!services[name]) {
    services[name] = tracing ? traced(noopStub(), name) : noopStub();
    stubbed.add(name);
  }
  return services[name];
}
