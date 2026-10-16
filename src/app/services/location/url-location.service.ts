import { Injectable } from '@angular/core';
import type { SavedSpawn } from '../../models/location.types';
import { coordKey } from '../../utils/geo-utils';
import { shareableUrl } from '../../utils/public-url';
import { pageSwitches } from '../../core/page-switches';
import { WORLD_URL_PARAM, worldUrlValue, type WorldRef } from '../../world/world-ref';

/**
 * URL Location Service
 *
 * Links to a place: read at the page's start into the start order
 * (WorldStartService), made for a share or invite link. The address itself
 * is no longer written when the place changes (docs/WORLDS_NAVIGATION_PLAN.md, 3.8).
 * Format: ?l=49.17327,9.26859&s=49.17555,9.26387,187.5;49.18000,9.27000
 * - l = HQ (lat,lon) - COORD_DECIMALS (5) decimal places, the canonical form
 *   of a place's coordinates the game takes every place in (canonicalCoords)
 * - s = Spawns (semicolon-separated): lat,lon and, for a portal the player
 *   turned, its compass bearing in degrees (SavedSpawn.portalBearing, 1
 *   decimal place). A spawn without one faces along its route, as every
 *   spawn in URLs from before the bearing.
 */
/** Switches of development a place's link keeps (pageSwitches) */
const KEPT_SWITCHES = ['waves', 'interp'];

@Injectable({ providedIn: 'root' })
export class UrlLocationService {
  private readonly BEARING_PRECISION = 1;

  /**
   * HQ and spawns from a link to a place: a whole URL from any host (the dev
   * server, the web version, a share link) or only its query. Null when it
   * names no HQ. A link pasted into the desktop app opens the same place there.
   */
  parseLink(link: string): { hq: { lat: number; lon: number }; spawns: SavedSpawn[] } | null {
    const query = link.includes('?') ? link.slice(link.indexOf('?') + 1).split('#')[0] : link;
    const params = new URLSearchParams(query);
    const hqParam = params.get('l');
    const spawnsParam = params.get('s');

    if (!hqParam) {
      return null;
    }

    const hq = this.parseCoordPair(hqParam);
    if (!hq) {
      return null;
    }

    const spawns: SavedSpawn[] = [];
    if (spawnsParam) {
      for (const part of spawnsParam.split(';')) {
        const spawn = this.parseSpawn(part);
        if (spawn) spawns.push(spawn);
      }
    }

    return { hq, spawns };
  }

  /**
   * This page at `hq` with `spawns`, as a path with query; on a world with
   * a link of its own (an own tileset, `?world=tileset:<id>`) that world.
   */
  urlFor(hq: { lat: number; lon: number }, spawns: readonly SavedSpawn[], world: WorldRef | null = null): string {
    let url = `${window.location.pathname}?l=${coordKey(hq)}`;
    if (spawns.length > 0) {
      url += `&s=${spawns.map((s) => this.formatSpawn(s)).join(';')}`;
    }
    const worldValue = world ? worldUrlValue(world) : null;
    if (worldValue) url += `&${WORLD_URL_PARAM}=${encodeURIComponent(worldValue)}`;
    // Switches a tab was opened with go along: the wave source
    // (initialWaveSourceId), the slide between two states (state-lerp.ts)
    const search = pageSwitches();
    for (const key of KEPT_SWITCHES) {
      const value = search.get(key);
      if (value) url += `&${key}=${encodeURIComponent(value)}`;
    }
    return url;
  }

  /**
   * A place as a link for someone else: this page there, or from the
   * desktop build the same place on the web version (shareableUrl).
   */
  getShareUrl(hq: { lat: number; lon: number }, spawns: readonly SavedSpawn[], world: WorldRef | null = null): string {
    return shareableUrl(new URL(this.urlFor(hq, spawns, world), window.location.href).toString());
  }

  private formatSpawn(spawn: SavedSpawn): string {
    const at = coordKey(spawn);
    return spawn.portalBearing === undefined ? at : `${at},${spawn.portalBearing.toFixed(this.BEARING_PRECISION)}`;
  }

  /**
   * A spawn from "lat,lon" or "lat,lon,bearing". A bearing that is no number
   * is left out: the spawn stays and faces along its route.
   */
  private parseSpawn(str: string): SavedSpawn | null {
    const parts = str.split(',');
    if (parts.length !== 3) return this.parseCoordPair(str);

    const at = this.parseCoordPair(`${parts[0]},${parts[1]}`);
    if (!at) return null;
    const portalBearing = parseFloat(parts[2].trim());
    return Number.isFinite(portalBearing) ? { ...at, portalBearing } : at;
  }

  private parseCoordPair(str: string): { lat: number; lon: number } | null {
    const parts = str.split(',');
    if (parts.length !== 2) return null;

    const lat = parseFloat(parts[0].trim());
    const lon = parseFloat(parts[1].trim());

    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return null;
    }

    return { lat, lon };
  }
}
