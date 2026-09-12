import { afterEach, describe, it, expect, vi } from 'vitest';
import { Vector3 } from 'three';
import { SCORCH_DECAL_CONFIG } from '../../configs/visual-effects.config';
import { ThreeFlameBeamRenderer } from './three-flame-beam.renderer';
import type { ThreeEffectsRenderer } from './three-effects.renderer';

describe('ThreeFlameBeamRenderer scorch marks', () => {
  afterEach(() => vi.restoreAllMocks());

  it('marks the beam target once per interval while it burns', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const effects = { spawnFlameParticle: vi.fn(), markScorch: vi.fn() };
    const beams = new ThreeFlameBeamRenderer();
    beams.setEffectsRenderer(effects as unknown as ThreeEffectsRenderer);
    beams.startBeam('t1', new Vector3(0, 10, 0), new Vector3(5, 1, 5), 20, 4);

    beams.update(16);
    expect(effects.markScorch).toHaveBeenCalledWith(5, 1, 5, 'fire');

    now += SCORCH_DECAL_CONFIG.fireIntervalMs / 2;
    beams.update(16);
    expect(effects.markScorch).toHaveBeenCalledTimes(1);

    now += SCORCH_DECAL_CONFIG.fireIntervalMs / 2;
    beams.update(16);
    expect(effects.markScorch).toHaveBeenCalledTimes(2);

    beams.stopBeam('t1');
    now += SCORCH_DECAL_CONFIG.fireIntervalMs;
    beams.update(16);
    expect(effects.markScorch).toHaveBeenCalledTimes(2);
  });
});
