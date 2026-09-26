import { Group, Matrix4, type Intersection, type Object3D, type Raycaster } from 'three';
import type { TilesRenderer } from '3d-tiles-renderer';
import { raycastStats } from '../utils/raycast-stats';
import { tilesInternals } from './tiles-internals';

/** How far a reused answer may be off, m: the new ray passes the old hit at most this far away. */
const RAY_TOLERANCE_M = 1e-3;

/** Farther than any tile of the globe (m), bounds the checked stretch of a ray without a hit. */
const MAX_REACH_M = 2e7;

/** Rays remembered: at rest the controls cast two different ones per frame, both below the camera. */
const CACHE_SIZE = 4;

/** Tile events after which a ray may meet other geometry; `update-after` is checked on its own. */
const TILE_SET_EVENTS = ['load-tileset', 'load-model', 'dispose-model', 'tile-visibility-change', 'needs-update'] as const;

/**
 * TileSetVersion: zählt, wann ein Strahl in die Tiles etwas anderes treffen kann.
 *
 * Ein Strahl testet die aktiven Tiles, deren `traversal.used` gesetzt ist. Beides
 * ändert nur die Traversierung in `tilesRenderer.update()`, und die zählt
 * `frameCount` hoch; der UpdateOnChangePlugin überspringt sie, solange Kamera und
 * Tiles ruhen. Dazu kommen Laden und Entladen von Modellen, Sichtbarkeitswechsel
 * und `needs-update` (der Renderer nach einem geladenen Modell oder Root-Tileset,
 * der Engine für Routenregionen und LOD-Debug). Jedes davon zählt `value` hoch.
 *
 * Der Fade-Plugin sendet nur `fade-change`, `fade-start`, `fade-end` und
 * `needs-render`, keines davon ändert, was ein Strahl trifft: Ein Fade läuft in
 * `update-after` (neuer `frameCount`), das Ende eines Fade-outs nimmt das Tile über
 * `setTileVisible` aus der Gruppe, und das sendet `tile-visibility-change`.
 */
export class TileSetVersion {
  private _value = 0;
  private lastFrameCount: number;

  private readonly bump = (): void => {
    this._value++;
  };

  private readonly afterUpdate = (): void => {
    const frameCount = this.frameCount();
    if (frameCount !== this.lastFrameCount) {
      this.lastFrameCount = frameCount;
      this._value++;
    }
  };

  constructor(private readonly tiles: Pick<TilesRenderer, 'addEventListener' | 'removeEventListener'>) {
    this.lastFrameCount = this.frameCount();
    for (const type of TILE_SET_EVENTS) tiles.addEventListener(type, this.bump);
    tiles.addEventListener('update-after', this.afterUpdate);
  }

  get value(): number {
    return this._value;
  }

  dispose(): void {
    for (const type of TILE_SET_EVENTS) this.tiles.removeEventListener(type, this.bump);
    this.tiles.removeEventListener('update-after', this.afterUpdate);
  }

  /** TilesRendererBase bumps its (untyped) frameCount once per traversal. */
  private frameCount(): number {
    return tilesInternals(this.tiles).frameCount;
  }
}

/** A ray answered before and the hits the ground gave for it. */
interface CachedRay {
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
  near: number;
  far: number;
  firstHitOnly: boolean;
  layers: number;
  /** Stretch of the ray the answer vouches for, m: to the nearest hit with firstHitOnly, else to `far` */
  reach: number;
  hits: Intersection[];
}

/** Set by the controls on their raycaster, not in the three typings. */
function firstHitOnly(raycaster: Raycaster): boolean {
  return (raycaster as Raycaster & { firstHitOnly?: boolean }).firstHitOnly === true;
}

/** Own object and point: the controls take `distance` down by 1e5 on the hit they get back. */
function copyHit(hit: Intersection): Intersection {
  return { ...hit, point: hit.point.clone() };
}

/**
 * GroundPickRoot: was die GlobeControls als ihre Szene sehen, nur der Boden.
 *
 * Die Controls raycasten gegen ihre Szene, pro Frame den Punkt unter der Kamera
 * (Mindestabstand `cameraRadius`), beim Zoomen den Punkt unter dem Zeiger (Ziel
 * und Stopp `minDistance` davor), beim Ziehen und Drehen den Pivot. three.js
 * prüft dabei `visible` nicht. Mit der ganzen Szene trafen die Strahlen auch die
 * versteckten Reichweiten-Scheiben der Tower, die 1,5 m über dem Boden über
 * Dächer und Straßen gespannt sind, dazu Route-Linien, Ringe und Tower-Modelle.
 * Entlang der Route zoomte die Kamera deshalb auf Punkte über der Straße, hielt
 * davor an und schob die Welt beim Ziehen langsamer als den Zeiger.
 *
 * Die Wurzel hängt ohne Transform in der Szene, damit das Pivot-Mesh, das die
 * Controls hier einhängen, an seiner Weltposition gezeichnet wird. Strahlen
 * beantwortet sie nur mit dem Boden und geht nicht in die eigenen Kinder.
 * Hängt der Boden nicht in der Szene (Tiles per Debug ausgeblendet), trifft
 * nichts und die Controls nehmen ihren Rückfall, das Ellipsoid.
 *
 * Cache: auch bei ruhender Kamera casten die Controls jeden Frame zwei Strahlen
 * nach unten, im Playtest 0,27 ms je Strahl gegen die Tiles. Die Wurzel merkt
 * sich die letzten vier Strahlen mit ihren Treffern und beantwortet einen
 * gleichen Strahl aus dem Speicher. Gleich heißt: `near`, `far`, `firstHitOnly`
 * und Layer genau gleich, Ursprung und Richtung so nah, dass der neue Strahl am
 * alten Treffer höchstens 1 mm vorbeigeht (ohne Treffer auf der ganzen Länge bis
 * `far`). Jede Änderung der {@link TileSetVersion} und jede Bewegung der
 * Tiles-Gruppe (`matrixWorld`, etwa ein neuer Origin) leert den Cache. Ohne
 * Version, wie in den Specs mit einer bloßen Gruppe, rechnet jeder Strahl neu.
 */
export class GroundPickRoot extends Group {
  private readonly entries: CachedRay[] = [];
  private nextEntry = 0;
  /** Tile-set version and ground matrix the entries were taken at */
  private version = NaN;
  private readonly groundMatrix = new Matrix4();
  private readonly results: Intersection[] = [];

  constructor(
    private readonly ground: Object3D,
    private readonly tileSet: { readonly value: number } | null = null,
  ) {
    super();
    this.name = 'GroundPickRoot';
  }

  override raycast(raycaster: Raycaster, intersects: Intersection[]): boolean {
    if (this.ground.parent) {
      const cached = this.lookup(raycaster);
      if (cached) {
        for (const hit of cached.hits) intersects.push(copyHit(hit));
      } else {
        // In `__raycastStats()` unter `cameraControls` statt `unscoped`
        const results = this.results;
        const scope = raycastStats.enter('cameraControls');
        try {
          raycaster.intersectObject(this.ground, true, results);
        } finally {
          raycastStats.exit(scope);
        }
        this.store(raycaster, results);
        for (const hit of results) intersects.push(hit);
        results.length = 0;
      }
    }
    // false: three soll nicht in die Kinder (das Pivot-Mesh) weitergehen
    return false;
  }

  /** The remembered answer for this ray, null when it has to be cast. */
  private lookup(raycaster: Raycaster): CachedRay | null {
    const tileSet = this.tileSet;
    if (!tileSet) return null;
    if (tileSet.value !== this.version || !this.groundMatrix.equals(this.ground.matrixWorld)) {
      this.forget();
      this.version = tileSet.value;
      this.groundMatrix.copy(this.ground.matrixWorld);
      return null;
    }
    const { origin, direction } = raycaster.ray;
    const first = firstHitOnly(raycaster);
    for (const entry of this.entries) {
      if (
        entry.near !== raycaster.near ||
        entry.far !== raycaster.far ||
        entry.firstHitOnly !== first ||
        entry.layers !== raycaster.layers.mask
      ) {
        continue;
      }
      // Farthest the new ray gets from the old one along the checked stretch
      const offset =
        Math.hypot(origin.x - entry.ox, origin.y - entry.oy, origin.z - entry.oz) +
        entry.reach * Math.hypot(direction.x - entry.dx, direction.y - entry.dy, direction.z - entry.dz);
      if (offset <= RAY_TOLERANCE_M) return entry;
    }
    return null;
  }

  /** Remember this ray and its hits (sorted by distance) in place of the oldest entry. */
  private store(raycaster: Raycaster, hits: readonly Intersection[]): void {
    if (!this.tileSet) return;
    const { origin, direction } = raycaster.ray;
    const first = firstHitOnly(raycaster);
    this.entries[this.nextEntry] = {
      ox: origin.x,
      oy: origin.y,
      oz: origin.z,
      dx: direction.x,
      dy: direction.y,
      dz: direction.z,
      near: raycaster.near,
      far: raycaster.far,
      firstHitOnly: first,
      layers: raycaster.layers.mask,
      reach: first && hits.length > 0 ? hits[0].distance : Math.min(raycaster.far, MAX_REACH_M),
      hits: hits.map(copyHit),
    };
    this.nextEntry = (this.nextEntry + 1) % CACHE_SIZE;
  }

  private forget(): void {
    // Drops the hits too, they point at tile meshes that may be gone
    this.entries.length = 0;
    this.nextEntry = 0;
  }
}
