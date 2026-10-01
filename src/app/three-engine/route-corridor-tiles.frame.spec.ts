/**
 * The corridor region stands in the tiles group's frame of its build. The
 * streets of a cached place come before the root tileset, which is when the
 * ReorientationPlugin places the group: a region built before lay beside the
 * route, and no station of the corridor build found a fine tile (2026-10-01).
 */
import { describe, expect, it, vi } from 'vitest';
import { Group, Vector3 } from 'three';
import type { TilesRenderer } from '3d-tiles-renderer';
import type { LoadRegionPlugin } from '3d-tiles-renderer/plugins';
import { RouteCorridorTiles } from './route-corridor-tiles';
import type { EllipsoidSync } from './ellipsoid-sync';
import type { SettleHold } from './tiles-lod-debug';

function setup() {
  const listeners = new Map<string, Set<() => void>>();
  const group = new Group();
  const tiles = {
    group,
    activeTiles: new Set(),
    stats: { queued: 0, downloading: 0, parsing: 0 },
    addEventListener: (type: string, fn: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: () => void) => listeners.get(type)?.delete(fn),
    dispatchEvent: vi.fn(),
  };
  const regions = { addRegion: vi.fn(), clearRegions: vi.fn() };
  const sync = { geoToLocalSimple: (lat: number, lon: number) => new Vector3(lon * 1000, 0, lat * 1000) };
  const corridor = new RouteCorridorTiles(sync as unknown as EllipsoidSync, {} as SettleHold);
  corridor.attach(tiles as unknown as TilesRenderer, regions as unknown as LoadRegionPlugin);
  const rootLoaded = () => listeners.get('load-root-tileset')?.forEach((fn) => fn());
  return { corridor, group, regions, rootLoaded, listeners };
}

const ROUTE = [[{ lat: 0, lon: 0, height: 0 }, { lat: 0.1, lon: 0.1, height: 0 }]];

describe('RouteCorridorTiles in the frame of the tiles group', () => {
  it('builds the region again from the same routes once the root tileset moved the group', () => {
    const { corridor, group, regions, rootLoaded } = setup();
    corridor.setRoutes(ROUTE);
    expect(regions.addRegion).toHaveBeenCalledTimes(1);
    expect(corridor.lod()).toMatchObject({ frame: 'ok', reframes: 0 });

    // The ReorientationPlugin places the group at the root tileset
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    group.position.set(120, -40, 7);
    group.rotation.x = -Math.PI / 2;
    group.updateMatrixWorld();
    expect(corridor.lod()).toMatchObject({ frame: 'stale' });
    rootLoaded();
    expect(regions.addRegion).toHaveBeenCalledTimes(2);
    expect(corridor.lod()).toMatchObject({ frame: 'ok', reframes: 1 });
  });

  it('builds nothing again while the frame holds, nor without routes or after an origin change', () => {
    const { corridor, group, regions, rootLoaded } = setup();
    rootLoaded();
    expect(corridor.refreshFrame()).toBe(false);
    corridor.setRoutes(ROUTE);
    rootLoaded();
    expect(corridor.refreshFrame()).toBe(false);
    expect(regions.addRegion).toHaveBeenCalledTimes(1);

    corridor.dropForNewOrigin();
    group.position.set(5, 0, 0);
    expect(corridor.refreshFrame()).toBe(false);
    expect(regions.addRegion).toHaveBeenCalledTimes(1);
  });

  it('lets go of the root tileset event when detached', () => {
    const { corridor, listeners } = setup();
    expect(listeners.get('load-root-tileset')?.size).toBe(1);
    corridor.detach();
    expect(listeners.get('load-root-tileset')?.size).toBe(0);
  });
});
