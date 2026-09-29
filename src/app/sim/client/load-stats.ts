import type { Scene } from 'three';
import type { SimFramePacket } from '../protocol/packet';
import type { SimClient } from './sim-client.service';

/** Sums over the packets since the last reset, for the load runner (e2e/perf/sim-load.ts, TODO E72) */
export interface LoadStats {
  /** Wall ms since the reset */
  wallMs: number;
  packets: number;
  /** Packets whose tick ran no sub-step */
  emptyPackets: number;
  subSteps: number;
  /** The worker's ms over all ticks (SimScalars.tickMs): divided by wallMs, its load */
  tickMs: number;
  events: number;
  ops: number;
  /** Main-thread ms of applying the packets, by part (SimClient.applyTimes) */
  apply: Record<keyof SimClient['applyTimes'], number>;
}

/**
 * Per-packet sums for `__load.stats()`, and `__load.hideEnemies()`: the enemy
 * meshes and health bars left out of the draw, so a run with and one without
 * them tells the render share per enemy.
 */
export function createLoadStats(sim: SimClient, scene: () => Scene | null) {
  const empty = (): LoadStats => ({
    wallMs: 0, packets: 0, emptyPackets: 0, subSteps: 0, tickMs: 0, events: 0, ops: 0,
    apply: { state: 0, ops: 0, events: 0, present: 0, listeners: 0 },
  });
  let sums = empty();
  let since = performance.now();
  // A frame listener runs inside the apply: state to present are this packet's, listeners the previous one's
  sim.onFrame((packet: SimFramePacket) => {
    sums.packets++;
    if (packet.stepsRun === 0) sums.emptyPackets++;
    sums.subSteps += packet.stepsRun;
    sums.tickMs += packet.scalars.tickMs;
    sums.events += packet.events.length;
    sums.ops += packet.ops.length;
    for (const key of Object.keys(sums.apply) as (keyof LoadStats['apply'])[]) sums.apply[key] += sim.applyTimes[key];
  });
  return {
    stats: (reset = false): LoadStats => {
      const now = performance.now();
      const out = { ...sums, apply: { ...sums.apply }, wallMs: now - since };
      if (reset) {
        sums = empty();
        since = now;
      }
      return out;
    },
    hideEnemies: (hidden: boolean): number => {
      let count = 0;
      scene()?.traverse((object) => {
        const mesh = object as { geometry?: { getAttribute(name: string): unknown }; material?: { visible: boolean } };
        // Enemy instances carry their animation frame, the health bars their health
        if (!mesh.geometry || !mesh.material) return;
        if (!mesh.geometry.getAttribute('aAnimFrame') && !mesh.geometry.getAttribute('aHealth')) return;
        mesh.material.visible = !hidden;
        count++;
      });
      return count;
    },
  };
}
