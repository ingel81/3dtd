/**
 * The flat map of an OSM world's frame: MapLibre GL with the vector tiles of
 * OpenFreeMap (OpenStreetMap data, no key), the map's square with the land
 * outside it dimmed, the HQ, the spawns with their routes. A spawn is dragged
 * with the mouse or a finger; where it lands goes to `drop`, which decides
 * (the worker puts it on its street). The square moves by its edge and is
 * sized by its corners (E209); `fit` holds it to its limits while it is
 * dragged, letting go hands it to `reframe`.
 *
 * MapLibre is not bundled: its files are copied as they ship to `maplibre/`
 * (angular.json) and loaded the first time a frame shows, its module, its
 * worker (beside it, given by setWorkerUrl, which a page on the desktop
 * app's own scheme needs) and its stylesheet. Bundled, its code would come
 * twice: once in the chunk, once for the worker, which imports the shipped
 * shared module.
 */
import type { Feature, FeatureCollection, Geometry, Polygon } from 'geojson';
import type { GeoJSONSource, Map as MapLibre, MapLayerMouseEvent, MapLayerTouchEvent } from 'maplibre-gl';
import { TD_THEME } from '../../styles/td-theme';
import { METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';
import type { FrameSpawn, GeoPoint } from '../../world/osm/osm-frame-core';
import type { OsmArea } from '../../world/osm/osm-area';

/** The map's look: OpenFreeMap's dark style, near the menu's colours */
export const OSM_FRAME_STYLE = 'https://tiles.openfreemap.org/styles/dark';

/** Where MapLibre's files lie, beside the page (angular.json assets) */
const MAPLIBRE_DIR = 'maplibre/';

type MapLibreModule = typeof import('maplibre-gl');
let maplibre: Promise<MapLibreModule> | null = null;

/** MapLibre's module, its worker and its stylesheet, once; a failed load is asked again next time */
function loadMapLibre(): Promise<MapLibreModule> {
  maplibre ??= (async () => {
    const dir = new URL(MAPLIBRE_DIR, document.baseURI);
    const css = new URL('maplibre-gl.css', dir).href;
    if (!document.querySelector(`link[href="${css}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = css;
      document.head.appendChild(link);
    }
    const module = (await import(/* @vite-ignore */ new URL('maplibre-gl.mjs', dir).href)) as MapLibreModule;
    module.setWorkerUrl(new URL('maplibre-gl-worker.mjs', dir).href);
    return module;
  })();
  maplibre.catch(() => (maplibre = null));
  return maplibre;
}

export interface FrameMapHandlers {
  /** A spawn let go at `at` */
  drop(index: number, at: GeoPoint): void;
  /** A spawn clicked, null for the map beside them */
  select(index: number | null): void;
  /** The map cannot show (no WebGL, the tiles' server) */
  problem(text: string): void;
  /** The square as it may stand, while it is dragged */
  fit(area: OsmArea): OsmArea;
  /** The square may be moved or sized now (not while a load or the making runs) */
  canReframe(): boolean;
  /** The square let go where it stands */
  reframe(area: OsmArea): void;
}

export interface FrameMapView {
  hq: GeoPoint | null;
  spawns: readonly FrameSpawn[];
  selected: number | null;
  /** The map's square */
  area: OsmArea | null;
}

/** The square's corners from the south-west round, as x and y signs from its centre */
const CORNERS: readonly [number, number][] = [[-1, -1], [-1, 1], [1, 1], [1, -1]];
/** The cursor over each corner */
const CORNER_CURSORS = ['nesw-resize', 'nwse-resize', 'nesw-resize', 'nwse-resize'];

/** Pixels round the pointer a press takes a spawn, a corner or the edge in */
const GRAB_PX = 8;

type Grab = { spawn: number } | { corner: number } | { edge: true } | null;

/** What a press or a move on the map carries */
interface PointerEvent {
  point: { x: number; y: number };
  lngLat: { lat: number; lng: number };
}

type PointFeature = Feature<Geometry, Record<string, unknown>>;

export class OsmFrameMap {
  private readonly map: MapLibre;
  private ready = false;
  private view: FrameMapView;
  /** The spawn under the pointer while it is dragged */
  private dragging: { index: number; at: GeoPoint } | null = null;
  /** The square while it is moved (by its edge) or sized (by a corner): where it began, the pointer then, as it stands now */
  private reshaping: { corner: number | null; start: OsmArea; from: GeoPoint; now: OsmArea } | null = null;
  /** A drag let go outside the map ends as well */
  private readonly letGo = (): void => this.end();

  /** The map in `container` round `area` (the place's square), once MapLibre has loaded */
  static async open(container: HTMLElement, center: GeoPoint, area: OsmArea, handlers: FrameMapHandlers): Promise<OsmFrameMap> {
    return new OsmFrameMap(await loadMapLibre(), container, center, area, handlers);
  }

  private constructor(
    ml: MapLibreModule,
    container: HTMLElement,
    center: GeoPoint,
    area: OsmArea,
    private readonly handlers: FrameMapHandlers,
  ) {
    this.view = { hq: null, spawns: [], selected: null, area };
    // Room round the square for its corners and for moving it
    const half = area.sideM * 0.75;
    const dLat = half / METERS_PER_DEGREE_LAT;
    const dLon = half / (METERS_PER_DEGREE_LAT * Math.cos((center.lat * Math.PI) / 180));
    this.map = new ml.Map({
      container,
      style: OSM_FRAME_STYLE,
      bounds: [center.lon - dLon, center.lat - dLat, center.lon + dLon, center.lat + dLat],
      maxBounds: [center.lon - dLon * 3, center.lat - dLat * 3, center.lon + dLon * 3, center.lat + dLat * 3],
      minZoom: 11,
      maxZoom: 18,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: false,
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.keyboard.disableRotation();
    this.map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
    this.map.addControl(new ml.AttributionControl({ compact: true }), 'bottom-right');
    this.map.on('error', (e) => {
      if (!this.ready) handlers.problem(`The map's tiles did not come (${e.error?.message ?? 'no answer'}). The spawns still work from the list.`);
    });
    this.map.on('load', () => this.onLoad());
    window.addEventListener('mouseup', this.letGo);
  }

  show(view: FrameMapView): void {
    this.view = view;
    if (this.ready) this.paint();
  }

  dispose(): void {
    window.removeEventListener('mouseup', this.letGo);
    this.map.remove();
  }

  private onLoad(): void {
    const map = this.map;
    // The dark style draws streets near the ground's colour: lighter, so a spawn finds its street
    for (const layer of map.getStyle().layers) {
      if (layer.type === 'line' && 'source-layer' in layer && layer['source-layer'] === 'transportation') {
        map.setPaintProperty(layer.id, 'line-color', TD_THEME.frameLight);
        map.setPaintProperty(layer.id, 'line-opacity', 0.45);
      }
    }
    const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
    map.addSource('of-outside', { type: 'geojson', data: empty });
    map.addSource('of-handles', { type: 'geojson', data: empty });
    map.addSource('of-routes', { type: 'geojson', data: empty });
    map.addSource('of-points', { type: 'geojson', data: empty });
    map.addLayer({ id: 'of-outside', type: 'fill', source: 'of-outside', paint: { 'fill-color': TD_THEME.bgDark, 'fill-opacity': 0.55 } });
    map.addLayer({ id: 'of-square', type: 'line', source: 'of-outside', paint: { 'line-color': TD_THEME.brass, 'line-width': 2 } });
    // The edge to take the square by: wider than it is drawn
    map.addLayer({ id: 'of-edge', type: 'line', source: 'of-outside', paint: { 'line-color': TD_THEME.brass, 'line-width': 14, 'line-opacity': 0 } });
    map.addLayer({
      id: 'of-handles',
      type: 'circle',
      source: 'of-handles',
      filter: ['==', ['get', 'kind'], 'corner'],
      paint: { 'circle-radius': 6, 'circle-color': TD_THEME.brass, 'circle-stroke-color': TD_THEME.ink, 'circle-stroke-width': 2 },
    });
    map.addLayer({
      id: 'of-size',
      type: 'symbol',
      source: 'of-handles',
      filter: ['==', ['get', 'kind'], 'size'],
      layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, -1.1], 'text-allow-overlap': true },
      paint: { 'text-color': TD_THEME.brass, 'text-halo-color': TD_THEME.ink, 'text-halo-width': 1.5 },
    });
    map.addLayer({
      id: 'of-routes',
      type: 'line',
      source: 'of-routes',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': TD_THEME.healthRed,
        'line-width': ['case', ['get', 'selected'], 5, 3],
        'line-opacity': ['case', ['get', 'selected'], 0.95, 0.6],
      },
    });
    map.addLayer({
      id: 'of-points',
      type: 'circle',
      source: 'of-points',
      paint: {
        'circle-radius': ['case', ['==', ['get', 'kind'], 'hq'], 9, ['get', 'selected'], 10, 8],
        'circle-color': ['case', ['==', ['get', 'kind'], 'hq'], TD_THEME.brass, TD_THEME.healthRed],
        'circle-stroke-color': TD_THEME.ink,
        'circle-stroke-width': 2,
      },
    });
    map.addLayer({
      id: 'of-labels',
      type: 'symbol',
      source: 'of-points',
      layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-allow-overlap': true },
      paint: { 'text-color': TD_THEME.textPrimary },
    });
    this.ready = true;
    this.listen();
    this.paint();
  }

  /**
   * Dragging a spawn, the square's edge or one of its corners: the map stands still under it, the spawn or
   * the square follows, letting go hands it to `drop` or `reframe`. A spawn comes before a corner, a corner
   * before the edge.
   */
  private listen(): void {
    const map = this.map;
    const canvas = map.getCanvasContainer();
    const start = (e: PointerEvent & { preventDefault(): void }) => {
      const grab = this.grabAt(e.point);
      if (!grab) return;
      e.preventDefault();
      const at = { lat: e.lngLat.lat, lon: e.lngLat.lng };
      if ('spawn' in grab) {
        this.dragging = { index: grab.spawn, at };
        canvas.style.cursor = 'grabbing';
        this.handlers.select(grab.spawn);
      } else if (this.view.area) {
        const area = this.view.area;
        this.reshaping = { corner: 'corner' in grab ? grab.corner : null, start: area, from: at, now: area };
        canvas.style.cursor = cursorOf(grab);
      }
    };
    const move = (e: PointerEvent) => {
      const at = { lat: e.lngLat.lat, lon: e.lngLat.lng };
      if (this.dragging) {
        this.dragging.at = at;
        this.paint();
      } else if (this.reshaping) {
        this.reshaping.now = this.handlers.fit(reshaped(this.reshaping, at));
        this.paint();
      } else {
        canvas.style.cursor = cursorOf(this.grabAt(e.point));
      }
    };
    map.on('mousedown', start);
    map.on('touchstart', (e) => {
      if (e.points.length === 1) start(e);
    });
    map.on('mousemove', move);
    map.on('touchmove', move);
    map.on('mouseup', this.letGo);
    map.on('touchend', this.letGo);
    map.on('click', (e) => {
      const hit = map.queryRenderedFeatures(e.point, { layers: ['of-points'] }).find((f) => f.properties?.['kind'] === 'spawn');
      if (!hit) this.handlers.select(null);
    });
  }

  /** What a press at `point` takes: a spawn, else (when the square may change) a corner, else the edge */
  private grabAt(point: { x: number; y: number }): Grab {
    if (!this.ready) return null;
    // A little room round the pointer: a corner is small, a finger is not
    const r = GRAB_PX;
    const hits = this.map.queryRenderedFeatures([[point.x - r, point.y - r], [point.x + r, point.y + r]], { layers: ['of-points', 'of-handles', 'of-edge'] });
    const spawn = hits.find((f) => f.layer.id === 'of-points' && f.properties?.['kind'] === 'spawn');
    if (spawn) return { spawn: Number(spawn.properties['index']) };
    if (!this.handlers.canReframe()) return null;
    const corner = hits.find((f) => f.layer.id === 'of-handles');
    if (corner) return { corner: Number(corner.properties['index']) };
    return hits.some((f) => f.layer.id === 'of-edge') ? { edge: true } : null;
  }

  /** The drag under way ends where it stands */
  private end(): void {
    const drag = this.dragging;
    const shape = this.reshaping;
    if (!drag && !shape) return;
    this.dragging = null;
    this.reshaping = null;
    this.map.getCanvasContainer().style.cursor = '';
    if (drag) this.handlers.drop(drag.index, drag.at);
    if (shape) {
      // The square stands as let go until the frame says otherwise (a load that fails puts it back)
      this.view = { ...this.view, area: shape.now };
      this.paint();
      this.handlers.reframe(shape.now);
    }
  }

  private paint(): void {
    const { hq, spawns, selected } = this.view;
    const drag = this.dragging;
    const points: PointFeature[] = spawns.map((s, k) => {
      const at = drag?.index === k ? drag.at : s;
      return point(at, { kind: 'spawn', index: k, label: String(k + 1), selected: selected === k });
    });
    if (hq) points.push(point(hq, { kind: 'hq', label: 'HQ', selected: false }));
    // A dragged spawn's route is the old one: it goes until the spawn lands
    const routes: PointFeature[] = spawns
      .map((s, k) => ({ s, k }))
      .filter(({ k }) => drag?.index !== k)
      .map(({ s, k }) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: s.route }, properties: { selected: selected === k } }));
    (this.map.getSource('of-points') as GeoJSONSource).setData({ type: 'FeatureCollection', features: points });
    (this.map.getSource('of-routes') as GeoJSONSource).setData({ type: 'FeatureCollection', features: routes });
    const area = this.reshaping?.now ?? this.view.area;
    if (!area) return;
    const square = corners(area);
    (this.map.getSource('of-outside') as GeoJSONSource).setData(outside(square));
    const handles: PointFeature[] = square.map(([lon, lat], k) => point({ lat, lon }, { kind: 'corner', index: k }));
    // The side over the middle of the north edge
    handles.push(point({ lat: square[1][1], lon: (square[1][0] + square[2][0]) / 2 }, { kind: 'size', label: `${(area.sideM / 1000).toFixed(1)} km` }));
    (this.map.getSource('of-handles') as GeoJSONSource).setData({ type: 'FeatureCollection', features: handles });
  }
}

function cursorOf(grab: Grab): string {
  if (!grab) return '';
  if ('spawn' in grab) return 'grab';
  return 'corner' in grab ? CORNER_CURSORS[grab.corner] : 'move';
}

/** Metres east and north per degree of longitude and latitude at `lat` */
function metresPerDegree(lat: number): { x: number; y: number } {
  return { x: METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180), y: METERS_PER_DEGREE_LAT };
}

/** The square's corners as [lon, lat], from the south-west round (CORNERS) */
function corners(area: OsmArea): [number, number][] {
  const m = metresPerDegree(area.lat);
  const half = area.sideM / 2;
  return CORNERS.map(([sx, sy]): [number, number] => [area.lon + (sx * half) / m.x, area.lat + (sy * half) / m.y]);
}

/** The world with the square cut out: the land outside it dimmed, its edge the square's outline */
function outside(square: [number, number][]): Feature<Polygon> {
  const world: [number, number][] = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [world, [...square, square[0]]] }, properties: {} };
}

/**
 * The square as the pointer at `at` makes it: moved by the way the pointer went since it took the edge, or,
 * by a corner, the corner under the pointer and the one across it where it was
 */
function reshaped(shape: { corner: number | null; start: OsmArea; from: GeoPoint }, at: GeoPoint): OsmArea {
  const { start } = shape;
  if (shape.corner === null) return { lat: start.lat + (at.lat - shape.from.lat), lon: start.lon + (at.lon - shape.from.lon), sideM: start.sideM };
  const m = metresPerDegree(start.lat);
  const [sx, sy] = CORNERS[shape.corner];
  const half = start.sideM / 2;
  // The corner across stays; the side reaches from it to the pointer, the longer way of the two
  const fx = -sx * half;
  const fy = -sy * half;
  const px = (at.lon - start.lon) * m.x;
  const py = (at.lat - start.lat) * m.y;
  const side = Math.max(sx * (px - fx), sy * (py - fy), 0);
  return { lat: start.lat + (fy + (sy * side) / 2) / m.y, lon: start.lon + (fx + (sx * side) / 2) / m.x, sideM: side };
}

function point(p: GeoPoint, properties: Record<string, unknown>): PointFeature {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties };
}
