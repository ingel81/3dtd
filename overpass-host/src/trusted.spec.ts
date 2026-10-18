// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { addressBytes, inRanges, parseRanges } from './trusted.ts';

describe('trusted', () => {
  it('reads IPv4, IPv6 and IPv4-mapped addresses', () => {
    expect(Array.from(addressBytes('192.168.1.20')!)).toEqual([192, 168, 1, 20]);
    expect(Array.from(addressBytes('::ffff:10.0.0.1')!)).toEqual([10, 0, 0, 1]);
    expect(addressBytes('2001:db8::1')).toHaveLength(16);
    expect(addressBytes('300.1.1.1')).toBeNull();
    expect(addressBytes('nonsense')).toBeNull();
  });

  it('matches the local ranges by `private`, and given ranges by their prefix', () => {
    const local = parseRanges('private');
    for (const a of ['127.0.0.1', '10.1.2.3', '172.17.0.1', '192.168.0.9', '::1', 'fd00::5', '::ffff:172.18.0.2']) expect(inRanges(a, local)).toBe(true);
    for (const a of ['172.32.0.1', '8.8.8.8', '2001:db8::1', undefined]) expect(inRanges(a, local)).toBe(false);
    const one = parseRanges('172.20.0.0/16, 2001:db8:1::/48');
    expect(inRanges('172.20.255.1', one)).toBe(true);
    expect(inRanges('172.21.0.1', one)).toBe(false);
    expect(inRanges('2001:db8:1:ff::1', one)).toBe(true);
    expect(inRanges('2001:db8:2::1', one)).toBe(false);
  });

  it('refuses a range it cannot read', () => {
    expect(() => parseRanges('10.0.0.0/33')).toThrow();
    expect(() => parseRanges('example.com')).toThrow();
  });
});
