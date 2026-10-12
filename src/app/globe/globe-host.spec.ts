import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGlobeHost, GLOBE_WORKER_GRACE_MS } from './globe-host';

/** A worker that records what it is told and whether it was terminated */
class StandInWorker {
  static made: StandInWorker[] = [];
  readonly posted: unknown[] = [];
  terminated = false;
  constructor() {
    StandInWorker.made.push(this);
  }
  addEventListener(): void {
    /* no events in this test */
  }
  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
}

describe('createGlobeHost in a worker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    StandInWorker.made = [];
    vi.stubGlobal('Worker', StandInWorker);
    vi.stubGlobal('OffscreenCanvas', class {
      getContext(): object {
        return {};
      }
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', {
      configurable: true,
      value: () => ({}),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (HTMLCanvasElement.prototype as unknown as Record<string, unknown>)['transferControlToOffscreen'];
  });

  const init = {
    quality: 'high' as const,
    width: 100,
    height: 100,
    pixelRatio: 1,
    baseUrl: 'http://localhost/',
    shot: { over: { lat: 0, lon: 0 }, altitude: 1e7, aim: 0, shift: 0, roll: 0 },
  };

  it('asks the worker to close and terminates it should it stay', () => {
    const host = createGlobeHost(document.createElement('canvas'), init, () => undefined);
    expect(host.offThread).toBe(true);
    const worker = StandInWorker.made[0];

    host.dispose();
    expect(worker.posted.at(-1)).toEqual({ type: 'dispose' });
    expect(worker.terminated).toBe(false);

    vi.advanceTimersByTime(GLOBE_WORKER_GRACE_MS);
    expect(worker.terminated).toBe(true);
  });

  it('sends nothing after dispose, and a second dispose does nothing', () => {
    const host = createGlobeHost(document.createElement('canvas'), init, () => undefined);
    const worker = StandInWorker.made[0];
    host.dispose();
    const count = worker.posted.length;
    host.send({ type: 'idle', on: true });
    host.dispose();
    expect(worker.posted.length).toBe(count);
  });
});
