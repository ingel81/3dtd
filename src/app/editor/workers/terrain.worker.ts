/// <reference lib="webworker" />
/**
 * The editor's terrain worker: runs one job (generate a preset, erode the
 * whole map) and posts each slice back, transferring its array.
 */
import { runTerrainJob, transferList, type TerrainJob } from './terrain-job';

addEventListener('message', (e: MessageEvent<TerrainJob>) => {
  try {
    for (const m of runTerrainJob(e.data)) postMessage(m, transferList(m));
  } catch (err) {
    postMessage({ kind: 'error', message: (err as Error).message });
  }
});
