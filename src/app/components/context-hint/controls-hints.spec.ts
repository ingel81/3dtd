import { describe, it, expect } from 'vitest';
import { controlsHints } from './controls-hints';
import { en } from '../../i18n/messages/en';

describe('controlsHints', () => {
  it('names M with the camera controls while every sound is off, not otherwise', () => {
    expect(controlsHints(en, false).map((h) => h.key)).toEqual(['LMB', 'RMB', 'Wheel', 'WASD', 'H']);
    expect(controlsHints(en, true).at(-1)).toEqual({ key: 'M', description: 'Sound is off' });
  });
});
