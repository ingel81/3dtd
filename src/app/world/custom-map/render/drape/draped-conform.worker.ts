/// <reference lib="webworker" />
/**
 * Lays draped geometries onto the ground off the main thread
 * (draped-conform-pool.ts; messages in draped-conform-protocol.ts): the
 * ground once, then batches of jobs, each conformDraped over one item's
 * geometries; the results go back with their buffers transferred.
 */
import type { MapHeightGrid } from '../../map-document';
import { gridHeightAt } from '../height-field';
import { conformDraped, type DrapeGround } from './draped-refine';
import { conformedBuffers, type ConformRequest } from './draped-conform-protocol';

let ground: DrapeGround | null = null;

addEventListener('message', (e: MessageEvent<ConformRequest>) => {
  const m = e.data;
  if (m.type === 'ground') {
    const grid: MapHeightGrid = m.grid;
    ground = { grid, originX: m.originX, originY: m.originY, heightAt: (x, y) => gridHeightAt(grid, m.originX, m.originY, x, y) };
    return;
  }
  const results = m.jobs.map((job) => conformDraped(job.geometries, ground!, { forced: job.forced }));
  postMessage({ id: m.id, results }, conformedBuffers(results));
});
