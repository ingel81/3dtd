import type { ThreeTilesEngine } from './three-tiles-engine';

/** The renderers of an ability strike's effects */
type StrikeRenderers = Pick<
  ThreeTilesEngine,
  'abilityMarkers' | 'missileLaunches' | 'mushroomClouds' | 'frostBursts' | 'empPulses' | 'orbitalBeams'
>;

/**
 * Take every effect of an ability strike off the field: target markers,
 * missile launches, mushroom clouds, frost bursts, EMP pulses, orbital
 * beams. A new game (VFXService) and a replay entering, leaving or seeking
 * (ReplaySession) do; each strike runs on its own clock and would otherwise
 * play on over a field it no longer belongs to (a laser seen twice after
 * seeking back and forth).
 */
export function clearStrikeEffects(engine: StrikeRenderers): void {
  engine.abilityMarkers.clear();
  engine.missileLaunches.clear();
  engine.mushroomClouds.clear();
  engine.frostBursts.clear();
  engine.empPulses.clear();
  engine.orbitalBeams.clear();
}
