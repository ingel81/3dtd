// The lab in a module worker: loads it (the import is what breaks first, if anything does) and runs
// what the page asks for.
type Lab = typeof import('./lab');
let lab: Lab | null = null;
let loadError: string | null = null;
const ready = import('./lab').then(
  (m) => { lab = m; },
  (e: Error) => { loadError = `${e?.message}\n${e?.stack ?? ''}`; },
);

self.onmessage = async (ev: MessageEvent<{ id: number; op: string; args: unknown[] }>) => {
  const { id, op, args } = ev.data;
  await ready;
  try {
    if (!lab) throw new Error(`load failed: ${loadError}`);
    const fn = (lab as unknown as Record<string, (...a: unknown[]) => unknown>)[op];
    postMessage({ id, ok: true, value: fn(...args) });
  } catch (e) {
    const err = e as Error;
    postMessage({ id, ok: false, error: `${err?.message}\n${err?.stack ?? ''}` });
  }
};
postMessage({ id: 0, ok: true, value: 'up' });
