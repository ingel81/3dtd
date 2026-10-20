import { describe, expect, it } from 'vitest';
import { NextFrameGate } from './next-frame-gate';

describe('NextFrameGate (E271)', () => {
  it('holds work a packet brings before an update until the update after it', () => {
    const gate = new NextFrameGate();
    gate.tick();
    expect(gate.open).toBe(true);
    // The strike's packet, applied before the update of the same frame
    gate.mark();
    gate.tick();
    expect(gate.open).toBe(false);
    gate.tick();
    expect(gate.open).toBe(true);
  });

  it('holds again for each new mark, and only one frame', () => {
    const gate = new NextFrameGate();
    gate.tick();
    gate.mark();
    gate.tick();
    gate.mark();
    gate.tick();
    expect(gate.open).toBe(false);
    gate.tick();
    expect(gate.open).toBe(true);
  });
});
