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
  Shape,
  ShapeGeometry,
} from 'three';
import { ThreeTilesEngine } from '../three-engine';
import { BuildingFootprint } from './osm-street.service';
import { GeoPosition } from '../models/game.types';
import { UIStore } from '../store/ui.store';

/** Meters per building level */
const METERS_PER_LEVEL = 3;

/**
 * BuildingRenderingService - Renders OSM building footprints as extruded 3D boxes.
 *
 * Uses building:levels tag for height. Walls + roof cap, semi-transparent.
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

    const originTerrainY = engine.getTerrainHeightAtGeo(baseCoords.lat, baseCoords.lon);
    if (originTerrainY === null) return;

    const HEIGHT_ABOVE_GROUND = 0.8;
    const allLineVertices: number[] = [];
    const allFillVertices: number[] = [];

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

      const groundY = (minTerrainY - originTerrainY) + HEIGHT_ABOVE_GROUND;
      const buildingHeight = building.levels * METERS_PER_LEVEL;
      const topY = groundY + buildingHeight;

      // Convert nodes to local XZ
      const pts: { x: number; z: number }[] = [];
      for (const node of building.nodes) {
        const local = engine.sync.geoToLocalSimple(node.lat, node.lon, 0);
        pts.push({ x: local.x, z: local.z });
      }

      // === OUTLINES: bottom + top edges + vertical corners ===
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        // Bottom edge
        allLineVertices.push(a.x, groundY, a.z, b.x, groundY, b.z);
        // Top edge
        allLineVertices.push(a.x, topY, a.z, b.x, topY, b.z);
        // Vertical edge
        allLineVertices.push(a.x, groundY, a.z, a.x, topY, a.z);
      }

      // === WALLS: quad per edge (2 triangles) ===
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        // Triangle 1: a-bottom, b-bottom, b-top
        allFillVertices.push(a.x, groundY, a.z);
        allFillVertices.push(b.x, groundY, b.z);
        allFillVertices.push(b.x, topY, b.z);
        // Triangle 2: a-bottom, b-top, a-top
        allFillVertices.push(a.x, groundY, a.z);
        allFillVertices.push(b.x, topY, b.z);
        allFillVertices.push(a.x, topY, a.z);
      }

      // === ROOF CAP: triangulate footprint at topY ===
      const shape = new Shape();
      shape.moveTo(pts[0].x, pts[0].z);
      for (let i = 1; i < pts.length; i++) {
        shape.lineTo(pts[i].x, pts[i].z);
      }
      shape.closePath();

      const shapeGeo = new ShapeGeometry(shape);
      const posAttr = shapeGeo.getAttribute('position');
      const idx = shapeGeo.getIndex();

      if (idx) {
        for (let i = 0; i < idx.count; i++) {
          const vi = idx.getX(i);
          allFillVertices.push(posAttr.getX(vi), topY, posAttr.getY(vi));
        }
      }
      shapeGeo.dispose();
    }

    // Outline mesh
    if (allLineVertices.length > 0) {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(allLineVertices, 3));

      this.buildingLinesMesh = new LineSegments(geo, new LineBasicMaterial({
        color: 0x00cccc,
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
    if (allFillVertices.length > 0) {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(allFillVertices, 3));

      this.buildingFillMesh = new Mesh(geo, new MeshBasicMaterial({
        color: 0x00cccc,
        transparent: true,
        opacity: 0.15,
        depthTest: false,
        depthWrite: false,
        side: 2, // DoubleSide
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
