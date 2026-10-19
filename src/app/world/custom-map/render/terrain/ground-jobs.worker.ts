/// <reference lib="webworker" />
/**
 * The ground's shape of a map that holds still, off the page's thread
 * (GroundWorker): the map comes once, transferred, then the jobs; each
 * answer goes back transferred.
 */
import { groundResultTransfer, runGroundJob, type GroundJob, type GroundJobMap } from './ground-jobs';

let map: GroundJobMap | null = null;

addEventListener('message', (e: MessageEvent<{ map: GroundJobMap } | { id: number; job: GroundJob }>) => {
  if ('map' in e.data) {
    map = e.data.map;
    return;
  }
  const result = runGroundJob(map!, e.data.job);
  // New heights are only taken: they need no answer
  if (e.data.job.kind !== 'heights') postMessage({ id: e.data.id, result }, groundResultTransfer(result));
});
