/** The map's life areas: a changed copy of the life, a new area's defaults */
import type { CustomMapDocument, MapLife, MapLifeArea, MapPoint } from '../../world/custom-map/map-document';

/** The map's life with a change, a fresh copy (the document keeps undo snapshots of the old one) */
export function withLife(doc: CustomMapDocument, change: (life: MapLife) => void): MapLife {
  const life: MapLife = structuredClone(doc.life ?? {});
  change(life);
  return life;
}

/** Defaults a new area of a kind starts with */
export function newLifeArea(id: string, kind: MapLifeArea['kind'], shape: MapLifeArea['shape'], points: MapPoint[]): MapLifeArea {
  const area: MapLifeArea = { id, kind, shape, points };
  if (kind === 'sound') area.sound = shape === 'route' ? 'stream' : 'birdsong';
  return area;
}
