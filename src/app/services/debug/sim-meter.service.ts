import { Injectable, inject, signal } from '@angular/core';
import { SimClient } from '../../sim/client/sim-client.service';
import { SimMirror } from '../../sim/client/mirror/sim-mirror';
import { PacketSums, loadRates, type LoadStats } from '../../sim/client/load-stats';
import { sharedMemoryAvailable } from '../../sim/protocol/table-store';
import { GameStore } from '../../store/game.store';
import { EngineStore } from '../../store/engine.store';
import type { SoundCounts } from '../../store/tower-defense.store.types';

/** One second of the game as the FPS display shows it (TODO E75) */
export interface MeterSample {
  fps: number;
  /** Game ms per wall ms the packets advanced, against the speed set */
  speed: number;
  speedSet: number;
  paused: boolean;
  /** Share of the wall time the worker spent in ticks, 0 to 1 */
  workerLoad: number;
  ticksPerS: number;
  /** Main-thread ms of applying one packet */
  applyPerPacketMs: number;
  enemies: number;
  soundsRequestedPerS: number;
  soundsPlayedPerS: number;
}

/** A sample's length, ms */
export const METER_SAMPLE_MS = 1000;
/** Samples the charts keep: the last minute */
export const METER_HISTORY = 60;

/** One sample from a window of packet sums and the sound counts at its start and end */
export function meterSample(
  window: LoadStats,
  sounds: { before: SoundCounts; after: SoundCounts },
  game: { fps: number; speedSet: number; paused: boolean; enemies: number },
): MeterSample {
  const rates = loadRates(window);
  const perS = 1000 / Math.max(1, window.wallMs);
  return {
    fps: game.fps,
    speed: rates.speed,
    speedSet: game.speedSet,
    paused: game.paused,
    workerLoad: rates.workerLoad,
    ticksPerS: rates.packetsPerS,
    applyPerPacketMs: rates.applyPerPacketMs,
    enemies: game.enemies,
    soundsRequestedPerS: Math.max(0, sounds.after.requested - sounds.before.requested) * perS,
    soundsPlayedPerS: Math.max(0, sounds.after.played - sounds.before.played) * perS,
  };
}

/** The speed reached reads as short of the speed set (the display paints it red) */
export function speedShort(sample: Pick<MeterSample, 'speed' | 'speedSet' | 'paused'>): boolean {
  return !sample.paused && sample.speed < sample.speedSet - 0.05;
}

/**
 * The simulation's numbers for the FPS display's second and third stage
 * (TODO E75): speed reached, worker load, ticks, cost per packet, sounds.
 * Only values every packet brings anyway (SimScalars.tickMs, sub-steps,
 * SimClient.applyTimes), summed while the display is open; no timer in the
 * worker or on this thread. Closed, it does not even listen to the packets.
 */
@Injectable({ providedIn: 'root' })
export class SimMeterService {
  private readonly gameStore = inject(GameStore);
  private readonly engineStore = inject(EngineStore);
  private readonly mirror = inject(SimMirror);
  private readonly packets = new PacketSums(inject(SimClient));

  /** The tables go through shared memory (SharedArrayBuffer), else a copy per frame */
  readonly sharedMemory = sharedMemoryAvailable();

  readonly latest = signal<MeterSample | null>(null);
  /** The last METER_HISTORY samples, oldest first */
  readonly history = signal<readonly MeterSample[]>([]);

  private timer: ReturnType<typeof setInterval> | null = null;
  private sounds: SoundCounts = { requested: 0, played: 0 };

  setActive(active: boolean): void {
    if (active === (this.timer !== null)) return;
    if (!active) {
      clearInterval(this.timer!);
      this.timer = null;
      this.packets.stop();
      this.latest.set(null);
      this.history.set([]);
      return;
    }
    this.packets.start();
    this.sounds = this.engineStore.soundCounts();
    this.timer = setInterval(() => this.sample(), METER_SAMPLE_MS);
  }

  private sample(): void {
    const sounds = this.engineStore.soundCounts();
    const sample = meterSample(this.packets.take(true), { before: this.sounds, after: sounds }, {
      fps: this.engineStore.fps(),
      speedSet: this.gameStore.gameSpeed(),
      paused: this.gameStore.paused(),
      enemies: this.mirror.scalars.enemiesAlive,
    });
    this.sounds = sounds;
    this.latest.set(sample);
    this.history.update((history) => [...history.slice(-(METER_HISTORY - 1)), sample]);
  }
}
