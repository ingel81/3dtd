/**
 * Which wave source a run plays.
 *
 * One value, read once per run by `WaveDirector.resetForNewGame()`. The debug
 * window can pick another one for the next run; a run never changes its source
 * halfway, because a mixed run's numbers would belong to two different wave
 * generators (docs/WAVE_SOURCE_PLAN.md, section 7).
 */

import type { WaveSourceId } from '../director/wave-source';

export const DEFAULT_WAVE_SOURCE: WaveSourceId = 'adaptive';
