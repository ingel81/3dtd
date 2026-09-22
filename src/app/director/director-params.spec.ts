import { describe, it, expect, afterEach } from 'vitest';
import {
  DEFAULT_DIRECTOR_PARAMS,
  DIRECTOR_PARAM_SETS,
  directorParams,
  directorParamsName,
  resetDirectorParams,
  useDirectorParams,
} from './director-params';
import { decideWave } from './director-rules';
import { dpsScaledCountMax } from './templates';

describe('director parameter sets', () => {
  afterEach(() => resetDirectorParams());

  it('plays the default set until a batch asks for another', () => {
    expect(directorParamsName()).toBe('default');
    expect(directorParams()).toEqual(DEFAULT_DIRECTOR_PARAMS);
  });

  it('switches to a named set', () => {
    expect(useDirectorParams('steep-ramp')).toBe(true);
    expect(directorParamsName()).toBe('steep-ramp');
    expect(directorParams().rampFullWave).toBe(DIRECTOR_PARAM_SETS['steep-ramp'].rampFullWave);
  });

  it('keeps what is in force when the name is unknown, and says so', () => {
    useDirectorParams('pressure-high');
    expect(useDirectorParams('typo')).toBe(false);
    expect(directorParamsName()).toBe('pressure-high');
  });

  it('campaign-size opens the whole count range to a weak defense', () => {
    const range: [number, number] = [5, 85];
    const weakDps = 40;

    const withDefault = dpsScaledCountMax(range, weakDps);
    useDirectorParams('campaign-size');
    const withCampaign = dpsScaledCountMax(range, weakDps);

    // Today a weak defense is handed the bottom of the range, whatever the
    // campaign says the wave should be
    expect(withDefault).toBeLessThan(20);
    expect(withCampaign).toBe(range[1]);
  });

  it('campaign-size leaves a strong defense where it was', () => {
    const range: [number, number] = [5, 85];
    const strongDps = 100_000;

    const withDefault = dpsScaledCountMax(range, strongDps);
    useDirectorParams('campaign-size');

    expect(withDefault).toBe(range[1]);
    expect(dpsScaledCountMax(range, strongDps)).toBe(range[1]);
  });

  it('the game plays the cap with the headroom the first tuning round settled on', () => {
    // 749 runs over four settings: at 1 the weaker bot outlived the stronger
    // one, at 2 both collapse to wave 13 (BALANCING_PLAN.md, Tuning-Runde 1)
    expect(DEFAULT_DIRECTOR_PARAMS.capSlack).toBe(1.5);
    expect(DIRECTOR_PARAM_SETS['cap-tight'].capSlack).toBeLessThan(1.5);
    expect(DIRECTOR_PARAM_SETS['cap-loose'].capSlack).toBeGreaterThan(1.5);
  });

  it('reaches the director: a steeper ramp is further along at the same wave', () => {
    const rampAt = (wave: number) => decideWave([0, 1], wave, [], () => 0.5).why.ramp;

    const withDefault = rampAt(30);
    useDirectorParams('steep-ramp');
    const withSteep = rampAt(30);

    expect(withSteep).toBeGreaterThan(withDefault);
  });
});
