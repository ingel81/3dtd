/**
 * The flat map of an OSM world's frame: MapLibre GL with the vector tiles of
 * OpenFreeMap (OpenStreetMap data, no key), the map's square with the land
 * outside it dimmed, the HQ, the spawns with their routes. A spawn is dragged
 * with the mouse or a finger; where it lands goes to `drop`, which decides
 * (the worker puts it on its street).
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
}

export interface FrameMapView {
  hq: GeoPoint | null;
  spawns: readonly FrameSpawn[];
  selected: number | null;
}

type PointFeature = Feature<Geometry, Record<string, unknown>>;

export class OsmFrameMap {
  private readonly map: MapLibre;
  private ready = false;
  private view: FrameMapView = { hq: null, spawns: [], selected: null };
  /** The spawn under the pointer while it is dragged */
  private dragging: { index: number; at: GeoPoint } | null = null;

  /** The map in `container`, once MapLibre has loaded */
  static async open(container: HTMLElement, center: GeoPoint, sideM: number, handlers: FrameMapHandlers): Promise<OsmFrameMap> {
    return new OsmFrameMap(await loadMapLibre(), container, center, sideM, handlers);
  }

  private constructor(
    ml: MapLibreModule,
    container: HTMLElement,
    private readonly center: GeoPoint,
    private readonly sideM: number,
    private readonly handlers: FrameMapHandlers,
  ) {
    const half = sideM / 2 + 150;
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
  }

  show(view: FrameMapView): void {
    this.view = view;
    if (this.ready) this.paint();
  }

  dispose(): void {
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
    map.addSource('of-outside', { type: 'geojson', data: this.outside() });
    map.addSource('of-routes', { type: 'geojson', data: empty });
    map.addSource('of-points', { type: 'geojson', data: empty });
    map.addLayer({ id: 'of-outside', type: 'fill', source: 'of-outside', paint: { 'fill-color': TD_THEME.bgDark, 'fill-opacity': 0.55 } });
    map.addLayer({ id: 'of-square', type: 'line', source: 'of-outside', paint: { 'line-color': TD_THEME.brass, 'line-width': 2 } });
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

  /** Dragging a spawn: the map stands still under it, the spawn follows, letting go hands it to `drop` */
  private listen(): void {
    const map = this.map;
    const canvas = map.getCanvasContainer();
    const spawnAt = (e: MapLayerMouseEvent | MapLayerTouchEvent): number | null => {
      const f = e.features?.find((x) => x.properties?.['kind'] === 'spawn');
      return f ? Number(f.properties['index']) : null;
    };
    const start = (index: number | null, e: MapLayerMouseEvent | MapLayerTouchEvent) => {
      if (index === null) return;
      e.preventDefault();
      this.dragging = { index, at: { lat: e.lngLat.lat, lon: e.lngLat.lng } };
      canvas.style.cursor = 'grabbing';
      this.handlers.select(index);
    };
    const move = (e: { lngLat: { lat: number; lng: number } }) => {
      if (!this.dragging) return;
      this.dragging.at = { lat: e.lngLat.lat, lon: e.lngLat.lng };
      this.paint();
    };
    const end = () => {
      const drag = this.dragging;
      if (!drag) return;
      this.dragging = null;
      canvas.style.cursor = '';
      this.handlers.drop(drag.index, drag.at);
    };
    map.on('mouseenter', 'of-points', (e) => {
      if (spawnAt(e) !== null) canvas.style.cursor = 'grab';
    });
    map.on('mouseleave', 'of-points', () => {
      if (!this.dragging) canvas.style.cursor = '';
    });
    map.on('mousedown', 'of-points', (e) => start(spawnAt(e), e));
    map.on('touchstart', 'of-points', (e) => {
      if (e.points.length === 1) start(spawnAt(e), e);
    });
    map.on('mousemove', move);
    map.on('touchmove', move);
    map.on('mouseup', end);
    map.on('touchend', end);
    map.on('click', (e) => {
      const hit = map.queryRenderedFeatures(e.point, { layers: ['of-points'] }).find((f) => f.properties?.['kind'] === 'spawn');
      if (!hit) this.handlers.select(null);
    });
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
  }

  /** The world with the map's square cut out: the land outside it dimmed, its edge the square's outline */
  private outside(): Feature<Polygon> {
    const { lat, lon } = this.center;
    const half = this.sideM / 2;
    const dLat = half / METERS_PER_DEGREE_LAT;
    const dLon = half / (METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180));
    const square: [number, number][] = [
      [lon - dLon, lat - dLat],
      [lon - dLon, lat + dLat],
      [lon + dLon, lat + dLat],
      [lon + dLon, lat - dLat],
      [lon - dLon, lat - dLat],
    ];
    const world: [number, number][] = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [world, square] }, properties: {} };
  }
}

function point(p: GeoPoint, properties: Record<string, unknown>): PointFeature {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties };
}
