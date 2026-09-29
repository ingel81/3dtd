/**
 * The worker's entry: a message from the main thread it cannot read
 * (messageerror) goes back as an error, so the main thread stops instead of
 * waiting for a frame that never comes.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../core/sim-core', () => ({ SimCore: class SimCore {} }));

describe('sim.worker', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('answers a message it cannot read with an error', async () => {
    const listeners = new Map<string, (ev: unknown) => void>();
    const posted = vi.fn();
    vi.stubGlobal('addEventListener', (type: string, listener: (ev: unknown) => void) => listeners.set(type, listener));
    vi.stubGlobal('postMessage', posted);
    await import('./sim.worker');
    expect(posted).toHaveBeenCalledWith({ kind: 'ready' }, []);

    listeners.get('messageerror')?.({});

    expect(posted).toHaveBeenLastCalledWith(
      { kind: 'error', error: 'simulation worker: a message from the main thread could not be read' },
      [],
    );
  });
});
