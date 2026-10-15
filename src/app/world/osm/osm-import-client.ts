/**
 * Makes an OSM world in a Web Worker (downloads and conversion take a few
 * seconds), like the Warcraft import (w3x-import-client.ts). Where workers
 * are missing (Node, specs) it works on the calling thread. Aborting the
 * signal or running past `timeoutMs` ends the worker.
 */
import { MapAssetLibrary } from '../custom-map/render/map-asset-library';
import { plantCosts } from './convert/vegetation';
import { convertOsm, fetchOsmInput, OSM_WORLD_SIDE, type OsmImportOptions, type OsmImportResult } from './import-osm';
import type { OsmDownloadStats, OsmImportStep, OsmWorkerRequest, OsmWorkerResponse } from './osm-worker.types';

let nextId = 1;

/** A making that has not answered after this long is ended */
export const OSM_IMPORT_TIMEOUT_MS = 180_000;

export interface OsmImportControl {
  signal?: AbortSignal;
  timeoutMs?: number;
  onStep?: (step: OsmImportStep) => void;
}

export interface OsmWorldResult extends OsmImportResult {
  download: OsmDownloadStats;
  convertMs: number;
}

export async function importOsmInWorker(
  place: { lat: number; lon: number; address?: string },
  options: OsmImportOptions = {},
  control: OsmImportControl = {},
): Promise<OsmWorldResult> {
  const { signal, timeoutMs = OSM_IMPORT_TIMEOUT_MS, onStep } = control;
  const cancelled = (): Error => new Error('Making the map was cancelled');
  if (signal?.aborted) throw cancelled();
  options = { ...options, plantCosts: options.plantCosts ?? (await catalogPlantCosts(options.sideM ?? OSM_WORLD_SIDE)) };
  if (typeof Worker === 'undefined') {
    onStep?.('download');
    const { input, download } = await fetchOsmInput(place.lat, place.lon, { address: place.address, sideM: options.sideM, signal });
    onStep?.('convert');
    const start = performance.now();
    const result = convertOsm(input, options);
    return { ...result, download, convertMs: Math.round(performance.now() - start) };
  }

  const worker = new Worker(new URL('./osm.worker', import.meta.url), { type: 'module' });
  const id = nextId++;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let onAbort: (() => void) | null = null;
  try {
    return await new Promise<OsmWorldResult>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Making the map took longer than ${Math.round(timeoutMs / 1000)} s and was stopped`)), timeoutMs);
      onAbort = () => reject(cancelled());
      signal?.addEventListener('abort', onAbort, { once: true });
      worker.onmessage = (event: MessageEvent<OsmWorkerResponse>) => {
        const r = event.data;
        if (r.id !== id) return;
        if (r.kind === 'step') onStep?.(r.step);
        else if (r.kind === 'done') resolve({ ...r.result, download: r.download, convertMs: r.convertMs });
        else reject(new Error(r.error));
      };
      worker.onerror = (event) => reject(new Error(event.message || 'Making the map failed in the worker'));
      const request: OsmWorkerRequest = { id, lat: place.lat, lon: place.lon, address: place.address, options };
      worker.postMessage(request);
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    worker.terminate();
  }
}

/** The plants' scene costs from the renderer's catalogue; none where it cannot be read (the import then counts them dear) */
async function catalogPlantCosts(side: number): Promise<Record<string, number> | undefined> {
  try {
    return plantCosts((await MapAssetLibrary.shared().catalog()).objects, side);
  } catch {
    return undefined;
  }
}
