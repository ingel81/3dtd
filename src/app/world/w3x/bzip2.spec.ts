import { base64Bytes } from '../../../test/w3x-fixtures';
import { bunzip2 } from './bzip2';

/** python: bz2.compress(text, 9), text built as in `mixed()` (2596 bytes) */
const MIXED_BZ2 =
  'QlpoOTFBWSZTWbGCcIIAANJ/////////////////////////////////////////////wAJZ1AwiGlVAAAAAAAAAAAAAAAAAAAABoAAAAAAAAAAAAAAAAH/qn5VQAAA//VVAkwAEwABMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACFUIyaaYajAmDSZDEwAmAAQxANMJiGAAgw0001PQBoCYEMmRiaYjJk0MTCBk0NGINDRoyDTBMAAmAAkqpAAAAJowJhMCYAQYAEYBMmAJgAJgBMmmAmAJgJgmCZGAACYAAmBMaA0mf+lUAEwB/6qkwIvoFTJ/DYkgNIADUmBtAgblAOYICBUdsQE76InpYT+DHbwgIUKCJDARhw3EQCREhuooEkuCXFimRgp0aKhHCpR4qkgG96QK8iCzJAtyYLsoBdgMEkgyJTMkqd+iqGTVSyiqmVX1ZYq2XKxmCtZkrn6n2Zor+bLBnCxZ1czsi4TwuXaF0nxdqAHihB67Yc3uBz6IHyjB+7oEqQSdKJTvCVphLd8YTwGC1Z617sMBhtcRZGvMTsDFbExmyMdszIbRZLarJ7ZZX+ll9uszuDNbkzm6M9uzP7w0O9NHvjSb9fxbUkEREAI4C03BWo4S1XDWs4hruKbD+zZcY2nHNtyDb8k3PKN3y1vf8W/5i4PNXD5y5gCOQAjjRJj+ecnoE3ARy4gBHRI70jm9MieodCKOl1VFAIiv9XUARK+soz10w0CTgIh2CPdkh2iHbIdwh3SKSAUZh3lBCBN31EAgXgUb8Kh/yh4iHjIeQh5SHmIech6CHpIepQdG/aMUYoxDEMQxDEMQxDFGKOUco5RyHIchyHIchyHIco5RyjlHKOQ5DkOQ5DkPrwxRijFGKMUYhiGIYhSFIUhSFKKUUopRSikKQpCkKQpCkKUUopRSkApAIgOM4zjOM4zjOM6Z0zpnTOmcZxnGcZzruM4zjdlM6Z0zpnGcg5BxnGcozOdVxnTOmdM6Z0zjOM43jGcZxnGcZ0zpnTOmm6U/z+/7/i7kinChIWME4QQ';
/** python: bz2.compress(b'hello hello hello') twice, concatenated */
const TWO_STREAMS =
  'QlpoOTFBWSZTWZ5iW/4AAAKRAEAAAkSgACEUYGaCke8jRwu5IpwoSE8xLf8AQlpoOTFBWSZTWZ5iW/4AAAKRAEAAAkSgACEUYGaCke8jRwu5IpwoSE8xLf8A';

function mixed(): Uint8Array {
  const enc = new TextEncoder();
  const parts: number[] = [];
  parts.push(...enc.encode('The Throne '.repeat(40)));
  for (let i = 0; i < 256; i++) parts.push(i);
  for (let i = 0; i < 1000; i++) parts.push(65);
  parts.push(...enc.encode('xyz'.repeat(100)));
  for (let i = 0; i < 600; i++) parts.push((i * 7919) % 251);
  return new Uint8Array(parts);
}

describe('bunzip2', () => {
  it('decodes a block with long runs, every byte value and several tables', () => {
    const want = mixed();
    expect(want.length).toBe(2596);
    expect(bunzip2(base64Bytes(MIXED_BZ2))).toEqual(want);
    expect(bunzip2(base64Bytes(MIXED_BZ2), want.length)).toEqual(want);
  });

  it('decodes concatenated streams', () => {
    expect(new TextDecoder().decode(bunzip2(base64Bytes(TWO_STREAMS)))).toBe('hello hello hello'.repeat(2));
  });

  it('rejects data that is not bzip2', () => {
    expect(() => bunzip2(new TextEncoder().encode('PK\x03\x04 nope'))).toThrow(/bad stream header/);
  });

  it('checks the expected size', () => {
    expect(() => bunzip2(base64Bytes(MIXED_BZ2), 10)).toThrow(/expected 10/);
  });
});
