import { describe, expect, it } from 'vitest';
import { HotkeyEvent, resolveHotkey, towerSlotKey } from './hotkey-map';

const key = (k: string, mods: Partial<HotkeyEvent> = {}): HotkeyEvent => ({
  key: k, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false, ...mods,
});

describe('resolveHotkey', () => {
  it('maps 1 to 9 to the build card slots', () => {
    expect(resolveHotkey(key('1'))).toEqual({ kind: 'select-tower', slot: 0 });
    expect(resolveHotkey(key('9'))).toEqual({ kind: 'select-tower', slot: 8 });
    expect(resolveHotkey(key('0'))).toBeNull();
  });

  it('maps the tower, wave and game keys', () => {
    expect(resolveHotkey(key('u'))).toEqual({ kind: 'upgrade' });
    expect(resolveHotkey(key('U', { shiftKey: true }))).toEqual({ kind: 'upgrade' });
    expect(resolveHotkey(key('Delete'))).toEqual({ kind: 'sell' });
    expect(resolveHotkey(key('Backspace'))).toEqual({ kind: 'sell' });
    expect(resolveHotkey(key(' '))).toEqual({ kind: 'start-wave' });
    expect(resolveHotkey(key('Escape'))).toEqual({ kind: 'cancel' });
  });

  it('pauses on P and leaves Shift+P to the debug toggle', () => {
    expect(resolveHotkey(key('p'))).toEqual({ kind: 'pause' });
    expect(resolveHotkey(key('P'))).toEqual({ kind: 'pause' }); // Caps Lock
    expect(resolveHotkey(key('P', { shiftKey: true }))).toBeNull();
  });

  it('steps the speed with + or = and -', () => {
    expect(resolveHotkey(key('+'))).toEqual({ kind: 'speed', step: 1 });
    expect(resolveHotkey(key('='))).toEqual({ kind: 'speed', step: 1 });
    expect(resolveHotkey(key('-'))).toEqual({ kind: 'speed', step: -1 });
  });

  it('opens the help on H and ?', () => {
    expect(resolveHotkey(key('h'))).toEqual({ kind: 'help' });
    expect(resolveHotkey(key('?', { shiftKey: true }))).toEqual({ kind: 'help' });
  });

  it('leaves the camera keys alone, S included', () => {
    for (const k of ['w', 'a', 's', 'd', 'ArrowUp', 'r', 't']) {
      expect(resolveHotkey(key(k))).toBeNull();
    }
  });

  it('ignores browser shortcuts and held keys', () => {
    expect(resolveHotkey(key('1', { ctrlKey: true }))).toBeNull();
    expect(resolveHotkey(key('p', { metaKey: true }))).toBeNull();
    expect(resolveHotkey(key('u', { altKey: true }))).toBeNull();
    expect(resolveHotkey(key(' ', { repeat: true }))).toBeNull();
    expect(resolveHotkey(key('Delete', { repeat: true }))).toBeNull();
  });
});

describe('towerSlotKey', () => {
  it('numbers the first nine cards', () => {
    expect(towerSlotKey(0)).toBe('1');
    expect(towerSlotKey(8)).toBe('9');
    expect(towerSlotKey(9)).toBeNull();
    expect(towerSlotKey(-1)).toBeNull();
  });
});
