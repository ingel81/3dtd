import { describe, it, expect } from 'vitest';
import {
  INTRO_GATE_MIN_READY,
  INTRO_GATE_TIMEOUT_MS,
  flightGateMeta,
  flightGateOpen,
} from './flight-gate';

describe('flightGateOpen', () => {
  const firstTilesAt = 10_000;
  const deadline = firstTilesAt + INTRO_GATE_TIMEOUT_MS;

  it('hält, solange zu wenig Höhen verlässlich sind und die Frist läuft', () => {
    expect(flightGateOpen(0, firstTilesAt, deadline)).toBe(false);
    expect(flightGateOpen(INTRO_GATE_MIN_READY - 0.01, deadline - 1, deadline)).toBe(false);
  });

  it('öffnet, sobald die Schwelle erreicht ist, auch lange vor der Frist', () => {
    expect(flightGateOpen(INTRO_GATE_MIN_READY, firstTilesAt + 100, deadline)).toBe(true);
    expect(flightGateOpen(1, firstTilesAt, deadline)).toBe(true);
  });

  it('öffnet nach der Frist auch ohne Höhen (langsame Verbindung)', () => {
    expect(flightGateOpen(0, deadline, deadline)).toBe(true);
    expect(flightGateOpen(0.2, deadline + 5000, deadline)).toBe(true);
  });

  it('läuft über eine simulierte Ladephase: späte Höhen öffnen vor der Frist', () => {
    // 60 fps, die Höhen kommen ab 2 s nach dem ersten Tile-Load linear herein
    let openedAt: number | null = null;
    for (let t = firstTilesAt; t <= deadline + 1000 && openedAt === null; t += 1000 / 60) {
      const readiness = Math.min(1, Math.max(0, (t - firstTilesAt - 2000) / 3000));
      if (flightGateOpen(readiness, t, deadline)) openedAt = t;
    }
    expect(openedAt).not.toBeNull();
    expect(openedAt! - firstTilesAt).toBeGreaterThan(4500);
    expect(openedAt!).toBeLessThan(deadline);
  });
});

describe('flightGateMeta', () => {
  it('zeigt den Fortschritt in ganzen Prozent, abgerundet', () => {
    expect(flightGateMeta(0)).toBe('0 % of the route');
    expect(flightGateMeta(0.899)).toBe('89 % of the route');
    expect(flightGateMeta(1)).toBe('100 % of the route');
  });
});
