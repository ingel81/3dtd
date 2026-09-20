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
    useDirectorParams('wide-band');
    expect(useDirectorParams('typo')).toBe(false);
    expect(directorParamsName()).toBe('wide-band');
  });

  it('reaches the director: a steeper ramp is further along at the same wave', () => {
    const rampAt = (wave: number) => decideWave([0, 1], wave, [], () => 0.5).why.ramp;

    const withDefault = rampAt(30);
    useDirectorParams('steep-ramp');
    const withSteep = rampAt(30);

    expect(withSteep).toBeGreaterThan(withDefault);
  });
});
