import { Injectable, inject } from '@angular/core';
import {
  LineSegments,
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  MeshBasicMaterial,
  Mesh,
  Material,
  Group,
  ShapeUtils,
  Vector2,
} from 'three';
import { ThreeTilesEngine } from '../../three-engine';
import { BuildingFootprint } from '../location/osm-street.service';
import { GeoPosition } from '../../models/game.types';
import { UIStore } from '../../store/ui.store';
import type { FootprintKind } from '../../world/custom-map/map-footprints';
import { TD_THEME, themeHex } from '../../styles/td-theme';

/** Meters per building level */
const METERS_PER_LEVEL = 3;
/** Lift of the footprints over the lowest ground under them, m */
const HEIGHT_ABOVE_GROUND = 0.8;

/**
 * Colours by what OSM says a footprint is (an OSM world keeps them all,
 * TODO E290): on the ground the teal the layer always had, the others
 * td-theme tokens. The legend is the developer tile's tooltip
 */
export const FOOTPRINT_COLORS: Readonly<Record<FootprintKind | 'court' | 'dropped', number>> = {
  ground: 0x00cccc,
  part: themeHex(TD_THEME.brass),
  underground: themeHex(TD_THEME.green),
  offGround: themeHex(TD_THEME.warnOrange),
  court: themeHex(TD_THEME.knobLight),
  dropped: themeHex(TD_THEME.dangerEdge),
};

/** Kinds drawn flat on the ground, without walls: they do not stand there */
const FLAT: ReadonlySet<FootprintKind> = new Set(['underground', 'offGround']);

/** Vertices and their colours of one mesh being built */
class Buffers {
  readonly positions: number[] = [];
  readonly colors: number[] = [];
  private r = 0;
  private g = 0;
  private b = 0;

  color(hex: number): void {
    this.r = ((hex >> 16) & 255) / 255;
    this.g = ((hex >> 8) & 255) / 255;
    this.b = (hex & 255) / 255;
  }

  push(x: number, y: number, z: number): void {
    this.positions.push(x, y, z);
    this.colors.push(this.r, this.g, this.b);
  }

  geometry(): BufferGeometry | null {
    if (!this.positions.length) return null;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new Float32BufferAttribute(this.colors, 3));
    return geo;
  }
}

/**
 * BuildingRenderingService - Renders OSM building footprints as extruded 3D boxes.
 *
 * Uses building:levels tag for height. Walls + roof cap, semi-transparent.
 * Footprints an OSM world keeps (TODO E290) carry their kind: parts start at
 * their lowest storey, those below or off the ground lie flat, courtyards
 * are holes with their own edge colour, those the import left out are red.
 * All of them in two draw calls, edges and fill, coloured per vertex.
 */
@Injectable({ providedIn: 'root' })
export class BuildingRenderingService {
  private readonly uiStore = inject(UIStore);

  private buildingLinesMesh: LineSegments | null = null;
  private buildingFillMesh: Mesh | null = null;

  renderBuildings(
    engine: ThreeTilesEngine,
    buildings: BuildingFootprint[],
    baseCoords: GeoPosition,
    visible: boolean
  ): void {
    const overlayGroup = engine.getOverlayGroup();
    this.disposeMeshes(overlayGroup);

    const lines = new Buffers();
    const fill = new Buffers();
    const toLocal = (ring: readonly { lat: number; lon: number }[]) =>
      ring.map((node) => {
        const local = engine.sync.geoToLocalSimple(node.lat, node.lon, 0);
        return new Vector2(local.x, local.z);
      });

    for (const building of buildings) {
      if (building.nodes.length < 3) continue;

      // Find ground level (min raycast)
      let minTerrainY = Infinity;
      let validCount = 0;
      for (const node of building.nodes) {
        const terrainY = engine.getTerrainHeightAtGeo(node.lat, node.lon);
        if (terrainY !== null) {
          if (terrainY < minTerrainY) minTerrainY = terrainY;
          validCount++;
        }
      }
      if (validCount < 3 || minTerrainY === Infinity) continue;

      const kind = building.kind ?? 'ground';
      const flat = FLAT.has(kind);
      const groundY = minTerrainY + HEIGHT_ABOVE_GROUND;
      const baseY = flat ? groundY : groundY + (building.minLevel ?? 0) * METERS_PER_LEVEL;
      const topY = flat ? groundY : groundY + building.levels * METERS_PER_LEVEL;
      const color = building.dropped ? FOOTPRINT_COLORS.dropped : FOOTPRINT_COLORS[kind];

      // Local XZ as Vector2 (x, y = z)
      const outer = toLocal(building.nodes);
      const holes = (building.holes ?? []).filter((h) => h.length >= 3).map(toLocal);

      // === OUTLINES: bottom + top edges + vertical corners; the courtyards' in their own colour ===
      lines.color(color);
      ringLines(lines, outer, baseY, topY);
      if (!building.dropped) lines.color(FOOTPRINT_COLORS.court);
      for (const hole of holes) ringLines(lines, hole, baseY, topY);

      // === WALLS: quad per edge (2 triangles), round the courtyards too ===
      fill.color(color);
      if (topY > baseY) for (const ring of [outer, ...holes]) ringWalls(fill, ring, baseY, topY);

      // === ROOF CAP: the footprint less its courtyards, triangulated at topY ===
      // (it drops a closing point equal to the first from the rings: the indices count after that)
      const triangles = ShapeUtils.triangulateShape(outer, holes);
      const contour = holes.length ? [outer, ...holes].flat() : outer;
      for (const [a, b, c] of triangles) {
        fill.push(contour[a].x, topY, contour[a].y);
        fill.push(contour[b].x, topY, contour[b].y);
        fill.push(contour[c].x, topY, contour[c].y);
      }
    }

    // Outline mesh
    const lineGeo = lines.geometry();
    if (lineGeo) {
      this.buildingLinesMesh = new LineSegments(lineGeo, new LineBasicMaterial({
        vertexColors: true,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.6,
      }));
      this.buildingLinesMesh.visible = visible;
      this.buildingLinesMesh.renderOrder = 2;
      this.buildingLinesMesh.frustumCulled = false;
      overlayGroup.add(this.buildingLinesMesh);
    }

    // Fill mesh (walls + roof)
    const fillGeo = fill.geometry();
    if (fillGeo) {
      this.buildingFillMesh = new Mesh(fillGeo, new MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.15,
        depthTest: false,
        depthWrite: false,
        side: 2, // DoubleSide
        // Without depth the back faces need no pass of their own: one draw call
        forceSinglePass: true,
      }));
      this.buildingFillMesh.visible = visible;
      this.buildingFillMesh.renderOrder = 1;
      this.buildingFillMesh.frustumCulled = false;
      overlayGroup.add(this.buildingFillMesh);
    }
  }

  setVisibility(visible: boolean): void {
    if (this.buildingLinesMesh) this.buildingLinesMesh.visible = visible;
    if (this.buildingFillMesh) this.buildingFillMesh.visible = visible;
  }

  toggleVisibility(): void {
    this.setVisibility(this.uiStore.buildingsVisible());
  }

  dispose(overlayGroup: Group): void {
    this.disposeMeshes(overlayGroup);
  }

  reset(): void {
    this.buildingLinesMesh = null;
    this.buildingFillMesh = null;
  }

  /** Take the drawn buildings off the map: they belong to routes or a place that changed */
  clear(engine: ThreeTilesEngine): void {
    this.disposeMeshes(engine.getOverlayGroup());
  }

  private disposeMeshes(overlayGroup: Group): void {
    if (this.buildingLinesMesh) {
      overlayGroup.remove(this.buildingLinesMesh);
      this.buildingLinesMesh.geometry.dispose();
      (this.buildingLinesMesh.material as Material).dispose();
      this.buildingLinesMesh = null;
    }
    if (this.buildingFillMesh) {
      overlayGroup.remove(this.buildingFillMesh);
      this.buildingFillMesh.geometry.dispose();
      (this.buildingFillMesh.material as Material).dispose();
      this.buildingFillMesh = null;
    }
  }
}

/** A ring's edges at its foot and top and its corners between; flat (foot at the top), the foot alone */
function ringLines(out: Buffers, pts: readonly Vector2[], baseY: number, topY: number): void {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    out.push(a.x, baseY, a.y);
    out.push(b.x, baseY, b.y);
    if (topY === baseY) continue;
    out.push(a.x, topY, a.y);
    out.push(b.x, topY, b.y);
    out.push(a.x, baseY, a.y);
    out.push(a.x, topY, a.y);
  }
}

/** A ring's walls from its foot to its top, two triangles per edge */
function ringWalls(out: Buffers, pts: readonly Vector2[], baseY: number, topY: number): void {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    out.push(a.x, baseY, a.y);
    out.push(b.x, baseY, b.y);
    out.push(b.x, topY, b.y);
    out.push(a.x, baseY, a.y);
    out.push(b.x, topY, b.y);
    out.push(a.x, topY, a.y);
  }
}
