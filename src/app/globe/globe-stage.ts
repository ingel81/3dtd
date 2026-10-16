import { MathUtils, PerspectiveCamera, Vector3, WebGLRenderer } from 'three';
import { EARTH_A, directionOf, ecefOf, type LatLon } from './globe-geo';
import { SHOT_FOV } from './globe-flight';
import type { GlobeQuality } from './globe-textures';
import { GlobeView, type ScreenSpot } from './globe-view';
import { MapsGlobe, OsmGlobe, type StageGlobeScene } from './style-globes';

/** The three globes of the stage, one per world (worlds/world-rules.ts WorldId) */
export type StageGlobeId = 'real' | 'osm' | 'maps';

/** One globe to draw this frame: where its square stands on the canvas, CSS pixels from the top left */
export interface StageSlot {
  globe: StageGlobeId;
  x: number;
  y: number;
  size: number;
  /** The point of the globe facing the viewer */
  center: LatLon;
  /** 0 grey (a locked world) to 1 in colour */
  saturation: number;
  /** A place to project for its mark (the pick), or null */
  mark: LatLon | null;
}

/** How much of its square a globe fills, the earth's air included */
const FILL = 0.86;
/** The sun stands this far west of the middle of each globe: the night side with its lights on the right */
const SUN_WEST = 58;
const SUN_LAT = 14;
/** Cloud drift, texture widths per second (as the menu globe) */
const CLOUD_DRIFT = 1 / 2400;

/** Distance from the centre for a sphere of radius `r` to fill FILL of a square seen with `fov` (degrees) */
export function stageDistance(radius: number, fov: number, fill = FILL): number {
  const half = MathUtils.degToRad(fov / 2);
  return radius / Math.sin(Math.atan(fill * Math.tan(half)));
}

/**
 * The globes of the start (docs/WORLDS_NAVIGATION_PLAN.md, 4.3): one
 * renderer on one canvas draws up to three globes into their squares
 * (viewport and scissor), not three contexts. The real earth is the menu
 * globe's GlobeView on this renderer, without stars and sun (the page's
 * background shows through); OpenStreetMap and the maps are drawn globes
 * (style-globes.ts). Nothing here loops: the owner calls render() per frame.
 */
export class GlobeStage {
  private readonly renderer: WebGLRenderer;
  private readonly earth: GlobeView;
  private readonly osm: OsmGlobe;
  readonly maps: MapsGlobe;
  private readonly camera = new PerspectiveCamera(30, 1, 0.1, 20);
  private readonly sun = new Vector3();
  private readonly tmp = new Vector3();
  private readonly pose = { position: new Vector3(), target: new Vector3(), up: new Vector3(0, 0, 1) };
  private width = 1;
  private height = 1;
  private disposed = false;

  /** The earth's first maps are up */
  readonly ready: Promise<void>;

  constructor(canvas: HTMLCanvasElement, quality: GlobeQuality, options: { pixelRatio: number; baseUrl: string }) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', depth: true, stencil: false });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = false;
    this.renderer.setPixelRatio(Math.min(options.pixelRatio, quality === 'high' ? 2 : 1));
    this.earth = new GlobeView(canvas, quality, { ...options, renderer: this.renderer });
    this.osm = new OsmGlobe(quality === 'high' ? [256, 128] : [128, 64]);
    this.maps = new MapsGlobe(quality === 'high' ? 14 : 9);
    this.ready = this.earth.ready;
  }

  /** The canvas' CSS size */
  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
  }

  /** Draw the slots; returns each slot's mark on the canvas (CSS pixels), facing or not */
  render(slots: readonly StageSlot[], now: number): (ScreenSpot | null)[] {
    if (this.disposed) return [];
    const r = this.renderer;
    r.setScissorTest(false);
    r.setViewport(0, 0, this.width, this.height);
    r.clear(true, true, false);
    r.setScissorTest(true);
    this.osm.setMaps(this.earth.surfaceMaps());
    const date = new Date(now);
    const seconds = now / 1000;
    return slots.map((slot) => {
      if (slot.size < 2 || slot.x + slot.size < 0 || slot.y + slot.size < 0 || slot.x > this.width || slot.y > this.height) return null;
      // WebGL counts from the bottom
      const y = this.height - slot.y - slot.size;
      r.setViewport(slot.x, y, slot.size, slot.size);
      r.setScissor(slot.x, y, slot.size, slot.size);
      r.clear(false, true, false);
      directionOf(SUN_LAT, slot.center.lon - SUN_WEST, this.sun);
      return slot.globe === 'real' ? this.drawEarth(slot, date) : this.drawStyled(slot, slot.globe === 'osm' ? this.osm : this.maps, seconds);
    });
  }

  private drawEarth(slot: StageSlot, date: Date): ScreenSpot | null {
    const view = this.earth;
    const distance = stageDistance(EARTH_A, SHOT_FOV);
    ecefOf(slot.center.lat, slot.center.lon, distance - EARTH_A, this.pose.position);
    view.resize(slot.size, slot.size);
    view.setShift(0);
    view.setPose(this.pose.position, this.pose.target.set(0, 0, 0), this.pose.up);
    // The sun of the stage, not of the hour: day on the left, the night with its lights on the right
    view.setSky({ lat: SUN_LAT, lon: slot.center.lon - SUN_WEST }, date, ((date.getTime() / 1000) * CLOUD_DRIFT) % 1);
    view.setSaturation(slot.saturation);
    view.render();
    if (!slot.mark) return null;
    const spot = view.project(ecefOf(slot.mark.lat, slot.mark.lon, 0, this.tmp), { x: 0, y: 0, facing: false });
    return { x: spot.x + slot.x, y: spot.y + slot.y, facing: spot.facing };
  }

  private drawStyled(slot: StageSlot, globe: StageGlobeScene, seconds: number): ScreenSpot | null {
    const camera = this.camera;
    const distance = stageDistance(1, camera.fov);
    directionOf(slot.center.lat, slot.center.lon, camera.position).multiplyScalar(distance);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    camera.aspect = 1;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    globe.setSaturation(slot.saturation);
    globe.update(this.sun, seconds);
    this.renderer.render(globe.scene, camera);
    if (!slot.mark) return null;
    const point = directionOf(slot.mark.lat, slot.mark.lon, this.tmp);
    const facing = point.dot(camera.position) > 1;
    point.multiplyScalar(1.02).project(camera);
    return { x: slot.x + ((point.x + 1) / 2) * slot.size, y: slot.y + ((1 - point.y) / 2) * slot.size, facing };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.earth.dispose();
    this.osm.dispose();
    this.maps.dispose();
    this.renderer.dispose();
    // The context goes back to the browser at once, not with the next GC (one per visit to the globes)
    this.renderer.forceContextLoss();
  }
}
