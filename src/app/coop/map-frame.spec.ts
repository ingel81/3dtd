import { decodeMapFrame, encodeMapFrame } from './map-frame';

describe('map frame (a map piece as one binary WebSocket frame)', () => {
  it('carries the header and the bytes and reads them back', () => {
    const data = Uint8Array.from([1, 2, 3, 250]);
    const frame = encodeMapFrame({ mapId: 'harbor-town', hash: 'abc', part: 2, parts: 5 }, data);
    expect([...frame.subarray(0, 4)]).toEqual([0x4d, 0x41, 0x50, 0x31]);
    const back = decodeMapFrame(frame)!;
    expect(back.header).toEqual({ mapId: 'harbor-town', hash: 'abc', part: 2, parts: 5 });
    expect([...back.data]).toEqual([1, 2, 3, 250]);
  });

  it('reads a frame inside a larger buffer, and nothing that is no frame', () => {
    const frame = encodeMapFrame({ mapId: 'm', hash: 'h', part: 0, parts: 1 }, new Uint8Array(3));
    const padded = new Uint8Array(frame.length + 6);
    padded.set(frame, 3);
    expect(decodeMapFrame(padded.subarray(3, 3 + frame.length))?.header.mapId).toBe('m');
    expect(decodeMapFrame(new TextEncoder().encode('{"t":"map"}'))).toBeNull();
    const broken = frame.slice();
    broken[8] = 0x7b + 1;
    expect(decodeMapFrame(broken)).toBeNull();
  });
});
