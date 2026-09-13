import { describe, it, expect } from 'vitest';
import { PulseThrottle } from './pulse-throttle';

describe('PulseThrottle', () => {
  it('lets the first pulse through', () => {
    expect(new PulseThrottle(500).tryPulse(0)).toBe(true);
  });

  it('holds pulses inside the interval and lets the next one through after it', () => {
    const throttle = new PulseThrottle(500);
    throttle.tryPulse(1000);
    expect(throttle.tryPulse(1200)).toBe(false);
    expect(throttle.tryPulse(1499)).toBe(false);
    expect(throttle.tryPulse(1500)).toBe(true);
  });

  it('turns a burst of 20k events into one pulse', () => {
    const throttle = new PulseThrottle(500);
    let pulses = 0;
    for (let i = 0; i < 20_000; i++) {
      if (throttle.tryPulse(2000 + i * 0.01)) pulses++;
    }
    expect(pulses).toBe(1);
  });

  it('measures from the last pulse that started, not from held events', () => {
    const throttle = new PulseThrottle(500);
    throttle.tryPulse(0);
    throttle.tryPulse(400); // held
    expect(throttle.tryPulse(500)).toBe(true);
  });
});
