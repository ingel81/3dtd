/**
 * The flat map of an OSM world's frame: MapLibre GL with the vector tiles of
 * OpenFreeMap (OpenStreetMap data, no key), the HQ, the spawns with their
 * routes. The map's square stands still in the middle (E282, drawn by the
 * frame over the map: `crop`); the map is dragged under it, as a picture is
 * cropped, and zooms with the square's side so the square keeps its size on
 * the screen. Letting go (after the map's glide) hands the square's middle to
 * `settle`; the HQ goes there. Arrows on the focused map move it, + and -
 * size the square. A spawn is dragged with the mouse or a finger, before the
 * map; where it lands goes to `drop`, which decides (the worker puts it on
 * its street).
 *
 * MapLibre is not bundled: its files are copied as they ship to `maplibre/`
 * (angular.json) and loaded the first time a frame shows, its module, its
 * worker (beside it, given by setWorkerUrl, which a page on the desktop
 * app's own scheme needs) and its stylesheet. Bundled, its code would come
 * twice: once in the chunk, once for the worker, which imports the shipped
 * shared module.
 */
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { GeoJSONSource, LngLat, Map as MapLibre } from 'maplibre-gl';
import { TD_THEME } from '../../styles/td-theme';
import type { FrameSpawn, GeoPoint } from '../../world/osm/osm-frame-core';
import { sameArea, type OsmArea } from '../../world/osm/osm-area';
import { frameKey, movedBy, zoomForSide } from './osm-frame-view';

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
  /** The map's tiles did not come (the tiles' server): why, null when no answer came */
  tilesFailed(message: string | null): void;
  /** The square as it may stand (the place searched for keeps its room to the edge); the map is held to its middle */
  fit(area: OsmArea): OsmArea;
  /** The map let go, or a key let go: the square's middle as it stands now */
  settle(centre: GeoPoint): void;
  /** + or - on the focused map: the side a step bigger or smaller */
  resize(step: 1 | -1): void;
  /** The map moves under the square (dragged, keys held, a new square loading), or stands on the square laid out */
  moving(on: boolean): void;
}

export interface FrameMapView {
  hq: GeoPoint | null;
  spawns: readonly FrameSpawn[];
  selected: number | null;
  /** The square laid out: the HQ, the spawns and their routes belong to it; null before the place is open */
  area: OsmArea | null;
  /** Where the square stands on the map: the one laid out, one that loads, with the side the slider sets */
  target: OsmArea;
  /** Spawns may be dragged, the map moved and sized (not while a load, a drop or the making runs) */
  editable: boolean;
}

/** Pixels round the pointer a press takes a spawn in */
const GRAB_PX = 8;

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
  /** The map dragged, until its glide ends */
  private panning = false;
  /** An arrow or + and - held on the focused map */
  private keyed = false;
  /** The map is off the square laid out: the HQ and the routes wait for the new one */
  private moving = false;
  /** A drag let go outside the map ends as well */
  private readonly letGo = (): void => this.end();

  /**
   * The map in `container` on `view.target`, once MapLibre has loaded; `crop` is the square drawn over it,
   * whose size on the screen the zoom follows; `label` names the map for a screen reader
   */
  static async open(container: HTMLElement, crop: HTMLElement, view: FrameMapView, label: string, handlers: FrameMapHandlers): Promise<OsmFrameMap> {
    return new OsmFrameMap(await loadMapLibre(), container, crop, view, label, handlers);
  }

  private constructor(
    private readonly ml: MapLibreModule,
    container: HTMLElement,
    private readonly crop: HTMLElement,
    view: FrameMapView,
    label: string,
    private readonly handlers: FrameMapHandlers,
  ) {
    this.view = view;
    const { target } = view;
    this.map = new ml.Map({
      container,
      style: OSM_FRAME_STYLE,
      center: [target.lon, target.lat],
      zoom: this.zoomFor(target),
      minZoom: 11,
      maxZoom: 18,
      // The zoom is the square's side: no wheel, pinch or keys of MapLibre's (the page scrolls past the map)
      scrollZoom: false,
      boxZoom: false,
      doubleClickZoom: false,
      touchZoomRotate: false,
      keyboard: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: false,
      locale: { 'Map.Title': label },
      // The square's middle stays where the place searched for keeps its room to the edge
      transformConstrain: (lngLat, zoom) => this.constrain(lngLat, zoom),
    });
    this.map.addControl(new ml.AttributionControl({ compact: true }), 'bottom-right');
    this.map.on('error', (e) => {
      if (!this.ready) handlers.tilesFailed(e.error?.message ?? null);
    });
    this.map.on('load', () => this.onLoad());
    this.map.on('resize', () => this.place());
    window.addEventListener('mouseup', this.letGo);
    this.lock();
  }

  show(view: FrameMapView): void {
    this.view = view;
    this.lock();
    this.place();
    this.setMoving();
    if (this.ready) this.paint();
  }

  /** The square's middle as the map stands */
  centre(): GeoPoint {
    const c = this.map.getCenter();
    return { lat: c.lat, lon: c.lng };
  }

  dispose(): void {
    window.removeEventListener('mouseup', this.letGo);
    this.map.remove();
  }

  private zoomFor(area: OsmArea): number {
    // Before the box has its size the square on the screen is not known: a guess near the page's
    const px = this.crop.clientWidth || 280;
    return zoomForSide(area.sideM, area.lat, px);
  }

  private constrain(lngLat: LngLat, zoom: number): { center: LngLat; zoom: number } {
    const at = this.handlers.fit({ lat: lngLat.lat, lon: lngLat.lng, sideM: this.view.target.sideM });
    return { center: new this.ml.LngLat(at.lon, at.lat), zoom };
  }

  /** The camera on the target: its zoom always, its middle unless the player holds the map */
  private place(): void {
    const { target } = this.view;
    const zoom = this.zoomFor(target);
    if (this.panning || this.keyed) {
      if (Math.abs(this.map.getZoom() - zoom) > 1e-4) this.map.setZoom(zoom);
      return;
    }
    const off = !sameArea({ ...this.centre(), sideM: target.sideM }, target);
    if (off || Math.abs(this.map.getZoom() - zoom) > 1e-4) this.map.jumpTo({ center: [target.lon, target.lat], zoom });
  }

  /** Nothing to move or drag while the frame does not let it (a load, a drop, the making) */
  private lock(): void {
    const canvas = this.map.getCanvasContainer();
    if (this.view.editable) {
      this.map.dragPan.enable();
      if (canvas.style.cursor === 'default') canvas.style.cursor = '';
    } else {
      this.map.dragPan.disable();
      canvas.style.cursor = 'default';
    }
  }

  /** Whether the map is off the square laid out; told to the frame, which draws the HQ in the square's middle then */
  private setMoving(): void {
    const { area, target } = this.view;
    const moving = this.panning || this.keyed || !area || !sameArea(area, target);
    if (moving === this.moving) return;
    this.moving = moving;
    this.handlers.moving(moving);
    if (this.ready) this.paint();
  }

  /** The map let go: the square's middle to the frame */
  private settle(): void {
    this.handlers.settle(this.centre());
    this.setMoving();
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
    map.addSource('of-routes', { type: 'geojson', data: empty });
    map.addSource('of-points', { type: 'geojson', data: empty });
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
   * The map dragged under the square, or a spawn dragged on it: a press on a spawn takes the spawn (the map
   * stands still under it), anywhere else the map. The map's drag ends after its glide; the keys on the
   * focused map end when let go.
   */
  private listen(): void {
    const map = this.map;
    const canvas = map.getCanvasContainer();
    const start = (e: PointerEvent & { preventDefault(): void }) => {
      const spawn = this.spawnAt(e.point);
      if (spawn === null) return;
      e.preventDefault();
      this.dragging = { index: spawn, at: { lat: e.lngLat.lat, lon: e.lngLat.lng } };
      canvas.style.cursor = 'grabbing';
      this.handlers.select(spawn);
    };
    const move = (e: PointerEvent) => {
      if (this.dragging) {
        this.dragging.at = { lat: e.lngLat.lat, lon: e.lngLat.lng };
        this.paint();
      } else if (this.view.editable && !this.panning) {
        // A spawn under the pointer moves on its own; elsewhere the map's grab (MapLibre's stylesheet)
        canvas.style.cursor = this.spawnAt(e.point) === null ? '' : 'move';
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
    map.on('dragstart', () => {
      this.panning = true;
      this.setMoving();
    });
    // After a drag the map glides on; where it comes to rest is where the square stands
    map.on('moveend', () => {
      if (!this.panning) return;
      this.panning = false;
      this.settle();
    });
    const keys = map.getContainer();
    keys.addEventListener('keydown', (e) => this.key(e));
    keys.addEventListener('keyup', (e) => {
      if (!this.keyed || !frameKey(e.key)) return;
      this.keyed = false;
      this.settle();
    });
    keys.addEventListener('focusout', () => {
      if (!this.keyed) return;
      this.keyed = false;
      this.settle();
    });
  }

  /** An arrow moves the map, + and - size the square, while the frame lets it */
  private key(e: KeyboardEvent): void {
    const key = frameKey(e.key, e.shiftKey);
    if (!key || !this.view.editable || this.panning || this.dragging) return;
    e.preventDefault();
    this.keyed = true;
    if ('side' in key) {
      this.handlers.resize(key.side);
    } else {
      const to = movedBy(this.centre(), key.east, key.north);
      this.map.jumpTo({ center: [to.lon, to.lat] });
    }
    this.setMoving();
  }

  /** The spawn a press at `point` takes, when the frame lets it */
  private spawnAt(point: { x: number; y: number }): number | null {
    if (!this.ready || !this.view.editable) return null;
    // A little room round the pointer: a spawn is small, a finger is not
    const r = GRAB_PX;
    const hit = this.map
      .queryRenderedFeatures([[point.x - r, point.y - r], [point.x + r, point.y + r]], { layers: ['of-points'] })
      .find((f) => f.properties?.['kind'] === 'spawn');
    return hit ? Number(hit.properties['index']) : null;
  }

  /** The spawn's drag under way ends where it stands */
  private end(): void {
    const drag = this.dragging;
    if (!drag) return;
    this.dragging = null;
    this.map.getCanvasContainer().style.cursor = '';
    this.handlers.drop(drag.index, drag.at);
  }

  /** The spawns; the HQ and the routes only while the map stands on the square they were laid out in */
  private paint(): void {
    const { hq, spawns, selected } = this.view;
    const drag = this.dragging;
    const points: PointFeature[] = spawns.map((s, k) => {
      const at = drag?.index === k ? drag.at : s;
      return point(at, { kind: 'spawn', index: k, label: String(k + 1), selected: selected === k });
    });
    if (hq && !this.moving) points.push(point(hq, { kind: 'hq', label: 'HQ', selected: false }));
    // A dragged spawn's route is the old one: it goes until the spawn lands
    const routes: PointFeature[] = this.moving
      ? []
      : spawns
          .map((s, k) => ({ s, k }))
          .filter(({ k }) => drag?.index !== k)
          .map(({ s, k }) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: s.route }, properties: { selected: selected === k } }));
    (this.map.getSource('of-points') as GeoJSONSource).setData({ type: 'FeatureCollection', features: points });
    (this.map.getSource('of-routes') as GeoJSONSource).setData({ type: 'FeatureCollection', features: routes });
  }
}

function point(p: GeoPoint, properties: Record<string, unknown>): PointFeature {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties };
}
