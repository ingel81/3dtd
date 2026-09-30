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
  readonly posted: unknown[] = [];
  postMessage(message: unknown): void {
    this.posted.push(message);
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

  it('sends what one task gave as one message, in order, so the loop runs no pass in between', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const transport = new WorkerTransport({ frame: vi.fn(), output: vi.fn(), error: vi.fn() });
    const worker = FakeWorker.last!;

    // Rejected when the worker goes below
    transport.rpc('reset', [7]).catch(() => undefined);
    transport.configure({ lockstep: {} });
    transport.epoch(3);
    expect(worker.posted).toEqual([]);
    await Promise.resolve();
    expect(worker.posted).toEqual([{
      kind: 'batch',
      messages: [
        { kind: 'rpc', id: 1, method: 'reset', args: [7] },
        { kind: 'configure', config: { lockstep: {} } },
        { kind: 'epoch', epoch: 3 },
      ],
    }]);

    // One message alone goes as it is
    transport.unloadWorld();
    await Promise.resolve();
    expect(worker.posted[1]).toEqual({ kind: 'unload' });

    // Nothing goes to a worker that is gone
    transport.unloadWorld();
    transport.dispose();
    await Promise.resolve();
    expect(worker.posted).toHaveLength(2);
  });
});
