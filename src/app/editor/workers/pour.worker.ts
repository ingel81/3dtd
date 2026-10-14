/// <reference lib="webworker" />
/**
 * The editor's pour worker (ops/pour.ts pourOffThread): fills the map's
 * hollows once and walks the poured water down; the lakes go back with
 * their sample lists transferred.
 */
import { pourWater, type PourInput } from '../ops/pour';

addEventListener('message', (e: MessageEvent<PourInput>) => {
  try {
    const result = pourWater(e.data);
    postMessage(result, result.lakes.map((l) => l.cells.buffer));
  } catch (err) {
    postMessage({ error: (err as Error).message });
  }
});
