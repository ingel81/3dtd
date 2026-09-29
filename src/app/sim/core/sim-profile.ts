/**
 * The perf panel's view into the worker (TODO E82, docs/SIM_WORKER.md): the
 * simulation's time by part, summed over the ticks since the panel last
 * asked (rpc profileSums). Set on the GameStateManager only while the panel
 * is open (SimConfig.profile); without it the sub-steps take no timer.
 */
import type { SimProfiler } from '../../managers/game-state.manager';
import type { SimProfileSums } from '../protocol/messages';

export function emptyProfileSums(): SimProfileSums {
  return {
    ticks: 0, subSteps: 0, tickMs: 0, commandsMs: 0, updateMs: 0, packetMs: 0,
    enemyMs: 0, enemyMoveMs: 0, enemyGridMs: 0, enemyHeightMs: 0, projectileMs: 0, combatMs: 0, eventsMs: 0,
  };
}

export class SimProfile implements SimProfiler {
  private sums = emptyProfileSums();

  accumulateFrameTiming(projectileMs: number, combatMs: number, eventsMs: number): void {
    const s = this.sums;
    s.projectileMs += projectileMs;
    s.combatMs += combatMs;
    s.eventsMs += eventsMs;
  }

  accumulateEnemyTiming(moveMs: number, gridMs: number, heightMs: number, totalMs: number): void {
    const s = this.sums;
    s.enemyMoveMs += moveMs;
    s.enemyGridMs += gridMs;
    s.enemyHeightMs += heightMs;
    s.enemyMs += totalMs;
  }

  /** One tick's parts, from the times SimCore.tick takes anyway */
  addTick(commandsMs: number, updateMs: number, packetMs: number, stepsRun: number): void {
    const s = this.sums;
    s.ticks++;
    s.subSteps += stepsRun;
    s.commandsMs += commandsMs;
    s.updateMs += updateMs;
    s.packetMs += packetMs;
    s.tickMs += commandsMs + updateMs + packetMs;
  }

  /** The sums so far; the next window starts empty */
  take(): SimProfileSums {
    const out = this.sums;
    this.sums = emptyProfileSums();
    return out;
  }
}
