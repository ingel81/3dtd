import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, inject, input, signal } from '@angular/core';
import { Vector3 } from 'three';
import { CameraControlService } from '../../services/camera-control.service';
import { EngineInitializationService } from '../../services/infrastructure/engine-initialization.service';
import { SimMirror } from '../../sim/client/mirror/sim-mirror';
import { LocationStore } from '../../store/location.store';
import type { StoreSpawnPoint } from '../../store/tower-defense.store.types';
import { TD_THEME } from '../../styles/td-theme';
import type { WorldMinimap } from '../../world/world-provider';
import { MinimapFrame, ViewFootprint } from './minimap-frame';
import { drawOsmPicture, osmArea, type OsmMinimapSource } from './osm-minimap';
import type { ThreeTilesEngine } from '../../three-engine';

/** Edge length in CSS pixels (world-minimap.component.scss) */
export const MINIMAP_CSS_PX = 176;

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

/**
 * The map from above in a corner: the routes in their spawn's colour, spawns,
 * HQ, towers, enemy dots and what the camera sees. A click glides the camera
 * there, a drag with the button held moves it along at once. The picture under them is the world's own (`WorldProvider.minimap()`,
 * a custom map) or, on a real place, drawn from OSM (`osm`, TODO E142): dark
 * ground, buildings as areas, streets as lines, around HQ, spawns and routes.
 *
 * One canvas, redrawn each animation frame outside Angular: the picture
 * with routes, spawns and HQ is composed once into a base canvas (again when
 * the world, its routes or the HQ change), each tick copies it and adds
 * towers, enemies and the view.
 */
@Component({
  selector: 'app-world-minimap',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (shown()) {
    <div class="td-overlay wm-plate">
      <canvas class="wm-canvas" [width]="pixels" [height]="pixels"
              aria-label="Minimap, click to move the view" data-test="world-minimap"
              (pointerdown)="jump($event)" (pointermove)="drag($event)"
              (pointerup)="release($event)" (pointercancel)="release($event)"></canvas>
    </div>
  }`,
  styleUrl: './world-minimap.component.scss',
})
export class WorldMinimapComponent {
  private readonly engineInit = inject(EngineInitializationService);
  private readonly mirror = inject(SimMirror);
  private readonly location = inject(LocationStore);
  private readonly cameraControl = inject(CameraControlService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** A real place's streets and buildings, for worlds without a picture of their own */
  readonly osm = input<OsmMinimapSource | null>(null);

  readonly shown = signal(false);
  /** Canvas pixels: sharp on a high-density screen */
  readonly pixels = Math.round(MINIMAP_CSS_PX * Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1)));

  private frame: MinimapFrame | null = null;
  private base: HTMLCanvasElement | null = null;
  /** What the base canvas shows; a change of any rebuilds it */
  private baseKey: { picture: WorldMinimap['picture']; routes: unknown; spawns: unknown; hq: unknown } | null = null;
  private groundY = 0;
  private readonly footprint = new ViewFootprint();
  private readonly scratch = new Vector3();
  /** The OSM picture and what it was drawn from; a change of any draws it again */
  private osmPicture: { minimap: WorldMinimap; key: readonly unknown[] } | null = null;

  constructor() {
    let frame = 0;
    const loop = (): void => {
      this.tick();
      frame = requestAnimationFrame(loop);
    };
    inject(NgZone).runOutsideAngular(() => (frame = requestAnimationFrame(loop)));
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(frame));
  }

  /** One redraw; public for the spec */
  tick(): void {
    const engine = this.engineInit.getEngine();
    const minimap = engine ? (engine.world.minimap() ?? this.osmMinimap(engine)) : null;
    if (!engine || !minimap) {
      if (this.shown()) this.shown.set(false);
      return;
    }
    if (!this.shown()) this.shown.set(true);
    const c = this.host.nativeElement.querySelector('canvas')?.getContext('2d');
    if (!c) return;

    this.ensureBase(minimap);
    const f = this.frame!;
    const scale = this.pixels / MINIMAP_CSS_PX;
    c.clearRect(0, 0, this.pixels, this.pixels);
    c.drawImage(this.base!, 0, 0);

    const sync = engine.sync;
    const v = this.scratch;
    const p = { x: 0, z: 0 };
    const at = (lat: number, lon: number): typeof p => {
      sync.geoToLocalSimpleInto(lat, lon, 0, v);
      p.x = f.u(v.x);
      p.z = f.v(v.z);
      return p;
    };

    // Towers: small light squares with a dark edge
    const towerHalf = 2.5 * scale;
    c.fillStyle = TD_THEME.knobLight;
    c.strokeStyle = TD_THEME.ink;
    c.lineWidth = scale;
    c.beginPath();
    for (const tower of this.mirror.towers()) {
      const q = at(tower.position.lat, tower.position.lon);
      c.rect(q.x - towerHalf, q.z - towerHalf, towerHalf * 2, towerHalf * 2);
    }
    c.fill();
    c.stroke();

    // Enemies: light red dots with a dark ring (they cross the red lane), bosses larger in warning orange
    this.enemyDots(c, at, false, 1.75 * scale, scale, TD_THEME.dangerText);
    this.enemyDots(c, at, true, 3 * scale, scale, TD_THEME.warnOrange);

    // What the camera sees
    const area = f.area;
    const reach = Math.max(Math.abs(area.right - area.left), Math.abs(area.bottom - area.top));
    const corners = this.footprint.update(engine.getCamera(), this.groundY, reach);
    c.strokeStyle = TD_THEME.brassLight;
    c.lineWidth = 1.25 * scale;
    c.beginPath();
    corners.forEach((q, k) => (k ? c.lineTo(f.u(q.x), f.v(q.z)) : c.moveTo(f.u(q.x), f.v(q.z))));
    c.closePath();
    c.stroke();
  }

  /** Enemies (bosses or the rest) as squares of half size `half`, each in a ring `ring` wide, in one path per colour */
  private enemyDots(
    c: CanvasRenderingContext2D,
    at: (lat: number, lon: number) => { x: number; z: number },
    bosses: boolean,
    half: number,
    ring: number,
    fill: string,
  ): void {
    for (const pass of [0, 1]) {
      const r = pass === 0 ? half + ring : half;
      let any = false;
      c.beginPath();
      for (const enemy of this.mirror.aliveEnemies()) {
        if ((enemy.typeConfig.isBoss === true) !== bosses) continue;
        const q = at(enemy.position.lat, enemy.position.lon);
        c.rect(q.x - r, q.z - r, r * 2, r * 2);
        any = true;
      }
      if (!any) return;
      c.fillStyle = pass === 0 ? TD_THEME.ink : fill;
      c.fill();
    }
  }

  /**
   * A real place from above, from its OSM streets and buildings (TODO E142),
   * null before its streets and routes are there. Drawn again when the
   * streets, the buildings, the routes, the spawns or the HQ change.
   */
  private osmMinimap(engine: ThreeTilesEngine): WorldMinimap | null {
    const source = this.osm();
    const streets = source?.streets() ?? null;
    if (!source || !streets || !engine.world.capabilities.realPlace) return null;
    const buildings = source.buildings();
    const routes = this.mirror.routes();
    const spawns = this.location.spawnPoints();
    const hq = this.location.baseCoords();
    const key = [streets, buildings, routes, spawns, hq] as const;
    const kept = this.osmPicture;
    if (kept && kept.key.every((k, i) => k === key[i])) return kept.minimap;

    const sync = engine.sync;
    const toScene = (lat: number, lon: number) => {
      const v = sync.geoToLocalSimple(lat, lon, 0);
      return { x: v.x, z: v.z };
    };
    const points = [toScene(hq.lat, hq.lon), ...spawns.map((s) => toScene(s.lat, s.lon))];
    for (const path of routes.values()) for (const g of path) points.push(toScene(g.lat, g.lon));
    const north = toScene(hq.lat + 0.001, hq.lon).z < points[0].z;
    const area = osmArea(points, north);
    if (!area) return null;
    // A new canvas each time: the base canvas tells pictures apart by identity
    const picture = document.createElement('canvas');
    picture.width = this.pixels;
    picture.height = this.pixels;
    const c = picture.getContext('2d');
    if (c) drawOsmPicture(c, new MinimapFrame(area, this.pixels), toScene, streets, buildings, this.pixels / MINIMAP_CSS_PX);
    const minimap: WorldMinimap = { picture, ...area };
    this.osmPicture = { minimap, key };
    return minimap;
  }

  /** The pointer that holds the map, while a button is down */
  private dragging: number | null = null;

  /** A click: the camera glides to that point of the map; holding the button drags on */
  jump(e: PointerEvent): void {
    const canvas = e.currentTarget as HTMLCanvasElement | null;
    if (!this.focus(e, false)) return;
    this.dragging = e.pointerId;
    canvas?.setPointerCapture?.(e.pointerId);
  }

  /** Moved with the button held: the camera follows at once */
  drag(e: PointerEvent): void {
    if (this.dragging === e.pointerId) this.focus(e, true);
  }

  release(e: PointerEvent): void {
    if (this.dragging !== e.pointerId) return;
    this.dragging = null;
    (e.currentTarget as HTMLCanvasElement | null)?.releasePointerCapture?.(e.pointerId);
  }

  private focus(e: PointerEvent, instant: boolean): boolean {
    const engine = this.engineInit.getEngine();
    const canvas = e.currentTarget as HTMLCanvasElement | null;
    if (!engine || !this.frame || !canvas) return false;
    const rect = canvas.getBoundingClientRect();
    const u = ((e.clientX - rect.left) / (rect.width || 1)) * this.pixels;
    const v = ((e.clientY - rect.top) / (rect.height || 1)) * this.pixels;
    const point = this.frame.toScene(u, v);
    const geo = engine.sync.localSimpleToGeo(point.x, point.z);
    return this.cameraControl.focusGeo(geo.lat, geo.lon, instant);
  }

  /** The picture with routes, spawns and HQ, composed when one of them changed */
  private ensureBase(minimap: WorldMinimap): void {
    const routes = this.mirror.routes();
    const spawns = this.location.spawnPoints();
    const hq = this.location.baseCoords();
    const key = this.baseKey;
    if (
      this.base &&
      this.frame?.sameArea(minimap) &&
      key?.picture === minimap.picture &&
      key.routes === routes &&
      key.spawns === spawns &&
      key.hq === hq
    ) {
      return;
    }
    this.baseKey = { picture: minimap.picture, routes, spawns, hq };
    this.frame = new MinimapFrame(minimap, this.pixels);
    this.base ??= document.createElement('canvas');
    this.base.width = this.pixels;
    this.base.height = this.pixels;
    const engine = this.engineInit.getEngine()!;
    this.groundY = engine.getTerrainHeightAtGeo(hq.lat, hq.lon) ?? 0;
    const c = this.base.getContext('2d');
    if (c) this.drawBase(c, minimap, spawns, hq);
  }

  private drawBase(c: CanvasRenderingContext2D, minimap: WorldMinimap, spawns: readonly StoreSpawnPoint[], hq: { lat: number; lon: number }): void {
    const f = this.frame!;
    const sync = this.engineInit.getEngine()!.sync;
    const scale = this.pixels / MINIMAP_CSS_PX;
    c.fillStyle = TD_THEME.panelShadow;
    c.fillRect(0, 0, this.pixels, this.pixels);
    c.drawImage(minimap.picture, f.x, f.y, f.w, f.h);

    const colorOf = new Map(spawns.map((s) => [s.id, hex(s.color)]));
    // The lanes a little faint: what walks on them stands out
    c.globalAlpha = 0.7;
    c.lineWidth = 1.5 * scale;
    c.lineJoin = 'round';
    for (const [id, path] of this.mirror.routes()) {
      c.strokeStyle = colorOf.get(id) ?? TD_THEME.knobLight;
      c.beginPath();
      path.forEach((g, k) => {
        const v = sync.geoToLocalSimple(g.lat, g.lon, 0);
        if (k) c.lineTo(f.u(v.x), f.v(v.z));
        else c.moveTo(f.u(v.x), f.v(v.z));
      });
      c.stroke();
    }
    c.globalAlpha = 1;
    c.strokeStyle = TD_THEME.ink;
    c.lineWidth = scale;
    for (const s of spawns) {
      const v = sync.geoToLocalSimple(s.lat, s.lon, 0);
      c.fillStyle = colorOf.get(s.id) ?? TD_THEME.knobLight;
      c.beginPath();
      c.arc(f.u(v.x), f.v(v.z), 4 * scale, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
    const h = sync.geoToLocalSimple(hq.lat, hq.lon, 0);
    const half = 4.5 * scale;
    c.fillStyle = TD_THEME.brass;
    c.fillRect(f.u(h.x) - half, f.v(h.z) - half, half * 2, half * 2);
    c.strokeRect(f.u(h.x) - half, f.v(h.z) - half, half * 2, half * 2);
  }
}
