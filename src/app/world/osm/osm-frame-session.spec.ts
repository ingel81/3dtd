import { OsmFrameSession } from './osm-frame-session';
import type { OsmWorkerRequest, OsmWorkerResponse } from './osm-worker.types';
import type { OverpassRetry } from './overpass-client';

/**
 * The frame's line to the OSM worker, on a fake worker: the retries of the
 * Overpass servers reach the call, and a worker that keeps saying something
 * (a step, a retry) is not taken for one that hangs.
 */
describe('OsmFrameSession', () => {
  class FakeWorker {
    onmessage: ((event: MessageEvent<OsmWorkerResponse>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    readonly sent: OsmWorkerRequest[] = [];
    terminated = false;
    postMessage(request: OsmWorkerRequest): void {
      this.sent.push(request);
    }
    terminate(): void {
      this.terminated = true;
    }
    say(response: OsmWorkerResponse): void {
      this.onmessage?.({ data: response } as MessageEvent<OsmWorkerResponse>);
    }
  }

  afterEach(() => vi.useRealTimers());

  it('hands the retries of the servers to the call and gives a worker that says something its time anew', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const session = new OsmFrameSession({ timeoutMs: 1000, createWorker: () => worker as unknown as Worker });
    const retries: OverpassRetry[] = [];
    const opening = session.open({ place: { lat: 49.7, lon: 9.26 }, count: 4 }, undefined, undefined, (r) => retries.push(r));
    const ended = expect(opening).rejects.toThrow('No answer within 1 s');
    const id = worker.sent[0].id;

    vi.advanceTimersByTime(800);
    worker.say({ id, kind: 'retry', retry: { attempt: 2, of: 4, waitMs: 3000, kind: 'busy' } });
    vi.advanceTimersByTime(800);
    worker.say({ id, kind: 'progress', progress: { step: 'overpass', detail: '1.2 MB received' } });
    vi.advanceTimersByTime(999);
    expect(worker.terminated).toBe(false);
    expect(retries).toEqual([{ attempt: 2, of: 4, waitMs: 3000, kind: 'busy' }]);

    // Silent for the whole time: ended
    vi.advanceTimersByTime(1);
    await ended;
    expect(worker.terminated).toBe(true);
  });
});
