/**
 * A no-op stand-in for services and the engine in the sub-step benchmark
 * (sim-step-bench.ts). Its own module without imports, so the spec's
 * vi.mock('@angular/core') factory can load it.
 */

/**
 * An object on which every property is another such stub and every call does
 * nothing and returns undefined, except the members in `overrides`. Not a
 * thenable, so a returned stub is never awaited by accident. With `chain`,
 * a call returns another chaining stub instead, for objects whose results are
 * used further (a Web Audio context: createGain().connect(...)).
 */
export function noopStub(overrides: Record<string, unknown> = {}, chain = false): never {
  const children = new Map<PropertyKey, unknown>();
  const target = function noop(): void { /* stub */ };
  return new Proxy(target, {
    get(_target, prop) {
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      if (Object.hasOwn(overrides, prop)) return overrides[prop];
      let child = children.get(prop);
      if (!child) {
        child = noopStub({}, chain);
        children.set(prop, child);
      }
      return child;
    },
    set(_target, prop, value) {
      overrides[prop as string] = value;
      return true;
    },
    apply: () => (chain ? noopStub({}, true) : undefined),
  }) as never;
}
