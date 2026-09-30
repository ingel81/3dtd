import { describe, it, expect } from 'vitest';
import { PacketSums, loadRates } from './load-stats';
import type { SimFramePacket } from '../protocol/packet';

/** A frame source like SimClient: listeners get each packet, applyTimes holds its apply */
function source() {
  const listeners = new Set<(packet: SimFramePacket) => void>();
  const applyTimes = { state: 0, ops: 0, events: 0, present: 0, listeners: 0 };
  return {
    applyTimes,
    onFrame: (listener: (packet: SimFramePacket) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    listeners,
    send(stepsRun: number, tickMs: number, gameTimeMs: number, apply = 1) {
      applyTimes.state = apply;
      applyTimes.present = apply;
      const packet = { stepsRun, scalars: { tickMs, gameTimeMs }, events: [{}], ops: [] } as unknown as SimFramePacket;
      for (const listener of listeners) listener(packet);
    },
  };
}

describe('PacketSums', () => {
  it('listens only while started and sums what every packet brings', () => {
    const sim = source();
    const sums = new PacketSums(sim);
    sim.send(1, 5, 100);
    expect(sim.listeners.size).toBe(0);

    sums.start();
    sim.send(4, 2, 1000);
    sim.send(4, 3, 1066.7);
    sim.send(0, 0.5, 1066.7);
    const s = sums.take();
    expect(s.packets).toBe(3);
    expect(s.emptyPackets).toBe(1);
    expect(s.subSteps).toBe(8);
    expect(s.tickMs).toBeCloseTo(5.5);
    // The first packet only sets the clock
    expect(s.gameMs).toBeCloseTo(66.7);
    expect(s.events).toBe(3);
    expect(s.apply.state).toBe(3);
    expect(s.apply.present).toBe(3);

    sums.stop();
    expect(sim.listeners.size).toBe(0);
  });

  it('starts a window on take(true) and counts no time when a new run sets the clock back', () => {
    const sim = source();
    const sums = new PacketSums(sim);
    sums.start();
    sim.send(1, 1, 5000);
    sums.take(true);
    sim.send(1, 1, 100);
    sim.send(1, 1, 116);
    const s = sums.take();
    expect(s.packets).toBe(2);
    expect(s.gameMs).toBe(16);
  });
});

describe('loadRates', () => {
  it('turns a window into speed, worker load, packets per second and apply per packet', () => {
    const rates = loadRates({
      wallMs: 2000, packets: 100, applies: 100, emptyPackets: 0, subSteps: 400, tickMs: 500, gameMs: 7600, events: 0, ops: 0,
      apply: { state: 50, ops: 10, events: 20, present: 100, listeners: 20 },
    });
    expect(rates.speed).toBeCloseTo(3.8);
    expect(rates.workerLoad).toBeCloseTo(0.25);
    expect(rates.packetsPerS).toBeCloseTo(50);
    expect(rates.applyPerPacketMs).toBeCloseTo(2);
  });
});
