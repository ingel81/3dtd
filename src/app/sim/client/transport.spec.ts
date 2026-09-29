/**
 * WorkerTransport over a stand-in Worker: a message the main thread cannot
 * read (messageerror) stops the simulation like a worker error, instead of
 * leaving the tick in flight for good.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { WorkerTransport } from './transport';

class FakeWorker {
  static last: FakeWorker | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  onmessageerror: ((ev: MessageEvent) => void) | null = null;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(): void {
    /* taken */
  }
  terminate(): void {
    /* gone */
  }
}

describe('WorkerTransport', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports a message it cannot read as an error', () => {
    vi.stubGlobal('Worker', FakeWorker);
    const error = vi.fn();
    new WorkerTransport({ frame: vi.fn(), output: vi.fn(), error });

    FakeWorker.last!.onmessageerror?.(new MessageEvent('messageerror'));

    expect(error).toHaveBeenCalledWith('worker: a message from the simulation could not be read');
  });
});
