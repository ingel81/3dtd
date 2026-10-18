import { describe, expect, it } from 'vitest';
import type { MapPoint } from '../../custom-map/map-document';
import { OsmFrame, type OsmArea, type OsmFeatures, type OsmWay } from '../osm-parse';
import { findOldTown, isOldArea, isOldBuilding } from './old-town';

const rect = (cx: number, cy: number, w: number, d: number): MapPoint[] => [
  { x: cx - w / 2, y: cy - d / 2 },
  { x: cx + w / 2, y: cy - d / 2 },
  { x: cx + w / 2, y: cy + d / 2 },
  { x: cx - w / 2, y: cy + d / 2 },
];

function features(areas: OsmArea[], ways: OsmWay[] = []): OsmFeatures {
  return {
    frame: new OsmFrame(0, 0),
    half: 300,
    ways,
    areas,
    points: [],
    stats: { elements: 0, ways: 0, relations: 0, points: 0, areas: 0, forcedRings: 0, cutAreas: 0, turnedAreas: 0, areasOutside: 0 },
  };
}

const building = (id: number, ring: MapPoint[], tags: Record<string, string> = { building: 'yes' }): OsmArea => ({
  id,
  from: 'way',
  tags,
  outer: [ring],
  inner: [],
  area: Math.abs((ring[1].x - ring[0].x) * (ring[2].y - ring[1].y)),
});

describe('old town', () => {
  it('reads it from a building\'s own tags', () => {
    expect(isOldBuilding({ building: 'yes', 'building:architecture': 'half-timbered' })).toBe(true);
    expect(isOldBuilding({ building: 'yes', heritage: '4' })).toBe(true);
    expect(isOldBuilding({ building: 'house', start_date: '1612' })).toBe(true);
    expect(isOldBuilding({ building: 'house', start_date: '~1780' })).toBe(true);
    expect(isOldBuilding({ building: 'house', start_date: '1962' })).toBe(false);
    expect(isOldBuilding({ building: 'house' })).toBe(false);
  });

  it('reads it from an area tagged or named as one', () => {
    expect(isOldArea({ historic: 'city' })).toBe(true);
    expect(isOldArea({ place: 'quarter', name: 'Altstadt' })).toBe(true);
    expect(isOldArea({ landuse: 'residential', name: 'Old Town' })).toBe(true);
    expect(isOldArea({ highway: 'pedestrian', name: 'Altstadtgasse' })).toBe(false);
    expect(isOldArea({ landuse: 'residential', name: 'Neubaugebiet' })).toBe(false);
  });

  it('finds the houses inside a town wall, densely built small houses, not the open suburb', () => {
    // A wall round the west half; dense small houses in the east; a suburb in the south
    const wall: OsmWay = { id: 1, tags: { barrier: 'city_wall' }, nodes: [], points: [{ x: -250, y: -100 }, { x: -50, y: -100 }, { x: -50, y: 150 }, { x: -250, y: 150 }, { x: -250, y: -100 }] };
    const dense: OsmArea[] = [];
    let id = 10;
    for (let x = 60; x < 220; x += 9) for (let y = 0; y < 120; y += 13) dense.push(building(id++, rect(x, y, 8, 12)));
    const suburb: OsmArea[] = [];
    for (let x = -200; x < 200; x += 30) suburb.push(building(id++, rect(x, -230, 10, 9)));
    const town = findOldTown(features([...dense, ...suburb], [wall]), 600);
    expect(town.has({ x: -150, y: 20 }, { building: 'yes' }, 400)).toBe(true);
    expect(town.has({ x: 140, y: 60 }, { building: 'yes' }, 100)).toBe(true);
    expect(town.has({ x: 0, y: -230 }, { building: 'yes' }, 90)).toBe(false);
    // Dense, but of big blocks: a city centre, not an old town
    expect(town.has({ x: 140, y: 60 }, { building: 'yes' }, 600)).toBe(false);
    expect(town.reasons).toMatchObject({ wall: 1, dense: 1 });
  });

  it('takes no wall for a short piece of one', () => {
    const wall: OsmWay = { id: 1, tags: { barrier: 'city_wall' }, nodes: [], points: [{ x: -100, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 60 }] };
    expect(findOldTown(features([], [wall]), 600).has({ x: -40, y: 20 }, { building: 'yes' }, null)).toBe(false);
  });
});
