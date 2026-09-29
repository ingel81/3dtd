import { describe, it, expect } from 'vitest';
import { ShotPrediction } from './shot-prediction';

describe('ShotPrediction', () => {
  it('quiets the next shot of the tower within the window, for both sides of it', () => {
    const p = new ShotPrediction();
    p.predict('tower-1', 1000);
    expect(p.take('tower-1', 1200)).toBe(true);
    expect(p.take('tower-1', 1210)).toBe(true);
    expect(p.take('tower-1', 1300)).toBe(false);
  });

  it('does not quiet a shot of another tower or one too late', () => {
    const p = new ShotPrediction();
    p.predict('tower-1', 1000);
    expect(p.take('tower-2', 1100)).toBe(false);
    expect(p.take('tower-1', 1500)).toBe(false);
  });

  it('forgets a quiet shot the other side never asked about', () => {
    const p = new ShotPrediction();
    p.predict('tower-1', 1000);
    expect(p.take('tower-1', 1100)).toBe(true);
    p.predict('tower-1', 2000);
    expect(p.take('tower-1', 2100)).toBe(true);
    expect(p.take('tower-1', 2150)).toBe(true);
    expect(p.take('tower-1', 2160)).toBe(false);
  });
});
