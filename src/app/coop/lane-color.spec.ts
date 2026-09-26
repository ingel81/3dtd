import { describe, expect, it } from 'vitest';
import { laneCss } from './lane-color';
import { SPAWN_COLORS } from '../configs/map-constants.config';

describe('laneCss', () => {
  it('gives each lane its map colour, six hex digits, and wraps past the last', () => {
    expect(laneCss(0)).toBe('#ef4444');
    expect(laneCss(2)).toBe('#00bcd4');
    expect(laneCss(SPAWN_COLORS.length)).toBe(laneCss(0));
  });

  it('gives no lane the fallback, transparent unless told otherwise', () => {
    expect(laneCss(-1)).toBe('transparent');
    expect(laneCss(-1, 'var(--td-text-secondary)')).toBe('var(--td-text-secondary)');
  });
});
