import { FAILED_BEHIND_MS, HEALTH_STORAGE_KEY, HEALTH_TTL_MS, OverpassHealth } from './overpass-health';
import type { OverpassServer } from './overpass-servers';

/** The servers' health: the order it gives, its pauses, and what it keeps in storage and for how long */

const server = (name: string, regional = false): OverpassServer => ({
  url: `https://${name}.example/api/interpreter`,
  name,
  coverage: regional ? [{ minLat: 0, minLon: 0, maxLat: 1, maxLon: 1 }] : null,
});
const A = server('a');
const B = server('b');
const R = server('r', true);
const names = (servers: OverpassServer[]) => servers.map((s) => s.name);

/** A Storage in a Map */
function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

describe('OverpassHealth', () => {
  let now: number;
  const clock = () => now;

  beforeEach(() => {
    now = 1_000_000;
  });

  it('keeps the given order while nothing is known, the regional servers before the global ones', () => {
    expect(names(new OverpassHealth(null, clock).order([A, R, B]))).toEqual(['r', 'a', 'b']);
  });

  it('puts a server whose last attempt failed behind the others for a while, a regional one behind the global ones too', () => {
    const health = new OverpassHealth(null, clock);
    health.record(R.url, false, 15000);
    expect(names(health.order([R, A, B]))).toEqual(['a', 'b', 'r']);
    now += FAILED_BEHIND_MS;
    // Back in front of the global ones by region; its failure still counts against it among the regional ones
    expect(names(health.order([R, A, B]))).toEqual(['r', 'a', 'b']);
  });

  it('puts a paused server last until its pause ends, and keeps the longer of two pauses', () => {
    const health = new OverpassHealth(null, clock);
    health.pause(A.url, 30_000);
    health.pause(A.url, 5_000);
    health.record(B.url, false, 100);
    expect(health.pausedUntil(A.url)).toBe(now + 30_000);
    expect(names(health.order([A, B]))).toEqual(['b', 'a']);
    now += 30_000;
    expect(health.pausedUntil(A.url)).toBe(0);
    expect(names(health.order([A, B]))).toEqual(['a', 'b']);
  });

  it('ranks more answers than failures first, then the faster answers', () => {
    const health = new OverpassHealth(null, clock);
    health.record(A.url, true, 9000);
    health.record(B.url, true, 2000);
    expect(names(health.order([A, B]))).toEqual(['b', 'a']);
    health.record(A.url, true, 9000);
    expect(names(health.order([A, B]))).toEqual(['a', 'b']);
  });

  it('keeps the last six attempts of a server', () => {
    const health = new OverpassHealth(null, clock);
    for (let i = 0; i < 6; i++) health.record(A.url, false, 100);
    health.record(B.url, true, 100);
    now += FAILED_BEHIND_MS;
    for (let i = 0; i < 6; i++) health.record(A.url, true, 100);
    // a's six failures are gone: six answers against b's one
    expect(names(health.order([B, A]))).toEqual(['a', 'b']);
  });

  it('takes over what a health before it stored, for HEALTH_TTL_MS', () => {
    const storage = memoryStorage();
    const before = new OverpassHealth(storage, clock);
    before.record(A.url, false, 15000);
    before.pause(A.url, 60_000);
    expect(storage.map.has(HEALTH_STORAGE_KEY)).toBe(true);

    const after = new OverpassHealth(storage, clock);
    expect(after.pausedUntil(A.url)).toBe(now + 60_000);
    expect(names(after.order([A, B]))).toEqual(['b', 'a']);

    now += HEALTH_TTL_MS;
    const later = new OverpassHealth(storage, clock);
    expect(later.pausedUntil(A.url)).toBe(0);
    // a's stored failure is gone, b's fresh one puts b behind
    later.record(B.url, false, 1);
    expect(names(later.order([A, B]))).toEqual(['a', 'b']);
  });

  it('works on in memory when the storage throws or holds rubbish', () => {
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    const health = new OverpassHealth(throwing, clock);
    health.record(A.url, false, 100);
    expect(names(health.order([A, B]))).toEqual(['b', 'a']);
    health.clear();
    expect(names(health.order([A, B]))).toEqual(['a', 'b']);

    const storage = memoryStorage();
    storage.map.set(HEALTH_STORAGE_KEY, '{"https://a.example/api/interpreter":{"attempts":[{"at":"x"}],"pausedUntil":"y"}}');
    expect(names(new OverpassHealth(storage, clock).order([A, B]))).toEqual(['a', 'b']);
    storage.map.set(HEALTH_STORAGE_KEY, 'not json');
    expect(names(new OverpassHealth(storage, clock).order([A, B]))).toEqual(['a', 'b']);
  });
});
