import { SIM_SNAPSHOT_VERSION, type SimSnapshot } from '../app/simulator/sim-snapshot';

/**
 * A snapshot between waves of a run without towers, of the full shape
 * SimSnapshots.restore reads (the save file checks it, save-file.ts).
 */
export function emptySimSnapshot(waveNumber = 0, seed = 1): SimSnapshot {
  const research = { completed: [], active: [], slots: 1, centerLevel: 0, queued: [] };
  const abilities = { states: [], nextStrikeId: 1 };
  const hero = { unlocked: false, ammo: 'standard', kills: 0, level: 1, hired: null };
  return {
    version: SIM_SNAPSHOT_VERSION,
    clock: { gameTimeMs: 0, subStep: 0 },
    rng: { seed, streams: {} },
    idCounter: 0,
    credits: 100,
    accounts: [['local', 100]],
    baseHealth: 500,
    waveNumber,
    phase: 'setup',
    runStarted: waveNumber > 0,
    economyPerfectStreak: 0,
    research,
    researchByPlayer: [['local', research]],
    abilities,
    abilitiesByPlayer: [['local', abilities]],
    hero,
    heroesByPlayer: [['local', hero]],
    towers: [],
    mannedTowerId: null,
    mannedByPlayer: [],
    losQueue: [],
    awaitingLos: [],
    losGeneration: 0,
  } as SimSnapshot;
}
