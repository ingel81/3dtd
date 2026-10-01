import { describe, it, expect } from 'vitest';
import { gunzipBase64, gzipBase64 } from './gzip-base64';

describe('gzip in base64', () => {
  it('gives the text back', async () => {
    expect(await gunzipBase64(await gzipBase64('{"a":1}'))).toBe('{"a":1}');
    expect(await gunzipBase64(await gzipBase64('äöü'), 100)).toBe('äöü');
  });

  it('refuses what unpacks to more than the bound: a few kB that would unpack to a lot', async () => {
    const bomb = await gzipBase64('0'.repeat(2_000_000));
    expect(bomb.length).toBeLessThan(10_000);
    await expect(gunzipBase64(bomb, 1_000_000)).rejects.toThrow('more than 1000000 bytes');
    expect(await gunzipBase64(bomb, 2_000_000)).toHaveLength(2_000_000);
  });
});
