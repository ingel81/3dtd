import { MAP_SEND_CHARS_PER_SECOND, MapAssembler, PacedMapSend, splitMapFile, type MapPart, type MapSendProgress } from './map-transfer';
import { MAP_PART_BYTES, MAX_MAP_BYTES, MAX_MAP_PARTS } from './protocol';

/** Bytes 0, 1, 2, … wrapping at 251, `n` of them */
const file = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 251);

describe('map transfer (coop with a custom map)', () => {
  it('splits a file into pieces under the relay\'s limits and puts them back in any order', () => {
    const bytes = file(MAP_PART_BYTES * 2 + 1000);
    const parts = splitMapFile(bytes, 'valley', 'h1')!;
    expect(parts.map((p) => [p.part, p.parts])).toEqual([[0, 3], [1, 3], [2, 3]]);
    // Base64 of a full piece stays under the relay's 1 MB message
    expect(parts[0].data.length).toBeLessThan(1024 * 1024 - 1024);

    const assembler = new MapAssembler();
    expect(assembler.add(parts[2])).toBeNull();
    expect(assembler.current).toEqual({ mapId: 'valley', hash: 'h1' });
    expect(assembler.progress).toEqual({ done: 1, total: 3 });
    expect(assembler.add(parts[0])).toBeNull();
    expect(assembler.add(parts[1])).toEqual(bytes);
  });

  it('refuses a map too big to send, and starts over on a piece of another map', () => {
    expect(MAX_MAP_BYTES).toBe(32 * 2 ** 20);
    expect(splitMapFile(file(MAX_MAP_BYTES), 'big', 'h')).toHaveLength(MAX_MAP_PARTS);
    expect(splitMapFile(file(MAX_MAP_BYTES + 1), 'big', 'h')).toBeNull();
    const a = splitMapFile(file(MAP_PART_BYTES + 10), 'a', 'h1')!;
    const b = splitMapFile(file(20), 'b', 'h2')!;
    const assembler = new MapAssembler();
    assembler.add(a[0]);
    expect(assembler.add(b[0])).toEqual(file(20));
    // The first piece of a is gone with the switch
    expect(assembler.add(a[1])).toBeNull();
    expect(assembler.add({ ...a[1], part: 7 })).toBeNull();
  });
});

describe('PacedMapSend (host)', () => {
  const parts = (n: number, chars = 4): MapPart[] =>
    Array.from({ length: n }, (_, part) => ({ mapId: 'm', hash: 'h', part, parts: n, data: `P${part}`.padEnd(chars, 'A') }));

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends the next piece once the relay confirmed the last, then the world, the newest one asked for while they went', async () => {
    const sent: string[] = [];
    const progress: (MapSendProgress | null)[] = [];
    const send = new PacedMapSend();
    send.onProgress = (p) => progress.push(p);
    send.share(parts(3), (p) => sent.push(p.data), () => sent.push('world 1'), () => true);
    expect(sent).toEqual(['P0AA']);
    // A second share while the pieces go: no world now, and the first world never comes
    send.share(null, (p) => sent.push(p.data), () => sent.push('world 2'), () => true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toEqual(['P0AA']);
    expect(send.busy).toBe(true);
    // An ack for another piece is no ack
    send.acked(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toEqual(['P0AA']);
    send.acked(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual(['P0AA', 'P1AA']);
    send.acked(1);
    await vi.advanceTimersByTimeAsync(0);
    send.acked(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual(['P0AA', 'P1AA', 'P2AA', 'world 2']);
    expect(send.busy).toBe(false);
    expect(progress).toEqual([{ done: 0, total: 3 }, { done: 1, total: 3 }, { done: 2, total: 3 }, { done: 3, total: 3 }, null]);
    // Done: a share without pieces sends its world at once
    send.share(null, () => undefined, () => sent.push('world 3'), () => true);
    expect(sent.at(-1)).toBe('world 3');
  });

  it("keeps under the relay's byte rate however fast the acks come", async () => {
    const chars = 600_000;
    const at: number[] = [];
    const send = new PacedMapSend();
    send.share(parts(4, chars), (p) => {
      at.push(performance.now());
      queueMicrotask(() => send.acked(p.part));
    }, () => undefined, () => true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(at).toHaveLength(4);
    const gap = (chars / MAP_SEND_CHARS_PER_SECOND) * 1000;
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(gap - 1);
  });

  it('sends nothing more once the session is gone, also while it waits for an ack', async () => {
    const sent: string[] = [];
    let alive = true;
    const send = new PacedMapSend();
    send.share(parts(3), (p) => sent.push(p.data), () => sent.push('world'), () => alive);
    alive = false;
    await vi.advanceTimersByTimeAsync(3000);
    send.acked(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent).toEqual(['P0AA']);
    expect(send.busy).toBe(false);
  });
});
