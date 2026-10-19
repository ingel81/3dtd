/**
 * The check of a map's wave events (TODO E170): what the file's shape test
 * (map-file.ts) cannot see, against the map as it is now. Used by "Check"
 * (map-validation.ts) and the Rules panel.
 */
import type { CustomMapDocument, MapPoint } from '../../world/custom-map/map-document';
import { portalWaves } from '../../world/custom-map/wave-events';
import type { CheckText } from './check-text';

export interface WaveEventProblem {
  severity: 'error' | 'warning';
  /** What it says, as data (checkText) */
  text: CheckText;
  /** Index in gameplay.events, when one event is at fault */
  index?: number;
  focus?: MapPoint;
  target?: { kind: 'spawn' | 'object'; id: string };
}

export function waveEventProblems(doc: CustomMapDocument): WaveEventProblem[] {
  const events = doc.gameplay?.events ?? [];
  if (!events.length) return [];
  const out: WaveEventProblem[] = [];
  const spawns = new Map(doc.spawns.map((s) => [s.id, s]));
  const objects = new Set(doc.objects.map((o) => o.id));
  events.forEach((e, index) => {
    if (e.kind === 'portal' && !spawns.has(e.spawn)) {
      out.push({ severity: 'error', index, text: { key: 'eventNoSpawn', v: { wave: e.wave, spawn: e.spawn } } });
    }
    if (e.kind === 'objects') {
      const gone = e.ids.filter((id) => !objects.has(id)).length;
      if (gone === e.ids.length) out.push({ severity: 'warning', index, text: { key: 'eventObjectsGone', v: { wave: e.wave } } });
      else if (gone) out.push({ severity: 'warning', index, text: { key: 'eventSomeGone', v: { wave: e.wave, gone, all: e.ids.length } } });
    }
    if (e.kind === 'time' && doc.environment.skyImage) {
      out.push({ severity: 'warning', index, text: { key: 'eventSkyPicture', v: { wave: e.wave } } });
    }
  });
  // Wave 1 needs a lane: a spawn that is open from the start
  const opens = portalWaves(events);
  if (doc.spawns.length && doc.spawns.every((s) => (opens.get(s.id) ?? 1) > 1)) {
    const first = doc.spawns[0];
    out.push({
      severity: 'error',
      text: { key: 'noOpenLane' },
      focus: first,
      target: { kind: 'spawn', id: first.id },
    });
  }
  return out;
}
