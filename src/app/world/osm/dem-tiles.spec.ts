import { decodeTerrarium, downloadDem, sampleMosaic, sampleMosaicRows, tilesFor, worldPixel, type DemMosaic } from './dem-tiles';

/** Terrarium pixel of a height */
function terrarium(h: number): [number, number, number, number] {
  const v = h + 32768;
  const r = Math.floor(v / 256);
  const g = Math.floor(v - r * 256);
  const b = Math.round((v - r * 256 - g) * 256);
  return [r, g, b, 255];
}

describe('elevation tiles', () => {
  it('decodes Terrarium pixels to metres', () => {
    const data = new Uint8Array([...terrarium(0), ...terrarium(123.5), ...terrarium(-12.25), ...terrarium(4807.75)]);
    expect(Array.from(decodeTerrarium({ width: 4, height: 1, data }))).toEqual([0, 123.5, -12.25, 4807.75]);
  });

  it('finds the tiles of a box as the slippy map numbers them', () => {
    // Zoom 14 around Miltenberg: tile 8613, 5577
    const t = tilesFor({ minLat: 49.70, maxLat: 49.705, minLon: 9.262, maxLon: 9.266 }, 14);
    expect(t).toEqual({ x0: 8613, y0: 5577, x1: 8613, y1: 5577 });
    const { px, py } = worldPixel(0, 0, 1, 256);
    expect([px, py]).toEqual([256, 256]);
  });

  it('samples a mosaic bilinearly between pixel centres, alike one by one and by rows', () => {
    // 2 x 2 pixels at zoom 1 from world pixel (255, 255): the point (0, 0), world pixel (256, 256), sits between their centres
    const m: DemMosaic = { source: 'aws', zoom: 1, tileSize: 256, left: 255, top: 255, columns: 2, rows: 2, heights: new Float32Array([0, 10, 20, 30]) };
    expect(sampleMosaic(m, 0, 0)).toBeCloseTo(15, 3);
    const out = new Float32Array(1);
    sampleMosaicRows(m, [0], [0], out);
    expect(out[0]).toBeCloseTo(15, 3);
  });

  it('takes the next source when a tile of the first does not come', async () => {
    const asked: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      asked.push(new URL(url).host);
      if (url.includes('mapterhorn')) return new Response('', { status: 404 });
      return new Response(new Uint8Array(4), { status: 200, headers: { 'content-type': 'image/png' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const flat = new Uint8Array(256 * 256 * 4);
      for (let k = 0; k < 256 * 256; k++) flat.set(terrarium(42), k * 4);
      const got = await downloadDem({ minLat: 49.70, maxLat: 49.705, minLon: 9.262, maxLon: 9.266 }, { decode: async () => ({ width: 256, height: 256, data: flat }) });
      expect(got.mosaic.source).toBe('aws');
      expect(got.failed).toEqual([{ source: 'mapterhorn', reason: expect.stringContaining('HTTP 404') }]);
      expect(sampleMosaic(got.mosaic, 49.702, 9.264)).toBe(42);
      expect(asked[0]).toBe('tiles.mapterhorn.com');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
