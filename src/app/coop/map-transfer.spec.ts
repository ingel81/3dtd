import { MapAssembler, splitMapFile } from './map-transfer';
import { MAP_PART_BYTES, MAX_MAP_PARTS } from './protocol';

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
    expect(assembler.add(parts[0])).toBeNull();
    expect(assembler.add(parts[1])).toEqual(bytes);
  });

  it('refuses a map too big to send, and starts over on a piece of another map', () => {
    expect(splitMapFile(file(MAP_PART_BYTES * MAX_MAP_PARTS + 1), 'big', 'h')).toBeNull();
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
