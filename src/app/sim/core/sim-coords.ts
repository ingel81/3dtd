import { Injectable } from '@angular/core';
import { MathUtils, Vector3 } from 'three';
import { METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';
import { DetMath } from '../../utils/det-math';
import type { CoordinateSync } from '../../three-engine/renderers';

/**
 * Geo to local and back as the simulation needs it: the simple frame of
 * EllipsoidSync (geoToLocalSimple, localToGeo) around the world's origin,
 * pure math, no tiles. The main thread's EllipsoidSync with the same origin
 * gives the same numbers, so an op's local position lands where it did.
 */
export interface SimSync extends CoordinateSync {
  getOrigin(): { lat: number; lon: number; height: number };
  localToGeo(vec: { x: number; y: number; z: number }): { lat: number; lon: number; height: number };
}

/** EllipsoidSync's simple frame: -X east, +Y up, +Z north, metres from the origin. */
export class OriginSync implements SimSync {
  private readonly latCos: number;
  private readonly latRad: number;
  private readonly lonRad: number;

  constructor(
    private readonly lat: number,
    private readonly lon: number,
    private readonly height = 0,
  ) {
    this.latCos = DetMath.cos(lat * MathUtils.DEG2RAD);
    this.latRad = lat * MathUtils.DEG2RAD;
    this.lonRad = lon * MathUtils.DEG2RAD;
  }

  /** Through radians and back, as EllipsoidSync keeps it */
  getOrigin(): { lat: number; lon: number; height: number } {
    return { lat: this.latRad * MathUtils.RAD2DEG, lon: this.lonRad * MathUtils.RAD2DEG, height: this.height };
  }

  geoToLocalSimple(lat: number, lon: number, height: number): Vector3 {
    return this.geoToLocalSimpleInto(lat, lon, height, new Vector3());
  }

  geoToLocalSimpleInto(lat: number, lon: number, height: number, target: Vector3): Vector3 {
    const dLon = lon - this.lon;
    const dLat = lat - this.lat;
    return target.set(-dLon * METERS_PER_DEGREE_LAT * this.latCos, height - this.height, dLat * METERS_PER_DEGREE_LAT);
  }

  /** The simulation has no ellipsoid: the simple frame, which is all it reads */
  geoToLocal(lat: number, lon: number, height: number): Vector3 {
    return this.geoToLocalSimple(lat, lon, height);
  }

  /** EllipsoidSync.localToGeo, the same formulas */
  localToGeo(vec: { x: number; y: number; z: number }): { lat: number; lon: number; height: number } {
    const originLat = this.latRad * MathUtils.RAD2DEG;
    const originLon = this.lonRad * MathUtils.RAD2DEG;
    const R = 6371000;
    const metersPerDegreeLon = R * DetMath.cos(originLat * MathUtils.DEG2RAD) * MathUtils.DEG2RAD;
    const metersPerDegreeLat = R * MathUtils.DEG2RAD;
    return {
      lat: originLat + vec.z / metersPerDegreeLat,
      lon: originLon + -vec.x / metersPerDegreeLon,
      height: vec.y + this.height,
    };
  }
}

/**
 * The simulation's frame (SimSync), set with its world (SimCore.loadWorld,
 * or a spec's own frame). Every geo to local conversion of the simulation
 * goes through `sync`.
 */
@Injectable()
export class SimCoords {
  private current: SimSync | null = null;

  get sync(): SimSync {
    if (!this.current) throw new Error('SimCoords: no world frame yet');
    return this.current;
  }

  /** A frame is set (a world is loaded) */
  get ready(): boolean {
    return this.current !== null;
  }

  use(sync: SimSync | null): void {
    this.current = sync;
  }
}
