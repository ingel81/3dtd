import { buildingKind, buildingRole, footprintKindOf, isCompoundTags, KIND_MODELS, landmarkRole } from './building-tags';
import { landmarkKind } from './convert/anchors';

describe('OSM building tags: landmarks (E297 L2)', () => {
  it('reads one role from the tags, the first rule that matches', () => {
    // Schloss Johannisburg: a castle that is a stately home
    expect(landmarkRole({ building: 'castle', historic: 'castle', castle_type: 'stately', tourism: 'attraction', wikidata: 'Q705848' }, 4300)).toBe('palace');
    expect(landmarkRole({ historic: 'castle', castle_type: 'defensive' }, 3000)).toBe('castle');
    expect(landmarkRole({ building: 'fortress' }, 900)).toBe('castle');
    expect(landmarkRole({ building: 'cathedral', amenity: 'place_of_worship' }, 4000)).toBe('cathedral');
    expect(landmarkRole({ building: 'church' }, 120)).toBe('church');
    expect(landmarkRole({ building: 'yes', amenity: 'place_of_worship' }, 120)).toBe('chapel');
    expect(landmarkRole({ building: 'chapel' }, 600)).toBe('chapel');
    expect(landmarkRole({ building: 'mosque', religion: 'muslim' }, 600)).toBe('worship');
    expect(landmarkRole({ building: 'cloister' }, 900)).toBe('church');
    // The altar inside a church is a point: no landmark of its own
    expect(landmarkRole({ amenity: 'place_of_worship' }, 0)).toBeNull();
    // A gate tower is a way through first
    expect(landmarkRole({ building: 'civic', historic: 'city_gate', man_made: 'tower' }, 361)).toBe('gate');
    expect(landmarkRole({ building: 'gatehouse' }, 80)).toBe('gate');
    expect(landmarkRole({ building: 'yes', man_made: 'tower', 'tower:type': 'defensive' }, 45)).toBe('tower');
    expect(landmarkRole({ building: 'yes', man_made: 'tower', historic: 'yes' }, 30)).toBe('tower');
    expect(landmarkRole({ building: 'tower' }, 60)).toBe('tower');
    // A high-rise mapped as a tower, a mast: no landmarks
    expect(landmarkRole({ building: 'tower' }, 900)).toBeNull();
    expect(landmarkRole({ man_made: 'tower', 'tower:type': 'communication' }, 0)).toBeNull();
    expect(landmarkRole({ building: 'yes', amenity: 'townhall' }, 500)).toBe('townhall');
    expect(landmarkRole({ building: 'townhall' }, 500)).toBe('townhall');
    expect(landmarkRole({ building: 'monument' }, 40)).toBe('monument');
    expect(landmarkRole({ historic: 'memorial', memorial: 'plaque' }, 10)).toBeNull();
    expect(landmarkRole({ building: 'train_station' }, 800)).toBe('station');
    expect(landmarkRole({ building: 'yes', tourism: 'museum' }, 800)).toBe('museum');
    expect(landmarkRole({ building: 'yes', tourism: 'attraction', heritage: '4' }, 800)).toBe('sight');
    // An old house is old, not a landmark
    expect(landmarkRole({ building: 'yes', historic: 'building', heritage: '4', start_date: '1520' }, 200)).toBeNull();
  });

  it('gives the frame the same reading: one table of names over the roles', () => {
    expect(landmarkKind({ building: 'castle', castle_type: 'stately' }, 4300)).toBe('palace');
    expect(landmarkKind({ building: 'yes', amenity: 'place_of_worship' }, 120)).toBe('place of worship');
    expect(landmarkKind({ building: 'mosque', religion: 'muslim' }, 600)).toBe('place of worship');
    expect(landmarkKind({ historic: 'city_gate' }, 200)).toBe('city gate');
    expect(landmarkKind({ building: 'yes', amenity: 'townhall' }, 500)).toBe('town hall');
    // A station is where enemies arrive, no landmark of the frame
    expect(landmarkKind({ building: 'train_station' }, 800)).toBeNull();
  });

  it('builds each landmark as its own kind, never as an old-town house, and from its outline unless a model of its own fits', () => {
    const kind = (tags: Record<string, string>, area: number, oldTown = false) => buildingKind(tags, area, 1.5, null, null, false, oldTown);
    expect(kind({ building: 'castle', castle_type: 'stately' }, 4300)).toBe('palace');
    expect(kind({ building: 'yes', historic: 'castle' }, 900)).toBe('castle');
    expect(kind({ building: 'cathedral' }, 4000)).toBe('cathedral');
    expect(kind({ building: 'yes', man_made: 'tower', 'tower:type': 'defensive' }, 45, true)).toBe('tower');
    expect(kind({ building: 'yes', amenity: 'townhall' }, 300, true)).toBe('townhall');
    expect(kind({ building: 'yes', historic: 'city_gate' }, 200, true)).toBe('gate');
    expect(kind({ building: 'church' }, 120)).toBe('chapel');
    // A museum keeps the kind of its other tags (an old-town house in an old town)
    expect(kind({ building: 'yes', tourism: 'museum' }, 300, true)).toBe('oldtown');
    for (const k of ['palace', 'castle', 'cathedral', 'tower', 'gate', 'monument'] as const) expect(KIND_MODELS[k]).toEqual({ models: [], own: true });
    for (const k of ['church', 'chapel', 'townhall', 'station'] as const) expect(KIND_MODELS[k].own).toBe(true);
  });

  it('builds ruins as ruins, and passes a castle\'s grounds to the buildings in them', () => {
    // A ruin is a building on the ground now, no longer left out
    expect(footprintKindOf({ building: 'ruins' })).toBe('ground');
    expect(buildingRole({ building: 'ruins' }, 200)).toEqual({ landmark: null, ruin: true });
    expect(buildingRole({ building: 'yes', ruins: 'yes', man_made: 'tower', 'tower:type': 'defensive' }, 25)).toEqual({ landmark: 'tower', ruin: true });
    expect(buildingRole({ building: 'yes', historic: 'ruins' }, 200).ruin).toBe(true);
    // Burg Wertheim: the castle is its grounds, a ruin; the Palas in them takes both
    const grounds = { historic: 'castle', castle_type: 'defensive', ruins: 'yes', name: 'Wertheimer Burg' };
    expect(isCompoundTags(grounds)).toBe(true);
    expect(isCompoundTags({ building: 'castle', historic: 'castle' })).toBe(false);
    expect(buildingRole({ building: 'yes', name: 'Palas' }, 300, grounds)).toEqual({ landmark: 'castle', ruin: true });
    // A tower in them keeps its own role; a garage or a shed takes nothing
    expect(buildingRole({ building: 'yes', man_made: 'tower', historic: 'yes' }, 45, grounds).landmark).toBe('tower');
    expect(buildingRole({ building: 'garage' }, 60, grounds)).toEqual({ landmark: null, ruin: false });
    expect(buildingRole({ building: 'yes' }, 20, grounds)).toEqual({ landmark: null, ruin: false });
  });
});
