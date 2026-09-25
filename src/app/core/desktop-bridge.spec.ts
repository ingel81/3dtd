import { describe, expect, it, vi } from 'vitest';
import { readCoopLan, readDesktopBridge } from './desktop-bridge';

describe('readDesktopBridge', () => {
  const bridge = () => ({
    version: '0.3.0',
    onUpdateReady: vi.fn(() => () => undefined),
    installUpdateNow: vi.fn(),
    saveRun: vi.fn(async () => true),
  });

  it('is null in a browser', () => {
    expect(readDesktopBridge({})).toBeNull();
    expect(readDesktopBridge(undefined)).toBeNull();
  });

  it('returns the bridge of the desktop build', () => {
    const desktop = bridge();
    expect(readDesktopBridge({ desktop })).toBe(desktop);
  });

  it('ignores a desktop property that is not the bridge', () => {
    expect(readDesktopBridge({ desktop: true })).toBeNull();
    expect(readDesktopBridge({ desktop: { ...bridge(), installUpdateNow: 'no' } })).toBeNull();
    expect(readDesktopBridge({ desktop: { ...bridge(), version: 3 } })).toBeNull();
  });
});

describe('readCoopLan', () => {
  const base = { version: '0.5.0', onUpdateReady: () => () => undefined, installUpdateNow: () => undefined, saveRun: async () => true };
  const coopLan = { host: vi.fn(), stop: vi.fn(), scan: vi.fn(), probe: vi.fn() };

  it('is there in an app with LAN coop', () => {
    expect(readCoopLan({ desktop: { ...base, coopLan } })).toBe(coopLan);
  });

  it('is null in a browser and in an older app', () => {
    expect(readCoopLan({})).toBeNull();
    expect(readCoopLan({ desktop: base })).toBeNull();
    expect(readCoopLan({ desktop: { ...base, coopLan: { ...coopLan, scan: 1 } } })).toBeNull();
  });
});
