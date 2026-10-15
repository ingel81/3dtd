/**
 * Wave events of a custom map (TODO E170, MapGameplay.events): what holds
 * once the events up to a wave happened. One rule for the simulation (which
 * lanes run, which objects stand, GameStateManager), the main thread (sky,
 * weather and objects of the world, CustomMapWorld) and the editor's check.
 *
 * The events of wave N happen when the build phase before wave N begins:
 * when wave N - 1 ends, for wave 1 at the start. "Reached" is the wave whose
 * events happened last: during wave N it is N, between waves N and N + 1 it
 * is N + 1. Events of one wave happen in their order in the list.
 */
import type { MapEnvironment, MapWaveEvent } from './map-document';
import { timeOfDay } from './time-of-day';

/** What the fold needs of an event: the map's own, or the run rules' (RunWaveEvent) */
export type WaveEventLike =
  | { wave: number; kind: 'message' | 'weather' | 'time' }
  | { wave: number; kind: 'portal'; spawn: string }
  | { wave: number; kind: 'objects'; show: boolean; ids: readonly string[] };

/**
 * The wave whose events happened last, from the wave counter and whether the
 * game stands between waves (before the next one); during a wave and after
 * the HQ fell it is the wave of the counter
 */
export function reachedWave(waveNumber: number, betweenWaves: boolean): number {
  return betweenWaves ? waveNumber + 1 : waveNumber;
}

/** The events by wave, those of one wave in their order */
export function eventsInOrder<T extends { wave: number }>(events: readonly T[]): T[] {
  return events.map((e, i) => ({ e, i })).sort((a, b) => a.e.wave - b.e.wave || a.i - b.i).map(({ e }) => e);
}

/**
 * The wave each spawn with a portal event opens at (its earliest); a spawn
 * not in it is open from the start
 */
export function portalWaves(events: readonly WaveEventLike[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== 'portal') continue;
    const known = out.get(e.spawn);
    if (known === undefined || e.wave < known) out.set(e.spawn, e.wave);
  }
  return out;
}

/**
 * The objects that stand hidden once the events up to `reached` happened.
 * An object whose first event shows it is hidden before; one whose first
 * event takes it away stands until then.
 */
export function hiddenObjectsAt(events: readonly WaveEventLike[], reached: number): Set<string> {
  const visible = new Map<string, boolean>();
  const ordered = eventsInOrder(events);
  for (const e of ordered) {
    if (e.kind !== 'objects') continue;
    for (const id of e.ids) if (!visible.has(id)) visible.set(id, !e.show);
  }
  for (const e of ordered) {
    if (e.wave > reached) break;
    if (e.kind === 'objects') for (const id of e.ids) visible.set(id, e.show);
  }
  return new Set([...visible].filter(([, v]) => !v).map(([id]) => id));
}

/** The map's sky and weather once the events up to `reached` happened, the map's own before */
export function environmentAt(base: MapEnvironment, events: readonly MapWaveEvent[], reached: number): MapEnvironment {
  let env = base;
  for (const e of eventsInOrder(events)) {
    if (e.wave > reached) break;
    if (e.kind === 'weather') env = { ...env, weather: e.weather, weatherStrength: e.strength ?? env.weatherStrength };
    else if (e.kind === 'time') env = { ...env, ...timeOfDay(e.hour, base.sky === 'overcast' ? 'overcast' : env.sky) };
  }
  return env;
}

/** The messages of wave `wave`'s events, in their order */
export function messagesOf(events: readonly MapWaveEvent[], wave: number): string[] {
  return events.filter((e): e is Extract<MapWaveEvent, { kind: 'message' }> => e.wave === wave && e.kind === 'message').map((e) => e.text);
}
