/**
 * A WaveDirector stand-in for specs that only need the service to exist.
 *
 * It exists so the contract between the facade and the director lives in one
 * place: a spec that stubbed `{}` broke the moment the facade started calling
 * `useRandomSource`, and six specs had to be touched to find out. Specs that
 * care about a planned wave pass their own `getNextWave`.
 */

import type { WaveDirector } from './wave-director';
import type { PlannedWave, WaveSource } from './wave-source';

/** The source of the stub: an id and a name, nothing that plans. */
const STUB_SOURCE = { id: 'adaptive', name: 'Adaptive director', plansAt: 'wave-start' } as Partial<WaveSource>;

export function waveDirectorStub(overrides: Partial<WaveDirector> = {}): WaveDirector {
  return {
    useRandomSource: () => undefined,
    useSourceNextRun: () => undefined,
    sourceNextRun: 'adaptive',
    source: STUB_SOURCE,
    committed: null as PlannedWave | null,
    ensurePlanned: () => {
      throw new Error('waveDirectorStub: no wave planned; pass ensurePlanned/getNextWave');
    },
    getNextWave: async () => {
      throw new Error('waveDirectorStub: no wave planned; pass getNextWave');
    },
    peek: () => [],
    onWaveCompleted: () => undefined,
    resetForNewGame: () => undefined,
    setDebugMode: () => undefined,
    isDebugMode: () => false,
    ...overrides,
  } as unknown as WaveDirector;
}
