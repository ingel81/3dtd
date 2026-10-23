import { encodeRoadStyle, ORDER_STEP, roadPaintBands, roadStyle } from './road-style';

/** The shader's decode (road-surface.ts ROAD_SAMPLE), step by step */
function decode(code: number) {
  const take = (n: number) => {
    const v = code % n;
    code = Math.floor(code / n);
    return v;
  };
  return { layer: take(16), markings: take(4), lanes: take(8), gutter: take(2), sealed: take(2), junction: take(2), wear: take(32) / 31, rank: code };
}

describe('road style', () => {
  it('reads back exactly in single floats with the order on top, as the shader reads it (floor of the code plus a quarter)', () => {
    const s = roadStyle({ street: 'residential', width: 6, surface: 'asphalt', kind: 'road', sidewalk: 1.8 }, true);
    for (const order of [0, 7, 8, 15]) {
      const code = encodeRoadStyle(s, 1) + order * ORDER_STEP;
      // Past 2^23 a float's step is 1: plus a half, an odd code rounded up to the even one (the next layer's texture)
      const read = Math.floor(Math.fround(Math.fround(code) + 0.25));
      expect(read).toBe(code);
      expect(decode(read).layer).toBe(1);
    }
  });


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
    expect(decode(encodeRoadStyle(s, 3))).toEqual({ layer: 3, markings: 3, lanes: 3, gutter: 0, sealed: 1, junction: 0, wear: Math.round(s.wear * 31) / 31, rank: 7 });
    const town = roadStyle({ street: 'residential', width: 6, surface: 'asphalt', kind: 'road' }, true);
    expect(decode(encodeRoadStyle(town, 0))).toMatchObject({ layer: 0, gutter: 1, junction: 1, rank: 3 });
    // A surface past the textures' layers draws its mean colour (layer 15)
    expect(decode(encodeRoadStyle(town, 20)).layer).toBe(15);
  });

  it('paints the same ground under a road in OSM worlds and the editor: a paved one its core and a verge', () => {
    const country = roadPaintBands({ surface: 'asphalt', street: 'secondary', width: 9, kind: 'road' }, 0.75);
    expect(country).toEqual([
      { materials: ['asphalt'], half: 3, soft: 0.05, core: true },
      { materials: ['gravel', 'gravel-light', 'dirt-path'], half: 4.5, soft: 0.75, core: false },
    ]);
    expect(roadPaintBands({ surface: 'asphalt', street: 'residential', width: 6, kind: 'road' }, 1.5)[1].materials[0]).toBe('sidewalk');
    // The verge under the pavements too: no lawn painted under them
    expect(roadPaintBands({ surface: 'asphalt', street: 'residential', width: 6, kind: 'road', sidewalk: 1.8 }, 1.5)[1]).toMatchObject({ materials: ['sidewalk', 'paving', 'gravel'], half: 4.3, soft: 0.25 });
    expect(roadPaintBands({ surface: 'sidewalk', street: 'footway', width: 2.5, kind: 'path' }, 1.5)[1]).toMatchObject({ materials: ['dirt-path', 'dirt', 'gravel'], soft: 0.4 });
    // Unpaved: the material at its width; none without a surface or on a bridge
    expect(roadPaintBands({ surface: 'gravel', street: 'track', width: 3, kind: 'path' }, 1.5)).toEqual([{ materials: ['gravel'], half: 1.5, soft: 1.5, core: false }]);
    expect(roadPaintBands({ street: 'track', width: 3, kind: 'path' }, 1.5)).toEqual([]);
    expect(roadPaintBands({ surface: 'asphalt', width: 6, kind: 'bridge' }, 1.5)).toEqual([]);
  });
});
