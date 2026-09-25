import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROOM_OPTIONS,
  changedOptions,
  mayCheat,
  mayPause,
  optionLabel,
  startsWhenAllReady,
  validOptions,
  waveButtonAction,
} from './room-options';

describe('room options (docs/COOP_PLAN.md, D38)', () => {
  it('starts with cheats off, pause for the host, the wave once all are ready', () => {
    expect(DEFAULT_ROOM_OPTIONS).toEqual({ cheats: 'off', pause: 'host', wave: 'all' });
  });

  it('lets a cheat through only where the relay allows cheats and the room rule names the player', () => {
    const host = { ...DEFAULT_ROOM_OPTIONS, cheats: 'host' as const };
    const all = { ...DEFAULT_ROOM_OPTIONS, cheats: 'all' as const };
    expect(mayCheat(host, true, 'a', 'a')).toBe(true);
    expect(mayCheat(host, true, 'b', 'a')).toBe(false);
    expect(mayCheat(all, true, 'b', 'a')).toBe(true);
    expect(mayCheat(all, false, 'a', 'a')).toBe(false);
    expect(mayCheat(DEFAULT_ROOM_OPTIONS, true, 'a', 'a')).toBe(false);
  });

  it('lets the host, everyone or nobody pause', () => {
    expect(mayPause(DEFAULT_ROOM_OPTIONS, true)).toBe(true);
    expect(mayPause(DEFAULT_ROOM_OPTIONS, false)).toBe(false);
    expect(mayPause({ ...DEFAULT_ROOM_OPTIONS, pause: 'all' }, false)).toBe(true);
    expect(mayPause({ ...DEFAULT_ROOM_OPTIONS, pause: 'off' }, true)).toBe(false);
  });

  it('the wave button says ready, the host starts at once with "Host starts"; all ready starts it otherwise', () => {
    const hostStarts = { ...DEFAULT_ROOM_OPTIONS, wave: 'host' as const };
    const auto = { ...DEFAULT_ROOM_OPTIONS, wave: 'auto' as const };
    expect(waveButtonAction(DEFAULT_ROOM_OPTIONS, true)).toBe('ready');
    expect(waveButtonAction(hostStarts, true)).toBe('start');
    expect(waveButtonAction(hostStarts, false)).toBe('ready');
    expect(waveButtonAction(auto, true)).toBe('ready');
    expect(startsWhenAllReady(DEFAULT_ROOM_OPTIONS)).toBe(true);
    expect(startsWhenAllReady(auto)).toBe(true);
    expect(startsWhenAllReady(hostStarts)).toBe(false);
  });

  it('takes known choices only, names them and tells what changed', () => {
    expect(validOptions({ cheats: 'all', pause: 'off', wave: 'auto', extra: 1 })).toEqual({ cheats: 'all', pause: 'off', wave: 'auto' });
    expect(validOptions({ ...DEFAULT_ROOM_OPTIONS, wave: 'soon' })).toBeNull();
    expect(validOptions(null)).toBeNull();
    expect(optionLabel('wave', 'auto')).toBe('Auto 10 s');
    expect(changedOptions(DEFAULT_ROOM_OPTIONS, { ...DEFAULT_ROOM_OPTIONS, pause: 'all', wave: 'host' })).toEqual(['wave', 'pause']);
  });
});
