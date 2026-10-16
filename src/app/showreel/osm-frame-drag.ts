/**
 * The OSM frame's spawn dragged on its flat map, as a player drags it: the
 * stages that show the frame (the world menu's OpenStreetMap world, the
 * game's New game) share it.
 */
import { MAP_METERS_PER_DEGREE } from '../world/custom-map/map-document';
import { nextFrame, waitSeconds, waitUntil } from './hands';
import type { ScreenPoint, ShowreelPointer } from './pointer';

/** What the drag uses of the OSM frame (its flat MapLibre map kept to itself) */
interface OsmFrameView {
  frame(): { hq: { lat: number; lon: number } | null } | null;
  spawns(): { lat: number; lon: number }[];
  busy(): boolean;
  map: { map: { project(p: [number, number]): { x: number; y: number }; getCanvas(): HTMLCanvasElement } } | null;
}

/**
 * Spawn `spawn` (index) of the shown OSM frame dragged to `to` (metres east and north of the HQ) over `dur` seconds
 * and let go there, held `hold` seconds before; resolves once the frame has laid it on its street
 */
export async function dragOsmSpawn(pointer: ShowreelPointer, args: Record<string, unknown>): Promise<void> {
  const index = Number(args['spawn'] ?? 0);
  const to = args['to'] as [number, number];
  const ng = (window as unknown as { ng?: { getComponent(el: Element | null): unknown } }).ng;
  const frame = ng?.getComponent(document.querySelector('app-osm-frame')) as OsmFrameView | null | undefined;
  await waitUntil(() => !!frame?.map, 30, "the OSM frame's map");
  const map = frame!.map!.map;
  const screen = (p: { lat: number; lon: number }): ScreenPoint => {
    const at = map.project([p.lon, p.lat]);
    const r = map.getCanvas().getBoundingClientRect();
    return { x: r.left + at.x, y: r.top + at.y };
  };
  const hq = frame!.frame()?.hq;
  const spawn = frame!.spawns()[index];
  if (!hq || !spawn) throw new Error(`showreel: the OSM frame has no HQ or no spawn ${index}`);
  const target = { lat: hq.lat + to[1] / MAP_METERS_PER_DEGREE, lon: hq.lon + to[0] / (MAP_METERS_PER_DEGREE * Math.cos((hq.lat * Math.PI) / 180)) };
  pointer.show(true);
  await pointer.glide(() => screen(spawn), 0.7, nextFrame);
  await waitSeconds(0.15);
  pointer.down();
  await waitSeconds(0.15);
  await pointer.glide(() => screen(target), Number(args['dur'] ?? 1.6), nextFrame);
  await waitSeconds(Number(args['hold'] ?? 0.4));
  pointer.up();
  await waitUntil(() => !frame!.busy(), 15, 'the dropped spawn');
}
