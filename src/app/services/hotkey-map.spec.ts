import { describe, expect, it } from 'vitest';
import { HOTKEY_HELP, HotkeyEvent, resolveHotkey, towerSlotKey } from './hotkey-map';
import { ABILITIES, ABILITY_IDS } from '../configs/abilities.config';

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

  it('flies the camera on Home and N', () => {
    expect(resolveHotkey(key('Home'))).toEqual({ kind: 'camera-hq' });
    expect(resolveHotkey(key('n'))).toEqual({ kind: 'camera-spawn' });
    expect(resolveHotkey(key('N', { shiftKey: true }))).toEqual({ kind: 'camera-spawn' });
  });

  it('aims the nuclear strike on K', () => {
    expect(resolveHotkey(key('k'))).toEqual({ kind: 'ability', abilityId: 'nuclear-strike' });
    expect(resolveHotkey(key('K', { shiftKey: true }))).toEqual({ kind: 'ability', abilityId: 'nuclear-strike' });
  });

  it('gives every ability its own key from the config, none a key that is taken', () => {
    const keys = ABILITY_IDS.map((id) => ABILITIES[id].hotkey.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
    for (const id of ABILITY_IDS) {
      const k = ABILITIES[id].hotkey;
      expect(k).toMatch(/^[a-z]$/i);
      // The fixed keys come first: a taken key would resolve to something else
      expect(resolveHotkey(key(k.toLowerCase()))).toEqual({ kind: 'ability', abilityId: id });
      // Camera, rotate while building, debug: InputHandlerService handles them first
      expect(['w', 'a', 's', 'd', 'r', 't']).not.toContain(k.toLowerCase());
      const help = HOTKEY_HELP.flatMap((group) => group.rows).find((row) => row.keys.includes(k.toUpperCase()));
      expect(help?.label).toContain(ABILITIES[id].name);
    }
  });

  it('keeps G and V for the hero, no ability takes them', () => {
    for (const id of ABILITY_IDS) {
      expect(['g', 'v']).not.toContain(ABILITIES[id].hotkey.toLowerCase());
    }
  });

  it('selects the hero on G and switches his ammo on V', () => {
    expect(resolveHotkey(key('g'))).toEqual({ kind: 'hero' });
    expect(resolveHotkey(key('G', { shiftKey: true }))).toEqual({ kind: 'hero' });
    expect(resolveHotkey(key('v'))).toEqual({ kind: 'hero-ammo' });
    expect(resolveHotkey(key('V'))).toEqual({ kind: 'hero-ammo' });
    expect(resolveHotkey(key('g', { ctrlKey: true }))).toBeNull();
  });

  it('lists G and V in the overview', () => {
    const hero = HOTKEY_HELP.find((g) => g.title === 'Hero')!;
    expect(hero.rows.map((r) => r.keys)).toEqual([['G'], ['V']]);
  });

  it('names Esc for skipping the boss intro in the overview (BossIntroService.handleKeyDown)', () => {
    const game = HOTKEY_HELP.find((g) => g.title === 'Game')!;
    expect(game.rows.find((r) => r.keys.includes('Esc'))?.label).toMatch(/boss intro/i);
  });

  it('toggles photo mode on O, also with Caps Lock or Shift', () => {
    expect(resolveHotkey(key('o'))).toEqual({ kind: 'photo-mode' });
    expect(resolveHotkey(key('O', { shiftKey: true }))).toEqual({ kind: 'photo-mode' });
    expect(resolveHotkey(key('o', { ctrlKey: true }))).toBeNull();
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
