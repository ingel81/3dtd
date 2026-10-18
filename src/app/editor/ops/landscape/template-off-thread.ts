/**
 * A template built into a fresh map in a worker (workers/template.worker.ts):
 * terrain, the biome over all of it and its plants, off the page's thread,
 * with the share done reported as it goes. On a 2048 m map the biome alone
 * held the page for a third of a second in one frame. Inline where there are
 * no workers (the tests), with the same code (applyTemplate).
 */
import { CatalogIndex, type MapAssetCatalog } from '../../../map-ops/asset-catalog';
import type { CustomMapDocument } from '../../../world/custom-map/map-document';
import { applyTemplate, templateById, type MapTemplate } from './templates';

export interface TemplateJob {
  doc: CustomMapDocument;
  template: string;
  catalog: MapAssetCatalog;
  seed: number;
}

export type TemplateReply = { progress: number } | { doc: CustomMapDocument } | { error: string };

/** The worker's side: the template built into the job's map, the share done told to `progress` */
export async function runTemplateJob(job: TemplateJob, progress: (done: number) => void): Promise<CustomMapDocument> {
  const template = templateById(job.template);
  if (!template) throw new Error(`No template ${job.template}`);
  await applyTemplate(job.doc, template, new CatalogIndex(job.catalog), job.seed, async (done) => progress(done));
  return job.doc;
}

/** Every array buffer under `value` once: what a map's message hands over instead of copying */
export function buffersOf(value: unknown, out = new Set<ArrayBuffer>()): ArrayBuffer[] {
  const walk = (v: unknown): void => {
    if (!v || typeof v !== 'object') return;
    if (ArrayBuffer.isView(v)) {
      // Not by instanceof: a buffer from another realm (a structured copy) is one too; a shared one is not handed over
      if (Object.prototype.toString.call(v.buffer) === '[object ArrayBuffer]') out.add(v.buffer as ArrayBuffer);
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    for (const key of Object.keys(v)) walk((v as Record<string, unknown>)[key]);
  };
  walk(value);
  return [...out];
}

/**
 * Builds `template` into `doc` off the page's thread and resolves with the
 * built map (a new object: the worker's; `doc` is given away). `progress`
 * hears the share done.
 */
export function applyTemplateOffThread(
  doc: CustomMapDocument,
  template: MapTemplate,
  catalog: CatalogIndex,
  seed: number,
  progress: (done: number) => void,
): Promise<CustomMapDocument> {
  const job: TemplateJob = { doc, template: template.id, catalog: catalog.catalog, seed };
  if (typeof Worker === 'undefined') return runTemplateJob(job, progress);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../workers/template.worker', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<TemplateReply>) => {
      const reply = e.data;
      if ('progress' in reply) {
        progress(reply.progress);
        return;
      }
      worker.terminate();
      if ('error' in reply) reject(new Error(reply.error));
      else resolve(reply.doc);
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'The template worker failed'));
    };
    // Only the fresh map's terrain arrays are big: handed over, not copied
    worker.postMessage(job, buffersOf(doc.terrain));
  });
}
