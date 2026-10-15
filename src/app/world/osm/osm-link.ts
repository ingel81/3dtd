/**
 * The OSM world's test entry (phase O1, until the menu has its own way in
 * phase O2): `?osm=<lat>,<lon>` makes the map of that place before the game
 * starts, stores it as an own map and loads the page anew on it
 * (`?world=map:<id>`). A status line shows what is going on; the report goes
 * to the console. Only where a link may open custom maps (customMapsByLink).
 */
import { TD_FONTS } from '../../styles/td-theme';
import { MapStore } from '../custom-map/map-store';
import { customMapsByLink } from '../custom-maps-open';
import { WORLD_URL_PARAM } from '../world-ref';
import { importOsmInWorker } from './osm-import-client';

/** URL parameter of the test entry */
export const OSM_URL_PARAM = 'osm';

/** The place a link asks for (`?osm=49.7036,9.2647`), null for none or one that does not read */
export function osmLinkPlace(search: string): { lat: number; lon: number } | null {
  const value = new URLSearchParams(search).get(OSM_URL_PARAM);
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(value ?? '');
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return Math.abs(lat) <= 85 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

/**
 * Makes, stores and opens the map of `place`; on a failure the status line
 * says why and the page stays. Returns false where links may not open custom
 * maps (the caller starts the game as usual).
 */
export async function openOsmLink(place: { lat: number; lon: number }): Promise<boolean> {
  if (!customMapsByLink()) return false;
  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  status.style.cssText =
    'position:fixed;inset:0;display:grid;place-items:center;background:var(--td-bg-dark);color:var(--td-text-primary);' +
    `font:500 16px/1.5 ${TD_FONTS.ui};padding:16px;text-align:center;z-index:10`;
  document.body.appendChild(status);
  const where = `${place.lat.toFixed(5)}, ${place.lon.toFixed(5)}`;
  const say = (text: string) => (status.textContent = text);
  say(`Making a map of ${where}: downloading the streets and heights`);
  try {
    const start = performance.now();
    const result = await importOsmInWorker(place, {}, {
      onStep: (step) => say(step === 'download' ? `Making a map of ${where}: downloading the streets and heights` : `Making a map of ${where}: building the ground and the roads`),
    });
    const store = new MapStore();
    result.doc.meta.id = await store.freeId(result.doc.meta.id);
    say(`Making a map of ${where}: saving`);
    const summary = await store.save(result.doc);
    const totalMs = Math.round(performance.now() - start);
    console.warn(`[OSM world] ${summary.id} in ${totalMs} ms`, { download: result.download, convertMs: result.convertMs, report: result.report });
    const url = new URL(window.location.href);
    url.searchParams.delete(OSM_URL_PARAM);
    url.searchParams.set(WORLD_URL_PARAM, `map:${summary.id}`);
    window.location.replace(url.toString());
  } catch (e) {
    console.error('[OSM world] failed', e);
    say(`No map of ${where}: ${(e as Error).message ?? String(e)}`);
  }
  return true;
}
