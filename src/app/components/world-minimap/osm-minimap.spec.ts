import { describe, expect, it, vi } from 'vitest';
import { drawOsmPicture, osmArea } from './osm-minimap';
import { MinimapFrame } from './minimap-frame';
import type { BuildingFootprint, StreetNetwork } from '../../services/location/osm-street.service';

describe('osmArea (TODO E142)', () => {
  it('frames HQ, spawns and routes in a square with a margin, north up', () => {
    const area = osmArea([{ x: 0, z: 0 }, { x: 1000, z: -600 }], true)!;
    expect(area.right - area.left).toBeCloseTo(area.bottom - area.top);
    expect(area.right - area.left).toBeGreaterThan(1000);
    expect(area.left).toBeLessThan(0);
    expect(area.right).toBeGreaterThan(1000);
    // North is negative z: the top edge is the smaller z
    expect(area.top).toBeLessThan(-600);
    expect(area.bottom).toBeGreaterThan(0);

    // North at +z (the tiles' scene): east is -x, so the right edge is the smaller x
    const flipped = osmArea([{ x: 0, z: 0 }, { x: 1000, z: 600 }], false)!;
    expect(flipped.top).toBeGreaterThan(flipped.bottom);
    expect(flipped.right).toBeLessThan(flipped.left);
    expect(flipped.right).toBeLessThan(0);
    expect(flipped.left).toBeGreaterThan(1000);
  });

  it('shows at least a block around a place whose spawns stand close, and nothing without points', () => {
    const area = osmArea([{ x: 5, z: 5 }], true)!;
    expect(area.right - area.left).toBe(400);
    expect(osmArea([], true)).toBeNull();
  });
});

describe('drawOsmPicture (TODO E142)', () => {
  /** A 2D context that notes what is drawn */
  function recorder() {
    const calls: string[] = [];
    const c = {
      fillRect: vi.fn(() => calls.push('ground')),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(() => calls.push(`fill ${c.fillStyle}`)),
      stroke: vi.fn(() => calls.push(`stroke ${c.strokeStyle} ${c.lineWidth}`)),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      lineCap: '',
      lineJoin: '',
    };
    return { c, calls };
  }
  const frame = new MinimapFrame({ left: 0, right: 100, top: 0, bottom: 100 }, 200);
  const toScene = (lat: number, lon: number) => ({ x: lon, z: lat });
  const node = (lat: number, lon: number) => ({ id: lat * 1000 + lon, lat, lon });

  it('lays dark ground, the buildings as areas, then streets with main roads wider; no paths', () => {
    const streets = {
      streets: [
        { id: 1, name: 'A', type: 'residential', nodes: [node(10, 10), node(10, 90)] },
        { id: 2, name: 'B', type: 'primary', nodes: [node(50, 0), node(50, 100)] },
        { id: 3, name: 'C', type: 'footway', nodes: [node(70, 0), node(70, 100)] },
      ],
      nodes: new Map(),
      bounds: { minLat: 0, maxLat: 100, minLon: 0, maxLon: 100 },
    } as unknown as StreetNetwork;
    const buildings = [{ id: 7, type: 'yes', levels: 2, nodes: [node(20, 20), node(20, 30), node(30, 30)] }] as BuildingFootprint[];
    const { c, calls } = recorder();
    drawOsmPicture(c as unknown as CanvasRenderingContext2D, frame, toScene, streets, buildings, 1);
    expect(calls[0]).toBe('ground');
    expect(calls[1]).toMatch(/^fill /);
    const [minor, main] = calls.slice(2);
    expect(Number(minor.split(' ')[2])).toBeLessThan(Number(main.split(' ')[2]));
    // Two streets drawn (two moveTo), the footway left out; one building
    expect(c.moveTo).toHaveBeenCalledTimes(3);
  });

  it('in the map look edges the buildings and draws roads at their width, with a dark edge under all of them', () => {
    const streets = {
      streets: [
        { id: 1, name: 'A', type: 'residential', nodes: [node(10, 10), node(10, 90)] },
        { id: 2, name: 'B', type: 'primary', nodes: [node(50, 0), node(50, 100)] },
      ],
      nodes: new Map(),
      bounds: { minLat: 0, maxLat: 100, minLon: 0, maxLon: 100 },
    } as unknown as StreetNetwork;
    const buildings = [{ id: 7, type: 'yes', levels: 2, nodes: [node(20, 20), node(20, 30), node(30, 30)] }] as BuildingFootprint[];
    const { c, calls } = recorder();
    drawOsmPicture(c as unknown as CanvasRenderingContext2D, frame, toScene, streets, buildings, 1, 'map');
    expect(calls[0]).toBe('ground');
    expect(calls[1]).toMatch(/^fill /);
    expect(calls[2]).toMatch(/^stroke /);
    // Edges of both road kinds, then the roads: 2 px per m here, 7 m and 12 m
    const widths = calls.slice(3).map((call) => Number(call.split(' ')[2]));
    expect(widths).toEqual([15.5, 25.5, 14, 24]);
  });

  it('draws the streets alone while the buildings are not loaded', () => {
    const { c, calls } = recorder();
    drawOsmPicture(c as unknown as CanvasRenderingContext2D, frame, toScene, { streets: [], nodes: new Map(), bounds: { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 } }, null, 1);
    expect(calls.filter((call) => call.startsWith('fill'))).toEqual([]);
  });
});
