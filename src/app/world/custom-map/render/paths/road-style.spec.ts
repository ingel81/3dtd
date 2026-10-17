import { encodeRoadStyle, roadStyle } from './road-style';

/** The shader's decode (road-surface.ts ROAD_SAMPLE), step by step */
function decode(code: number) {
  const take = (n: number) => {
    const v = code % n;
    code = Math.floor(code / n);
    return v;
  };
  return { layer: take(16), markings: take(4), lanes: take(8), gutter: take(2), sealed: take(2), junction: take(2), wear: code / 31 };
}

describe('road style', () => {
  it('marks roads by their class as on German roads', () => {
    expect(roadStyle({ street: 'motorway', width: 12, surface: 'asphalt', kind: 'road' })).toMatchObject({ markings: 'lanes', lanes: 3 });
    expect(roadStyle({ street: 'secondary', width: 9, surface: 'asphalt', kind: 'road' }).markings).toBe('centre-edges');
    expect(roadStyle({ street: 'tertiary_link', width: 6, surface: 'asphalt', kind: 'road' }).markings).toBe('centre');
    expect(roadStyle({ street: 'residential', width: 6, surface: 'asphalt', kind: 'road' })).toMatchObject({ markings: 'none', gutter: true });
    // No paint on setts, on a narrow lane or inside a junction
    expect(roadStyle({ street: 'secondary', width: 9, surface: 'cobblestone', kind: 'road' }).markings).toBe('none');
    expect(roadStyle({ street: 'tertiary', width: 5, surface: 'asphalt', kind: 'road' }).markings).toBe('none');
    expect(roadStyle({ street: 'secondary', width: 9, surface: 'asphalt', kind: 'road' }, true).markings).toBe('none');
  });

  it('packs a look into one float the shader takes apart again', () => {
    const s = roadStyle({ street: 'motorway', width: 12, surface: 'asphalt', kind: 'road' });
    expect(decode(encodeRoadStyle(s, 3))).toEqual({ layer: 3, markings: 3, lanes: 3, gutter: 0, sealed: 1, junction: 0, wear: Math.round(s.wear * 31) / 31 });
    const town = roadStyle({ street: 'residential', width: 6, surface: 'asphalt', kind: 'road' }, true);
    expect(decode(encodeRoadStyle(town, 0))).toMatchObject({ layer: 0, gutter: 1, junction: 1 });
    // A surface past the textures' layers draws its mean colour (layer 15)
    expect(decode(encodeRoadStyle(town, 20)).layer).toBe(15);
  });
});
