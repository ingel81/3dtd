/**
 * The run log's format number and the checks of a wave block, without any
 * import: the relay shares them to check a log a player sends (TODO E38),
 * run-log.types re-exports them for the game.
 */

export const RUN_LOG_FORMAT = 3;

/** The fields of a wave record (RunLogWave) the checks read */
export interface ReconcilableWave {
  income: Record<string, number>;
  spending: Record<string, number>;
  creditsStart: number;
  creditsEnd: number;
  killsByTower: number;
  killsByHero: number;
  killsByAbility: number;
  killsByDebug: number;
  killsByOther: number;
  killsByPartner?: number;
  enemiesAtStart: number;
  enemiesSpawned: number;
  enemiesAlive: number;
  leaked: number;
  towers: readonly { kills: number }[];
}

/**
 * The checks a wave has to pass. They are written into the wave record rather
 * than thrown: a run with a hole in its bookkeeping is still worth keeping,
 * and the hole is what the analysis needs to see.
 *
 * - gold: start plus income minus spending is the end
 * - bodies: what stood at the start plus what spawned is killed, leaked or
 *   still standing. The leftovers matter: a wave that hands two enemies to
 *   the next block kills more than it spawned, and that is correct.
 * - towers: the towers' kills do not exceed the wave's tower kills
 */
export function reconcileWave(wave: ReconcilableWave): string[] {
  const mismatches: string[] = [];

  const income = sum(Object.values(wave.income));
  const spending = sum(Object.values(wave.spending));
  const expected = wave.creditsStart + income - spending;
  if (Math.round(expected) !== Math.round(wave.creditsEnd)) {
    mismatches.push(`gold: ${wave.creditsStart} + ${income} - ${spending} = ${expected}, end ${wave.creditsEnd}`);
  }

  const kills = wave.killsByTower + wave.killsByHero + wave.killsByAbility
    + wave.killsByDebug + wave.killsByOther + (wave.killsByPartner ?? 0);
  const bodies = wave.enemiesAtStart + wave.enemiesSpawned;
  const accounted = kills + wave.leaked + wave.enemiesAlive;
  if (bodies !== accounted) {
    mismatches.push(
      `bodies: stood ${wave.enemiesAtStart} + spawned ${wave.enemiesSpawned}`
      + ` = ${bodies}, killed ${kills} + leaked ${wave.leaked} + alive ${wave.enemiesAlive} = ${accounted}`,
    );
  }

  const towerKills = sum(wave.towers.map((t) => t.kills));
  if (towerKills > wave.killsByTower) {
    mismatches.push(`towers: ${towerKills} kills on the towers, ${wave.killsByTower} booked for the wave`);
  }

  return mismatches;
}

function sum(values: number[]): number {
  return values.reduce((total, v) => total + v, 0);
}
