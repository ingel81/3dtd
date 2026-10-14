/// <reference lib="webworker" />
/**
 * The editor's build area worker (validation/build-areas.ts
 * buildAreasOffThread): judges every cell of the map by the game's placement
 * rules; the raster goes back transferred.
 */
import { computeBuildAreas, type BuildAreaInput } from '../validation/build-areas';

addEventListener('message', (e: MessageEvent<BuildAreaInput>) => {
  try {
    const result = computeBuildAreas(e.data);
    postMessage(result, [result.kind.buffer]);
  } catch (err) {
    postMessage({ error: (err as Error).message });
  }
});
