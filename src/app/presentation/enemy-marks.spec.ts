import { describe, expect, it } from 'vitest';
import { EF_ALIVE, EF_ENRAGED } from '../sim/protocol/packet';
import { MARK_ENRAGED, MARK_LOOKS, NO_MARK, enemyMarkOf } from './enemy-marks';

describe('enemy marks', () => {
  it('read a raging boss from the flags, red at its own size', () => {
    expect(enemyMarkOf(EF_ALIVE)).toBe(NO_MARK);
    expect(enemyMarkOf(EF_ALIVE | EF_ENRAGED)).toBe(MARK_ENRAGED);
    expect(MARK_LOOKS[NO_MARK]).toEqual({ scale: 1, tint: null });
    expect(MARK_LOOKS[MARK_ENRAGED].tint).not.toBeNull();
  });
});
