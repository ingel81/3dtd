// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { expiredLogs, logFileName, stamp } from './log-files.ts';
import { isLocalRequest } from './server.ts';

describe('relay log files (D64, D66)', () => {
  const now = new Date(2026, 8, 25, 18, 4, 7);

  it('names a file a day and stamps each line', () => {
    expect(logFileName(now)).toBe('coop_2026-09-25.log');
    expect(stamp(now)).toBe('2026-09-25 18:04:07');
  });

  it('keeps the last days, today included, and leaves other files alone', () => {
    const names = ['coop_2026-09-25.log', 'coop_2026-09-12.log', 'coop_2026-09-11.log', 'coop_2026-09-01_10-00-00.log', 'notes.txt'];
    expect(expiredLogs(names, now, 14)).toEqual(['coop_2026-09-11.log', 'coop_2026-09-01_10-00-00.log']);
  });
});

describe('status page for the local network only (D66)', () => {
  it('lets this machine and the LAN in, not what came through the tunnel', () => {
    expect(isLocalRequest('127.0.0.1', {})).toBe(true);
    expect(isLocalRequest('::ffff:192.168.0.5', {})).toBe(true);
    expect(isLocalRequest('172.18.0.3', {})).toBe(true);
    expect(isLocalRequest('172.18.0.3', { 'cf-connecting-ip': '203.0.113.9' })).toBe(false);
    expect(isLocalRequest('203.0.113.9', {})).toBe(false);
  });
});
