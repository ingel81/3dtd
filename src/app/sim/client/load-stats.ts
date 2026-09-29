import type { Scene } from 'three';
import type { SimFramePacket } from '../protocol/packet';
import type { SimClient } from './sim-client.service';

/**
 * Sums over the packets since the last reset: the load runner
 * (e2e/perf/sim-load.ts, TODO E72), the FPS display, the perf panel and the
 * benchmark read them (TODO E74, E75, E82). Only numbers every packet brings
 * anyway: no timer of its own.
 */
export interface LoadStats {
  /** Wall ms since the reset */
  wallMs: number;
  packets: number;
  /** Packets whose tick ran no sub-step */
  emptyPackets: number;
  subSteps: number;
  /** The worker's ms over all ticks (SimScalars.tickMs): divided by wallMs, its load */
  tickMs: number;
  /** Game time the packets advanced, ms: divided by wallMs, the speed reached */
  gameMs: number;
  events: number;
  ops: number;
  /** Main-thread ms of applying the packets, by part (SimClient.applyTimes) */
  apply: Record<keyof SimClient['applyTimes'], number>;
}

function emptyStats(): LoadStats {
  return {
    wallMs: 0, packets: 0, emptyPackets: 0, subSteps: 0, tickMs: 0, gameMs: 0, events: 0, ops: 0,
    apply: { state: 0, ops: 0, events: 0, present: 0, listeners: 0 },
  };
}

/** The ratios a window of LoadStats gives */
export interface LoadRates {
  /** Game ms per wall ms */
  speed: number;
  /** Share of the wall time the worker spent in ticks, 0 to 1 */
  workerLoad: number;
  packetsPerS: number;
  /** Main-thread ms of applying one packet, all parts */
  applyPerPacketMs: number;
}

export function loadRates(stats: LoadStats): LoadRates {
  const wall = Math.max(1, stats.wallMs);
  const apply = Object.values(stats.apply).reduce((a, b) => a + b, 0);
  return {
    speed: stats.gameMs / wall,
    workerLoad: stats.tickMs / wall,
    packetsPerS: (stats.packets * 1000) / wall,
    applyPerPacketMs: stats.packets > 0 ? apply / stats.packets : 0,
  };
}

/**
 * Sums the packets while started, see LoadStats. A frame listener runs inside
 * the apply: state to present are this packet's times, listeners the
 * previous one's.
 */
export class PacketSums {
  private sums = emptyStats();
  private since = performance.now();
  private lastGameMs: number | null = null;
  private stopListening: (() => void) | null = null;

  constructor(private readonly sim: Pick<SimClient, 'onFrame' | 'applyTimes'>) {}

  get running(): boolean {
    return this.stopListening !== null;
  }

  /** Listen from now on, from empty sums; nothing if already listening */
  start(): void {
    if (this.stopListening) return;
    this.stopListening = this.sim.onFrame((packet) => this.add(packet));
    this.sums = emptyStats();
    this.since = performance.now();
    this.lastGameMs = null;
  }

  stop(): void {
    this.stopListening?.();
    this.stopListening = null;
  }

  /** The sums since the last reset; `reset` starts the next window now */
  take(reset = false): LoadStats {
    const now = performance.now();
    const out = { ...this.sums, apply: { ...this.sums.apply }, wallMs: now - this.since };
    if (reset) {
      this.sums = emptyStats();
      this.since = now;
    }
    return out;
  }

  private add(packet: SimFramePacket): void {
    const sums = this.sums;
    sums.packets++;
    if (packet.stepsRun === 0) sums.emptyPackets++;
    sums.subSteps += packet.stepsRun;
    sums.tickMs += packet.scalars.tickMs;
    // A new run starts its clock over: only what moved forward counts
    const gameMs = packet.scalars.gameTimeMs;
    if (this.lastGameMs !== null && gameMs > this.lastGameMs) sums.gameMs += gameMs - this.lastGameMs;
    this.lastGameMs = gameMs;
    sums.events += packet.events.length;
    sums.ops += packet.ops.length;
    const times = this.sim.applyTimes;
    const apply = sums.apply;
    apply.state += times.state;
    apply.ops += times.ops;
    apply.events += times.events;
    apply.present += times.present;
    apply.listeners += times.listeners;
  }
}

/**
 * Per-packet sums for `__load.stats()`, and `__load.hideEnemies()`: the enemy
 * meshes and health bars left out of the draw, so a run with and one without
 * them tells the render share per enemy.
 */
export function createLoadStats(sim: SimClient, scene: () => Scene | null) {
  // Listens from the first call on, so a game nobody measures pays nothing
  const sums = new PacketSums(sim);
  return {
    stats: (reset = false): LoadStats => {
      if (!sums.running) sums.start();
      return sums.take(reset);
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
