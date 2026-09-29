import { describe, it, expect, vi } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { ShotPrediction } from './shot-prediction';
import { PresentationService } from '../presentation/presentation.service';

/** A prediction registered with a presentation that records the hook it got */
function prediction(setShotPrediction = vi.fn()): ShotPrediction {
  const injector = Injector.create({ providers: [{ provide: PresentationService, useValue: { setShotPrediction } }] });
  return runInInjectionContext(injector, () => new ShotPrediction());
}

describe('ShotPrediction', () => {
  it('quiets the next shot of the tower within the window, for both sides of it', () => {
    const p = prediction();
    p.predict('tower-1', 1000);
    expect(p.take('tower-1', 1200)).toBe(true);
    expect(p.take('tower-1', 1210)).toBe(true);
    expect(p.take('tower-1', 1300)).toBe(false);
  });

  it('does not quiet a shot of another tower or one too late', () => {
    const p = prediction();
    p.predict('tower-1', 1000);
    expect(p.take('tower-2', 1100)).toBe(false);
    expect(p.take('tower-1', 1500)).toBe(false);
  });

  it('hands the presentation its take() for the simulated shot', () => {
    const setShotPrediction = vi.fn();
    const p = prediction(setShotPrediction);
    p.predict('tower-1');
    const take = setShotPrediction.mock.calls[0][0] as (towerId: string) => boolean;
    expect(take('tower-1')).toBe(true);
  });

  it('forgets a quiet shot the other side never asked about', () => {
    const p = prediction();
    p.predict('tower-1', 1000);
    expect(p.take('tower-1', 1100)).toBe(true);
    p.predict('tower-1', 2000);
    expect(p.take('tower-1', 2100)).toBe(true);
    expect(p.take('tower-1', 2150)).toBe(true);
    expect(p.take('tower-1', 2160)).toBe(false);
  });
});
