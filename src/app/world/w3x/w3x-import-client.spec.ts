import { buildSyntheticMap } from '../../../test/w3x-synthetic-map';
import { importW3xInWorker } from './w3x-import-client';
import { documentTransferables } from './w3x-worker.types';

describe('importW3xInWorker', () => {
  it('imports on the calling thread where there are no workers, keeping the caller buffer', async () => {
    const bytes = buildSyntheticMap();
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const { doc, report } = await importW3xInWorker(buffer, { fileName: 'lane.w3x' });
    expect(report.strategy).toBe('script-pattern');
    expect(doc.meta.source?.file).toBe('lane.w3x');
    expect(buffer.byteLength).toBe(bytes.byteLength);
    // Heights, both splat maps and the water mask leave the worker without a copy
    expect(documentTransferables(doc).length).toBe(4);
  });

  it('takes the file name from a File', async () => {
    const file = new File([buildSyntheticMap() as BlobPart], 'from-disk.w3x');
    const { doc } = await importW3xInWorker(file);
    expect(doc.meta.source?.file).toBe('from-disk.w3x');
  });
});
