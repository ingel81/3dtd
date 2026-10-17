/**
 * The check of a map's wave events (TODO E170): what the file's shape test
 * (map-file.ts) cannot see, against the map as it is now. Used by "Check"
 * (map-validation.ts) and the Rules panel.
 */
import type { CustomMapDocument, MapPoint } from '../../world/custom-map/map-document';
import { portalWaves } from '../../world/custom-map/wave-events';

export interface WaveEventProblem {
  severity: 'error' | 'warning';
  message: string;
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
    const what = `Wave ${e.wave} event`;
    if (e.kind === 'portal' && !spawns.has(e.spawn)) {
      out.push({ severity: 'error', index, message: `${what}: there is no spawn ${e.spawn} any more; pick another or remove the event.` });
    }
    if (e.kind === 'objects') {
      const gone = e.ids.filter((id) => !objects.has(id)).length;
      if (gone === e.ids.length) out.push({ severity: 'warning', index, message: `${what}: none of its objects is on the map any more.` });
      else if (gone) out.push({ severity: 'warning', index, message: `${what}: ${gone} of its ${e.ids.length} objects are gone.` });
    }
    if (e.kind === 'time' && doc.environment.skyImage) {
      out.push({ severity: 'warning', index, message: `${what}: the map has a sky picture, which stays; the time of day moves only the sun.` });
    }
  });
  // Wave 1 needs a lane: a spawn that is open from the start
  const opens = portalWaves(events);
  if (doc.spawns.length && doc.spawns.every((s) => (opens.get(s.id) ?? 1) > 1)) {
    const first = doc.spawns[0];
    out.push({
      severity: 'error',
      message: 'Every spawn opens later through a wave event: wave 1 has no lane. Keep at least one open from the start.',
      focus: first,
      target: { kind: 'spawn', id: first.id },
    });
  }
  return out;
}
