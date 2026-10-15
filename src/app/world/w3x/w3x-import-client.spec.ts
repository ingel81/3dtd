import { buildSyntheticMap } from '../../../test/w3x-synthetic-map';
import { importW3xInWorker } from './w3x-import-client';
import { documentTransferables } from './w3x-worker.types';

describe('importW3xInWorker', () => {
  it('imports on the calling thread where there are no workers, keeping the caller buffer', async () => {
    const bytes = buildSyntheticMap();
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const { doc, report } = await importW3xInWorker(buffer, { fileName: 'lane.w3x' });
    expect(report.strategy).toBe('script-pattern');
    expect(doc.meta.source).toMatchObject({ kind: 'w3x', file: 'lane.w3x' });
    expect(buffer.byteLength).toBe(bytes.byteLength);
    // Heights, both splat maps and the water mask leave the worker without a copy
    expect(documentTransferables(doc).length).toBe(4);
  });

  it('hands the water bodies over too', async () => {
    const { doc } = await importW3xInWorker(buildSyntheticMap().slice().buffer as ArrayBuffer);
    const mask = new Uint8Array(doc.terrain.grid.heights.length);
    doc.terrain.waterBodies = [{ level: 1, mask, color: '#335566' }];
    expect(documentTransferables(doc)).toContain(mask.buffer);
  });

  describe('in a worker that never answers (a map that keeps it busy)', () => {
    const terminated = vi.fn();
    class StuckWorker {
      onmessage: unknown = null;
      onerror: unknown = null;
      postMessage(): void {
        // never answers
      }
      terminate(): void {
        terminated();
      }
    }

    beforeEach(() => {
      terminated.mockClear();
      vi.stubGlobal('Worker', StuckWorker);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('stops it after the timeout', async () => {
      const run = importW3xInWorker(new ArrayBuffer(8), {}, { timeoutMs: 20 });
      await expect(run).rejects.toThrow(/longer than 0 s/);
      expect(terminated).toHaveBeenCalledTimes(1);
    });

    it('stops it when the caller aborts, and refuses to start once aborted', async () => {
      const abort = new AbortController();
      const run = importW3xInWorker(new ArrayBuffer(8), {}, { signal: abort.signal });
      abort.abort();
      await expect(run).rejects.toThrow(/cancelled/);
      expect(terminated).toHaveBeenCalledTimes(1);
      await expect(importW3xInWorker(new ArrayBuffer(8), {}, { signal: abort.signal })).rejects.toThrow(/cancelled/);
    });
  });

  it('takes the file name from a File', async () => {
    const file = new File([buildSyntheticMap() as BlobPart], 'from-disk.w3x');
    const { doc } = await importW3xInWorker(file);
    expect(doc.meta.source).toMatchObject({ kind: 'w3x', file: 'from-disk.w3x' });
  });
});
