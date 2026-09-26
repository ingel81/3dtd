import { describe, it, expect, afterEach } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { packRunLog, readRunUploadConsent, writeRunUploadConsent } from './run-upload';

/** Sending a coop run log to the relay (TODO E38): the answer and the packing */
describe('run upload', () => {
  afterEach(() => localStorage.removeItem('3dtd-run-upload'));

  it('knows no answer until the player gave one, then keeps it', () => {
    expect(readRunUploadConsent()).toBeNull();
    writeRunUploadConsent('no');
    expect(readRunUploadConsent()).toBe('no');
    writeRunUploadConsent('yes');
    expect(readRunUploadConsent()).toBe('yes');
    localStorage.setItem('3dtd-run-upload', 'maybe');
    expect(readRunUploadConsent()).toBeNull();
  });

  it('packs the log as gzip in base64, the relay unpacks the same text', async () => {
    const text = '{"kind":"head"}\n' + '{"kind":"sample","credits":100}\n'.repeat(2000);
    const packed = await packRunLog(text);
    expect(packed).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(packed.length).toBeLessThan(text.length / 10);
    expect(gunzipSync(Buffer.from(packed, 'base64')).toString('utf8')).toBe(text);
  });
});
