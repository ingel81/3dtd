import { implode } from '../../../test/w3x-fixtures';
import { explode } from './explode';

describe('explode (PKWARE DCL)', () => {
  it('decodes the reference stream from zlib blast.c', () => {
    const out = explode(new Uint8Array([0x00, 0x04, 0x82, 0x24, 0x25, 0x8f, 0x80, 0x7f]));
    expect(new TextDecoder().decode(out)).toBe('AIAIAIAIAIAIA');
  });

  it.each([4, 5, 6] as const)('round-trips mixed data with dictionary bits %i', (dict) => {
    const data = new Uint8Array(3000);
    for (let i = 0; i < data.length; i++) data[i] = i % 700 < 300 ? (i * 31) & 0xff : 'abcab'.charCodeAt(i % 5);
    const packed = implode(data, dict);
    expect(packed.length).toBeLessThan(data.length);
    expect(explode(packed)).toEqual(data);
    expect(explode(packed, data.length)).toEqual(data);
  });

  it('stops at its limit instead of following the stream to its end marker', () => {
    const packed = implode(new Uint8Array(100000), 6);
    expect(() => explode(packed, undefined, 5000)).toThrow(/more than 5000 bytes/);
    expect(explode(packed, undefined, 100000).length).toBe(100000);
  });

  it('rejects coded literals with a clear message', () => {
    expect(() => explode(new Uint8Array([1, 4, 0, 0]))).toThrow(/ASCII mode/);
  });

  it('fails on a stream that ends before its end marker', () => {
    expect(() => explode(new Uint8Array([0, 4, 0x82]))).toThrow(/ends early/);
  });
});
