import { describe, expect, it, vi } from 'vitest';
import { readDesktopBridge } from './desktop-bridge';

describe('readDesktopBridge', () => {
  const bridge = () => ({ version: '0.3.0', onUpdateReady: vi.fn(() => () => undefined), installUpdateNow: vi.fn() });

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
